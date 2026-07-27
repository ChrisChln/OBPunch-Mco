import { isScheduleOnlyAgency } from '../src/shared/agencyRules.js';
import { isEmployeeTerminated } from '../src/shared/employeeStatus.js';
import { isExactOperationalCutoffOut } from '../src/shared/operationalPunches.js';
import {
  DEFAULT_POSITION_NAMES,
  buildAttendanceTrackedPositionNames,
  normalizePositionDepartment,
  normalizePositionName,
  type PositionDepartment,
  type PositionRecord
} from '../src/shared/positions.js';
import { normalizeStaffId } from '../src/lib/staffId.js';
import { zonedDateTimeToUtc } from './_attendanceAutoCheckoutCore.js';

type SupabaseLike = {
  from: (table: string) => any;
};

type SnapshotMode = 'expected' | 'actual';
type Shift = 'early' | 'late';

type ScheduleRow = {
  id?: string | number | null;
  staff_id?: string | null;
  position?: string | null;
  note?: string | null;
  date?: string | null;
  work_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type EmployeeRow = {
  staff_id?: string | null;
  name?: string | null;
  agency?: string | null;
  position?: string | null;
  shift?: string | null;
  active?: boolean | string | number | null;
  terminated_at?: string | null;
};

type PunchRow = {
  id?: string | number | null;
  staff_id?: string | null;
  action?: string | null;
  created_at?: string | null;
};

type SnapshotStat = {
  work_date: string;
  shift: Shift;
  position: string;
  department: PositionDepartment;
  expected: number;
  present: number;
  on_clock: number;
  off_worked: number;
  work_hours: number;
};

export type DashboardAttendanceSnapshotOptions = {
  mode?: SnapshotMode;
  workDate?: string;
  now?: Date;
  timezone?: string;
  cutoffHour?: number;
  dryRun?: boolean;
};

export type DashboardAttendanceSnapshotResult = {
  mode: SnapshotMode;
  work_date: string;
  range_start: string;
  range_end: string;
  rows_scanned: {
    schedules: number;
    employees: number;
    punches: number;
  };
  rows_ready: number;
  rows_upserted: number;
  snapshot_status: SnapshotMode;
  dry_run: boolean;
};

const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_CUTOFF_HOUR = 5;
const SCHEDULE_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');
const PAGE_SIZE = 1000;

const toDateOnly = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const addDaysDateOnly = (dateOnly: string, days: number) => toDateOnly(addDays(new Date(`${dateOnly}T00:00:00`), days));

const normalizeDateOnly = (value: unknown) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[tT\s].*)?$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
};

const isDateOnly = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());

const isMissingColumnError = (error: unknown, column: string) => {
  const text = String((error as Error)?.message ?? error ?? '').toLowerCase();
  const col = column.toLowerCase();
  return (
    (text.includes('does not exist') || text.includes('not exist') || text.includes('undefined column')) &&
    (text.includes(`.${col}`) || text.includes(`'${col}'`) || text.includes(`"${col}"`) || text.includes(col))
  );
};

const getDateOnlyInTimeZone = (value: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
};

const getOperationalDate = (now: Date, timezone: string, cutoffHour: number) => {
  const today = getDateOnlyInTimeZone(now, timezone);
  const [year, month, day] = today.split('-').map(Number);
  const todayCutoff = zonedDateTimeToUtc({ year, month, day, hour: cutoffHour, minute: 0, second: 0 }, timezone);
  if (now.getTime() >= todayCutoff.getTime()) return today;
  return addDaysDateOnly(today, -1);
};

const getOperationalRange = (workDate: string, timezone: string, cutoffHour: number) => {
  const [year, month, day] = workDate.split('-').map(Number);
  const start = zonedDateTimeToUtc({ year, month, day, hour: cutoffHour, minute: 0, second: 0 }, timezone);
  const nextLocal = addDays(new Date(`${workDate}T00:00:00`), 1);
  const end = zonedDateTimeToUtc(
    {
      year: nextLocal.getFullYear(),
      month: nextLocal.getMonth() + 1,
      day: nextLocal.getDate(),
      hour: cutoffHour,
      minute: 0,
      second: 0
    },
    timezone
  );
  return { start, end };
};

export const getDashboardSnapshotWorkDate = (options: DashboardAttendanceSnapshotOptions = {}) => {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const cutoffHour = clampHour(options.cutoffHour, DEFAULT_CUTOFF_HOUR);
  if (options.workDate && isDateOnly(options.workDate)) return options.workDate;
  if (options.mode === 'expected') {
    return addDaysDateOnly(getDateOnlyInTimeZone(options.now ?? new Date(), timezone), -1);
  }
  return getOperationalDate(options.now ?? new Date(), timezone, cutoffHour);
};

const getTemplateDateForWorkDate = (workDate: string) => {
  const date = new Date(`${workDate}T00:00:00`);
  const dayIndex = Number.isNaN(date.getTime()) ? 0 : (date.getDay() + 6) % 7;
  return toDateOnly(addDays(SCHEDULE_TEMPLATE_WEEK_START, dayIndex));
};

const clampHour = (value: unknown, fallback: number) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(23, Math.floor(num))) : fallback;
};

const toEpochMs = (value: unknown) => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : 0;
};

const pickLatestByStaff = <T extends { staff_id?: unknown; updated_at?: unknown; created_at?: unknown; id?: unknown }>(rows: T[]) => {
  const byStaff = new Map<string, T>();
  for (const row of rows) {
    const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!staff) continue;
    const previous = byStaff.get(staff);
    if (!previous) {
      byStaff.set(staff, row);
      continue;
    }
    const previousMs = Math.max(toEpochMs(previous.updated_at), toEpochMs(previous.created_at));
    const currentMs = Math.max(toEpochMs(row.updated_at), toEpochMs(row.created_at));
    if (currentMs > previousMs) {
      byStaff.set(staff, row);
      continue;
    }
    if (currentMs < previousMs) continue;
    const previousId = Number(previous.id ?? 0);
    const currentId = Number(row.id ?? 0);
    if (Number.isFinite(currentId) && Number.isFinite(previousId) && currentId > previousId) byStaff.set(staff, row);
  }
  return Array.from(byStaff.values());
};

const getScheduleStateFromNote = (note: unknown) => {
  const raw = String(note ?? '').trim();
  if (raw === '__new__') return 'new';
  if (raw === '__temp_work__') return 'temp_work';
  if (raw === '__replacement__') return 'planned_temp_work';
  if (raw === '__planned_temp_work__') return 'planned_temp_work';
  if (raw === '__leave__') return 'leave';
  if (raw === '__planned_leave__') return 'planned_leave';
  if (raw === '__temp_rest__') return 'temp_rest';
  if (raw === '__planned_temp_rest__') return 'planned_temp_rest';
  if (raw === '__rest__') return 'rest';
  return 'work';
};

const isWorkingScheduleState = (state: string) =>
  state === 'new' || state === 'work' || state === 'temp_work' || state === 'planned_temp_work';

const isEmployeeActive = (employee: EmployeeRow | null | undefined) => {
  if (!employee) return false;
  if (isEmployeeTerminated({ terminatedAt: employee.terminated_at })) return false;
  const raw = employee.active;
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  return !text || (text !== 'false' && text !== '0' && text !== 'f' && text !== 'no');
};

const normalizeShiftValue = (value: unknown): '' | Shift => {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return '';
  if (text === 'early' || text === 'morning' || text === 'day' || text === 'am') return 'early';
  if (text === 'late' || text === 'night' || text === 'evening' || text === 'pm') return 'late';
  return '';
};

const getShiftBucketFromPunchTime = (value: unknown): '' | Shift => {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 5 * 60 && minutes < 15 * 60 ? 'early' : 'late';
};

const computeWorkHoursFromPunches = (punches: PunchRow[], capEnd: Date) => {
  const capEndMs = capEnd.getTime();
  if (!Number.isFinite(capEndMs)) return 0;
  let totalMs = 0;
  let currentInMs: number | null = null;
  for (const punch of punches) {
    const atMs = Date.parse(String(punch.created_at ?? ''));
    if (!Number.isFinite(atMs)) continue;
    const action = String(punch.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
    if (action === 'IN') {
      currentInMs = atMs;
      continue;
    }
    if (currentInMs !== null && atMs > currentInMs) totalMs += atMs - currentInMs;
    currentInMs = null;
  }
  if (currentInMs !== null && capEndMs > currentInMs) totalMs += capEndMs - currentInMs;
  return totalMs / 3600000;
};

const isNewHirePlaceholderStaffId = (value: string) => {
  const id = String(value ?? '').trim();
  if (!id) return false;
  if (/^newreq[-_]/i.test(id)) return true;
  return /^newreq[-_]\d{8}(?:[-_][a-z]+)?[-_]\d+$/i.test(id);
};

const resolvePositionName = (value: unknown, positionNames: readonly string[]) => {
  const normalized = normalizePositionName(value);
  if (!normalized) return '';
  const exact = positionNames.find((position) => normalizePositionName(position).toLowerCase() === normalized.toLowerCase());
  if (exact) return normalizePositionName(exact);
  return normalized;
};

const resolveStaffPosition = (schedulePosition: unknown, employeePosition: unknown, positionNames: readonly string[]) =>
  resolvePositionName(employeePosition, positionNames) || resolvePositionName(schedulePosition, positionNames);

const fetchAllRows = async <T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data?: T[] | null; error?: { message?: string } | null }>,
  pageSize = PAGE_SIZE
) => {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const res = await queryFactory(from, to);
    if (res.error) throw new Error(String(res.error.message ?? 'Failed to load rows.'));
    const page = Array.isArray(res.data) ? res.data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
};

const fetchPositionContext = async (supabase: SupabaseLike) => {
  const load = (selectColumns: string) =>
    fetchAllRows<PositionRecord>((from, to) =>
      supabase
        .from('ob_positions')
        .select(selectColumns)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true })
        .range(from, to)
    );

  let records: PositionRecord[] = [];
  try {
    records = await load('id, name, department, is_active, display_order, created_at, updated_at');
  } catch (error) {
    const message = String((error as Error)?.message ?? error ?? '').toLowerCase();
    if (!message.includes('department')) throw error;
    records = await load('id, name, is_active, display_order, created_at, updated_at');
  }

  const names = buildAttendanceTrackedPositionNames(records);
  const positionNames = names.length ? names : [...DEFAULT_POSITION_NAMES];
  const departments = new Map<string, PositionDepartment>();
  const hidden = new Set<string>();
  for (const record of records) {
    const name = normalizePositionName(record.name);
    if (!name) continue;
    const department = normalizePositionDepartment(record.department);
    departments.set(name, department);
    if (department === 'hidden') hidden.add(name.toLowerCase());
  }
  return { positionNames, departments, hidden };
};

const fetchScheduleRows = async (supabase: SupabaseLike, workDate: string) => {
  const templateDate = getTemplateDateForWorkDate(workDate);
  const rows = await fetchAllRows<ScheduleRow>((from, to) =>
    supabase
      .from('ob_schedules')
      .select('id, staff_id, position, note, updated_at, created_at, date')
      .eq('date', templateDate)
      .order('created_at', { ascending: false })
      .range(from, to)
  );
  if (rows.length > 0) return rows;

  let workDateRows: ScheduleRow[] = [];
  try {
    workDateRows = await fetchAllRows<ScheduleRow>((from, to) =>
      supabase
        .from('ob_schedules')
        .select('id, staff_id, position, note, updated_at, created_at, work_date')
        .eq('work_date', workDate)
        .order('created_at', { ascending: false })
        .range(from, to)
    );
  } catch (error) {
    if (!isMissingColumnError(error, 'work_date')) throw error;
  }
  if (workDateRows.length > 0) return workDateRows;

  const recentRows = await fetchAllRows<ScheduleRow>((from, to) =>
    supabase
      .from('ob_schedules')
      .select('id, staff_id, position, note, updated_at, created_at, date')
      .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .range(from, to)
  );
  return recentRows.filter((row) => normalizeDateOnly(row.date) === templateDate);
};

const fetchEmployees = async (supabase: SupabaseLike, staffIds: string[]) => {
  const employees = new Map<string, EmployeeRow>();
  for (let index = 0; index < staffIds.length; index += 200) {
    const batch = staffIds.slice(index, index + 200);
    const rows = await fetchAllRows<EmployeeRow>((from, to) =>
      supabase
        .from('ob_employees')
        .select('staff_id, name, agency, position, shift, active, terminated_at')
        .in('staff_id', batch)
        .order('created_at', { ascending: false })
        .range(from, to)
    );
    for (const row of rows) {
      const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staffId || employees.has(staffId) || !isEmployeeActive(row)) continue;
      employees.set(staffId, row);
    }
  }
  return employees;
};

const fetchPunches = async (supabase: SupabaseLike, rangeStart: string, rangeEnd: string, cutoffHour: number) => {
  const rows = await fetchAllRows<PunchRow>((from, to) =>
    supabase
      .from('ob_punches')
      .select('id, staff_id, action, created_at')
      .gte('created_at', rangeStart)
      .lt('created_at', rangeEnd)
      .order('created_at', { ascending: true })
      .range(from, to)
  );
  const byStaff = new Map<string, PunchRow[]>();
  for (const row of rows) {
    const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!staffId) continue;
    if (isExactOperationalCutoffOut(String(row.created_at ?? ''), row.action, cutoffHour)) continue;
    const list = byStaff.get(staffId) ?? [];
    list.push({
      ...row,
      staff_id: staffId,
      action: String(row.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN'
    });
    byStaff.set(staffId, list);
  }
  return { rows, byStaff };
};

export const buildDashboardAttendanceSnapshotStats = async (
  supabase: SupabaseLike,
  options: DashboardAttendanceSnapshotOptions = {}
) => {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const cutoffHour = clampHour(options.cutoffHour, DEFAULT_CUTOFF_HOUR);
  const workDate = getDashboardSnapshotWorkDate({ ...options, timezone, cutoffHour });
  const range = getOperationalRange(workDate, timezone, cutoffHour);
  const rangeStartIso = range.start.toISOString();
  const rangeEndIso = range.end.toISOString();
  const capEnd = options.mode === 'actual' ? range.end : new Date(Math.min((options.now ?? new Date()).getTime(), range.end.getTime()));

  const [{ positionNames, departments, hidden }, scheduleRowsRaw, punchLoad] = await Promise.all([
    fetchPositionContext(supabase),
    fetchScheduleRows(supabase, workDate),
    fetchPunches(supabase, rangeStartIso, rangeEndIso, cutoffHour)
  ]);

  const latestScheduleRows = pickLatestByStaff(scheduleRowsRaw);
  const scheduledByStaff = new Map<string, { scheduleState: string; position: string }>();
  for (const row of latestScheduleRows) {
    const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!staffId) continue;
    scheduledByStaff.set(staffId, {
      scheduleState: getScheduleStateFromNote(row.note),
      position: String(row.position ?? '').trim()
    });
  }

  const displayStaffIds = Array.from(new Set([...scheduledByStaff.keys(), ...punchLoad.byStaff.keys()]));
  const employees = await fetchEmployees(supabase, displayStaffIds);
  const activeDisplayStaffIds = displayStaffIds.filter((staffId) => employees.has(staffId));
  const visibleStaffIds = activeDisplayStaffIds.filter((staffId) => {
    const employee = employees.get(staffId);
    const schedule = scheduledByStaff.get(staffId);
    const employeePosition = resolveStaffPosition('', employee?.position, positionNames);
    const schedulePosition = resolveStaffPosition(schedule?.position, '', positionNames);
    return !hidden.has(employeePosition.toLowerCase()) && !hidden.has(schedulePosition.toLowerCase());
  });
  const attendanceTrackedStaffIds = new Set(
    visibleStaffIds.filter((staffId) => {
      const employee = employees.get(staffId);
      const agency = String(employee?.agency ?? '').trim();
      return !isScheduleOnlyAgency(agency) && !isNewHirePlaceholderStaffId(staffId);
    })
  );

  const staffByKey = new Map<string, Set<string>>();
  const restByKey = new Map<string, Set<string>>();
  const keysByStaff = new Map<string, string[]>();
  const hasWorkScheduleStaff = new Set<string>();
  const hasRestScheduleStaff = new Set<string>();
  for (const staffId of scheduledByStaff.keys()) {
    if (!attendanceTrackedStaffIds.has(staffId)) continue;
    const schedule = scheduledByStaff.get(staffId);
    const employee = employees.get(staffId);
    const position = resolveStaffPosition(schedule?.position, employee?.position, positionNames);
    const shift = normalizeShiftValue(employee?.shift) || 'early';
    if (!position || !shift) continue;
    const key = `${shift}:${position}`;
    if (isWorkingScheduleState(String(schedule?.scheduleState ?? ''))) {
      hasWorkScheduleStaff.add(staffId);
      if (!staffByKey.has(key)) staffByKey.set(key, new Set());
      staffByKey.get(key)?.add(staffId);
    } else {
      hasRestScheduleStaff.add(staffId);
      if (!restByKey.has(key)) restByKey.set(key, new Set());
      restByKey.get(key)?.add(staffId);
    }
    const keys = keysByStaff.get(staffId) ?? [];
    if (!keys.includes(key)) keys.push(key);
    keysByStaff.set(staffId, keys);
  }

  for (const [staffId, punches] of punchLoad.byStaff.entries()) {
    if (!attendanceTrackedStaffIds.has(staffId)) continue;
    if (keysByStaff.has(staffId) || hasWorkScheduleStaff.has(staffId) || hasRestScheduleStaff.has(staffId)) continue;
    const employee = employees.get(staffId);
    const position = resolveStaffPosition('', employee?.position, positionNames);
    const shift = normalizeShiftValue(employee?.shift) || getShiftBucketFromPunchTime(punches[0]?.created_at);
    if (!position || !shift) continue;
    keysByStaff.set(staffId, [`${shift}:${position}`]);
  }

  const arrivedByKey = new Map<string, Set<string>>();
  const onClockByKey = new Map<string, Set<string>>();
  const restWorkedByKey = new Map<string, Set<string>>();
  const workHoursByKey = new Map<string, number>();

  for (const [staffId, punches] of punchLoad.byStaff.entries()) {
    if (!attendanceTrackedStaffIds.has(staffId)) continue;
    const keys = keysByStaff.get(staffId) ?? [];
    if (keys.length === 0) continue;
    for (const key of keys) {
      if (!arrivedByKey.has(key)) arrivedByKey.set(key, new Set());
      arrivedByKey.get(key)?.add(staffId);
    }

    const last = punches[punches.length - 1];
    if (last && String(last.action ?? '').toUpperCase() === 'IN') {
      for (const key of keys) {
        if (!onClockByKey.has(key)) onClockByKey.set(key, new Set());
        onClockByKey.get(key)?.add(staffId);
      }
    }

    const isOffWorked = !hasWorkScheduleStaff.has(staffId);
    if (isOffWorked) {
      for (const key of keys) {
        if (!restWorkedByKey.has(key)) restWorkedByKey.set(key, new Set());
        restWorkedByKey.get(key)?.add(staffId);
      }
    }

    const hours = computeWorkHoursFromPunches(punches, capEnd);
    if (Number.isFinite(hours) && hours > 0) {
      for (const key of keys) workHoursByKey.set(key, (workHoursByKey.get(key) ?? 0) + hours);
    }
  }

  const keys = new Set([
    ...staffByKey.keys(),
    ...restByKey.keys(),
    ...arrivedByKey.keys(),
    ...onClockByKey.keys(),
    ...restWorkedByKey.keys(),
    ...workHoursByKey.keys()
  ]);
  const stats: SnapshotStat[] = [];
  for (const key of keys) {
    const [shiftRaw, ...positionParts] = key.split(':');
    const shift = shiftRaw === 'late' ? 'late' : 'early';
    const position = positionParts.join(':').trim();
    if (!position) continue;
    stats.push({
      work_date: workDate,
      shift,
      position,
      department: departments.get(position) ?? normalizePositionDepartment(null),
      expected: staffByKey.get(key)?.size ?? 0,
      present: arrivedByKey.get(key)?.size ?? 0,
      on_clock: onClockByKey.get(key)?.size ?? 0,
      off_worked: restWorkedByKey.get(key)?.size ?? 0,
      work_hours: Math.round((workHoursByKey.get(key) ?? 0) * 100) / 100
    });
  }

  return {
    workDate,
    rangeStartIso,
    rangeEndIso,
    rowsScanned: {
      schedules: scheduleRowsRaw.length,
      employees: employees.size,
      punches: punchLoad.rows.length
    },
    stats
  };
};

export const runDashboardAttendanceSnapshot = async (
  supabase: SupabaseLike,
  options: DashboardAttendanceSnapshotOptions = {}
): Promise<DashboardAttendanceSnapshotResult> => {
  const mode: SnapshotMode = options.mode === 'actual' ? 'actual' : 'expected';
  const built = await buildDashboardAttendanceSnapshotStats(supabase, { ...options, mode });
  const nowIso = (options.now ?? new Date()).toISOString();
  const payload =
    mode === 'expected'
      ? built.stats.map((row) => ({
          work_date: row.work_date,
          shift: row.shift,
          position: row.position,
          department: row.department,
          expected: row.expected,
          snapshot_status: 'expected',
          expected_captured_at: nowIso,
          updated_at: nowIso
        }))
      : built.stats.map((row) => ({
          work_date: row.work_date,
          shift: row.shift,
          position: row.position,
          department: row.department,
          expected: row.expected,
          present: row.present,
          on_clock: row.on_clock,
          off_worked: row.off_worked,
          work_hours: row.work_hours,
          snapshot_status: 'actual',
          actual_captured_at: nowIso,
          updated_at: nowIso
        }));

  if (!options.dryRun && payload.length > 0) {
    const res = await supabase
      .from('ob_dashboard_attendance_snapshots')
      .upsert(payload, { onConflict: 'work_date,shift,position' });
    if (res.error) throw new Error(String(res.error.message ?? 'Failed to save dashboard attendance snapshots.'));
  }

  return {
    mode,
    work_date: built.workDate,
    range_start: built.rangeStartIso,
    range_end: built.rangeEndIso,
    rows_scanned: built.rowsScanned,
    rows_ready: payload.length,
    rows_upserted: options.dryRun ? 0 : payload.length,
    snapshot_status: mode,
    dry_run: Boolean(options.dryRun)
  };
};
