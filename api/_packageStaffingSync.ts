import { getDateOnlyInTimeZone } from '../src/shared/packageMetrics';
import { shouldCountScheduledPackageMetricsStaff } from '../src/shared/packageStaffing';

type ScheduleSnapshotRow = {
  staff_id?: string | null;
  position?: string | null;
  note?: string | null;
  date?: string | null;
};

type EmployeeSnapshotRow = {
  staff_id?: string | null;
  active?: boolean | null;
  terminated_at?: string | null;
};

const DAY_CUTOFF_HOUR = 5;
const SCHEDULE_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');

const toDateOnly = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfWeekMonday = (value: Date) => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
};

const getCurrentOperationalDate = (serverTime: Date) => {
  const now = new Date(serverTime);
  const operationalStart = new Date(now);
  operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
  if (now.getTime() < operationalStart.getTime()) operationalStart.setDate(operationalStart.getDate() - 1);
  return toDateOnly(operationalStart);
};

const getApproveWindowStart = (serverTime: Date) => {
  const operationalDate = getCurrentOperationalDate(serverTime);
  const operationalDateBase = new Date(`${operationalDate}T00:00:00`);
  return toDateOnly(startOfWeekMonday(operationalDateBase));
};

const getTemplateDateByActualDate = (actualDateOnly: string, actualWeekStartDateOnly: string) => {
  const actualDate = new Date(`${actualDateOnly}T00:00:00`);
  const actualWeekStart = new Date(`${actualWeekStartDateOnly}T00:00:00`);
  if (Number.isNaN(actualDate.getTime()) || Number.isNaN(actualWeekStart.getTime())) return '';
  const diffDays = Math.round((actualDate.getTime() - actualWeekStart.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0 || diffDays > 13) return '';
  return toDateOnly(addDays(SCHEDULE_TEMPLATE_WEEK_START, diffDays));
};

const fetchAllRows = async (queryFactory: (from: number, to: number) => PromiseLike<{ data?: unknown[] | null; error?: { message?: string } | null }>, pageSize = 1000) => {
  const allRows: unknown[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const res = await queryFactory(from, to);
    if (res.error) {
      throw new Error(String(res.error.message ?? 'Failed to load schedule rows.'));
    }
    const page = Array.isArray(res.data) ? res.data : [];
    allRows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
};

export const getOperationalMetricDateNow = (referenceTime: Date, cutoffHour = 5) => {
  const shifted = new Date(referenceTime);
  shifted.setHours(shifted.getHours() - cutoffHour, 0, 0, 0);
  return getDateOnlyInTimeZone(shifted);
};

export const computeScheduledHeadcountForDate = async (supabase: any, metricDate: string) => {
  const approveWindowStart = getApproveWindowStart(new Date());
  const templateDate = getTemplateDateByActualDate(metricDate, approveWindowStart);
  const candidateDates = Array.from(new Set([metricDate, templateDate].filter(Boolean)));
  const scheduleRows = (await fetchAllRows(
    (from, to) =>
      supabase
        .from('ob_schedules')
        .select('staff_id, position, note, date')
        .in('date', candidateDates)
        .order('staff_id', { ascending: true })
        .range(from, to),
    1000
  )) as ScheduleSnapshotRow[];

  const scheduledStaffIds = Array.from(
    new Set(
      scheduleRows
        .map((row) => String(row.staff_id ?? '').trim())
        .filter(Boolean)
    )
  );
  const activeStaffIds = new Set<string>();
  if (scheduledStaffIds.length > 0) {
    const employeeRows = (await fetchAllRows(
      (from, to) =>
        supabase
          .from('ob_employees')
          .select('staff_id, active, terminated_at')
          .in('staff_id', scheduledStaffIds)
          .order('staff_id', { ascending: true })
          .range(from, to),
      1000
    )) as EmployeeSnapshotRow[];

    for (const row of employeeRows) {
      const staffId = String(row.staff_id ?? '').trim();
      if (!staffId) continue;
      const terminatedAt = String(row.terminated_at ?? '').trim();
      if (terminatedAt) continue;
      if (row.active === false) continue;
      activeStaffIds.add(staffId);
    }
  }

  const scheduledStaff = new Set<string>();
  for (const row of scheduleRows) {
    const staffId = String(row.staff_id ?? '').trim();
    if (!staffId) continue;
    if (!activeStaffIds.has(staffId)) continue;
    if (!shouldCountScheduledPackageMetricsStaff(row.position, row.note)) continue;
    scheduledStaff.add(staffId);
  }

  return scheduledStaff.size;
};

export const syncScheduledHeadcountForDate = async (supabase: any, metricDate: string) => {
  const scheduledHeadcount = await computeScheduledHeadcountForDate(supabase, metricDate);
  const upsertRes = await supabase.from('ob_package_daily_metrics').upsert(
    {
      metric_date: metricDate,
      scheduled_headcount: scheduledHeadcount,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'metric_date' }
  );
  if (upsertRes.error) {
    throw new Error(String(upsertRes.error.message ?? 'Failed to save scheduled headcount.'));
  }
  return scheduledHeadcount;
};
