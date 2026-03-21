import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClientWithCredentials } from '../lib/supabase';
import { normalizeStaffId } from '../lib/staffId';

export type DynamicProcKey = 'pick' | 'rebin' | 'single_pack' | 'multi_pack';
export type DynamicShiftKey = 'early' | 'late';
export type DynamicUphByShiftProc = Record<DynamicShiftKey, Partial<Record<DynamicProcKey, string>>>;

type ObupStage = 'picking' | 'sorting' | 'packing';
type EmployeeDynamicRow = {
  id?: number | string | null;
  updated_at?: string | null;
  created_at?: string | null;
  staff_id?: string | null;
  position?: string | null;
  Position?: string | null;
  label?: string | null;
  Label?: string | null;
  shift?: string | null;
  active?: boolean | string | number | null;
  terminated_at?: string | null;
  work_account?: string | null;
  WorkAccount?: string | null;
};
type DynamicEmployee = {
  staffId: string;
  shift: DynamicShiftKey;
  procKey: DynamicProcKey;
  stage: ObupStage;
  accountKeys: Set<string>;
};
type StatBucket = { sum: number; count: number };
type DynamicTemplateLoadResult = {
  uphByShiftProc: DynamicUphByShiftProc;
  missingKeys: Array<{ shift: DynamicShiftKey; procKey: DynamicProcKey }>;
  error?: string;
};

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const TEMP_ACCOUNT_ASSIGNMENT_TABLE =
  (import.meta.env.VITE_TEMP_ACCOUNT_ASSIGNMENT_TABLE as string | undefined) ?? 'ob_temp_account_assignments';
const OBUP_REPORTS_TABLE = (import.meta.env.VITE_OBUP_REPORTS_TABLE as string | undefined) ?? 'reports';
const OBUP_REPORT_DETAILS_TABLE =
  (import.meta.env.VITE_OBUP_REPORT_DETAILS_TABLE as string | undefined) ?? 'report_details';
const OBUP_UPLOAD_RECORDS_TABLE = (import.meta.env.VITE_OBUP_UPLOAD_RECORDS_TABLE as string | undefined) ?? 'upload_records';
const OBUP_WHITELIST_TABLE = 'whitelist';
const DYNAMIC_WINDOW_DAYS = 7;
const TARGET_PROC_KEYS: DynamicProcKey[] = ['pick', 'rebin', 'single_pack', 'multi_pack'];

const obupSupabase = createSupabaseClientWithCredentials({
  persistSession: false,
  url: import.meta.env.VITE_OBUP_SUPABASE_URL as string | undefined,
  anonKey: import.meta.env.VITE_OBUP_SUPABASE_ANON_KEY as string | undefined
});

const chunk = <T,>(items: T[], size: number) => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
};

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const toDateOnly = (value: Date) => {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toMs = (value: unknown) => {
  const ms = Date.parse(String(value ?? '').trim());
  return Number.isFinite(ms) ? ms : 0;
};

const normalizeLabelKey = (value: unknown) => String(value ?? '').trim().toLowerCase();

const normalizeWorkAccountKey = (value: string) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const parenMatch = raw.match(/\(([^)]+)\)/);
  if (parenMatch?.[1]) {
    const inside = parenMatch[1].replace(/\s+/g, '');
    const digitsInside = inside.match(/\d{5,}/g);
    if (digitsInside && digitsInside.length > 0) return digitsInside[digitsInside.length - 1];
    if (inside) return inside;
  }
  const allDigits = raw.match(/\d{5,}/g);
  if (allDigits && allDigits.length > 0) return allDigits[allDigits.length - 1];
  return raw.replace(/\s+/g, '');
};

const parseUph = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
};

const emptyDynamicUphMap = (): DynamicUphByShiftProc => ({ early: {}, late: {} });

const isEmployeeActive = (employee: EmployeeDynamicRow) => {
  const raw = employee.active;
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  if (!text) return true;
  if (text === 'false' || text === '0' || text === 'f' || text === 'no') return false;
  return true;
};

const getDynamicPosition = (row: EmployeeDynamicRow) => String(row.position ?? row.Position ?? '').trim();
const getDynamicLabel = (row: EmployeeDynamicRow) => String(row.label ?? row.Label ?? '').trim();
const getDynamicWorkAccount = (row: EmployeeDynamicRow) => String(row.work_account ?? row.WorkAccount ?? '').trim();

export const resolveDynamicProcKey = (positionRaw: string, labelRaw: string): DynamicProcKey | null => {
  const position = String(positionRaw ?? '').trim().toLowerCase();
  const label = normalizeLabelKey(labelRaw);
  if (position === 'pick') return 'pick';
  if (position === 'rebin') return 'rebin';
  if (position !== 'pack') return null;
  if (label.includes('single')) return 'single_pack';
  if (label.includes('multi')) return 'multi_pack';
  return null;
};

const resolveDynamicStage = (procKey: DynamicProcKey): ObupStage => {
  if (procKey === 'pick') return 'picking';
  if (procKey === 'rebin') return 'sorting';
  return 'packing';
};

const formatAverageUph = (value: number) => value.toFixed(2);

const EMPLOYEE_SELECTS = [
  'id, updated_at, created_at, staff_id, "Position", label, shift, active, terminated_at, work_account',
  'id, updated_at, created_at, staff_id, "Position", "Label", shift, active, terminated_at, work_account',
  'id, updated_at, created_at, staff_id, "Position", label, shift, active, terminated_at, "WorkAccount"',
  'id, updated_at, created_at, staff_id, "Position", "Label", shift, active, terminated_at, "WorkAccount"',
  'id, updated_at, created_at, staff_id, position, label, shift, active, terminated_at, work_account',
  'id, updated_at, created_at, staff_id, position, label, shift, active, terminated_at, "WorkAccount"',
  'id, created_at, staff_id, "Position", label, shift, active, terminated_at, work_account',
  'id, created_at, staff_id, "Position", "Label", shift, active, terminated_at, work_account',
  'id, created_at, staff_id, "Position", label, shift, active, terminated_at, "WorkAccount"',
  'id, created_at, staff_id, "Position", "Label", shift, active, terminated_at, "WorkAccount"',
  'id, created_at, staff_id, position, label, shift, active, terminated_at, work_account',
  'id, created_at, staff_id, position, label, shift, active, terminated_at, "WorkAccount"'
];

const fetchDynamicEmployees = async (supabase: SupabaseClient) => {
  const pageSize = 1000;
  for (const select of EMPLOYEE_SELECTS) {
    const rows: EmployeeDynamicRow[] = [];
    let failed = false;
    for (let page = 0; page < 50; page += 1) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const res = await supabase.from(EMPLOYEE_TABLE).select(select).range(from, to);
      if (res.error) {
        failed = true;
        break;
      }
      const batch = (res.data as EmployeeDynamicRow[] | null) ?? [];
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
    if (!failed) return rows;
  }
  throw new Error('Failed to load employee rows for dynamic template.');
};

const dedupeLatestEmployees = (rows: EmployeeDynamicRow[]) => {
  const latestByStaff = new Map<string, EmployeeDynamicRow>();
  for (const row of rows) {
    const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!staff) continue;
    const prev = latestByStaff.get(staff);
    if (!prev) {
      latestByStaff.set(staff, row);
      continue;
    }
    const prevMs = Math.max(toMs(prev.updated_at), toMs(prev.created_at));
    const curMs = Math.max(toMs(row.updated_at), toMs(row.created_at));
    if (curMs > prevMs) {
      latestByStaff.set(staff, row);
      continue;
    }
    if (curMs < prevMs) continue;
    const prevId = Number(prev.id ?? 0);
    const curId = Number(row.id ?? 0);
    if (Number.isFinite(curId) && Number.isFinite(prevId) && curId > prevId) {
      latestByStaff.set(staff, row);
    }
  }
  return Array.from(latestByStaff.values());
};

const fetchWhitelistNames = async () => {
  if (!obupSupabase) throw new Error('Missing OBUP configuration.');
  const res = await obupSupabase.from(OBUP_WHITELIST_TABLE).select('name').limit(1000);
  if (res.error) throw new Error(String(res.error.message ?? 'Failed to load whitelist.'));
  const set = new Set<string>();
  for (const row of ((res.data as Array<{ name?: string | null }> | null) ?? [])) {
    const key = normalizeLabelKey(row.name);
    if (key) set.add(key);
  }
  return set;
};

const buildDynamicEmployees = (rows: EmployeeDynamicRow[], whitelistNames: Set<string>) => {
  const employees: DynamicEmployee[] = [];
  for (const row of dedupeLatestEmployees(rows)) {
    if (!isEmployeeActive(row)) continue;
    if (String(row.terminated_at ?? '').trim()) continue;
    const shiftRaw = String(row.shift ?? '').trim().toLowerCase();
    if (shiftRaw !== 'early' && shiftRaw !== 'late') continue;
    const label = getDynamicLabel(row);
    if (whitelistNames.has(normalizeLabelKey(label))) continue;
    const procKey = resolveDynamicProcKey(getDynamicPosition(row), label);
    if (!procKey) continue;
    const workAccountKey = normalizeWorkAccountKey(getDynamicWorkAccount(row));
    if (!workAccountKey) continue;
    const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!staffId) continue;
    employees.push({
      staffId,
      shift: shiftRaw,
      procKey,
      stage: resolveDynamicStage(procKey),
      accountKeys: new Set([workAccountKey])
    });
  }
  return employees;
};

const attachTemporaryAccounts = async (
  supabase: SupabaseClient,
  employees: DynamicEmployee[],
  startIso: string,
  endIso: string
) => {
  if (employees.length === 0) return;
  const byStaff = new Map<string, DynamicEmployee>();
  for (const employee of employees) byStaff.set(employee.staffId, employee);
  for (const batch of chunk(Array.from(byStaff.keys()), 200)) {
    const res = await supabase
      .from(TEMP_ACCOUNT_ASSIGNMENT_TABLE)
      .select('staff_id, work_account, created_at')
      .in('staff_id', batch as any[])
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (res.error) continue;
    for (const row of ((res.data as Array<{ staff_id?: string | null; work_account?: string | null }> | null) ?? [])) {
      const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
      const accountKey = normalizeWorkAccountKey(String(row.work_account ?? '').trim());
      if (!staffId || !accountKey) continue;
      const employee = byStaff.get(staffId);
      if (!employee) continue;
      employee.accountKeys.add(accountKey);
    }
  }
};

const fetchStageOperatorStats = async (startKey: string, endKey: string, stages: ObupStage[]) => {
  if (!obupSupabase) throw new Error('Missing OBUP configuration.');

  const uploadRes = await obupSupabase
    .from(OBUP_UPLOAD_RECORDS_TABLE)
    .select('work_date, stage')
    .gte('work_date', startKey)
    .lte('work_date', endKey)
    .in('stage', stages as any[]);
  if (uploadRes.error) throw new Error(String(uploadRes.error.message ?? 'Failed to load OBUP uploads.'));

  const validWorkStageKeys = new Set<string>();
  for (const row of ((uploadRes.data as Array<{ work_date?: string | null; stage?: string | null }> | null) ?? [])) {
    const workDate = String(row.work_date ?? '').trim();
    const stage = String(row.stage ?? '').trim().toLowerCase() as ObupStage;
    if (!workDate || !stage) continue;
    validWorkStageKeys.add(`${workDate}__${stage}`);
  }
  if (validWorkStageKeys.size === 0) {
    return new Map<ObupStage, Map<string, StatBucket>>();
  }

  const latestReportIdByWorkStage = new Map<string, { id: string; stage: ObupStage }>();
  const reportPageSize = 1000;
  for (let page = 0; page < 20; page += 1) {
    const from = page * reportPageSize;
    const to = from + reportPageSize - 1;
    const reportRes = await obupSupabase
      .from(OBUP_REPORTS_TABLE)
      .select('id, work_date, stage, created_at')
      .gte('work_date', startKey)
      .lte('work_date', endKey)
      .in('stage', stages as any[])
      .order('created_at', { ascending: false })
      .range(from, to);
    if (reportRes.error) throw new Error(String(reportRes.error.message ?? 'Failed to load OBUP reports.'));
    const rows =
      (reportRes.data as Array<{ id?: string | null; work_date?: string | null; stage?: string | null }> | null) ?? [];
    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      const workDate = String(row.work_date ?? '').trim();
      const stage = String(row.stage ?? '').trim().toLowerCase() as ObupStage;
      if (!id || !workDate || !stage) continue;
      const key = `${workDate}__${stage}`;
      if (!validWorkStageKeys.has(key) || latestReportIdByWorkStage.has(key)) continue;
      latestReportIdByWorkStage.set(key, { id, stage });
    }
    if (rows.length < reportPageSize) break;
  }

  const reportIdToStage = new Map<string, ObupStage>();
  for (const item of latestReportIdByWorkStage.values()) reportIdToStage.set(item.id, item.stage);
  const reportIds = Array.from(reportIdToStage.keys());
  if (reportIds.length === 0) {
    return new Map<ObupStage, Map<string, StatBucket>>();
  }

  const statsByStage = new Map<ObupStage, Map<string, StatBucket>>();
  for (const batch of chunk(reportIds, 200)) {
    const detailPageSize = 1000;
    for (let page = 0; page < 20; page += 1) {
      const from = page * detailPageSize;
      const to = from + detailPageSize - 1;
      const detailRes = await obupSupabase
        .from(OBUP_REPORT_DETAILS_TABLE)
        .select('report_id, operator, uph')
        .in('report_id', batch as any[])
        .range(from, to);
      if (detailRes.error) throw new Error(String(detailRes.error.message ?? 'Failed to load OBUP report details.'));
      const rows =
        (detailRes.data as Array<{ report_id?: string | null; operator?: string | null; uph?: number | null }> | null) ?? [];
      for (const row of rows) {
        const reportId = String(row.report_id ?? '').trim();
        const stage = reportIdToStage.get(reportId);
        const operatorKey = normalizeWorkAccountKey(String(row.operator ?? '').trim());
        const uph = parseUph(row.uph);
        if (!stage || !operatorKey || uph === null) continue;
        if (!statsByStage.has(stage)) statsByStage.set(stage, new Map());
        const byOperator = statsByStage.get(stage)!;
        const prev = byOperator.get(operatorKey) ?? { sum: 0, count: 0 };
        prev.sum += uph;
        prev.count += 1;
        byOperator.set(operatorKey, prev);
      }
      if (rows.length < detailPageSize) break;
    }
  }

  return statsByStage;
};

export const loadDynamicEfficiencyUphMap = async (options: {
  supabase: SupabaseClient | null;
  serverTime: Date;
}): Promise<DynamicTemplateLoadResult> => {
  const empty = { uphByShiftProc: emptyDynamicUphMap(), missingKeys: [] as Array<{ shift: DynamicShiftKey; procKey: DynamicProcKey }> };
  if (!options.supabase) {
    return { ...empty, error: 'Missing Supabase configuration.' };
  }
  if (!obupSupabase) {
    return { ...empty, error: 'Missing OBUP configuration.' };
  }

  try {
    const end = new Date(options.serverTime);
    end.setHours(0, 0, 0, 0);
    const start = addDays(end, -(DYNAMIC_WINDOW_DAYS - 1));
    const endExclusive = addDays(end, 1);
    const startKey = toDateOnly(start);
    const endKey = toDateOnly(end);
    const whitelistNames = await fetchWhitelistNames();
    const employeeRows = await fetchDynamicEmployees(options.supabase);
    const employees = buildDynamicEmployees(employeeRows, whitelistNames);
    await attachTemporaryAccounts(options.supabase, employees, start.toISOString(), endExclusive.toISOString());

    const stages = Array.from(new Set(employees.map((employee) => employee.stage)));
    const statsByStage = stages.length > 0 ? await fetchStageOperatorStats(startKey, endKey, stages) : new Map<ObupStage, Map<string, StatBucket>>();

    const aggregateByShiftProc = new Map<string, StatBucket>();
    for (const employee of employees) {
      const stageStats = statsByStage.get(employee.stage);
      if (!stageStats) continue;
      let sum = 0;
      let count = 0;
      for (const accountKey of employee.accountKeys) {
        const rec = stageStats.get(accountKey);
        if (!rec) continue;
        sum += rec.sum;
        count += rec.count;
      }
      if (count <= 0) continue;
      const bucketKey = `${employee.shift}__${employee.procKey}`;
      const prev = aggregateByShiftProc.get(bucketKey) ?? { sum: 0, count: 0 };
      prev.sum += sum;
      prev.count += count;
      aggregateByShiftProc.set(bucketKey, prev);
    }

    const uphByShiftProc = emptyDynamicUphMap();
    const missingKeys: Array<{ shift: DynamicShiftKey; procKey: DynamicProcKey }> = [];
    for (const shift of ['early', 'late'] as const) {
      for (const procKey of TARGET_PROC_KEYS) {
        const rec = aggregateByShiftProc.get(`${shift}__${procKey}`) ?? null;
        if (!rec || rec.count <= 0) {
          missingKeys.push({ shift, procKey });
          continue;
        }
        uphByShiftProc[shift][procKey] = formatAverageUph(rec.sum / rec.count);
      }
    }

    return { uphByShiftProc, missingKeys };
  } catch (error: any) {
    return {
      ...empty,
      error: String(error?.message ?? error ?? 'Failed to load dynamic UPH.')
    };
  }
};
