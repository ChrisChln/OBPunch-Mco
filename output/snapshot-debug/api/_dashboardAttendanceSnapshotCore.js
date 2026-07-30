import { isScheduleOnlyAgency } from '../src/shared/agencyRules.js';
import { isEmployeeTerminated } from '../src/shared/employeeStatus.js';
import { isExactOperationalCutoffOut } from '../src/shared/operationalPunches.js';
import { DEFAULT_POSITION_NAMES, buildAttendanceTrackedPositionNames, normalizePositionDepartment, normalizePositionName } from '../src/shared/positions.js';
import { normalizeStaffId } from '../src/lib/staffId.js';
import { zonedDateTimeToUtc } from './_attendanceAutoCheckoutCore.js';
const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_CUTOFF_HOUR = 5;
const SCHEDULE_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');
const PAGE_SIZE = 1000;
const toDateOnly = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const addDays = (value, days) => {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
};
const addDaysDateOnly = (dateOnly, days) => toDateOnly(addDays(new Date(`${dateOnly}T00:00:00`), days));
const normalizeDateOnly = (value) => {
    const raw = String(value ?? '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[tT\s].*)?$/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
};
const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
const isMissingColumnError = (error, column) => {
    const text = String(error?.message ?? error ?? '').toLowerCase();
    const col = column.toLowerCase();
    return ((text.includes('does not exist') || text.includes('not exist') || text.includes('undefined column')) &&
        (text.includes(`.${col}`) || text.includes(`'${col}'`) || text.includes(`"${col}"`) || text.includes(col)));
};
const getDateOnlyInTimeZone = (value, timezone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(value);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
};
const getOperationalDate = (now, timezone, cutoffHour) => {
    const today = getDateOnlyInTimeZone(now, timezone);
    const [year, month, day] = today.split('-').map(Number);
    const todayCutoff = zonedDateTimeToUtc({ year, month, day, hour: cutoffHour, minute: 0, second: 0 }, timezone);
    if (now.getTime() >= todayCutoff.getTime())
        return today;
    return addDaysDateOnly(today, -1);
};
const getOperationalRange = (workDate, timezone, cutoffHour) => {
    const [year, month, day] = workDate.split('-').map(Number);
    const start = zonedDateTimeToUtc({ year, month, day, hour: cutoffHour, minute: 0, second: 0 }, timezone);
    const nextLocal = addDays(new Date(`${workDate}T00:00:00`), 1);
    const end = zonedDateTimeToUtc({
        year: nextLocal.getFullYear(),
        month: nextLocal.getMonth() + 1,
        day: nextLocal.getDate(),
        hour: cutoffHour,
        minute: 0,
        second: 0
    }, timezone);
    return { start, end };
};
export const getDashboardSnapshotWorkDate = (options = {}) => {
    const timezone = options.timezone || DEFAULT_TIMEZONE;
    const cutoffHour = clampHour(options.cutoffHour, DEFAULT_CUTOFF_HOUR);
    if (options.workDate && isDateOnly(options.workDate))
        return options.workDate;
    return getOperationalDate(options.now ?? new Date(), timezone, cutoffHour);
};
const getTemplateDateForWorkDate = (workDate) => {
    const date = new Date(`${workDate}T00:00:00`);
    const dayIndex = Number.isNaN(date.getTime()) ? 0 : (date.getDay() + 6) % 7;
    return toDateOnly(addDays(SCHEDULE_TEMPLATE_WEEK_START, dayIndex));
};
const clampHour = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(0, Math.min(23, Math.floor(num))) : fallback;
};
const toEpochMs = (value) => {
    const ms = Date.parse(String(value ?? ''));
    return Number.isFinite(ms) ? ms : 0;
};
const pickLatestByStaff = (rows) => {
    const byStaff = new Map();
    for (const row of rows) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (!staff)
            continue;
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
        if (currentMs < previousMs)
            continue;
        const previousId = Number(previous.id ?? 0);
        const currentId = Number(row.id ?? 0);
        if (Number.isFinite(currentId) && Number.isFinite(previousId) && currentId > previousId)
            byStaff.set(staff, row);
    }
    return Array.from(byStaff.values());
};
const getScheduleStateFromNote = (note) => {
    const raw = String(note ?? '').trim();
    if (raw === '__new__')
        return 'new';
    if (raw === '__temp_work__')
        return 'temp_work';
    if (raw === '__replacement__')
        return 'planned_temp_work';
    if (raw === '__planned_temp_work__')
        return 'planned_temp_work';
    if (raw === '__leave__')
        return 'leave';
    if (raw === '__planned_leave__')
        return 'planned_leave';
    if (raw === '__temp_rest__')
        return 'temp_rest';
    if (raw === '__planned_temp_rest__')
        return 'planned_temp_rest';
    if (raw === '__rest__')
        return 'rest';
    return 'work';
};
const isWorkingScheduleState = (state) => state === 'new' || state === 'work' || state === 'temp_work' || state === 'planned_temp_work';
const isEmployeeActive = (employee) => {
    if (!employee)
        return false;
    if (isEmployeeTerminated({ terminatedAt: employee.terminated_at }))
        return false;
    const raw = employee.active;
    if (raw === null || raw === undefined)
        return true;
    if (typeof raw === 'boolean')
        return raw;
    const text = String(raw).trim().toLowerCase();
    return !text || (text !== 'false' && text !== '0' && text !== 'f' && text !== 'no');
};
const normalizeShiftValue = (value) => {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text)
        return '';
    if (text === 'early' || text === 'morning' || text === 'day' || text === 'am')
        return 'early';
    if (text === 'late' || text === 'night' || text === 'evening' || text === 'pm')
        return 'late';
    return '';
};
const getShiftBucketFromPunchTime = (value) => {
    const date = new Date(String(value ?? ''));
    if (Number.isNaN(date.getTime()))
        return '';
    const minutes = date.getHours() * 60 + date.getMinutes();
    return minutes >= 5 * 60 && minutes < 15 * 60 ? 'early' : 'late';
};
const computeWorkHoursFromPunches = (punches, capEnd) => {
    const capEndMs = capEnd.getTime();
    if (!Number.isFinite(capEndMs))
        return 0;
    let totalMs = 0;
    let currentInMs = null;
    for (const punch of punches) {
        const atMs = Date.parse(String(punch.created_at ?? ''));
        if (!Number.isFinite(atMs))
            continue;
        const action = String(punch.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
        if (action === 'IN') {
            currentInMs = atMs;
            continue;
        }
        if (currentInMs !== null && atMs > currentInMs)
            totalMs += atMs - currentInMs;
        currentInMs = null;
    }
    if (currentInMs !== null && capEndMs > currentInMs)
        totalMs += capEndMs - currentInMs;
    return totalMs / 3600000;
};
const isNewHirePlaceholderStaffId = (value) => {
    const id = String(value ?? '').trim();
    if (!id)
        return false;
    if (/^newreq[-_]/i.test(id))
        return true;
    return /^newreq[-_]\d{8}(?:[-_][a-z]+)?[-_]\d+$/i.test(id);
};
const resolvePositionName = (value, positionNames) => {
    const normalized = normalizePositionName(value);
    if (!normalized)
        return '';
    const exact = positionNames.find((position) => normalizePositionName(position).toLowerCase() === normalized.toLowerCase());
    if (exact)
        return normalizePositionName(exact);
    return normalized;
};
const resolveStaffPosition = (schedulePosition, employeePosition, positionNames) => resolvePositionName(employeePosition, positionNames) || resolvePositionName(schedulePosition, positionNames);
const fetchAllRows = async (queryFactory, pageSize = PAGE_SIZE) => {
    const rows = [];
    let from = 0;
    while (true) {
        const to = from + pageSize - 1;
        const res = await queryFactory(from, to);
        if (res.error)
            throw new Error(String(res.error.message ?? 'Failed to load rows.'));
        const page = Array.isArray(res.data) ? res.data : [];
        rows.push(...page);
        if (page.length < pageSize)
            break;
        from += pageSize;
    }
    return rows;
};
const fetchPositionContext = async (supabase) => {
    const load = (selectColumns) => fetchAllRows((from, to) => supabase
        .from('ob_positions')
        .select(selectColumns)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true })
        .range(from, to));
    let records = [];
    try {
        records = await load('id, name, department, is_active, display_order, created_at, updated_at');
    }
    catch (error) {
        const message = String(error?.message ?? error ?? '').toLowerCase();
        if (!message.includes('department'))
            throw error;
        records = await load('id, name, is_active, display_order, created_at, updated_at');
    }
    const names = buildAttendanceTrackedPositionNames(records);
    const positionNames = names.length ? names : [...DEFAULT_POSITION_NAMES];
    const departments = new Map();
    const hidden = new Set();
    for (const record of records) {
        const name = normalizePositionName(record.name);
        if (!name)
            continue;
        const department = normalizePositionDepartment(record.department);
        departments.set(name, department);
        if (department === 'hidden')
            hidden.add(name.toLowerCase());
    }
    return { positionNames, departments, hidden };
};
const fetchScheduleRows = async (supabase, workDate) => {
    const templateDate = getTemplateDateForWorkDate(workDate);
    const rows = await fetchAllRows((from, to) => supabase
        .from('ob_schedules')
        .select('id, staff_id, position, note, updated_at, created_at, date')
        .eq('date', templateDate)
        .order('created_at', { ascending: false })
        .range(from, to));
    if (rows.length > 0)
        return rows;
    let workDateRows = [];
    try {
        workDateRows = await fetchAllRows((from, to) => supabase
            .from('ob_schedules')
            .select('id, staff_id, position, note, updated_at, created_at, work_date')
            .eq('work_date', workDate)
            .order('created_at', { ascending: false })
            .range(from, to));
    }
    catch (error) {
        if (!isMissingColumnError(error, 'work_date'))
            throw error;
    }
    if (workDateRows.length > 0)
        return workDateRows;
    const recentRows = await fetchAllRows((from, to) => supabase
        .from('ob_schedules')
        .select('id, staff_id, position, note, updated_at, created_at, date')
        .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .range(from, to));
    return recentRows.filter((row) => normalizeDateOnly(row.date) === templateDate);
};
const fetchEmployees = async (supabase, staffIds) => {
    const employees = new Map();
    for (let index = 0; index < staffIds.length; index += 200) {
        const batch = staffIds.slice(index, index + 200);
        const rows = await fetchAllRows((from, to) => supabase
            .from('ob_employees')
            .select('staff_id, name, agency, "Agency", position, "Position", shift, active, terminated_at')
            .in('staff_id', batch)
            .order('created_at', { ascending: false })
            .range(from, to));
        for (const row of rows) {
            const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
            if (!staffId || employees.has(staffId) || !isEmployeeActive(row))
                continue;
            employees.set(staffId, row);
        }
    }
    return employees;
};
const fetchPunches = async (supabase, rangeStart, rangeEnd, cutoffHour) => {
    const rows = await fetchAllRows((from, to) => supabase
        .from('ob_punches')
        .select('id, staff_id, action, created_at')
        .gte('created_at', rangeStart)
        .lt('created_at', rangeEnd)
        .order('created_at', { ascending: true })
        .range(from, to));
    const byStaff = new Map();
    for (const row of rows) {
        const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (!staffId)
            continue;
        if (isExactOperationalCutoffOut(String(row.created_at ?? ''), row.action, cutoffHour))
            continue;
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
export const buildDashboardAttendanceSnapshotStats = async (supabase, options = {}) => {
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
    const scheduledByStaff = new Map();
    for (const row of latestScheduleRows) {
        const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (!staffId)
            continue;
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
        const employeePosition = resolveStaffPosition('', employee?.position ?? employee?.Position, positionNames);
        const schedulePosition = resolveStaffPosition(schedule?.position, '', positionNames);
        return !hidden.has(employeePosition.toLowerCase()) && !hidden.has(schedulePosition.toLowerCase());
    });
    const attendanceTrackedStaffIds = new Set(visibleStaffIds.filter((staffId) => {
        const employee = employees.get(staffId);
        const agency = String(employee?.agency ?? employee?.Agency ?? '').trim();
        return !isScheduleOnlyAgency(agency) && !isNewHirePlaceholderStaffId(staffId);
    }));
    const staffByKey = new Map();
    const restByKey = new Map();
    const keysByStaff = new Map();
    const hasWorkScheduleStaff = new Set();
    const hasRestScheduleStaff = new Set();
    for (const staffId of scheduledByStaff.keys()) {
        if (!attendanceTrackedStaffIds.has(staffId))
            continue;
        const schedule = scheduledByStaff.get(staffId);
        const employee = employees.get(staffId);
        const position = resolveStaffPosition(schedule?.position, employee?.position ?? employee?.Position, positionNames);
        const shift = normalizeShiftValue(employee?.shift) || 'early';
        if (!position || !shift)
            continue;
        const key = `${shift}:${position}`;
        if (isWorkingScheduleState(String(schedule?.scheduleState ?? ''))) {
            hasWorkScheduleStaff.add(staffId);
            if (!staffByKey.has(key))
                staffByKey.set(key, new Set());
            staffByKey.get(key)?.add(staffId);
        }
        else {
            hasRestScheduleStaff.add(staffId);
            if (!restByKey.has(key))
                restByKey.set(key, new Set());
            restByKey.get(key)?.add(staffId);
        }
        const keys = keysByStaff.get(staffId) ?? [];
        if (!keys.includes(key))
            keys.push(key);
        keysByStaff.set(staffId, keys);
    }
    for (const [staffId, punches] of punchLoad.byStaff.entries()) {
        if (!attendanceTrackedStaffIds.has(staffId))
            continue;
        if (keysByStaff.has(staffId) || hasWorkScheduleStaff.has(staffId) || hasRestScheduleStaff.has(staffId))
            continue;
        const employee = employees.get(staffId);
        const position = resolveStaffPosition('', employee?.position ?? employee?.Position, positionNames);
        const shift = normalizeShiftValue(employee?.shift) || getShiftBucketFromPunchTime(punches[0]?.created_at);
        if (!position || !shift)
            continue;
        keysByStaff.set(staffId, [`${shift}:${position}`]);
    }
    const arrivedByKey = new Map();
    const onClockByKey = new Map();
    const restWorkedByKey = new Map();
    const workHoursByKey = new Map();
    for (const [staffId, punches] of punchLoad.byStaff.entries()) {
        if (!attendanceTrackedStaffIds.has(staffId))
            continue;
        const keys = keysByStaff.get(staffId) ?? [];
        if (keys.length === 0)
            continue;
        for (const key of keys) {
            if (!arrivedByKey.has(key))
                arrivedByKey.set(key, new Set());
            arrivedByKey.get(key)?.add(staffId);
        }
        const last = punches[punches.length - 1];
        if (last && String(last.action ?? '').toUpperCase() === 'IN') {
            for (const key of keys) {
                if (!onClockByKey.has(key))
                    onClockByKey.set(key, new Set());
                onClockByKey.get(key)?.add(staffId);
            }
        }
        const isOffWorked = !hasWorkScheduleStaff.has(staffId);
        if (isOffWorked) {
            for (const key of keys) {
                if (!restWorkedByKey.has(key))
                    restWorkedByKey.set(key, new Set());
                restWorkedByKey.get(key)?.add(staffId);
            }
        }
        const hours = computeWorkHoursFromPunches(punches, capEnd);
        if (Number.isFinite(hours) && hours > 0) {
            for (const key of keys)
                workHoursByKey.set(key, (workHoursByKey.get(key) ?? 0) + hours);
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
    const stats = [];
    for (const key of keys) {
        const [shiftRaw, ...positionParts] = key.split(':');
        const shift = shiftRaw === 'late' ? 'late' : 'early';
        const position = positionParts.join(':').trim();
        if (!position)
            continue;
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
export const runDashboardAttendanceSnapshot = async (supabase, options = {}) => {
    const mode = options.mode === 'actual' ? 'actual' : 'expected';
    const built = await buildDashboardAttendanceSnapshotStats(supabase, { ...options, mode });
    const nowIso = (options.now ?? new Date()).toISOString();
    const payload = mode === 'expected'
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
        if (res.error)
            throw new Error(String(res.error.message ?? 'Failed to save dashboard attendance snapshots.'));
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
