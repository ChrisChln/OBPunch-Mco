export type AgencyShift = 'early' | 'late';
export type AgencyBoardEmployeeState =
  | 'new'
  | 'work'
  | 'fixed_work'
  | 'temp_work'
  | 'planned_temp_work'
  | 'leave'
  | 'planned_leave'
  | 'temp_rest'
  | 'planned_temp_rest'
  | 'rest';

export const AGENCY_EARLY_CUTOFF_HOUR = 10;
export const AGENCY_LATE_CUTOFF_HOUR = 17;
export const AGENCY_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');

export const toDateOnly = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

export const startOfWeekMonday = (value: Date) => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
};

export const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

export const getAgencyLeaveCutoffHour = (shift: AgencyShift) =>
  shift === 'early' ? AGENCY_EARLY_CUTOFF_HOUR : AGENCY_LATE_CUTOFF_HOUR;

export const canEditAgencyPlannedLeave = (shift: AgencyShift, workDate: string, now: Date) => {
  if (toDateOnly(now) !== workDate) return true;
  const cutoff = new Date(`${workDate}T${String(getAgencyLeaveCutoffHour(shift)).padStart(2, '0')}:00:00`);
  return now.getTime() <= cutoff.getTime();
};

export const getAgencyTemplateDateByActualDate = (actualDateOnly: string, todayDateOnly: string) => {
  const actualDate = new Date(`${actualDateOnly}T00:00:00`);
  const todayDate = new Date(`${todayDateOnly}T00:00:00`);
  if (Number.isNaN(actualDate.getTime()) || Number.isNaN(todayDate.getTime())) return '';

  const baseWeekStart = startOfWeekMonday(todayDate);
  const targetWeekStart = startOfWeekMonday(actualDate);
  const weekOffsetRaw = Math.round((targetWeekStart.getTime() - baseWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const weekOffset = Math.max(0, Math.min(1, weekOffsetRaw));
  const dayIndex = Math.round((actualDate.getTime() - targetWeekStart.getTime()) / (24 * 60 * 60 * 1000));
  return toDateOnly(addDays(AGENCY_TEMPLATE_WEEK_START, weekOffset * 7 + dayIndex));
};

export const isAgencyWorkingState = (state: string) =>
  state === 'work' || state === 'fixed_work' || state === 'temp_work' || state === 'planned_temp_work';

export const isAgencyNewHireRequestStaffId = (staffId: string, workDate: string) => {
  const prefix = workDate.replace(/-/g, '').slice(4);
  return new RegExp(`^${prefix}[A-Z]+[0-9]{3,}$`, 'i').test(String(staffId ?? '').trim());
};
