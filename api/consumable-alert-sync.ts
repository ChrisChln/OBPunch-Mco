import { createServiceSupabase, ensureCron, isDateOnly } from './_forecastShared.js';
import { buildTodoDueAtForInstance } from '../src/admin/todoShared.js';
import {
  CONSUMABLE_ITEM_DEFINITIONS,
  CONSUMABLE_ITEMS_BY_KEY,
  buildConsumableIntervals,
  classifyConsumableAlert,
  computeConsumableProjection,
  isConsumableSnapshotDay,
  type ConsumableAdjustment,
  type ConsumableSnapshot
} from '../src/shared/consumables';
import { getDefaultModuleAccess, type AdminRole } from '../src/shared/adminAccess.js';

const USER_PROFILE_TABLE = (process.env.VITE_USER_PROFILE_TABLE as string | undefined) ?? 'ob_user_profiles';
const REMINDER_TITLE = 'Consumable Snapshot';
const ALERT_TEMPLATE_PREFIX = 'Consumable Alert';
const TARGET_LOCAL_HOUR = 12;
const TARGET_LOCAL_MINUTE = 15;
const WINDOW_MINUTES = 20;

type OperatorProfile = {
  user_id: string;
  user_email: string;
  display_name: string;
};

type ConsumableAlertRecord = {
  id: string;
  alert_date: string;
  item_key: string | null;
  alert_type: string;
  severity: string;
  status: string | null;
  details_json: Record<string, unknown> | null;
  todo_template_id?: string | null;
  todo_item_id?: string | null;
};

const getNowInTimezoneParts = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateOnly: `${byType.year}-${byType.month}-${byType.day}`,
    hour: Number(byType.hour ?? '0'),
    minute: Number(byType.minute ?? '0')
  };
};

const isWithinWindow = (currentMinutes: number, targetMinutes: number, toleranceMinutes: number) =>
  Math.abs(currentMinutes - targetMinutes) <= toleranceMinutes;

const buildBaseUrl = (req: any) => {
  const explicit = String(process.env.APP_BASE_URL ?? '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = String(req.headers?.['x-forwarded-host'] ?? req.headers?.host ?? '').trim();
  if (!host) return '';
  const proto = String(req.headers?.['x-forwarded-proto'] ?? 'https').trim() || 'https';
  return `${proto}://${host}`.replace(/\/+$/, '');
};

const buildPageUrl = (baseUrl: string) => `${baseUrl || ''}/admin.html#consumables`;

const buildLocalDueAt = (instanceDate: string, hour: number, minute: number) => {
  const targetUtc = Date.UTC(
    Number(instanceDate.slice(0, 4)),
    Number(instanceDate.slice(5, 7)) - 1,
    Number(instanceDate.slice(8, 10)),
    hour,
    minute,
    0
  );
  let guess = new Date(targetUtc);
  const getLocalParts = (value: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(value);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(byType.year ?? '0'),
      month: Number(byType.month ?? '0'),
      day: Number(byType.day ?? '0'),
      hour: Number(byType.hour ?? '0'),
      minute: Number(byType.minute ?? '0'),
      second: Number(byType.second ?? '0')
    };
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getLocalParts(guess);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const diffMs = targetUtc - actualUtc;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }
  return guess.toISOString();
};

const loadConsumableOperators = async (supabase: any): Promise<OperatorProfile[]> => {
  const accountsRes = await supabase.from('ob_admin_accounts').select('user_id, role, is_active').eq('is_active', true);
  if (accountsRes.error) throw accountsRes.error;
  const accounts = ((accountsRes.data ?? []) as Array<{ user_id?: string | null; role?: string | null }>).filter((row) => row.user_id);
  if (!accounts.length) return [];

  const userIds = accounts.map((row) => String(row.user_id));
  const modulesRes = await supabase
    .from('ob_admin_account_modules')
    .select('user_id, module_key, access_level')
    .in('user_id', userIds)
    .eq('module_key', 'consumables');
  if (modulesRes.error) throw modulesRes.error;

  const profilesRes = await supabase
    .from(USER_PROFILE_TABLE)
    .select('user_id, user_email, display_name')
    .in('user_id', userIds);
  if (profilesRes.error) throw profilesRes.error;

  const moduleMap = new Map(
    ((modulesRes.data ?? []) as Array<{ user_id?: string | null; access_level?: string | null }>).map((row) => [
      String(row.user_id ?? ''),
      String(row.access_level ?? '')
    ])
  );
  const profileMap = new Map(
    ((profilesRes.data ?? []) as Array<{ user_id?: string | null; user_email?: string | null; display_name?: string | null }>).map((row) => [
      String(row.user_id ?? ''),
      {
        user_id: String(row.user_id ?? ''),
        user_email: String(row.user_email ?? '').trim(),
        display_name: String(row.display_name ?? '').trim()
      }
    ])
  );

  return accounts
    .filter((row) => {
      const role = String(row.role ?? 'level3') as AdminRole;
      const accessLevel = moduleMap.get(String(row.user_id)) || getDefaultModuleAccess(role, 'consumables');
      return accessLevel === 'operate';
    })
    .map((row) => profileMap.get(String(row.user_id)))
    .filter((row): row is OperatorProfile => Boolean(row?.user_id));
};

const ensureReminderTemplate = async (supabase: any, operators: OperatorProfile[], pageUrl: string, today: string) => {
  if (!operators.length) return null;
  const creator = operators[0];
  const assignees = operators.map((operator) => ({
    user_id: operator.user_id,
    user_email: operator.user_email,
    display_name: operator.display_name
  }));
  const links = [{ label: 'Open Consumables', url: pageUrl, sort_order: 0 }];
  const anchorDate = isConsumableSnapshotDay(today)
    ? today
    : (() => {
        let cursor = today;
        for (let index = 0; index < 7; index += 1) {
          if (isConsumableSnapshotDay(cursor)) return cursor;
          const date = new Date(`${cursor}T00:00:00Z`);
          date.setUTCDate(date.getUTCDate() - 1);
          cursor = date.toISOString().slice(0, 10);
        }
        return today;
      })();
  const dueAt = buildLocalDueAt(anchorDate, 12, 15);

  const existingRes = await supabase
    .from('ob_todo_templates')
    .select('id, due_at')
    .eq('title', REMINDER_TITLE)
    .eq('recurrence_kind', 'weekly')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingRes.error) throw existingRes.error;

  let templateId = String(existingRes.data?.id ?? '');
  if (templateId) {
    const updateRes = await supabase
      .from('ob_todo_templates')
      .update({
        creator_user_id: creator.user_id,
        creator_email: creator.user_email,
        creator_display_name: creator.display_name,
        delivery_mode: 'shared',
        content: 'Submit remaining quantities on Monday and Thursday.',
        due_at: dueAt,
        anchor_instance_date: anchorDate,
        recurrence_rule: { weekdays: [1, 4] },
        assignees,
        links,
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', templateId);
    if (updateRes.error) throw updateRes.error;
  } else {
    const insertRes = await supabase
      .from('ob_todo_templates')
      .insert({
        creator_user_id: creator.user_id,
        creator_email: creator.user_email,
        creator_display_name: creator.display_name,
        delivery_mode: 'shared',
        title: REMINDER_TITLE,
        content: 'Submit remaining quantities on Monday and Thursday.',
        due_at: dueAt,
        anchor_instance_date: anchorDate,
        recurrence_kind: 'weekly',
        recurrence_rule: { weekdays: [1, 4] },
        assignees,
        links,
        is_active: true
      })
      .select('id')
      .single();
    if (insertRes.error) throw insertRes.error;
    templateId = String(insertRes.data?.id ?? '');
  }

  if (isConsumableSnapshotDay(today) && templateId) {
    const existingItemRes = await supabase
      .from('ob_todo_items')
      .select('id')
      .eq('template_id', templateId)
      .eq('delivery_key', 'shared')
      .eq('instance_date', today)
      .maybeSingle();
    if (existingItemRes.error) throw existingItemRes.error;

    if (!existingItemRes.data?.id) {
      const itemInsertRes = await supabase
        .from('ob_todo_items')
        .insert({
          template_id: templateId,
          series_key: templateId,
          delivery_key: 'shared',
          instance_date: today,
          delivery_mode: 'shared',
          title: REMINDER_TITLE,
          content: 'Submit remaining quantities on Monday and Thursday.',
          due_at: buildTodoDueAtForInstance(dueAt, today),
          creator_user_id: creator.user_id,
          creator_email: creator.user_email,
          creator_display_name: creator.display_name,
          status: 'open'
        })
        .select('id')
        .single();
      if (itemInsertRes.error) throw itemInsertRes.error;
      const itemId = String(itemInsertRes.data?.id ?? '');
      if (itemId) {
        const assigneeRes = await supabase.from('ob_todo_item_assignees').insert(
          operators.map((operator) => ({
            item_id: itemId,
            assignee_user_id: operator.user_id,
            assignee_email: operator.user_email,
            assignee_display_name: operator.display_name
          }))
        );
        if (assigneeRes.error) throw assigneeRes.error;
        const linkRes = await supabase.from('ob_todo_item_links').insert({
          item_id: itemId,
          label: 'Open Consumables',
          url: pageUrl,
          sort_order: 0
        });
        if (linkRes.error) throw linkRes.error;
        await supabase.from('ob_todo_events').insert({
          item_id: itemId,
          template_id: templateId,
          actor_display: creator.display_name || creator.user_email || creator.user_id,
          event_type: 'todo_generated',
          payload: { instance_date: today, source: 'consumable-alert-sync' }
        });
      }
    }
  }

  return templateId;
};

const loadConsumableDataset = async (supabase: any, today: string) => {
  const historyStart = new Date(`${today}T00:00:00Z`);
  historyStart.setUTCDate(historyStart.getUTCDate() - 90);
  const averageStart = new Date(`${today}T00:00:00Z`);
  averageStart.setUTCDate(averageStart.getUTCDate() - 27);
  const start90 = historyStart.toISOString().slice(0, 10);
  const start28 = averageStart.toISOString().slice(0, 10);

  const [itemsRes, snapshotsRes, adjustmentsRes, packageRes, alertsRes] = await Promise.all([
    supabase.from('ob_consumable_items').select('item_key, item_label, warning_days, critical_days').eq('is_active', true),
    supabase
      .from('ob_consumable_snapshots')
      .select('item_key, snapshot_date, remaining_qty')
      .gte('snapshot_date', start90)
      .lte('snapshot_date', today)
      .order('snapshot_date', { ascending: true }),
    supabase
      .from('ob_consumable_adjustments')
      .select('item_key, effective_at, delta_qty')
      .gte('effective_at', `${start90}T00:00:00Z`)
      .lte('effective_at', `${today}T23:59:59Z`)
      .order('effective_at', { ascending: true }),
    supabase
      .from('ob_package_daily_metrics')
      .select('metric_date, calendar_inbound_order_count')
      .gte('metric_date', start28)
      .lte('metric_date', today)
      .order('metric_date', { ascending: true }),
    supabase
      .from('ob_consumable_alerts')
      .select('id, alert_date, item_key, alert_type, severity, status, details_json, todo_template_id, todo_item_id')
      .eq('alert_date', today)
  ]);

  for (const result of [itemsRes, snapshotsRes, adjustmentsRes, packageRes, alertsRes]) {
    if (result.error) throw result.error;
  }

  return {
    items: (itemsRes.data ?? []) as Array<{ item_key: ConsumableItemKey; item_label?: string | null; warning_days?: number | null; critical_days?: number | null }>,
    snapshots: (snapshotsRes.data ?? []) as ConsumableSnapshot[],
    adjustments: (adjustmentsRes.data ?? []) as ConsumableAdjustment[],
    inboundOrdersByDate: Object.fromEntries(
      ((packageRes.data ?? []) as Array<{ metric_date?: string | null; calendar_inbound_order_count?: number | null }>)
        .filter((row) => row.metric_date)
        .map((row) => [String(row.metric_date), Number(row.calendar_inbound_order_count ?? 0)])
    ),
    alertsToday: (alertsRes.data ?? []) as ConsumableAlertRecord[]
  };
};

const upsertAlert = async (
  supabase: any,
  input: {
    alertDate: string;
    itemKey: string | null;
    alertType: string;
    severity: string;
    details: Record<string, unknown>;
  }
) => {
  if (!input.itemKey) {
    const existingRes = await supabase
      .from('ob_consumable_alerts')
      .select('id, alert_date, item_key, alert_type, severity, status, details_json, todo_template_id, todo_item_id')
      .eq('alert_date', input.alertDate)
      .eq('alert_type', input.alertType)
      .is('item_key', null)
      .maybeSingle();
    if (existingRes.error) throw existingRes.error;

    if (existingRes.data?.id) {
      const updateRes = await supabase
        .from('ob_consumable_alerts')
        .update({
          severity: input.severity,
          details_json: input.details,
          status: 'open',
          updated_at: new Date().toISOString()
        })
        .eq('id', existingRes.data.id)
        .select('id, alert_date, item_key, alert_type, severity, status, details_json, todo_template_id, todo_item_id')
        .single();
      if (updateRes.error) throw updateRes.error;
      return updateRes.data as ConsumableAlertRecord;
    }

    const insertRes = await supabase
      .from('ob_consumable_alerts')
      .insert({
        alert_date: input.alertDate,
        item_key: null,
        alert_type: input.alertType,
        severity: input.severity,
        details_json: input.details,
        status: 'open'
      })
      .select('id, alert_date, item_key, alert_type, severity, status, details_json, todo_template_id, todo_item_id')
      .single();
    if (insertRes.error) throw insertRes.error;
    return insertRes.data as ConsumableAlertRecord;
  }

  const res = await supabase
    .from('ob_consumable_alerts')
    .upsert(
      {
        alert_date: input.alertDate,
        item_key: input.itemKey,
        alert_type: input.alertType,
        severity: input.severity,
        details_json: input.details,
        status: 'open',
        updated_at: new Date().toISOString()
      },
      { onConflict: 'alert_date,item_key,alert_type' }
    )
    .select('id, alert_date, item_key, alert_type, severity, status, details_json, todo_template_id, todo_item_id')
    .single();
  if (res.error) throw res.error;
  return res.data as ConsumableAlertRecord;
};

const ensureAlertTodo = async (
  supabase: any,
  alert: ConsumableAlertRecord,
  operators: OperatorProfile[],
  pageUrl: string
) => {
  if (!operators.length) return;
  if (alert.alert_type === 'missing_snapshot') return;
  if (alert.todo_item_id) return;
  const creator = operators[0];
  const itemLabel = alert.item_key ? CONSUMABLE_ITEMS_BY_KEY[alert.item_key as ConsumableItemKey]?.label ?? alert.item_key : 'Consumables';
  const title = `${ALERT_TEMPLATE_PREFIX}: ${itemLabel}`;
  const content =
    alert.alert_type === 'low_stock_critical'
      ? `${itemLabel} is critically low. Review the consumables workspace now.`
      : `${itemLabel} is approaching low stock. Review the consumables workspace.`;
  const templateInsertRes = await supabase
    .from('ob_todo_templates')
    .insert({
      creator_user_id: creator.user_id,
      creator_email: creator.user_email,
      creator_display_name: creator.display_name,
      delivery_mode: 'shared',
      title,
      content,
      due_at: buildLocalDueAt(alert.alert_date, 12, 15),
      anchor_instance_date: alert.alert_date,
      recurrence_kind: 'none',
      recurrence_rule: {},
      assignees: operators.map((operator) => ({
        user_id: operator.user_id,
        user_email: operator.user_email,
        display_name: operator.display_name
      })),
      links: [{ label: 'Open Consumables', url: pageUrl, sort_order: 0 }],
      is_active: true
    })
    .select('id')
    .single();
  if (templateInsertRes.error) throw templateInsertRes.error;
  const templateId = String(templateInsertRes.data?.id ?? '');

  const itemInsertRes = await supabase
    .from('ob_todo_items')
    .insert({
      template_id: templateId,
      series_key: templateId,
      delivery_key: 'shared',
      instance_date: alert.alert_date,
      delivery_mode: 'shared',
      title,
      content,
      due_at: buildTodoDueAtForInstance(buildLocalDueAt(alert.alert_date, 12, 15), alert.alert_date),
      creator_user_id: creator.user_id,
      creator_email: creator.user_email,
      creator_display_name: creator.display_name,
      status: 'open'
    })
    .select('id')
    .single();
  if (itemInsertRes.error) throw itemInsertRes.error;
  const itemId = String(itemInsertRes.data?.id ?? '');

  const assigneeRes = await supabase.from('ob_todo_item_assignees').insert(
    operators.map((operator) => ({
      item_id: itemId,
      assignee_user_id: operator.user_id,
      assignee_email: operator.user_email,
      assignee_display_name: operator.display_name
    }))
  );
  if (assigneeRes.error) throw assigneeRes.error;

  const linkRes = await supabase.from('ob_todo_item_links').insert({
    item_id: itemId,
    label: 'Open Consumables',
    url: pageUrl,
    sort_order: 0
  });
  if (linkRes.error) throw linkRes.error;

  await supabase.from('ob_todo_events').insert({
    item_id: itemId,
    template_id: templateId,
    actor_display: creator.display_name || creator.user_email || creator.user_id,
    event_type: 'todo_generated',
    payload: { alert_id: alert.id, source: 'consumable-alert-sync' }
  });

  const updateAlertRes = await supabase
    .from('ob_consumable_alerts')
    .update({
      todo_template_id: templateId,
      todo_item_id: itemId,
      updated_at: new Date().toISOString()
    })
    .eq('id', alert.id);
  if (updateAlertRes.error) throw updateAlertRes.error;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!ensureCron(req, res)) return;

  const supabase = createServiceSupabase();
  if (!supabase) {
    res.status(500).json({ error: 'Missing Supabase server configuration' });
    return;
  }

  try {
    const nowLocal = getNowInTimezoneParts('America/New_York');
    const currentMinutes = nowLocal.hour * 60 + nowLocal.minute;
    const targetMinutes = TARGET_LOCAL_HOUR * 60 + TARGET_LOCAL_MINUTE;
    const today = isDateOnly(req.query?.target_date) ? String(req.query.target_date) : nowLocal.dateOnly;

    if (!req.query?.target_date && !isWithinWindow(currentMinutes, targetMinutes, WINDOW_MINUTES)) {
      res.status(200).json({
        status: 'skipped',
        reason: 'outside_run_window',
        now_local: `${nowLocal.dateOnly} ${String(nowLocal.hour).padStart(2, '0')}:${String(nowLocal.minute).padStart(2, '0')}`,
        target_local: '12:15',
        timezone: 'America/New_York'
      });
      return;
    }

    const pageUrl = buildPageUrl(buildBaseUrl(req));
    const operators = await loadConsumableOperators(supabase);
    const reminderTemplateId = await ensureReminderTemplate(supabase, operators, pageUrl, today);
    const dataset = await loadConsumableDataset(supabase, today);

    const alertsCreated: ConsumableAlertRecord[] = [];

    if (isConsumableSnapshotDay(today)) {
      const hasSnapshotToday = dataset.snapshots.some((row) => row.snapshot_date === today);
      if (!hasSnapshotToday) {
        alertsCreated.push(
          await upsertAlert(supabase, {
            alertDate: today,
            itemKey: null,
            alertType: 'missing_snapshot',
            severity: 'warning',
            details: { snapshot_date: today, page_url: pageUrl }
          })
        );
      }
    }

    for (const item of dataset.items.length ? dataset.items : CONSUMABLE_ITEM_DEFINITIONS) {
      const itemKey = item.item_key as ConsumableItemKey;
      const latestSnapshot = [...dataset.snapshots]
        .filter((row) => row.item_key === itemKey)
        .sort((left, right) => right.snapshot_date.localeCompare(left.snapshot_date, 'en-US'))[0];
      if (!latestSnapshot) continue;

      const intervals = buildConsumableIntervals({
        itemKey,
        snapshots: dataset.snapshots.filter((row) => row.item_key === itemKey),
        adjustments: dataset.adjustments.filter((row) => row.item_key === itemKey),
        inboundOrdersByDate: dataset.inboundOrdersByDate
      });
      const projection = computeConsumableProjection({
        latestRemainingQty: latestSnapshot.remaining_qty,
        intervals,
        inboundOrdersByDate: dataset.inboundOrdersByDate
      });
      const classification = classifyConsumableAlert({
        latestRemainingQty: latestSnapshot.remaining_qty,
        estimatedDaysLeft: projection.estimatedDaysLeft,
        warningDays: Number(item.warning_days ?? 7),
        criticalDays: Number(item.critical_days ?? 3)
      });
      if (!classification.alertType || !classification.severity) continue;

      alertsCreated.push(
        await upsertAlert(supabase, {
          alertDate: today,
          itemKey,
          alertType: classification.alertType,
          severity: classification.severity,
          details: {
            item_label: (item as any).item_label ?? CONSUMABLE_ITEMS_BY_KEY[itemKey]?.label ?? itemKey,
            latest_remaining_qty: latestSnapshot.remaining_qty,
            estimated_days_left: projection.estimatedDaysLeft,
            avg_daily_usage: projection.avgDailyUsage,
            usage_per_order: projection.usagePerOrder,
            last_snapshot_date: latestSnapshot.snapshot_date,
            page_url: pageUrl
          }
        })
      );
    }

    for (const alert of alertsCreated) {
      await ensureAlertTodo(supabase, alert, operators, pageUrl);
    }

    res.status(200).json({
      status: 'ok',
      alert_count: alertsCreated.length,
      operator_count: operators.length,
      reminder_template_id: reminderTemplateId,
      target_date: today
    });
  } catch (error: any) {
    res.status(500).json({ error: String(error?.message ?? error ?? 'Consumable alert sync failed.') });
  }
}
