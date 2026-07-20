import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_START_DATE = '2026-07-01';
const DEFAULT_TIMEZONE = 'America/New_York';
const PAGE_SIZE = 1000;
const DEFAULT_POSITION_NAMES = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'Water Spider', 'FLEX TEAM'];
const SCHEDULE_TEMPLATE_WEEK_START = '2000-01-03';

const parseEnvText = (text) => {
  const out = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    out.set(key, value);
  }
  return out;
};

const loadLocalEnv = () => {
  const env = new Map();
  for (const filename of ['.env', '.env.local']) {
    const envPath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(envPath)) continue;
    for (const [key, value] of parseEnvText(fs.readFileSync(envPath, 'utf8'))) {
      if (!env.has(key)) env.set(key, value);
    }
  }
  return env;
};

const mergeProcessEnv = (localEnv) => {
  const env = new Map(localEnv);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env.set(key, value);
  }
  return env;
};

const isDateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());

const toDateOnlyUtc = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

const addUtcDays = (dateOnly, days) => {
  const [year, month, day] = String(dateOnly).split('-').map(Number);
  return toDateOnlyUtc(new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0)));
};

const todayInTimeZone = (now, timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

export const buildSnapshotBackfillDates = (startDate, endDate) => {
  const start = String(startDate ?? '').trim();
  const end = String(endDate ?? '').trim();
  if (!isDateOnly(start)) throw new Error(`Invalid START_DATE: ${start || '(empty)'}. Expected YYYY-MM-DD.`);
  if (!isDateOnly(end)) throw new Error(`Invalid END_DATE: ${end || '(empty)'}. Expected YYYY-MM-DD.`);
  if (start > end) throw new Error(`START_DATE must be on or before END_DATE. Received ${start} > ${end}.`);

  const dates = [];
  for (let current = start; current <= end; current = addUtcDays(current, 1)) {
    dates.push(current);
  }
  return dates;
};

const normalizeBaseUrl = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const withProtocol = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
};

const isTruthyFlag = (value) => ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase());
const normalizeStaffId = (value) => String(value ?? '').trim().toUpperCase();
const normalizePositionName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalizeAgencyKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const isScheduleOnlyAgency = (value) => normalizeAgencyKey(value) === 'jdl' || normalizeAgencyKey(value) === '自顾';

const normalizePositionDepartment = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'ib') return 'IB';
  if (text === 'inv' || text === 'inventory') return 'INV';
  if (text === 'hidden' || text === 'hide' || text === '隐藏') return 'hidden';
  return 'OB';
};

const normalizeShift = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'late' || text === 'night' || text === 'evening' || text === 'pm') return 'late';
  return 'early';
};

const isEmployeeActive = (employee) => {
  if (!employee) return false;
  if (employee.terminated_at) return false;
  const active = employee.active;
  if (active === null || active === undefined) return true;
  if (typeof active === 'boolean') return active;
  const text = String(active).trim().toLowerCase();
  return !text || (text !== 'false' && text !== '0' && text !== 'f' && text !== 'no');
};

const getScheduleStateFromNote = (note) => {
  const raw = String(note ?? '').trim();
  if (raw === '__new__') return 'new';
  if (raw === '__temp_work__') return 'temp_work';
  if (raw === '__replacement__' || raw === '__planned_temp_work__') return 'planned_temp_work';
  if (raw === '__leave__') return 'leave';
  if (raw === '__planned_leave__') return 'planned_leave';
  if (raw === '__temp_rest__') return 'temp_rest';
  if (raw === '__planned_temp_rest__') return 'planned_temp_rest';
  if (raw === '__rest__') return 'rest';
  return 'work';
};

const isWorkingScheduleState = (state) =>
  state === 'new' || state === 'work' || state === 'temp_work' || state === 'planned_temp_work';

const toEpochMs = (value) => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : 0;
};

const pickLatestByStaff = (rows) => {
  const byStaff = new Map();
  for (const row of rows) {
    const staffId = normalizeStaffId(row?.staff_id);
    if (!staffId) continue;
    const previous = byStaff.get(staffId);
    if (!previous) {
      byStaff.set(staffId, row);
      continue;
    }
    const previousMs = Math.max(toEpochMs(previous.updated_at), toEpochMs(previous.created_at));
    const currentMs = Math.max(toEpochMs(row.updated_at), toEpochMs(row.created_at));
    if (currentMs > previousMs) byStaff.set(staffId, row);
  }
  return Array.from(byStaff.values());
};

const getTemplateDateForWorkDate = (workDate) => {
  const date = new Date(`${workDate}T00:00:00Z`);
  const dayIndex = Number.isNaN(date.getTime()) ? 0 : (date.getUTCDay() + 6) % 7;
  return addUtcDays(SCHEDULE_TEMPLATE_WEEK_START, dayIndex);
};

const resolvePositionName = (value, positionNames) => {
  const normalized = normalizePositionName(value);
  if (!normalized) return '';
  const exact = positionNames.find((position) => normalizePositionName(position).toLowerCase() === normalized.toLowerCase());
  return exact ? normalizePositionName(exact) : normalized;
};

export const buildExpectedSnapshotRows = ({ workDate, schedules, employees, positions, capturedAt }) => {
  const positionNames = positions
    .filter((position) => position?.is_active !== false && normalizePositionDepartment(position?.department) !== 'hidden')
    .sort((left, right) => {
      const order = Number(left?.display_order ?? 0) - Number(right?.display_order ?? 0);
      if (order !== 0) return order;
      return normalizePositionName(left?.name).localeCompare(normalizePositionName(right?.name), 'en-US');
    })
    .map((position) => normalizePositionName(position?.name))
    .filter(Boolean);
  const trackedPositionNames = positionNames.length ? positionNames : DEFAULT_POSITION_NAMES;
  const departmentByPosition = new Map();
  const hiddenPositions = new Set();
  for (const position of positions) {
    const name = normalizePositionName(position?.name);
    if (!name) continue;
    const department = normalizePositionDepartment(position?.department);
    departmentByPosition.set(name.toLowerCase(), department);
    if (department === 'hidden') hiddenPositions.add(name.toLowerCase());
  }

  const employeesByStaff = new Map();
  for (const employee of employees) {
    const staffId = normalizeStaffId(employee?.staff_id);
    if (staffId && !employeesByStaff.has(staffId) && isEmployeeActive(employee)) employeesByStaff.set(staffId, employee);
  }

  const expectedByKey = new Map();
  for (const schedule of pickLatestByStaff(schedules)) {
    const staffId = normalizeStaffId(schedule?.staff_id);
    if (!staffId) continue;
    if (!isWorkingScheduleState(getScheduleStateFromNote(schedule?.note))) continue;

    const employee = employeesByStaff.get(staffId);
    if (!employee) continue;
    const agency = String(employee?.agency ?? employee?.Agency ?? '').trim();
    if (isScheduleOnlyAgency(agency)) continue;

    const position = resolvePositionName(employee?.position ?? employee?.Position ?? schedule?.position, trackedPositionNames);
    if (!position || hiddenPositions.has(position.toLowerCase())) continue;
    const shift = normalizeShift(employee?.shift);
    const key = `${shift}:${position}`;
    expectedByKey.set(key, (expectedByKey.get(key) ?? 0) + 1);
  }

  return Array.from(expectedByKey.entries())
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([key, expected]) => {
      const [shift, ...positionParts] = key.split(':');
      const position = positionParts.join(':');
      return {
        work_date: workDate,
        shift,
        position,
        department: departmentByPosition.get(position.toLowerCase()) ?? 'OB',
        expected,
        snapshot_status: 'expected',
        expected_captured_at: capturedAt,
        updated_at: capturedAt
      };
    });
};

export const resolveSnapshotBackfillConfig = (
  env,
  { now = new Date(), timezone = DEFAULT_TIMEZONE } = {}
) => {
  const baseUrl = normalizeBaseUrl(
    env.get('SNAPSHOT_BACKFILL_BASE_URL') ?? env.get('APP_BASE_URL') ?? env.get('VERCEL_URL')
  );
  const token = String(env.get('SNAPSHOT_BACKFILL_TOKEN') ?? env.get('ADMIN_TOKEN') ?? env.get('CRON_SECRET') ?? '').trim();
  const startDate = String(env.get('START_DATE') ?? DEFAULT_START_DATE).trim();
  const endDate = String(env.get('END_DATE') ?? todayInTimeZone(now, timezone)).trim();
  const dryRun = isTruthyFlag(env.get('DRY_RUN'));
  const mode = String(env.get('SNAPSHOT_BACKFILL_MODE') ?? 'direct').trim().toLowerCase() === 'api' ? 'api' : 'direct';
  const supabaseUrl = String(env.get('SUPABASE_URL') ?? env.get('VITE_SUPABASE_URL') ?? '').trim();
  const supabaseKey = String(env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();

  return { baseUrl, token, startDate, endDate, dryRun, mode, supabaseUrl, supabaseKey };
};

export const buildSnapshotBackfillRequest = ({ baseUrl, token, workDate, dryRun }) => {
  const url = new URL('/api/dashboard-attendance-snapshot-expected', normalizeBaseUrl(baseUrl));
  url.searchParams.set('work_date', workDate);
  if (dryRun) url.searchParams.set('dry_run', 'true');

  return {
    url: url.toString(),
    options: {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  };
};

export const runSnapshotBackfill = async ({ fetchImpl = fetch, config }) => {
  if (!config.baseUrl) throw new Error('Missing APP_BASE_URL, VERCEL_URL, or SNAPSHOT_BACKFILL_BASE_URL.');
  if (!config.token) throw new Error('Missing ADMIN_TOKEN, CRON_SECRET, or SNAPSHOT_BACKFILL_TOKEN.');

  const dates = buildSnapshotBackfillDates(config.startDate, config.endDate);
  const results = [];

  for (const workDate of dates) {
    const request = buildSnapshotBackfillRequest({
      baseUrl: config.baseUrl,
      token: config.token,
      workDate,
      dryRun: config.dryRun
    });
    const response = await fetchImpl(request.url, request.options);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      throw new Error(`Snapshot backfill failed for ${workDate}: HTTP ${response.status} ${text}`);
    }

    results.push({ workDate, status: response.status, body });
  }

  return results;
};

const fetchAllRows = async (queryFactory) => {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const res = await queryFactory(from, to);
    if (res.error) throw new Error(String(res.error.message ?? 'Failed to load rows.'));
    const page = Array.isArray(res.data) ? res.data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
};

const createSupabase = (config) => {
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for direct mode.');
  }
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
};

export const runSnapshotBackfillDirect = async ({ config }) => {
  const supabase = createSupabase(config);
  const dates = buildSnapshotBackfillDates(config.startDate, config.endDate);
  const capturedAt = new Date().toISOString();
  const positions = await fetchAllRows((from, to) =>
    supabase
      .from('ob_positions')
      .select('name, department, is_active, display_order')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })
      .range(from, to)
  );
  const results = [];

  for (const workDate of dates) {
    const templateDate = getTemplateDateForWorkDate(workDate);
    const schedules = await fetchAllRows((from, to) =>
      supabase
        .from('ob_schedules')
        .select('staff_id, position, note, updated_at, created_at, date')
        .eq('date', templateDate)
        .order('created_at', { ascending: false })
        .range(from, to)
    );
    const staffIds = Array.from(new Set(schedules.map((row) => normalizeStaffId(row?.staff_id)).filter(Boolean)));
    const employees = [];
    for (let index = 0; index < staffIds.length; index += 200) {
      const batch = staffIds.slice(index, index + 200);
      const rows = await fetchAllRows((from, to) =>
        supabase
          .from('ob_employees')
          .select('staff_id, agency, "Agency", position, "Position", shift, active, terminated_at')
          .in('staff_id', batch)
          .order('created_at', { ascending: false })
          .range(from, to)
      );
      employees.push(...rows);
    }
    const rows = buildExpectedSnapshotRows({ workDate, schedules, employees, positions, capturedAt });
    if (!config.dryRun && rows.length > 0) {
      const res = await supabase
        .from('ob_dashboard_attendance_snapshots')
        .upsert(rows, { onConflict: 'work_date,shift,position' });
      if (res.error) throw new Error(`Snapshot backfill failed for ${workDate}: ${res.error.message}`);
    }
    results.push({ workDate, rowsReady: rows.length, rowsUpserted: config.dryRun ? 0 : rows.length });
  }

  return results;
};

const main = async () => {
  const env = mergeProcessEnv(loadLocalEnv());
  const config = resolveSnapshotBackfillConfig(env);
  const dates = buildSnapshotBackfillDates(config.startDate, config.endDate);

  console.log(`Dashboard expected snapshot backfill: ${config.startDate} -> ${config.endDate}`);
  console.log(`Mode: ${config.mode}`);
  if (config.mode === 'api') console.log(`Endpoint: ${config.baseUrl}/api/dashboard-attendance-snapshot-expected`);
  console.log(`Dates: ${dates.join(', ')}`);
  console.log(`DRY_RUN=${config.dryRun ? '1' : '0'}`);

  const results = config.mode === 'api' ? await runSnapshotBackfill({ config }) : await runSnapshotBackfillDirect({ config });
  for (const result of results) {
    const rowsUpserted = Number(result.body?.rows_upserted ?? result.rowsUpserted ?? 0);
    const rowsReady = Number(result.body?.rows_ready ?? result.rowsReady ?? 0);
    console.log(`${result.workDate}: ok rows_ready=${rowsReady} rows_upserted=${rowsUpserted}`);
  }
  console.log(`Done. ${results.length} date(s) processed.`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
