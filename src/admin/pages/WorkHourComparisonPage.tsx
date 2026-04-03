import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import StyledDateInput from '../components/StyledDateInput';
import { isValidStaffId, normalizeStaffId } from '../../lib/staffId';

type TranslateFn = (zh: string, en: string) => string;

type WorkHourComparisonPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  supabase: any;
  themeMode: 'light' | 'dark';
  serverTime: Date;
  userEmail?: string;
  userDisplayName?: string;
};

type EmployeeLite = {
  staffId: string;
  name: string;
  agency: string;
  position: string;
  shift: '' | 'early' | 'late';
};

type ImportedHourRow = {
  staff_id: string;
  source_user_code: string;
  iams_hours: number;
  upload_batch_id?: number | null;
  fixed_by?: string | null;
  fixed_at?: string | null;
};

type ComparisonRow = {
  staffId: string;
  name: string;
  agency: string;
  position: string;
  shift: '' | 'early' | 'late';
  systemHours: number;
  iamsHours: number;
  diffHours: number;
  fixedBy: string;
  fixedAt: string;
};

type PunchFlowRow = {
  id: string;
  action: 'IN' | 'OUT';
  createdAt: string;
};

type UploadSummary = {
  fileName: string;
  workDate: string;
  dateCount: number;
  sourceRows: number;
  matchedRows: number;
  skippedRows: number;
  replacedRows: number;
};

type ParsedUploadRow = {
  workDate: string;
  sourceUserCode: string;
  staffId: string;
  iamsHours: number;
  rowNumber: number;
};

type HeaderMap = {
  dateIndex: number;
  userCodeIndex: number;
  hoursIndex: number;
};

type DirectionFilter = '' | 'system_less' | 'iams_less';

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const USER_PROFILE_TABLE = (import.meta.env.VITE_USER_PROFILE_TABLE as string | undefined) ?? 'ob_user_profiles';
const IAMS_IMPORT_TABLE =
  (import.meta.env.VITE_IAMS_WORK_HOURS_IMPORT_TABLE as string | undefined) ?? 'ob_iams_work_hours_imports';
const IAMS_UPLOAD_BATCH_TABLE =
  (import.meta.env.VITE_IAMS_WORK_HOUR_UPLOAD_BATCH_TABLE as string | undefined) ?? 'ob_iams_work_hour_upload_batches';
const MISTAKE_REPORT_TABLE = (import.meta.env.VITE_MISTAKE_REPORT_TABLE as string | undefined) ?? 'ob_mistake_reports';
const DISCREPANCY_THRESHOLD = 0.5;
const EPSILON = 0.005;
const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW) ? Math.max(0, Math.min(23, DAY_CUTOFF_HOUR_RAW)) : 5;
const FILTER_STORAGE_KEY = 'ob_work_hour_comparison_filters_v1';
const CSV_ACCEPT_TYPES =
  '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

const isValidDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
const toDateOnly = (value: Date) => {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getDefaultDateTMinus1 = (base: Date) => {
  const value = new Date(base);
  value.setDate(value.getDate() - 1);
  return toDateOnly(value);
};

const normalizeHeaderKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '')
    .replace(/[()（）]/g, '');

const normalizeCsvCell = (value: string) => String(value ?? '').trim();

const parseCsvRows = (text: string) => {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === ',') {
      row.push(normalizeCsvCell(cell));
      cell = '';
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(normalizeCsvCell(cell));
      if (row.some((part) => part.length > 0)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(normalizeCsvCell(cell));
  if (row.some((part) => part.length > 0)) rows.push(row);
  return rows;
};

const readTabularFile = async (file: File) => {
  const lower = String(file.name ?? '').trim().toLowerCase();
  if (lower.endsWith('.csv') || file.type === 'text/csv') {
    return parseCsvRows(await file.text());
  }
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [] as any[][];
  const sheet = workbook.Sheets[firstSheet];
  return ((XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]) ?? []).map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []
  );
};

const parseDateCell = (raw: unknown) => {
  const text = String(raw ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!text) return '';
  const cleaned = text
    .replace(/^'+/, '')
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/[／]/g, '/')
    .replace(/[－]/g, '-');
  if (isValidDateOnly(cleaned)) return cleaned;

  const serial = Number(cleaned);
  if (Number.isFinite(serial) && /^\d+(\.\d+)?$/.test(cleaned) && serial > 20000 && serial < 80000) {
    const utcDays = Math.floor(serial - 25569);
    const utcMs = utcDays * 86400 * 1000;
    const date = new Date(utcMs);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
  }

  const normalized = cleaned.replace(/[./]/g, '-');
  const ym = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    const d = Number(ym[3]);
    if (y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const md = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (md) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    const y = Number(md[3]);
    if (y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) return toDateOnly(parsed);
  return '';
};

const parseHoursCell = (raw: unknown) => {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const num = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
};

const resolveShift = (value: unknown): '' | 'early' | 'late' => {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'early') return 'early';
  if (text === 'late') return 'late';
  return '';
};

const buildHeaderMap = (headerRow: unknown[]): HeaderMap => {
  const normalized = (headerRow ?? []).map((cell) => normalizeHeaderKey(cell));
  const findIndexByPriority = (candidates: string[]) => {
    for (const candidate of candidates) {
      const idx = normalized.findIndex((value) => value === candidate);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const dateIndex = findIndexByPriority(['考勤日期', 'date', 'workdate', 'attendancedate']);
  const userCodeIndex = findIndexByPriority(['用户编码', '用户id', 'userid', 'usercode', '工号', '员工编码', 'staffid']);
  const hoursIndex = findIndexByPriority([
    // Must prioritize the explicit hour field when both columns exist.
    '最终核算时长小时',
    '最终核算工时小时',
    '最终核算时长小时h',
    '最终核算时长h',
    '核算时长小时',
    '工时小时',
    '最终核算时长',
    'hours',
    'workhours',
    'totalhours',
    'finalhours'
  ]);

  if (dateIndex < 0 || userCodeIndex < 0 || hoursIndex < 0) {
    throw new Error('Missing required columns: 考勤日期 / 用户编码 / 最终核算时长(小时).');
  }

  return { dateIndex, userCodeIndex, hoursIndex };
};

const tryBuildHeaderMap = (headerRow: unknown[]) => {
  try {
    return buildHeaderMap(headerRow);
  } catch {
    return null;
  }
};

const parseUploadRows = (rows: any[][], selectedDate: string) => {
  if (!rows.length) throw new Error('The file is empty.');
  let headerRowIndex = -1;
  let headerMap: HeaderMap | null = null;
  const maxScanRows = Math.min(rows.length, 20);
  for (let i = 0; i < maxScanRows; i += 1) {
    const found = tryBuildHeaderMap(rows[i] ?? []);
    if (found) {
      headerRowIndex = i;
      headerMap = found;
      break;
    }
  }
  if (!headerMap || headerRowIndex < 0) {
    throw new Error('Missing required columns: 考勤日期 / 用户编码 / 最终核算时长(小时).');
  }

  const parsed: ParsedUploadRow[] = [];
  let lastResolvedDate = '';

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rawDate = parseDateCell(row[headerMap.dateIndex]);
    const sourceUserCode = String(row[headerMap.userCodeIndex] ?? '').trim();
    const hours = parseHoursCell(row[headerMap.hoursIndex]);
    const normalizedStaffId = normalizeStaffId(sourceUserCode);
    const hasValidStaffId = isValidStaffId(sourceUserCode);

    let workDate = rawDate;
    if (!workDate && lastResolvedDate) {
      // Some attendance exports merge the date column, leaving blanks for following rows.
      workDate = lastResolvedDate;
    }
    if (!workDate && hasValidStaffId) {
      // Single-day files may have blank date cells; fall back to selected date for valid staff rows.
      workDate = selectedDate;
    }
    if (workDate) lastResolvedDate = workDate;

    if (!workDate && !sourceUserCode && hours === null) continue;
    if (!workDate) {
      // Skip sub-headers or explanatory rows that appear under merged Excel headers.
      if (!hasValidStaffId) continue;
      throw new Error(`Row ${index + 1}: invalid attendance date.`);
    }
    if (!isValidDateOnly(workDate)) throw new Error(`Row ${index + 1}: invalid attendance date format.`);
    if (!hasValidStaffId) continue;
    if (hours === null) continue;

    const staffId = normalizedStaffId;
    parsed.push({
      workDate,
      sourceUserCode,
      staffId,
      iamsHours: hours,
      rowNumber: index + 1
    });
  }

  if (!parsed.length) throw new Error('No importable data rows were found.');
  return parsed;
};

const getOperationalDayRange = (workDate: string) => {
  const base = new Date(`${workDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const start = new Date(base);
  start.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const getOverlapHours = (startA: Date, endA: Date, startB: Date, endB: Date) => {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  if (end <= start) return 0;
  return (end - start) / 3600000;
};

const computeSystemHoursByStaff = (
  punches: Array<{ staff_id?: string | null; action?: string | null; created_at?: string | null }>,
  rangeStart: Date,
  rangeEnd: Date
) => {
  const byStaff = new Map<string, Array<{ at: Date; action: 'IN' | 'OUT' }>>();

  for (const row of punches) {
    const staffId = normalizeStaffId(String(row.staff_id ?? ''));
    if (!staffId) continue;
    const at = new Date(String(row.created_at ?? ''));
    if (Number.isNaN(at.getTime())) continue;
    const action = String(row.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
    if (!byStaff.has(staffId)) byStaff.set(staffId, []);
    byStaff.get(staffId)!.push({ at, action });
  }

  const result = new Map<string, number>();
  for (const [staffId, rows] of byStaff.entries()) {
    rows.sort((a, b) => a.at.getTime() - b.at.getTime());
    let openIn: Date | null = null;
    let hours = 0;

    for (const row of rows) {
      if (row.action === 'IN') {
        openIn = row.at;
        continue;
      }
      if (!openIn) continue;
      hours += getOverlapHours(openIn, row.at, rangeStart, rangeEnd);
      openIn = null;
    }

    if (openIn) {
      hours += getOverlapHours(openIn, rangeEnd, rangeStart, rangeEnd);
    }
    result.set(staffId, Math.round(hours * 100) / 100);
  }
  return result;
};

const formatHours = (value: number) => value.toFixed(2);
const resolveFixerName = (value: string) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const atIdx = text.indexOf('@');
  if (atIdx > 0) return text.slice(0, atIdx);
  return text;
};

const isMissingColumnError = (error: unknown, column: string, table?: string) => {
  const text = String((error as any)?.message ?? error ?? '').toLowerCase();
  const col = String(column ?? '').trim().toLowerCase();
  const tableName = String(table ?? '').trim().toLowerCase();
  const hasColumn = text.includes(col);
  const hasTable = !tableName || text.includes(tableName);
  return hasColumn && hasTable && (text.includes('schema cache') || text.includes('column') || text.includes('could not find'));
};

const getStatusView = (row: ComparisonRow, resolveFixer: (value: string) => string) => {
  if (Math.abs(row.diffHours) < DISCREPANCY_THRESHOLD) {
    return { labelZh: '正常', labelEn: 'Normal', tone: 'normal' as const };
  }
  if (row.fixedBy) {
    const fixer = resolveFixer(row.fixedBy) || '-';
    return { labelZh: `已修复：${fixer}`, labelEn: `Resolved: ${fixer}`, tone: 'resolved' as const };
  }
  return { labelZh: '异常', labelEn: 'Abnormal', tone: 'abnormal' as const };
};
const formatPunchDateTime = (value: string) => {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '-';
  return at.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export default function WorkHourComparisonPage({
  t,
  isLocked,
  supabase,
  themeMode,
  serverTime,
  userEmail = '',
  userDisplayName = ''
}: WorkHourComparisonPageProps) {
  const isLight = themeMode === 'light';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedDate, setSelectedDate] = useState(() => getDefaultDateTMinus1(new Date(serverTime)));
  const [search, setSearch] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [positionFilter, setPositionFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'' | 'early' | 'late'>('');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('');
  const [discrepancyOnly, setDiscrepancyOnly] = useState(false);
  const [hideTransfer, setHideTransfer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [skipExamples, setSkipExamples] = useState<string[]>([]);
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [hasUploadedData, setHasUploadedData] = useState(false);
  const [employeesByStaffId, setEmployeesByStaffId] = useState<Record<string, EmployeeLite>>({});
  const [punchFlowOpen, setPunchFlowOpen] = useState(false);
  const [punchFlowLoading, setPunchFlowLoading] = useState(false);
  const [punchFlowError, setPunchFlowError] = useState<string | null>(null);
  const [punchFlowRows, setPunchFlowRows] = useState<PunchFlowRow[]>([]);
  const [punchFlowTarget, setPunchFlowTarget] = useState<{
    staffId: string;
    name: string;
    position: string;
    diffHours: number;
    fixedBy: string;
    fixedAt: string;
  } | null>(null);
  const [markFixedLoading, setMarkFixedLoading] = useState(false);
  const [fixerDisplayByKey, setFixerDisplayByKey] = useState<Record<string, string>>({});

  const resolveFixerDisplay = (value: string) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const key = raw.toLowerCase();
    const mapped = fixerDisplayByKey[key];
    if (mapped) return mapped;
    return resolveFixerName(raw);
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        search?: string;
        agency?: string;
        position?: string;
        shift?: '' | 'early' | 'late';
        direction?: DirectionFilter;
        discrepancyOnly?: boolean;
        hideTransfer?: boolean;
      };
      setSearch(String(parsed.search ?? ''));
      setAgencyFilter(String(parsed.agency ?? ''));
      setPositionFilter(String(parsed.position ?? ''));
      setShiftFilter(parsed.shift === 'early' || parsed.shift === 'late' ? parsed.shift : '');
      setDirectionFilter(parsed.direction === 'system_less' || parsed.direction === 'iams_less' ? parsed.direction : '');
      setDiscrepancyOnly(Boolean(parsed.discrepancyOnly));
      setHideTransfer(Boolean(parsed.hideTransfer));
    } catch {
      // ignore broken cache
    }
  }, []);

  useEffect(() => {
    const payload = {
      search,
      agency: agencyFilter,
      position: positionFilter,
      shift: shiftFilter,
      direction: directionFilter,
      discrepancyOnly,
      hideTransfer
    };
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload));
  }, [selectedDate, search, agencyFilter, positionFilter, shiftFilter, directionFilter, discrepancyOnly, hideTransfer]);

  const loadEmployees = async () => {
    if (!supabase) return {} as Record<string, EmployeeLite>;
    const { data, error: fetchError } = await supabase.from(EMPLOYEE_TABLE).select('*').limit(20000);
    if (fetchError) throw new Error(String(fetchError.message ?? 'Failed to load employees.'));

    const next: Record<string, EmployeeLite> = {};
    for (const row of (data ?? []) as any[]) {
      const staffId = normalizeStaffId(String(row.staff_id ?? row.Staff_ID ?? row.STAFF_ID ?? ''));
      if (!staffId) continue;
      next[staffId] = {
        staffId,
        name: String(row.name ?? row.Name ?? '').trim(),
        agency: String(row.agency ?? row.Agency ?? '').trim(),
        position: String(row.position ?? row.Position ?? '').trim(),
        shift: resolveShift(row.shift ?? row.Shift)
      };
    }
    setEmployeesByStaffId(next);
    return next;
  };

  const loadComparisonRows = async (dateOnly: string, employeeMapOverride?: Record<string, EmployeeLite>) => {
    if (!supabase || !isValidDateOnly(dateOnly)) return;

    const employeeMap = employeeMapOverride ?? employeesByStaffId;
    const dayRange = getOperationalDayRange(dateOnly);
    if (!dayRange) {
      setRows([]);
      setHasUploadedData(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let importedRows: any[] | null = null;
      {
        const withFixColumns = await supabase
          .from(IAMS_IMPORT_TABLE)
          .select('staff_id, source_user_code, iams_hours, upload_batch_id, fixed_by, fixed_at')
          .eq('work_date', dateOnly);
        if (withFixColumns.error && isMissingColumnError(withFixColumns.error, 'fixed_by', IAMS_IMPORT_TABLE)) {
          const fallback = await supabase
            .from(IAMS_IMPORT_TABLE)
            .select('staff_id, source_user_code, iams_hours, upload_batch_id')
            .eq('work_date', dateOnly);
          if (fallback.error) throw new Error(String(fallback.error.message ?? 'Failed to load imported iAMS rows.'));
          importedRows = (fallback.data ?? []) as any[];
        } else if (withFixColumns.error) {
          throw new Error(String(withFixColumns.error.message ?? 'Failed to load imported iAMS rows.'));
        } else {
          importedRows = (withFixColumns.data ?? []) as any[];
        }
      }

      const normalizedImported = ((importedRows ?? []) as ImportedHourRow[])
        .map((row) => ({
          staff_id: normalizeStaffId(String(row.staff_id ?? '')),
          source_user_code: String(row.source_user_code ?? '').trim(),
          iams_hours: Number(row.iams_hours ?? 0),
          upload_batch_id: row.upload_batch_id ?? null,
          fixed_by: String(row.fixed_by ?? '').trim(),
          fixed_at: String(row.fixed_at ?? '').trim()
        }))
        .filter((row) => row.staff_id && Number.isFinite(row.iams_hours) && row.iams_hours >= 0);

      if (!normalizedImported.length) {
        setRows([]);
        setHasUploadedData(false);
        return;
      }

      setHasUploadedData(true);
      const staffIds = Array.from(new Set(normalizedImported.map((row) => row.staff_id)));
      const windowStart = new Date(dayRange.start.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(dayRange.end.getTime() + 24 * 60 * 60 * 1000);

      const { data: punches, error: punchError } = await supabase
        .from('ob_punches')
        .select('staff_id, action, created_at')
        .in('staff_id', staffIds)
        .gte('created_at', windowStart.toISOString())
        .lt('created_at', windowEnd.toISOString())
        .order('created_at', { ascending: true });
      if (punchError) throw new Error(String(punchError.message ?? 'Failed to load punch records.'));

      const hoursByStaff = computeSystemHoursByStaff((punches ?? []) as any[], dayRange.start, dayRange.end);

      const nextRows: ComparisonRow[] = normalizedImported.map((row) => {
        const employee = employeeMap[row.staff_id] ?? {
          staffId: row.staff_id,
          name: '',
          agency: '',
          position: '',
          shift: '' as const
        };
        const systemHours = Number(hoursByStaff.get(row.staff_id) ?? 0);
        const iamsHours = Math.round(Number(row.iams_hours ?? 0) * 100) / 100;
        const diffHours = Math.round((systemHours - iamsHours) * 100) / 100;
        return {
          staffId: row.staff_id,
          name: employee.name,
          agency: employee.agency,
          position: employee.position,
          shift: employee.shift,
          systemHours,
          iamsHours,
          diffHours,
          fixedBy: String(row.fixed_by ?? '').trim(),
          fixedAt: String(row.fixed_at ?? '').trim()
        };
      });

      setRows(nextRows);
    } catch (err) {
      setRows([]);
      setHasUploadedData(false);
      setError(String((err as any)?.message ?? err ?? 'Failed to load comparison list.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!supabase) return;
      try {
        const employeeMap = await loadEmployees();
        if (!active) return;
        await loadComparisonRows(selectedDate, employeeMap);
      } catch (err) {
        if (!active) return;
        setError(String((err as any)?.message ?? err ?? 'Failed to initialize page.'));
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    let active = true;
    const loadFixerDisplayMap = async () => {
      if (!supabase) return;
      try {
        const res = await supabase.from(USER_PROFILE_TABLE).select('user_email, display_name').limit(5000);
        if (res.error) return;
        const next: Record<string, string> = {};
        for (const row of ((res.data as any[]) ?? [])) {
          const email = String(row?.user_email ?? '').trim().toLowerCase();
          const display = String(row?.display_name ?? '').trim();
          if (!email || !display) continue;
          next[email] = display;
          const local = email.split('@')[0] ?? '';
          if (local) next[local] = display;
        }
        if (active) setFixerDisplayByKey(next);
      } catch {
        // ignore profile map load errors
      }
    };
    void loadFixerDisplayMap();
    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    void loadComparisonRows(selectedDate);
  }, [selectedDate]);

  const onUploadFile = async (file: File | null) => {
    setError(null);
    setUploadSummary(null);
    setSkipExamples([]);
    if (!file || !supabase) return;

    const lower = String(file.name ?? '').trim().toLowerCase();
    const validFile =
      lower.endsWith('.csv') ||
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      file.type === 'text/csv' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
    if (!validFile) {
      setError(t('仅支持 CSV 或 Excel 文件。', 'Only CSV or Excel files are supported.'));
      return;
    }

    setUploading(true);
    try {
      const tableRows = await readTabularFile(file);
      const parsedRows = parseUploadRows(tableRows, selectedDate);
      const employeeMap =
        Object.keys(employeesByStaffId).length > 0
          ? employeesByStaffId
          : await loadEmployees();

      const dedupByStaffAndDate = new Map<string, ParsedUploadRow>();
      const skipReasons: string[] = [];
      for (const row of parsedRows) {
        if (!row.staffId) {
          skipReasons.push(`Row ${row.rowNumber}: user code ${row.sourceUserCode} is invalid.`);
          continue;
        }
        if (!employeeMap[row.staffId]) {
          skipReasons.push(`Row ${row.rowNumber}: ${row.staffId} not found in OBPUNCH employees.`);
          continue;
        }
        dedupByStaffAndDate.set(`${row.workDate}__${row.staffId}`, row);
      }

      const matchedRows = Array.from(dedupByStaffAndDate.values());
      if (!matchedRows.length) {
        const uniqueDates = Array.from(new Set(parsedRows.map((row) => row.workDate)));
        setUploadSummary({
          fileName: file.name,
          workDate: selectedDate,
          dateCount: uniqueDates.length,
          sourceRows: parsedRows.length,
          matchedRows: 0,
          skippedRows: parsedRows.length,
          replacedRows: 0
        });
        setSkipExamples(skipReasons.slice(0, 50));
        await loadComparisonRows(selectedDate, employeeMap);
        return;
      }

      const staffIds = Array.from(new Set(matchedRows.map((row) => row.staffId)));
      const workDates = Array.from(new Set(matchedRows.map((row) => row.workDate)));
      const { data: existingRows, error: existingError } = await supabase
        .from(IAMS_IMPORT_TABLE)
        .select('staff_id, work_date')
        .in('work_date', workDates)
        .in('staff_id', staffIds);
      if (existingError) throw new Error(String(existingError.message ?? 'Failed to inspect existing imports.'));

      const existingSet = new Set(
        ((existingRows ?? []) as Array<{ staff_id?: string | null; work_date?: string | null }>)
          .map((row) => {
            const staff = normalizeStaffId(row.staff_id ?? '');
            const date = String(row.work_date ?? '').trim();
            if (!staff || !date) return '';
            return `${date}__${staff}`;
          })
          .filter(Boolean)
      );
      const replacedRows = matchedRows.reduce((count, row) => count + (existingSet.has(`${row.workDate}__${row.staffId}`) ? 1 : 0), 0);

      const batchPayload = {
        work_date: selectedDate,
        file_name: String(file.name ?? '').trim(),
        uploaded_by: String(userEmail ?? '').trim(),
        source_row_count: parsedRows.length,
        matched_row_count: matchedRows.length,
        skipped_row_count: parsedRows.length - matchedRows.length,
        replaced_row_count: replacedRows
      };
      const { data: batchRows, error: batchError } = await supabase
        .from(IAMS_UPLOAD_BATCH_TABLE)
        .insert(batchPayload)
        .select('id')
        .limit(1);
      if (batchError) throw new Error(String(batchError.message ?? 'Failed to save upload batch.'));
      const batchId = Number((batchRows ?? [])[0]?.id ?? 0);

      const upsertPayload = matchedRows.map((row) => ({
        work_date: row.workDate,
        staff_id: row.staffId,
        source_user_code: row.sourceUserCode,
        iams_hours: row.iamsHours,
        upload_batch_id: Number.isFinite(batchId) && batchId > 0 ? batchId : null,
        fixed_by: null,
        fixed_at: null,
        updated_at: new Date().toISOString()
      }));

      let upsertError: any = null;
      {
        const withFixColumns = await supabase
          .from(IAMS_IMPORT_TABLE)
          .upsert(upsertPayload, { onConflict: 'work_date,staff_id' });
        if (withFixColumns.error && isMissingColumnError(withFixColumns.error, 'fixed_by', IAMS_IMPORT_TABLE)) {
          const fallbackPayload = upsertPayload.map(({ fixed_by, fixed_at, ...rest }) => rest);
          const fallback = await supabase
            .from(IAMS_IMPORT_TABLE)
            .upsert(fallbackPayload, { onConflict: 'work_date,staff_id' });
          upsertError = fallback.error;
        } else {
          upsertError = withFixColumns.error;
        }
      }
      if (upsertError) throw new Error(String(upsertError.message ?? 'Failed to import iAMS rows.'));

      setUploadSummary({
        fileName: file.name,
        workDate: selectedDate,
        dateCount: workDates.length,
        sourceRows: parsedRows.length,
        matchedRows: matchedRows.length,
        skippedRows: parsedRows.length - matchedRows.length,
        replacedRows
      });
      setSkipExamples(skipReasons.slice(0, 50));
      await loadComparisonRows(selectedDate, employeeMap);
    } catch (err) {
      setError(String((err as any)?.message ?? err ?? 'Upload failed.'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const agencyOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.agency).filter((v) => String(v).trim()))).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const positionOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.position).filter((v) => String(v).trim()))).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (Math.abs(row.systemHours) < EPSILON && Math.abs(row.iamsHours) < EPSILON) return false;
        if (agencyFilter && row.agency !== agencyFilter) return false;
        if (positionFilter && row.position !== positionFilter) return false;
        if (shiftFilter && row.shift !== shiftFilter) return false;
        if (hideTransfer && row.position === 'Transfer') return false;
        if (directionFilter === 'system_less' && !(row.diffHours < -EPSILON)) return false;
        if (directionFilter === 'iams_less' && !(row.diffHours > EPSILON)) return false;
        if (discrepancyOnly && Math.abs(row.diffHours) + EPSILON < DISCREPANCY_THRESHOLD) return false;
        if (!q) return true;
        const haystack = `${row.staffId} ${row.name} ${row.agency} ${row.position}`.toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => Math.abs(b.diffHours) - Math.abs(a.diffHours));
  }, [rows, search, agencyFilter, positionFilter, shiftFilter, directionFilter, discrepancyOnly, hideTransfer]);

  const summary = useMemo(() => {
    const totalSystem = filteredRows.reduce((sum, row) => sum + row.systemHours, 0);
    const totalIams = filteredRows.reduce((sum, row) => sum + row.iamsHours, 0);
    const gapCount = filteredRows.filter((row) => Math.abs(row.diffHours) + EPSILON >= DISCREPANCY_THRESHOLD).length;
    return {
      count: filteredRows.length,
      totalSystem: Math.round(totalSystem * 100) / 100,
      totalIams: Math.round(totalIams * 100) / 100,
      gapCount
    };
  }, [filteredRows]);

  const clearFilters = () => {
    setSearch('');
    setAgencyFilter('');
    setPositionFilter('');
    setShiftFilter('');
    setDirectionFilter('');
    setDiscrepancyOnly(false);
    setHideTransfer(false);
  };

  const closePunchFlow = () => {
    setPunchFlowOpen(false);
    setPunchFlowError(null);
    setPunchFlowRows([]);
    setPunchFlowTarget(null);
  };

  const openPunchFlow = async (row: ComparisonRow) => {
    if (!supabase) return;
    const range = getOperationalDayRange(selectedDate);
    if (!range) return;

    setPunchFlowOpen(true);
    setPunchFlowLoading(true);
    setPunchFlowError(null);
    setPunchFlowRows([]);
    setPunchFlowTarget({
      staffId: row.staffId,
      name: row.name,
      position: row.position,
      diffHours: row.diffHours,
      fixedBy: row.fixedBy,
      fixedAt: row.fixedAt
    });
    try {
      const { data, error: fetchError } = await supabase
        .from('ob_punches')
        .select('id, action, created_at')
        .eq('staff_id', row.staffId)
        .gte('created_at', range.start.toISOString())
        .lt('created_at', range.end.toISOString())
        .order('created_at', { ascending: true });
      if (fetchError) throw new Error(String(fetchError.message ?? 'Failed to load punch flow.'));

      const nextRows = ((data ?? []) as Array<{ id?: string | number; action?: string | null; created_at?: string | null }>)
        .map((item) => {
          const action = String(item.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
          const createdAt = String(item.created_at ?? '').trim();
          if (!createdAt) return null;
          return {
            id: String(item.id ?? `${createdAt}-${action}`),
            action,
            createdAt
          } as PunchFlowRow;
        })
        .filter((item): item is PunchFlowRow => Boolean(item));
      setPunchFlowRows(nextRows);
    } catch (err) {
      setPunchFlowError(String((err as any)?.message ?? err ?? 'Failed to load punch flow.'));
    } finally {
      setPunchFlowLoading(false);
    }
  };

  const markCurrentAsFixed = async () => {
    if (!supabase || !punchFlowTarget) return;
    setMarkFixedLoading(true);
    setPunchFlowError(null);
    try {
      const fixedBy =
        String(userDisplayName ?? '').trim() ||
        fixerDisplayByKey[String(userEmail ?? '').trim().toLowerCase()] ||
        resolveFixerName(String(userEmail ?? '').trim()) ||
        'unknown';
      const fixedAt = new Date().toISOString();

      const { data: existingMistakeRows, error: existingMistakeError } = await supabase
        .from(MISTAKE_REPORT_TABLE)
        .select('id')
        .eq('employee_staff_id', punchFlowTarget.staffId)
        .eq('operational_date', selectedDate)
        .limit(1);
      if (existingMistakeError) {
        throw new Error(String(existingMistakeError.message ?? 'Failed to check existing mistake report.'));
      }

      if (!Array.isArray(existingMistakeRows) || existingMistakeRows.length === 0) {
        const reason = `工时对比异常已修复: 系统工时与iAMS存在差异，修复人 ${fixedBy}`;
        const { error: createMistakeError } = await supabase
          .from(MISTAKE_REPORT_TABLE)
          .insert({
            position: String(punchFlowTarget.position ?? '').trim() || 'Unknown',
            employee_staff_id: punchFlowTarget.staffId,
            reason,
            reporter_staff_id: fixedBy,
            operational_date: selectedDate
          });
        if (createMistakeError) {
          throw new Error(String(createMistakeError.message ?? 'Failed to create mistake report.'));
        }
      }

      const { error: updateError } = await supabase
        .from(IAMS_IMPORT_TABLE)
        .update({ fixed_by: fixedBy, fixed_at: fixedAt, updated_at: fixedAt })
        .eq('work_date', selectedDate)
        .eq('staff_id', punchFlowTarget.staffId);
      if (updateError) {
        if (isMissingColumnError(updateError, 'fixed_by', IAMS_IMPORT_TABLE)) {
          throw new Error('Missing fixed columns. Please run SQL migration: add fixed_by/fixed_at to iAMS imports table.');
        }
        throw new Error(String(updateError.message ?? 'Failed to mark as fixed.'));
      }

      setRows((prev) =>
        prev.map((item) =>
          item.staffId === punchFlowTarget.staffId
            ? { ...item, fixedBy, fixedAt }
            : item
        )
      );
      setPunchFlowTarget((prev) => (prev ? { ...prev, fixedBy, fixedAt } : prev));
    } catch (err) {
      setPunchFlowError(String((err as any)?.message ?? err ?? 'Failed to mark as fixed.'));
    } finally {
      setMarkFixedLoading(false);
    }
  };

  const pagePanelClass = isLight ? 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm' : 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
  const inputClass = isLight
    ? 'h-10 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-900'
    : 'h-10 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white';
  const labelClass = isLight ? 'text-xs uppercase tracking-[0.16em] text-slate-500' : 'text-xs uppercase tracking-[0.16em] text-white/60';
  const buttonSecondaryClass = isLight
    ? 'h-10 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-slate-400 disabled:opacity-60'
    : 'h-10 rounded-2xl border border-white/20 bg-white/[0.05] px-4 text-sm font-semibold text-white hover:border-white/40 disabled:opacity-60';
  const buttonPrimaryClass = isLight
    ? 'h-10 rounded-2xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60'
    : 'h-10 rounded-2xl bg-neon px-4 text-sm font-semibold text-slate-950 hover:brightness-110 disabled:opacity-60';

  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-[0.08em]">{t('工时对比', 'Work Hour Comparison')}</h2>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className={pagePanelClass}>
          <div className={labelClass}>{t('日期与上传', 'Date and upload')}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StyledDateInput value={selectedDate} onChange={setSelectedDate} themeMode={themeMode} disabled={isLocked || uploading} />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={CSV_ACCEPT_TYPES}
              onChange={(e) => void onUploadFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              disabled={isLocked || uploading}
              onClick={() => fileInputRef.current?.click()}
              className={buttonPrimaryClass}
            >
              {uploading ? t('上传中...', 'Uploading...') : t('上传 iAMS 表', 'Upload iAMS file')}
            </button>
          </div>

          {uploadSummary && (
            <div className={['mt-3 rounded-2xl border px-3 py-2 text-sm', isLight ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'].join(' ')}>
              <div>{t('上传成功', 'Upload success')}: {uploadSummary.fileName}</div>
              <div className="mt-1 text-xs opacity-90">
                {t('总行数', 'Total')}: {uploadSummary.sourceRows} | {t('覆盖日期数', 'Dates')}: {uploadSummary.dateCount} | {t('匹配导入', 'Imported')}: {uploadSummary.matchedRows} | {t('跳过', 'Skipped')}: {uploadSummary.skippedRows} | {t('覆盖更新', 'Replaced')}: {uploadSummary.replacedRows}
              </div>
            </div>
          )}

          {skipExamples.length > 0 && (
            <div className={['mt-3 rounded-2xl border px-3 py-2 text-sm', isLight ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-amber-300/30 bg-amber-500/10 text-amber-100'].join(' ')}>
              <div className="font-semibold">{t('跳过示例（最多50条）', 'Skipped examples (up to 50)')}</div>
              <div className="mt-1 max-h-40 overflow-auto text-xs leading-5">
                {skipExamples.map((line, index) => (
                  <div key={`${line}-${index}`}>{line}</div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className={['mt-3 rounded-2xl border px-3 py-2 text-sm', isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-400/30 bg-rose-500/10 text-rose-200'].join(' ')}>
              {error}
            </div>
          )}
        </div>

        <div className={pagePanelClass}>
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('搜索 ID/名字/Agency/岗位', 'Search ID/name/agency/position')}
              className={[inputClass, 'w-[280px] shrink-0'].join(' ')}
            />
            <select value={agencyFilter} onChange={(e) => setAgencyFilter(e.target.value)} className={[inputClass, 'w-[150px] shrink-0'].join(' ')}>
              <option value="">{t('全部 Agency', 'All agencies')}</option>
              {agencyOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} className={[inputClass, 'w-[150px] shrink-0'].join(' ')}>
              <option value="">{t('全部岗位', 'All positions')}</option>
              {positionOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select value={shiftFilter} onChange={(e) => setShiftFilter((e.target.value as '' | 'early' | 'late') || '')} className={[inputClass, 'w-[140px] shrink-0'].join(' ')}>
              <option value="">{t('全部班次', 'All shifts')}</option>
              <option value="early">{t('早班', 'Early')}</option>
              <option value="late">{t('晚班', 'Late')}</option>
            </select>
            <select value={directionFilter} onChange={(e) => setDirectionFilter((e.target.value as DirectionFilter) || '')} className={[inputClass, 'w-[160px] shrink-0'].join(' ')}>
              <option value="">{t('差异方向: 全部', 'Direction: All')}</option>
              <option value="system_less">{t('系统工时少了', 'System less')}</option>
              <option value="iams_less">{t('iAMS 工时少了', 'iAMS less')}</option>
            </select>
            <label className="inline-flex h-10 shrink-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={discrepancyOnly}
                onChange={(e) => setDiscrepancyOnly(e.target.checked)}
              />
              {t('仅看差异大', 'Large discrepancy only')}
            </label>
            <label className="inline-flex h-10 shrink-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideTransfer}
                onChange={(e) => setHideTransfer(e.target.checked)}
              />
              {t('不看Transfer', 'Hide Transfer')}
            </label>
            <button type="button" onClick={clearFilters} className={buttonSecondaryClass}>
              {t('清空筛选', 'Clear filters')}
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
              <div className={labelClass}>{t('人数', 'Rows')}</div>
              <div className="text-lg font-semibold">{summary.count}</div>
            </div>
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
              <div className={labelClass}>{t('系统工时', 'System hours')}</div>
              <div className="text-lg font-semibold">{formatHours(summary.totalSystem)}</div>
            </div>
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
              <div className={labelClass}>{t('iAMS 工时', 'iAMS hours')}</div>
              <div className="text-lg font-semibold">{formatHours(summary.totalIams)}</div>
            </div>
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
              <div className={labelClass}>{t('差异大人数', 'Large discrepancy')}</div>
              <div className="text-lg font-semibold">{summary.gapCount}</div>
            </div>
          </div>

          <div className="mt-4 overflow-auto">
            {!hasUploadedData && !loading ? (
              <div className={['rounded-2xl border px-4 py-8 text-center text-sm', isLight ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-white/10 bg-white/[0.02] text-white/70'].join(' ')}>
                {t('当前日期还没有上传 iAMS 数据，列表保持为空。', 'No iAMS upload found for this date, list stays empty.')}
              </div>
            ) : filteredRows.length === 0 && !loading ? (
              <div className={['rounded-2xl border px-4 py-8 text-center text-sm', isLight ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-white/10 bg-white/[0.02] text-white/70'].join(' ')}>
                {t('当前筛选条件下没有数据。', 'No rows under current filters.')}
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className={isLight ? 'text-slate-600' : 'text-white/70'}>
                    <th className="px-3 py-2 text-left">{t('ID', 'ID')}</th>
                    <th className="px-3 py-2 text-left">{t('名字', 'Name')}</th>
                    <th className="px-3 py-2 text-left">Agency</th>
                    <th className="px-3 py-2 text-left">{t('岗位', 'Position')}</th>
                    <th className="px-3 py-2 text-left">{t('系统工时', 'System')}</th>
                    <th className="px-3 py-2 text-left">{t('iAMS工时', 'iAMS')}</th>
                    <th className="px-3 py-2 text-left">{t('工时差异', 'Diff')}</th>
                    <th className="px-3 py-2 text-left">{t('状态', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const diffClass =
                      row.diffHours < -EPSILON
                        ? isLight
                          ? 'text-rose-700'
                          : 'text-rose-300'
                        : row.diffHours > EPSILON
                          ? isLight
                            ? 'text-emerald-700'
                            : 'text-emerald-300'
                          : isLight
                            ? 'text-slate-700'
                            : 'text-white';
                    return (
                      <tr key={row.staffId} className={isLight ? 'border-t border-slate-200' : 'border-t border-white/10'}>
                        <td className="px-3 py-2">{row.staffId}</td>
                        <td className="px-3 py-2">{row.name || '-'}</td>
                        <td className="px-3 py-2">{row.agency || '-'}</td>
                        <td className="px-3 py-2">{row.position || '-'}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => void openPunchFlow(row)}
                            className={[
                              'rounded px-1 py-0.5 text-left font-semibold underline decoration-dotted underline-offset-2',
                              isLight ? 'text-sky-700 hover:text-sky-900' : 'text-sky-300 hover:text-sky-100'
                            ].join(' ')}
                            title={t('点击查看打卡流水', 'Click to view punch flow')}
                          >
                            {formatHours(row.systemHours)}
                          </button>
                        </td>
                        <td className="px-3 py-2">{formatHours(row.iamsHours)}</td>
                        <td className={['px-3 py-2 font-semibold', diffClass].join(' ')}>{row.diffHours > 0 ? `+${formatHours(row.diffHours)}` : formatHours(row.diffHours)}</td>
                        <td className="px-3 py-2">
                          {(() => {
                            const status = getStatusView(row, resolveFixerDisplay);
                            const statusClass =
                              status.tone === 'normal'
                                ? isLight
                                  ? 'text-emerald-700'
                                  : 'text-emerald-300'
                                : status.tone === 'resolved'
                                  ? isLight
                                    ? 'text-sky-700'
                                    : 'text-sky-300'
                                  : isLight
                                    ? 'text-rose-700'
                                    : 'text-rose-300';
                            return <span className={['font-semibold', statusClass].join(' ')}>{t(status.labelZh, status.labelEn)}</span>;
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {punchFlowOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className={['fixed inset-0 z-[130] flex items-center justify-center px-4', isLight ? 'bg-slate-900/30' : 'bg-black/55'].join(' ')} onClick={closePunchFlow}>
            <div
              className={[
                'w-full max-w-[860px] rounded-2xl border p-5',
                isLight ? 'border-slate-300 bg-white text-slate-900' : 'border-white/15 bg-slate-950/95 text-slate-100'
              ].join(' ')}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xl font-semibold">{t('打卡流水', 'Punch flow')}</div>
                  <div className={['mt-1 text-sm', isLight ? 'text-slate-600' : 'text-white/70'].join(' ')}>
                    {t('运营日', 'Operational day')}: {selectedDate} (05:00 - +24h) | {punchFlowTarget?.staffId ?? '-'} {punchFlowTarget?.name ?? ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {punchFlowTarget && Math.abs(punchFlowTarget.diffHours) >= DISCREPANCY_THRESHOLD && !punchFlowTarget.fixedBy && (
                    <button
                      type="button"
                      onClick={() => void markCurrentAsFixed()}
                      disabled={markFixedLoading}
                      className={buttonPrimaryClass}
                    >
                      {markFixedLoading ? t('处理中...', 'Saving...') : t('已修复', 'Mark as fixed')}
                    </button>
                  )}
                  {punchFlowTarget?.fixedBy && (
                    <span className={['text-sm font-semibold', isLight ? 'text-sky-700' : 'text-sky-300'].join(' ')}>
                      {t('已修复：', 'Resolved: ')}{resolveFixerDisplay(punchFlowTarget.fixedBy)}
                    </span>
                  )}
                  <button type="button" onClick={closePunchFlow} className={buttonSecondaryClass}>
                    {t('关闭', 'Close')}
                  </button>
                </div>
              </div>

              <div className="mt-4 overflow-auto">
                {punchFlowLoading ? (
                  <div className={['rounded-2xl border px-4 py-8 text-center text-sm', isLight ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-white/10 bg-white/[0.02] text-white/70'].join(' ')}>
                    {t('加载中...', 'Loading...')}
                  </div>
                ) : punchFlowError ? (
                  <div className={['rounded-2xl border px-4 py-3 text-sm', isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-400/30 bg-rose-500/10 text-rose-200'].join(' ')}>
                    {punchFlowError}
                  </div>
                ) : punchFlowRows.length === 0 ? (
                  <div className={['rounded-2xl border px-4 py-8 text-center text-sm', isLight ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-white/10 bg-white/[0.02] text-white/70'].join(' ')}>
                    {t('当前运营日没有打卡记录。', 'No punch records for this operational day.')}
                  </div>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className={isLight ? 'text-slate-600' : 'text-white/70'}>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">{t('动作', 'Action')}</th>
                        <th className="px-3 py-2 text-left">{t('时间', 'Time')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {punchFlowRows.map((item, idx) => (
                        <tr key={`${item.id}-${idx}`} className={isLight ? 'border-t border-slate-200' : 'border-t border-white/10'}>
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className={['px-3 py-2 font-semibold', item.action === 'IN' ? (isLight ? 'text-emerald-700' : 'text-emerald-300') : isLight ? 'text-amber-700' : 'text-amber-300'].join(' ')}>
                            {item.action}
                          </td>
                          <td className="px-3 py-2">{formatPunchDateTime(item.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
