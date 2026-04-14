import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAdminAccessContext, type AdminAccessContext } from '../shared/adminAccess';
import type { AgencyBoard, AgencyUpsertNewHireInput, AgencyWeekSchedule, AgencyScheduleState } from './types';

const PROFILE_TABLE = (import.meta.env.VITE_USER_PROFILE_TABLE as string | undefined) ?? 'ob_user_profiles';
const ATTENDANCE_MARKS_TABLE = (import.meta.env.VITE_ATTENDANCE_MARKS_TABLE as string | undefined) ?? 'ob_attendance_marks';
const PUNCHES_TABLE = (import.meta.env.VITE_PUNCHES_TABLE as string | undefined) ?? 'ob_punches';

const expectRpcSuccess = async <T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
  const result = await promise;
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.data as T;
};

export const fetchAdminAccessContext = async (
  supabase: SupabaseClient,
  fallbackEmail?: string | null
): Promise<AdminAccessContext> => {
  const payload = await expectRpcSuccess(supabase.rpc('get_admin_access_context'));
  return normalizeAdminAccessContext(payload, fallbackEmail);
};

export const fetchAgencyBoard = async (supabase: SupabaseClient, workDate: string): Promise<AgencyBoard> => {
  const payload = await expectRpcSuccess<AgencyBoard>(supabase.rpc('agency_get_board', { p_work_date: workDate }));
  return {
    ...payload,
    managed_agencies: Array.isArray(payload.managed_agencies) ? payload.managed_agencies : [],
    summary_cards: Array.isArray(payload.summary_cards) ? payload.summary_cards : [],
    attendance_cards: Array.isArray(payload.attendance_cards) ? payload.attendance_cards : [],
    employees: Array.isArray(payload.employees) ? payload.employees : [],
    new_hire_requests: Array.isArray(payload.new_hire_requests) ? payload.new_hire_requests : [],
    logs: Array.isArray(payload.logs) ? payload.logs : []
  };
};

export const fetchAgencyScheduleWeek = async (supabase: SupabaseClient, workDate: string): Promise<AgencyWeekSchedule> => {
  const payload = await expectRpcSuccess<AgencyWeekSchedule>(supabase.rpc('agency_get_schedule_week', { p_work_date: workDate }));
  return {
    week_dates: Array.isArray(payload.week_dates) ? payload.week_dates.map((item) => String(item ?? '').trim()).filter(Boolean) : [],
    employees: Array.isArray(payload.employees)
      ? payload.employees.map((row) => ({
          staff_id: String(row?.staff_id ?? '').trim(),
          name: String(row?.name ?? '').trim(),
          agency: String(row?.agency ?? '').trim(),
          position: String(row?.position ?? '').trim(),
          shift: String(row?.shift ?? '').trim() === 'late' ? 'late' : String(row?.shift ?? '').trim() === 'early' ? 'early' : '',
          start_time: String(row?.start_time ?? '').trim(),
          label: String(row?.label ?? '').trim(),
          fixed_work_count: Number(row?.fixed_work_count ?? 0) || 0,
          termination_status: row?.termination_status == null ? null : String(row.termination_status).trim() || null,
          days: Array.isArray(row?.days)
            ? row.days.map((cell) => ({
                work_date: String(cell?.work_date ?? '').trim(),
                template_date: String(cell?.template_date ?? '').trim(),
                state: String(cell?.state ?? 'rest').trim() as AgencyScheduleState,
                base_state: String(cell?.base_state ?? cell?.state ?? 'rest').trim() as AgencyScheduleState,
                substitute_open_count: Number(cell?.substitute_open_count ?? 0) || 0
              }))
            : []
        }))
      : [],
    new_hire_requests: Array.isArray(payload.new_hire_requests)
      ? payload.new_hire_requests.map((row) => ({
          staff_id: String(row?.staff_id ?? '').trim(),
          name: String(row?.name ?? '').trim(),
          agency: String(row?.agency ?? '').trim(),
          position: String(row?.position ?? '').trim(),
          shift: String(row?.shift ?? '').trim() === 'late' ? 'late' : String(row?.shift ?? '').trim() === 'early' ? 'early' : '',
          start_time: String(row?.start_time ?? '').trim(),
          label: String(row?.label ?? '').trim(),
          work_date: String(row?.work_date ?? '').trim(),
          can_delete: Boolean(row?.can_delete)
        }))
      : []
  };
};

export const fetchAgencyUserDisplayName = async (supabase: SupabaseClient, userId: string) => {
  const result = await supabase.from(PROFILE_TABLE).select('display_name').eq('user_id', userId).maybeSingle();
  if (result.error) return '';
  return String((result.data as { display_name?: string | null } | null)?.display_name ?? '').trim();
};

export const fetchAgencyAbsentMarkKeys = async (
  supabase: SupabaseClient,
  staffIds: string[],
  workDates: string[]
): Promise<string[]> => {
  const scopedStaffIds = staffIds.map((item) => String(item ?? '').trim()).filter(Boolean);
  const scopedWorkDates = workDates.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (scopedStaffIds.length === 0 || scopedWorkDates.length === 0) return [];
  const result = await supabase
    .from(ATTENDANCE_MARKS_TABLE)
    .select('staff_id, work_date')
    .in('staff_id', scopedStaffIds)
    .in('work_date', scopedWorkDates)
    .eq('mark_type', 'absent');
  if (result.error) {
    throw new Error(String(result.error.message ?? 'Failed to load absence marks.'));
  }
  return Array.isArray(result.data)
    ? result.data
        .map((row) => `${String((row as { staff_id?: string | null }).staff_id ?? '').trim()}__${String((row as { work_date?: string | null }).work_date ?? '').trim()}`)
        .filter((item) => item !== '__')
    : [];
};

export const fetchAgencyPunchPresenceStaffIds = async (
  supabase: SupabaseClient,
  staffIds: string[],
  startIso: string,
  endIso: string
): Promise<string[]> => {
  const scopedStaffIds = staffIds.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (scopedStaffIds.length === 0) return [];
  const result = await supabase
    .from(PUNCHES_TABLE)
    .select('staff_id')
    .in('staff_id', scopedStaffIds)
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .limit(2000);
  if (result.error) {
    throw new Error(String(result.error.message ?? 'Failed to load punch presence.'));
  }
  return Array.from(
    new Set(
      Array.isArray(result.data)
        ? result.data.map((row) => String((row as { staff_id?: string | null }).staff_id ?? '').trim()).filter(Boolean)
        : []
    )
  );
};

export const submitAgencyPlannedLeave = async (supabase: SupabaseClient, staffId: string, workDate: string, reason: string) =>
  expectRpcSuccess(
    supabase.rpc('agency_set_planned_leave', {
      p_staff_id: staffId,
      p_work_date: workDate,
      p_reason: reason
    })
  );

export const submitAgencySubstitute = async (
  supabase: SupabaseClient,
  targetStaffId: string,
  substituteStaffId: string,
  workDate: string
) =>
  expectRpcSuccess(
    supabase.rpc('agency_assign_substitute', {
      p_target_staff_id: targetStaffId,
      p_substitute_staff_id: substituteStaffId,
      p_work_date: workDate
    })
  );

export const upsertAgencyNewHireDemand = async (supabase: SupabaseClient, input: AgencyUpsertNewHireInput) =>
  expectRpcSuccess(
    supabase.rpc('agency_upsert_new_hire_demand', {
      p_staff_id: input.staffId ?? null,
      p_work_date: input.workDate,
      p_position: input.position,
      p_shift: input.shift,
      p_agency: input.agency,
      p_label: input.label,
      p_entry_time: input.entryTime,
      p_note: input.note,
      p_count: input.count,
      p_employee_name: input.employeeName
    })
  );

export const deleteAgencyNewHireDemand = async (supabase: SupabaseClient, staffId: string, workDate: string) =>
  expectRpcSuccess(
    supabase.rpc('agency_delete_new_hire_demand', {
      p_staff_id: staffId,
      p_work_date: workDate
    })
  );

export const createAgencyTerminationRequest = async (
  supabase: SupabaseClient,
  staffId: string,
  reason: string
) =>
  expectRpcSuccess(
    supabase.rpc('agency_create_termination_request', {
      p_staff_id: staffId,
      p_reason: reason
    })
  );

export const cancelAgencyTerminationRequest = async (supabase: SupabaseClient, staffId: string) =>
  expectRpcSuccess(
    supabase.rpc('agency_cancel_termination_request', {
      p_staff_id: staffId
    })
  );

export const setAgencyScheduleState = async (
  supabase: SupabaseClient,
  staffId: string,
  workDate: string,
  state: AgencyScheduleState
) =>
  expectRpcSuccess(
    supabase.rpc('agency_set_schedule_state', {
      p_staff_id: staffId,
      p_work_date: workDate,
      p_state: state,
      p_reason: ''
    })
  );
