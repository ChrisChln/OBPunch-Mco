import { isValidPunchStaffId, normalizeStaffId } from '../src/lib/staffId.js';
import { isScheduleOnlyAgency } from '../src/shared/agencyRules.js';
import { isEmployeeTerminated } from '../src/shared/employeeStatus.js';

export type PunchAction = 'IN' | 'OUT';
export type PunchRequestAction = PunchAction | 'AUTO';

type PunchRequest = {
  staffId: string;
  action: PunchRequestAction;
  userAgent: string;
};

type PunchResult =
  | {
      ok: true;
      status: 200;
      staffId: string;
      action: PunchAction;
    }
  | {
      ok: false;
      status: 400 | 404 | 409 | 500;
      error: string;
    };

type EmployeeRow = {
  staff_id?: string | null;
  agency?: string | null;
  terminated_at?: string | null;
};

type TempAccountAssignmentRow = {
  staff_id?: string | null;
  source_temp_staff_id?: string | null;
};

type PunchRow = {
  action?: string | null;
  created_at?: string | null;
};

type QueryResponse<T> = {
  data?: T[] | null;
  error?: { message?: string } | null;
};

type MutationResponse = PromiseLike<{ error?: { message?: string } | null }>;

type SupabaseLike = {
  from: (table: string) => {
    select?: (columns: string) => unknown;
    insert?: (rows: unknown[]) => MutationResponse;
  };
};

const getErrorMessage = (value: unknown, fallback: string) => {
  const message =
    value && typeof value === 'object' && 'message' in value ? String((value as { message?: unknown }).message ?? '') : '';
  return message.trim() || fallback;
};

const isMissingMetadataColumnError = (value: unknown) => {
  const message = getErrorMessage(value, '').toLowerCase();
  return message.includes('metadata') && message.includes('ob_punches') && message.includes('schema cache');
};

const isMissingTempBindingSchemaError = (value: unknown) => {
  const message = getErrorMessage(value, '').toLowerCase();
  const mentionsBindingSchema =
    message.includes('ob_temp_account_assignments') || message.includes('source_temp_staff_id');
  return mentionsBindingSchema && (message.includes('schema cache') || message.includes('does not exist'));
};

const loadEmployee = async (supabase: SupabaseLike, staffId: string): Promise<QueryResponse<EmployeeRow>> => {
  const query = supabase.from('ob_employees').select?.('staff_id, agency, terminated_at') as
    | undefined
    | {
        eq: (column: string, value: string) => {
          limit: (count: number) => Promise<QueryResponse<EmployeeRow>>;
        };
      };
  if (!query) return { data: null, error: { message: 'Employee query is not available.' } };
  return query.eq('staff_id', staffId).limit(1);
};

const loadTempAccountBinding = async (
  supabase: SupabaseLike,
  tempStaffId: string
): Promise<QueryResponse<TempAccountAssignmentRow>> => {
  const query = supabase.from('ob_temp_account_assignments').select?.('staff_id, source_temp_staff_id') as
    | undefined
    | {
        eq: (column: string, value: string) => {
          order: (
            column: string,
            options: { ascending: boolean }
          ) => {
            limit: (count: number) => Promise<QueryResponse<TempAccountAssignmentRow>>;
          };
        };
      };
  if (!query) return { data: [], error: null };
  return query.eq('source_temp_staff_id', tempStaffId).order('created_at', { ascending: false }).limit(1);
};

const loadLatestPunch = async (supabase: SupabaseLike, staffId: string): Promise<QueryResponse<PunchRow>> => {
  const query = supabase.from('ob_punches').select?.('action, created_at') as
    | undefined
    | {
        eq: (column: string, value: string) => {
          order: (
            column: string,
            options: { ascending: boolean }
          ) => {
            limit: (count: number) => Promise<QueryResponse<PunchRow>>;
          };
        };
      };
  if (!query) return { data: null, error: { message: 'Punch query is not available.' } };
  return query.eq('staff_id', staffId).order('created_at', { ascending: false }).limit(1);
};

const resolveEmployeeByStaffAlias = async (
  supabase: SupabaseLike,
  inputStaffId: string
): Promise<
  | { employee: EmployeeRow; resolvedStaffId: string; error: null }
  | { employee: null; resolvedStaffId: string; error: { status: 500; message: string } | null }
> => {
  let currentStaffId = inputStaffId;
  const visited = new Set<string>();

  for (let depth = 0; depth < 6; depth += 1) {
    if (!currentStaffId || visited.has(currentStaffId)) break;
    visited.add(currentStaffId);

    const employeeRes = await loadEmployee(supabase, currentStaffId);
    if (employeeRes.error) {
      return {
        employee: null,
        resolvedStaffId: currentStaffId,
        error: { status: 500, message: getErrorMessage(employeeRes.error, 'Failed to verify employee.') }
      };
    }

    const employee = (employeeRes.data ?? [])[0] ?? null;
    if (employee) {
      return { employee, resolvedStaffId: currentStaffId, error: null };
    }

    const bindingRes = await loadTempAccountBinding(supabase, currentStaffId);
    if (bindingRes.error) {
      if (isMissingTempBindingSchemaError(bindingRes.error)) break;
      return {
        employee: null,
        resolvedStaffId: currentStaffId,
        error: {
          status: 500,
          message: getErrorMessage(bindingRes.error, 'Failed to verify temporary account binding.')
        }
      };
    }

    const boundStaffId = normalizeStaffId(String((bindingRes.data ?? [])[0]?.staff_id ?? ''));
    if (!boundStaffId || boundStaffId === currentStaffId) break;
    currentStaffId = boundStaffId;
  }

  return { employee: null, resolvedStaffId: currentStaffId || inputStaffId, error: null };
};

const isAllowedNextAction = (action: PunchAction, latestAction: PunchAction | null) =>
  (action === 'IN' && (latestAction === null || latestAction === 'OUT')) ||
  (action === 'OUT' && latestAction === 'IN');

const getNextActionError = (latestAction: PunchAction | null) => {
  if (latestAction === null) return 'No previous record found. First action must be IN.';
  if (latestAction === 'IN') return 'Last action is IN. Please punch OUT next.';
  return 'Last action is OUT. Please punch IN next.';
};

export const submitPunchWithServiceRole = async (
  supabase: SupabaseLike,
  request: PunchRequest
): Promise<PunchResult> => {
  const staffId = normalizeStaffId(String(request.staffId ?? ''));
  if (!isValidPunchStaffId(staffId)) {
    return { ok: false, status: 400, error: 'Invalid staff ID format.' };
  }
  if (request.action !== 'IN' && request.action !== 'OUT' && request.action !== 'AUTO') {
    return { ok: false, status: 400, error: 'Invalid punch action.' };
  }

  const resolved = await resolveEmployeeByStaffAlias(supabase, staffId);
  if (resolved.error) {
    return { ok: false, status: resolved.error.status, error: resolved.error.message };
  }

  const { employee, resolvedStaffId } = resolved;
  if (!employee) {
    return { ok: false, status: 404, error: `Employee not registered: ${staffId}` };
  }
  if (isScheduleOnlyAgency(String(employee.agency ?? ''))) {
    return { ok: false, status: 409, error: `Employee does not use punch: ${resolvedStaffId}` };
  }
  if (isEmployeeTerminated({ terminatedAt: employee.terminated_at }, { referenceAt: new Date(), allowTerminationDate: true })) {
    return { ok: false, status: 409, error: `Employee is terminated and cannot punch: ${resolvedStaffId}` };
  }

  const latestRes = await loadLatestPunch(supabase, resolvedStaffId);
  if (latestRes.error) {
    return { ok: false, status: 500, error: getErrorMessage(latestRes.error, 'Failed to load last punch.') };
  }

  const latestActionRaw = String((latestRes.data ?? [])[0]?.action ?? '').toUpperCase();
  const latestAction: PunchAction | null = latestActionRaw === 'IN' || latestActionRaw === 'OUT' ? latestActionRaw : null;
  const punchAction: PunchAction = request.action === 'AUTO' ? (latestAction === 'IN' ? 'OUT' : 'IN') : request.action;
  if (!isAllowedNextAction(punchAction, latestAction)) {
    return { ok: false, status: 409, error: getNextActionError(latestAction) };
  }

  const punchInsertBuilder = supabase.from('ob_punches');
  if (!punchInsertBuilder.insert) {
    return { ok: false, status: 500, error: 'Punch insert is not available.' };
  }

  const rowWithMetadata = {
    staff_id: resolvedStaffId,
    action: punchAction,
    metadata: {
      device: 'web_browser',
      source: 'api_punch',
      input_staff_id: staffId,
      user_agent: String(request.userAgent ?? '')
    }
  };
  const insertRes = await punchInsertBuilder.insert([rowWithMetadata]);
  if (insertRes.error && isMissingMetadataColumnError(insertRes.error)) {
    const fallbackRes = await punchInsertBuilder.insert([
      {
        staff_id: resolvedStaffId,
        action: punchAction
      }
    ]);
    if (fallbackRes.error) {
      return { ok: false, status: 500, error: getErrorMessage(fallbackRes.error, 'Punch failed.') };
    }
    return { ok: true, status: 200, staffId: resolvedStaffId, action: punchAction };
  }

  if (insertRes.error) {
    return { ok: false, status: 500, error: getErrorMessage(insertRes.error, 'Punch failed.') };
  }

  return { ok: true, status: 200, staffId: resolvedStaffId, action: punchAction };
};
