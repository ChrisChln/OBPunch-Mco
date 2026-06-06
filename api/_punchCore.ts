import { isValidStaffId, normalizeStaffId } from '../src/lib/staffId';
import { isScheduleOnlyAgency } from '../src/shared/agencyRules';
import { isEmployeeTerminated } from '../src/shared/employeeStatus';

export type PunchAction = 'IN' | 'OUT';

type PunchRequest = {
  staffId: string;
  action: PunchAction;
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

type PunchRow = {
  action?: string | null;
  created_at?: string | null;
};

type QueryResponse<T> = {
  data?: T[] | null;
  error?: { message?: string } | null;
};

type SupabaseLike = {
  from: (table: string) => {
    select?: (columns: string) => unknown;
    insert?: (rows: unknown[]) => Promise<{ error?: { message?: string } | null }>;
  };
};

const getErrorMessage = (value: unknown, fallback: string) => {
  const message =
    value && typeof value === 'object' && 'message' in value ? String((value as { message?: unknown }).message ?? '') : '';
  return message.trim() || fallback;
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
  if (!isValidStaffId(staffId)) {
    return { ok: false, status: 400, error: 'Invalid staff ID format.' };
  }
  if (request.action !== 'IN' && request.action !== 'OUT') {
    return { ok: false, status: 400, error: 'Invalid punch action.' };
  }

  const employeeRes = await loadEmployee(supabase, staffId);
  if (employeeRes.error) {
    return { ok: false, status: 500, error: getErrorMessage(employeeRes.error, 'Failed to verify employee.') };
  }

  const employee = (employeeRes.data ?? [])[0] ?? null;
  if (!employee) {
    return { ok: false, status: 404, error: `Employee not registered: ${staffId}` };
  }
  if (isScheduleOnlyAgency(String(employee.agency ?? ''))) {
    return { ok: false, status: 409, error: `Employee does not use punch: ${staffId}` };
  }
  if (isEmployeeTerminated({ terminatedAt: employee.terminated_at })) {
    return { ok: false, status: 409, error: `Employee is terminated and cannot punch: ${staffId}` };
  }

  const latestRes = await loadLatestPunch(supabase, staffId);
  if (latestRes.error) {
    return { ok: false, status: 500, error: getErrorMessage(latestRes.error, 'Failed to load last punch.') };
  }

  const latestActionRaw = String((latestRes.data ?? [])[0]?.action ?? '').toUpperCase();
  const latestAction: PunchAction | null = latestActionRaw === 'IN' || latestActionRaw === 'OUT' ? latestActionRaw : null;
  if (!isAllowedNextAction(request.action, latestAction)) {
    return { ok: false, status: 409, error: getNextActionError(latestAction) };
  }

  const insert = supabase.from('ob_punches').insert;
  if (!insert) {
    return { ok: false, status: 500, error: 'Punch insert is not available.' };
  }

  const insertRes = await insert([
    {
      staff_id: staffId,
      action: request.action,
      metadata: {
        device: 'web_browser',
        source: 'api_punch',
        user_agent: String(request.userAgent ?? '')
      }
    }
  ]);
  if (insertRes.error) {
    return { ok: false, status: 500, error: getErrorMessage(insertRes.error, 'Punch failed.') };
  }

  return { ok: true, status: 200, staffId, action: request.action };
};
