import { useEffect, useMemo, useState } from 'react';
import StyledDateInput from '../components/StyledDateInput';
import { isValidStaffId, normalizeStaffId } from '../../lib/staffId';
import {
  getApproveWindow,
  getEffectiveLeaveStatus,
  getTemplateDateByActualDate,
  isValidDateOnly,
  toDateOnly,
  type LeaveStatus
} from '../leaveApprovalShared';

type TranslateFn = (zh: string, en: string) => string;

type Props = {
  t: TranslateFn;
  isLocked: boolean;
  isReadOnly?: boolean;
  supabase: any;
  themeMode: 'light' | 'dark';
  serverTime: Date;
  userEmail?: string;
  userDisplayName?: string;
  onPendingCountChange?: (count: number) => void;
};

type EmployeeLite = {
  staffId: string;
  name: string;
  agency: string;
  position: string;
  shift: string;
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

type LeaveDecisionRpcResult = {
  leave_request_id?: string | null;
  next_status?: LeaveStatus | string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
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
const ATTENDANCE_MARKS_TABLE = (import.meta.env.VITE_ATTENDANCE_MARKS_TABLE as string | undefined) ?? 'ob_attendance_marks';
const AUDIT_TABLE = (import.meta.env.VITE_AUDIT_TABLE as string | undefined) ?? 'ob_audit_logs';
const LEAVE_REQUEST_TABLE = (import.meta.env.VITE_LEAVE_REQUEST_TABLE as string | undefined) ?? 'ob_leave_requests';
const DEFAULT_LEAVE_APPROVAL_TABLES =
  EMPLOYEE_TABLE === 'ob_employees' &&
  SCHEDULE_TABLE === 'ob_schedules' &&
  ATTENDANCE_MARKS_TABLE === 'ob_attendance_marks' &&
  AUDIT_TABLE === 'ob_audit_logs' &&
  LEAVE_REQUEST_TABLE === 'ob_leave_requests';
const SCHEDULE_REST_NOTE = '__rest__';
const SCHEDULE_FIXED_WORK_NOTE = '__fixed_work__';
const SCHEDULE_TEMP_WORK_NOTE = '__temp_work__';
const SCHEDULE_LEAVE_NOTE = '__leave__';
const SCHEDULE_TEMP_REST_NOTE = '__temp_rest__';
const SCHEDULE_REPLACEMENT_NOTE = '__replacement__';
const SCHEDULE_PLANNED_TEMP_WORK_NOTE = '__planned_temp_work__';
const SCHEDULE_PLANNED_LEAVE_NOTE = '__planned_leave__';
const SCHEDULE_PLANNED_TEMP_REST_NOTE = '__planned_temp_rest__';
const SCHEDULE_NEW_NOTE = '__new__';
const NEW_YORK_TIMEZONE = 'America/New_York';
const getScheduleBaseStateFromNote = (note: unknown) => {
  const value = String(note ?? '').trim();
  if (value === SCHEDULE_NEW_NOTE) return 'new';
  if (value === SCHEDULE_FIXED_WORK_NOTE) return 'fixed_work';
  if (value === SCHEDULE_TEMP_WORK_NOTE) return 'temp_work';
  if (value === SCHEDULE_LEAVE_NOTE) return 'leave';
  if (value === SCHEDULE_TEMP_REST_NOTE) return 'temp_rest';
  if (value === SCHEDULE_REPLACEMENT_NOTE) return 'planned_temp_work';
  if (value === SCHEDULE_PLANNED_TEMP_WORK_NOTE) return 'planned_temp_work';
  if (value === SCHEDULE_PLANNED_LEAVE_NOTE) return 'planned_leave';
  if (value === SCHEDULE_PLANNED_TEMP_REST_NOTE) return 'planned_temp_rest';
  if (value === SCHEDULE_REST_NOTE) return 'rest';
  return 'work';
};
const isLeaveWritableScheduleState = (state: string) =>
  state === 'work' || state === 'fixed_work' || state === 'temp_work' || state === 'planned_temp_work';

const getNewYorkClock = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NEW_YORK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year ?? '0000'}-${map.month ?? '01'}-${map.day ?? '01'}`,
    minutes: Number(map.hour ?? '0') * 60 + Number(map.minute ?? '0')
  };
};

const shouldApprovedLeaveBecomePastLeave = (leaveDate: string, operationalDate: string, shift: string, reviewedAt: Date) => {
  if (leaveDate < operationalDate) return true;
  if (leaveDate > operationalDate) return false;
  const nyClock = getNewYorkClock(reviewedAt);
  if (nyClock.date !== leaveDate) return false;
  const cutoffMinutes = String(shift ?? '').trim().toLowerCase() === 'late' ? 17 * 60 : 10 * 60;
  return nyClock.minutes > cutoffMinutes;
};

const readEmployeeField = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
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

// Kept temporarily to avoid churn while the old upload path is being retired.
void buildHeaderMap;
void parseDateCell;
void parseSubmittedAtCell;
void parseBooleanCell;

export default function LeaveApprovalPage({ t, isLocked, isReadOnly = false, supabase, themeMode, serverTime, userEmail = '', userDisplayName = '', onPendingCountChange }: Props) {
  const isLight = themeMode === 'light';
  const writeLocked = isLocked || isReadOnly;
  const [employeesByStaffId, setEmployeesByStaffId] = useState<Record<string, EmployeeLite>>({});
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingRowId, setSavingRowId] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      const staffId = normalizeStaffId(
        readEmployeeField(row as Record<string, unknown>, 'staff_id', 'staffId', 'Staff_ID', 'STAFF_ID')
      );
      if (!staffId) continue;
      next[staffId] = {
        staffId,
        name: readEmployeeField(row as Record<string, unknown>, 'name', 'Name', 'NAME'),
        agency: readEmployeeField(row as Record<string, unknown>, 'agency', 'Agency', 'AGENCY'),
        position: readEmployeeField(row as Record<string, unknown>, 'position', 'Position', 'POSITION'),
        shift: readEmployeeField(row as Record<string, unknown>, 'shift', 'Shift', 'SHIFT')
      };
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
      onPendingCountChange?.(
        (((data ?? []) as any[]) ?? []).filter((item) =>
          getEffectiveLeaveStatus(
            ((String(item?.status ?? 'pending').trim() as LeaveStatus) || 'pending'),
            String(item?.leave_date ?? '').trim(),
            serverTime
          ) === 'pending'
        ).length
      );
    } catch (err) {
      setError(String((err as any)?.message ?? err ?? 'Failed to load leave requests.'));
      setRows([]);
      onPendingCountChange?.(0);
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
  void resolveEmployeeMatch;

  const writeAudit = async (action: string, staffId: string | null, payload: Record<string, unknown>, target = LEAVE_REQUEST_TABLE) => {
    if (!supabase) return;
    const { error: auditError } = await supabase.from(AUDIT_TABLE).insert([{ actor: actorDisplay, action, staff_id: staffId, target, payload }] as any[]);
    if (auditError) throw new Error(String(auditError.message ?? `Failed to write audit log for ${action}.`));
  };

  const isMissingLeaveDecisionRpcError = (error: unknown) => {
    const text = String(
      typeof error === 'object' && error !== null
        ? `${(error as { code?: unknown }).code ?? ''} ${(error as { message?: unknown }).message ?? ''} ${(error as { details?: unknown }).details ?? ''}`
        : error ?? ''
    ).toLowerCase();
    return (
      text.includes('apply_leave_request_decision') &&
      (text.includes('could not find') || text.includes('function') || text.includes('schema cache') || text.includes('pgrst'))
    );
  };

  const isLeaveDecisionRpcCompatibilityError = (error: unknown) => {
    const text = String(
      typeof error === 'object' && error !== null
        ? `${(error as { code?: unknown }).code ?? ''} ${(error as { message?: unknown }).message ?? ''} ${(error as { details?: unknown }).details ?? ''}`
        : error ?? ''
    ).toLowerCase();
    return text.includes('column') && text.includes('does not exist') && (text.includes('position') || text.includes('name'));
  };

  const getEffectiveStatus = (row: LeaveRow): LeaveStatus => {
    return getEffectiveLeaveStatus(row.status, row.leave_date, serverTime);
  };

  const applyLocalLeaveStatus = (rowId: string, nextStatus: LeaveStatus, reviewedBy: string, reviewedAt: string) => {
    setRows((current) => {
      const nextRows = current.map((item) =>
        item.id === rowId
          ? {
              ...item,
              status: nextStatus,
              reviewed_by: reviewedBy,
              reviewed_at: reviewedAt
            }
          : item
      );
      onPendingCountChange?.(nextRows.filter((item) => getEffectiveLeaveStatus(item.status, item.leave_date, serverTime) === 'pending').length);
      return nextRows;
    });
  };

  const updateLeaveStatusFallback = async (row: LeaveRow, status: 'approved' | 'rejected') => {
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
        const reviewedAtDate = new Date(serverTime);
        const isPastLeaveDate = shouldApprovedLeaveBecomePastLeave(
          row.leave_date,
          approveWindow.operationalDate,
          String(employee?.shift ?? '').trim(),
          reviewedAtDate
        );
        const nextNote = isPastLeaveDate ? '__leave__' : '__planned_leave__';
        const scheduleAction = isPastLeaveDate ? 'schedule_leave' : 'schedule_planned_leave';
        const leaveDateValue = new Date(`${row.leave_date}T00:00:00`);
        const weekday = Number.isNaN(leaveDateValue.getTime()) ? null : leaveDateValue.getDay() === 0 ? 7 : leaveDateValue.getDay();
        const templateDate = getTemplateDateByActualDate(row.leave_date, approveWindow.editableStart);
        if (!templateDate) throw new Error(`Could not map leave date ${row.leave_date} into schedule bucket.`);
        const positionValue = employee.position || row.position_raw || 'Pick';
        const existingScheduleRes = await supabase
          .from(SCHEDULE_TABLE)
          .select('note')
          .eq('staff_id', row.matched_staff_id)
          .eq('date', templateDate)
          .maybeSingle();
        if (existingScheduleRes.error) throw new Error(String(existingScheduleRes.error.message ?? 'Failed to load existing schedule state.'));
        const existingScheduleState = getScheduleBaseStateFromNote(existingScheduleRes.data?.note);
        const shouldApplyLeave = isLeaveWritableScheduleState(existingScheduleState);

        if (shouldApplyLeave) {
          const { error: scheduleError } = await supabase.from(SCHEDULE_TABLE).upsert([{ staff_id: row.matched_staff_id, date: templateDate, position: positionValue, note: nextNote, operator: actorDisplay, updated_at: nowIso }] as any[], { onConflict: 'staff_id,date' });
          if (scheduleError) throw new Error(String(scheduleError.message ?? 'Failed to apply leave to schedule.'));
          if (isPastLeaveDate) {
            const deleteRes = await supabase.from(ATTENDANCE_MARKS_TABLE).delete().eq('staff_id', row.matched_staff_id).eq('work_date', row.leave_date).eq('mark_type', 'absent');
            if (deleteRes.error) throw new Error(String(deleteRes.error.message ?? 'Failed to clear absent mark.'));
            const excuseRes = await supabase.from(ATTENDANCE_MARKS_TABLE).upsert([{ staff_id: row.matched_staff_id, work_date: row.leave_date, mark_type: 'excuse', source: 'leave_request', operator: actorDisplay, payload: { leave_request_id: row.id, leave_type: row.leave_type }, updated_at: nowIso }] as any[], { onConflict: 'staff_id,work_date,mark_type' });
            if (excuseRes.error) throw new Error(String(excuseRes.error.message ?? 'Failed to write excuse mark.'));
          }

          const scheduleVerifyRes = await supabase
            .from(SCHEDULE_TABLE)
            .select('note')
            .eq('staff_id', row.matched_staff_id)
            .eq('date', templateDate)
            .maybeSingle();
          if (scheduleVerifyRes.error) throw new Error(String(scheduleVerifyRes.error.message ?? 'Failed to verify leave schedule update.'));
          const savedNote = String(scheduleVerifyRes.data?.note ?? '').trim();
          if (savedNote !== nextNote) {
            throw new Error(
              isPastLeaveDate
                ? 'Schedule was not updated to leave. Approval was blocked.'
                : 'Schedule was not updated to planned leave. Approval was blocked.'
            );
          }

          if (isPastLeaveDate) {
            const absentVerifyRes = await supabase
              .from(ATTENDANCE_MARKS_TABLE)
              .select('id')
              .eq('staff_id', row.matched_staff_id)
              .eq('work_date', row.leave_date)
              .eq('mark_type', 'absent')
              .limit(1);
            if (absentVerifyRes.error) throw new Error(String(absentVerifyRes.error.message ?? 'Failed to verify absent mark removal.'));
            if (Array.isArray(absentVerifyRes.data) && absentVerifyRes.data.length > 0) {
              throw new Error('Absent mark still exists after leave approval. Approval was blocked.');
            }

            const excuseVerifyRes = await supabase
              .from(ATTENDANCE_MARKS_TABLE)
              .select('id')
              .eq('staff_id', row.matched_staff_id)
              .eq('work_date', row.leave_date)
              .eq('mark_type', 'excuse')
              .limit(1);
            if (excuseVerifyRes.error) throw new Error(String(excuseVerifyRes.error.message ?? 'Failed to verify excuse mark.'));
            if (!Array.isArray(excuseVerifyRes.data) || excuseVerifyRes.data.length === 0) {
              throw new Error('Excuse mark was not created after leave approval. Approval was blocked.');
            }
          }

          await writeAudit(scheduleAction, row.matched_staff_id, {
            template_date: templateDate,
            actual_date: row.leave_date,
            weekday,
            state: isPastLeaveDate ? 'leave' : 'planned_leave',
            to_state: isPastLeaveDate ? 'leave' : 'planned_leave',
            from_state: existingScheduleState,
            position: positionValue,
            leave_request_id: row.id,
            leave_type: row.leave_type
          }, SCHEDULE_TABLE);
        } else {
          const existingExcuseState = existingScheduleState === 'leave' || existingScheduleState === 'planned_leave';
          if (isPastLeaveDate && existingExcuseState) {
            const excuseVerifyRes = await supabase
              .from(ATTENDANCE_MARKS_TABLE)
              .select('id')
              .eq('staff_id', row.matched_staff_id)
              .eq('work_date', row.leave_date)
              .eq('mark_type', 'excuse')
              .limit(1);
            if (excuseVerifyRes.error) throw new Error(String(excuseVerifyRes.error.message ?? 'Failed to verify existing excuse mark.'));
            if (!Array.isArray(excuseVerifyRes.data) || excuseVerifyRes.data.length === 0) {
              const excuseRes = await supabase.from(ATTENDANCE_MARKS_TABLE).upsert([{ staff_id: row.matched_staff_id, work_date: row.leave_date, mark_type: 'excuse', source: 'leave_request', operator: actorDisplay, payload: { leave_request_id: row.id, leave_type: row.leave_type }, updated_at: nowIso }] as any[], { onConflict: 'staff_id,work_date,mark_type' });
              if (excuseRes.error) throw new Error(String(excuseRes.error.message ?? 'Failed to align existing leave excuse mark.'));
            }
          }

          if (isPastLeaveDate && existingScheduleState === 'leave') {
            const deleteRes = await supabase.from(ATTENDANCE_MARKS_TABLE).delete().eq('staff_id', row.matched_staff_id).eq('work_date', row.leave_date).eq('mark_type', 'absent');
            if (deleteRes.error) throw new Error(String(deleteRes.error.message ?? 'Failed to clear absent mark for existing leave state.'));
          }
        }
      }
    }
    const { error: updateError } = await supabase.from(LEAVE_REQUEST_TABLE).update({ status: nextStatus, reviewed_by: actorDisplay, reviewed_at: nowIso, updated_at: nowIso }).eq('id', row.id);
    if (updateError) throw new Error(String(updateError.message ?? `Failed to ${nextStatus} leave request.`));
    const auditAction =
      nextStatus === 'approved' ? 'leave_request_approve' : nextStatus === 'expired' ? 'leave_request_expire' : 'leave_request_reject';
    await writeAudit(auditAction, row.matched_staff_id || null, { leave_request_id: row.id, leave_date: row.leave_date, leave_type: row.leave_type, source: row.source, status: nextStatus });
    return {
      nextStatus,
      reviewedAt: nowIso,
      reviewedBy: actorDisplay
    };
  };

  const updateLeaveStatus = async (row: LeaveRow, status: 'approved' | 'rejected') => {
    if (!supabase || !row.id) return;
    setSavingRowId(row.id);
    setError(null);
    try {
      let nextStatus: LeaveStatus;
      let reviewedAt: string;
      let reviewedBy: string;

      if (DEFAULT_LEAVE_APPROVAL_TABLES) {
        try {
          const approveWindow = getApproveWindow(serverTime);
          const rpcRes = await supabase.rpc('apply_leave_request_decision', {
            p_leave_request_id: row.id,
            p_decision: status,
            p_actor: actorDisplay,
            p_operational_date: approveWindow.operationalDate,
            p_editable_start: approveWindow.editableStart,
            p_editable_end: approveWindow.editableEnd,
            p_reviewed_at: new Date(serverTime).toISOString()
          });
          if (rpcRes.error) {
            if (!isMissingLeaveDecisionRpcError(rpcRes.error)) {
              throw new Error(String(rpcRes.error.message ?? 'Failed to apply leave decision.'));
            }
            throw rpcRes.error;
          }
          const result = ((rpcRes.data ?? {}) as LeaveDecisionRpcResult);
          nextStatus = ((String(result.next_status ?? status).trim() as LeaveStatus) || status);
          reviewedAt = String(result.reviewed_at ?? new Date(serverTime).toISOString());
          reviewedBy = String(result.reviewed_by ?? actorDisplay).trim() || actorDisplay;
        } catch (error) {
          if (!isMissingLeaveDecisionRpcError(error) && !isLeaveDecisionRpcCompatibilityError(error)) throw error;
          const fallback = await updateLeaveStatusFallback(row, status);
          nextStatus = fallback.nextStatus;
          reviewedAt = fallback.reviewedAt;
          reviewedBy = fallback.reviewedBy;
        }
      } else {
        const fallback = await updateLeaveStatusFallback(row, status);
        nextStatus = fallback.nextStatus;
        reviewedAt = fallback.reviewedAt;
        reviewedBy = fallback.reviewedBy;
      }

      applyLocalLeaveStatus(row.id, nextStatus, reviewedBy, reviewedAt);
    } catch (err) {
      setError(String((err as any)?.message ?? err ?? 'Failed to update leave request.'));
    } finally {
      setSavingRowId('');
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const effectiveStatus = getEffectiveStatus(row);
      const matchedAgency = row.matched_staff_id ? employeesByStaffId[row.matched_staff_id]?.agency ?? '' : '';
      if (statusFilter !== 'all' && effectiveStatus !== statusFilter) return false;
      if (dateFilter && row.leave_date !== dateFilter) return false;
      if (!q) return true;
      return [row.employee_name_raw, row.employee_staff_id_raw, row.matched_staff_id, row.matched_employee_name, matchedAgency, row.leave_type, row.position_raw].join(' ').toLowerCase().includes(q);
    });
  }, [rows, search, statusFilter, dateFilter, employeesByStaffId]);

  const summary = useMemo(
    () => ({
      total: rows.length,
      pending: rows.filter((row) => getEffectiveStatus(row) === 'pending').length,
      approved: rows.filter((row) => getEffectiveStatus(row) === 'approved').length,
      expired: rows.filter((row) => getEffectiveStatus(row) === 'expired').length,
      unmatched: rows.filter((row) => !row.matched_staff_id).length
    }),
    [rows]
  );

  const pagePanelClass = isLight ? 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm' : 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
  const inputClass = isLight ? 'h-10 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-900' : 'h-10 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white';
  const buttonSecondaryClass = isLight ? 'admin-btn h-10 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-slate-400 disabled:opacity-60' : 'admin-btn admin-btn-secondary h-10 px-4 text-sm font-semibold text-white disabled:opacity-60';
  const buttonPrimaryClass = isLight ? 'admin-btn h-10 rounded-2xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60' : 'admin-btn admin-btn-primary h-10 px-4 text-sm font-semibold text-slate-950 disabled:opacity-60';
  const labelClass = isLight ? 'text-xs uppercase tracking-[0.16em] text-slate-500' : 'text-xs uppercase tracking-[0.16em] text-white/60';

  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div>
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('请假审批', 'Leave Approval')}</h2>
      </div>

      <div className="mt-5">
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

          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}><div className={labelClass}>{t('总申请', 'Total')}</div><div className="text-lg font-semibold">{summary.total}</div></div>
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-amber-200 bg-amber-50' : 'border-amber-400/30 bg-amber-500/10'].join(' ')}><div className={labelClass}>{t('待审批', 'Pending')}</div><div className="text-lg font-semibold">{summary.pending}</div></div>
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-emerald-200 bg-emerald-50' : 'border-emerald-400/30 bg-emerald-500/10'].join(' ')}><div className={labelClass}>{t('已批准', 'Approved')}</div><div className="text-lg font-semibold">{summary.approved}</div></div>
            <div className={['rounded-2xl border px-3 py-2', isLight ? 'border-slate-300 bg-slate-100' : 'border-slate-400/30 bg-slate-500/10'].join(' ')}><div className={labelClass}>{t('已过期', 'Expired')}</div><div className="text-lg font-semibold">{summary.expired}</div></div>
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
                    const effectiveStatus = getEffectiveStatus(row);
                    const matchedAgency = row.matched_staff_id ? employeesByStaffId[row.matched_staff_id]?.agency ?? '' : '';
                    const matchedPosition = row.matched_staff_id ? employeesByStaffId[row.matched_staff_id]?.position ?? '' : '';
                    const displayPosition = matchedPosition || row.position_raw || '-';
                    return (
                      <tr key={row.id || row.source_row_key} className={isLight ? 'border-t border-slate-200' : 'border-t border-white/10'}>
                        <td className="px-3 py-2 font-semibold">{effectiveStatus}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.leave_date}</td>
                        <td className="px-3 py-2">
                          <div>{row.employee_name_raw || '-'}</div>
                          <div className={isLight ? 'text-xs text-slate-500' : 'text-xs text-white/50'}>{row.employee_staff_id_raw || '-'}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div>{row.matched_staff_id ? `${row.matched_staff_id} · ${row.matched_employee_name || row.matched_staff_id}` : t('未匹配', 'Unmatched')}</div>
                          {row.matched_staff_id ? (
                            <div className={isLight ? 'text-xs text-slate-500' : 'text-xs text-white/50'}>
                              Agency: {matchedAgency || '-'}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{displayPosition}</td>
                        <td className="px-3 py-2">{row.leave_type}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <button type="button" disabled={writeLocked || savingRowId === row.id || effectiveStatus !== 'pending'} onClick={() => void updateLeaveStatus(row, 'approved')} className={buttonPrimaryClass}>{savingRowId === row.id ? t('处理中...', 'Saving...') : t('批准', 'Approve')}</button>
                            <button type="button" disabled={writeLocked || savingRowId === row.id || effectiveStatus !== 'pending'} onClick={() => void updateLeaveStatus(row, 'rejected')} className={buttonSecondaryClass}>{t('拒绝', 'Reject')}</button>
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
      {error ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className={['w-full max-w-md rounded-3xl border p-5 shadow-2xl', isLight ? 'border-slate-200 bg-white text-slate-900' : 'border-white/10 bg-[#18181c] text-white'].join(' ')}>
            <div className="text-lg font-semibold">{t('操作失败', 'Action failed')}</div>
            <div className={['mt-3 text-sm leading-6', isLight ? 'text-slate-600' : 'text-white/75'].join(' ')}>{error}</div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setError(null)} className={buttonPrimaryClass}>
                {t('知道了', 'OK')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
