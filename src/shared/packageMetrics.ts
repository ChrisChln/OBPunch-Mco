export const PACKAGE_METRICS_TIMEZONE = 'America/New_York';
export const PACKAGE_METRICS_REQUIRED_HEADERS = ['商品数量', '订单流入时间', '发货状态', '打包完成时间'] as const;

export type PackageMetricsRequiredHeader = (typeof PACKAGE_METRICS_REQUIRED_HEADERS)[number];

export type PackageMetricsParsedRow = {
  quantity: number;
  inboundAt: string;
  shippingStatus: string;
  packedAt: string | null;
};

export type PackageMetricsRowInput = {
  quantity: number;
  inboundAt: string;
  shippingStatus: string;
  packedAt?: string | null;
};

export type PackageDailyMetrics = {
  metric_date: string;
  assessment_single_order_count: number;
  assessment_multi_order_count: number;
  assessment_multi_order_ratio: number;
  assessment_total_order_count: number;
  assessment_unfinished_order_count: number;
  calendar_inbound_order_count: number;
  calendar_inbound_final_hour_present: boolean | null;
  assessment_single_item_qty: number;
  assessment_multi_item_qty: number;
  assessment_multi_item_ratio: number;
  assessment_total_item_qty: number;
  calendar_inbound_item_qty: number;
  inventory_qty: number | null;
  inventory_conversion_ratio: number | null;
  assessment_unfinished_item_qty: number;
  assessment_completed_order_count: number;
  assessment_completed_item_qty: number;
  calendar_completed_order_count: number;
  calendar_completed_item_qty: number;
  calendar_backlog_order_count: number;
  calendar_backlog_item_qty: number;
  transfer_b2b_inbound_order_count?: number | null;
  transfer_b2b_inbound_box_count?: number | null;
  transfer_b2b_inbound_item_qty?: number | null;
  transfer_b2b_shipped_order_count?: number | null;
  transfer_b2b_shipped_box_count?: number | null;
  transfer_b2b_shipped_item_qty?: number | null;
  transfer_b2b_unshipped_order_count?: number | null;
  transfer_b2b_unshipped_box_count?: number | null;
  transfer_b2b_unshipped_item_qty?: number | null;
  transfer_c2b_inbound_order_count?: number | null;
  transfer_c2b_inbound_box_count?: number | null;
  transfer_c2b_inbound_item_qty?: number | null;
  transfer_c2b_shipped_order_count?: number | null;
  transfer_c2b_shipped_box_count?: number | null;
  transfer_c2b_shipped_item_qty?: number | null;
  transfer_c2b_unshipped_order_count?: number | null;
  transfer_c2b_unshipped_box_count?: number | null;
  transfer_c2b_unshipped_item_qty?: number | null;
  transfer_whole_day_inbound_box_count?: number | null;
  transfer_whole_day_inbound_item_qty?: number | null;
  transfer_avg_items_per_box?: number | null;
  scheduled_headcount?: number | null;
  source_filename: string;
  source_row_count: number;
  computed_at: string;
};

export type PackageDerivedMetrics = {
  pieceEfficiency: number | null;
  orderEfficiency: number | null;
  slaRatio: number | null;
};

export type PackageMetricsDateCoverage = {
  inboundDateStart: string | null;
  inboundDateEnd: string | null;
  assessmentInboundRowCount: number;
  calendarInboundRowCount: number;
};

export type PackageDailyReportLabor = {
  scheduledCount: number;
  presentCount: number;
  lateCount: number;
  earlyLeaveCount: number;
  totalHours: number | null;
};

export type PackageTransferRemainderState = {
  b2bOrder: number;
  b2bBox: number;
  b2bItem: number;
  c2bOrder: number;
  c2bBox: number;
  c2bItem: number;
};

export type PackageTransferRemainderRowInput = {
  metric_date: string;
  transfer_b2b_inbound_order_count?: number | null;
  transfer_b2b_inbound_box_count?: number | null;
  transfer_b2b_inbound_item_qty?: number | null;
  transfer_b2b_shipped_order_count?: number | null;
  transfer_b2b_shipped_box_count?: number | null;
  transfer_b2b_shipped_item_qty?: number | null;
  transfer_c2b_inbound_order_count?: number | null;
  transfer_c2b_inbound_box_count?: number | null;
  transfer_c2b_inbound_item_qty?: number | null;
  transfer_c2b_shipped_order_count?: number | null;
  transfer_c2b_shipped_box_count?: number | null;
  transfer_c2b_shipped_item_qty?: number | null;
};

export type PackageTransferRemainderRow = {
  metric_date: string;
  transfer_b2b_unshipped_order_count: number;
  transfer_b2b_unshipped_box_count: number;
  transfer_b2b_unshipped_item_qty: number;
  transfer_c2b_unshipped_order_count: number;
  transfer_c2b_unshipped_box_count: number;
  transfer_c2b_unshipped_item_qty: number;
};

const pad = (value: number) => String(value).padStart(2, '0');

export const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());

export const addDaysDateOnly = (dateOnly: string, days: number) => {
  const [year, month, day] = String(dateOnly ?? '')
    .split('-')
    .map((part) => Number(part));
  const base = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
};

export const getDateOnlyInTimeZone = (value: Date, timeZone = PACKAGE_METRICS_TIMEZONE) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);

export const normalizePackageTimestamp = (value: unknown): string | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const normalized = raw.replace('T', ' ').replace(/\//g, '-').replace(/\s+/g, ' ');
  const ymdhms = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?: (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (ymdhms) {
    const year = Number(ymdhms[1]);
    const month = Number(ymdhms[2]);
    const day = Number(ymdhms[3]);
    const hour = Number(ymdhms[4] ?? '0');
    const minute = Number(ymdhms[5] ?? '0');
    const second = Number(ymdhms[6] ?? '0');
    if (
      Number.isInteger(year) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31 &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59 &&
      second >= 0 &&
      second <= 59
    ) {
      return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACKAGE_METRICS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(parsed);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
};

export const parsePackageQuantity = (value: unknown): number | null => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

export const buildAssessmentWindow = (metricDate: string) => ({
  start: `${addDaysDateOnly(metricDate, -1)} 13:30:00`,
  endExclusive: `${metricDate} 13:30:00`
});

export const buildCalendarWindow = (metricDate: string) => ({
  start: `${metricDate} 00:00:00`,
  endExclusive: `${addDaysDateOnly(metricDate, 1)} 00:00:00`
});

const isWithinWindow = (value: string | null | undefined, start: string, endExclusive: string) =>
  Boolean(value) && String(value) >= start && String(value) < endExclusive;

const FINISHED_STATUSES = new Set(['已发货', '发货中']);

const isFinishedStatus = (status: string) => FINISHED_STATUSES.has(status.trim());
const isBacklogStatus = (status: string) => status.trim() === '待发货';

const safeRatio = (numerator: number, denominator: number) =>
  denominator > 0 ? Number((numerator / denominator).toFixed(6)) : 0;

const normalizeNonNegativeIntegerMetric = (value: unknown) => {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return Math.round(normalized);
};

export const computePackageTransferRemainderRows = (
  rows: PackageTransferRemainderRowInput[],
  initialState: Partial<PackageTransferRemainderState> = {}
): PackageTransferRemainderRow[] => {
  let b2bOrder = normalizeNonNegativeIntegerMetric(initialState.b2bOrder);
  let b2bBox = normalizeNonNegativeIntegerMetric(initialState.b2bBox);
  let b2bItem = normalizeNonNegativeIntegerMetric(initialState.b2bItem);
  let c2bOrder = normalizeNonNegativeIntegerMetric(initialState.c2bOrder);
  let c2bBox = normalizeNonNegativeIntegerMetric(initialState.c2bBox);
  let c2bItem = normalizeNonNegativeIntegerMetric(initialState.c2bItem);

  return [...rows]
    .sort((a, b) => String(a.metric_date).localeCompare(String(b.metric_date)))
    .map((row) => {
      b2bOrder = Math.max(
        0,
        b2bOrder +
          normalizeNonNegativeIntegerMetric(row.transfer_b2b_inbound_order_count) -
          normalizeNonNegativeIntegerMetric(row.transfer_b2b_shipped_order_count)
      );
      b2bBox = Math.max(
        0,
        b2bBox +
          normalizeNonNegativeIntegerMetric(row.transfer_b2b_inbound_box_count) -
          normalizeNonNegativeIntegerMetric(row.transfer_b2b_shipped_box_count)
      );
      b2bItem = Math.max(
        0,
        b2bItem +
          normalizeNonNegativeIntegerMetric(row.transfer_b2b_inbound_item_qty) -
          normalizeNonNegativeIntegerMetric(row.transfer_b2b_shipped_item_qty)
      );
      c2bOrder = Math.max(
        0,
        c2bOrder +
          normalizeNonNegativeIntegerMetric(row.transfer_c2b_inbound_order_count) -
          normalizeNonNegativeIntegerMetric(row.transfer_c2b_shipped_order_count)
      );
      c2bBox = Math.max(
        0,
        c2bBox +
          normalizeNonNegativeIntegerMetric(row.transfer_c2b_inbound_box_count) -
          normalizeNonNegativeIntegerMetric(row.transfer_c2b_shipped_box_count)
      );
      c2bItem = Math.max(
        0,
        c2bItem +
          normalizeNonNegativeIntegerMetric(row.transfer_c2b_inbound_item_qty) -
          normalizeNonNegativeIntegerMetric(row.transfer_c2b_shipped_item_qty)
      );

      return {
        metric_date: row.metric_date,
        transfer_b2b_unshipped_order_count: b2bOrder,
        transfer_b2b_unshipped_box_count: b2bBox,
        transfer_b2b_unshipped_item_qty: b2bItem,
        transfer_c2b_unshipped_order_count: c2bOrder,
        transfer_c2b_unshipped_box_count: c2bBox,
        transfer_c2b_unshipped_item_qty: c2bItem
      };
    });
};

export const inspectPackageMetricsDateCoverage = (
  rows: Pick<PackageMetricsRowInput, 'inboundAt'>[],
  metricDate: string
): PackageMetricsDateCoverage => {
  const assessmentWindow = buildAssessmentWindow(metricDate);
  const calendarWindow = buildCalendarWindow(metricDate);
  let inboundDateStart: string | null = null;
  let inboundDateEnd: string | null = null;
  let assessmentInboundRowCount = 0;
  let calendarInboundRowCount = 0;

  for (const row of rows) {
    const inboundAt = normalizePackageTimestamp(row.inboundAt);
    if (!inboundAt) continue;
    const inboundDate = inboundAt.slice(0, 10);
    if (!inboundDateStart || inboundDate < inboundDateStart) inboundDateStart = inboundDate;
    if (!inboundDateEnd || inboundDate > inboundDateEnd) inboundDateEnd = inboundDate;
    if (isWithinWindow(inboundAt, assessmentWindow.start, assessmentWindow.endExclusive)) {
      assessmentInboundRowCount += 1;
    }
    if (isWithinWindow(inboundAt, calendarWindow.start, calendarWindow.endExclusive)) {
      calendarInboundRowCount += 1;
    }
  }

  return {
    inboundDateStart,
    inboundDateEnd,
    assessmentInboundRowCount,
    calendarInboundRowCount
  };
};

export const computePackageDerivedMetrics = (
  metrics: Pick<
    PackageDailyMetrics,
    'calendar_completed_item_qty' | 'calendar_completed_order_count' | 'assessment_completed_order_count' | 'assessment_total_order_count'
  >,
  totalHours: number | null | undefined
): PackageDerivedMetrics => {
  const normalizedHours =
    totalHours != null && Number.isFinite(Number(totalHours)) && Number(totalHours) > 0
      ? Number(totalHours)
      : null;

  return {
    pieceEfficiency: normalizedHours ? Number((metrics.calendar_completed_item_qty / normalizedHours).toFixed(2)) : null,
    orderEfficiency: normalizedHours ? Number((metrics.calendar_completed_order_count / normalizedHours).toFixed(2)) : null,
    slaRatio:
      metrics.assessment_total_order_count > 0
        ? Number((metrics.assessment_completed_order_count / metrics.assessment_total_order_count).toFixed(6))
        : null
  };
};

const formatReportDate = (dateOnly: string) => String(dateOnly ?? '').trim().replace(/-/g, '/');

const formatInteger = (value: number | null | undefined) => {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized)) return '0';
  return String(Math.max(0, Math.round(normalized)));
};

const formatPercentText = (value: number | null | undefined) => {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized)) return '0%';
  const percent = normalized * 100;
  return `${Number(percent.toFixed(2)).toString()}%`;
};

const formatHoursText = (value: number | null | undefined) => {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized) || normalized <= 0) return '0';
  return Number(normalized.toFixed(2)).toString();
};

const formatEfficiencyText = (value: number | null | undefined) => {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized) || normalized < 0) return '0.00';
  return normalized.toFixed(2);
};

const hasTransferDailyMetrics = (metrics: PackageDailyMetrics) =>
  [
    metrics.transfer_b2b_inbound_box_count,
    metrics.transfer_b2b_inbound_order_count,
    metrics.transfer_b2b_inbound_item_qty,
    metrics.transfer_b2b_shipped_order_count,
    metrics.transfer_b2b_shipped_box_count,
    metrics.transfer_b2b_shipped_item_qty,
    metrics.transfer_b2b_unshipped_order_count,
    metrics.transfer_b2b_unshipped_box_count,
    metrics.transfer_b2b_unshipped_item_qty,
    metrics.transfer_c2b_inbound_order_count,
    metrics.transfer_c2b_inbound_box_count,
    metrics.transfer_c2b_inbound_item_qty,
    metrics.transfer_c2b_shipped_order_count,
    metrics.transfer_c2b_shipped_box_count,
    metrics.transfer_c2b_shipped_item_qty,
    metrics.transfer_c2b_unshipped_order_count,
    metrics.transfer_c2b_unshipped_box_count,
    metrics.transfer_c2b_unshipped_item_qty,
    metrics.transfer_whole_day_inbound_box_count,
    metrics.transfer_whole_day_inbound_item_qty,
    metrics.transfer_avg_items_per_box
  ].some((value) => value != null && Number.isFinite(Number(value)) && Number(value) > 0);

export const buildPackageDailyReportText = (options: {
  metricDate: string;
  metrics: PackageDailyMetrics;
  labor: PackageDailyReportLabor;
  unfinishedReason?: string | null;
  stationLabel?: string;
}) => {
  const stationLabel = String(options.stationLabel ?? 'JDL NYC4').trim() || 'JDL NYC4';
  const unfinishedReason = String(options.unfinishedReason ?? '').trim() || '/';
  const attendanceRate =
    options.labor.scheduledCount > 0
      ? options.labor.presentCount / options.labor.scheduledCount
      : 0;
  const derived = computePackageDerivedMetrics(options.metrics, options.labor.totalHours);
  const transferLines = hasTransferDailyMetrics(options.metrics)
    ? [
        '',
        'B2B',
        `调拨进单量：${formatInteger(options.metrics.transfer_b2b_inbound_order_count)}单，${formatInteger(options.metrics.transfer_b2b_inbound_box_count)}箱，${formatInteger(options.metrics.transfer_b2b_inbound_item_qty)}件`,
        `调拨发货量：${formatInteger(options.metrics.transfer_b2b_shipped_order_count)}单，${formatInteger(options.metrics.transfer_b2b_shipped_box_count)}箱，${formatInteger(options.metrics.transfer_b2b_shipped_item_qty)}件`,
        `调拨未发货量：${formatInteger(options.metrics.transfer_b2b_unshipped_order_count)}单，${formatInteger(options.metrics.transfer_b2b_unshipped_box_count)}箱，${formatInteger(options.metrics.transfer_b2b_unshipped_item_qty)}件`,
        '',
        '',
        'C2B',
        `调拨进单量：${formatInteger(options.metrics.transfer_c2b_inbound_order_count)}单，${formatInteger(options.metrics.transfer_c2b_inbound_box_count)}箱，${formatInteger(options.metrics.transfer_c2b_inbound_item_qty)}件`,
        `调拨发货量：${formatInteger(options.metrics.transfer_c2b_shipped_order_count)}单，${formatInteger(options.metrics.transfer_c2b_shipped_box_count)}箱，${formatInteger(options.metrics.transfer_c2b_shipped_item_qty)}件`,
        `调拨未发货量：${formatInteger(options.metrics.transfer_c2b_unshipped_order_count)}单，${formatInteger(options.metrics.transfer_c2b_unshipped_box_count)}箱，${formatInteger(options.metrics.transfer_c2b_unshipped_item_qty)}件`,
        ''
      ]
    : [];

  return [
    `${stationLabel} ${formatReportDate(options.metricDate)} 出库日报：`,
    '',
    `考核进单量：${formatInteger(options.metrics.assessment_total_order_count)}单，${formatInteger(options.metrics.assessment_total_item_qty)}件`,
    `考核完成单量：${formatInteger(options.metrics.assessment_completed_order_count)}单，${formatInteger(options.metrics.assessment_completed_item_qty)}件`,
    `考核未完成单量：${formatInteger(options.metrics.assessment_unfinished_order_count)}单，${formatInteger(options.metrics.assessment_unfinished_item_qty)}件`,
    `未完成原因：${unfinishedReason}`,
    '',
    `全天进单量：${formatInteger(options.metrics.calendar_inbound_order_count)}单，${formatInteger(options.metrics.calendar_inbound_item_qty)}件`,
    `全天完成单量：${formatInteger(options.metrics.calendar_completed_order_count)}单，${formatInteger(options.metrics.calendar_completed_item_qty)}件`,
    `全天未完成单量：${formatInteger(options.metrics.calendar_backlog_order_count)}单，${formatInteger(options.metrics.calendar_backlog_item_qty)}件`,
    ...transferLines,
    '',
    'O岗出勤',
    `编制：${formatInteger(options.labor.scheduledCount)}人`,
    `实到：${formatInteger(options.labor.presentCount)}人`,
    `迟到：${formatInteger(options.labor.lateCount)}人`,
    `早退：${formatInteger(options.labor.earlyLeaveCount)}人`,
    `出勤率：${formatPercentText(attendanceRate)}`,
    `总工时: ${formatHoursText(options.labor.totalHours)} 小时`,
    `人效（件效）：${formatEfficiencyText(derived.pieceEfficiency)}`,
    `人效（单效）：${formatEfficiencyText(derived.orderEfficiency)}`,
    '',
    `SLA：${formatPercentText(derived.slaRatio)}`
  ].join('\n');
};

export const computePackageDailyMetrics = (
  rows: PackageMetricsRowInput[],
  options: {
    metricDate: string;
    sourceFilename: string;
    computedAt?: string;
    inventoryQty?: number | null;
  }
): PackageDailyMetrics => {
  const metricDate = String(options.metricDate ?? '').trim();
  if (!isDateOnly(metricDate)) {
    throw new Error('Metric date must be YYYY-MM-DD.');
  }

  const assessmentWindow = buildAssessmentWindow(metricDate);
  const calendarWindow = buildCalendarWindow(metricDate);
  let assessmentSingleOrderCount = 0;
  let assessmentMultiOrderCount = 0;
  let assessmentUnfinishedOrderCount = 0;
  let assessmentSingleItemQty = 0;
  let assessmentMultiItemQty = 0;
  let assessmentUnfinishedItemQty = 0;
  let assessmentCompletedOrderCount = 0;
  let assessmentCompletedItemQty = 0;
  let calendarInboundOrderCount = 0;
  let calendarInboundItemQty = 0;
  let calendarInboundFinalHourPresent = false;
  let calendarCompletedOrderCount = 0;
  let calendarCompletedItemQty = 0;
  let calendarBacklogOrderCount = 0;
  let calendarBacklogItemQty = 0;

  for (const sourceRow of rows) {
    const quantity = Number(sourceRow.quantity);
    if (!Number.isFinite(quantity)) continue;
    const shippingStatus = String(sourceRow.shippingStatus ?? '').trim();
    const inboundAt = normalizePackageTimestamp(sourceRow.inboundAt);
    const packedAt = normalizePackageTimestamp(sourceRow.packedAt ?? '');

    if (isBacklogStatus(shippingStatus)) {
      calendarBacklogOrderCount += 1;
      calendarBacklogItemQty += quantity;
    }

    if (inboundAt && isWithinWindow(inboundAt, assessmentWindow.start, assessmentWindow.endExclusive)) {
      if (quantity === 1) {
        assessmentSingleOrderCount += 1;
        assessmentSingleItemQty += quantity;
      } else if (quantity > 1) {
        assessmentMultiOrderCount += 1;
        assessmentMultiItemQty += quantity;
      }

      if (isBacklogStatus(shippingStatus)) {
        assessmentUnfinishedOrderCount += 1;
        assessmentUnfinishedItemQty += quantity;
      }
      if (isFinishedStatus(shippingStatus)) {
        assessmentCompletedOrderCount += 1;
        assessmentCompletedItemQty += quantity;
      }
    }

    if (inboundAt && isWithinWindow(inboundAt, calendarWindow.start, calendarWindow.endExclusive)) {
      calendarInboundOrderCount += 1;
      calendarInboundItemQty += quantity;
      if (inboundAt.slice(11, 13) === '23') {
        calendarInboundFinalHourPresent = true;
      }
    }

    if (packedAt && isWithinWindow(packedAt, calendarWindow.start, calendarWindow.endExclusive)) {
      calendarCompletedOrderCount += 1;
      calendarCompletedItemQty += quantity;
    }
  }

  const assessmentTotalOrderCount = assessmentSingleOrderCount + assessmentMultiOrderCount;
  const assessmentTotalItemQty = assessmentSingleItemQty + assessmentMultiItemQty;
  const inventoryQtyRaw = options.inventoryQty;
  const inventoryQty =
    inventoryQtyRaw == null || !Number.isFinite(Number(inventoryQtyRaw)) || Number(inventoryQtyRaw) < 0
      ? null
      : Number(Number(inventoryQtyRaw).toFixed(2));

  return {
    metric_date: metricDate,
    assessment_single_order_count: assessmentSingleOrderCount,
    assessment_multi_order_count: assessmentMultiOrderCount,
    assessment_multi_order_ratio: safeRatio(assessmentMultiOrderCount, assessmentTotalOrderCount),
    assessment_total_order_count: assessmentTotalOrderCount,
    assessment_unfinished_order_count: assessmentUnfinishedOrderCount,
    calendar_inbound_order_count: calendarInboundOrderCount,
    calendar_inbound_final_hour_present: calendarInboundFinalHourPresent,
    assessment_single_item_qty: assessmentSingleItemQty,
    assessment_multi_item_qty: assessmentMultiItemQty,
    assessment_multi_item_ratio: safeRatio(assessmentMultiItemQty, assessmentTotalItemQty),
    assessment_total_item_qty: assessmentTotalItemQty,
    calendar_inbound_item_qty: calendarInboundItemQty,
    inventory_qty: inventoryQty,
    inventory_conversion_ratio: inventoryQty && inventoryQty > 0 ? safeRatio(calendarInboundItemQty, inventoryQty) : null,
    assessment_unfinished_item_qty: assessmentUnfinishedItemQty,
    assessment_completed_order_count: assessmentCompletedOrderCount,
    assessment_completed_item_qty: assessmentCompletedItemQty,
    calendar_completed_order_count: calendarCompletedOrderCount,
    calendar_completed_item_qty: calendarCompletedItemQty,
    calendar_backlog_order_count: calendarBacklogOrderCount,
    calendar_backlog_item_qty: calendarBacklogItemQty,
    source_filename: String(options.sourceFilename ?? '').trim(),
    source_row_count: rows.length,
    computed_at: options.computedAt ?? new Date().toISOString()
  };
};
