import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowUpRight, CheckSquare, ChevronDown, ChevronUp, Clock3, Download, FileUp, Package2, Rows3, Save, Shuffle, X, XCircle } from 'lucide-react';
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
import {
  isPackageMetricsStaffingPosition,
  normalizeOutboundStaffingPosition,
  shouldCountScheduledPackageMetricsStaff
} from '../../shared/packageStaffing';
import AdminNoticeToast from '../components/AdminNoticeToast';
import ConsumablesWorkspace from '../components/ConsumablesWorkspace';
import StyledDateInput from '../components/StyledDateInput';

type TranslateFn = (zh: string, en: string) => string;

type PackageMetricsPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  isReadOnly?: boolean;
  mode?: 'metrics' | 'consumables' | 'combined';
  canViewConsumables?: boolean;
  canOperateConsumables?: boolean;
  canManageConsumableItems?: boolean;
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
  category: MetricColumnCategory;
  render: (row: PackageMetricsViewRow, totalHours: number | null, options?: { hideWholeDayInbound?: boolean }) => string;
};

type MetricRangeSummary = Record<string, { average: number | null; total: number | null }>;

type MetricColumnCategory =
  | 'toc_order'
  | 'toc_piece'
  | 'toc_day'
  | 'b2b'
  | 'c2b'
  | 'transfer_day'
  | 'b2b_backlog'
  | 'c2b_backlog'
  | 'summary';

type MetricColumnCategoryOption = {
  key: MetricColumnCategory;
  zh: string;
  en: string;
};

type TransferMetricField = {
  key: keyof PackageDailyMetrics;
  zh: string;
  en: string;
  groupZh: string;
  groupEn: string;
  integerOnly?: boolean;
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
  note?: string | null;
};

type AttendanceMarkRow = {
  staff_id?: string | null;
  work_date?: string | null;
};

type PackageLaborSummaryByDate = Record<string, PackageDailyReportLabor>;

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW) ? Math.max(0, Math.min(23, DAY_CUTOFF_HOUR_RAW)) : 5;
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
const IMPORT_STATUS_AUTO_DISMISS_MS = 3000;
const IMPORT_REQUEST_NETWORK_ERROR = '__package_metrics_import_request_network_error__';
const REQUEST_RETRY_DELAY_MS = 750;

const truncateMiddle = (value: string, maxLength: number) => {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return `${text.slice(0, maxLength)}...`;
  const visible = maxLength - 3;
  const head = Math.ceil(visible * 0.65);
  const tail = Math.floor(visible * 0.35);
  return `${text.slice(0, head)}...${text.slice(text.length - tail)}`;
};

const parseMissingHeaderNames = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return [];
  const match = text.match(/missing required headers:\s*(.+)$/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const isImportRequestNetworkError = (value: unknown) => String(value ?? '').includes(IMPORT_REQUEST_NETWORK_ERROR);

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const isFetchNetworkFailure = (value: unknown) => {
  const text = String(value instanceof Error ? value.message : value ?? '').toLowerCase();
  return text.includes('failed to fetch') || text.includes('networkerror') || text.includes('load failed');
};

const formatNetworkFailureMessage = (t: TranslateFn) =>
  t(
    '连接服务失败。页面停留较久时会话或本地 API 连接可能已断开，请刷新页面后重试。',
    'Connection failed. If this page has been open for a while, refresh it and try again.'
  );

const formatRequestErrorMessage = (error: unknown, t: TranslateFn, fallbackZh: string, fallbackEn: string) => {
  const rawMessage = String((error as { message?: unknown } | null)?.message ?? error ?? '').trim();
  if (isFetchNetworkFailure(rawMessage) || isImportRequestNetworkError(rawMessage)) return formatNetworkFailureMessage(t);
  return rawMessage || t(fallbackZh, fallbackEn);
};

const getFreshAccessToken = async (supabase: any, t: TranslateFn) => {
  const sessionRes = await supabase.auth.getSession();
  let session = sessionRes.data?.session ?? null;
  const expiresAtMs = Number(session?.expires_at ?? 0) * 1000;
  const shouldRefresh = !session?.access_token || (expiresAtMs > 0 && expiresAtMs - Date.now() < 60_000);

  if (shouldRefresh) {
    const refreshRes = await supabase.auth.refreshSession();
    if (refreshRes.error) {
      throw new Error(t('当前会话已失效，请刷新页面后重新登录。', 'Your session has expired. Refresh the page and sign in again.'));
    }
    session = refreshRes.data?.session ?? null;
  }

  const accessToken = String(session?.access_token ?? '');
  if (!accessToken) {
    throw new Error(t('当前会话已失效，请刷新页面后重新登录。', 'Your session has expired. Refresh the page and sign in again.'));
  }
  return accessToken;
};

const fetchWithRetry = async (url: string, init: RequestInit) => {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (!isFetchNetworkFailure(error)) throw error;
    await delay(REQUEST_RETRY_DELAY_MS);
    return await fetch(url, init);
  }
};

const METRIC_COLUMN_CATEGORIES: MetricColumnCategoryOption[] = [
  { key: 'toc_order', zh: 'ToC考核（单量）', en: 'ToC Orders' },
  { key: 'toc_piece', zh: 'ToC考核（件数）', en: 'ToC Pieces' },
  { key: 'toc_day', zh: 'ToC全天', en: 'ToC Day' },
  { key: 'b2b', zh: 'B2B', en: 'B2B' },
  { key: 'c2b', zh: 'C2B', en: 'C2B' },
  { key: 'transfer_day', zh: '全天', en: 'Whole Day' },
  { key: 'b2b_backlog', zh: 'B2B待发货', en: 'B2B Backlog' },
  { key: 'c2b_backlog', zh: 'C2B待发货', en: 'C2B Backlog' },
  { key: 'summary', zh: '总结', en: 'Summary' }
];

const DEFAULT_METRIC_COLUMN_CATEGORIES = METRIC_COLUMN_CATEGORIES.map((item) => item.key);

const getTransferMetricCategory = (field: TransferMetricField): MetricColumnCategory => {
  if (field.groupZh === 'B2B') return 'b2b';
  if (field.groupZh === 'C2B') return 'c2b';
  return 'transfer_day';
};

const getTransferRemainderCategory = (field: TransferMetricField): MetricColumnCategory =>
  field.groupZh === 'B2B' ? 'b2b_backlog' : 'c2b_backlog';

const TRANSFER_METRIC_FIELDS: TransferMetricField[] = [
  {
    key: 'transfer_b2b_inbound_order_count',
    zh: '进单单量',
    en: 'Inbound Orders',
    groupZh: 'B2B',
    groupEn: 'B2B',
    integerOnly: true
  },
  {
    key: 'transfer_b2b_inbound_box_count',
    zh: '进单箱数',
    en: 'Inbound Boxes',
    groupZh: 'B2B',
    groupEn: 'B2B',
    integerOnly: true
  },
  {
    key: 'transfer_b2b_inbound_item_qty',
    zh: '进单件数',
    en: 'Inbound Pieces',
    groupZh: 'B2B',
    groupEn: 'B2B',
    integerOnly: true
  },
  {
    key: 'transfer_b2b_shipped_order_count',
    zh: '发货单量',
    en: 'Shipped Orders',
    groupZh: 'B2B',
    groupEn: 'B2B',
    integerOnly: true
  },
  {
    key: 'transfer_b2b_shipped_box_count',
    zh: '发货箱数',
    en: 'Shipped Boxes',
    groupZh: 'B2B',
    groupEn: 'B2B',
    integerOnly: true
  },
  {
    key: 'transfer_b2b_shipped_item_qty',
    zh: '发货件数',
    en: 'Shipped Pieces',
    groupZh: 'B2B',
    groupEn: 'B2B',
    integerOnly: true
  },
  {
    key: 'transfer_c2b_inbound_order_count',
    zh: '进单单量',
    en: 'Inbound Orders',
    groupZh: 'C2B',
    groupEn: 'C2B',
    integerOnly: true
  },
  {
    key: 'transfer_c2b_inbound_box_count',
    zh: '进单箱数',
    en: 'Inbound Boxes',
    groupZh: 'C2B',
    groupEn: 'C2B',
    integerOnly: true
  },
  {
    key: 'transfer_c2b_inbound_item_qty',
    zh: '进单件数',
    en: 'Inbound Pieces',
    groupZh: 'C2B',
    groupEn: 'C2B',
    integerOnly: true
  },
  {
    key: 'transfer_c2b_shipped_order_count',
    zh: '发货单量',
    en: 'Shipped Orders',
    groupZh: 'C2B',
    groupEn: 'C2B',
    integerOnly: true
  },
  {
    key: 'transfer_c2b_shipped_box_count',
    zh: '发货箱数',
    en: 'Shipped Boxes',
    groupZh: 'C2B',
    groupEn: 'C2B',
    integerOnly: true
  },
  {
    key: 'transfer_c2b_shipped_item_qty',
    zh: '发货件数',
    en: 'Shipped Pieces',
    groupZh: 'C2B',
    groupEn: 'C2B',
    integerOnly: true
  },
  {
    key: 'transfer_whole_day_inbound_box_count',
    zh: '全天进单箱数',
    en: 'Whole-day Inbound Boxes',
    groupZh: '全天',
    groupEn: 'Whole Day',
    integerOnly: true
  },
  {
    key: 'transfer_whole_day_inbound_item_qty',
    zh: '全天进单件数',
    en: 'Whole-day Inbound Pieces',
    groupZh: '全天',
    groupEn: 'Whole Day',
    integerOnly: true
  },
  {
    key: 'transfer_avg_items_per_box',
    zh: '单箱平均件数',
    en: 'Avg Pieces / Box',
    groupZh: '全天',
    groupEn: 'Whole Day'
  }
];

const TRANSFER_REMAINDER_FIELDS: TransferMetricField[] = [
  {
    key: 'transfer_b2b_unshipped_order_count',
    zh: '未发货单量',
    en: 'Unshipped Orders',
    groupZh: 'B2B',
    groupEn: 'B2B',
    integerOnly: true
  },
  {
    key: 'transfer_b2b_unshipped_box_count',
    zh: '未发货箱数',
    en: 'Unshipped Boxes',
    groupZh: 'B2B',
    groupEn: 'B2B',
    integerOnly: true
  },
  {
    key: 'transfer_b2b_unshipped_item_qty',
    zh: '未发货件数',
    en: 'Unshipped Pieces',
    groupZh: 'B2B',
    groupEn: 'B2B',
    integerOnly: true
  },
  {
    key: 'transfer_c2b_unshipped_order_count',
    zh: '未发货单量',
    en: 'Unshipped Orders',
    groupZh: 'C2B',
    groupEn: 'C2B',
    integerOnly: true
  },
  {
    key: 'transfer_c2b_unshipped_box_count',
    zh: '未发货箱数',
    en: 'Unshipped Boxes',
    groupZh: 'C2B',
    groupEn: 'C2B',
    integerOnly: true
  },
  {
    key: 'transfer_c2b_unshipped_item_qty',
    zh: '未发货件数',
    en: 'Unshipped Pieces',
    groupZh: 'C2B',
    groupEn: 'C2B',
    integerOnly: true
  }
];

const createEmptyTransferForm = () =>
  Object.fromEntries(TRANSFER_METRIC_FIELDS.map((field) => [field.key, ''])) as Record<keyof PackageDailyMetrics, string>;

const normalizeTransferInputValue = (value: unknown) => {
  if (value == null || value === '') return '';
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? String(numericValue) : '';
};

const parseTransferFormNumber = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numericValue = Number(text.replace(/,/g, ''));
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
};

const METRIC_COLUMNS: MetricColumn[] = [
  {
    key: 'assessment_single_order_count',
    zh: '考核单品单量',
    en: 'Single Orders',
    width: 'min-w-[148px]',
    category: 'toc_order',
    render: (row) => formatMetricValue('assessment_single_order_count', row.assessment_single_order_count)
  },
  {
    key: 'assessment_multi_order_count',
    zh: '考核多品单量',
    en: 'Multi Orders',
    width: 'min-w-[148px]',
    category: 'toc_order',
    render: (row) => formatMetricValue('assessment_multi_order_count', row.assessment_multi_order_count)
  },
  {
    key: 'assessment_multi_order_ratio',
    zh: '考核多品单比例',
    en: 'Multi Ratio',
    width: 'min-w-[148px]',
    category: 'toc_order',
    render: (row) => formatMetricValue('assessment_multi_order_ratio', row.assessment_multi_order_ratio)
  },
  {
    key: 'assessment_total_order_count',
    zh: '考核订单总量',
    en: 'Total Orders',
    width: 'min-w-[148px]',
    category: 'toc_order',
    render: (row) => formatMetricValue('assessment_total_order_count', row.assessment_total_order_count)
  },
  {
    key: 'assessment_unfinished_order_count',
    zh: '未完成考核订单',
    en: 'Unfinished Orders',
    width: 'min-w-[156px]',
    category: 'toc_order',
    render: (row) => formatMetricValue('assessment_unfinished_order_count', row.assessment_unfinished_order_count)
  },
  {
    key: 'calendar_inbound_order_count',
    zh: '全天进单量',
    en: 'Inbound Orders',
    width: 'min-w-[138px]',
    category: 'toc_day',
    render: (row, _totalHours, options) =>
      options?.hideWholeDayInbound ? '-' : formatMetricValue('calendar_inbound_order_count', row.calendar_inbound_order_count)
  },
  {
    key: 'assessment_single_item_qty',
    zh: '考核单品件数',
    en: 'Single Pieces',
    width: 'min-w-[148px]',
    category: 'toc_piece',
    render: (row) => formatMetricValue('assessment_single_item_qty', row.assessment_single_item_qty)
  },
  {
    key: 'assessment_multi_item_qty',
    zh: '考核多品件数',
    en: 'Multi Pieces',
    width: 'min-w-[148px]',
    category: 'toc_piece',
    render: (row) => formatMetricValue('assessment_multi_item_qty', row.assessment_multi_item_qty)
  },
  {
    key: 'assessment_multi_item_ratio',
    zh: '考核多品件数比例',
    en: 'Multi Piece Ratio',
    width: 'min-w-[148px]',
    category: 'toc_piece',
    render: (row) => formatMetricValue('assessment_multi_item_ratio', row.assessment_multi_item_ratio)
  },
  {
    key: 'assessment_total_item_qty',
    zh: '考核总件数',
    en: 'Total Pieces',
    width: 'min-w-[148px]',
    category: 'toc_day',
    render: (row) => formatMetricValue('assessment_total_item_qty', row.assessment_total_item_qty)
  },
  {
    key: 'calendar_inbound_item_qty',
    zh: '全天进件量',
    en: 'Inbound Pieces',
    width: 'min-w-[138px]',
    category: 'toc_day',
    render: (row, _totalHours, options) =>
      options?.hideWholeDayInbound ? '-' : formatMetricValue('calendar_inbound_item_qty', row.calendar_inbound_item_qty)
  },
  {
    key: 'inventory_qty',
    zh: '库存量',
    en: 'Inventory',
    width: 'min-w-[138px]',
    category: 'summary',
    render: (row) => formatMetricValue('inventory_qty', row.inventory_qty)
  },
  {
    key: 'inventory_conversion_ratio',
    zh: '库存转换率',
    en: 'Inventory Rate',
    width: 'min-w-[138px]',
    category: 'summary',
    render: (row) => formatMetricValue('inventory_conversion_ratio', row.inventory_conversion_ratio)
  },
  {
    key: 'assessment_unfinished_item_qty',
    zh: '未完成考核件数',
    en: 'Unfinished Pieces',
    width: 'min-w-[156px]',
    category: 'toc_piece',
    render: (row) => formatMetricValue('assessment_unfinished_item_qty', row.assessment_unfinished_item_qty)
  },
  {
    key: 'assessment_completed_order_count',
    zh: '考核单完成量',
    en: 'Completed Orders',
    width: 'min-w-[148px]',
    category: 'toc_order',
    render: (row) => formatMetricValue('assessment_completed_order_count', row.assessment_completed_order_count)
  },
  {
    key: 'assessment_completed_item_qty',
    zh: '考核单完成件数',
    en: 'Completed Pieces',
    width: 'min-w-[148px]',
    category: 'toc_piece',
    render: (row) => formatMetricValue('assessment_completed_item_qty', row.assessment_completed_item_qty)
  },
  {
    key: 'calendar_completed_order_count',
    zh: '全天完成单量',
    en: 'Whole-day Orders',
    width: 'min-w-[148px]',
    category: 'toc_day',
    render: (row) => formatMetricValue('calendar_completed_order_count', row.calendar_completed_order_count)
  },
  {
    key: 'calendar_completed_item_qty',
    zh: '全天完成件数',
    en: 'Whole-day Pieces',
    width: 'min-w-[148px]',
    category: 'toc_day',
    render: (row) => formatMetricValue('calendar_completed_item_qty', row.calendar_completed_item_qty)
  },
  {
    key: 'calendar_backlog_order_count',
    zh: '全天剩余积压',
    en: 'Backlog Orders',
    width: 'min-w-[148px]',
    category: 'toc_day',
    render: (row) => formatMetricValue('calendar_backlog_order_count', row.calendar_backlog_order_count)
  },
  {
    key: 'calendar_backlog_item_qty',
    zh: '全天剩余积压件数',
    en: 'Backlog Pieces',
    width: 'min-w-[156px]',
    category: 'toc_day',
    render: (row) => formatMetricValue('calendar_backlog_item_qty', row.calendar_backlog_item_qty)
  },
  ...TRANSFER_METRIC_FIELDS.map((field) => ({
    key: String(field.key),
    zh: `调拨${field.groupZh}${field.zh}`,
    en: `Transfer ${field.groupEn} ${field.en}`,
    width: 'min-w-[156px]',
    category: getTransferMetricCategory(field),
    render: (row: PackageMetricsViewRow) => formatMetricValue(field.key, row[field.key])
  })),
  ...TRANSFER_REMAINDER_FIELDS.map((field) => ({
    key: String(field.key),
    zh: `调拨${field.groupZh}${field.zh}`,
    en: `Transfer ${field.groupEn} ${field.en}`,
    width: 'min-w-[156px]',
    category: getTransferRemainderCategory(field),
    render: (row: PackageMetricsViewRow) => formatMetricValue(field.key, row[field.key])
  })),
  {
    key: 'timecard_hours',
    zh: '总工时',
    en: 'Hours',
    width: 'min-w-[128px]',
    category: 'summary',
    render: (_row, totalHours) => formatHoursValue(totalHours)
  },
  {
    key: 'piece_efficiency',
    zh: '件效',
    en: 'Piece Efficiency',
    width: 'min-w-[128px]',
    category: 'summary',
    render: (row, totalHours) => formatEfficiencyValue(computePackageDerivedMetrics(row, totalHours).pieceEfficiency)
  },
  {
    key: 'order_efficiency',
    zh: '单效',
    en: 'Order Efficiency',
    width: 'min-w-[128px]',
    category: 'summary',
    render: (row, totalHours) => formatEfficiencyValue(computePackageDerivedMetrics(row, totalHours).orderEfficiency)
  },
  {
    key: 'sla_ratio',
    zh: 'SLA',
    en: 'SLA',
    width: 'min-w-[118px]',
    category: 'summary',
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
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const resolvePackageMetricsImportUrls = () => {
  if (typeof window === 'undefined') return ['/api/package-metrics-import'];
  const urls = ['/api/package-metrics-import'];
  if (window.location.hostname === 'localhost' && window.location.port !== '3000') {
    urls.push('http://localhost:3000/api/package-metrics-import');
  }
  return urls;
};

const resolvePackageMetricsTransferUrls = () => {
  if (typeof window === 'undefined') return ['/api/package-metrics-transfer'];
  const urls = ['/api/package-metrics-transfer'];
  if (window.location.hostname === 'localhost' && window.location.port !== '3000') {
    urls.push('http://localhost:3000/api/package-metrics-transfer');
  }
  return urls;
};

const getWeekdayLabel = (dateOnly: string) => {
  const date = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '-';
  return WEEKDAY_LABELS[date.getDay()] ?? '-';
};

const isWholeDayInboundComplete = (row: PackageMetricsViewRow | null) => row?.calendar_inbound_final_hour_present === true;

const isAverageOnlyMetricColumn = (key: string) =>
  key.includes('ratio') || key.includes('efficiency') || key === 'sla_ratio' || key === 'transfer_avg_items_per_box';

const getMetricColumnNumericValue = (
  column: MetricColumn,
  row: PackageMetricsViewRow,
  totalHours: number | null
) => {
  if ((column.key === 'calendar_inbound_order_count' || column.key === 'calendar_inbound_item_qty') && !isWholeDayInboundComplete(row)) {
    return null;
  }
  if (column.key === 'timecard_hours') return totalHours;
  if (column.key === 'piece_efficiency') return computePackageDerivedMetrics(row, totalHours).pieceEfficiency;
  if (column.key === 'order_efficiency') return computePackageDerivedMetrics(row, totalHours).orderEfficiency;
  if (column.key === 'sla_ratio') return computePackageDerivedMetrics(row, totalHours).slaRatio;

  const value = row[column.key as keyof PackageDailyMetrics];
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const buildMetricRangeSummary = (
  rows: PackageMetricsDisplayRow[],
  columns: MetricColumn[],
  laborSummaryByDate: PackageLaborSummaryByDate
): MetricRangeSummary => {
  const summary: MetricRangeSummary = {};

  for (const column of columns) {
    let total = 0;
    let count = 0;

    for (const row of rows) {
      if (!row.data) continue;
      const value = getMetricColumnNumericValue(column, row.data, laborSummaryByDate[row.metric_date]?.totalHours ?? null);
      if (value == null || !Number.isFinite(value)) continue;
      total += value;
      count += 1;
    }

    summary[column.key] = {
      average: count > 0 ? total / count : null,
      total: count > 0 && !isAverageOnlyMetricColumn(column.key) ? total : null
    };
  }

  return summary;
};

const formatMetricSummaryValue = (column: MetricColumn, value: number | null) => {
  if (value == null || !Number.isFinite(value)) return '-';
  if (column.key.includes('ratio') || column.key === 'sla_ratio') return `${(value * 100).toFixed(2)}%`;
  if (column.key.includes('efficiency') || column.key === 'timecard_hours' || column.key === 'transfer_avg_items_per_box') {
    return value.toFixed(2);
  }
  return Math.round(value).toLocaleString('en-US');
};

const applyForecastInventoryToMetricsRows = async (
  supabase: any,
  rows: PackageMetricsViewRow[],
  rangeStart: string,
  rangeEnd: string
): Promise<PackageMetricsViewRow[]> => {
  if (!supabase || rows.length === 0) return rows;

  const inventoryRes = await supabase
    .from('volume_forecast_daily_inputs')
    .select('input_date, inventory_level')
    .gte('input_date', rangeStart)
    .lte('input_date', rangeEnd);

  if (inventoryRes.error) return rows;

  const inventoryByDate = new Map<string, number>();
  for (const row of (inventoryRes.data as Array<{ input_date?: string | null; inventory_level?: number | null }> | null) ?? []) {
    const inputDate = String(row.input_date ?? '').trim();
    const inventoryLevel = Number(row.inventory_level ?? null);
    if (!inputDate || !Number.isFinite(inventoryLevel) || inventoryLevel < 0) continue;
    inventoryByDate.set(inputDate, inventoryLevel);
  }

  if (inventoryByDate.size === 0) return rows;

  return rows.map((row) => {
    if (!inventoryByDate.has(row.metric_date)) return row;
    const inventoryQty = inventoryByDate.get(row.metric_date) ?? 0;
    const inboundItemQty = Number(row.calendar_inbound_item_qty ?? 0);
    return {
      ...row,
      inventory_qty: inventoryQty,
      inventory_conversion_ratio:
        inventoryQty > 0 && Number.isFinite(inboundItemQty) ? Number((inboundItemQty / inventoryQty).toFixed(6)) : null
    };
  });
};

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

const readRowsFromWorkbookBuffer = (buffer: ArrayBuffer, filename: string): PackageMetricsParsedRow[] => {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    raw: false,
    cellDates: false,
    dense: true,
    ...(filename.toLowerCase().endsWith('.csv') ? { codepage: 65001 } : {})
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

const getOperationalMetricDate = (referenceTime: Date) => {
  if (Number.isNaN(referenceTime.getTime())) return '';
  const shifted = new Date(referenceTime);
  shifted.setHours(shifted.getHours() - DAY_CUTOFF_HOUR, 0, 0, 0);
  return getDateOnlyInTimeZone(shifted);
};

const getOverlapHours = (startA: Date, endA: Date, startB: Date, endB: Date) => {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  if (end <= start) return 0;
  return (end - start) / 3600000;
};

const computeSystemHoursByStaff = (punches: PunchRow[], rangeStart: Date, rangeEnd: Date, activeOpenIntervalEnd?: Date | null) => {
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
  const openIntervalEnd =
    activeOpenIntervalEnd && !Number.isNaN(activeOpenIntervalEnd.getTime())
      ? new Date(Math.min(activeOpenIntervalEnd.getTime(), rangeEnd.getTime()))
      : rangeEnd;
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
      hours += getOverlapHours(openIn, openIntervalEnd, rangeStart, rangeEnd);
    }
    result.set(staffId, Math.round(hours * 100) / 100);
  }

  return result;
};

const fetchEmployeePositions = async (supabase: any, staffIds: string[]) => {
  const positionByStaff = new Map<string, string>();
  const activeStaffIds = new Set<string>();
  if (!supabase || staffIds.length === 0) return { positionByStaff, activeStaffIds };

  const batches: string[][] = [];
  for (let index = 0; index < staffIds.length; index += 500) {
    batches.push(staffIds.slice(index, index + 500));
  }

  for (const batch of batches) {
    let response = await supabase.from(EMPLOYEE_TABLE).select('staff_id, active, terminated_at, position').in('staff_id', batch);
    if (response.error) {
      response = await supabase.from(EMPLOYEE_TABLE).select('staff_id, active, terminated_at, "Position"').in('staff_id', batch);
    }
    if (response.error) {
      throw new Error(String(response.error.message ?? 'Failed to load employee positions.'));
    }

    for (const row of (response.data as Array<{
      staff_id?: string | null;
      active?: boolean | null;
      terminated_at?: string | null;
      position?: string | null;
      Position?: string | null;
    }> | null) ?? []) {
      const staffId = normalizeStaffId(String(row.staff_id ?? ''));
      if (!staffId) continue;
      const terminatedAt = String(row.terminated_at ?? '').trim();
      if (terminatedAt) continue;
      if (row.active === false) continue;
      activeStaffIds.add(staffId);
      const position = normalizeOutboundStaffingPosition(row.position ?? row.Position ?? '');
      if (position) positionByStaff.set(staffId, position);
    }
  }

  return { positionByStaff, activeStaffIds };
};

const loadPackageLaborSummaryByDate = async (supabase: any, metricsRows: PackageMetricsViewRow[], serverNow: Date) => {
  const dates = Array.from(new Set(metricsRows.map((row) => row.metric_date).filter(Boolean))).sort();
  const result: PackageLaborSummaryByDate = {};
  if (!supabase || dates.length === 0) return result;
  const metricsByDate = new Map(metricsRows.map((row) => [row.metric_date, row] as const));

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
        .select('staff_id, date, position, note')
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
  const { positionByStaff, activeStaffIds } = await fetchEmployeePositions(supabase, staffIds);

  const scheduledStaffByDate = new Map<string, Set<string>>();
  for (const row of schedules) {
    const metricDate = String(row.date ?? '').trim();
    if (!metricDate) continue;
    const staffId = normalizeStaffId(String(row.staff_id ?? ''));
    if (!staffId) continue;
    if (!activeStaffIds.has(staffId)) continue;
    const position = positionByStaff.get(staffId) ?? '';
    if (!shouldCountScheduledPackageMetricsStaff(position, row.note)) continue;
    if (!scheduledStaffByDate.has(metricDate)) scheduledStaffByDate.set(metricDate, new Set<string>());
    scheduledStaffByDate.get(metricDate)!.add(staffId);
  }

  const lateStaffByDate = new Map<string, Set<string>>();
  for (const row of lateMarks) {
    const metricDate = String(row.work_date ?? '').trim();
    if (!metricDate) continue;
    const staffId = normalizeStaffId(String(row.staff_id ?? ''));
    if (!staffId) continue;
    if (!activeStaffIds.has(staffId)) continue;
    const scheduledStaff = scheduledStaffByDate.get(metricDate);
    const position = positionByStaff.get(staffId) ?? '';
    if (!isPackageMetricsStaffingPosition(position) && !scheduledStaff?.has(staffId)) continue;
    if (!lateStaffByDate.has(metricDate)) lateStaffByDate.set(metricDate, new Set<string>());
    lateStaffByDate.get(metricDate)!.add(staffId);
  }

  const currentOperationalMetricDate = getOperationalMetricDate(serverNow);

  for (const metricDate of dates) {
    const range = getOperationalDayRange(metricDate);
    if (!range) continue;
    const activeOpenIntervalEnd = metricDate === currentOperationalMetricDate ? serverNow : null;
    const hoursByStaff = computeSystemHoursByStaff(punches, range.start, range.end, activeOpenIntervalEnd);
    let totalHours = 0;
    let presentCount = 0;
    const expectedStaff = new Set<string>([
      ...(scheduledStaffByDate.get(metricDate) ?? new Set<string>()),
      ...(lateStaffByDate.get(metricDate) ?? new Set<string>())
    ]);
    for (const [staffId, hours] of hoursByStaff.entries()) {
      if (!activeStaffIds.has(staffId)) continue;
      if (!isPackageMetricsStaffingPosition(positionByStaff.get(staffId) ?? '')) continue;
      totalHours += hours;
      if (hours > 0) {
        presentCount += 1;
        expectedStaff.add(staffId);
      }
    }
    const persistedScheduledHeadcount = Number(metricsByDate.get(metricDate)?.scheduled_headcount ?? null);

    result[metricDate] = {
      scheduledCount: Number.isFinite(persistedScheduledHeadcount) && persistedScheduledHeadcount >= 0 ? persistedScheduledHeadcount : expectedStaff.size,
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
  mode = 'combined',
  canViewConsumables = false,
  canOperateConsumables = false,
  canManageConsumableItems = false,
  supabase,
  themeMode,
  serverTime
}: PackageMetricsPageProps) {
  const defaultMetricDate = getDateOnlyInTimeZone(serverTime);
  const showMetrics = mode === 'metrics' || mode === 'combined';
  const showConsumables = mode === 'consumables' || mode === 'combined';
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
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferForm, setTransferForm] = useState(() => createEmptyTransferForm());
  const [transferInventoryLevel, setTransferInventoryLevel] = useState('');
  const [transferInventoryLoading, setTransferInventoryLoading] = useState(false);
  const [transferRemaindersOpen, setTransferRemaindersOpen] = useState(false);
  const [selectedMetricCategories, setSelectedMetricCategories] = useState<MetricColumnCategory[]>(DEFAULT_METRIC_COLUMN_CATEGORIES);

  const shellClass =
    mode === 'combined'
      ? themeMode === 'light'
      ? 'border border-slate-200 bg-white/90 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.08)]'
      : 'border border-slate-800/80 bg-slate-950/85 text-slate-100 shadow-[0_24px_60px_rgba(2,6,23,0.42)]'
      : themeMode === 'light'
        ? 'text-slate-900'
        : 'text-slate-100';
  const mutedClass = themeMode === 'light' ? 'text-slate-500' : 'text-slate-400';
  const subtlePanelClass =
    themeMode === 'light'
      ? 'rounded-2xl border border-slate-200 bg-slate-50'
      : 'rounded-2xl border border-slate-800 bg-slate-900';
  const magicButtonClass = 'magic-button-surface';
  const buttonClass =
    themeMode === 'light'
      ? [magicButtonClass, 'rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300'].join(' ')
      : [magicButtonClass, 'rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 disabled:bg-slate-700 disabled:text-slate-400'].join(' ');
  const secondaryButtonClass =
    themeMode === 'light'
      ? [magicButtonClass, 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'].join(' ')
      : [magicButtonClass, 'rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800'].join(' ');
  const tableHeadClass = themeMode === 'light' ? 'bg-slate-50 text-slate-500' : 'bg-slate-950/80 text-sky-100/60';
  const tableDividerClass = themeMode === 'light' ? 'border-slate-200/80' : 'border-slate-800/60';
  const rowBaseClass =
    themeMode === 'light'
      ? 'border-b border-slate-200/70 bg-white hover:bg-slate-50/80'
      : 'border-b border-slate-800/55 bg-slate-950/20 hover:bg-slate-900/45';
  const rowSelectedClass = themeMode === 'light' ? 'bg-slate-50' : 'bg-slate-900/70';
  const cellClass = themeMode === 'light' ? 'text-slate-900' : 'text-slate-100';
  const tableBodyRowClass = 'h-11';
  const tableBodyCellClass = 'h-11 px-4 py-0 align-middle';
  const tableSummaryRowClass = 'h-12';
  const tableSummaryCellClass = 'h-12 px-4 py-0 align-middle';
  const frozenWrapClass =
    themeMode === 'light'
      ? 'border-r border-slate-200/80 bg-white'
      : 'border-r border-slate-800/70 bg-slate-950/80';

  useEffect(() => {
    if (!status.message || status.tone === 'idle') return undefined;
    const timer = window.setTimeout(() => {
      setStatus((current) => (current.message === status.message && current.tone === status.tone ? { tone: 'idle', message: '' } : current));
    }, IMPORT_STATUS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [status.message, status.tone]);

  useEffect(() => {
    let cancelled = false;

    const loadMetricsRange = async () => {
      if (!showMetrics || !supabase || !rangeStart || !rangeEnd) return;
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

        const persistedRows = ((res.data as PackageDailyMetrics[] | null) ?? []).map((row) => ({
          ...row,
          weekLabel: getWeekdayLabel(row.metric_date)
        }));
        const nextRows = await applyForecastInventoryToMetricsRows(supabase, persistedRows, rangeStart, rangeEnd);
        const nextLaborSummary = nextRows.length > 0 ? await loadPackageLaborSummaryByDate(supabase, nextRows, serverTime) : {};

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
  }, [metricDate, rangeEnd, rangeStart, reloadKey, serverTime, showMetrics, supabase, t]);

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
  const selectedMetricCategorySet = useMemo(() => new Set(selectedMetricCategories), [selectedMetricCategories]);
  const visibleMetricColumns = useMemo(
    () => METRIC_COLUMNS.filter((column) => selectedMetricCategorySet.has(column.category)),
    [selectedMetricCategorySet]
  );
  const metricRangeSummary = useMemo(
    () => buildMetricRangeSummary(displayRows, visibleMetricColumns, laborSummaryByDate),
    [displayRows, laborSummaryByDate, visibleMetricColumns]
  );
  const metricTableMinWidth = `${Math.max(900, visibleMetricColumns.length * 156)}px`;
  const toggleMetricCategory = (category: MetricColumnCategory) => {
    setSelectedMetricCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category]
    );
  };

  const handleExportRecords = () => {
    if (displayRows.length === 0 || visibleMetricColumns.length === 0) {
      setStatus({ tone: 'error', message: t('没有可导出的日报数据。', 'No records to export.') });
      return;
    }

    const headers = ['Date', 'Week', ...visibleMetricColumns.map((column) => t(column.zh, column.en))];
    const rows = displayRows.map((row) => {
      const totalHours = row.data ? laborSummaryByDate[row.metric_date]?.totalHours ?? null : null;
      const hideWholeDayInbound = !isWholeDayInboundComplete(row.data);
      return [
        row.metric_date.replace(/-/g, '/'),
        row.weekLabel,
        ...visibleMetricColumns.map((column) =>
          row.data ? column.render(row.data, totalHours, { hideWholeDayInbound }) : '-'
        )
      ];
    });
    const summaryRows = [
      [
        t('平均', 'Average'),
        `${rangeStart.replace(/-/g, '/')} - ${rangeEnd.replace(/-/g, '/')}`,
        ...visibleMetricColumns.map((column) => formatMetricSummaryValue(column, metricRangeSummary[column.key]?.average ?? null))
      ],
      [
        t('总合', 'Total'),
        `${rangeStart.replace(/-/g, '/')} - ${rangeEnd.replace(/-/g, '/')}`,
        ...visibleMetricColumns.map((column) => formatMetricSummaryValue(column, metricRangeSummary[column.key]?.total ?? null))
      ]
    ];
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows, ...summaryRows]);
    worksheet['!cols'] = headers.map((header, index) => ({
      wch: index < 2 ? 16 : Math.max(14, String(header).length + 4)
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Outbound Records');
    XLSX.writeFile(workbook, `outbound-records_${rangeStart}_to_${rangeEnd}.xlsx`);
  };

  const handleUpload = async () => {
    if (!supabase || !selectedFile || isLocked || isReadOnly) return;

    setLoading(true);
    try {
      const accessToken = await getFreshAccessToken(supabase, t);

      const fileBuffer = await selectedFile.arrayBuffer();
      const rows = readRowsFromWorkbookBuffer(fileBuffer, selectedFile.name);
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
      const requestBody = JSON.stringify({
        metric_date: metricDate,
        filename: selectedFile.name,
        rows
      });
      const requestInit: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: requestBody
      };
      const importUrls = resolvePackageMetricsImportUrls();
      let response: Response | null = null;
      let lastNetworkError: unknown = null;

      for (let index = 0; index < importUrls.length; index += 1) {
        const url = importUrls[index];
        try {
          response = await fetchWithRetry(url, requestInit);
          lastNetworkError = null;
          break;
        } catch (fetchError) {
          lastNetworkError = fetchError;
          if (index === importUrls.length - 1) {
            const reason = fetchError instanceof Error ? fetchError.message : String(fetchError ?? 'Unknown network failure');
            throw new Error(`${IMPORT_REQUEST_NETWORK_ERROR}: ${reason}`);
          }
        }
      }

      if (!response) {
        const reason =
          lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError ?? 'Import request failed.');
        throw new Error(`${IMPORT_REQUEST_NETWORK_ERROR}: ${reason}`);
      }

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
      const rawMessage = String(error?.message ?? error ?? '');
      const missingHeaders = parseMissingHeaderNames(rawMessage);
      const message =
        missingHeaders.length > 0
          ? t(
              `表格字段缺失，请完善 ${missingHeaders.join('、')} 后重新导入。`,
              `Missing required columns: ${missingHeaders.join(', ')}. Complete them and import again.`
            )
          : formatRequestErrorMessage(error, t, '导入失败。', 'Import failed.');
      setStatus({
        tone: 'error',
        message
      });
    } finally {
      setLoading(false);
    }
  };

  const openTransferDialog = () => {
    const nextForm = createEmptyTransferForm();
    for (const field of TRANSFER_METRIC_FIELDS) {
      nextForm[field.key] = normalizeTransferInputValue(selectedMetricsRow?.[field.key]);
    }
    setTransferForm(nextForm);
    setTransferInventoryLevel(normalizeTransferInputValue(selectedMetricsRow?.inventory_qty));
    setTransferRemaindersOpen(false);
    setTransferDialogOpen(true);

    if (!supabase) return;
    setTransferInventoryLoading(true);
    void supabase
      .from('volume_forecast_daily_inputs')
      .select('inventory_level')
      .eq('input_date', metricDate)
      .maybeSingle()
      .then((res: any) => {
        if (res.error) {
          setStatus({
            tone: 'error',
            message: String(res.error.message ?? t('读取库存量失败。', 'Failed to load inventory.'))
          });
          return;
        }
        setTransferInventoryLevel(normalizeTransferInputValue(res.data?.inventory_level ?? selectedMetricsRow?.inventory_qty));
      })
      .finally(() => setTransferInventoryLoading(false));
  };

  const handleTransferValueChange = (key: keyof PackageDailyMetrics, value: string) => {
    setTransferForm((current) => ({
      ...current,
      [key]: value
    }));
  };

  const transferWholeDayValues = useMemo(() => {
    const inboundBoxes =
      (parseTransferFormNumber(transferForm.transfer_b2b_inbound_box_count) ?? 0) +
      (parseTransferFormNumber(transferForm.transfer_c2b_inbound_box_count) ?? 0);
    const inboundPieces =
      (parseTransferFormNumber(transferForm.transfer_b2b_inbound_item_qty) ?? 0) +
      (parseTransferFormNumber(transferForm.transfer_c2b_inbound_item_qty) ?? 0);
    const avgItemsPerBox = inboundBoxes > 0 ? Number((inboundPieces / inboundBoxes).toFixed(2)) : 0;

    return {
      transfer_whole_day_inbound_box_count: inboundBoxes,
      transfer_whole_day_inbound_item_qty: inboundPieces,
      transfer_avg_items_per_box: avgItemsPerBox
    };
  }, [
    transferForm.transfer_b2b_inbound_box_count,
    transferForm.transfer_b2b_inbound_item_qty,
    transferForm.transfer_c2b_inbound_box_count,
    transferForm.transfer_c2b_inbound_item_qty
  ]);

  const getTransferFieldDisplayValue = (field: TransferMetricField) => {
    if (field.key === 'transfer_whole_day_inbound_box_count') {
      return normalizeTransferInputValue(transferWholeDayValues.transfer_whole_day_inbound_box_count);
    }
    if (field.key === 'transfer_whole_day_inbound_item_qty') {
      return normalizeTransferInputValue(transferWholeDayValues.transfer_whole_day_inbound_item_qty);
    }
    if (field.key === 'transfer_avg_items_per_box') {
      return normalizeTransferInputValue(transferWholeDayValues.transfer_avg_items_per_box);
    }
    return transferForm[field.key] ?? '';
  };

  const buildTransferPayload = () => {
    const values: Partial<Record<keyof PackageDailyMetrics, number | null>> = {};

    for (const field of TRANSFER_METRIC_FIELDS) {
      if (field.key === 'transfer_whole_day_inbound_box_count') {
        values[field.key] = transferWholeDayValues.transfer_whole_day_inbound_box_count;
        continue;
      }
      if (field.key === 'transfer_whole_day_inbound_item_qty') {
        values[field.key] = transferWholeDayValues.transfer_whole_day_inbound_item_qty;
        continue;
      }
      if (field.key === 'transfer_avg_items_per_box') {
        values[field.key] = transferWholeDayValues.transfer_avg_items_per_box;
        continue;
      }
      const rawValue = String(transferForm[field.key] ?? '').trim();
      if (!rawValue) {
        values[field.key] = null;
        continue;
      }
      const numericValue = Number(rawValue.replace(/,/g, ''));
      if (!Number.isFinite(numericValue) || numericValue < 0) {
        throw new Error(t(`${field.groupZh}${field.zh} 必须是非负数字。`, `${field.groupEn} ${field.en} must be a non-negative number.`));
      }
      if (field.integerOnly && !Number.isInteger(numericValue)) {
        throw new Error(t(`${field.groupZh}${field.zh} 必须是整数。`, `${field.groupEn} ${field.en} must be a whole number.`));
      }
      values[field.key] = numericValue;
    }

    return values;
  };

  const buildTransferInventoryPayload = () => {
    const rawValue = String(transferInventoryLevel ?? '').trim();
    if (!rawValue) return null;
    const numericValue = Number(rawValue.replace(/,/g, ''));
    if (!Number.isFinite(numericValue) || numericValue < 0 || !Number.isInteger(numericValue)) {
      throw new Error(t('库存量必须是非负整数。', 'Inventory must be a non-negative whole number.'));
    }
    return numericValue;
  };

  const handleTransferSave = async () => {
    if (!supabase || isLocked || isReadOnly || transferSaving) return;

    setTransferSaving(true);
    try {
      const accessToken = await getFreshAccessToken(supabase, t);

      const requestInit: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          metric_date: metricDate,
          values: buildTransferPayload(),
          inventory_level: buildTransferInventoryPayload()
        })
      };
      let response: Response | null = null;
      let lastNetworkError: unknown = null;

      for (const url of resolvePackageMetricsTransferUrls()) {
        try {
          response = await fetchWithRetry(url, requestInit);
          lastNetworkError = null;
          break;
        } catch (fetchError) {
          lastNetworkError = fetchError;
        }
      }

      if (!response) {
        const reason =
          lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError ?? 'Transfer save request failed.');
        throw new Error(reason);
      }

      const responseText = await response.text();
      const result = parseJsonResponse(responseText);
      if (!response.ok) {
        const serverMessage = String(
          result && typeof result === 'object' ? (result as any).error ?? responseText : responseText || ''
        ).trim();
        throw new Error(serverMessage || response.statusText || t('保存调拨数据失败。', 'Failed to save transfer data.'));
      }

      setTransferDialogOpen(false);
      setReloadKey((value) => value + 1);
      setStatus({
        tone: 'success',
        message: t('调拨数据已保存。', 'Transfer data saved.')
      });
    } catch (error: any) {
      setStatus({
        tone: 'error',
        message: formatRequestErrorMessage(error, t, '保存调拨数据失败。', 'Failed to save transfer data.')
      });
    } finally {
      setTransferSaving(false);
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
    <>
      <div className={mode === 'consumables' ? shellClass : ['w-full px-4 py-4 md:px-5', shellClass].join(' ')}>
        <div className="flex flex-col gap-4">
          {showMetrics ? (
          <>
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
                    magicButtonClass,
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
                'grid gap-4 border-b px-4 py-4 md:px-5 xl:grid-cols-[minmax(280px,1fr)_auto]',
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
                <button
                  type="button"
                  className={[
                    secondaryButtonClass,
                    'inline-flex min-h-10 items-center gap-2 rounded-2xl px-4'
                  ].join(' ')}
                  onClick={openTransferDialog}
                  disabled={isLocked || isReadOnly || transferSaving}
                >
                  <Shuffle className="h-4 w-4" />
                  <span>{t('调拨数据', 'Transfer')}</span>
                </button>
                <div
                  className={[
                    'inline-flex items-center gap-2 rounded-2xl border p-1',
                    themeMode === 'light' ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950/70'
                  ].join(' ')}
                >
                  <StyledDateInput value={rangeStart} onChange={setRangeStart} themeMode={themeMode} max={rangeEnd} size="compact" />
                  <span className={['px-1 text-xs font-semibold', mutedClass].join(' ')}>to</span>
                  <StyledDateInput value={rangeEnd} onChange={setRangeEnd} themeMode={themeMode} min={rangeStart} size="compact" />
                </div>
                <button type="button" className={[buttonClass, 'min-h-10 rounded-2xl px-4'].join(' ')} onClick={() => void handleReportClick()} disabled={!selectedMetricsRow || tableLoading}>
                  Report
                </button>
                <button
                  type="button"
                  className={[secondaryButtonClass, 'inline-flex min-h-10 items-center gap-2 rounded-2xl px-4'].join(' ')}
                  onClick={handleExportRecords}
                  disabled={tableLoading || displayRows.length === 0 || visibleMetricColumns.length === 0}
                >
                  <Download className="h-4 w-4" />
                  <span>{t('导出', 'Export')}</span>
                </button>
                <button
                  type="button"
                  className={[secondaryButtonClass, 'min-h-10 rounded-2xl px-4'].join(' ')}
                  onClick={() => {
                    const nextEnd = getDateOnlyInTimeZone(serverTime);
                    setRangeEnd(nextEnd);
                    setRangeStart(addDaysDateOnly(nextEnd, -6));
                  }}
                >
                  Last 7 Days
                </button>
              </div>

              <div
                className={[
                  'rounded-[22px] border p-2 xl:col-span-2',
                  themeMode === 'light' ? 'border-slate-200 bg-white/80' : 'border-slate-800 bg-slate-950/45'
                ].join(' ')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={[
                      'inline-flex items-center gap-1 rounded-2xl border p-1',
                      themeMode === 'light' ? 'border-slate-200 bg-slate-50' : 'border-slate-800 bg-slate-900/70'
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      className={[
                        'inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition',
                        themeMode === 'light' ? 'text-slate-700 hover:bg-white' : 'text-slate-200 hover:bg-slate-800'
                      ].join(' ')}
                      onClick={() => setSelectedMetricCategories(DEFAULT_METRIC_COLUMN_CATEGORIES)}
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                      <span>{t('全选', 'All')}</span>
                    </button>
                    <button
                      type="button"
                      className={[
                        'inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition',
                        themeMode === 'light' ? 'text-slate-700 hover:bg-white' : 'text-slate-200 hover:bg-slate-800'
                      ].join(' ')}
                      onClick={() => setSelectedMetricCategories([])}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>{t('清空', 'Clear')}</span>
                    </button>
                  </div>
                  {METRIC_COLUMN_CATEGORIES.map((category) => {
                    const checked = selectedMetricCategorySet.has(category.key);
                    return (
                      <label
                        key={category.key}
                        className={[
                          'inline-flex h-9 cursor-pointer items-center gap-2 rounded-2xl border px-3 text-xs font-semibold transition',
                          checked
                            ? themeMode === 'light'
                              ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                              : 'border-slate-200 bg-slate-100 text-slate-950'
                            : themeMode === 'light'
                              ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                              : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                        ].join(' ')}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMetricCategory(category.key)}
                          className="h-3.5 w-3.5 accent-current"
                        />
                        <span>{t(category.zh, category.en)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div
              className={[
                'overflow-hidden',
                themeMode === 'light'
                  ? 'bg-white'
                  : 'bg-slate-950/45'
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
                          <th className={['w-[130px] border-b border-r px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em]', tableDividerClass].join(' ')}>
                            Date
                          </th>
                          <th className={['w-[120px] border-b px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em]', tableDividerClass].join(' ')}>
                            Week
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayRows.map((row) => {
                          const isSelected = row.metric_date === metricDate;
                          return (
                            <tr key={`frozen-${row.metric_date}`} className={[tableBodyRowClass, rowBaseClass, isSelected ? rowSelectedClass : ''].join(' ')}>
                              <td className={[tableBodyCellClass, 'border-r', tableDividerClass, cellClass].join(' ')}>
                                <button type="button" className="w-full text-left" onClick={() => setMetricDate(row.metric_date)}>
                                  <div className="text-[15px] font-semibold tabular-nums">{row.metric_date.replace(/-/g, '/')}</div>
                                </button>
                              </td>
                              <td className={[tableBodyCellClass, cellClass].join(' ')}>
                                <div className="text-[15px] font-semibold">{row.weekLabel}</div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        {[
                          { key: 'average', label: t('平均', 'Average') },
                          { key: 'total', label: t('总合', 'Total') }
                        ].map((item) => (
                          <tr
                            key={`frozen-summary-${item.key}`}
                            className={[
                              tableSummaryRowClass,
                              'border-t',
                              themeMode === 'light' ? 'border-slate-200 bg-slate-100/80' : 'border-slate-700/80 bg-slate-900/80'
                            ].join(' ')}
                          >
                            <td className={[tableSummaryCellClass, 'border-r', tableDividerClass, cellClass].join(' ')}>
                              <div className="text-[15px] font-semibold">{item.label}</div>
                            </td>
                            <td className={[tableSummaryCellClass, mutedClass].join(' ')}>
                              <div className="whitespace-nowrap text-xs font-semibold">
                                {rangeStart.replace(/-/g, '/')} - {rangeEnd.slice(5).replace(/-/g, '/')}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tfoot>
                    </table>
                  </div>

                  <div className="metrics-scroll-fade min-w-0 flex-1 overflow-x-auto metrics-scrollbar">
                    {visibleMetricColumns.length === 0 ? (
                      <div className={['flex min-h-[360px] items-center justify-center px-6 text-sm font-semibold', mutedClass].join(' ')}>
                        {t('未选择分类', 'No columns selected')}
                      </div>
                    ) : (
                      <table className="border-separate border-spacing-0 text-left" style={{ minWidth: metricTableMinWidth }}>
                        <thead className={tableHeadClass}>
                          <tr>
                            {visibleMetricColumns.map((column) => (
                              <th
                                key={column.key}
                                className={[column.width, 'border-b border-r px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] last:border-r-0', tableDividerClass].join(' ')}
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
                              <tr key={`metrics-${row.metric_date}`} className={[tableBodyRowClass, rowBaseClass, isSelected ? rowSelectedClass : ''].join(' ')}>
                                {visibleMetricColumns.map((column) => (
                                  <td
                                    key={`${row.metric_date}-${column.key}`}
                                    className={[tableBodyCellClass, 'border-r text-center text-[15px] font-semibold tabular-nums last:border-r-0', tableDividerClass, cellClass].join(' ')}
                                  >
                                    {row.data ? column.render(row.data, totalHours, { hideWholeDayInbound }) : '-'}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          {[
                            { key: 'average' as const },
                            { key: 'total' as const }
                          ].map((item) => (
                            <tr
                              key={`metrics-summary-${item.key}`}
                              className={[
                                tableSummaryRowClass,
                                'border-t',
                                themeMode === 'light' ? 'border-slate-200 bg-slate-100/80' : 'border-slate-700/80 bg-slate-900/80'
                              ].join(' ')}
                            >
                              {visibleMetricColumns.map((column) => (
                                <td
                                  key={`summary-${item.key}-${column.key}`}
                                  className={[tableSummaryCellClass, 'border-r text-center text-[15px] font-semibold tabular-nums last:border-r-0', tableDividerClass, cellClass].join(' ')}
                                >
                                  {formatMetricSummaryValue(column, metricRangeSummary[column.key]?.[item.key] ?? null)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tfoot>
                      </table>
                    )}
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
                  magicButtonClass,
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
                    {visibleMetricColumns.length === 0 ? (
                      <div className={['flex min-h-[360px] items-center justify-center px-6 text-sm font-semibold', mutedClass].join(' ')}>
                        {t('未选择分类', 'No columns selected')}
                      </div>
                    ) : (
                      <table className="border-separate border-spacing-0 text-left" style={{ minWidth: metricTableMinWidth }}>
                        <thead className={tableHeadClass}>
                          <tr>
                            {visibleMetricColumns.map((column) => (
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
                                {visibleMetricColumns.map((column) => (
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
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          </div>
          </>
          ) : null}

          {showConsumables ? (
            <ConsumablesWorkspace
              t={t}
              themeMode={themeMode}
              isLocked={isLocked}
              canView={canViewConsumables}
              canOperate={canOperateConsumables}
              canManageItems={canManageConsumableItems}
              supabase={supabase}
              serverTime={serverTime}
              onStatus={setStatus}
              flush={mode !== 'combined'}
            />
          ) : null}

        </div>
      </div>

      <AdminNoticeToast
        open={Boolean(status.message && status.tone !== 'idle')}
        tone={status.tone}
        message={status.message}
        themeMode={themeMode}
        onClose={() => setStatus({ tone: 'idle', message: '' })}
      />

      {transferDialogOpen ? (
        <div
          className={[
            'fixed inset-0 z-[100] flex items-center justify-center p-4',
            themeMode === 'light' ? 'bg-slate-900/35' : 'bg-black/70'
          ].join(' ')}
        >
          <div
            className={[
              'max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-[28px] border shadow-2xl',
              themeMode === 'light' ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-950'
            ].join(' ')}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className={[
                'flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4',
                themeMode === 'light' ? 'border-slate-200' : 'border-slate-800'
              ].join(' ')}
            >
              <div className="flex items-center gap-3">
                <div
                  className={[
                    'flex h-10 w-10 items-center justify-center rounded-2xl',
                    themeMode === 'light' ? 'bg-slate-900 text-white' : 'bg-white/10 text-slate-100'
                  ].join(' ')}
                >
                  <Shuffle className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-lg font-semibold">{t('调拨数据', 'Transfer')}</div>
                  <div className={['mt-0.5 text-xs font-semibold', mutedClass].join(' ')}>
                    {metricDate.replace(/-/g, '/')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="grid min-w-[220px] gap-1">
                  <span className={['text-xs font-semibold', mutedClass].join(' ')}>{t('库存量', 'Inventory')}</span>
                  <input
                    value={transferInventoryLevel}
                    onChange={(event) => setTransferInventoryLevel(event.target.value)}
                    disabled={transferSaving || transferInventoryLoading}
                    inputMode="numeric"
                    className={[
                      'h-10 w-full rounded-2xl border px-3 text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                      themeMode === 'light'
                        ? 'border-slate-200 bg-white text-slate-900 focus:border-slate-400'
                        : 'border-slate-800 bg-slate-950 text-slate-100 focus:border-slate-600'
                    ].join(' ')}
                  />
                </label>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setTransferDialogOpen(false)}
                  disabled={transferSaving}
                  aria-label={t('关闭', 'Close')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[calc(90vh-150px)] overflow-y-auto px-5 py-5">
              <div className="grid gap-4 lg:grid-cols-3">
                {['B2B', 'C2B', '全天'].map((groupZh) => {
                  const groupFields = TRANSFER_METRIC_FIELDS.filter((field) => field.groupZh === groupZh);
                  const remainderFields = TRANSFER_REMAINDER_FIELDS.filter((field) => field.groupZh === groupZh);
                  const groupEn = groupFields[0]?.groupEn ?? groupZh;
                  return (
                    <div
                      key={groupZh}
                      className={[
                        'rounded-[24px] border p-4',
                        themeMode === 'light' ? 'border-slate-200 bg-slate-50/75' : 'border-slate-800 bg-slate-900/40'
                      ].join(' ')}
                    >
                      <div className="mb-4 text-sm font-semibold">{t(groupZh, groupEn)}</div>
                      <div className="grid gap-3">
                        {groupFields.map((field) => (
                          <label key={String(field.key)} className="grid gap-1.5">
                            <span className={['text-xs font-semibold', mutedClass].join(' ')}>{t(field.zh, field.en)}</span>
                            <input
                              value={getTransferFieldDisplayValue(field)}
                              inputMode="decimal"
                              readOnly={field.groupZh === '全天'}
                              disabled={transferSaving || field.groupZh === '全天'}
                              onChange={(event) => handleTransferValueChange(field.key, event.target.value)}
                              className={[
                                'h-11 w-full rounded-2xl border px-3 text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-100',
                                field.groupZh === '全天'
                                  ? themeMode === 'light'
                                    ? 'border-slate-200 bg-slate-100 text-slate-700'
                                    : 'border-slate-800 bg-slate-900/70 text-slate-300'
                                  : themeMode === 'light'
                                    ? 'border-slate-200 bg-white text-slate-900 focus:border-slate-400'
                                    : 'border-slate-800 bg-slate-950 text-slate-100 focus:border-slate-600'
                              ].join(' ')}
                            />
                          </label>
                        ))}
                        {remainderFields.length > 0 ? (
                          <div
                            className={[
                              'mt-1 border-t pt-3',
                              themeMode === 'light' ? 'border-slate-200' : 'border-slate-800'
                            ].join(' ')}
                          >
                            <button
                              type="button"
                              className={[
                                'flex h-9 w-full items-center justify-between rounded-2xl border px-3 text-xs font-semibold transition',
                                themeMode === 'light'
                                  ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                  : 'border-slate-800 bg-slate-950/80 text-slate-300 hover:bg-slate-900'
                              ].join(' ')}
                              onClick={() => setTransferRemaindersOpen((value) => !value)}
                              aria-expanded={transferRemaindersOpen}
                            >
                              <span>{transferRemaindersOpen ? t('隐藏未发货', 'Hide Backlog') : t('展开未发货', 'Show Backlog')}</span>
                              {transferRemaindersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            {transferRemaindersOpen ? (
                              <div className="mt-3 grid gap-3">
                                {remainderFields.map((field) => (
                                  <label key={String(field.key)} className="grid gap-1.5">
                                    <span className={['text-xs font-semibold', mutedClass].join(' ')}>{t(field.zh, field.en)}</span>
                                    <input
                                      value={normalizeTransferInputValue(selectedMetricsRow?.[field.key])}
                                      readOnly
                                      disabled
                                      className={[
                                        'h-11 w-full rounded-2xl border px-3 text-sm font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-100',
                                        themeMode === 'light'
                                          ? 'border-slate-200 bg-slate-100 text-slate-700'
                                          : 'border-slate-800 bg-slate-900/70 text-slate-300'
                                      ].join(' ')}
                                    />
                                  </label>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className={[
                'flex justify-end gap-3 border-t px-5 py-4',
                themeMode === 'light' ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800 bg-slate-950'
              ].join(' ')}
            >
              <button type="button" className={secondaryButtonClass} onClick={() => setTransferDialogOpen(false)} disabled={transferSaving}>
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                className={[buttonClass, 'inline-flex items-center gap-2'].join(' ')}
                onClick={() => void handleTransferSave()}
                disabled={transferSaving}
              >
                {transferSaving ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>{transferSaving ? t('保存中...', 'Saving...') : t('保存', 'Save')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
    </>
  );
}
