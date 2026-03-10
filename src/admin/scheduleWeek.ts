const startOfWeekMonday = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
};

const toDateOnly = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

type WeeklyRunGateInput = {
  now: Date;
  inFlight: boolean;
  doneWeek: string;
  existingWeek: string;
};

type WeeklyRunGateResult = {
  shouldRun: boolean;
  weekStart: string;
};

type DailyRunGateInput = {
  now: Date;
  inFlight: boolean;
  doneDate: string;
  existingDate: string;
  triggerHour: number;
};

type DailyRunGateResult = {
  shouldRun: boolean;
  dateKey: string;
};

type RolloverRow = {
  staff_id?: string | null;
  date?: string | null;
  position?: string | null;
  note?: string | null;
  operator?: string | null;
  updated_at?: string | null;
};

const getWeeklyGateBase = ({ now, inFlight, doneWeek, existingWeek }: WeeklyRunGateInput): WeeklyRunGateResult => {
  const thisMonday = startOfWeekMonday(now);
  const weekStart = toDateOnly(thisMonday);
  const resetAt = new Date(thisMonday.getTime() + 5 * 60 * 60 * 1000);

  if (now.getDay() !== 1) return { shouldRun: false, weekStart };
  if (now.getTime() < resetAt.getTime()) return { shouldRun: false, weekStart };
  if (inFlight) return { shouldRun: false, weekStart };
  if (doneWeek === weekStart) return { shouldRun: false, weekStart };
  if (existingWeek === weekStart) return { shouldRun: false, weekStart };
  return { shouldRun: true, weekStart };
};

export const shouldRunWeeklyScheduleReset = (input: WeeklyRunGateInput) => getWeeklyGateBase(input);

export const shouldRunWeeklyScheduleRollover = (input: WeeklyRunGateInput) => getWeeklyGateBase(input);

export const shouldActivateDailyPlannedStates = ({
  now,
  inFlight,
  doneDate,
  existingDate,
  triggerHour
}: DailyRunGateInput): DailyRunGateResult => {
  const dateKey = toDateOnly(now);
  const activateAt = new Date(now);
  activateAt.setHours(triggerHour, 0, 0, 0);
  if (now.getTime() < activateAt.getTime()) return { shouldRun: false, dateKey };
  if (inFlight) return { shouldRun: false, dateKey };
  if (doneDate === dateKey) return { shouldRun: false, dateKey };
  if (existingDate === dateKey) return { shouldRun: false, dateKey };
  return { shouldRun: true, dateKey };
};

export const normalizeScheduleNoteForWeeklyReset = (
  note: string | null | undefined,
  restNote: string,
  tempWorkNote: string,
  tempRestNote: string
) => {
  if (note === tempRestNote) return null;
  if (note === tempWorkNote) return restNote;
  return note ?? null;
};

export const preserveScheduleNoteForWeekRollover = (note: string | null | undefined) => note ?? null;

export const activatePlannedScheduleNote = (
  note: string | null | undefined,
  tempWorkNote: string,
  leaveNote: string,
  tempRestNote: string,
  plannedTempWorkNote: string,
  plannedLeaveNote: string,
  plannedTempRestNote: string
) => {
  if (note === plannedTempWorkNote) return tempWorkNote;
  if (note === plannedLeaveNote) return leaveNote;
  if (note === plannedTempRestNote) return tempRestNote;
  return note ?? null;
};

export const buildDailyPlannedActivationUpserts = (
  rows: RolloverRow[],
  dateKey: string,
  nowIso: string,
  tempWorkNote: string,
  leaveNote: string,
  tempRestNote: string,
  plannedTempWorkNote: string,
  plannedLeaveNote: string,
  plannedTempRestNote: string
) =>
  rows
    .map((row) => {
      const rowDate = String(row.date ?? '').trim();
      const nextNote = activatePlannedScheduleNote(
        row.note ?? null,
        tempWorkNote,
        leaveNote,
        tempRestNote,
        plannedTempWorkNote,
        plannedLeaveNote,
        plannedTempRestNote
      );
      return {
        staff_id: String(row.staff_id ?? '').trim(),
        date: rowDate,
        note: nextNote,
        operator: String(row.operator ?? '').trim() || null,
        updated_at: nowIso
      };
    })
    .filter((row) => row.staff_id && row.date && row.date <= dateKey)
    .filter((row) => row.note !== null);

export const buildWeeklyRolloverUpserts = (
  nextWeekRows: RolloverRow[],
  existingCurrentWeekRows: RolloverRow[],
  nowIso: string
) => {
  const existingKeys = new Set(
    existingCurrentWeekRows.map((row) => `${String(row.staff_id ?? '').trim()}__${String(row.date ?? '').trim()}`).filter((key) => key !== '__')
  );

  return nextWeekRows
    .map((row) => {
      const rawDate = String(row.date ?? '').trim();
      const dt = new Date(`${rawDate}T00:00:00`);
      const toDate = Number.isNaN(dt.getTime()) ? rawDate : toDateOnly(new Date(dt.getTime() - 7 * 24 * 60 * 60 * 1000));
      return {
        staff_id: String(row.staff_id ?? '').trim(),
        date: toDate,
        position: String(row.position ?? '').trim() || null,
        note: preserveScheduleNoteForWeekRollover(row.note),
        operator: String(row.operator ?? '').trim() || null,
        updated_at: nowIso
      };
    })
    .filter((row) => row.staff_id && row.date)
    .filter((row) => !existingKeys.has(`${row.staff_id}__${row.date}`));
};
