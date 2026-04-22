import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowUpRight, Clock3, FileUp, Package2, Rows3 } from 'lucide-react';
import { normalizeStaffId } from '../../lib/staffId';
import {
  addDaysDateOnly,
  buildPackageDailyReportText,
  computePackageDerivedMetrics,
  getDateOnlyInTimeZone,
  inspectPackageMetricsDateCoverage,
  normalizePackageTimestamp,
  PACKAGE_METRICS_REQUIRED_HEADERS,
  parsePackageQuantity,
  type PackageDailyMetrics,
  type PackageDailyReportLabor,
  type PackageMetricsParsedRow
} from '../../shared/packageMetrics';
import ConsumablesWorkspace from '../components/ConsumablesWorkspace';
import StyledDateInput from '../components/StyledDateInput';

type TranslateFn = (zh: string, en: string) => string;

type PackageMetricsPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  isReadOnly?: boolean;
  canViewConsumables?: boolean;
  canOperateConsumables?: boolean;
  supabase: any;
  themeMode: 'light' | 'dark';
  serverTime: Date;
};

type LoadState = {
  tone: 'idle' | 'success' | 'error';
  message: string;
};

type PackageMetricsViewRow = {
  metric_date: string;
  weekLabel: string;
} & PackageDailyMetrics;

type PackageMetricsDisplayRow = {
  metric_date: string;
  weekLabel: string;
  data: PackageMetricsViewRow | null;
};

type MetricColumn = {
  key: string;
  zh: string;
  en: string;
  width: string;
  render: (row: PackageMetricsViewRow, totalHours: number | null, options?: { hideWholeDayInbound?: boolean }) => string;
};

type PunchRow = {
  staff_id?: string | null;
  action?: string | null;
  created_at?: string | null;
};

type ScheduleRow = {
  staff_id?: string | null;
  date?: string | null;
  position?: string | null;
};

type AttendanceMarkRow = {
  staff_id?: string | null;
  work_date?: string | null;
};

type PackageLaborSummaryByDate = Record<string, PackageDailyReportLabor>;

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW) ? Math.max(0, Math.min(23, DAY_CUTOFF_HOUR_RAW)) : 5;
const TRACKED_POSITIONS = new Set(['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer']);
const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';

const formatMetricValue = (key: keyof PackageDailyMetrics, value: unknown) => {
  if (value == null || value === '') return '-';
  if (key.includes('ratio')) {
    const num = Number(value);
    return Number.isFinite(num) ? `${(num * 100).toFixed(2)}%` : '-';
  }

  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString('en-US') : String(value);
};

const formatHoursValue = (value: number | null) => {
  if (value == null || !Number.isFinite(value) || value <= 0) return '-';
  return value.toFixed(2);
};

const formatEfficiencyValue = (value: number | null) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toFixed(2);
};

const formatRatioValue = (value: number | null) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(2)}%`;
};

const IMPORT_FILE_NAME_MAX_LENGTH = 36;

const truncateMiddle = (value: string, maxLength: number) => {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return `${text.slice(0, maxLength)}...`;
  const visible = maxLength - 3;
  const head = Math.ceil(visible * 0.65);
  const tail = Math.floor(visible * 0.35);
  return `${text.slice(0, head)}...${text.slice(text.length - tail)}`;
};

const METRIC_COLUMNS: MetricColumn[] = [
  {
    key: 'assessment_single_order_count',
    zh: '考核单品单量',
    en: 'Single Orders',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_single_order_count', row.assessment_single_order_count)
  },
  {
    key: 'assessment_multi_order_count',
    zh: '考核多品单量',
    en: 'Multi Orders',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_multi_order_count', row.assessment_multi_order_count)
  },
  {
    key: 'assessment_multi_order_ratio',
    zh: '考核多品单比例',
    en: 'Multi Ratio',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_multi_order_ratio', row.assessment_multi_order_ratio)
  },
  {
    key: 'assessment_total_order_count',
    zh: '考核订单总量',
    en: 'Total Orders',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_total_order_count', row.assessment_total_order_count)
  },
  {
    key: 'assessment_unfinished_order_count',
    zh: '未完成考核订单',
    en: 'Unfinished Orders',
    width: 'min-w-[156px]',
    render: (row) => formatMetricValue('assessment_unfinished_order_count', row.assessment_unfinished_order_count)
  },
  {
    key: 'calendar_inbound_order_count',
    zh: '全天进单量',
    en: 'Inbound Orders',
    width: 'min-w-[138px]',
    render: (row, _totalHours, options) =>
      options?.hideWholeDayInbound ? '-' : formatMetricValue('calendar_inbound_order_count', row.calendar_inbound_order_count)
  },
  {
    key: 'assessment_single_item_qty',
    zh: '考核单品件数',
    en: 'Single Pieces',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_single_item_qty', row.assessment_single_item_qty)
  },
  {
    key: 'assessment_multi_item_qty',
    zh: '考核多品件数',
    en: 'Multi Pieces',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_multi_item_qty', row.assessment_multi_item_qty)
  },
  {
    key: 'assessment_multi_item_ratio',
    zh: '考核多品件数比例',
    en: 'Multi Piece Ratio',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_multi_item_ratio', row.assessment_multi_item_ratio)
  },
  {
    key: 'assessment_total_item_qty',
    zh: '考核总件数',
    en: 'Total Pieces',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_total_item_qty', row.assessment_total_item_qty)
  },
  {
    key: 'calendar_inbound_item_qty',
    zh: '全天进件量',
    en: 'Inbound Pieces',
    width: 'min-w-[138px]',
    render: (row, _totalHours, options) =>
      options?.hideWholeDayInbound ? '-' : formatMetricValue('calendar_inbound_item_qty', row.calendar_inbound_item_qty)
  },
  {
    key: 'inventory_qty',
    zh: '库存量',
    en: 'Inventory',
    width: 'min-w-[138px]',
    render: (row) => formatMetricValue('inventory_qty', row.inventory_qty)
  },
  {
    key: 'inventory_conversion_ratio',
    zh: '库存转换率',
    en: 'Inventory Rate',
    width: 'min-w-[138px]',
    render: (row) => formatMetricValue('inventory_conversion_ratio', row.inventory_conversion_ratio)
  },
  {
    key: 'assessment_unfinished_item_qty',
    zh: '未完成考核件数',
    en: 'Unfinished Pieces',
    width: 'min-w-[156px]',
    render: (row) => formatMetricValue('assessment_unfinished_item_qty', row.assessment_unfinished_item_qty)
  },
  {
    key: 'assessment_completed_order_count',
    zh: '考核单完成量',
    en: 'Completed Orders',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_completed_order_count', row.assessment_completed_order_count)
  },
  {
    key: 'assessment_completed_item_qty',
    zh: '考核单完成件数',
    en: 'Completed Pieces',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('assessment_completed_item_qty', row.assessment_completed_item_qty)
  },
  {
    key: 'calendar_completed_order_count',
    zh: '全天完成单量',
    en: 'Whole-day Orders',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('calendar_completed_order_count', row.calendar_completed_order_count)
  },
  {
    key: 'calendar_completed_item_qty',
    zh: '全天完成件数',
    en: 'Whole-day Pieces',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('calendar_completed_item_qty', row.calendar_completed_item_qty)
  },
  {
    key: 'calendar_backlog_order_count',
    zh: '全天剩余积压',
    en: 'Backlog Orders',
    width: 'min-w-[148px]',
    render: (row) => formatMetricValue('calendar_backlog_order_count', row.calendar_backlog_order_count)
  },
  {
    key: 'calendar_backlog_item_qty',
    zh: '全天剩余积压件数',
    en: 'Backlog Pieces',
    width: 'min-w-[156px]',
    render: (row) => formatMetricValue('calendar_backlog_item_qty', row.calendar_backlog_item_qty)
  },
  {
    key: 'timecard_hours',
    zh: '总工时',
    en: 'Hours',
    width: 'min-w-[128px]',
    render: (_row, totalHours) => formatHoursValue(totalHours)
  },
  {
    key: 'piece_efficiency',
    zh: '件效',
    en: 'Piece Efficiency',
    width: 'min-w-[128px]',
    render: (row, totalHours) => formatEfficiencyValue(computePackageDerivedMetrics(row, totalHours).pieceEfficiency)
  },
  {
    key: 'order_efficiency',
    zh: '单效',
    en: 'Order Efficiency',
    width: 'min-w-[128px]',
    render: (row, totalHours) => formatEfficiencyValue(computePackageDerivedMetrics(row, totalHours).orderEfficiency)
  },
  {
    key: 'sla_ratio',
    zh: 'SLA',
    en: 'SLA',
    width: 'min-w-[118px]',
    render: (row, totalHours) => formatRatioValue(computePackageDerivedMetrics(row, totalHours).slaRatio)
  }
];

const normalizeHeaderKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '');

const parseJsonResponse = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
};

const isNetworkFetchError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TypeError') return true;
  return /failed to fetch|networkerror|load failed/i.test(error.message);
};

const getWeekdayLabel = (dateOnly: string) => {
  const date = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '-';
  return WEEKDAY_LABELS[date.getDay()] ?? '-';
};

const isWholeDayInboundComplete = (row: PackageMetricsViewRow | null) => row?.calendar_inbound_final_hour_present === true;

const buildMetricsDisplayRows = (rangeStart: string, rangeEnd: string, rows: PackageMetricsViewRow[]): PackageMetricsDisplayRow[] => {
  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return [];
  const rowByDate = new Map(rows.map((row) => [row.metric_date, row] as const));
  const displayRows: PackageMetricsDisplayRow[] = [];
  let cursor = rangeEnd;

  while (cursor >= rangeStart) {
    const data = rowByDate.get(cursor) ?? null;
    displayRows.push({
      metric_date: cursor,
      weekLabel: getWeekdayLabel(cursor),
      data
    });
    cursor = addDaysDateOnly(cursor, -1);
  }

  return displayRows;
};

const readRowsFromWorkbook = async (file: File): Promise<PackageMetricsParsedRow[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    raw: false,
    cellDates: false,
    dense: true,
    ...(file.name.toLowerCase().endsWith('.csv') ? { codepage: 65001 } : {})
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('The uploaded file does not contain any worksheet.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][];
  if (rawRows.length < 2) {
    throw new Error('The uploaded file does not contain any data rows.');
  }

  const [headers, ...dataRows] = rawRows;
  const headerMap = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeaderKey(header);
    if (normalized) headerMap.set(normalized, index);
  });

  const missingHeaders = PACKAGE_METRICS_REQUIRED_HEADERS.filter((header) => !headerMap.has(normalizeHeaderKey(header)));
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
  }

  const quantityIndex = headerMap.get(normalizeHeaderKey(PACKAGE_METRICS_REQUIRED_HEADERS[0]));
  const inboundAtIndex = headerMap.get(normalizeHeaderKey(PACKAGE_METRICS_REQUIRED_HEADERS[1]));
  const shippingStatusIndex = headerMap.get(normalizeHeaderKey(PACKAGE_METRICS_REQUIRED_HEADERS[2]));
  const packedAtIndex = headerMap.get(normalizeHeaderKey(PACKAGE_METRICS_REQUIRED_HEADERS[3]));

  if (quantityIndex == null || inboundAtIndex == null || shippingStatusIndex == null || packedAtIndex == null) {
    throw new Error('Failed to resolve required worksheet columns.');
  }

  return dataRows.map((row, index) => {
    const rowNumber = index + 2;
    const quantity = parsePackageQuantity(row[quantityIndex]);
    if (quantity == null) {
      throw new Error(`Row ${rowNumber}: 商品数量 is required and must be numeric.`);
    }

    const inboundAt = normalizePackageTimestamp(row[inboundAtIndex]);
    if (!inboundAt) {
      throw new Error(`Row ${rowNumber}: 订单流入时间 is required and must be a valid datetime.`);
    }

    const shippingStatus = String(row[shippingStatusIndex] ?? '').trim();
    if (!shippingStatus) {
      throw new Error(`Row ${rowNumber}: 发货状态 is required.`);
    }

    const packedRaw = row[packedAtIndex];
    const packedText = String(packedRaw ?? '').trim();
    const packedAt = packedText ? normalizePackageTimestamp(packedRaw) : null;
    if (packedText && !packedAt) {
      throw new Error(`Row ${rowNumber}: 打包完成时间 must be a valid datetime when provided.`);
    }

    return {
      quantity,
      inboundAt,
      shippingStatus,
      packedAt
    };
  });
};

const fetchAllRows = async (queryFactory: (from: number, to: number) => any, pageSize = 1000) => {
  const allRows: any[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const res = await queryFactory(from, to);
    if (res.error) throw res.error;
    const page = Array.isArray(res.data) ? res.data : [];
    allRows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
};

const getOperationalDayRange = (workDate: string) => {
  const base = new Date(`${workDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const start = new Date(base);
  start.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const getOverlapHours = (startA: Date, endA: Date, startB: Date, endB: Date) => {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  if (end <= start) return 0;
  return (end - start) / 3600000;
};

const computeSystemHoursByStaff = (punches: PunchRow[], rangeStart: Date, rangeEnd: Date) => {
  const byStaff = new Map<string, Array<{ at: Date; action: 'IN' | 'OUT' }>>();

  for (const row of punches) {
    const staffId = normalizeStaffId(String(row.staff_id ?? ''));
    if (!staffId) continue;
    const at = new Date(String(row.created_at ?? ''));
    if (Number.isNaN(at.getTime())) continue;
    const action = String(row.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
    if (!byStaff.has(staffId)) byStaff.set(staffId, []);
    byStaff.get(staffId)!.push({ at, action });
  }

  const result = new Map<string, number>();
  for (const [staffId, rows] of byStaff.entries()) {
    rows.sort((a, b) => a.at.getTime() - b.at.getTime());
    let openIn: Date | null = null;
    let hours = 0;

    for (const row of rows) {
      if (row.action === 'IN') {
        openIn = row.at;
        continue;
      }
      if (!openIn) continue;
      hours += getOverlapHours(openIn, row.at, rangeStart, rangeEnd);
      openIn = null;
    }

    if (openIn) {
      hours += getOverlapHours(openIn, rangeEnd, rangeStart, rangeEnd);
    }
    result.set(staffId, Math.round(hours * 100) / 100);
  }

  return result;
};

const normalizeTrackedPosition = (value: unknown): string => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'pick') return 'Pick';
  if (normalized === 'pack') return 'Pack';
  if (normalized === 'rebin') return 'Rebin';
  if (normalized === 'preship' || normalized === 'pre ship' || normalized === 'pre-ship') return 'Preship';
  if (normalized === 'transfer') return 'Transfer';
  return '';
};

const fetchEmployeePositions = async (supabase: any, staffIds: string[]) => {
  const result = new Map<string, string>();
  if (!supabase || staffIds.length === 0) return result;

  const batches: string[][] = [];
  for (let index = 0; index < staffIds.length; index += 500) {
    batches.push(staffIds.slice(index, index + 500));
  }

  for (const batch of batches) {
    let response = await supabase.from(EMPLOYEE_TABLE).select('staff_id, position').in('staff_id', batch);
    if (response.error) {
      response = await supabase.from(EMPLOYEE_TABLE).select('staff_id, "Position"').in('staff_id', batch);
    }
    if (response.error) {
      throw new Error(String(response.error.message ?? 'Failed to load employee positions.'));
    }

    for (const row of (response.data as Array<{ staff_id?: string | null; position?: string | null; Position?: string | null }> | null) ?? []) {
      const staffId = normalizeStaffId(String(row.staff_id ?? ''));
      if (!staffId) continue;
      const position = normalizeTrackedPosition(row.position ?? row.Position ?? '');
      if (position) result.set(staffId, position);
    }
  }

  return result;
};

const loadPackageLaborSummaryByDate = async (supabase: any, metricDates: string[]) => {
  const dates = Array.from(new Set(metricDates.filter(Boolean))).sort();
  const result: PackageLaborSummaryByDate = {};
  if (!supabase || dates.length === 0) return result;

  const firstRange = getOperationalDayRange(dates[0]);
  const lastRange = getOperationalDayRange(dates[dates.length - 1]);
  if (!firstRange || !lastRange) return result;

  const windowStart = new Date(firstRange.start.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(lastRange.end.getTime() + 24 * 60 * 60 * 1000);
  const punches = (await fetchAllRows(
    (from, to) =>
      supabase
        .from('ob_punches')
        .select('staff_id, action, created_at')
        .gte('created_at', windowStart.toISOString())
        .lt('created_at', windowEnd.toISOString())
        .order('created_at', { ascending: true })
        .range(from, to),
    1000
  )) as PunchRow[];

  const schedules = (await fetchAllRows(
    (from, to) =>
      supabase
        .from('ob_schedules')
        .select('staff_id, date, position')
        .gte('date', dates[0])
        .lte('date', dates[dates.length - 1])
        .order('date', { ascending: true })
        .range(from, to),
    1000
  )) as ScheduleRow[];

  const lateMarks = (await fetchAllRows(
    (from, to) =>
      supabase
        .from('ob_attendance_marks')
        .select('staff_id, work_date')
        .eq('mark_type', 'late')
        .gte('work_date', dates[0])
        .lte('work_date', dates[dates.length - 1])
        .order('work_date', { ascending: true })
        .range(from, to),
    1000
  )) as AttendanceMarkRow[];

  const staffIds = Array.from(
    new Set(
      [...punches.map((row) => row.staff_id), ...schedules.map((row) => row.staff_id), ...lateMarks.map((row) => row.staff_id)]
        .map((staffId) => normalizeStaffId(String(staffId ?? '')))
        .filter(Boolean)
    )
  );
  const positionByStaff = await fetchEmployeePositions(supabase, staffIds);

  const scheduledStaffByDate = new Map<string, Set<string>>();
  for (const row of schedules) {
    const metricDate = String(row.date ?? '').trim();
    if (!metricDate) continue;
    const staffId = normalizeStaffId(String(row.staff_id ?? ''));
    if (!staffId) continue;
    const position = normalizeTrackedPosition(row.position ?? '') || (positionByStaff.get(staffId) ?? '');
    if (!TRACKED_POSITIONS.has(position)) continue;
    if (!scheduledStaffByDate.has(metricDate)) scheduledStaffByDate.set(metricDate, new Set<string>());
    scheduledStaffByDate.get(metricDate)!.add(staffId);
  }

  const lateStaffByDate = new Map<string, Set<string>>();
  for (const row of lateMarks) {
    const metricDate = String(row.work_date ?? '').trim();
    if (!metricDate) continue;
    const staffId = normalizeStaffId(String(row.staff_id ?? ''));
    if (!staffId) continue;
    const scheduledStaff = scheduledStaffByDate.get(metricDate);
    const position = positionByStaff.get(staffId) ?? '';
    if (!TRACKED_POSITIONS.has(position) && !scheduledStaff?.has(staffId)) continue;
    if (!lateStaffByDate.has(metricDate)) lateStaffByDate.set(metricDate, new Set<string>());
    lateStaffByDate.get(metricDate)!.add(staffId);
  }

  for (const metricDate of dates) {
    const range = getOperationalDayRange(metricDate);
    if (!range) continue;
    const hoursByStaff = computeSystemHoursByStaff(punches, range.start, range.end);
    let totalHours = 0;
    let presentCount = 0;
    for (const [staffId, hours] of hoursByStaff.entries()) {
      if (!TRACKED_POSITIONS.has(positionByStaff.get(staffId) ?? '')) continue;
      totalHours += hours;
      if (hours > 0) presentCount += 1;
    }

    result[metricDate] = {
      scheduledCount: scheduledStaffByDate.get(metricDate)?.size ?? 0,
      presentCount,
      lateCount: lateStaffByDate.get(metricDate)?.size ?? 0,
      earlyLeaveCount: 0,
      totalHours: Math.round(totalHours * 100) / 100
    };
  }

  return result;
};

export default function PackageMetricsPage({
  t,
  isLocked,
  isReadOnly = false,
  canViewConsumables = false,
  canOperateConsumables = false,
  supabase,
  themeMode,
  serverTime
}: PackageMetricsPageProps) {
  const defaultMetricDate = getDateOnlyInTimeZone(serverTime);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const redesignedFileInputRef = useRef<HTMLInputElement | null>(null);
  const [metricDate, setMetricDate] = useState(defaultMetricDate);
  const [rangeStart, setRangeStart] = useState(addDaysDateOnly(defaultMetricDate, -6));
  const [rangeEnd, setRangeEnd] = useState(defaultMetricDate);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<LoadState>({ tone: 'idle', message: '' });
  const [metricsRows, setMetricsRows] = useState<PackageMetricsViewRow[]>([]);
  const [laborSummaryByDate, setLaborSummaryByDate] = useState<PackageLaborSummaryByDate>({});
  const [reasonDialogOpen, setReasonDialogOpen] = useState(false);
  const [unfinishedReason, setUnfinishedReason] = useState('');
  const [dailyReportText, setDailyReportText] = useState('');
  const [reportDialogOpen, setReportDialogOpen] = useState(false);

  const shellClass =
    themeMode === 'light'
      ? 'border border-slate-200 bg-white/90 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.08)]'
      : 'border border-slate-800/80 bg-slate-950/85 text-slate-100 shadow-[0_24px_60px_rgba(2,6,23,0.42)]';
  const mutedClass = themeMode === 'light' ? 'text-slate-500' : 'text-slate-400';
  const subtlePanelClass =
    themeMode === 'light'
      ? 'rounded-2xl border border-slate-200 bg-slate-50'
      : 'rounded-2xl border border-slate-800 bg-slate-900';
  const buttonClass =
    themeMode === 'light'
      ? 'rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300'
      : 'rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 disabled:bg-slate-700 disabled:text-slate-400';
  const secondaryButtonClass =
    themeMode === 'light'
      ? 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'
      : 'rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800';
  const tableHeadClass = themeMode === 'light' ? 'bg-slate-100 text-slate-500' : 'bg-slate-900 text-slate-400';
  const rowBaseClass = themeMode === 'light' ? 'border-t border-slate-200 bg-white' : 'border-t border-slate-800 bg-slate-950/35';
  const rowSelectedClass = themeMode === 'light' ? 'bg-lime-50/70' : 'bg-lime-500/8';
  const cellClass = themeMode === 'light' ? 'text-slate-900' : 'text-slate-100';
  const frozenWrapClass =
    themeMode === 'light'
      ? 'border-r border-slate-200 bg-white shadow-[10px_0_24px_rgba(15,23,42,0.06)]'
      : 'border-r border-slate-800 bg-slate-950 shadow-[10px_0_28px_rgba(2,6,23,0.5)]';

  const statusClass = useMemo(() => {
    if (status.tone === 'success') return themeMode === 'light' ? 'text-emerald-700' : 'text-emerald-300';
    if (status.tone === 'error') return themeMode === 'light' ? 'text-rose-700' : 'text-rose-300';
    return mutedClass;
  }, [mutedClass, status.tone, themeMode]);

  useEffect(() => {
    let cancelled = false;

    const loadMetricsRange = async () => {
      if (!supabase || !rangeStart || !rangeEnd) return;
      setTableLoading(true);

      try {
        const res = await supabase
          .from('ob_package_daily_metrics')
          .select('*')
          .gte('metric_date', rangeStart)
          .lte('metric_date', rangeEnd)
          .order('metric_date', { ascending: false });

        if (res.error) {
          throw new Error(t('读取日报失败，请先执行 SQL 并确认表权限。', 'Failed to load saved metrics. Run the SQL and confirm table access.'));
        }

        const nextRows = ((res.data as PackageDailyMetrics[] | null) ?? []).map((row) => ({
          ...row,
          weekLabel: getWeekdayLabel(row.metric_date)
        }));
        const nextLaborSummary =
          nextRows.length > 0 ? await loadPackageLaborSummaryByDate(supabase, nextRows.map((row) => row.metric_date)) : {};

        if (cancelled) return;
        setMetricsRows(nextRows);
        setLaborSummaryByDate(nextLaborSummary);
        setTableLoading(false);

        if (nextRows.length === 0) {
          setStatus({ tone: 'idle', message: t('当前范围没有日报记录。', 'No saved metrics in the selected range.') });
          return;
        }

        const isMetricDateWithinRange = metricDate >= rangeStart && metricDate <= rangeEnd;
        if (!isMetricDateWithinRange) {
          setMetricDate(nextRows[0].metric_date);
        }
      } catch (error: any) {
        if (cancelled) return;
        setTableLoading(false);
        setMetricsRows([]);
        setLaborSummaryByDate({});
        setStatus({
          tone: 'error',
          message: String(error?.message ?? error ?? t('读取日报失败。', 'Failed to load package metrics.'))
        });
      }
    };

    void loadMetricsRange();
    return () => {
      cancelled = true;
    };
  }, [metricDate, rangeEnd, rangeStart, reloadKey, supabase, t]);

  const selectedMetricsRow = useMemo(
    () => metricsRows.find((row) => row.metric_date === metricDate) ?? null,
    [metricDate, metricsRows]
  );
  const selectedTotalHours = selectedMetricsRow ? laborSummaryByDate[selectedMetricsRow.metric_date]?.totalHours ?? null : null;
  const selectedDerivedMetrics = selectedMetricsRow ? computePackageDerivedMetrics(selectedMetricsRow, selectedTotalHours) : null;
  const selectedSummaryItems = selectedMetricsRow
    ? [
        { label: t('选中日期', 'Selected'), value: selectedMetricsRow.metric_date.replace(/-/g, '/') },
        {
          label: t('考核总量', 'Assessment Orders'),
          value: formatMetricValue('assessment_total_order_count', selectedMetricsRow.assessment_total_order_count)
        },
        {
          label: t('完成单量', 'Completed Orders'),
          value: formatMetricValue('assessment_completed_order_count', selectedMetricsRow.assessment_completed_order_count)
        },
        { label: t('SLA', 'SLA'), value: formatRatioValue(selectedDerivedMetrics?.slaRatio ?? null) },
        { label: t('总工时', 'Hours'), value: formatHoursValue(selectedTotalHours) },
        { label: t('单效', 'Order Efficiency'), value: formatEfficiencyValue(selectedDerivedMetrics?.orderEfficiency ?? null) }
      ]
    : [];
  const uploadDisabled = isLocked || isReadOnly || loading;
  const selectedWeekLabel = selectedMetricsRow?.weekLabel ?? '-';
  const selectedDateLabel = selectedMetricsRow?.metric_date.replace(/-/g, '/') ?? '--/--/--';
  const selectedPrimaryStats = selectedMetricsRow
    ? [
        {
          label: 'Assessment',
          value: formatMetricValue('assessment_total_order_count', selectedMetricsRow.assessment_total_order_count)
        },
        {
          label: 'Completed',
          value: formatMetricValue('assessment_completed_order_count', selectedMetricsRow.assessment_completed_order_count)
        },
        {
          label: 'Inbound',
          value: isWholeDayInboundComplete(selectedMetricsRow)
            ? formatMetricValue('calendar_inbound_order_count', selectedMetricsRow.calendar_inbound_order_count)
            : '-'
        },
        {
          label: 'Backlog',
          value: formatMetricValue('assessment_unfinished_order_count', selectedMetricsRow.assessment_unfinished_order_count)
        }
      ]
    : [];
  const selectedSecondaryStats = selectedMetricsRow
    ? [
        { label: 'SLA', value: formatRatioValue(selectedDerivedMetrics?.slaRatio ?? null) },
        { label: 'Hours', value: formatHoursValue(selectedTotalHours) },
        { label: 'Order Eff.', value: formatEfficiencyValue(selectedDerivedMetrics?.orderEfficiency ?? null) },
        {
          label: 'Multi Ratio',
          value: formatMetricValue('assessment_multi_order_ratio', selectedMetricsRow.assessment_multi_order_ratio)
        }
      ]
    : [];
  const activeFileName = selectedFile?.name ?? t('未选择任何文件', 'No file selected');
  const displayFileName = truncateMiddle(activeFileName, IMPORT_FILE_NAME_MAX_LENGTH);
  const displayRows = useMemo(() => buildMetricsDisplayRows(rangeStart, rangeEnd, metricsRows), [metricsRows, rangeEnd, rangeStart]);

  const handleUpload = async () => {
    if (!supabase || !selectedFile || isLocked || isReadOnly) return;

    setLoading(true);
    try {
      const sessionRes = await supabase.auth.getSession();
      const accessToken = String(sessionRes.data?.session?.access_token ?? '');
      if (!accessToken) {
        throw new Error(t('当前会话已失效，请重新登录。', 'Your session has expired. Sign in again.'));
      }

      const rows = await readRowsFromWorkbook(selectedFile);
      const coverage = inspectPackageMetricsDateCoverage(rows, metricDate);
      if (
        rows.length > 0 &&
        coverage.assessmentInboundRowCount === 0 &&
        coverage.calendarInboundRowCount === 0 &&
        coverage.inboundDateStart &&
        coverage.inboundDateEnd
      ) {
        throw new Error(
          t(
            `当前选择的是 ${metricDate}，但文件中的订单流入日期范围是 ${coverage.inboundDateStart} 到 ${coverage.inboundDateEnd}，所以这一天会算成 0。请改成对应日期后再导入。`,
            `The selected metric date is ${metricDate}, but the file's inbound dates range from ${coverage.inboundDateStart} to ${coverage.inboundDateEnd}. This date would compute to zero. Choose the matching date and import again.`
          )
        );
      }
      const response = await fetch('/api/package-metrics-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          metric_date: metricDate,
          filename: selectedFile.name,
          rows
        })
      });

      const responseText = await response.text();
      const result = parseJsonResponse(responseText);
      if (!response.ok) {
        const serverMessage = String(
          result && typeof result === 'object' ? (result as any).error ?? responseText : responseText || ''
        ).trim();
        const detail = serverMessage || response.statusText || 'Upload failed';
        throw new Error(`Upload failed (${response.status}): ${detail}`);
      }
      if (!result || typeof result !== 'object') {
        throw new Error('The server returned an empty response.');
      }

      const nextMetricDate = String((result as any).metrics?.metric_date ?? metricDate);
      setMetricDate(nextMetricDate);
      if (nextMetricDate < rangeStart) setRangeStart(nextMetricDate);
      if (nextMetricDate > rangeEnd) setRangeEnd(nextMetricDate);
      setReloadKey((value) => value + 1);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (redesignedFileInputRef.current) {
        redesignedFileInputRef.current.value = '';
      }
      setStatus({
        tone: 'success',
        message: t(
          `已完成导入：${(result as any).source_row_count} 行，更新时间 ${new Date((result as any).computed_at).toLocaleString('en-CA', { hour12: false })}`,
          `Imported ${(result as any).source_row_count} rows. Updated at ${new Date((result as any).computed_at).toLocaleString('en-CA', { hour12: false })}`
        )
      });
    } catch (error: any) {
      const message = isNetworkFetchError(error)
        ? t(
            '无法连接导入服务，请检查 `/api/package-metrics-import` 和 Vite 代理 `http://localhost:3000` 是否已启动。',
            'Cannot reach the import API. Check that `/api/package-metrics-import` is available and the Vite proxy target `http://localhost:3000` is running.'
          )
        : String(error?.message ?? error ?? t('导入失败。', 'Import failed.'));
      setStatus({
        tone: 'error',
        message
      });
    } finally {
      setLoading(false);
    }
  };

  const openDailyReport = async (reason: string) => {
    if (!selectedMetricsRow) return;

    try {
      const labor =
        laborSummaryByDate[selectedMetricsRow.metric_date] ??
        ({
          scheduledCount: 0,
          presentCount: 0,
          lateCount: 0,
          earlyLeaveCount: 0,
          totalHours: null
        } satisfies PackageDailyReportLabor);
      const reportText = buildPackageDailyReportText({
        metricDate: selectedMetricsRow.metric_date,
        metrics: selectedMetricsRow,
        labor,
        unfinishedReason: reason || '/',
        stationLabel: 'JDL NYC4'
      });
      setDailyReportText(reportText);
      setReportDialogOpen(true);
      setStatus({
        tone: 'success',
        message: t('日报文本已生成。', 'Daily report text has been generated.')
      });
    } catch (error: any) {
      setStatus({
        tone: 'error',
        message: String(error?.message ?? error ?? t('生成日报失败。', 'Failed to generate daily report.'))
      });
    }
  };

  const handleReportClick = async () => {
    if (!selectedMetricsRow) return;

    if (selectedMetricsRow.assessment_unfinished_order_count > 0) {
      setUnfinishedReason('');
      setReasonDialogOpen(true);
      return;
    }

    await openDailyReport('/');
  };

  return (
    <section className="px-4 py-5 md:px-6 md:py-6">
      <div className={[shellClass, 'rounded-[30px] p-4 md:p-5'].join(' ')}>
        <div className="flex flex-col gap-4">
          <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.55fr)_360px]">
            <div
              className={[
                'overflow-hidden rounded-[28px] border',
                themeMode === 'light'
                  ? 'border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(15,23,42,0.07),transparent_38%),linear-gradient(180deg,rgba(248,250,252,0.99),rgba(241,245,249,0.94))]'
                  : 'border-slate-800/80 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.82))]'
              ].join(' ')}
            >
              <div className="border-b border-white/5 px-5 py-5 md:px-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div className="space-y-2">
                    <div className={['text-[11px] font-semibold uppercase tracking-[0.22em]', mutedClass].join(' ')}>Outbound Desk</div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-display text-[30px] leading-none tracking-[0.05em]">Outbound Daily</h2>
                      <div className="w-[170px]">
                        <StyledDateInput value={metricDate} onChange={setMetricDate} themeMode={themeMode} />
                      </div>
                    </div>
                  </div>
                  <div
                    className={[
                      'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold',
                      themeMode === 'light' ? 'bg-slate-900 text-white' : 'bg-white/10 text-slate-100'
                    ].join(' ')}
                  >
                    {selectedDateLabel} / {selectedWeekLabel}
                  </div>
                </div>
              </div>

              <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
                {selectedPrimaryStats.map((item, index) => (
                  <div
                    key={item.label}
                    className={[
                      'px-5 py-5 md:px-6',
                      index < selectedPrimaryStats.length - 1 ? 'border-b md:border-b-0 md:border-r border-white/5' : ''
                    ].join(' ')}
                  >
                    <div className={['text-[11px] font-semibold uppercase tracking-[0.16em]', mutedClass].join(' ')}>{item.label}</div>
                    <div className="mt-3 text-[30px] font-semibold leading-none">{item.value}</div>
                  </div>
                ))}
              </div>

              {selectedSecondaryStats.length > 0 ? (
                <div
                  className={[
                    'grid gap-px px-3 pb-3 pt-1 md:grid-cols-4',
                    themeMode === 'light' ? 'bg-slate-200/70' : 'bg-white/5'
                  ].join(' ')}
                >
                  {selectedSecondaryStats.map((item) => (
                    <div
                      key={item.label}
                      className={[
                        'px-4 py-4',
                        themeMode === 'light' ? 'bg-white/90' : 'bg-slate-950/40'
                      ].join(' ')}
                    >
                      <div className={['text-[11px] font-semibold uppercase tracking-[0.16em]', mutedClass].join(' ')}>{item.label}</div>
                      <div className="mt-2 text-lg font-semibold">{item.value}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid h-full gap-4">
              <div className={[subtlePanelClass, 'flex h-full min-h-[356px] flex-col rounded-[28px] p-4'].join(' ')}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold">Import</div>
                    <div className={['mt-1 truncate text-sm', mutedClass].join(' ')} title={activeFileName}>
                      {displayFileName}
                    </div>
                  </div>
                  <FileUp className={['h-4 w-4 shrink-0', mutedClass].join(' ')} />
                </div>
                <input
                  ref={redesignedFileInputRef}
                  type="file"
                  disabled={uploadDisabled}
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                <button
                  type="button"
                  disabled={uploadDisabled}
                  onClick={() => redesignedFileInputRef.current?.click()}
                  className={[
                    'mt-4 flex min-h-[154px] w-full items-start justify-between gap-3 rounded-[22px] border px-4 py-4 text-left transition',
                    themeMode === 'light'
                      ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400'
                      : 'border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900 disabled:bg-slate-900 disabled:text-slate-500'
                  ].join(' ')}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Choose file</div>
                    <div className={['mt-1 truncate text-sm', selectedFile ? cellClass : mutedClass].join(' ')} title={activeFileName}>
                      {displayFileName}
                    </div>
                  </div>
                  <ArrowUpRight className={['mt-0.5 h-4 w-4 shrink-0', mutedClass].join(' ')} />
                </button>
                <button
                  type="button"
                  disabled={uploadDisabled || !selectedFile}
                  onClick={handleUpload}
                  className={[buttonClass, 'mt-auto flex w-full items-center justify-center gap-2 rounded-[18px] py-3'].join(' ')}
                >
                  {loading ? (
                    <span
                      className={[
                        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent',
                        themeMode === 'light' ? 'opacity-90' : 'opacity-80'
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  ) : (
                    <FileUp className="h-4 w-4" />
                  )}
                  <span>{loading ? 'Importing...' : 'Upload & Compute'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className={[subtlePanelClass, 'overflow-hidden rounded-[28px] p-0'].join(' ')}>
            <div
              className={[
                'grid gap-4 border-b px-4 py-4 md:px-5 xl:grid-cols-[minmax(0,1fr)_auto]',
                themeMode === 'light' ? 'border-slate-200 bg-white/65' : 'border-slate-800 bg-slate-950/25'
              ].join(' ')}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={[
                      'flex h-10 w-10 items-center justify-center rounded-2xl',
                      themeMode === 'light' ? 'bg-slate-900 text-white' : 'bg-white/10 text-slate-100'
                    ].join(' ')}
                  >
                    <Rows3 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-base font-semibold">Outbound Records</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div
                    className={[
                      'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold',
                      themeMode === 'light' ? 'bg-slate-100 text-slate-700' : 'bg-white/5 text-slate-300'
                    ].join(' ')}
                  >
                    <Package2 className="h-3.5 w-3.5" />
                    {selectedMetricsRow
                      ? `Completed ${formatMetricValue('assessment_completed_order_count', selectedMetricsRow.assessment_completed_order_count)}`
                      : 'No data'}
                  </div>
                  <div
                    className={[
                      'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold',
                      themeMode === 'light' ? 'bg-slate-100 text-slate-700' : 'bg-white/5 text-slate-300'
                    ].join(' ')}
                  >
                    <Clock3 className="h-3.5 w-3.5" />
                    {selectedMetricsRow ? `SLA ${formatRatioValue(selectedDerivedMetrics?.slaRatio ?? null)}` : 'SLA -'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <StyledDateInput value={rangeStart} onChange={setRangeStart} themeMode={themeMode} max={rangeEnd} size="compact" />
                <span className={['text-xs', mutedClass].join(' ')}>to</span>
                <StyledDateInput value={rangeEnd} onChange={setRangeEnd} themeMode={themeMode} min={rangeStart} size="compact" />
                <button type="button" className={buttonClass} onClick={() => void handleReportClick()} disabled={!selectedMetricsRow || tableLoading}>
                  Report
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => {
                    const nextEnd = getDateOnlyInTimeZone(serverTime);
                    setRangeEnd(nextEnd);
                    setRangeStart(addDaysDateOnly(nextEnd, -6));
                  }}
                >
                  Last 7 Days
                </button>
              </div>
            </div>

            <div
              className={[
                'overflow-hidden',
                themeMode === 'light'
                  ? 'bg-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_30px_rgba(15,23,42,0.06)]'
                  : 'bg-slate-950/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_44px_rgba(2,6,23,0.26)]'
              ].join(' ')}
            >
              {displayRows.length === 0 ? (
                <div className={['px-4 py-10 text-center text-sm', mutedClass].join(' ')}>
                  {tableLoading ? 'Loading...' : 'No saved metrics in the selected range.'}
                </div>
              ) : (
                <div className="flex min-w-0">
                  <div className={['shrink-0', frozenWrapClass].join(' ')}>
                    <table className="w-[250px] border-separate border-spacing-0 text-left">
                      <thead className={tableHeadClass}>
                        <tr>
                          <th className="w-[130px] border-b border-r border-slate-800 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em]">
                            Date
                          </th>
                          <th className="w-[120px] border-b border-slate-800 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em]">
                            Week
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayRows.map((row) => {
                          const isSelected = row.metric_date === metricDate;
                          return (
                            <tr key={`frozen-${row.metric_date}`} className={[rowBaseClass, isSelected ? rowSelectedClass : ''].join(' ')}>
                              <td className={['border-r border-slate-800 px-4 py-4 align-middle', cellClass].join(' ')}>
                                <button type="button" className="w-full text-left" onClick={() => setMetricDate(row.metric_date)}>
                                  <div className="text-base font-semibold">{row.metric_date.replace(/-/g, '/')}</div>
                                </button>
                              </td>
                              <td className={['px-4 py-4 align-middle', cellClass].join(' ')}>
                                <div className="text-base font-semibold">{row.weekLabel}</div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="metrics-scroll-fade min-w-0 flex-1 overflow-x-auto metrics-scrollbar">
                    <table className="min-w-[3200px] border-separate border-spacing-0 text-left">
                      <thead className={tableHeadClass}>
                        <tr>
                          {METRIC_COLUMNS.map((column) => (
                            <th
                              key={column.key}
                              className={[column.width, 'border-b border-r border-slate-800 px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] last:border-r-0'].join(' ')}
                            >
                              <div className="truncate">{t(column.zh, column.en)}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {displayRows.map((row) => {
                          const isSelected = row.metric_date === metricDate;
                          const totalHours = row.data ? laborSummaryByDate[row.metric_date]?.totalHours ?? null : null;
                          const hideWholeDayInbound = !isWholeDayInboundComplete(row.data);
                          return (
                            <tr key={`metrics-${row.metric_date}`} className={[rowBaseClass, isSelected ? rowSelectedClass : ''].join(' ')}>
                              {METRIC_COLUMNS.map((column) => (
                                <td
                                  key={`${row.metric_date}-${column.key}`}
                                  className={['border-r border-slate-800 px-4 py-4 align-middle text-center text-base font-semibold last:border-r-0', cellClass].join(' ')}
                                >
                                  {row.data ? column.render(row.data, totalHours, { hideWholeDayInbound }) : '-'}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="hidden">
          <div
            className={[
              'rounded-[24px] border px-4 py-4',
              themeMode === 'light'
                ? 'border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(15,23,42,0.04),transparent_45%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.92))]'
                : 'border-slate-800/80 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.86),rgba(2,6,23,0.74))]'
            ].join(' ')}
          >
            <div className="space-y-1">
              <div className={['text-[11px] font-semibold uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('运营看板', 'Operations')}</div>
              <h2 className="font-display text-[28px] leading-none tracking-[0.06em]">{t('出库日报', 'Outbound Daily')}</h2>
            </div>
          </div>

          <div className="grid gap-3 xl:max-w-[1120px] xl:grid-cols-[180px_minmax(420px,760px)_auto] xl:gap-x-0 xl:justify-start">
            <div>
              <label className={['mb-2 block text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('统计日期', 'Metric Date')}</label>
              <StyledDateInput value={metricDate} onChange={setMetricDate} themeMode={themeMode} />
            </div>
            <div className="xl:max-w-[760px]">
              <label className={['mb-2 block text-xs font-semibold uppercase tracking-[0.14em]', mutedClass].join(' ')}>{t('数据入口', 'Data Entry')}</label>
              <input
                ref={fileInputRef}
                type="file"
                disabled={isLocked || isReadOnly || loading}
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className="sr-only"
              />
              <button
                type="button"
                disabled={isLocked || isReadOnly || loading}
                onClick={() => fileInputRef.current?.click()}
                className={[
                  'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition xl:rounded-r-none xl:border-r-0',
                  themeMode === 'light'
                    ? 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400'
                    : 'border-slate-800 bg-slate-950/90 text-slate-100 hover:border-slate-700 hover:bg-slate-900 disabled:bg-slate-900 disabled:text-slate-500'
                ].join(' ')}
              >
                <span
                  className={[
                    'inline-flex shrink-0 items-center rounded-xl px-3 py-2 text-sm font-semibold',
                    themeMode === 'light' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-950'
                  ].join(' ')}
                >
                  {t('选择文件', 'Choose File')}
                </span>
                <span className={['min-w-0 truncate', selectedFile ? cellClass : mutedClass].join(' ')}>
                  {selectedFile?.name ?? t('未选择任何文件', 'No file selected')}
                </span>
              </button>
            </div>
            <div className="flex items-end gap-2 xl:self-end">
              <button
                type="button"
                disabled={isLocked || isReadOnly || loading || !selectedFile}
                onClick={handleUpload}
                className={[buttonClass, 'min-w-[132px] justify-center xl:min-h-[54px] xl:rounded-l-none'].join(' ')}
              >
                <span className="inline-flex items-center gap-2">
                  {loading ? (
                    <span
                      className={[
                        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent',
                        themeMode === 'light' ? 'opacity-90' : 'opacity-80'
                      ].join(' ')}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span>{loading ? t('导入中...', 'Importing...') : t('上传并计算', 'Upload & Compute')}</span>
                </span>
              </button>
            </div>
          </div>

          {selectedSummaryItems.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              {selectedSummaryItems.map((item) => (
                <div
                  key={item.label}
                  className={[
                    'rounded-2xl px-3 py-3',
                    themeMode === 'light' ? 'bg-slate-50 ring-1 ring-slate-200/70' : 'bg-slate-900/70 ring-1 ring-slate-800/70'
                  ].join(' ')}
                >
                  <div className={['text-[11px] font-semibold uppercase tracking-[0.16em]', mutedClass].join(' ')}>{item.label}</div>
                  <div className="mt-2 text-lg font-semibold">{item.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className={[subtlePanelClass, 'p-3 md:p-4'].join(' ')}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="text-base font-semibold">{t('出库记录', 'Outbound Records')}</div>
                <div className={['text-xs', mutedClass].join(' ')}>{selectedFile ? selectedFile.name : t('未选择文件', 'No file selected')}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StyledDateInput value={rangeStart} onChange={setRangeStart} themeMode={themeMode} max={rangeEnd} size="compact" />
                <span className={['text-xs', mutedClass].join(' ')}>to</span>
                <StyledDateInput value={rangeEnd} onChange={setRangeEnd} themeMode={themeMode} min={rangeStart} size="compact" />
                <button type="button" className={buttonClass} onClick={() => void handleReportClick()} disabled={!selectedMetricsRow || tableLoading}>
                  {t('日报', 'Report')}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => {
                    const nextEnd = getDateOnlyInTimeZone(serverTime);
                    setRangeEnd(nextEnd);
                    setRangeStart(addDaysDateOnly(nextEnd, -6));
                  }}
                >
                  {t('最近7天', 'Last 7 Days')}
                </button>
              </div>
            </div>

            <div
              className={[
                'overflow-hidden rounded-[24px] border',
                themeMode === 'light'
                  ? 'border-slate-200 bg-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_30px_rgba(15,23,42,0.06)]'
                  : 'border-slate-800/80 bg-slate-950/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_44px_rgba(2,6,23,0.26)]'
              ].join(' ')}
            >
              {metricsRows.length === 0 ? (
                <div className={['px-4 py-10 text-center text-sm', mutedClass].join(' ')}>
                  {tableLoading ? t('加载中...', 'Loading...') : t('当前范围没有日报记录。', 'No saved metrics in the selected range.')}
                </div>
              ) : (
                <div className="flex min-w-0">
                  <div className={['shrink-0', frozenWrapClass].join(' ')}>
                    <table className="w-[250px] border-separate border-spacing-0 text-left">
                      <thead className={tableHeadClass}>
                        <tr>
                          <th className="w-[130px] border-b border-r border-slate-800 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em]">
                            {t('日期', 'Date')}
                          </th>
                          <th className="w-[120px] border-b border-slate-800 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em]">
                            {t('工作日', 'Week')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {metricsRows.map((row) => {
                          const isSelected = row.metric_date === metricDate;
                          return (
                            <tr key={`frozen-${row.metric_date}`} className={[rowBaseClass, isSelected ? rowSelectedClass : ''].join(' ')}>
                              <td className={['border-r border-slate-800 px-4 py-4 align-middle', cellClass].join(' ')}>
                                <button type="button" className="w-full text-left" onClick={() => setMetricDate(row.metric_date)}>
                                  <div className="text-base font-semibold">{row.metric_date.replace(/-/g, '/')}</div>
                                </button>
                              </td>
                              <td className={['px-4 py-4 align-middle', cellClass].join(' ')}>
                                <div className="text-base font-semibold">{row.weekLabel}</div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="metrics-scroll-fade min-w-0 flex-1 overflow-x-auto metrics-scrollbar">
                    <table className="min-w-[3200px] border-separate border-spacing-0 text-left">
                      <thead className={tableHeadClass}>
                        <tr>
                          {METRIC_COLUMNS.map((column) => (
                            <th
                              key={column.key}
                              className={[column.width, 'border-b border-r border-slate-800 px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] last:border-r-0'].join(' ')}
                            >
                              <div className="truncate">{t(column.zh, column.en)}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {metricsRows.map((row) => {
                          const isSelected = row.metric_date === metricDate;
                          const totalHours = laborSummaryByDate[row.metric_date]?.totalHours ?? null;
                          return (
                            <tr key={`metrics-${row.metric_date}`} className={[rowBaseClass, isSelected ? rowSelectedClass : ''].join(' ')}>
                              {METRIC_COLUMNS.map((column) => (
                                <td
                                  key={`${row.metric_date}-${column.key}`}
                                  className={['border-r border-slate-800 px-4 py-4 align-middle text-center text-base font-semibold last:border-r-0', cellClass].join(' ')}
                                >
                                  {column.render(row, totalHours)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          </div>

          <ConsumablesWorkspace
            t={t}
            themeMode={themeMode}
            isLocked={isLocked}
            canView={canViewConsumables}
            canOperate={canOperateConsumables}
            supabase={supabase}
            serverTime={serverTime}
          />

          <div className={['pt-1 text-sm', statusClass].join(' ')}>{status.message || '\u00A0'}</div>
        </div>
      </div>

      {reasonDialogOpen ? (
        <div
          className={[
            'fixed inset-0 z-[100] flex items-center justify-center p-4',
            themeMode === 'light' ? 'bg-slate-900/35' : 'bg-black/70'
          ].join(' ')}
          onClick={() => setReasonDialogOpen(false)}
        >
          <div
            className={[
              'w-full max-w-xl rounded-[28px] border p-5 shadow-2xl',
              themeMode === 'light' ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950'
            ].join(' ')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-lg font-semibold">{t('请输入未完成原因', 'Enter unfinished reason')}</div>
            <div className={['mt-2 text-sm', mutedClass].join(' ')}>
              {t('存在未完成考核单量时，日报需要填写原因。', 'Enter a reason when assessment backlog exists.')}
            </div>
            <textarea
              value={unfinishedReason}
              onChange={(event) => setUnfinishedReason(event.target.value)}
              className={[
                'mt-4 min-h-[120px] w-full rounded-2xl border px-4 py-3 text-sm outline-none',
                themeMode === 'light'
                  ? 'border-slate-200 bg-slate-50 text-slate-900'
                  : 'border-slate-800 bg-slate-900 text-slate-100'
              ].join(' ')}
              placeholder={t('填写未完成原因', 'Enter unfinished reason')}
            />
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className={secondaryButtonClass} onClick={() => setReasonDialogOpen(false)}>
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={async () => {
                  setReasonDialogOpen(false);
                  await openDailyReport(unfinishedReason.trim() || '/');
                }}
              >
                {t('确定', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reportDialogOpen ? (
        <div
          className={[
            'fixed inset-0 z-[100] flex items-center justify-center p-4',
            themeMode === 'light' ? 'bg-slate-900/35' : 'bg-black/70'
          ].join(' ')}
          onClick={() => setReportDialogOpen(false)}
        >
          <div
            className={[
              'w-full max-w-4xl rounded-[28px] border p-5 shadow-2xl',
              themeMode === 'light' ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950'
            ].join(' ')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200/20 pb-4">
              <div className="text-lg font-semibold">{t('日报文本', 'Report Text')}</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(dailyReportText);
                      setStatus({
                        tone: 'success',
                        message: t('日报文本已复制到剪贴板。', 'Daily report text has been copied to the clipboard.')
                      });
                    } catch {
                      setStatus({
                        tone: 'error',
                        message: t('复制失败，请手动复制。', 'Copy failed. Please copy the text manually.')
                      });
                    }
                  }}
                >
                  {t('复制', 'Copy')}
                </button>
                <button type="button" className={buttonClass} onClick={() => setReportDialogOpen(false)}>
                  {t('关闭', 'Close')}
                </button>
              </div>
            </div>
            <textarea
              readOnly
              value={dailyReportText}
              className={[
                'min-h-[420px] max-h-[70vh] w-full rounded-2xl border px-4 py-3 text-sm leading-7 outline-none',
                themeMode === 'light'
                  ? 'border-slate-200 bg-slate-50 text-slate-900'
                  : 'border-slate-800 bg-slate-900 text-slate-100'
              ].join(' ')}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
