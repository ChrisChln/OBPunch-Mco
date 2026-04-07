export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

export const DAY_CUTOFF_HOUR = (() => {
  const raw = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
  return Number.isFinite(raw) ? Math.max(0, Math.min(23, raw)) : 5;
})();

export const isValidDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());

export const toDateOnly = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

export const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

export const SCHEDULE_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');

export const startOfWeekMonday = (value: Date) => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
};

export const getTemplateDateByActualDate = (actualDateOnly: string, actualWeekStartDateOnly: string) => {
  const actualDate = new Date(`${actualDateOnly}T00:00:00`);
  const actualWeekStart = new Date(`${actualWeekStartDateOnly}T00:00:00`);
  if (Number.isNaN(actualDate.getTime()) || Number.isNaN(actualWeekStart.getTime())) return '';
  const diffDays = Math.round((actualDate.getTime() - actualWeekStart.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0 || diffDays > 13) return '';
  return toDateOnly(addDays(SCHEDULE_TEMPLATE_WEEK_START, diffDays));
};

export const getCurrentOperationalDate = (serverTime: Date) => {
  const now = new Date(serverTime);
  const operationalStart = new Date(now);
  operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
  if (now.getTime() < operationalStart.getTime()) operationalStart.setDate(operationalStart.getDate() - 1);
  return toDateOnly(operationalStart);
};

export const getApproveWindow = (serverTime: Date) => {
  const operationalDate = getCurrentOperationalDate(serverTime);
  const operationalDateBase = new Date(`${operationalDate}T00:00:00`);
  const thisWeekStart = startOfWeekMonday(operationalDateBase);
  const nextWeekEnd = addDays(thisWeekStart, 13);
  return {
    operationalDate,
    editableStart: toDateOnly(thisWeekStart),
    editableEnd: toDateOnly(nextWeekEnd)
  };
};

export const getEffectiveLeaveStatus = (status: LeaveStatus, leaveDate: string, serverTime: Date): LeaveStatus => {
  if (status !== 'pending') return status;
  const approveWindow = getApproveWindow(serverTime);
  return leaveDate < approveWindow.editableStart ? 'expired' : 'pending';
};
