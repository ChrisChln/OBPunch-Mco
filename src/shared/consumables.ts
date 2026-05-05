export const CONSUMABLE_TIMEZONE = 'America/New_York';

export const CONSUMABLE_GROUP_DEFINITIONS = [
  { key: 'packing', labelZh: '打包耗材', labelEn: 'Packing' },
  { key: 'last_mile', labelZh: '尾程耗材', labelEn: 'Last Mile' },
  { key: 'transfer', labelZh: '调拨耗材', labelEn: 'Transfer' },
  { key: 'uncategorized', labelZh: '未分区', labelEn: 'Unassigned' }
] as const;

export type ConsumableGroupKey = (typeof CONSUMABLE_GROUP_DEFINITIONS)[number]['key'];

export const CONSUMABLE_ITEM_DEFINITIONS = [
  { key: 'box_48', label: 'Box 48', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'pm2', label: 'PM2', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'pm5', label: 'PM5', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'pm7', label: 'PM7', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'label_4x6', label: 'Label 4*6', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'label_4x2', label: 'Label 4*2', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'gaylord_48', label: 'Gaylord 48', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'gaylord_72', label: 'Gaylord 72', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'clear_tape', label: 'Clear Tape', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'wrap', label: 'Wrap', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'transfer_color_tape_yellow', label: 'Transfer Color Tape - Yellow', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'transfer_color_tape_green', label: 'Transfer Color Tape - Green', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'transfer_clear_film', label: 'Transfer Clear Film', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'transfer_label_4x2', label: 'Transfer Label 4*2', group_key: null, warningDays: 7, criticalDays: 3 },
  { key: 'transfer_label_4x6', label: 'Transfer Label 4*6', group_key: null, warningDays: 7, criticalDays: 3 }
] as const;

export type ConsumableItemKey = string;
export type ConsumableItemGroup = ConsumableGroupKey;
export type ConsumableAlertType = 'missing_snapshot' | 'low_stock_warning' | 'low_stock_critical';
export type ConsumableAlertSeverity = 'info' | 'warning' | 'critical';

export type ConsumableDashboardItem = {
  item_key: ConsumableItemKey;
  item_label: string;
  group_key?: string | null;
  warning_days: number;
  critical_days: number;
  sort_order?: number | null;
  is_active?: boolean | null;
  is_custom?: boolean | null;
};

export type ConsumableSnapshot = {
  item_key: ConsumableItemKey;
  snapshot_date: string;
  remaining_qty: number;
};

export type ConsumableAdjustment = {
  item_key: ConsumableItemKey;
  effective_at: string;
  delta_qty: number;
};

export type ConsumableIntervalUsage = {
  itemKey: ConsumableItemKey;
  startDate: string;
  endDate: string;
  remainingStart: number;
  remainingEnd: number;
  adjustmentQty: number;
  inboundOrders: number;
  usageQty: number;
  usagePerOrder: number | null;
};

export type ConsumableProjection = {
  latestRemainingQty: number;
  usagePerOrder: number | null;
  avgDailyUsage: number | null;
  estimatedDaysLeft: number | null;
};

export const CONSUMABLE_ITEMS_BY_KEY = Object.fromEntries(
  CONSUMABLE_ITEM_DEFINITIONS.map((item) => [item.key, item])
) as Record<string, (typeof CONSUMABLE_ITEM_DEFINITIONS)[number] | undefined>;

const CONSUMABLE_GROUP_KEY_SET = new Set<string>(CONSUMABLE_GROUP_DEFINITIONS.map((group) => group.key));

export const normalizeConsumableGroupKey = (value: unknown): ConsumableGroupKey => {
  const key = String(value ?? '').trim().toLowerCase();
  return CONSUMABLE_GROUP_KEY_SET.has(key) ? (key as ConsumableGroupKey) : 'uncategorized';
};

export const groupConsumableRows = <T extends ConsumableDashboardItem>(rows: T[]) => {
  const activeRows = rows
    .filter((row) => row.is_active !== false)
    .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0) || left.item_label.localeCompare(right.item_label, 'en-US'));

  return CONSUMABLE_GROUP_DEFINITIONS.map((group) => ({
    ...group,
    items: activeRows.filter((row) => normalizeConsumableGroupKey(row.group_key) === group.key)
  }));
};

const toFiniteNumber = (value: unknown) => {
  if (value == null || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const isConsumableSnapshotDay = (dateOnly: string) => {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const weekday = date.getUTCDay();
  return weekday === 1 || weekday === 4;
};

export const formatDaysLeft = (value: number | null) => {
  if (value == null || !Number.isFinite(value)) return '-';
  if (value <= 0) return '0.0';
  return roundTo(value, 1).toFixed(1);
};

export const buildConsumableIntervals = (options: {
  itemKey: ConsumableItemKey;
  snapshots: ConsumableSnapshot[];
  adjustments: ConsumableAdjustment[];
  inboundOrdersByDate: Record<string, number>;
  maxLookbackDays?: number;
}): ConsumableIntervalUsage[] => {
  const maxLookbackDays = Math.max(1, Math.floor(options.maxLookbackDays ?? 90));
  const sortedSnapshots = [...options.snapshots]
    .filter((snapshot) => snapshot.item_key === options.itemKey)
    .sort((left, right) => left.snapshot_date.localeCompare(right.snapshot_date, 'en-US'));
  const sortedAdjustments = [...options.adjustments]
    .filter((adjustment) => adjustment.item_key === options.itemKey)
    .sort((left, right) => left.effective_at.localeCompare(right.effective_at, 'en-US'));

  const intervals: ConsumableIntervalUsage[] = [];
  for (let index = 1; index < sortedSnapshots.length; index += 1) {
    const previous = sortedSnapshots[index - 1];
    const current = sortedSnapshots[index];
    const daysBetween = Math.round(
      (new Date(`${current.snapshot_date}T00:00:00Z`).getTime() - new Date(`${previous.snapshot_date}T00:00:00Z`).getTime()) / 86400000
    );
    if (!Number.isFinite(daysBetween) || daysBetween <= 0 || daysBetween > maxLookbackDays) continue;

    let adjustmentQty = 0;
    for (const adjustment of sortedAdjustments) {
      const effectiveDate = String(adjustment.effective_at ?? '').slice(0, 10);
      if (!effectiveDate) continue;
      if (effectiveDate <= previous.snapshot_date || effectiveDate > current.snapshot_date) continue;
      adjustmentQty += adjustment.delta_qty;
    }

    let inboundOrders = 0;
    let cursor = new Date(`${previous.snapshot_date}T00:00:00Z`);
    while (true) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const dateOnly = cursor.toISOString().slice(0, 10);
      if (dateOnly > current.snapshot_date) break;
      inboundOrders += Math.max(0, Number(options.inboundOrdersByDate[dateOnly] ?? 0));
    }
    if (inboundOrders <= 0) continue;

    const rawUsage = previous.remaining_qty + adjustmentQty - current.remaining_qty;
    const usageQty = Math.max(0, roundTo(rawUsage, 2));
    intervals.push({
      itemKey: options.itemKey,
      startDate: previous.snapshot_date,
      endDate: current.snapshot_date,
      remainingStart: previous.remaining_qty,
      remainingEnd: current.remaining_qty,
      adjustmentQty: roundTo(adjustmentQty, 2),
      inboundOrders,
      usageQty,
      usagePerOrder: inboundOrders > 0 ? roundTo(usageQty / inboundOrders, 6) : null
    });
  }

  return intervals;
};

export const computeWeightedUsagePerOrder = (intervals: ConsumableIntervalUsage[]) => {
  let totalUsage = 0;
  let totalOrders = 0;
  for (const interval of intervals) {
    if (!(interval.inboundOrders > 0)) continue;
    totalUsage += Math.max(0, interval.usageQty);
    totalOrders += interval.inboundOrders;
  }
  if (totalOrders <= 0) return null;
  return roundTo(totalUsage / totalOrders, 6);
};

export const computeAverageDailyInboundOrders = (inboundOrdersByDate: Record<string, number>, maxDays = 28) => {
  const dates = Object.keys(inboundOrdersByDate).sort((left, right) => right.localeCompare(left, 'en-US'));
  const values = dates
    .slice(0, Math.max(1, Math.floor(maxDays)))
    .map((date) => Math.max(0, Number(inboundOrdersByDate[date] ?? 0)))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return roundTo(total / values.length, 4);
};

export const computeConsumableProjection = (options: {
  latestRemainingQty: number | null;
  intervals: ConsumableIntervalUsage[];
  inboundOrdersByDate: Record<string, number>;
}): ConsumableProjection => {
  const latestRemainingQty = Math.max(0, toFiniteNumber(options.latestRemainingQty) ?? 0);
  const usagePerOrder = computeWeightedUsagePerOrder(options.intervals);
  const averageDailyInboundOrders = computeAverageDailyInboundOrders(options.inboundOrdersByDate, 28);
  const avgDailyUsage =
    usagePerOrder != null && averageDailyInboundOrders != null ? roundTo(usagePerOrder * averageDailyInboundOrders, 4) : null;
  const estimatedDaysLeft =
    avgDailyUsage != null && avgDailyUsage > 0 ? roundTo(latestRemainingQty / avgDailyUsage, 2) : null;

  return {
    latestRemainingQty,
    usagePerOrder,
    avgDailyUsage,
    estimatedDaysLeft
  };
};

export const classifyConsumableAlert = (options: {
  latestRemainingQty: number | null;
  estimatedDaysLeft: number | null;
  warningDays?: number | null;
  criticalDays?: number | null;
}): { alertType: ConsumableAlertType | null; severity: ConsumableAlertSeverity | null } => {
  const latestRemainingQty = toFiniteNumber(options.latestRemainingQty);
  const estimatedDaysLeft = toFiniteNumber(options.estimatedDaysLeft);
  const warningDays = Math.max(1, toFiniteNumber(options.warningDays) ?? 7);
  const criticalDays = Math.max(0, toFiniteNumber(options.criticalDays) ?? 3);

  if (latestRemainingQty != null && latestRemainingQty <= 0) {
    return { alertType: 'low_stock_critical', severity: 'critical' };
  }
  if (estimatedDaysLeft == null) {
    return { alertType: null, severity: null };
  }
  if (estimatedDaysLeft <= criticalDays) {
    return { alertType: 'low_stock_critical', severity: 'critical' };
  }
  if (estimatedDaysLeft <= warningDays) {
    return { alertType: 'low_stock_warning', severity: 'warning' };
  }
  return { alertType: null, severity: null };
};
