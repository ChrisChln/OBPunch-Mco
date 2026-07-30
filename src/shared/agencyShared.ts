export type AgencyShift = 'early' | 'late';
export type AgencyLeaveDeadlineInput = {
  shift: AgencyShift | '';
  startTime: string;
  workDate: string;
  now: Date;
};

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

export const AGENCY_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');
const NEW_YORK_TIME_ZONE = 'America/New_York';
const LEAVE_NOTICE_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

const getNewYorkWallClockParts = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NEW_YORK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    hour: Number(fields.hour),
    minute: Number(fields.minute),
    second: Number(fields.second)
  };
};

const getNewYorkOffsetMinutes = (value: Date) => {
  const parts = getNewYorkWallClockParts(value);
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((wallClockAsUtc - value.getTime()) / 60_000);
};

const getNewYorkWallClockUtc = (workDate: string, startTime: string) => {
  const dateMatch = DATE_ONLY_PATTERN.exec(workDate);
  const timeMatch = TIME_ONLY_PATTERN.exec(startTime);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    return null;
  }

  const approximateUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const winterProbe = new Date(Date.UTC(year, 0, 1, 12));
  const summerProbe = new Date(Date.UTC(year, 6, 1, 12));
  const offsets = Array.from(
    new Set([getNewYorkOffsetMinutes(winterProbe), getNewYorkOffsetMinutes(summerProbe)])
  );
  const standardOffsetMinutes = Math.min(...offsets);
  const matchingCandidates = offsets
    .map((offsetMinutes) => new Date(approximateUtcMs - offsetMinutes * 60_000))
    .filter((candidate) => {
      const parts = getNewYorkWallClockParts(candidate);
      return (
        parts.year === year &&
        parts.month === month &&
        parts.day === day &&
        parts.hour === hour &&
        parts.minute === minute
      );
    });

  if (matchingCandidates.length > 0) {
    return new Date(Math.max(...matchingCandidates.map((candidate) => candidate.getTime())));
  }
  return new Date(approximateUtcMs - standardOffsetMinutes * 60_000);
};

const resolveAgencyLeaveStartTime = (shift: AgencyShift | '', startTime: string) => {
  const normalized = String(startTime ?? '').trim();
  if (TIME_ONLY_PATTERN.test(normalized)) return normalized;
  if (shift === 'early') return '07:00';
  if (shift === 'late') return '15:00';
  return '';
};

export const canSubmitAgencyLeave = ({ shift, startTime, workDate, now }: AgencyLeaveDeadlineInput) => {
  if (shift !== 'early' && shift !== 'late') return false;
  if (Number.isNaN(now.getTime())) return false;
  const resolvedStartTime = resolveAgencyLeaveStartTime(shift, startTime);
  const shiftStart = getNewYorkWallClockUtc(workDate, resolvedStartTime);
  if (!shiftStart) return false;
  return shiftStart.getTime() - now.getTime() > LEAVE_NOTICE_MS;
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
  state === 'new' || state === 'work' || state === 'fixed_work' || state === 'temp_work' || state === 'planned_temp_work';

export const isAgencyNewHireRequestStaffId = (staffId: string, workDate: string) => {
  const prefix = workDate.replace(/-/g, '').slice(4);
  return new RegExp(`^${prefix}[A-Z]+[0-9]{3,}$`, 'i').test(String(staffId ?? '').trim());
};
