import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAdminAccessContext, type AdminAccessContext } from '../shared/adminAccess';
import type {
  AgencyBoard,
  AgencyUpsertNewHireInput,
  AgencyWeekSchedule,
  AgencyScheduleState
} from './types';
import { normalizeAgencyPayrateInput } from './payrate';

const PROFILE_TABLE = (import.meta.env.VITE_USER_PROFILE_TABLE as string | undefined) ?? 'ob_user_profiles';
const ATTENDANCE_MARKS_TABLE = (import.meta.env.VITE_ATTENDANCE_MARKS_TABLE as string | undefined) ?? 'ob_attendance_marks';
const PUNCHES_TABLE = (import.meta.env.VITE_PUNCHES_TABLE as string | undefined) ?? 'ob_punches';
const AGENCY_PAYRATES_TABLE = (import.meta.env.VITE_AGENCY_PAYRATES_TABLE as string | undefined) ?? 'ob_agency_payrates';

const expectRpcSuccess = async <T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
  const result = await promise;
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.data as T;
};

type AgencyPayrateRow = {
  staff_id?: string | null;
  work_date?: string | null;
  payrate?: string | number | null;
};

const payrateKey = (staffId: string, workDate: string) => `${staffId}__${workDate}`;

const fetchAgencyPayrates = async (supabase: SupabaseClient, staffIds: readonly string[], workDates: readonly string[]) => {
  const scopedStaffIds = Array.from(new Set(staffIds.map((item) => String(item ?? '').trim()).filter(Boolean)));
  const scopedWorkDates = Array.from(new Set(workDates.map((item) => String(item ?? '').trim()).filter(Boolean)));
  if (scopedStaffIds.length === 0 || scopedWorkDates.length === 0) return new Map<string, string>();

  const result = await supabase
    .from(AGENCY_PAYRATES_TABLE)
    .select('staff_id, work_date, payrate')
    .in('staff_id', scopedStaffIds)
    .in('work_date', scopedWorkDates);

  if (result.error) {
    throw new Error(String(result.error.message ?? 'Failed to load agency payrates.'));
  }

  const next = new Map<string, string>();
  for (const row of (Array.isArray(result.data) ? (result.data as AgencyPayrateRow[]) : [])) {
    const staffId = String(row.staff_id ?? '').trim();
    const workDate = String(row.work_date ?? '').trim();
    const payrate = normalizeAgencyPayrateInput(row.payrate);
    if (!staffId || !workDate || !payrate) continue;
    next.set(payrateKey(staffId, workDate), payrate);
  }
  return next;
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
  const [payload, driverPayload, notePayload] = await Promise.all([
    expectRpcSuccess<AgencyWeekSchedule>(supabase.rpc('agency_get_schedule_week', { p_work_date: workDate })),
    expectRpcSuccess<{
      assignments?: Array<{ staff_id?: string | null; code?: string | null; role?: string | null; label?: string | null }>;
      groups?: Array<Record<string, unknown>>;
      next_code?: string | number | null;
    }>(supabase.rpc('agency_get_driver_groups')),
    expectRpcSuccess<Array<{ staff_id?: string | null; note?: string | null }>>(supabase.rpc('agency_get_employee_notes'))
  ]);
  const driverAssignmentByStaffId = new Map(
    (Array.isArray(driverPayload.assignments) ? driverPayload.assignments : [])
      .map((row) => {
        const staffId = String(row?.staff_id ?? '').trim();
        const role = String(row?.role ?? '').trim() === 'driver' ? 'driver' : 'member';
        return [
          staffId,
          {
            code: String(row?.code ?? '').trim(),
            role,
            label: String(row?.label ?? '').trim()
          }
        ] as const;
      })
      .filter(([staffId]) => Boolean(staffId))
  );
  const noteByStaffId = new Map(
    (Array.isArray(notePayload) ? notePayload : [])
      .map((row) => [String(row?.staff_id ?? '').trim(), String(row?.note ?? '').trim()] as const)
      .filter(([staffId]) => Boolean(staffId))
  );
  const weekDates = Array.isArray(payload.week_dates) ? payload.week_dates.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
  const employees = Array.isArray(payload.employees)
    ? payload.employees.map((row) => ({
          staff_id: String(row?.staff_id ?? '').trim(),
          name: String(row?.name ?? '').trim(),
          agency: String(row?.agency ?? '').trim(),
          position: String(row?.position ?? '').trim(),
          shift: (String(row?.shift ?? '').trim() === 'late' ? 'late' : String(row?.shift ?? '').trim() === 'early' ? 'early' : '') as 'early' | 'late' | '',
          start_time: String(row?.start_time ?? '').trim(),
          label: String(row?.label ?? '').trim(),
          payrate: '',
          fixed_work_count: Number(row?.fixed_work_count ?? 0) || 0,
          termination_status: row?.termination_status == null ? null : String(row.termination_status).trim() || null,
          driver_group_code: driverAssignmentByStaffId.get(String(row?.staff_id ?? '').trim())?.code ?? '',
          driver_group_role: (driverAssignmentByStaffId.get(String(row?.staff_id ?? '').trim())?.role ?? '') as 'driver' | 'member' | '',
          driver_group_label: driverAssignmentByStaffId.get(String(row?.staff_id ?? '').trim())?.label ?? '',
          agency_note: noteByStaffId.get(String(row?.staff_id ?? '').trim()) ?? '',
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
    : [];
  const newHireRequests = Array.isArray(payload.new_hire_requests)
    ? payload.new_hire_requests.map((row) => ({
          staff_id: String(row?.staff_id ?? '').trim(),
          name: String(row?.name ?? '').trim(),
          agency: String(row?.agency ?? '').trim(),
          position: String(row?.position ?? '').trim(),
          shift: (String(row?.shift ?? '').trim() === 'late' ? 'late' : String(row?.shift ?? '').trim() === 'early' ? 'early' : '') as 'early' | 'late' | '',
          start_time: String(row?.start_time ?? '').trim(),
          label: String(row?.label ?? '').trim(),
          payrate: '',
          work_date: String(row?.work_date ?? '').trim(),
          can_delete: Boolean(row?.can_delete)
        }))
    : [];
  const payrateByStaffDate = await fetchAgencyPayrates(
    supabase,
    [...employees.map((row) => row.staff_id), ...newHireRequests.map((row) => row.staff_id)],
    weekDates
  );

  return {
    week_dates: weekDates,
    employees: employees.map((row) => ({
      ...row,
      payrate: payrateByStaffDate.get(payrateKey(row.staff_id, workDate)) ?? ''
    })),
    new_hire_requests: newHireRequests.map((row) => ({
      ...row,
      payrate: payrateByStaffDate.get(payrateKey(row.staff_id, row.work_date)) ?? ''
    })),
    driver_groups: Array.isArray(driverPayload.groups)
      ? driverPayload.groups.map((row) => ({
          code: String(row?.code ?? '').trim(),
          activeMemberCount: Number(row?.activeMemberCount ?? row?.active_member_count ?? 0) || 0,
          memberCount: Number(row?.memberCount ?? row?.member_count ?? 0) || 0,
          driverCount: Number(row?.driverCount ?? row?.driver_count ?? 0) || 0,
          labels: Array.isArray(row?.labels) ? row.labels.map((item) => String(item ?? '').trim()).filter(Boolean) : []
        }))
      : [],
    next_driver_group_code: String(driverPayload.next_code ?? '').trim()
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

const syncAgencyNewHirePayrate = async (
  supabase: SupabaseClient,
  staffIds: readonly string[],
  workDate: string,
  payrateInput: unknown
) => {
  const scopedStaffIds = Array.from(new Set(staffIds.map((item) => String(item ?? '').trim()).filter(Boolean)));
  const scopedWorkDate = String(workDate ?? '').trim();
  if (scopedStaffIds.length === 0 || !scopedWorkDate) return;

  const payrate = normalizeAgencyPayrateInput(payrateInput);
  if (!payrate) {
    const result = await supabase
      .from(AGENCY_PAYRATES_TABLE)
      .delete()
      .in('staff_id', scopedStaffIds)
      .eq('work_date', scopedWorkDate);
    if (result.error) {
      throw new Error(String(result.error.message ?? 'Failed to clear agency payrate.'));
    }
    return;
  }

  const result = await supabase.from(AGENCY_PAYRATES_TABLE).upsert(
    scopedStaffIds.map((staffId) => ({
      staff_id: staffId,
      work_date: scopedWorkDate,
      payrate,
      updated_at: new Date().toISOString()
    })),
    { onConflict: 'staff_id,work_date' }
  );
  if (result.error) {
    throw new Error(String(result.error.message ?? 'Failed to save agency payrate.'));
  }
};

export const upsertAgencyPayrate = async (supabase: SupabaseClient, staffId: string, workDate: string, payrateInput: unknown) => {
  await syncAgencyNewHirePayrate(supabase, [staffId], workDate, payrateInput);
};

export const upsertAgencyNewHireDemand = async (supabase: SupabaseClient, input: AgencyUpsertNewHireInput) => {
  const payload = await expectRpcSuccess<Record<string, unknown>>(
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
  const staffIds = Array.isArray(payload?.staff_ids)
    ? payload.staff_ids.map((item) => String(item ?? '').trim()).filter(Boolean)
    : input.staffId
      ? [String(input.staffId).trim()]
      : [];
  await syncAgencyNewHirePayrate(supabase, staffIds, input.workDate, input.payrate);
  return payload;
};

export const deleteAgencyNewHireDemand = async (supabase: SupabaseClient, staffId: string, workDate: string) => {
  const payload = await expectRpcSuccess(
    supabase.rpc('agency_delete_new_hire_demand', {
      p_staff_id: staffId,
      p_work_date: workDate
    })
  );
  await syncAgencyNewHirePayrate(supabase, [staffId], workDate, '');
  return payload;
};

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

export const upsertAgencyDriverGroup = async (
  supabase: SupabaseClient,
  code: string,
  driverStaffId: string,
  memberStaffIds: string[]
) =>
  expectRpcSuccess(
    supabase.rpc('agency_upsert_driver_group', {
      p_code: code,
      p_driver_staff_id: driverStaffId,
      p_member_staff_ids: memberStaffIds
    })
  );

export const deleteAgencyDriverGroup = async (supabase: SupabaseClient, code: string) =>
  expectRpcSuccess(
    supabase.rpc('agency_delete_driver_group', {
      p_code: code
    })
  );

export const setAgencyDriverGroupIndividual = async (supabase: SupabaseClient, staffId: string) =>
  expectRpcSuccess(
    supabase.rpc('agency_set_driver_group_individual', {
      p_staff_id: staffId
    })
  );

export const upsertAgencyEmployeeNote = async (supabase: SupabaseClient, staffId: string, note: string) =>
  expectRpcSuccess(
    supabase.rpc('agency_upsert_employee_note', {
      p_staff_id: staffId,
      p_note: note
    })
  );
