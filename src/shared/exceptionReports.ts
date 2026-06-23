export const EXCEPTION_TYPES = ['over_pick', 'short_pick', 'wrong_pick', 'short_shipment', 'other'] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  over_pick: 'Over Pick',
  short_pick: 'Less Pick',
  wrong_pick: 'Wrong Pick',
  short_shipment: 'Short Pick',
  other: 'Other'
};

export const formatExceptionType = (value: unknown) => {
  const normalized = normalizeExceptionType(value);
  return normalized ? EXCEPTION_TYPE_LABELS[normalized] : '';
};

export const EXCEPTION_STATUSES = ['Open', 'Processing', 'Counted', 'Pending Adjustment', 'Short Picked', 'Resolved', 'Closed'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const EXCEPTION_STATUS_LABELS: Record<ExceptionStatus, string> = {
  Open: 'Open',
  Processing: 'Processing',
  Counted: 'Counted',
  'Pending Adjustment': 'Pending Adjustment',
  'Short Picked': 'Short Picked',
  Resolved: 'Resolved',
  Closed: 'Closed'
};

export type ResponsibilityResult = 'pending' | 'responsible' | 'picker' | 'packer' | 'all' | 'no_responsibility';

export type AutomaticExceptionClosure = {
  responsibility_result: 'picker';
  responsible_staff_id: string;
};

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
  item_rows?: ExceptionReportItemRow[] | null;
  count_by: string;
  borrowed_location?: string | null;
  borrowed_qty?: number | string | null;
  short_picked?: boolean;
  extra_taken?: boolean;
  inventory_adjustment: boolean;
  submitted_by_lead_id: string;
  lead_pin?: string;
  resolution_note?: string | null;
};

export type ExceptionReportRecord = Omit<ExceptionReportInput, 'lead_pin' | 'exception_type' | 'system_location_qty' | 'actual_qty' | 'borrowed_qty'> & {
  id: number | string;
  report_number?: string | null;
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
  exceptionTypeLabel: string;
  qrValue: string;
  qrFields: ExceptionReportPrintQrField[];
  fields: ExceptionReportPrintField[];
};

export type ExceptionReportStaffNameResolver = (staffId: string) => string;
export type ExceptionReportItemRow = {
  product_barcode: string;
  picked_location: string;
  system_location_qty?: number | string | null;
  actual_qty?: number | string | null;
};

export type ExceptionReportEditItemRow = {
  product: string;
  location: string;
  systemQty: string;
  actualQty: string;
};

type ExceptionItemRowSource = {
  product_barcode?: unknown;
  picked_location?: unknown;
  picking_container?: unknown;
  system_location_qty?: unknown;
  actual_qty?: unknown;
  item_rows?: unknown;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const trimText = (value: unknown) => String(value ?? '').trim();

export const normalizeExceptionMultiLineText = (value: unknown, uppercase = false) =>
  String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => (uppercase ? line.toUpperCase() : line))
    .reduceRight<string[]>((acc, line) => {
      if (acc.length || line) acc.unshift(line);
      return acc;
    }, [])
    .join('\n');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const itemRowHasValue = (row: ExceptionReportEditItemRow) =>
  Boolean(row.product || row.location || row.systemQty || row.actualQty);

export const buildExceptionEditItemRows = (
  input: ExceptionItemRowSource,
  minimumRowCount = 1
): ExceptionReportEditItemRow[] => {
  const rawItemRows = Array.isArray(input.item_rows) ? input.item_rows : [];
  const itemRows = rawItemRows
    .filter(isRecord)
    .map((row) => ({
      product: String(row.product_barcode ?? '').trim(),
      location: String(row.picked_location ?? '').trim(),
      systemQty: String(row.system_location_qty ?? '').trim(),
      actualQty: String(row.actual_qty ?? '').trim()
    }));

  if (itemRows.length) {
    const safeMinimumRowCount = Math.max(1, Math.floor(minimumRowCount));
    return [
      ...itemRows,
      ...Array.from({ length: Math.max(0, safeMinimumRowCount - itemRows.length) }, () => ({
        product: '',
        location: '',
        systemQty: '',
        actualQty: ''
      }))
    ];
  }

  const productRows = normalizeExceptionMultiLineText(input.product_barcode).split('\n');
  const locationRows = normalizeExceptionMultiLineText(input.picked_location).split('\n');
  const safeMinimumRowCount = Math.max(1, Math.floor(minimumRowCount));
  const rowCount = Math.max(productRows.length, locationRows.length, safeMinimumRowCount);
  return Array.from({ length: rowCount }, (_, index) => ({
    product: productRows[index] ?? '',
    location: locationRows[index] ?? '',
    systemQty: index === 0 ? trimText(input.system_location_qty) : '',
    actualQty: index === 0 ? trimText(input.actual_qty) : ''
  }));
};

export const getExceptionReportNumber = (report: Pick<ExceptionReportRecord, 'id' | 'report_number'>) =>
  trimText(report.report_number) || trimText(report.id);

export const normalizeExceptionItemRows = (
  input: ExceptionItemRowSource
): ExceptionReportItemRow[] =>
  buildExceptionEditItemRows(input)
    .filter(itemRowHasValue)
    .map((row) => ({
      product_barcode: trimText(row.product).toUpperCase(),
      picked_location: trimText(row.location).toUpperCase(),
      system_location_qty: trimText(row.systemQty) ? parseNonNegativeNumber(row.systemQty) : null,
      actual_qty: trimText(row.actualQty) ? parseNonNegativeNumber(row.actualQty) : null
    }));

export const splitExceptionReportItemRows = (
  input: ExceptionItemRowSource
): ExceptionReportItemRow[] => {
  const itemRows = normalizeExceptionItemRows(input);
  return itemRows.filter((row) => row.product_barcode || row.picked_location);
};

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
  if (from === 'Processing' && (to === 'Counted' || to === 'Pending Adjustment' || to === 'Short Picked' || to === 'Resolved')) return true;
  if (from === 'Counted' && (to === 'Pending Adjustment' || to === 'Short Picked' || to === 'Resolved')) return true;
  if (from === 'Pending Adjustment' && to === 'Resolved') return true;
  const order: ExceptionStatus[] = ['Open', 'Processing', 'Counted', 'Pending Adjustment', 'Short Picked', 'Resolved', 'Closed'];
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  return toIndex === fromIndex + 1;
};

export const needsInventoryAdjustment = (input: Pick<ExceptionReportInput, 'borrowed_location' | 'inventory_adjustment'>) =>
  Boolean(trimText(input.borrowed_location)) && !Boolean(input.inventory_adjustment);

const isShortageExceptionType = (value: unknown) => {
  const exceptionType = normalizeExceptionType(value);
  return exceptionType === 'short_pick' || exceptionType === 'short_shipment';
};

export const hasPickerShortPickEvidence = (input: ExceptionItemRowSource) =>
  buildExceptionEditItemRows(input)
    .filter(itemRowHasValue)
    .some((row) => {
      const systemQty = parseNonNegativeNumber(row.systemQty);
      const actualQty = parseNonNegativeNumber(row.actualQty);
      return systemQty !== null && actualQty !== null && actualQty > systemQty;
    });

export const hasExceptionReplenishmentCandidate = (input: ExceptionItemRowSource & Pick<ExceptionReportInput, 'exception_type'>) =>
  isShortageExceptionType(input.exception_type) &&
  buildExceptionEditItemRows(input)
    .filter(itemRowHasValue)
    .some((row) => {
      const systemQty = parseNonNegativeNumber(row.systemQty);
      const actualQty = parseNonNegativeNumber(row.actualQty);
      return systemQty !== null && actualQty !== null && actualQty <= systemQty;
    });

const hasText = (value: unknown) => Boolean(trimText(value));

const hasCompleteItemProcessing = (input: ExceptionItemRowSource) => {
  const rows = buildExceptionEditItemRows(input).filter(itemRowHasValue);
  return rows.length > 0 && rows.every((row) => hasText(row.product) && hasText(row.location) && hasText(row.systemQty) && hasText(row.actualQty));
};

const hasAnyItemProcessing = (input: ExceptionItemRowSource) =>
  buildExceptionEditItemRows(input)
    .filter(itemRowHasValue)
    .some((row) => hasText(row.systemQty) || hasText(row.actualQty));

const hasEnteredCountedQuantities = (
  input: Pick<ExceptionReportInput, 'system_location_qty' | 'actual_qty' | 'item_rows' | 'product_barcode' | 'picked_location' | 'picking_container'>
) => {
  if (hasText(input.system_location_qty) || hasText(input.actual_qty)) return true;
  return buildExceptionEditItemRows(input)
    .filter(itemRowHasValue)
    .some((row) => hasText(row.systemQty) || hasText(row.actualQty));
};

const summarizeItemQuantities = (input: ExceptionItemRowSource) => {
  const rows = buildExceptionEditItemRows(input).filter(itemRowHasValue);
  if (!rows.length) return { systemQty: null as number | null, actualQty: null as number | null };

  let systemQtyTotal = 0;
  let actualQtyTotal = 0;
  for (const row of rows) {
    const systemQty = parseNonNegativeNumber(row.systemQty);
    const actualQty = parseNonNegativeNumber(row.actualQty);
    if (systemQty === null || actualQty === null) return { systemQty: null as number | null, actualQty: null as number | null };
    systemQtyTotal += systemQty;
    actualQtyTotal += actualQty;
  }

  return { systemQty: systemQtyTotal, actualQty: actualQtyTotal };
};

export const doesOverPickExtraQtyMatch = (
  input: Pick<
    ExceptionReportInput,
    | 'exception_type'
    | 'item_rows'
    | 'product_barcode'
    | 'picked_location'
    | 'system_location_qty'
    | 'actual_qty'
    | 'borrowed_qty'
  >
) => {
  if (normalizeExceptionType(input.exception_type) !== 'over_pick') return false;
  const extraQty = parseNonNegativeNumber(input.borrowed_qty);
  if (extraQty === null || extraQty <= 0) return false;

  const { systemQty, actualQty } = summarizeItemQuantities(input);
  if (systemQty === null || actualQty === null) return false;
  return systemQty + extraQty === actualQty;
};

export const doesShortPickMissingQtyMatch = (
  input: Pick<
    ExceptionReportInput,
    | 'exception_type'
    | 'item_rows'
    | 'product_barcode'
    | 'picked_location'
    | 'system_location_qty'
    | 'actual_qty'
    | 'borrowed_qty'
    | 'borrowed_location'
  >
) => {
  if (normalizeExceptionType(input.exception_type) !== 'short_pick') return false;
  if (hasText(input.borrowed_location)) return false;
  const missingQty = parseNonNegativeNumber(input.borrowed_qty);
  if (missingQty === null || missingQty <= 0) return false;

  const { systemQty, actualQty } = summarizeItemQuantities(input);
  if (systemQty === null || actualQty === null) return false;
  return actualQty - missingQty === systemQty;
};

export const getExceptionReportWarnings = (
  input: Pick<
    ExceptionReportInput,
    | 'exception_type'
    | 'item_rows'
    | 'product_barcode'
    | 'picked_location'
    | 'system_location_qty'
    | 'actual_qty'
    | 'borrowed_qty'
    | 'borrowed_location'
    | 'picking_operator'
    | 'count_by'
  >
) => {
  const warnings: string[] = [];
  const isShortPick = normalizeExceptionType(input.exception_type) === 'short_pick';
  if (
    isShortPick &&
    !hasText(input.borrowed_location) &&
    hasCompleteItemProcessing(input) &&
    hasText(input.picking_operator) &&
    hasText(input.count_by) &&
    hasText(input.borrowed_qty)
  ) {
    const missingQty = parseNonNegativeNumber(input.borrowed_qty);
    const hasMismatch =
      missingQty !== null &&
      missingQty > 0 &&
      !hasPickerShortPickEvidence(input) &&
      !doesShortPickMissingQtyMatch(input);
    if (hasMismatch) warnings.push('For Less Pick, actual minus missing qty should equal system qty.');
  }
  return warnings;
};

export const canPhysicallyFixShortPick = (
  input: Pick<
    ExceptionReportInput,
    | 'exception_type'
    | 'item_rows'
    | 'product_barcode'
    | 'picked_location'
    | 'system_location_qty'
    | 'actual_qty'
    | 'borrowed_qty'
    | 'borrowed_location'
  >
) => {
  if (normalizeExceptionType(input.exception_type) !== 'short_pick') return false;
  if (hasText(input.borrowed_location)) return false;
  return doesShortPickMissingQtyMatch(input) || hasPickerShortPickEvidence(input);
};

export const inferAutomaticExceptionClosure = (
  input: Pick<
    ExceptionReportInput,
    | 'exception_type'
    | 'item_rows'
    | 'product_barcode'
    | 'picked_location'
    | 'system_location_qty'
    | 'actual_qty'
    | 'picking_operator'
    | 'count_by'
    | 'borrowed_qty'
    | 'borrowed_location'
    | 'inventory_adjustment'
  >
): AutomaticExceptionClosure | null => {
  const exceptionType = normalizeExceptionType(input.exception_type);
  if (exceptionType !== 'over_pick' && exceptionType !== 'short_pick') return null;
  if (!hasCompleteItemProcessing(input)) return null;
  if (exceptionType === 'over_pick' && !doesOverPickExtraQtyMatch(input)) return null;
  if (exceptionType === 'short_pick' && !canPhysicallyFixShortPick(input)) return null;
  if (!input.inventory_adjustment) return null;

  const pickerStaffId = trimText(input.picking_operator).toUpperCase();
  if (!pickerStaffId || !hasText(input.count_by)) return null;

  return {
    responsibility_result: 'picker',
    responsible_staff_id: pickerStaffId
  };
};

export const inferExceptionStatus = (
  input: Pick<
    ExceptionReportInput,
    | 'product_barcode'
    | 'exception_type'
    | 'picked_location'
    | 'system_location_qty'
    | 'actual_qty'
    | 'item_rows'
    | 'picking_operator'
    | 'packing_rebin_operator'
    | 'count_by'
    | 'borrowed_location'
    | 'borrowed_qty'
    | 'short_picked'
    | 'extra_taken'
    | 'inventory_adjustment'
  >
): Exclude<ExceptionStatus, 'Closed'> => {
  const hasAnyProcessingData =
    hasAnyItemProcessing(input) ||
    hasText(input.picking_operator) ||
    hasText(input.packing_rebin_operator) ||
    hasText(input.count_by);
  if (!hasAnyProcessingData) return 'Open';

  const isShortPickZero =
    normalizeExceptionType(input.exception_type) === 'short_shipment' &&
    buildExceptionEditItemRows(input).some((row) => hasText(row.actualQty) && Number(row.actualQty) === 0);
  if (isShortPickZero && input.short_picked) return 'Short Picked';

  const hasCompleteItemData = hasCompleteItemProcessing(input);
  if (!hasCompleteItemData) return 'Processing';
  if (
    normalizeExceptionType(input.exception_type) === 'over_pick' &&
    doesOverPickExtraQtyMatch(input) &&
    hasText(input.picking_operator) &&
    hasText(input.count_by)
  ) return 'Resolved';
  if (
    normalizeExceptionType(input.exception_type) === 'short_pick' &&
    doesShortPickMissingQtyMatch(input) &&
    hasText(input.picking_operator) &&
    hasText(input.count_by)
  ) return 'Resolved';
  if (inferAutomaticExceptionClosure(input)) return 'Resolved';
  if (!hasText(input.picking_operator) || !hasText(input.packing_rebin_operator) || !hasText(input.count_by)) return 'Counted';

  const borrowedLocation = hasText(input.borrowed_location);
  const borrowedQtyValue = parseNonNegativeNumber(input.borrowed_qty);
  const borrowedQty = borrowedQtyValue !== null && borrowedQtyValue > 0;
  const needsReplenishmentAction = hasExceptionReplenishmentCandidate(input);
  const needsExtraTakenAdjustment = needsReplenishmentAction && Boolean(input.extra_taken);
  if (borrowedLocation || borrowedQty) return borrowedLocation && borrowedQty && input.inventory_adjustment ? 'Resolved' : 'Pending Adjustment';
  if (needsExtraTakenAdjustment) return input.inventory_adjustment ? 'Resolved' : 'Pending Adjustment';
  if (needsReplenishmentAction) return 'Processing';
  if (hasPickerShortPickEvidence(input)) return 'Resolved';
  if (isShortPickZero) return 'Processing';

  return 'Resolved';
};

export const parseNonNegativeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return null;
  return next;
};

type ExceptionReportValidationOptions = {
  requireCountByForQuantities?: boolean;
};

export const validateExceptionReportInput = (input: ExceptionReportInput, options: ExceptionReportValidationOptions = {}): string[] => {
  const errors: string[] = [];
  const editRows = buildExceptionEditItemRows(input).filter(itemRowHasValue);
  const exceptionType = normalizeExceptionType(input.exception_type);
  const isOverPick = exceptionType === 'over_pick';
  const isShortPick = exceptionType === 'short_pick';
  if (!DATE_ONLY_PATTERN.test(trimText(input.report_date))) errors.push('Date must use YYYY-MM-DD.');
  if (normalizeExceptionType(input.exception_type) === 'other' && !trimText(input.resolution_note)) {
    errors.push('Reason is required for Other.');
  }
  if (!editRows.some((row) => trimText(row.product))) errors.push('Product barcode is required.');
  if (!trimText(input.picking_list_number)) errors.push('Picking list number is required.');
  if (editRows.some((row) => trimText(row.systemQty) && parseNonNegativeNumber(row.systemQty) === null)) errors.push('System location qty must be a non-negative number.');
  if (editRows.some((row) => trimText(row.actualQty) && parseNonNegativeNumber(row.actualQty) === null)) errors.push('Actual qty must be a non-negative number.');
  if (
    options.requireCountByForQuantities &&
    hasEnteredCountedQuantities(input) &&
    !trimText(input.count_by)
  ) {
    errors.push('Count By USID is required when counted quantities are entered.');
  }
  if (
    isOverPick &&
    hasCompleteItemProcessing(input) &&
    hasText(input.picking_operator) &&
    hasText(input.count_by)
  ) {
    const extraQty = parseNonNegativeNumber(input.borrowed_qty);
    if (extraQty === null || extraQty <= 0) errors.push('Extra qty is required for Over Pick.');
    else if (!doesOverPickExtraQtyMatch(input)) errors.push('For Over Pick, system qty plus extra qty must equal actual.');
  }
  if (
    isShortPick &&
    !hasText(input.borrowed_location) &&
    hasCompleteItemProcessing(input) &&
    hasText(input.picking_operator) &&
    hasText(input.count_by) &&
    hasText(input.borrowed_qty)
  ) {
    const missingQty = parseNonNegativeNumber(input.borrowed_qty);
    if (missingQty === null) errors.push('Missing qty is required for Less Pick.');
    else if (missingQty === 0 && hasPickerShortPickEvidence(input)) {
      // Actual > system means the stock is still at the original location, so a zero missing qty is valid.
    }
    else if (missingQty <= 0) errors.push('Missing qty is required for Less Pick.');
  }

  const borrowedLocation = trimText(input.borrowed_location);
  const borrowedQty = parseNonNegativeNumber(input.borrowed_qty);
  if (!isOverPick && !isShortPick && borrowedLocation && borrowedQty === null) errors.push('Borrowed qty is required when borrowed location is filled.');
  if (!isOverPick && !isShortPick && !borrowedLocation && trimText(input.borrowed_qty)) errors.push('Borrowed location is required when borrowed qty is filled.');
  if (input.extra_taken && !hasExceptionReplenishmentCandidate(input)) errors.push('Extra taken can only be marked when counted stock still needs replenishment.');
  if (!isOverPick && !isShortPick && input.inventory_adjustment && !borrowedLocation && !input.extra_taken) errors.push('Inventory adjustment requires borrowed inventory or extra taken.');
  return errors;
};

export const buildExceptionInsertPayload = (input: ExceptionReportInput) => {
  const exceptionType = normalizeExceptionType(input.exception_type);
  const itemRows = normalizeExceptionItemRows(input);
  const firstRow = itemRows[0];
  const systemQty = firstRow ? firstRow.system_location_qty ?? null : trimText(input.system_location_qty) ? parseNonNegativeNumber(input.system_location_qty) : null;
  const actualQty = firstRow ? firstRow.actual_qty ?? null : trimText(input.actual_qty) ? parseNonNegativeNumber(input.actual_qty) : null;
  const borrowedLocation = trimText(input.borrowed_location);
  const borrowedQty = exceptionType === 'over_pick' || exceptionType === 'short_pick'
    ? parseNonNegativeNumber(input.borrowed_qty)
    : borrowedLocation
      ? parseNonNegativeNumber(input.borrowed_qty)
      : null;
  const shortPicked = Boolean(input.short_picked) && exceptionType === 'short_shipment' && itemRows.some((row) => row.actual_qty === 0);
  const extraTaken = Boolean(input.extra_taken) && hasExceptionReplenishmentCandidate(input);

  return {
    report_date: trimText(input.report_date),
    exception_type: exceptionType,
    product_barcode: itemRows.length ? itemRows.map((row) => row.product_barcode).join('\n') : normalizeExceptionMultiLineText(input.product_barcode, true),
    picking_list_number: trimText(input.picking_list_number),
    picking_container: trimText(input.picking_container),
    picking_operator: trimText(input.picking_operator).toUpperCase(),
    packing_rebin_operator: trimText(input.packing_rebin_operator) || null,
    picked_location: itemRows.length ? itemRows.map((row) => row.picked_location).join('\n') : normalizeExceptionMultiLineText(input.picked_location, true),
    system_location_qty: systemQty,
    actual_qty: actualQty,
    item_rows: itemRows,
    count_by: trimText(input.count_by).toUpperCase(),
    borrowed_location: borrowedLocation ? borrowedLocation.toUpperCase() : null,
    borrowed_qty: borrowedQty,
    short_picked: shortPicked,
    extra_taken: extraTaken,
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
  const reportId = getExceptionReportNumber(report);
  const lookupId = trimText(report.id) || reportId;
  const qrValue = origin ? `${origin.replace(/\/$/, '')}/exception?id=${encodeURIComponent(lookupId)}` : `EXCEPTION:${reportId}`;
  const borrowed = report.borrowed_location
    ? `${report.borrowed_location} / ${report.borrowed_qty ?? ''}`
    : '';
  return {
    title: 'Exception',
    reportId,
    status: report.status,
    reportDate: formatPrintDateTime(report.created_at, report.report_date),
    createdBy: resolvePrintStaffName(report.submitted_by_lead_id, resolveStaffName),
    exceptionTypeLabel: formatExceptionType(report.exception_type) || '',
    qrValue,
    qrFields: [
      { key: 'product', label: 'Product', value: report.product_barcode || '' },
      { key: 'pickingList', label: 'Picking List', value: report.picking_list_number || '' },
      { key: 'container', label: 'Container', value: report.picking_container || '' }
    ],
    fields: [
      { label: 'Picked Loc', value: report.picked_location || '' },
      { label: 'Count By', value: resolvePrintStaffName(report.count_by, resolveStaffName) },
      { label: 'System Qty', value: report.system_location_qty === null ? '' : String(report.system_location_qty) },
      { label: 'Actual', value: report.actual_qty === null ? '' : String(report.actual_qty) },
      { label: 'Picker', value: resolvePrintStaffName(report.picking_operator, resolveStaffName) },
      { label: 'Packer', value: resolvePrintStaffName(report.packing_rebin_operator, resolveStaffName) },
      { label: 'Borrowed', value: borrowed }
    ]
  };
};
