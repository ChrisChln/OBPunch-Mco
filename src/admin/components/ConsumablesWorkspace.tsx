import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, Boxes, CalendarDays, Edit2, PackagePlus, Plus, RefreshCcw, Save, Trash2, Undo2, X } from 'lucide-react';
import AdminNoticeToast from './AdminNoticeToast';
import {
  CONSUMABLE_GROUP_DEFINITIONS,
  CONSUMABLE_ITEMS_BY_KEY,
  buildConsumableIntervals,
  classifyConsumableAlert,
  computeConsumableCurrentRemaining,
  computeConsumableProjection,
  formatDaysLeft,
  groupConsumableRows,
  normalizeConsumableGroupKey,
  type ConsumableAdjustment,
  type ConsumableDashboardItem,
  type ConsumableGroupKey,
  type ConsumableItemKey,
  type ConsumableSnapshot
} from '../../shared/consumables';

type TranslateFn = (zh: string, en: string) => string;

type ConsumablesWorkspaceProps = {
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  isLocked: boolean;
  canView: boolean;
  canOperate: boolean;
  canManageItems?: boolean;
  supabase: any;
  serverTime: Date;
  onStatus?: (status: StatusState) => void;
  flush?: boolean;
};

type DashboardItemRow = {
  item_key: ConsumableItemKey;
  item_label?: string | null;
  group_key?: string | null;
  warning_days?: number | null;
  critical_days?: number | null;
  sort_order?: number | null;
  is_active?: boolean | null;
  is_custom?: boolean | null;
};

type DashboardSnapshotRow = {
  item_key: ConsumableItemKey;
  snapshot_date: string;
  remaining_qty: number;
  note?: string | null;
  created_at?: string | null;
  created_by_display?: string | null;
};

type DashboardAdjustmentRow = {
  id?: string;
  item_key: ConsumableItemKey;
  effective_at: string;
  delta_qty: number;
  reason: string;
  note?: string | null;
  created_at?: string | null;
  created_by_user_id?: string | null;
  created_by_display?: string | null;
};

type DashboardAlertRow = {
  id?: string;
  alert_date: string;
  item_key?: ConsumableItemKey | null;
  alert_type: string;
  severity: string;
  status?: string | null;
  details_json?: Record<string, unknown> | null;
};

type DashboardPayload = {
  items?: DashboardItemRow[];
  snapshots?: DashboardSnapshotRow[];
  adjustments?: DashboardAdjustmentRow[];
  alerts?: DashboardAlertRow[];
  inbound_orders_by_date?: Record<string, number>;
};

type StatusState = {
  tone: 'idle' | 'success' | 'error';
  message: string;
};

type SnapshotDraft = Record<ConsumableItemKey, string>;

type AdjustmentForm = {
  itemKey: ConsumableItemKey;
  deltaQty: string;
};

type ItemForm = {
  itemKey: string;
  itemLabel: string;
  groupKey: ConsumableGroupKey;
  warningDays: string;
  criticalDays: string;
  sortOrder: string;
};

const HISTORY_LOOKBACK_DAYS = 42;

const getDateOnlyInTimeZone = (value: Date, timeZone = 'America/New_York') =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);

const addDaysDateOnly = (dateOnly: string, amount: number) => {
  const next = new Date(`${dateOnly}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
};

const getDateRangeForSnapshot = (today: string, snapshotDate: string) => {
  const rangeEnd = snapshotDate > today ? snapshotDate : today;
  const defaultRangeStart = addDaysDateOnly(rangeEnd, -HISTORY_LOOKBACK_DAYS);
  const rangeStart = snapshotDate < defaultRangeStart ? snapshotDate : defaultRangeStart;
  return { rangeStart, rangeEnd };
};

const formatNumber = (value: number | null, digits = 0) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return digits > 0 ? value.toFixed(digits) : Math.round(value).toLocaleString('en-US');
};

const formatLogDateTime = (value: string | null | undefined) => {
  if (!value) return '--/-- --:--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--/-- --:--';
  return parsed.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(',', '');
};

const toEpochMs = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildEmptySnapshotDraft = (items: Array<{ item_key: ConsumableItemKey }> = []) =>
  Object.fromEntries(items.map((item) => [item.item_key, ''])) as SnapshotDraft;

const buildInitialAdjustmentForm = (itemKey = ''): AdjustmentForm => ({
  itemKey,
  deltaQty: ''
});

const buildInitialItemForm = (nextSortOrder = 10): ItemForm => ({
  itemKey: '',
  itemLabel: '',
  groupKey: 'uncategorized',
  warningDays: '7',
  criticalDays: '3',
  sortOrder: String(nextSortOrder)
});

const mergeSnapshotRows = (
  currentRows: DashboardSnapshotRow[] | undefined,
  nextRows: DashboardSnapshotRow[]
): DashboardSnapshotRow[] => {
  const byKey = new Map<string, DashboardSnapshotRow>();
  for (const row of currentRows ?? []) {
    if (!row.item_key || !row.snapshot_date) continue;
    byKey.set(`${row.snapshot_date}::${row.item_key}`, row);
  }
  for (const row of nextRows) {
    if (!row.item_key || !row.snapshot_date) continue;
    byKey.set(`${row.snapshot_date}::${row.item_key}`, row);
  }
  return Array.from(byKey.values()).sort((left, right) => {
    const dateOrder = right.snapshot_date.localeCompare(left.snapshot_date, 'en-US');
    return dateOrder || left.item_key.localeCompare(right.item_key, 'en-US');
  });
};

export default function ConsumablesWorkspace({
  t,
  themeMode,
  isLocked,
  canView,
  canOperate,
  canManageItems = false,
  supabase,
  serverTime,
  onStatus,
  flush = false
}: ConsumablesWorkspaceProps) {
  const isLight = themeMode === 'light';
  const today = getDateOnlyInTimeZone(serverTime);
  const snapshotDate = today;
  const [dashboard, setDashboard] = useState<DashboardPayload>({});
  const [loading, setLoading] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [undoingAdjustmentId, setUndoingAdjustmentId] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [status, setStatus] = useState<StatusState>({ tone: 'idle', message: '' });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [snapshotDraft, setSnapshotDraft] = useState<SnapshotDraft>(buildEmptySnapshotDraft);
  const [snapshotDraftDirty, setSnapshotDraftDirty] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentForm>(buildInitialAdjustmentForm);
  const [itemManagerOpen, setItemManagerOpen] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm>(buildInitialItemForm);
  const [snapshotDetailDate, setSnapshotDetailDate] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const shellClass =
    flush
      ? ''
      : themeMode === 'light'
      ? 'border border-slate-200 bg-white/90 shadow-[0_24px_60px_rgba(15,23,42,0.08)]'
      : 'border border-slate-800/80 bg-slate-950/72 shadow-[0_24px_60px_rgba(2,6,23,0.32)]';
  const mutedClass = themeMode === 'light' ? 'text-slate-500' : 'text-slate-400';
  const inputClass =
    themeMode === 'light'
      ? 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
      : 'border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-500';
  const surfaceClass =
    themeMode === 'light'
      ? 'border border-slate-200 bg-slate-50/90'
      : 'border border-slate-800 bg-slate-900/70';
  const actionButtonClass =
    'admin-btn admin-btn-toolbar inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60';
  const buttonPrimaryClass = `${actionButtonClass} admin-btn-primary`;
  const buttonSecondaryClass = `${actionButtonClass} admin-btn-secondary`;
  const publishStatus = (nextStatus: StatusState) => {
    setStatus(nextStatus);
    onStatus?.(nextStatus);
  };

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void supabase.auth?.getUser?.().then((res: any) => {
      if (!cancelled) setCurrentUserId(String(res?.data?.user?.id ?? '') || null);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!canView || !supabase) return;
    let cancelled = false;

    const loadDashboard = async () => {
      setLoading(true);
      try {
        const { rangeStart, rangeEnd } = getDateRangeForSnapshot(today, snapshotDate);
        const rpcRes = await supabase.rpc('list_consumable_dashboard', {
          p_metric_date: snapshotDate,
          p_range_start: rangeStart,
          p_range_end: rangeEnd
        });
        if (rpcRes.error) {
          throw new Error(String(rpcRes.error.message ?? 'Failed to load consumables.'));
        }
        if (cancelled) return;
        setDashboard((rpcRes.data ?? {}) as DashboardPayload);
      } catch (error: any) {
        if (cancelled) return;
        setDashboard({});
        publishStatus({
          tone: 'error',
          message: String(error?.message ?? error ?? t('耗材数据加载失败。', 'Failed to load consumables.'))
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [canView, reloadKey, snapshotDate, supabase, t, today]);

  const items = useMemo(() => {
    const fromApi = Array.isArray(dashboard.items) ? dashboard.items : [];
    return fromApi
      .filter((item) => item.item_key && item.is_active !== false)
      .map((item) => {
        const fallback = CONSUMABLE_ITEMS_BY_KEY[item.item_key];
        return {
          item_key: String(item.item_key),
          item_label: String(item.item_label || fallback?.label || item.item_key),
          group_key: normalizeConsumableGroupKey(item.group_key),
          warning_days: Number(item.warning_days ?? fallback?.warningDays ?? 7),
          critical_days: Number(item.critical_days ?? fallback?.criticalDays ?? 3),
          sort_order: Number(item.sort_order ?? 0),
          is_active: item.is_active !== false,
          is_custom: item.is_custom !== false
        } satisfies ConsumableDashboardItem;
      });
  }, [dashboard.items]);

  const itemLabelByKey = useMemo(
    () => new Map(items.map((item) => [item.item_key, item.item_label] as const)),
    [items]
  );

  const snapshots = useMemo(
    () =>
      ((dashboard.snapshots ?? []) as DashboardSnapshotRow[])
        .map((row) => ({
          ...row,
          remaining_qty: Number(row.remaining_qty ?? 0)
        }))
        .filter((row) => row.item_key && row.snapshot_date),
    [dashboard.snapshots]
  );

  const adjustments = useMemo(
    () =>
      ((dashboard.adjustments ?? []) as DashboardAdjustmentRow[])
        .map((row) => ({
          ...row,
          delta_qty: Number(row.delta_qty ?? 0)
        }))
        .filter((row) => row.item_key && row.effective_at),
    [dashboard.adjustments]
  );

  const inboundOrdersByDate = useMemo(
    () => Object.fromEntries(Object.entries(dashboard.inbound_orders_by_date ?? {}).map(([key, value]) => [key, Number(value ?? 0)])),
    [dashboard.inbound_orders_by_date]
  );

  const latestSnapshotByItem = useMemo(() => {
    const map = new Map<ConsumableItemKey, DashboardSnapshotRow>();
    for (const row of [...snapshots].sort((left, right) => right.snapshot_date.localeCompare(left.snapshot_date, 'en-US'))) {
      if (!map.has(row.item_key)) {
        map.set(row.item_key, row);
      }
    }
    return map;
  }, [snapshots]);

  useEffect(() => {
    if (items.length === 0) return;
    if (!adjustmentForm.itemKey || !items.some((item) => item.item_key === adjustmentForm.itemKey)) {
      setAdjustmentForm(buildInitialAdjustmentForm(items[0].item_key));
    }
  }, [adjustmentForm.itemKey, items]);

  const cardRows = useMemo(() => {
    return items.map((item) => {
      const itemSnapshots = snapshots
        .filter((snapshot) => snapshot.item_key === item.item_key)
        .map((snapshot) => ({
          item_key: snapshot.item_key,
          snapshot_date: snapshot.snapshot_date,
          remaining_qty: snapshot.remaining_qty
        })) as ConsumableSnapshot[];
      const itemAdjustments = adjustments
        .filter((adjustment) => adjustment.item_key === item.item_key)
        .map((adjustment) => ({
          id: adjustment.id,
          item_key: adjustment.item_key,
          effective_at: adjustment.effective_at,
          delta_qty: adjustment.delta_qty,
          reason: adjustment.reason,
          note: adjustment.note
        })) as ConsumableAdjustment[];
      const intervals = buildConsumableIntervals({
        itemKey: item.item_key,
        snapshots: itemSnapshots,
        adjustments: itemAdjustments,
        inboundOrdersByDate
      });
      const latestSnapshot = latestSnapshotByItem.get(item.item_key);
      const totalAdjustmentQty = itemAdjustments.reduce((sum, adjustment) => sum + adjustment.delta_qty, 0);
      const latestSnapshotCutoffMs = latestSnapshot
        ? toEpochMs(latestSnapshot.created_at) ?? toEpochMs(`${latestSnapshot.snapshot_date}T00:00:00Z`)
        : null;
      const postSnapshotAdjustmentQty = latestSnapshotCutoffMs != null
        ? itemAdjustments.reduce((sum, adjustment) => {
            const adjustmentMs = toEpochMs(adjustment.effective_at);
            if (adjustmentMs == null || adjustmentMs <= latestSnapshotCutoffMs) return sum;
            return sum + adjustment.delta_qty;
          }, 0)
        : 0;
      const currentRemainingQty = computeConsumableCurrentRemaining({
        latestSnapshotQty: latestSnapshot?.remaining_qty ?? null,
        totalAdjustmentQty,
        postSnapshotAdjustmentQty
      });
      const projection = computeConsumableProjection({
        latestRemainingQty: currentRemainingQty,
        intervals,
        inboundOrdersByDate
      });
      const alertState = classifyConsumableAlert({
        latestRemainingQty: projection.latestRemainingQty,
        estimatedDaysLeft: projection.estimatedDaysLeft,
        warningDays: item.warning_days,
        criticalDays: item.critical_days
      });

      return {
        ...item,
        latestSnapshotDate: latestSnapshot?.snapshot_date ?? null,
        latestRemainingQty: projection.latestRemainingQty,
        usagePerOrder: projection.usagePerOrder,
        avgDailyUsage: projection.avgDailyUsage,
        estimatedDaysLeft: projection.estimatedDaysLeft,
        alertType: alertState.alertType,
        severity: alertState.severity
      };
    });
  }, [adjustments, inboundOrdersByDate, items, latestSnapshotByItem, snapshots]);

  useEffect(() => {
    if (!canView || snapshotDraftDirty) return;
    const nextDraft = buildEmptySnapshotDraft(items);
    for (const row of cardRows) {
      nextDraft[row.item_key] = Number.isFinite(row.latestRemainingQty) ? String(row.latestRemainingQty) : '';
    }
    setSnapshotDraft(nextDraft);
  }, [canView, cardRows, items, snapshotDraftDirty]);

  const groupedSnapshots = useMemo(() => {
    const groups = new Map<string, DashboardSnapshotRow[]>();
    for (const row of snapshots) {
      const current = groups.get(row.snapshot_date) ?? [];
      current.push(row);
      groups.set(row.snapshot_date, current);
    }
    return Array.from(groups.entries())
      .sort((left, right) => right[0].localeCompare(left[0], 'en-US'))
      .slice(0, 10);
  }, [snapshots]);

  const groupedCardRows = useMemo(() => groupConsumableRows(cardRows), [cardRows]);

  const nextSortOrder = useMemo(
    () => Math.max(0, ...items.map((item) => Number(item.sort_order ?? 0))) + 10,
    [items]
  );

  const resetItemForm = () => setItemForm(buildInitialItemForm(nextSortOrder));

  const selectedSnapshotDetail = useMemo(() => {
    if (!snapshotDetailDate) return null;
    const rows = snapshots.filter((row) => row.snapshot_date === snapshotDetailDate);
    const previousDate = Array.from(new Set(snapshots.map((row) => row.snapshot_date)))
      .filter((date) => date < snapshotDetailDate)
      .sort((left, right) => right.localeCompare(left, 'en-US'))[0];
    const previousRows = previousDate ? snapshots.filter((row) => row.snapshot_date === previousDate) : [];
    const previousByItem = new Map(previousRows.map((row) => [row.item_key, row] as const));
    return {
      date: snapshotDetailDate,
      previousDate: previousDate ?? null,
      rows: rows
        .map((row) => {
          const previous = previousByItem.get(row.item_key);
          return {
            ...row,
            item_label: itemLabelByKey.get(row.item_key) ?? CONSUMABLE_ITEMS_BY_KEY[row.item_key]?.label ?? row.item_key,
            delta: previous ? Number(row.remaining_qty) - Number(previous.remaining_qty) : null
          };
        })
        .sort((left, right) => left.item_label.localeCompare(right.item_label, 'en-US'))
    };
  }, [itemLabelByKey, snapshotDetailDate, snapshots]);

  const bookQtyByItem = useMemo(() => {
    const map = new Map<ConsumableItemKey, number>();
    for (const row of cardRows) {
      map.set(row.item_key, Number(row.latestRemainingQty ?? 0) || 0);
    }
    return map;
  }, [cardRows]);

  const undoneAdjustmentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of adjustments) {
      const match = String(row.note ?? '').match(/\bundo_consumable_adjustment:([0-9a-f-]{8,})\b/i);
      if (match?.[1]) ids.add(match[1]);
    }
    return ids;
  }, [adjustments]);

  const canSubmitSnapshot = canOperate && !isLocked;

  const handleSnapshotValueChange = (itemKey: ConsumableItemKey, value: string) => {
    setSnapshotDraftDirty(true);
    setSnapshotDraft((prev) => ({ ...prev, [itemKey]: value }));
  };

  const saveSnapshotBatch = async (targetItems = items) => {
    if (!supabase || !canSubmitSnapshot || savingSnapshot) return;
    if (targetItems.length === 0) return;
    setSavingSnapshot(true);
    try {
      const itemsPayload = targetItems.map((item) => {
        const qty = Number(snapshotDraft[item.item_key]);
        if (!Number.isFinite(qty) || qty < 0) {
          throw new Error(`${item.item_label}: ${t('请输入有效剩余数量。', 'Enter a valid remaining quantity.')}`);
        }
        const bookQty = bookQtyByItem.get(item.item_key);
        if (bookQty != null && qty > bookQty) {
          throw new Error(
            `${item.item_label}: ${t('盘点数量不能高于账面数量，请通过补货调整增加库存。', 'Snapshot quantity cannot exceed book quantity. Use restock adjustment to add inventory.')}`
          );
        }
        return {
          item_key: item.item_key,
          remaining_qty: qty
        };
      });

      const rpcRes = await supabase.rpc('save_consumable_snapshot_batch', {
        p_snapshot_date: snapshotDate,
        p_items: itemsPayload,
        p_note: ''
      });
      if (rpcRes.error) {
        throw new Error(String(rpcRes.error.message ?? 'Failed to save snapshot.'));
      }
      const savedAt = new Date().toISOString();
      const savedSnapshots: DashboardSnapshotRow[] = itemsPayload.map((item) => ({
        item_key: item.item_key,
        snapshot_date: snapshotDate,
        remaining_qty: item.remaining_qty,
        note: '',
        created_at: savedAt
      }));
      setDashboard((prev) => ({
        ...prev,
        snapshots: mergeSnapshotRows(prev.snapshots, savedSnapshots)
      }));
      publishStatus({
        tone: 'success',
        message: t('耗材盘点已保存。', 'Consumable snapshot saved.')
      });
      setSnapshotDraftDirty(false);
      setReloadKey((value) => value + 1);
    } catch (error: any) {
      publishStatus({
        tone: 'error',
        message: String(error?.message ?? error ?? t('耗材盘点保存失败。', 'Failed to save consumable snapshot.'))
      });
    } finally {
      setSavingSnapshot(false);
    }
  };

  const saveAdjustment = async () => {
    if (!supabase || !canOperate || isLocked || savingAdjustment) return;
    setSavingAdjustment(true);
    try {
      const deltaQty = Number(adjustmentForm.deltaQty);
      if (!Number.isFinite(deltaQty) || deltaQty <= 0 || !Number.isInteger(deltaQty)) {
        throw new Error(t('请输入有效补货数量。', 'Enter a valid restock quantity.'));
      }
      if (!items.some((item) => item.item_key === adjustmentForm.itemKey)) {
        throw new Error(t('请选择耗材。', 'Select an item.'));
      }
      const rpcRes = await supabase.rpc('save_consumable_adjustment', {
        p_item_key: adjustmentForm.itemKey,
        p_effective_at: new Date().toISOString(),
        p_delta_qty: deltaQty,
        p_reason: 'restock',
        p_note: ''
      });
      if (rpcRes.error) {
        throw new Error(String(rpcRes.error.message ?? 'Failed to save adjustment.'));
      }
      setAdjustmentForm(buildInitialAdjustmentForm(items[0]?.item_key ?? ''));
      publishStatus({
        tone: 'success',
        message: t('耗材调整已保存。', 'Consumable adjustment saved.')
      });
      setReloadKey((value) => value + 1);
    } catch (error: any) {
      publishStatus({
        tone: 'error',
        message: String(error?.message ?? error ?? t('耗材调整保存失败。', 'Failed to save consumable adjustment.'))
      });
    } finally {
      setSavingAdjustment(false);
    }
  };

  const undoAdjustment = async (row: DashboardAdjustmentRow) => {
    if (!supabase || !canOperate || isLocked || !row.id || undoingAdjustmentId) return;
    setUndoingAdjustmentId(row.id);
    try {
      const rpcRes = await supabase.rpc('undo_consumable_adjustment', {
        p_adjustment_id: row.id
      });
      if (rpcRes.error) {
        throw new Error(String(rpcRes.error.message ?? 'Failed to undo adjustment.'));
      }
      publishStatus({
        tone: 'success',
        message: t('补货已撤回。', 'Restock undone.')
      });
      setReloadKey((value) => value + 1);
    } catch (error: any) {
      publishStatus({
        tone: 'error',
        message: String(error?.message ?? error ?? t('补货撤回失败。', 'Failed to undo restock.'))
      });
    } finally {
      setUndoingAdjustmentId(null);
    }
  };

  const openNewItemForm = () => {
    setItemForm(buildInitialItemForm(nextSortOrder));
    setItemManagerOpen(true);
  };

  const openEditItemForm = (item: ConsumableDashboardItem) => {
    setItemForm({
      itemKey: item.item_key,
      itemLabel: item.item_label,
      groupKey: normalizeConsumableGroupKey(item.group_key),
      warningDays: String(item.warning_days ?? 7),
      criticalDays: String(item.critical_days ?? 3),
      sortOrder: String(item.sort_order ?? nextSortOrder)
    });
    setItemManagerOpen(true);
  };

  const saveItem = async () => {
    if (!supabase || !canManageItems || savingItem) return;
    setSavingItem(true);
    try {
      const itemLabel = itemForm.itemLabel.trim();
      const warningDays = Number(itemForm.warningDays);
      const criticalDays = Number(itemForm.criticalDays);
      const sortOrder = Number(itemForm.sortOrder);
      if (!itemLabel) throw new Error(t('请输入耗材名称。', 'Enter an item name.'));
      if (!Number.isFinite(warningDays) || warningDays < 0) throw new Error(t('请输入有效预警天数。', 'Enter valid warning days.'));
      if (!Number.isFinite(criticalDays) || criticalDays < 0 || criticalDays > warningDays) {
        throw new Error(t('请输入有效紧急天数。', 'Enter valid critical days.'));
      }
      if (!Number.isFinite(sortOrder)) throw new Error(t('请输入有效排序。', 'Enter a valid sort order.'));

      const rpcRes = await supabase.rpc('save_consumable_item', {
        p_item_key: itemForm.itemKey || null,
        p_item_label: itemLabel,
        p_group_key: itemForm.groupKey === 'uncategorized' ? null : itemForm.groupKey,
        p_warning_days: warningDays,
        p_critical_days: criticalDays,
        p_sort_order: Math.trunc(sortOrder)
      });
      if (rpcRes.error) {
        throw new Error(String(rpcRes.error.message ?? 'Failed to save item.'));
      }
      publishStatus({
        tone: 'success',
        message: t('耗材已保存。', 'Consumable item saved.')
      });
      resetItemForm();
      setReloadKey((value) => value + 1);
    } catch (error: any) {
      publishStatus({
        tone: 'error',
        message: String(error?.message ?? error ?? t('耗材保存失败。', 'Failed to save consumable item.'))
      });
    } finally {
      setSavingItem(false);
    }
  };

  const deleteItem = async (item: ConsumableDashboardItem) => {
    if (!supabase || !canManageItems || savingItem) return;
    setSavingItem(true);
    try {
      const rpcRes = await supabase.rpc('delete_consumable_item', {
        p_item_key: item.item_key
      });
      if (rpcRes.error) {
        throw new Error(String(rpcRes.error.message ?? 'Failed to delete item.'));
      }
      publishStatus({
        tone: 'success',
        message: t('耗材已停用。', 'Consumable item disabled.')
      });
      if (itemForm.itemKey === item.item_key) resetItemForm();
      setReloadKey((value) => value + 1);
    } catch (error: any) {
      publishStatus({
        tone: 'error',
        message: String(error?.message ?? error ?? t('耗材停用失败。', 'Failed to disable consumable item.'))
      });
    } finally {
      setSavingItem(false);
    }
  };

  if (!canView) return null;

  return (
    <div id="consumables" className={flush ? 'w-full px-4 py-4 md:px-5' : [shellClass, 'rounded-[28px] p-4 md:p-5'].join(' ')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h3 className="font-display text-[26px] leading-none tracking-[0.04em]">{t('耗材', 'Consumables')}</h3>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageItems ? (
              <button
                type="button"
                onClick={openNewItemForm}
                className={buttonSecondaryClass}
              >
                <PackagePlus className="h-4 w-4" />
                {t('耗材管理', 'Items')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className={buttonSecondaryClass}
              disabled={loading}
            >
              <RefreshCcw className="h-4 w-4" />
              {t('刷新', 'Refresh')}
            </button>
          </div>
        </div>

        <section
          className={[
            'rounded-[24px] border px-4 py-3',
            isLight
              ? 'border-slate-200 bg-white/85 shadow-[0_14px_34px_rgba(15,23,42,0.06)]'
              : 'border-slate-800/80 bg-slate-950/64 shadow-[0_18px_44px_rgba(2,6,23,0.26)]'
          ].join(' ')}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold">{t('状态灯', 'Status Lights')}</div>
            <div className={['flex flex-wrap items-center gap-3 text-xs font-semibold', mutedClass].join(' ')}>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.68)]" />
                {t('正常', 'Normal')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.68)]" />
                {t('预警', 'Warning')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,0.68)]" />
                {t('紧急', 'Critical')}
              </span>
            </div>
          </div>

          <div className="mt-3 space-y-3 overflow-hidden">
            {groupedCardRows
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <section key={`status-group-${group.key}`} className="space-y-2">
                  <div className={['text-xs font-semibold leading-none', mutedClass].join(' ')}>
                    {t(group.labelZh, group.labelEn)}
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                    {group.items.map((item) => {
                      const isCritical = item.severity === 'critical';
                      const isWarning = item.severity === 'warning';
                      const lampClass = isCritical
                        ? 'bg-rose-400 shadow-[0_0_16px_rgba(251,113,133,0.78)]'
                        : isWarning
                          ? 'bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.72)]'
                          : 'bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.68)]';
                      const effectClass = isCritical
                        ? 'consumable-magic-critical'
                        : isWarning
                          ? 'consumable-magic-warning'
                          : 'consumable-magic-normal';
                      const glowColor = isCritical ? '251, 113, 133' : isWarning ? '252, 211, 77' : '52, 211, 153';
                      const tileClass = isCritical
                        ? isLight
                          ? 'border-rose-200 bg-rose-50 text-rose-900'
                          : 'border-rose-500/24 bg-rose-500/10 text-rose-100'
                        : isWarning
                          ? isLight
                            ? 'border-amber-200 bg-amber-50 text-amber-900'
                            : 'border-amber-500/24 bg-amber-500/10 text-amber-100'
                          : isLight
                            ? 'border-emerald-200 bg-emerald-50/70 text-slate-900'
                            : 'border-emerald-500/16 bg-emerald-500/[0.07] text-slate-100';
                      const statusLabel = isCritical ? t('紧急', 'Critical') : isWarning ? t('预警', 'Warning') : t('正常', 'Normal');
                      const daysLeftText = formatDaysLeft(item.estimatedDaysLeft);
                      const daysLeftLabel =
                        daysLeftText === '-' ? t('可用天数 -', 'Days -') : t(`可用天数 ${daysLeftText} 天`, `Days ${daysLeftText}`);

                      return (
                        <div
                          key={`status-lamp-${item.item_key}`}
                          className={[
                            'magic-bento-card magic-bento-card--compact magic-bento-card--border-glow particle-container consumable-magic-surface flex h-12 items-center justify-between gap-3 rounded-2xl border px-3',
                            tileClass,
                            effectClass
                          ].join(' ')}
                          style={{ '--glow-color': glowColor } as CSSProperties}
                          aria-label={`${item.item_label} ${statusLabel} ${daysLeftLabel}`}
                          title={`${item.item_label} · ${statusLabel} · ${daysLeftLabel}`}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className={['h-3 w-3 shrink-0 rounded-full', lampClass].join(' ')} />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold leading-tight">{item.item_label}</div>
                              <div className="mt-0.5 text-[11px] font-semibold leading-none opacity-75">{statusLabel}</div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right leading-tight">
                            <div className="text-[10px] font-semibold opacity-70">{t('可用天数', 'Days')}</div>
                            <div className="mt-0.5 text-xs font-semibold tabular-nums">
                              {daysLeftText}{daysLeftText === '-' ? '' : t(' 天', '')}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
          </div>
        </section>

        <div className="space-y-4">
          {groupedCardRows.filter((group) => group.items.length > 0).map((group) => (
            <section key={`cards-${group.key}`} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{t(group.labelZh, group.labelEn)}</div>
                <div className={['text-xs tabular-nums', mutedClass].join(' ')}>{group.items.length}</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {group.items.map((item) => {
                  const toneClass =
                    item.severity === 'critical'
                      ? isLight
                        ? 'border-rose-200 bg-rose-50/70'
                        : 'border-rose-500/20 bg-rose-500/10'
                      : item.severity === 'warning'
                        ? isLight
                          ? 'border-amber-200 bg-amber-50/70'
                          : 'border-amber-500/20 bg-amber-500/10'
                        : surfaceClass;
                  const effectClass =
                    item.severity === 'critical'
                      ? 'consumable-magic-critical'
                      : item.severity === 'warning'
                        ? 'consumable-magic-warning'
                        : 'consumable-magic-normal';
                  const glowColor =
                    item.severity === 'critical'
                      ? '251, 113, 133'
                      : item.severity === 'warning'
                        ? '252, 211, 77'
                        : '52, 211, 153';
                  return (
                    <div
                      key={item.item_key}
                      className={['magic-bento-card magic-bento-card--border-glow particle-container consumable-magic-surface rounded-[22px] p-4', toneClass, effectClass].join(' ')}
                      style={{ '--glow-color': glowColor } as CSSProperties}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-semibold">{item.item_label}</div>
                        <Boxes className={['h-4 w-4 shrink-0', mutedClass].join(' ')} />
                      </div>
                      <div className="mt-4 text-[28px] font-semibold leading-none">{formatNumber(item.latestRemainingQty)}</div>
                      <div className={['mt-2 text-xs', mutedClass].join(' ')}>{t('剩余', 'Remaining')}</div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className={mutedClass}>{t('可用天数', 'Days Left')}</div>
                          <div className="mt-1 font-semibold">{formatDaysLeft(item.estimatedDaysLeft)}</div>
                        </div>
                        <div>
                          <div className={mutedClass}>{t('日均用量', 'Daily Use')}</div>
                          <div className="mt-1 font-semibold">{formatNumber(item.avgDailyUsage, 2)}</div>
                        </div>
                      </div>
                      <div className={['mt-4 text-xs', mutedClass].join(' ')}>{t('上次盘点', 'Last Snapshot')}: {item.latestSnapshotDate ?? '-'}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
          <div className="flex h-full flex-col space-y-4">
            <div className="flex h-9 items-center text-base font-semibold">{t('盘点录入', 'Snapshot Entry')}</div>
            <div className="flex flex-1 flex-col p-4 xl:min-h-[1090px]">
              <div className="grid flex-1 gap-4">
                {groupedCardRows.filter((group) => group.items.length > 0).map((group) => (
                  <section
                    key={`snapshot-${group.key}`}
                    className={[
                      'min-h-[220px] rounded-[20px] border p-4',
                      isLight ? 'border-slate-200 bg-slate-50/70' : 'border-slate-800 bg-slate-950/28'
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className={['text-xs font-semibold uppercase tracking-[0.16em]', mutedClass].join(' ')}>
                        {t(group.labelZh, group.labelEn)}
                      </div>
                      <button
                        type="button"
                        disabled={!canSubmitSnapshot || savingSnapshot}
                        onClick={() => void saveSnapshotBatch(group.items)}
                        className={buttonPrimaryClass}
                      >
                        <Save className="h-4 w-4" />
                        {savingSnapshot ? t('保存中...', 'Saving...') : t('保存盘点', 'Save Snapshot')}
                      </button>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {group.items.map((item) => (
                        <label key={item.item_key} className="block">
                          <div className={['mb-2 truncate text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{item.item_label}</div>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={snapshotDraft[item.item_key] ?? ''}
                            disabled={!canOperate || isLocked}
                            onChange={(event) => handleSnapshotValueChange(item.item_key, event.target.value)}
                            className={['w-full rounded-2xl border px-4 py-3 text-sm outline-none transition', inputClass].join(' ')}
                          />
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>

          <div className="flex h-full flex-col space-y-4">
            <div className="flex h-9 items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                <div className="text-base font-semibold">{t('补货调整', 'Adjustments')}</div>
              </div>
              <button
                type="button"
                disabled={!canOperate || isLocked || savingAdjustment}
                onClick={() => void saveAdjustment()}
                className={buttonPrimaryClass}
              >
                <Save className="h-4 w-4" />
                {savingAdjustment ? t('保存中...', 'Saving...') : t('保存调整', 'Save Adjustment')}
              </button>
            </div>
            <div className={[surfaceClass, 'flex min-h-[300px] flex-1 flex-col rounded-[24px] p-4 xl:min-h-[1090px]'].join(' ')}>
              <div className="space-y-2">
                <label className="block">
                  <div className={['mb-2 text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('耗材', 'Item')}</div>
                  <select
                    value={adjustmentForm.itemKey}
                    disabled={!canOperate || isLocked}
                    onChange={(event) => setAdjustmentForm((prev) => ({ ...prev, itemKey: event.target.value as ConsumableItemKey }))}
                    className={['w-full rounded-2xl border px-4 py-2.5 text-sm outline-none transition', inputClass].join(' ')}
                  >
                    {items.map((item) => (
                      <option key={item.item_key} value={item.item_key}>
                        {item.item_label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <div className={['mb-2 text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('补货数量', 'Restock Qty')}</div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={adjustmentForm.deltaQty}
                    disabled={!canOperate || isLocked}
                    onChange={(event) => {
                      const nextValue = event.target.value.replace(/[^\d]/g, '');
                      setAdjustmentForm((prev) => ({ ...prev, deltaQty: nextValue }));
                    }}
                    className={['w-full rounded-2xl border px-4 py-2.5 text-sm outline-none transition', inputClass].join(' ')}
                  />
                </label>
              </div>
              <div
                className={[
                  'mt-4 flex min-h-0 flex-1 flex-col rounded-2xl border',
                  isLight ? 'border-slate-200 bg-slate-950 text-slate-100' : 'border-slate-800 bg-slate-950/70'
                ].join(' ')}
              >
                <div
                  className={[
                    'flex items-center justify-between border-b px-4 py-2.5',
                    isLight ? 'border-slate-800' : 'border-slate-800'
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </div>
                  <div className={['flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]', isLight ? 'text-slate-300' : mutedClass].join(' ')}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {t('调整记录', 'Adjustment Log')}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5 font-mono text-xs">
                  {adjustments.length === 0 ? (
                    <div className={isLight ? 'text-slate-400' : mutedClass}>{t('暂无记录', 'No records')}</div>
                  ) : (
                    <table className="w-full table-fixed border-separate border-spacing-0">
                      <tbody>
                        {adjustments.slice(0, 30).map((row) => {
                          const canUndoRow =
                            Boolean(row.id) &&
                            row.delta_qty > 0 &&
                            row.reason === 'restock' &&
                            row.created_by_user_id === currentUserId &&
                            !undoneAdjustmentIds.has(String(row.id));
                          return (
                            <tr key={row.id ?? `${row.item_key}-${row.effective_at}`} className="text-slate-300">
                              <td className="w-[92px] py-1.5 pr-3 tabular-nums text-slate-500">{formatLogDateTime(row.effective_at)}</td>
                              <td className="truncate py-1.5 pr-3 font-semibold text-slate-100">{itemLabelByKey.get(row.item_key) ?? CONSUMABLE_ITEMS_BY_KEY[row.item_key]?.label ?? row.item_key}</td>
                              <td className="w-[128px] truncate py-1.5 pr-3 text-slate-400">{String(row.created_by_display ?? '').trim() || '-'}</td>
                              <td className={['w-[64px] py-1.5 text-right font-semibold tabular-nums', row.delta_qty < 0 ? 'text-rose-300' : 'text-emerald-400'].join(' ')}>
                                {formatNumber(row.delta_qty)}
                              </td>
                              <td className="w-[34px] py-1.5 text-right">
                                {canUndoRow ? (
                                  <button
                                    type="button"
                                    disabled={undoingAdjustmentId === row.id}
                                    onClick={() => void undoAdjustment(row)}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
                                    title={t('撤回补货', 'Undo restock')}
                                    aria-label={t('撤回补货', 'Undo restock')}
                                  >
                                    <Undo2 className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className={[surfaceClass, 'rounded-[24px] p-4'].join(' ')}>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              <div className="text-base font-semibold">{t('盘点历史', 'Snapshot History')}</div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className={mutedClass}>
                  <tr>
                    <th className="px-3 py-2">{t('日期', 'Date')}</th>
                    <th className="px-3 py-2">{t('已录入', 'Items')}</th>
                    <th className="px-3 py-2">{t('盘点人', 'Inspector')}</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedSnapshots.length === 0 ? (
                    <tr>
                      <td colSpan={3} className={['px-3 py-8 text-center', mutedClass].join(' ')}>
                        {loading ? t('加载中...', 'Loading...') : t('暂无盘点记录。', 'No snapshot history.')}
                      </td>
                    </tr>
                  ) : (
                    groupedSnapshots.map(([date, rows]) => (
                      <tr key={date} className={isLight ? 'border-t border-slate-200' : 'border-t border-slate-800'}>
                        <td className="px-3 py-3 font-semibold">{date}</td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => setSnapshotDetailDate(date)}
                            className={[
                              'rounded-lg px-2 py-1 text-sm font-semibold tabular-nums transition',
                              isLight ? 'text-sky-700 hover:bg-sky-50' : 'text-sky-200 hover:bg-sky-500/10'
                            ].join(' ')}
                          >
                            {rows.length}
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          {Array.from(new Set(rows.map((row) => String(row.created_by_display ?? '').trim()).filter(Boolean))).join(', ') || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className={[surfaceClass, 'rounded-[24px] p-4'].join(' ')}>
            <div className="text-base font-semibold">{t('预测摘要', 'Projection')}</div>
            <div className="mt-4 space-y-5">
              {groupedCardRows.filter((group) => group.items.length > 0).map((group) => (
                <section key={`projection-${group.key}`} className="space-y-3">
                  <div className={['text-xs font-semibold uppercase tracking-[0.16em]', mutedClass].join(' ')}>{t(group.labelZh, group.labelEn)}</div>
                  {group.items.map((item) => (
                    <div key={`projection-${item.item_key}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                      <div className="min-w-0 truncate text-sm font-semibold">{item.item_label}</div>
                      <div className={['text-xs tabular-nums', mutedClass].join(' ')}>
                        {t('单量耗用', 'Usage / Order')}: {formatNumber(item.usagePerOrder, 4)}
                      </div>
                      <div className="text-right text-sm font-semibold tabular-nums">
                        {formatDaysLeft(item.estimatedDaysLeft)} {t('天', 'days')}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>

        {itemManagerOpen && canManageItems ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" className={[surfaceClass, 'max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-[24px] shadow-2xl'].join(' ')}>
              <div className={['flex items-center justify-between border-b px-5 py-4', isLight ? 'border-slate-200' : 'border-slate-800'].join(' ')}>
                <div className="text-base font-semibold">{t('耗材管理', 'Items')}</div>
                <button
                  type="button"
                  onClick={() => setItemManagerOpen(false)}
                  className={['rounded-xl p-2 transition', isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'].join(' ')}
                  aria-label={t('关闭', 'Close')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid max-h-[calc(86vh-64px)] gap-4 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-3">
                  {items.length === 0 ? (
                    <div className={['rounded-2xl border px-4 py-8 text-center text-sm', isLight ? 'border-slate-200 text-slate-400' : 'border-slate-800 text-slate-500'].join(' ')}>
                      {t('暂无耗材', 'No items')}
                    </div>
                  ) : (
                    items.map((item) => (
                      <div key={`manager-${item.item_key}`} className={['flex items-center justify-between gap-3 rounded-2xl border px-4 py-3', isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950/60'].join(' ')}>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{item.item_label}</div>
                          <div className={['mt-1 text-xs', mutedClass].join(' ')}>
                            {t(CONSUMABLE_GROUP_DEFINITIONS.find((group) => group.key === normalizeConsumableGroupKey(item.group_key))?.labelZh ?? '未分区', CONSUMABLE_GROUP_DEFINITIONS.find((group) => group.key === normalizeConsumableGroupKey(item.group_key))?.labelEn ?? 'Unassigned')}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditItemForm(item)}
                            className={['rounded-xl p-2 transition', isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'].join(' ')}
                            aria-label={t('编辑', 'Edit')}
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteItem(item)}
                            disabled={savingItem}
                            className={['rounded-xl p-2 transition', isLight ? 'text-rose-600 hover:bg-rose-50' : 'text-rose-300 hover:bg-rose-500/10'].join(' ')}
                            aria-label={t('停用', 'Disable')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className={['rounded-2xl border p-4', isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-950/50'].join(' ')}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">{itemForm.itemKey ? t('编辑耗材', 'Edit Item') : t('新增耗材', 'New Item')}</div>
                    <button type="button" onClick={resetItemForm} className={['text-xs font-semibold', mutedClass].join(' ')}>
                      {t('清空', 'Clear')}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <label className="block">
                      <div className={['mb-2 text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('名称', 'Name')}</div>
                      <input
                        type="text"
                        value={itemForm.itemLabel}
                        onChange={(event) => setItemForm((prev) => ({ ...prev, itemLabel: event.target.value }))}
                        className={['w-full rounded-2xl border px-4 py-3 text-sm outline-none transition', inputClass].join(' ')}
                      />
                    </label>
                    <label className="block">
                      <div className={['mb-2 text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('分区', 'Group')}</div>
                      <select
                        value={itemForm.groupKey}
                        onChange={(event) => setItemForm((prev) => ({ ...prev, groupKey: normalizeConsumableGroupKey(event.target.value) }))}
                        className={['w-full rounded-2xl border px-4 py-3 text-sm outline-none transition', inputClass].join(' ')}
                      >
                        {CONSUMABLE_GROUP_DEFINITIONS.map((group) => (
                          <option key={`item-form-${group.key}`} value={group.key}>
                            {t(group.labelZh, group.labelEn)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <div className={['mb-2 text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('预警', 'Warn')}</div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={itemForm.warningDays}
                          onChange={(event) => setItemForm((prev) => ({ ...prev, warningDays: event.target.value }))}
                          className={['w-full rounded-2xl border px-4 py-3 text-sm outline-none transition', inputClass].join(' ')}
                        />
                      </label>
                      <label className="block">
                        <div className={['mb-2 text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('紧急', 'Critical')}</div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={itemForm.criticalDays}
                          onChange={(event) => setItemForm((prev) => ({ ...prev, criticalDays: event.target.value }))}
                          className={['w-full rounded-2xl border px-4 py-3 text-sm outline-none transition', inputClass].join(' ')}
                        />
                      </label>
                    </div>
                    <label className="block">
                      <div className={['mb-2 text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('排序', 'Sort')}</div>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={itemForm.sortOrder}
                        onChange={(event) => setItemForm((prev) => ({ ...prev, sortOrder: event.target.value.replace(/[^\d-]/g, '') }))}
                        className={['w-full rounded-2xl border px-4 py-3 text-sm outline-none transition', inputClass].join(' ')}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={savingItem}
                      onClick={() => void saveItem()}
                      className={['mt-1 w-full', buttonPrimaryClass].join(' ')}
                    >
                      <Save className="h-4 w-4" />
                      {savingItem ? t('保存中...', 'Saving...') : t('保存', 'Save')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {selectedSnapshotDetail ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" className={[surfaceClass, 'max-h-[82vh] w-full max-w-2xl overflow-hidden rounded-[24px] shadow-2xl'].join(' ')}>
              <div className={['flex items-center justify-between border-b px-5 py-4', isLight ? 'border-slate-200' : 'border-slate-800'].join(' ')}>
                <div>
                  <div className="text-base font-semibold">{selectedSnapshotDetail.date}</div>
                  <div className={['mt-1 text-xs', mutedClass].join(' ')}>{selectedSnapshotDetail.previousDate ?? t('无上次盘点', 'No previous snapshot')}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSnapshotDetailDate(null)}
                  className={['rounded-xl p-2 transition', isLight ? 'hover:bg-slate-100' : 'hover:bg-slate-800'].join(' ')}
                  aria-label={t('关闭', 'Close')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[calc(82vh-73px)] overflow-y-auto p-5">
                <table className="min-w-full text-left text-sm">
                  <thead className={mutedClass}>
                    <tr>
                      <th className="px-3 py-2">{t('耗材', 'Item')}</th>
                      <th className="px-3 py-2 text-right">{t('数量', 'Qty')}</th>
                      <th className="px-3 py-2 text-right">{t('变动', 'Change')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSnapshotDetail.rows.map((row) => {
                      const deltaClass =
                        row.delta == null
                          ? mutedClass
                          : row.delta > 0
                            ? 'text-emerald-400'
                            : row.delta < 0
                              ? 'text-rose-400'
                              : mutedClass;
                      const deltaLabel = row.delta == null ? '-' : row.delta > 0 ? `+${formatNumber(row.delta)}` : formatNumber(row.delta);
                      return (
                        <tr key={`snapshot-detail-${row.item_key}`} className={isLight ? 'border-t border-slate-200' : 'border-t border-slate-800'}>
                          <td className="px-3 py-3 font-semibold">{row.item_label}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.remaining_qty)}</td>
                          <td className={['px-3 py-3 text-right font-semibold tabular-nums', deltaClass].join(' ')}>{deltaLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {!onStatus ? (
          <AdminNoticeToast
            open={Boolean(status.message && status.tone !== 'idle')}
            tone={status.tone}
            message={status.message}
            themeMode={themeMode}
            onClose={() => setStatus({ tone: 'idle', message: '' })}
          />
        ) : null}
      </div>
    </div>
  );
}
