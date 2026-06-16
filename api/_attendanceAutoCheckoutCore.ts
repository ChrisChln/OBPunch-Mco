import { isScheduleOnlyAgency } from '../src/shared/agencyRules.js';
import { isEmployeeTerminated } from '../src/shared/employeeStatus.js';

type PunchAction = 'IN' | 'OUT';

type PunchRow = {
  staff_id?: string | null;
  action?: string | null;
  created_at?: string | null;
};

type EmployeeRow = {
  staff_id?: string | null;
  agency?: string | null;
  Agency?: string | null;
  terminated_at?: string | null;
};

type SupabaseLike = {
  from: (table: string) => any;
};

export type AttendanceAutoCheckoutOptions = {
  now?: Date;
  timezone?: string;
  cutoffHour?: number;
  lookbackHours?: number;
  dryRun?: boolean;
};

export type AttendanceAutoCheckoutResult = {
  cutoff_at: string;
  window_start: string;
  scanned_punches: number;
  candidates: number;
  inserted: number;
  skipped: number;
  skipped_staff_ids: string[];
  inserted_staff_ids: string[];
};

const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_CUTOFF_HOUR = 5;
const DEFAULT_LOOKBACK_HOURS = 24;
const PAGE_SIZE = 1000;

const clampHour = (value: unknown, fallback: number) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(23, Math.floor(num))) : fallback;
};

const getZonedParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.get('year')),
    month: Number(byType.get('month')),
    day: Number(byType.get('day')),
    hour: Number(byType.get('hour')),
    minute: Number(byType.get('minute')),
    second: Number(byType.get('second'))
  };
};

const getTimeZoneOffsetMs = (date: Date, timezone: string) => {
  const parts = getZonedParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
};

export const zonedDateTimeToUtc = (
  parts: { year: number; month: number; day: number; hour: number; minute?: number; second?: number },
  timezone: string
) => {
  const wallTimeAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute ?? 0, parts.second ?? 0);
  let utcMs = wallTimeAsUtc;
  for (let index = 0; index < 3; index += 1) {
    utcMs = wallTimeAsUtc - getTimeZoneOffsetMs(new Date(utcMs), timezone);
  }
  return new Date(utcMs);
};

const addLocalDays = (parts: { year: number; month: number; day: number }, days: number) => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
};

export const getMostRecentCutoff = (now: Date, timezone = DEFAULT_TIMEZONE, cutoffHour = DEFAULT_CUTOFF_HOUR) => {
  const local = getZonedParts(now, timezone);
  const todayCutoff = zonedDateTimeToUtc(
    { year: local.year, month: local.month, day: local.day, hour: cutoffHour, minute: 0, second: 0 },
    timezone
  );
  if (now.getTime() >= todayCutoff.getTime()) return todayCutoff;
  const previous = addLocalDays(local, -1);
  return zonedDateTimeToUtc({ ...previous, hour: cutoffHour, minute: 0, second: 0 }, timezone);
};

const fetchAllPunchesInWindow = async (supabase: SupabaseLike, windowStart: string, cutoffAt: string) => {
  const rows: PunchRow[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const res = await supabase
      .from('ob_punches')
      .select('staff_id, action, created_at, id')
      .gte('created_at', windowStart)
      .lte('created_at', cutoffAt)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (res.error) throw res.error;
    const pageRows = (res.data ?? []) as PunchRow[];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
};

const fetchEmployeesByStaffId = async (supabase: SupabaseLike, staffIds: string[]) => {
  const byStaff = new Map<string, EmployeeRow>();
  for (let index = 0; index < staffIds.length; index += 200) {
    const batch = staffIds.slice(index, index + 200);
    const res = await supabase
      .from('ob_employees')
      .select('staff_id, agency, "Agency", terminated_at')
      .in('staff_id', batch);
    if (res.error) throw res.error;
    for (const row of ((res.data ?? []) as EmployeeRow[])) {
      const staff = String(row.staff_id ?? '').trim().toUpperCase();
      if (staff) byStaff.set(staff, row);
    }
  }
  return byStaff;
};

const insertAutoCheckout = async (supabase: SupabaseLike, staffId: string, cutoffAt: string) => {
  const row = {
    staff_id: staffId,
    action: 'OUT',
    created_at: cutoffAt,
    device: 'system',
    source: 'attendance_auto_checkout',
    operator: 'system',
    note: 'Auto OUT at operational cutoff'
  };
  const res = await supabase.from('ob_punches').insert([row]);
  if (!res.error) return;
  const message = String(res.error?.message ?? res.error ?? '').toLowerCase();
  if (message.includes('device') || message.includes('source') || message.includes('operator') || message.includes('note')) {
    const fallbackRes = await supabase.from('ob_punches').insert([
      {
        staff_id: staffId,
        action: 'OUT',
        created_at: cutoffAt
      }
    ]);
    if (fallbackRes.error) throw fallbackRes.error;
    return;
  }
  throw res.error;
};

export const runAttendanceAutoCheckout = async (
  supabase: SupabaseLike,
  options: AttendanceAutoCheckoutOptions = {}
): Promise<AttendanceAutoCheckoutResult> => {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const cutoffHour = clampHour(options.cutoffHour, DEFAULT_CUTOFF_HOUR);
  const lookbackHours = Math.max(1, Math.min(72, Number(options.lookbackHours ?? DEFAULT_LOOKBACK_HOURS)));
  const cutoff = getMostRecentCutoff(options.now ?? new Date(), timezone, cutoffHour);
  const cutoffAt = cutoff.toISOString();
  const windowStart = new Date(cutoff.getTime() - lookbackHours * 60 * 60 * 1000).toISOString();

  const punches = await fetchAllPunchesInWindow(supabase, windowStart, cutoffAt);
  const latestByStaff = new Map<string, { action: PunchAction; createdAt: string }>();
  const existingCutoffOut = new Set<string>();
  for (const row of punches) {
    const staff = String(row.staff_id ?? '').trim().toUpperCase();
    const createdAt = String(row.created_at ?? '').trim();
    if (!staff || !createdAt) continue;
    const action = String(row.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
    if (action === 'OUT' && createdAt === cutoffAt) existingCutoffOut.add(staff);
    if (!latestByStaff.has(staff)) latestByStaff.set(staff, { action, createdAt });
  }

  const candidates = Array.from(latestByStaff.entries())
    .filter(([, latest]) => latest.action === 'IN')
    .map(([staff]) => staff);
  const employees = await fetchEmployeesByStaffId(supabase, candidates);

  const insertedStaffIds: string[] = [];
  const skippedStaffIds: string[] = [];
  for (const staffId of candidates) {
    const employee = employees.get(staffId);
    const agency = String(employee?.agency ?? employee?.Agency ?? '').trim();
    if (!employee || existingCutoffOut.has(staffId) || isScheduleOnlyAgency(agency) || isEmployeeTerminated({ terminatedAt: employee.terminated_at })) {
      skippedStaffIds.push(staffId);
      continue;
    }
    if (!options.dryRun) {
      await insertAutoCheckout(supabase, staffId, cutoffAt);
    }
    insertedStaffIds.push(staffId);
  }

  return {
    cutoff_at: cutoffAt,
    window_start: windowStart,
    scanned_punches: punches.length,
    candidates: candidates.length,
    inserted: insertedStaffIds.length,
    skipped: skippedStaffIds.length,
    skipped_staff_ids: skippedStaffIds,
    inserted_staff_ids: insertedStaffIds
  };
};
