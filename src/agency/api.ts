import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAdminAccessContext, type AdminAccessContext } from '../shared/adminAccess';
import type { AgencyBoard, AgencyUpsertNewHireInput } from './types';

const PROFILE_TABLE = (import.meta.env.VITE_USER_PROFILE_TABLE as string | undefined) ?? 'ob_user_profiles';

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

export const fetchAgencyUserDisplayName = async (supabase: SupabaseClient, userId: string) => {
  const result = await supabase.from(PROFILE_TABLE).select('display_name').eq('user_id', userId).maybeSingle();
  if (result.error) return '';
  return String((result.data as { display_name?: string | null } | null)?.display_name ?? '').trim();
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
      p_count: input.count
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
