import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClientWithCredentials } from '../lib/supabase';
import { normalizeStaffId } from '../lib/staffId';
import type { AllowedPosition, EmployeeRow } from './types';

export type DailyCapacityProcKey =
  | 'pick'
  | 'consolidation'
  | 'rebin'
  | 'waterspider'
  | 'multi_pack'
  | 'single_pack'
  | 'pre_ship';

type CapacityStage = 'picking' | 'sorting' | 'packing';
type DailyCapacityStaffInput = {
  staffId: string;
  position: AllowedPosition | '';
  procKey: DailyCapacityProcKey | null;
  stage: CapacityStage | null;
  excluded: boolean;
  accountKeys: Set<string>;
};
type DailyAverageBucket = { sum: number; count: number };

export type DailyCapacityStaffStats = {
  staffId: string;
  position: AllowedPosition | '';
  procKey: DailyCapacityProcKey | null;
  excluded: boolean;
  recent14Uph: number | null;
};

export type DailyCapacityLoadResult = {
  byStaffId: Record<string, DailyCapacityStaffStats>;
  error?: string;
};

const TEMP_ACCOUNT_ASSIGNMENT_TABLE =
  (import.meta.env.VITE_TEMP_ACCOUNT_ASSIGNMENT_TABLE as string | undefined) ?? 'ob_temp_account_assignments';
const OBUP_REPORTS_TABLE = (import.meta.env.VITE_OBUP_REPORTS_TABLE as string | undefined) ?? 'reports';
const OBUP_REPORT_DETAILS_TABLE =
  (import.meta.env.VITE_OBUP_REPORT_DETAILS_TABLE as string | undefined) ?? 'report_details';
const OBUP_UPLOAD_RECORDS_TABLE = (import.meta.env.VITE_OBUP_UPLOAD_RECORDS_TABLE as string | undefined) ?? 'upload_records';
const OBUP_WHITELIST_TABLE = 'whitelist';
const RECENT_DATA_DAYS = 14;
const LOOKBACK_DAYS = 120;

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

const normalizeAllowedPosition = (value: string): AllowedPosition | '' => {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'pick') return 'Pick';
  if (text === 'pack') return 'Pack';
  if (text === 'rebin') return 'Rebin';
  if (text === 'preship') return 'Preship';
  if (text === 'transfer') return 'Transfer';
  return '';
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

const isEmployeeActive = (employee: EmployeeRow) => {
  const raw = employee.active;
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  if (!text) return true;
  if (text === 'false' || text === '0' || text === 'f' || text === 'no') return false;
  return true;
};

const getEmployeePosition = (row: EmployeeRow) => String(row.position ?? row.Position ?? '').trim();
const getEmployeeLabel = (row: EmployeeRow) => String(row.label ?? row.Label ?? '').trim();
const getEmployeeWorkAccount = (row: EmployeeRow) => String(row.work_account ?? row.WorkAccount ?? '').trim();

export const resolveDailyCapacityProcKey = (positionRaw: string, labelRaw: string): DailyCapacityProcKey | null => {
  const position = normalizeAllowedPosition(positionRaw);
  const label = normalizeLabelKey(labelRaw);
  if (position === 'Pick') return 'pick';
  if (position === 'Rebin') return label === 'consolidation' ? 'consolidation' : 'rebin';
  if (position === 'Pack') {
    if (label.includes('water spider')) return 'waterspider';
    if (label.includes('single')) return 'single_pack';
    if (label.includes('multi')) return 'multi_pack';
    return null;
  }
  if (position === 'Preship') return 'pre_ship';
  return null;
};

const resolveDailyCapacityStage = (procKey: DailyCapacityProcKey | null): CapacityStage | null => {
  if (procKey === 'pick') return 'picking';
  if (procKey === 'rebin' || procKey === 'consolidation') return 'sorting';
  if (procKey === 'waterspider' || procKey === 'multi_pack' || procKey === 'single_pack') return 'packing';
  return null;
};

export const averageRecentDataDaysUph = (dailyBuckets: Array<{ workDate: string; sum: number; count: number }>) => {
  const dailyAverages = dailyBuckets
    .map((bucket) => ({
      workDate: String(bucket.workDate ?? '').trim(),
      avg: bucket.count > 0 ? bucket.sum / bucket.count : null
    }))
    .filter((item): item is { workDate: string; avg: number } => Boolean(item.workDate) && item.avg !== null)
    .sort((a, b) => b.workDate.localeCompare(a.workDate, 'en-US'))
    .slice(0, RECENT_DATA_DAYS);
  if (dailyAverages.length === 0) return null;
  return dailyAverages.reduce((sum, item) => sum + item.avg, 0) / dailyAverages.length;
};

const dedupeLatestEmployees = (rows: EmployeeRow[]) => {
  const latestByStaff = new Map<string, EmployeeRow>();
  for (const row of rows) {
    const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!staff) continue;
    const prev = latestByStaff.get(staff);
    if (!prev) {
      latestByStaff.set(staff, row);
      continue;
    }
    const prevMs = Math.max(toMs((prev as any).updated_at), toMs((prev as any).created_at));
    const curMs = Math.max(toMs((row as any).updated_at), toMs((row as any).created_at));
    if (curMs > prevMs) {
      latestByStaff.set(staff, row);
      continue;
    }
    if (curMs < prevMs) continue;
    const prevId = Number((prev as any).id ?? 0);
    const curId = Number((row as any).id ?? 0);
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

const buildStaffInputs = (rows: EmployeeRow[], whitelistNames: Set<string>) => {
  const inputs: DailyCapacityStaffInput[] = [];
  for (const row of dedupeLatestEmployees(rows)) {
    if (!isEmployeeActive(row)) continue;
    if (String(row.terminated_at ?? '').trim()) continue;
    const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!staffId) continue;
    const position = normalizeAllowedPosition(getEmployeePosition(row));
    const label = getEmployeeLabel(row);
    const excluded = whitelistNames.has(normalizeLabelKey(label));
    const procKey = excluded ? null : resolveDailyCapacityProcKey(position, label);
    const stage = excluded ? null : resolveDailyCapacityStage(procKey);
    const accountKeys = new Set<string>();
    const workAccountKey = normalizeWorkAccountKey(getEmployeeWorkAccount(row));
    if (workAccountKey) accountKeys.add(workAccountKey);
    inputs.push({
      staffId,
      position,
      procKey,
      stage,
      excluded,
      accountKeys
    });
  }
  return inputs;
};

const buildBaseResult = (staffInputs: DailyCapacityStaffInput[]): DailyCapacityLoadResult['byStaffId'] =>
  Object.fromEntries(
    staffInputs.map((item) => [
      item.staffId,
      {
        staffId: item.staffId,
        position: item.position,
        procKey: item.procKey,
        excluded: item.excluded,
        recent14Uph: null
      } satisfies DailyCapacityStaffStats
    ])
  );

const attachTemporaryAccounts = async (
  supabase: SupabaseClient,
  staffInputs: DailyCapacityStaffInput[],
  startIso: string,
  endIso: string
) => {
  const byStaff = new Map<string, DailyCapacityStaffInput>();
  for (const item of staffInputs) {
    if (item.stage) byStaff.set(item.staffId, item);
  }
  if (byStaff.size === 0) return;
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
      const item = byStaff.get(staffId);
      if (!item) continue;
      item.accountKeys.add(accountKey);
    }
  }
};

const fetchDailyBucketsByStaffId = async (
  staffInputs: DailyCapacityStaffInput[],
  startKey: string,
  endKey: string
) => {
  const byStaffDate = new Map<string, DailyAverageBucket>();
  const accountStaffsByStage = new Map<CapacityStage, Map<string, string[]>>();
  const usedStages = new Set<CapacityStage>();

  for (const item of staffInputs) {
    if (!item.stage || item.accountKeys.size === 0) continue;
    usedStages.add(item.stage);
    if (!accountStaffsByStage.has(item.stage)) accountStaffsByStage.set(item.stage, new Map());
    const byAccount = accountStaffsByStage.get(item.stage)!;
    for (const accountKey of item.accountKeys) {
      const list = byAccount.get(accountKey) ?? [];
      if (!list.includes(item.staffId)) list.push(item.staffId);
      byAccount.set(accountKey, list);
    }
  }

  if (usedStages.size === 0) return byStaffDate;

  const uploadRes = await obupSupabase!
    .from(OBUP_UPLOAD_RECORDS_TABLE)
    .select('work_date, stage')
    .gte('work_date', startKey)
    .lte('work_date', endKey)
    .in('stage', Array.from(usedStages) as any[]);
  if (uploadRes.error) throw new Error(String(uploadRes.error.message ?? 'Failed to load OBUP uploads.'));

  const validWorkStageKeys = new Set<string>();
  for (const row of ((uploadRes.data as Array<{ work_date?: string | null; stage?: string | null }> | null) ?? [])) {
    const workDate = String(row.work_date ?? '').trim();
    const stage = String(row.stage ?? '').trim().toLowerCase() as CapacityStage;
    if (!workDate || !stage) continue;
    validWorkStageKeys.add(`${workDate}__${stage}`);
  }
  if (validWorkStageKeys.size === 0) return byStaffDate;

  const latestReportInfoByWorkStage = new Map<string, { id: string; stage: CapacityStage; workDate: string }>();
  const reportPageSize = 1000;
  for (let page = 0; page < 20; page += 1) {
    const from = page * reportPageSize;
    const to = from + reportPageSize - 1;
    const reportRes = await obupSupabase!
      .from(OBUP_REPORTS_TABLE)
      .select('id, work_date, stage, created_at')
      .gte('work_date', startKey)
      .lte('work_date', endKey)
      .in('stage', Array.from(usedStages) as any[])
      .order('created_at', { ascending: false })
      .range(from, to);
    if (reportRes.error) throw new Error(String(reportRes.error.message ?? 'Failed to load OBUP reports.'));
    const rows =
      (reportRes.data as Array<{ id?: string | null; work_date?: string | null; stage?: string | null }> | null) ?? [];
    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      const workDate = String(row.work_date ?? '').trim();
      const stage = String(row.stage ?? '').trim().toLowerCase() as CapacityStage;
      if (!id || !workDate || !stage) continue;
      const key = `${workDate}__${stage}`;
      if (!validWorkStageKeys.has(key) || latestReportInfoByWorkStage.has(key)) continue;
      latestReportInfoByWorkStage.set(key, { id, stage, workDate });
    }
    if (rows.length < reportPageSize) break;
  }

  const reportInfoById = new Map<string, { stage: CapacityStage; workDate: string }>();
  for (const item of latestReportInfoByWorkStage.values()) {
    reportInfoById.set(item.id, { stage: item.stage, workDate: item.workDate });
  }
  const reportIds = Array.from(reportInfoById.keys());
  if (reportIds.length === 0) return byStaffDate;

  for (const batch of chunk(reportIds, 200)) {
    const detailPageSize = 1000;
    for (let page = 0; page < 20; page += 1) {
      const from = page * detailPageSize;
      const to = from + detailPageSize - 1;
      const detailsRes = await obupSupabase!
        .from(OBUP_REPORT_DETAILS_TABLE)
        .select('report_id, operator, uph')
        .in('report_id', batch as any[])
        .range(from, to);
      if (detailsRes.error) throw new Error(String(detailsRes.error.message ?? 'Failed to load OBUP report details.'));
      const rows =
        (detailsRes.data as Array<{ report_id?: string | null; operator?: string | null; uph?: number | null }> | null) ?? [];
      for (const row of rows) {
        const reportId = String(row.report_id ?? '').trim();
        const info = reportInfoById.get(reportId);
        if (!info) continue;
        const accountKey = normalizeWorkAccountKey(String(row.operator ?? '').trim());
        const uph = parseUph(row.uph);
        if (!accountKey || uph === null) continue;
        const stageAccounts = accountStaffsByStage.get(info.stage);
        const staffIds = stageAccounts?.get(accountKey) ?? [];
        for (const staffId of staffIds) {
          const bucketKey = `${staffId}__${info.workDate}`;
          const prev = byStaffDate.get(bucketKey) ?? { sum: 0, count: 0 };
          prev.sum += uph;
          prev.count += 1;
          byStaffDate.set(bucketKey, prev);
        }
      }
      if (rows.length < detailPageSize) break;
    }
  }

  return byStaffDate;
};

const resolveAnalysisEndDate = (targetDate: string, serverTime: Date) => {
  const today = new Date(serverTime);
  today.setHours(0, 0, 0, 0);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(targetDate ?? '').trim())
    ? new Date(`${targetDate}T00:00:00`)
    : today;
  if (Number.isNaN(parsed.getTime())) return today;
  return parsed.getTime() > today.getTime() ? today : parsed;
};

export const loadDailyCapacityStaffStats = async (options: {
  supabase: SupabaseClient | null;
  employees: EmployeeRow[];
  targetDate: string;
  serverTime: Date;
}): Promise<DailyCapacityLoadResult> => {
  const whitelistNames = obupSupabase ? await fetchWhitelistNames().catch(() => new Set<string>()) : new Set<string>();
  const staffInputs = buildStaffInputs(options.employees, whitelistNames);
  const baseResult = buildBaseResult(staffInputs);

  if (!options.supabase) {
    return { byStaffId: baseResult, error: 'Missing Supabase configuration.' };
  }
  if (!obupSupabase) {
    return { byStaffId: baseResult, error: 'Missing OBUP configuration.' };
  }

  try {
    const endDate = resolveAnalysisEndDate(options.targetDate, options.serverTime);
    const startDate = addDays(endDate, -(LOOKBACK_DAYS - 1));
    const endExclusive = addDays(endDate, 1);
    await attachTemporaryAccounts(options.supabase, staffInputs, startDate.toISOString(), endExclusive.toISOString());
    const bucketsByStaffDate = await fetchDailyBucketsByStaffId(staffInputs, toDateOnly(startDate), toDateOnly(endDate));
    const dailyBucketsByStaff = new Map<string, Array<{ workDate: string; sum: number; count: number }>>();
    for (const [key, bucket] of bucketsByStaffDate.entries()) {
      const [staffId, workDate] = key.split('__');
      if (!staffId || !workDate) continue;
      const list = dailyBucketsByStaff.get(staffId) ?? [];
      list.push({ workDate, sum: bucket.sum, count: bucket.count });
      dailyBucketsByStaff.set(staffId, list);
    }

    const byStaffId: Record<string, DailyCapacityStaffStats> = {};
    for (const item of staffInputs) {
      byStaffId[item.staffId] = {
        staffId: item.staffId,
        position: item.position,
        procKey: item.procKey,
        excluded: item.excluded,
        recent14Uph: averageRecentDataDaysUph(dailyBucketsByStaff.get(item.staffId) ?? [])
      };
    }
    return { byStaffId };
  } catch (error: any) {
    return {
      byStaffId: baseResult,
      error: String(error?.message ?? error ?? 'Failed to load daily capacity staff stats.')
    };
  }
};
