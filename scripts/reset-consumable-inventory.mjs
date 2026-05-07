import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const RESET_CONFIRMATION = 'RESET_CONSUMABLE_INVENTORY';
const PAGE_SIZE = 1000;

const parseEnvText = (text) => {
  const out = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const valueRaw = line.slice(idx + 1).trim();
    const value =
      (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
      (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
        ? valueRaw.slice(1, -1)
        : valueRaw;
    out.set(key, value);
  }
  return out;
};

const loadLocalEnv = () => {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return new Map();
  return parseEnvText(fs.readFileSync(envPath, 'utf8'));
};

const localEnv = loadLocalEnv();
const getEnv = (key, fallback = '') => process.env[key] ?? localEnv.get(key) ?? fallback;

const toFiniteNumber = (value) => {
  if (value == null || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const roundTo = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const toEpochMs = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const todayInTimeZone = (timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

const assertDateOnly = (value, label) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
};

const sortSnapshotsDesc = (rows) =>
  [...rows].sort((left, right) => {
    const dateOrder = String(right.snapshot_date ?? '').localeCompare(String(left.snapshot_date ?? ''), 'en-US');
    if (dateOrder !== 0) return dateOrder;
    const rightUpdated = toEpochMs(right.updated_at) ?? 0;
    const leftUpdated = toEpochMs(left.updated_at) ?? 0;
    if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;
    return String(right.id ?? '').localeCompare(String(left.id ?? ''), 'en-US');
  });

export const computeCurrentConsumableRows = ({ items, snapshots, adjustments }) => {
  const activeItems = [...items]
    .filter((item) => item?.is_active !== false && item?.deleted_at == null)
    .sort((left, right) => {
      const sortOrder = Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0);
      if (sortOrder !== 0) return sortOrder;
      return String(left.item_key ?? '').localeCompare(String(right.item_key ?? ''), 'en-US');
    });

  const snapshotsByItem = new Map();
  for (const snapshot of sortSnapshotsDesc(snapshots)) {
    const itemKey = String(snapshot?.item_key ?? '').trim();
    if (!itemKey || snapshotsByItem.has(itemKey)) continue;
    snapshotsByItem.set(itemKey, snapshot);
  }

  const adjustmentsByItem = new Map();
  for (const adjustment of adjustments) {
    const itemKey = String(adjustment?.item_key ?? '').trim();
    if (!itemKey) continue;
    const rows = adjustmentsByItem.get(itemKey) ?? [];
    rows.push(adjustment);
    adjustmentsByItem.set(itemKey, rows);
  }

  return activeItems.map((item) => {
    const itemKey = String(item.item_key ?? '').trim();
    const latestSnapshot = snapshotsByItem.get(itemKey) ?? null;
    const itemAdjustments = adjustmentsByItem.get(itemKey) ?? [];
    const totalAdjustmentQty = itemAdjustments.reduce((sum, adjustment) => sum + (toFiniteNumber(adjustment.delta_qty) ?? 0), 0);
    const latestSnapshotCutoffMs =
      latestSnapshot == null
        ? null
        : toEpochMs(latestSnapshot.created_at) ?? toEpochMs(`${latestSnapshot.snapshot_date}T00:00:00Z`);
    const postSnapshotAdjustmentQty =
      latestSnapshotCutoffMs == null
        ? 0
        : itemAdjustments.reduce((sum, adjustment) => {
            const adjustmentMs = toEpochMs(adjustment.effective_at);
            if (adjustmentMs == null || adjustmentMs <= latestSnapshotCutoffMs) return sum;
            return sum + (toFiniteNumber(adjustment.delta_qty) ?? 0);
          }, 0);
    const adjustmentQty = latestSnapshot == null ? totalAdjustmentQty : postSnapshotAdjustmentQty;
    const latestSnapshotQty = toFiniteNumber(latestSnapshot?.remaining_qty);
    const currentQty = Math.max(0, roundTo((latestSnapshotQty ?? 0) + Math.max(0, Number(adjustmentQty) || 0), 2));

    return {
      item_key: itemKey,
      item_label: String(item.item_label ?? itemKey),
      remaining_qty: currentQty,
      latest_snapshot_date: latestSnapshot?.snapshot_date ?? null,
      latest_snapshot_qty: latestSnapshotQty,
      applied_adjustment_qty: roundTo(Math.max(0, Number(adjustmentQty) || 0), 2)
    };
  });
};

const createSupabaseClient = () => {
  const supabaseUrl = getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 0 } }
  });
};

const fetchAll = async (supabase, table, selectColumns, orderColumn = 'id') => {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const res = await supabase.from(table).select(selectColumns).order(orderColumn, { ascending: true }).range(from, to);
    if (res.error) throw new Error(`Load ${table} failed: ${res.error.message}`);
    const page = res.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
};

const chunk = (rows, size) => {
  const out = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
};

const deleteAllById = async (supabase, table) => {
  const res = await supabase.from(table).delete().not('id', 'is', null);
  if (res.error) throw new Error(`Clear ${table} failed: ${res.error.message}`);
};

const insertRows = async (supabase, table, rows) => {
  if (!rows.length) return;
  for (const batch of chunk(rows, 500)) {
    const res = await supabase.from(table).insert(batch);
    if (res.error) throw new Error(`Insert ${table} failed: ${res.error.message}`);
  }
};

const restoreBackup = async ({ supabase, backup }) => {
  await deleteAllById(supabase, 'ob_consumable_alerts');
  await deleteAllById(supabase, 'ob_consumable_adjustments');
  await deleteAllById(supabase, 'ob_consumable_snapshots');
  await insertRows(supabase, 'ob_consumable_snapshots', backup.snapshots);
  await insertRows(supabase, 'ob_consumable_adjustments', backup.adjustments);
  await insertRows(supabase, 'ob_consumable_alerts', backup.alerts);
};

const writeBackupFile = ({ backupDir, backup }) => {
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `consumables-reset-backup-${backup.created_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');
  return backupPath;
};

const main = async () => {
  const write = getEnv('WRITE') === '1';
  const confirm = getEnv('CONFIRM_CONSUMABLE_RESET') === RESET_CONFIRMATION;
  const snapshotDate = getEnv('SNAPSHOT_DATE') || todayInTimeZone('America/New_York');
  const operator = getEnv('OPERATOR', 'script:reset-consumable-inventory');
  const clearAlerts = getEnv('CLEAR_CONSUMABLE_ALERTS', '1') !== '0';
  const backupDir = path.resolve(process.cwd(), getEnv('BACKUP_DIR', 'backups'));
  assertDateOnly(snapshotDate, 'SNAPSHOT_DATE');

  const supabase = createSupabaseClient();
  const [items, snapshots, adjustments, alerts] = await Promise.all([
    fetchAll(
      supabase,
      'ob_consumable_items',
      'item_key,item_label,warning_days,critical_days,sort_order,is_active,is_custom,deleted_at,created_at,updated_at',
      'item_key'
    ),
    fetchAll(
      supabase,
      'ob_consumable_snapshots',
      'id,snapshot_date,item_key,remaining_qty,note,created_by_user_id,created_by_display,created_at,updated_at',
      'snapshot_date'
    ),
    fetchAll(
      supabase,
      'ob_consumable_adjustments',
      'id,item_key,effective_at,delta_qty,reason,note,created_by_user_id,created_by_display,created_at,updated_at',
      'effective_at'
    ),
    fetchAll(
      supabase,
      'ob_consumable_alerts',
      'id,alert_date,item_key,alert_type,severity,details_json,status,todo_template_id,todo_item_id,created_at,updated_at',
      'alert_date'
    )
  ]);

  const currentRows = computeCurrentConsumableRows({ items, snapshots, adjustments });
  if (!currentRows.length) {
    throw new Error('No active consumable items found. Reset aborted.');
  }

  console.log(`Snapshot date: ${snapshotDate}`);
  console.log(`Active items: ${currentRows.length}`);
  console.log(`Existing snapshots: ${snapshots.length}`);
  console.log(`Existing adjustments: ${adjustments.length}`);
  console.log(`Existing alerts: ${alerts.length}`);
  console.table(
    currentRows.map((row) => ({
      item_key: row.item_key,
      remaining_qty: row.remaining_qty,
      latest_snapshot_date: row.latest_snapshot_date ?? '-',
      applied_adjustment_qty: row.applied_adjustment_qty
    }))
  );

  if (!write) {
    console.log('Dry-run only. Set WRITE=1 and CONFIRM_CONSUMABLE_RESET=RESET_CONSUMABLE_INVENTORY to apply.');
    return;
  }
  if (!confirm) {
    throw new Error(`WRITE=1 requires CONFIRM_CONSUMABLE_RESET=${RESET_CONFIRMATION}.`);
  }

  const nowIso = new Date().toISOString();
  const backup = {
    created_at: nowIso,
    snapshot_date: snapshotDate,
    operator,
    clear_alerts: clearAlerts,
    items,
    snapshots,
    adjustments,
    alerts,
    reset_rows: currentRows
  };
  const backupPath = writeBackupFile({ backupDir, backup });
  console.log(`Backup written: ${backupPath}`);

  const newSnapshots = currentRows.map((row) => ({
    snapshot_date: snapshotDate,
    item_key: row.item_key,
    remaining_qty: row.remaining_qty,
    note: `Initial inventory reset from current book quantity. Backup: ${path.basename(backupPath)}`,
    created_by_user_id: null,
    created_by_display: operator,
    created_at: nowIso,
    updated_at: nowIso
  }));

  try {
    if (clearAlerts) await deleteAllById(supabase, 'ob_consumable_alerts');
    await deleteAllById(supabase, 'ob_consumable_adjustments');
    await deleteAllById(supabase, 'ob_consumable_snapshots');
    await insertRows(supabase, 'ob_consumable_snapshots', newSnapshots);
  } catch (error) {
    console.error('Reset failed after writes started. Attempting to restore backup...');
    try {
      await restoreBackup({ supabase, backup });
      console.error('Backup restored.');
    } catch (restoreError) {
      console.error('Backup restore failed. Use the backup file for manual recovery:', backupPath);
      console.error(restoreError);
    }
    throw error;
  }

  const [afterSnapshots, afterAdjustments, afterAlerts] = await Promise.all([
    fetchAll(supabase, 'ob_consumable_snapshots', 'id,snapshot_date,item_key,remaining_qty', 'item_key'),
    fetchAll(supabase, 'ob_consumable_adjustments', 'id,item_key', 'id'),
    fetchAll(supabase, 'ob_consumable_alerts', 'id,item_key', 'id')
  ]);
  const expectedKeys = new Set(currentRows.map((row) => row.item_key));
  const actualKeys = new Set(afterSnapshots.filter((row) => row.snapshot_date === snapshotDate).map((row) => row.item_key));
  const missingKeys = [...expectedKeys].filter((key) => !actualKeys.has(key));

  if (afterSnapshots.length !== currentRows.length || afterAdjustments.length !== 0 || missingKeys.length > 0) {
    throw new Error(
      `Verification failed. snapshots=${afterSnapshots.length}, adjustments=${afterAdjustments.length}, missing=${missingKeys.join(', ')}`
    );
  }
  if (clearAlerts && afterAlerts.length !== 0) {
    throw new Error(`Verification failed. alerts=${afterAlerts.length}`);
  }

  console.log(`Done. Reset ${currentRows.length} consumable items as the first snapshot for ${snapshotDate}.`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
