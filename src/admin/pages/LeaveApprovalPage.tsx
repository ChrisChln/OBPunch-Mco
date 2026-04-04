import { useEffect, useMemo, useRef, useState } from 'react';
import StyledDateInput from '../components/StyledDateInput';
import { isValidStaffId, normalizeStaffId } from '../../lib/staffId';

type TranslateFn = (zh: string, en: string) => string;
type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

type Props = {
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
  position: string;
};

type LeaveRow = {
  id: string;
  source: string;
  source_row_key: string;
  employee_name_raw: string;
  employee_staff_id_raw: string;
  matched_staff_id: string;
  matched_employee_name: string;
  matching_method: string;
  matching_score: number | null;
  position_raw: string;
  leave_date: string;
  leave_type: string;
  schedule_adjusted: boolean;
  status: LeaveStatus;
  reviewed_by: string;
  reviewed_at: string | null;
};

type HeaderMap = {
  submittedAtIndex: number;
  nameIndex: number;
  staffIdIndex: number;
  positionIndex: number;
  scheduleAdjustedIndex: number;
  leaveDateIndex: number;
  leaveTypeIndex: number;
};

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';
const AUDIT_TABLE = (import.meta.env.VITE_AUDIT_TABLE as string | undefined) ?? 'ob_audit_logs';
const LEAVE_REQUEST_TABLE = (import.meta.env.VITE_LEAVE_REQUEST_TABLE as string | undefined) ?? 'ob_leave_requests';
const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW) ? Math.max(0, Math.min(23, DAY_CUTOFF_HOUR_RAW)) : 5;
const CSV_ACCEPT_TYPES =
  '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

const isValidDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
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
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((part) => part)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((part) => part)) rows.push(row);
  return rows;
};

const readTabularFile = async (file: File) => {
  const lower = String(file.name ?? '').toLowerCase();
  if (lower.endsWith('.csv') || file.type === 'text/csv') return parseCsvRows(await file.text());
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [] as any[][];
  return ((XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1 }) as any[][]) ?? []).map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []
  );
};

const normalizeHeaderKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '')
    .replace(/[()（）/:：.-]/g, '');

const buildHeaderMap = (headerRow: unknown[]): HeaderMap | null => {
  const headers = (headerRow ?? []).map((cell) => normalizeHeaderKey(cell));
  const findColumn = (...candidates: string[]) => candidates.map((candidate) => headers.indexOf(candidate)).find((idx) => idx >= 0) ?? -1;
  const submittedAtIndex = findColumn('时间戳记', 'timestamp', 'submittedat', 'submissiontime');
  const nameIndex = findColumn('namenombre', 'name', 'nombre', 'employeename');
  const staffIdIndex = findColumn('employeeididdel', 'employeeid', 'staffid', 'iddelempleado', '工号');
  const positionIndex = findColumn('position', '岗位');
  const scheduleAdjustedIndex = findColumn('是否完成排班调整', 'scheduleadjusted', 'adjustedschedule', '排班调整');
  const leaveDateIndex = findColumn('offdatefechadel', 'offdate', 'leavedate', 'dateoff', 'fechadel');
  const leaveTypeIndex = findColumn('typeofleavetipodepermiso', 'typeofleave', 'tipodepermiso', 'leavetype');
  if (nameIndex < 0 || leaveDateIndex < 0 || leaveTypeIndex < 0) return null;
  return { submittedAtIndex, nameIndex, staffIdIndex, positionIndex, scheduleAdjustedIndex, leaveDateIndex, leaveTypeIndex };
};

const parseDateCell = (raw: unknown) => {
  const text = String(raw ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/[／]/g, '/')
    .replace(/[－]/g, '-');
  if (!text) return '';
  const serial = Number(text);
  if (Number.isFinite(serial) && /^\d+(\.\d+)?$/.test(text) && serial > 20000 && serial < 80000) {
    const utcDays = Math.floor(serial - 25569);
    const utcMs = utcDays * 86400 * 1000;
    const date = new Date(utcMs);
    if (!Number.isNaN(date.getTime())) return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }
  if (isValidDateOnly(text)) return text;
  const normalized = text.replace(/[./]/g, '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : toDateOnly(parsed);
};

const parseSubmittedAtCell = (raw: unknown) => {
  const text = String(raw ?? '')
    .trim()
    .replace(/上午/g, ' AM')
    .replace(/下午/g, ' PM')
    .replace(/年/g, '/')
    .replace(/月/g, '/')
    .replace(/日/g, '')
    .replace(/[／]/g, '/')
    .replace(/[－]/g, '-');
  if (!text) return null;
  const serial = Number(text);
  if (Number.isFinite(serial) && /^\d+(\.\d+)?$/.test(text) && serial > 20000 && serial < 80000) {
    const utcMs = Math.round((serial - 25569) * 86400 * 1000);
    const date = new Date(utcMs);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const parseBooleanCell = (raw: unknown) => {
  const text = String(raw ?? '').trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'y' || text === '1' || text === '是' || text === 'done' || text === '已完成';
};

const normalizePersonName = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const compactPersonName = (value: unknown) => normalizePersonName(value).replace(/\s+/g, '');

const scoreNameMatch = (candidate: string, employeeName: string) => {
  const a = normalizePersonName(candidate);
  const b = normalizePersonName(employeeName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const ac = compactPersonName(candidate);
  const bc = compactPersonName(employeeName);
  if (ac && ac === bc) return 96;
  if (ac && bc && (ac.includes(bc) || bc.includes(ac))) return 88;
  const aTokens = a.split(' ').filter((part) => part.length >= 2);
  const bTokens = b.split(' ').filter((part) => part.length >= 2);
  const shared = aTokens.filter((token) => bTokens.includes(token));
  if (shared.length === 0) return 0;
  const coverage = shared.length / Math.max(aTokens.length, bTokens.length);
  return coverage >= 0.75 ? Math.round(coverage * 80 + shared.length * 5) : 0;
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const getCurrentOperationalDate = (serverTime: Date) => {
  const now = new Date(serverTime);
  const operationalStart = new Date(now);
  operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
  if (now.getTime() < operationalStart.getTime()) operationalStart.setDate(operationalStart.getDate() - 1);
  return toDateOnly(operationalStart);
};

const getApproveWindow = (serverTime: Date) => {
  const operationalDate = getCurrentOperationalDate(serverTime);
  const operationalDateBase = new Date(`${operationalDate}T00:00:00`);
  const thisWeekStart = startOfWeekMonday(operationalDateBase);
  const nextWeekEnd = addDays(thisWeekStart, 13);
  return {
    operationalDate,
    editableStart: toDateOnly(thisWeekStart),
    editableEnd: toDateOnly(nextWeekEnd)
  };
};

export default function LeaveApprovalPage({ t, isLocked, supabase, themeMode, serverTime, userEmail = '', userDisplayName = '' }: Props) {
  const isLight = themeMode === 'light';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [employeesByStaffId, setEmployeesByStaffId] = useState<Record<string, EmployeeLite>>({});
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingRowId, setSavingRowId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LeaveStatus>('pending');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const actorDisplay = String(userDisplayName ?? '').trim() || String(userEmail ?? '').trim() || 'ADMIN';

  const loadEmployees = async () => {
    if (!supabase) return;
    const { data, error: fetchError } = await supabase.from(EMPLOYEE_TABLE).select('*').limit(20000);
    if (fetchError) throw new Error(String(fetchError.message ?? 'Failed to load employees.'));
    const next: Record<string, EmployeeLite> = {};
    for (const row of (data ?? []) as any[]) {
      const staffId = normalizeStaffId(String(row.staff_id ?? ''));
      if (!staffId) continue;
      next[staffId] = { staffId, name: String(row.name ?? '').trim(), position: String(row.position ?? '').trim() };
    }
    setEmployeesByStaffId(next);
  };

  const loadRows = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase.from(LEAVE_REQUEST_TABLE).select('*').order('leave_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000);
      if (fetchError) throw new Error(String(fetchError.message ?? 'Failed to load leave requests.'));
      setRows((((data ?? []) as any[]) ?? []).map((item) => ({
        id: String(item.id ?? ''),
        source: String(item.source ?? 'google_form'),
        source_row_key: String(item.source_row_key ?? ''),
        employee_name_raw: String(item.employee_name_raw ?? '').trim(),
        employee_staff_id_raw: String(item.employee_staff_id_raw ?? '').trim(),
        matched_staff_id: normalizeStaffId(String(item.matched_staff_id ?? '').trim()),
        matched_employee_name: String(item.matched_employee_name ?? '').trim(),
        matching_method: String(item.matching_method ?? '').trim(),
        matching_score: Number.isFinite(Number(item.matching_score)) ? Number(item.matching_score) : null,
        position_raw: String(item.position_raw ?? '').trim(),
        leave_date: String(item.leave_date ?? '').trim(),
        leave_type: String(item.leave_type ?? '').trim(),
        schedule_adjusted: Boolean(item.schedule_adjusted),
        status: (String(item.status ?? 'pending').trim() as LeaveStatus) || 'pending',
        reviewed_by: String(item.reviewed_by ?? '').trim(),
        reviewed_at: item.reviewed_at ? String(item.reviewed_at) : null
      })));
    } catch (err) {
      setError(String((err as any)?.message ?? err ?? 'Failed to load leave requests.'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      await loadEmployees();
      await loadRows();
    })();
  }, [supabase]);

  const resolveEmployeeMatch = (employeeNameRaw: string, employeeStaffIdRaw: string) => {
    let best: { staffId: string; name: string; score: number } | null = null;
    let second = -1;
    for (const employee of Object.values(employeesByStaffId)) {
      const score = scoreNameMatch(employeeNameRaw, employee.name);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        second = best?.score ?? -1;
        best = { staffId: employee.staffId, name: employee.name, score };
      } else if (score > second) {
        second = score;
      }
    }
    if (best && (best.score >= 96 || best.score - second >= 6)) return { staffId: best.staffId, employeeName: best.name, method: best.score >= 100 ? 'name_exact' : best.score >= 96 ? 'name_compact' : 'name_token', score: best.score };
    const normalizedId = normalizeStaffId(String(employeeStaffIdRaw ?? '').trim());
    if (isValidStaffId(normalizedId) && employeesByStaffId[normalizedId]) return { staffId: normalizedId, employeeName: employeesByStaffId[normalizedId].name, method: 'id_exact', score: 80 };
    if (best && best.score >= 82) return { staffId: best.staffId, employeeName: best.name, method: 'name_token', score: best.score };
    return { staffId: '', employeeName: '', method: 'unmatched', score: best?.score ?? null };
  };

  const importFile = async (file: File | null) => {
    if (!file || !supabase) return;
    setUploading(true);
    setError(null);
    setUploadMessage('');
    try {
      const tableRows = await readTabularFile(file);
      if (!tableRows.length) throw new Error('The file is empty.');
      let headerRowIndex = -1;
      let headerMap: HeaderMap | null = null;
      for (let i = 0; i < Math.min(tableRows.length, 10); i += 1) {
        const found = buildHeaderMap(tableRows[i] ?? []);
        if (found) {
          headerRowIndex = i;
          headerMap = found;
          break;
        }
      }
      if (!headerMap || headerRowIndex < 0) throw new Error('Missing required columns: Name / Off Date / Type of leave.');

      const { submittedAtIndex, nameIndex, staffIdIndex, positionIndex, scheduleAdjustedIndex, leaveDateIndex, leaveTypeIndex } = headerMap;
      const payload: Record<string, unknown>[] = [];
      let importedCount = 0;
      let matchedCount = 0;
      for (let index = headerRowIndex + 1; index < tableRows.length; index += 1) {
        const row = tableRows[index] ?? [];
        const employeeNameRaw = String(row[nameIndex] ?? '').trim();
        const employeeStaffIdRaw = staffIdIndex >= 0 ? String(row[staffIdIndex] ?? '').trim() : '';
        const leaveDate = parseDateCell(row[leaveDateIndex]);
        const leaveType = String(row[leaveTypeIndex] ?? '').trim();
        if (!employeeNameRaw && !leaveDate && !leaveType) continue;
        if (!employeeNameRaw || !leaveDate || !leaveType || !isValidDateOnly(leaveDate)) continue;
        const submittedAtRaw = submittedAtIndex >= 0 ? String(row[submittedAtIndex] ?? '').trim() : '';
        const submittedAt = parseSubmittedAtCell(submittedAtRaw);
        const positionRaw = positionIndex >= 0 ? String(row[positionIndex] ?? '').trim() : '';
        const scheduleAdjusted = scheduleAdjustedIndex >= 0 ? parseBooleanCell(row[scheduleAdjustedIndex]) : false;
        const match = resolveEmployeeMatch(employeeNameRaw, employeeStaffIdRaw);
        if (match.staffId) matchedCount += 1;
        importedCount += 1;
        payload.push({
          source: 'google_form',
          source_row_key: [submittedAtRaw, employeeNameRaw, employeeStaffIdRaw, leaveDate, leaveType].join('||').toLowerCase(),
          submitted_at: submittedAt,
          submitted_at_raw: submittedAtRaw || null,
          employee_name_raw: employeeNameRaw,
          employee_staff_id_raw: employeeStaffIdRaw || null,
          matched_staff_id: match.staffId || null,
          matched_employee_name: match.employeeName || null,
          matching_method: match.method,
          matching_score: match.score,
          position_raw: positionRaw || null,
          leave_date: leaveDate,
          leave_type: leaveType,
          schedule_adjusted: scheduleAdjusted,
          raw_payload: { employee_name_raw: employeeNameRaw, employee_staff_id_raw: employeeStaffIdRaw, position_raw: positionRaw, leave_date: leaveDate, leave_type: leaveType, schedule_adjusted: scheduleAdjusted },
          updated_at: new Date(serverTime).toISOString()
        });
      }
      if (payload.length === 0) throw new Error('No leave request rows were found.');
      const { error: upsertError } = await supabase.from(LEAVE_REQUEST_TABLE).upsert(payload as any[], { onConflict: 'source,source_row_key' });
      if (upsertError) throw new Error(String(upsertError.message ?? 'Failed to import leave requests.'));
      setUploadMessage(`${t('导入完成', 'Import complete')}: ${importedCount} ${t('条', 'rows')} · ${t('匹配成功', 'matched')} ${matchedCount}`);
      await loadRows();
    } catch (err) {
      setError(String((err as any)?.message ?? err ?? 'Failed to import leave requests.'));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploading(false);
    }
  };

  const writeAudit = async (action: string, staffId: string | null, payload: Record<string, unknown>) => {
    if (!supabase) return;
    await supabase.from(AUDIT_TABLE).insert([{ actor: actorDisplay, action, staff_id: staffId, target: LEAVE_REQUEST_TABLE, payload }] as any[]);
  };

  const updateLeaveStatus = async (row: LeaveRow, status: 'approved' | 'rejected') => {
    if (!supabase || !row.id) return;
    setSavingRowId(row.id);
    setError(null);
    try {
      const nowIso = new Date(serverTime).toISOString();
      let nextStatus: LeaveStatus = status;
      if (status === 'approved') {
        if (!row.matched_staff_id) throw new Error('This request is unmatched. Match by name or ID before approval.');
        const employee = employeesByStaffId[row.matched_staff_id];
        if (!employee) throw new Error(`Matched employee ${row.matched_staff_id} is missing from employee table.`);
        const approveWindow = getApproveWindow(serverTime);
        if (row.leave_date < approveWindow.editableStart) {
          nextStatus = 'expired';
        } else if (row.leave_date > approveWindow.editableEnd) {
          throw new Error(`Approval is only allowed for this week and next week (${approveWindow.editableStart} to ${approveWindow.editableEnd}).`);
        } else {
          const { error: scheduleError } = await supabase.from(SCHEDULE_TABLE).upsert([{ staff_id: row.matched_staff_id, date: row.leave_date, position: employee.position || row.position_raw || 'Pick', note: '__planned_leave__', operator: actorDisplay, updated_at: nowIso }] as any[], { onConflict: 'staff_id,date' });
          if (scheduleError) throw new Error(String(scheduleError.message ?? 'Failed to apply leave to schedule.'));
        }
      }
      const { error: updateError } = await supabase.from(LEAVE_REQUEST_TABLE).update({ status: nextStatus, reviewed_by: actorDisplay, reviewed_at: nowIso, updated_at: nowIso }).eq('id', row.id);
      if (updateError) throw new Error(String(updateError.message ?? `Failed to ${nextStatus} leave request.`));
      const auditAction =
        nextStatus === 'approved' ? 'leave_request_approve' : nextStatus === 'expired' ? 'leave_request_expire' : 'leave_request_reject';
      await writeAudit(auditAction, row.matched_staff_id || null, { leave_request_id: row.id, leave_date: row.leave_date, leave_type: row.leave_type, source: row.source, status: nextStatus });
      await loadRows();
    } catch (err) {
      setError(String((err as any)?.message ?? err ?? 'Failed to update leave request.'));
    } finally {
      setSavingRowId('');
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (dateFilter && row.leave_date !== dateFilter) return false;
      if (!q) return true;
      return [row.employee_name_raw, row.employee_staff_id_raw, row.matched_staff_id, row.matched_employee_name, row.leave_type, row.position_raw].join(' ').toLowerCase().includes(q);
    });
  }, [rows, search, statusFilter, dateFilter]);

  const summary = useMemo(() => ({ total: rows.length, pending: rows.filter((row) => row.status === 'pending').length, approved: rows.filter((row) => row.status === 'approved').length, unmatched: rows.filter((row) => !row.matched_staff_id).length }), [rows]);

  const pagePanelClass = isLight ? 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm' : 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
  const inputClass = isLight ? 'h-10 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-900' : 'h-10 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white';
  const buttonSecondaryClass = isLight ? 'h-10 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-slate-400 disabled:opacity-60' : 'h-10 rounded-2xl border border-white/20 bg-white/[0.05] px-4 text-sm font-semibold text-white hover:border-white/40 disabled:opacity-60';
  const buttonPrimaryClass = isLight ? 'h-10 rounded-2xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60' : 'h-10 rounded-2xl bg-neon px-4 text-sm font-semibold text-slate-950 hover:brightness-110 disabled:opacity-60';
  const labelClass = isLight ? 'text-xs uppercase tracking-[0.16em] text-slate-500' : 'text-xs uppercase tracking-[0.16em] text-white/60';

  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div>
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('请假审批', 'Leave Approval')}</h2>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className={pagePanelClass}>
          <div className={labelClass}>{t('导入', 'Import')}</div>
          <input ref={fileInputRef} type="file" className="hidden" accept={CSV_ACCEPT_TYPES} onChange={(e) => void importFile(e.target.files?.[0] ?? null)} />
          <button type="button" disabled={isLocked || uploading} onClick={() => fileInputRef.current?.click()} className={[buttonPrimaryClass, 'mt-3'].join(' ')}>
            {uploading ? t('导入中...', 'Importing...') : t('上传 Google Form 表格', 'Upload Google Form file')}
          </button>
          {uploadMessage && <div className={['mt-3 rounded-2xl border px-3 py-2 text-sm', isLight ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'].join(' ')}>{uploadMessage}</div>}
          {error && <div className={['mt-3 rounded-2xl border px-3 py-2 text-sm', isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-400/30 bg-rose-500/10 text-rose-200'].join(' ')}>{error}</div>}
        </div>

        <div className={pagePanelClass}>
          <div className="flex flex-wrap items-center gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('搜索姓名 / 工号 / 请假类型', 'Search name / staff ID / leave type')} className={[inputClass, 'w-[260px]'].join(' ')} />
            <select value={statusFilter} onChange={(e) => setStatusFilter((e.target.value as 'all' | LeaveStatus) || 'all')} className={[inputClass, 'w-[160px]'].join(' ')}>
              <option value="all">{t('全部状态', 'All status')}</option>
              <option value="pending">{t('待审批', 'Pending')}</option>
              <option value="approved">{t('已批准', 'Approved')}</option>
              <option value="expired">{t('已过期', 'Expired')}</option>
              <option value="rejected">{t('已拒绝', 'Rejected')}</option>
            </select>
            <StyledDateInput value={dateFilter} onChange={setDateFilter} themeMode={themeMode} disabled={isLocked} />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}><div className={labelClass}>{t('总申请', 'Total')}</div><div className="text-lg font-semibold">{summary.total}</div></div>
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-amber-200 bg-amber-50' : 'border-amber-400/30 bg-amber-500/10'].join(' ')}><div className={labelClass}>{t('待审批', 'Pending')}</div><div className="text-lg font-semibold">{summary.pending}</div></div>
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-emerald-200 bg-emerald-50' : 'border-emerald-400/30 bg-emerald-500/10'].join(' ')}><div className={labelClass}>{t('已批准', 'Approved')}</div><div className="text-lg font-semibold">{summary.approved}</div></div>
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-rose-200 bg-rose-50' : 'border-rose-400/30 bg-rose-500/10'].join(' ')}><div className={labelClass}>{t('未匹配', 'Unmatched')}</div><div className="text-lg font-semibold">{summary.unmatched}</div></div>
          </div>

          <div className="mt-4 overflow-auto">
            {loading ? (
              <div className={['rounded-2xl border px-4 py-8 text-center text-sm', isLight ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-white/10 bg-white/[0.02] text-white/70'].join(' ')}>{t('加载中...', 'Loading...')}</div>
            ) : filteredRows.length === 0 ? (
              <div className={['rounded-2xl border px-4 py-8 text-center text-sm', isLight ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-white/10 bg-white/[0.02] text-white/70'].join(' ')}>{t('当前条件下没有请假申请。', 'No leave requests under current filters.')}</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className={isLight ? 'text-slate-600' : 'text-white/70'}>
                    <th className="px-3 py-2 text-left">{t('状态', 'Status')}</th>
                    <th className="px-3 py-2 text-left">{t('请假日期', 'Leave date')}</th>
                    <th className="px-3 py-2 text-left">{t('表单姓名', 'Form name')}</th>
                    <th className="px-3 py-2 text-left">{t('匹配员工', 'Matched employee')}</th>
                    <th className="px-3 py-2 text-left">{t('岗位', 'Position')}</th>
                    <th className="px-3 py-2 text-left">{t('请假类型', 'Leave type')}</th>
                    <th className="px-3 py-2 text-left">{t('操作', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const matchedPosition = row.matched_staff_id ? employeesByStaffId[row.matched_staff_id]?.position ?? '' : '';
                    const displayPosition = matchedPosition || row.position_raw || '-';
                    return (
                      <tr key={row.id || row.source_row_key} className={isLight ? 'border-t border-slate-200' : 'border-t border-white/10'}>
                        <td className="px-3 py-2 font-semibold">{row.status}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.leave_date}</td>
                        <td className="px-3 py-2">
                          <div>{row.employee_name_raw || '-'}</div>
                          <div className={isLight ? 'text-xs text-slate-500' : 'text-xs text-white/50'}>{row.employee_staff_id_raw || '-'}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div>{row.matched_staff_id ? `${row.matched_staff_id} · ${row.matched_employee_name || row.matched_staff_id}` : t('未匹配', 'Unmatched')}</div>
                          {row.matching_score != null ? <div className={isLight ? 'text-xs text-slate-500' : 'text-xs text-white/50'}>{t('分数', 'Score')}: {row.matching_score}</div> : null}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{displayPosition}</td>
                        <td className="px-3 py-2">{row.leave_type}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={isLocked || savingRowId === row.id || row.status !== 'pending' || !row.matched_staff_id} onClick={() => void updateLeaveStatus(row, 'approved')} className={buttonPrimaryClass}>{savingRowId === row.id ? t('处理中...', 'Saving...') : t('批准', 'Approve')}</button>
                            <button type="button" disabled={isLocked || savingRowId === row.id || row.status !== 'pending'} onClick={() => void updateLeaveStatus(row, 'rejected')} className={buttonSecondaryClass}>{t('拒绝', 'Reject')}</button>
                          </div>
                          {row.reviewed_by ? <div className={['mt-2 text-xs', isLight ? 'text-slate-500' : 'text-white/50'].join(' ')}>{row.reviewed_by} · {formatDateTime(row.reviewed_at)}</div> : null}
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
    </section>
  );
}
