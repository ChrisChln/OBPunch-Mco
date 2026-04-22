export const OUTBOUND_STAFFING_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'Water Spider'] as const;
export const PACKAGE_METRICS_STAFFING_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer'] as const;

const NON_WORKING_SCHEDULE_NOTES = new Set([
  '__rest__',
  '__leave__',
  '__temp_rest__',
  '__planned_leave__',
  '__planned_temp_rest__'
]);

export const normalizeOutboundStaffingPosition = (value: unknown): string => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'pick') return 'Pick';
  if (normalized === 'pack') return 'Pack';
  if (normalized === 'rebin') return 'Rebin';
  if (normalized === 'preship' || normalized === 'pre ship' || normalized === 'pre-ship') return 'Preship';
  if (normalized === 'transfer') return 'Transfer';
  if (normalized === 'water spider' || normalized === 'waterspider' || normalized === 'water-spider') return 'Water Spider';
  return '';
};

export const isOutboundStaffingPosition = (value: unknown) =>
  OUTBOUND_STAFFING_POSITIONS.includes(normalizeOutboundStaffingPosition(value) as (typeof OUTBOUND_STAFFING_POSITIONS)[number]);

export const isPackageMetricsStaffingPosition = (value: unknown) =>
  PACKAGE_METRICS_STAFFING_POSITIONS.includes(
    normalizeOutboundStaffingPosition(value) as (typeof PACKAGE_METRICS_STAFFING_POSITIONS)[number]
  );

export const isWorkingScheduleNote = (note: unknown) => {
  const normalized = String(note ?? '').trim();
  if (!normalized) return true;
  return !NON_WORKING_SCHEDULE_NOTES.has(normalized);
};

export const shouldCountScheduledOutboundStaff = (position: unknown, note: unknown) =>
  isOutboundStaffingPosition(position) && isWorkingScheduleNote(note);

export const shouldCountScheduledPackageMetricsStaff = (position: unknown, note: unknown) =>
  isPackageMetricsStaffingPosition(position) && isWorkingScheduleNote(note);
