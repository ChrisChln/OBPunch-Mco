export const EXCEPTION_TYPES = ['over_pick', 'short_pick', 'wrong_pick', 'short_shipment'] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  over_pick: 'Over Pick',
  short_pick: 'Less Pick',
  wrong_pick: 'Wrong Pick',
  short_shipment: 'Short Pick'
};

export const formatExceptionType = (value: unknown) => {
  const normalized = normalizeExceptionType(value);
  return normalized ? EXCEPTION_TYPE_LABELS[normalized] : '';
};

export const EXCEPTION_STATUSES = ['Open', 'Processing', 'Pending Adjustment', 'Resolved', 'Closed'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const EXCEPTION_STATUS_LABELS: Record<ExceptionStatus, string> = {
  Open: '已创建',
  Processing: '处理中',
  'Pending Adjustment': '待调整',
  Resolved: '已处理',
  Closed: '取消'
};

export type ResponsibilityResult = 'pending' | 'responsible' | 'no_responsibility';

export type ExceptionReportInput = {
  report_date: string;
  exception_type: ExceptionType | string;
  product_barcode: string;
  picking_list_number: string;
  picking_container: string;
  picking_operator: string;
  packing_rebin_operator?: string | null;
  picked_location: string;
  system_location_qty: number | string;
  actual_qty: number | string;
  count_by: string;
  borrowed_location?: string | null;
  borrowed_qty?: number | string | null;
  inventory_adjustment: boolean;
  submitted_by_lead_id: string;
  lead_pin?: string;
  resolution_note?: string | null;
};

export type ExceptionReportRecord = Omit<ExceptionReportInput, 'lead_pin' | 'exception_type' | 'system_location_qty' | 'actual_qty' | 'borrowed_qty'> & {
  id: number | string;
  exception_type: ExceptionType | string | null;
  system_location_qty: number | null;
  actual_qty: number | null;
  borrowed_qty: number | null;
  status: ExceptionStatus;
  resolution_note: string | null;
  responsible_staff_id: string | null;
  responsibility_result: ResponsibilityResult;
  mistake_report_id: number | string | null;
  created_at: string | null;
  updated_at: string | null;
  processed_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
};

export type ExceptionReportPrintField = {
  label: string;
  value: string;
};

export type ExceptionReportPrintQrField = ExceptionReportPrintField & {
  key: 'product' | 'pickingList' | 'container';
};

export type ExceptionReportPrintPayload = {
  title: string;
  reportId: string;
  status: ExceptionStatus;
  reportDate: string;
  createdBy: string;
  qrValue: string;
  qrFields: ExceptionReportPrintQrField[];
  fields: ExceptionReportPrintField[];
};

export type ExceptionReportStaffNameResolver = (staffId: string) => string;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const trimText = (value: unknown) => String(value ?? '').trim();

const formatPrintDateTime = (value: unknown, fallbackDate: string) => {
  const date = new Date(String(value ?? ''));
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }
  return fallbackDate;
};

export const normalizeExceptionType = (value: unknown): ExceptionType | null => {
  const normalized = trimText(value).toLowerCase();
  return EXCEPTION_TYPES.includes(normalized as ExceptionType) ? (normalized as ExceptionType) : null;
};

export const normalizeExceptionStatus = (value: unknown): ExceptionStatus | null => {
  const normalized = trimText(value);
  return EXCEPTION_STATUSES.includes(normalized as ExceptionStatus) ? (normalized as ExceptionStatus) : null;
};

export const isValidExceptionTransition = (from: ExceptionStatus, to: ExceptionStatus) => {
  if (from === to) return true;
  if (to === 'Closed') return true;
  if (from === 'Closed' && to === 'Open') return true;
  if (from === 'Processing' && to === 'Resolved') return true;
  const order: ExceptionStatus[] = ['Open', 'Processing', 'Pending Adjustment', 'Resolved', 'Closed'];
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  return toIndex === fromIndex + 1;
};

export const needsInventoryAdjustment = (input: Pick<ExceptionReportInput, 'borrowed_location' | 'inventory_adjustment'>) =>
  Boolean(trimText(input.borrowed_location)) && !Boolean(input.inventory_adjustment);

export const parseNonNegativeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return null;
  return next;
};

export const validateExceptionReportInput = (input: ExceptionReportInput): string[] => {
  const errors: string[] = [];
  if (!DATE_ONLY_PATTERN.test(trimText(input.report_date))) errors.push('Date must use YYYY-MM-DD.');
  if (!trimText(input.product_barcode)) errors.push('Product barcode is required.');
  if (!trimText(input.picking_list_number)) errors.push('Picking list number is required.');
  if (trimText(input.system_location_qty) && parseNonNegativeNumber(input.system_location_qty) === null) errors.push('System location qty must be a non-negative number.');
  if (trimText(input.actual_qty) && parseNonNegativeNumber(input.actual_qty) === null) errors.push('Actual qty must be a non-negative number.');

  const borrowedLocation = trimText(input.borrowed_location);
  const borrowedQty = parseNonNegativeNumber(input.borrowed_qty);
  if (borrowedLocation && borrowedQty === null) errors.push('Borrowed qty is required when borrowed location is filled.');
  if (!borrowedLocation && trimText(input.borrowed_qty)) errors.push('Borrowed location is required when borrowed qty is filled.');
  return errors;
};

export const buildExceptionInsertPayload = (input: ExceptionReportInput) => {
  const exceptionType = normalizeExceptionType(input.exception_type);
  const systemQty = trimText(input.system_location_qty) ? parseNonNegativeNumber(input.system_location_qty) : null;
  const actualQty = trimText(input.actual_qty) ? parseNonNegativeNumber(input.actual_qty) : null;
  const borrowedLocation = trimText(input.borrowed_location);
  const borrowedQty = borrowedLocation ? parseNonNegativeNumber(input.borrowed_qty) : null;

  return {
    report_date: trimText(input.report_date),
    exception_type: exceptionType,
    product_barcode: trimText(input.product_barcode).toUpperCase(),
    picking_list_number: trimText(input.picking_list_number),
    picking_container: trimText(input.picking_container),
    picking_operator: trimText(input.picking_operator).toUpperCase(),
    packing_rebin_operator: trimText(input.packing_rebin_operator) || null,
    picked_location: trimText(input.picked_location).toUpperCase(),
    system_location_qty: systemQty,
    actual_qty: actualQty,
    count_by: trimText(input.count_by).toUpperCase(),
    borrowed_location: borrowedLocation ? borrowedLocation.toUpperCase() : null,
    borrowed_qty: borrowedQty,
    inventory_adjustment: Boolean(input.inventory_adjustment),
    submitted_by_lead_id: trimText(input.submitted_by_lead_id).toUpperCase(),
    resolution_note: trimText(input.resolution_note) || null
  };
};

export const buildExceptionUpdatePayload = (input: ExceptionReportInput) => {
  const payload = buildExceptionInsertPayload(input);
  if (!payload) return null;
  return payload;
};

const resolvePrintStaffName = (value: unknown, resolveStaffName?: ExceptionReportStaffNameResolver) => {
  const staffId = trimText(value);
  if (!staffId) return '';
  return trimText(resolveStaffName?.(staffId)) || staffId;
};

export const buildExceptionPrintPayload = (
  report: ExceptionReportRecord,
  origin = '',
  resolveStaffName?: ExceptionReportStaffNameResolver
): ExceptionReportPrintPayload => {
  const reportId = String(report.id ?? '').trim();
  const qrValue = origin ? `${origin.replace(/\/$/, '')}/exception?id=${encodeURIComponent(reportId)}` : `EXCEPTION:${reportId}`;
  const borrowed = report.borrowed_location
    ? `${report.borrowed_location} / ${report.borrowed_qty ?? ''}`
    : '';
  return {
    title: 'Exception',
    reportId,
    status: report.status,
    reportDate: formatPrintDateTime(report.created_at, report.report_date),
    createdBy: resolvePrintStaffName(report.submitted_by_lead_id, resolveStaffName),
    qrValue,
    qrFields: [
      { key: 'product', label: 'Product', value: report.product_barcode || '' },
      { key: 'pickingList', label: 'Picking List', value: report.picking_list_number || '' },
      { key: 'container', label: 'Container', value: report.picking_container || '' }
    ],
    fields: [
      { label: 'Type', value: formatExceptionType(report.exception_type) || '' },
      { label: 'Picked Loc', value: report.picked_location || '' },
      { label: 'System Qty', value: report.system_location_qty === null ? '' : String(report.system_location_qty) },
      { label: 'Actual', value: report.actual_qty === null ? '' : String(report.actual_qty) },
      { label: 'Picker', value: resolvePrintStaffName(report.picking_operator, resolveStaffName) },
      { label: 'Packer', value: resolvePrintStaffName(report.packing_rebin_operator, resolveStaffName) },
      { label: 'Count By', value: resolvePrintStaffName(report.count_by, resolveStaffName) },
      { label: 'Borrowed', value: borrowed }
    ]
  };
};
