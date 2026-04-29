import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, Boxes, CalendarDays, Plus, RefreshCcw, Save } from 'lucide-react';
import {
  CONSUMABLE_ITEM_DEFINITIONS,
  CONSUMABLE_ITEMS_BY_KEY,
  buildConsumableIntervals,
  classifyConsumableAlert,
  computeConsumableProjection,
  formatDaysLeft,
  type ConsumableAdjustment,
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
  supabase: any;
  serverTime: Date;
};

type DashboardItemRow = {
  item_key: ConsumableItemKey;
  item_label?: string | null;
  warning_days?: number | null;
  critical_days?: number | null;
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

const buildEmptySnapshotDraft = () =>
  Object.fromEntries(CONSUMABLE_ITEM_DEFINITIONS.map((item) => [item.key, ''])) as SnapshotDraft;

const buildInitialAdjustmentForm = (): AdjustmentForm => ({
  itemKey: CONSUMABLE_ITEM_DEFINITIONS[0].key,
  deltaQty: ''
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
  supabase,
  serverTime
}: ConsumablesWorkspaceProps) {
  const isLight = themeMode === 'light';
  const today = getDateOnlyInTimeZone(serverTime);
  const snapshotDate = today;
  const [dashboard, setDashboard] = useState<DashboardPayload>({});
  const [loading, setLoading] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [status, setStatus] = useState<StatusState>({ tone: 'idle', message: '' });
  const [snapshotDraft, setSnapshotDraft] = useState<SnapshotDraft>(buildEmptySnapshotDraft);
  const [snapshotDraftDirty, setSnapshotDraftDirty] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentForm>(buildInitialAdjustmentForm);
  const [reloadKey, setReloadKey] = useState(0);

  const shellClass =
    themeMode === 'light'
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
  const buttonPrimaryClass =
    themeMode === 'light'
      ? 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300'
      : 'bg-slate-100 text-slate-950 hover:bg-white disabled:bg-slate-700 disabled:text-slate-400';
  const buttonSecondaryClass =
    themeMode === 'light'
      ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      : 'border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800';
  const statusClass =
    status.tone === 'error'
      ? isLight
        ? 'text-rose-700'
        : 'text-rose-300'
      : status.tone === 'success'
        ? isLight
          ? 'text-emerald-700'
          : 'text-emerald-300'
        : mutedClass;

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
        setStatus({
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
    const byKey = new Map(fromApi.map((item) => [item.item_key, item] as const));
    return CONSUMABLE_ITEM_DEFINITIONS.map((definition) => {
      const apiRow = byKey.get(definition.key);
      return {
        item_key: definition.key,
        item_label: apiRow?.item_label || definition.label,
        warning_days: Number(apiRow?.warning_days ?? definition.warningDays),
        critical_days: Number(apiRow?.critical_days ?? definition.criticalDays)
      };
    });
  }, [dashboard.items]);

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

  const existingSnapshotMap = useMemo(() => {
    const map = new Map<string, DashboardSnapshotRow>();
    for (const row of snapshots) {
      map.set(`${row.snapshot_date}::${row.item_key}`, row);
    }
    return map;
  }, [snapshots]);

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
    if (!canView) return;
    if (!snapshotDraftDirty) {
      const nextDraft = buildEmptySnapshotDraft();
      for (const item of CONSUMABLE_ITEM_DEFINITIONS) {
        const currentSnapshot = existingSnapshotMap.get(`${snapshotDate}::${item.key}`);
        const fallbackSnapshot = latestSnapshotByItem.get(item.key);
        const value = currentSnapshot?.remaining_qty ?? fallbackSnapshot?.remaining_qty ?? null;
        nextDraft[item.key] = value == null ? '' : String(value);
      }
      setSnapshotDraft(nextDraft);
    }
  }, [canView, existingSnapshotMap, latestSnapshotByItem, snapshotDate, snapshotDraftDirty, snapshots]);

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
          item_key: adjustment.item_key,
          effective_at: adjustment.effective_at,
          delta_qty: adjustment.delta_qty
        })) as ConsumableAdjustment[];
      const intervals = buildConsumableIntervals({
        itemKey: item.item_key,
        snapshots: itemSnapshots,
        adjustments: itemAdjustments,
        inboundOrdersByDate
      });
      const latestSnapshot = latestSnapshotByItem.get(item.item_key);
      const latestSnapshotCutoff = latestSnapshot ? `${latestSnapshot.snapshot_date}T23:59:59.999Z` : null;
      const postSnapshotAdjustmentQty = latestSnapshotCutoff
        ? itemAdjustments.reduce((sum, adjustment) => {
            if (adjustment.effective_at <= latestSnapshotCutoff) return sum;
            return sum + adjustment.delta_qty;
          }, 0)
        : 0;
      const currentRemainingQty =
        latestSnapshot == null ? null : Math.max(0, latestSnapshot.remaining_qty + postSnapshotAdjustmentQty);
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

  const alertRows = useMemo(() => {
    const persistedAlerts = ((dashboard.alerts ?? []) as DashboardAlertRow[]).filter((alert) => String(alert.status ?? 'open') !== 'resolved');
    const synthesizedAlerts = cardRows
      .filter((item) => item.alertType)
      .map((item) => ({
        id: `computed-${item.item_key}-${item.alertType}`,
        alert_date: today,
        item_key: item.item_key,
        alert_type: item.alertType ?? '',
        severity: item.severity ?? 'warning',
        details_json: {
          estimated_days_left: item.estimatedDaysLeft,
          latest_remaining_qty: item.latestRemainingQty
        }
      }));
    return [...persistedAlerts, ...synthesizedAlerts].slice(0, 8);
  }, [cardRows, dashboard.alerts, today]);

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

  const bookQtyByItem = useMemo(() => {
    const map = new Map<ConsumableItemKey, number>();
    for (const row of cardRows) {
      map.set(row.item_key, Number(row.latestRemainingQty ?? 0) || 0);
    }
    return map;
  }, [cardRows]);

  const canSubmitSnapshot = canOperate && !isLocked;

  const handleSnapshotValueChange = (itemKey: ConsumableItemKey, value: string) => {
    setSnapshotDraftDirty(true);
    setSnapshotDraft((prev) => ({ ...prev, [itemKey]: value }));
  };

  const saveSnapshotBatch = async () => {
    if (!supabase || !canSubmitSnapshot || savingSnapshot) return;
    setSavingSnapshot(true);
    try {
      const itemsPayload = CONSUMABLE_ITEM_DEFINITIONS.map((item) => {
        const qty = Number(snapshotDraft[item.key]);
        if (!Number.isFinite(qty) || qty < 0) {
          throw new Error(`${CONSUMABLE_ITEMS_BY_KEY[item.key].label}: ${t('请输入有效剩余数量。', 'Enter a valid remaining quantity.')}`);
        }
        const bookQty = bookQtyByItem.get(item.key);
        if (bookQty != null && qty > bookQty) {
          throw new Error(
            `${CONSUMABLE_ITEMS_BY_KEY[item.key].label}: ${t('盘点数量不能高于账面数量，请通过补货调整增加库存。', 'Snapshot quantity cannot exceed book quantity. Use restock adjustment to add inventory.')}`
          );
        }
        return {
          item_key: item.key,
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
      setStatus({
        tone: 'success',
        message: t('耗材盘点已保存。', 'Consumable snapshot saved.')
      });
      setSnapshotDraftDirty(false);
      setReloadKey((value) => value + 1);
    } catch (error: any) {
      setStatus({
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
      setAdjustmentForm(buildInitialAdjustmentForm());
      setStatus({
        tone: 'success',
        message: t('耗材调整已保存。', 'Consumable adjustment saved.')
      });
      setReloadKey((value) => value + 1);
    } catch (error: any) {
      setStatus({
        tone: 'error',
        message: String(error?.message ?? error ?? t('耗材调整保存失败。', 'Failed to save consumable adjustment.'))
      });
    } finally {
      setSavingAdjustment(false);
    }
  };

  if (!canView) return null;

  return (
    <div id="consumables" className={[shellClass, 'rounded-[28px] p-4 md:p-5'].join(' ')}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <div className={['text-[11px] font-semibold uppercase tracking-[0.22em]', mutedClass].join(' ')}>
              {t('耗材工作区', 'Consumables')}
            </div>
            <div className="flex items-center gap-3">
              <h3 className="font-display text-[26px] leading-none tracking-[0.04em]">{t('耗材', 'Consumables')}</h3>
              <span
                className={[
                  'inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
                  canOperate
                    ? isLight
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-emerald-500/12 text-emerald-200'
                    : isLight
                      ? 'bg-slate-100 text-slate-600'
                      : 'bg-slate-800 text-slate-300'
                ].join(' ')}
              >
                {canOperate ? t('可操作', 'Operate') : t('只读', 'Read Only')}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className={['inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition', buttonSecondaryClass].join(' ')}
              disabled={loading}
            >
              <RefreshCcw className="h-4 w-4" />
              {t('刷新', 'Refresh')}
            </button>
            <div className={['text-xs', mutedClass].join(' ')}>{loading ? t('加载中...', 'Loading...') : t('最近 42 天', 'Last 42 days')}</div>
          </div>
        </div>

        {alertRows.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2">
            {alertRows.map((alert) => {
              const isCritical = alert.severity === 'critical';
              const isMissing = alert.alert_type === 'missing_snapshot';
              const toneClass = isCritical
                ? isLight
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-100'
                : isLight
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-100';
              const itemLabel = alert.item_key ? CONSUMABLE_ITEMS_BY_KEY[alert.item_key]?.label ?? alert.item_key : t('本次盘点', 'Snapshot');
              return (
                <div key={alert.id ?? `${alert.alert_date}-${alert.alert_type}-${itemLabel}`} className={['rounded-2xl border px-4 py-3', toneClass].join(' ')}>
                  <div className="flex items-start gap-3">
                    {isMissing ? <BellRing className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        {isMissing
                          ? t(`待填盘点 ${alert.alert_date}`, `Snapshot due ${alert.alert_date}`)
                          : `${itemLabel} · ${alert.alert_type === 'low_stock_critical' ? t('紧急', 'Critical') : t('预警', 'Warning')}`}
                      </div>
                      <div className="mt-1 text-xs opacity-80">
                        {isMissing
                          ? t('盘点尚未录入。', 'Snapshot is still missing.')
                          : t('预计可用天数已进入预警区间。', 'Estimated days left has entered the alert window.')}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {cardRows.map((item) => {
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
            return (
              <div key={item.item_key} className={['rounded-[22px] p-4', toneClass].join(' ')}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{item.item_label}</div>
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
          <div className={[surfaceClass, 'rounded-[24px] p-4'].join(' ')}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-base font-semibold">{t('盘点录入', 'Snapshot Entry')}</div>
              <button
                type="button"
                disabled={!canSubmitSnapshot || savingSnapshot}
                onClick={() => void saveSnapshotBatch()}
                className={['inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition', buttonPrimaryClass].join(' ')}
              >
                <Save className="h-4 w-4" />
                {savingSnapshot ? t('保存中...', 'Saving...') : t('保存盘点', 'Save Snapshot')}
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {CONSUMABLE_ITEM_DEFINITIONS.map((item) => (
                <label key={item.key} className="block">
                  <div className={['mb-2 text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{item.label}</div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={snapshotDraft[item.key]}
                    disabled={!canOperate || isLocked}
                    onChange={(event) => handleSnapshotValueChange(item.key, event.target.value)}
                    className={['w-full rounded-2xl border px-4 py-3 text-sm outline-none transition', inputClass].join(' ')}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className={[surfaceClass, 'flex min-h-[520px] flex-col rounded-[24px] p-4'].join(' ')}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                <div className="text-base font-semibold">{t('补货调整', 'Adjustments')}</div>
              </div>
              <button
                type="button"
                disabled={!canOperate || isLocked || savingAdjustment}
                onClick={() => void saveAdjustment()}
                className={['inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition', buttonPrimaryClass].join(' ')}
              >
                <Save className="h-4 w-4" />
                {savingAdjustment ? t('保存中...', 'Saving...') : t('保存调整', 'Save Adjustment')}
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <div className={['mb-2 text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('耗材', 'Item')}</div>
                <select
                  value={adjustmentForm.itemKey}
                  disabled={!canOperate || isLocked}
                  onChange={(event) => setAdjustmentForm((prev) => ({ ...prev, itemKey: event.target.value as ConsumableItemKey }))}
                  className={['w-full rounded-2xl border px-4 py-3 text-sm outline-none transition', inputClass].join(' ')}
                >
                  {CONSUMABLE_ITEM_DEFINITIONS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
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
                  className={['w-full rounded-2xl border px-4 py-3 text-sm outline-none transition', inputClass].join(' ')}
                />
              </label>
            </div>
            <div
              className={[
                'mt-5 rounded-2xl border',
                isLight ? 'border-slate-200 bg-slate-950 text-slate-100' : 'border-slate-800 bg-slate-950/70'
              ].join(' ')}
            >
              <div
                className={[
                  'flex items-center justify-between border-b px-4 py-3',
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
              <div className="max-h-[168px] overflow-y-auto px-4 py-3 font-mono text-xs">
                {adjustments.length === 0 ? (
                  <div className={isLight ? 'text-slate-400' : mutedClass}>{t('暂无记录', 'No records')}</div>
                ) : (
                  <table className="w-full table-fixed border-separate border-spacing-0">
                    <tbody>
                      {adjustments.slice(0, 12).map((row) => (
                        <tr key={row.id ?? `${row.item_key}-${row.effective_at}`} className="text-slate-300">
                          <td className="w-[92px] py-1.5 pr-3 tabular-nums text-slate-500">{formatLogDateTime(row.effective_at)}</td>
                          <td className="truncate py-1.5 pr-3 font-semibold text-slate-100">{CONSUMABLE_ITEMS_BY_KEY[row.item_key]?.label ?? row.item_key}</td>
                          <td className="w-[128px] truncate py-1.5 pr-3 text-slate-400">{String(row.created_by_display ?? '').trim() || '-'}</td>
                          <td className="w-[64px] py-1.5 text-right font-semibold tabular-nums text-emerald-400">{formatNumber(row.delta_qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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
                        <td className="px-3 py-3">{rows.length}</td>
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
            <div className="mt-4 space-y-3">
              {cardRows.slice(0, 5).map((item) => (
                <div key={`projection-${item.item_key}`} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{item.item_label}</div>
                    <div className={['text-xs', mutedClass].join(' ')}>{t('单量耗用', 'Usage / Order')}: {formatNumber(item.usagePerOrder, 4)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatDaysLeft(item.estimatedDaysLeft)}</div>
                    <div className={['text-xs', mutedClass].join(' ')}>{t('天', 'days')}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={['text-sm', statusClass].join(' ')}>{status.message || '\u00A0'}</div>
      </div>
    </div>
  );
}
