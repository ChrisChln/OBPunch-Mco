import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ADMIN_MODULE_KEYS,
  buildEffectiveModuleMap,
  normalizeAdminRole,
  normalizeAdminAccessContext,
  normalizeModuleAccessLevel,
  normalizePositionScopesForContext,
  type AdminAccessContext,
  type AdminAccessModule,
  type AdminModuleAccessLevel,
  type AdminModuleKey,
  type AdminPositionScopes,
  type AdminRole
} from '../shared/adminAccess';
import { normalizePositionDepartment, normalizePositionTone, type PositionDepartment, type PositionRecord } from '../shared/positions';
import type { LabelToneKey } from '../lib/labelTone';

type RpcResult<T> = {
  data: T | null;
  error: { message?: string | null } | null;
};

const expectRpcSuccess = async <T>(promise: PromiseLike<RpcResult<T>>) => {
  const result = await promise;
  if (result.error) {
    throw new Error(String(result.error.message ?? 'RPC failed.'));
  }
  return result.data as T;
};

export type AdminAccessUserOption = {
  user_id: string;
  user_email: string;
  display_name: string;
};

export type AdminAccessAccountRecord = {
  user_id: string;
  user_email: string;
  display_name: string;
  avatar_url?: string;
  role: AdminRole;
  is_active: boolean;
  managed_agencies: string[];
  modules: AdminAccessModule[];
  position_scopes: AdminPositionScopes;
};

export type AdminAccessSavePayload = {
  user_id: string;
  role: AdminRole;
  is_active: boolean;
  managed_agencies: string[];
  modules: Array<{ module_key: AdminModuleKey; access_level: AdminModuleAccessLevel }>;
  position_scopes: AdminPositionScopes;
};

export type AdminAccessRequestRecord = {
  id: string;
  requester_user_id: string;
  requester_user_email: string;
  requester_display_name: string;
  requested_role: AdminRole;
  requested_managed_agencies: string[];
  requested_modules: AdminAccessModule[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string;
  reviewed_by_user_id: string | null;
  reviewed_by_display_name: string;
  created_at: string;
  reviewed_at: string | null;
};

export type AdminAccessRequestCreatePayload = {
  requested_role: AdminRole;
  requested_managed_agencies: string[];
  requested_modules: Array<{ module_key: AdminModuleKey; access_level: AdminModuleAccessLevel }>;
  reason: string;
};

export type TerminationRequestRecord = {
  id: string;
  staff_id: string;
  agency: string;
  requested_by_display: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  employee_snapshot: Record<string, unknown>;
};

export const fetchAdminAccessContext = async (
  supabase: SupabaseClient,
  fallbackEmail?: string | null
): Promise<AdminAccessContext> => {
  const payload = await expectRpcSuccess(supabase.rpc('get_admin_access_context'));
  return normalizeAdminAccessContext(payload, fallbackEmail);
};

const normalizePositionRow = (row: Record<string, unknown>): PositionRecord => ({
  id: typeof row.id === 'string' || typeof row.id === 'number' ? row.id : undefined,
  name: String(row.name ?? '').trim(),
  department: normalizePositionDepartment(row.department),
  tone: normalizePositionTone(row.tone),
  is_active: Boolean(row.is_active ?? true),
  display_order: Number(row.display_order ?? 0),
  created_at: row.created_at ? String(row.created_at) : null,
  updated_at: row.updated_at ? String(row.updated_at) : null
});

export const listPositions = async (supabase: SupabaseClient): Promise<PositionRecord[]> => {
  const rows = await expectRpcSuccess<Array<Record<string, unknown>>>(supabase.rpc('list_positions'));
  return (Array.isArray(rows) ? rows : [])
    .map(normalizePositionRow)
    .filter((row) => row.name)
    .sort((left, right) => {
      const orderDiff = Number(left.display_order ?? 0) - Number(right.display_order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return left.name.localeCompare(right.name, 'en-US');
    });
};

export const savePosition = async (
  supabase: SupabaseClient,
  payload: { name: string; display_order: number; is_active: boolean; department?: PositionDepartment; tone?: LabelToneKey; original_name?: string | null }
): Promise<PositionRecord> => {
  const params = {
    p_name: payload.name,
    p_display_order: payload.display_order,
    p_is_active: payload.is_active,
    p_department: normalizePositionDepartment(payload.department),
    p_tone: normalizePositionTone(payload.tone),
    p_original_name: payload.original_name ?? null
  };

  try {
    return normalizePositionRow(
      await expectRpcSuccess<Record<string, unknown>>(
        supabase.rpc('save_position', params)
      )
    );
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).toLowerCase();
    if (!message.includes('save_position') && !message.includes('p_tone') && !message.includes('p_department') && !message.includes('function')) {
      throw error;
    }
    return normalizePositionRow(
      await expectRpcSuccess<Record<string, unknown>>(
      supabase.rpc('save_position', {
        p_name: payload.name,
        p_display_order: payload.display_order,
        p_is_active: payload.is_active,
        p_original_name: payload.original_name ?? null
      })
      )
    );
  }
};

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item ?? '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const normalizeModuleOverrides = (
  value: unknown
): Array<{ module_key: AdminModuleKey; access_level: AdminModuleAccessLevel }> => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const module = item as Record<string, unknown>;
        const moduleKey = String(module?.module_key ?? '').trim() as AdminModuleKey;
        if (!ADMIN_MODULE_KEYS.includes(moduleKey)) return null;
        return {
          module_key: moduleKey,
          access_level: normalizeModuleAccessLevel(module?.access_level)
        };
      })
      .filter((item): item is { module_key: AdminModuleKey; access_level: AdminModuleAccessLevel } => Boolean(item));
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeModuleOverrides(parsed);
    } catch {
      return [];
    }
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('modules' in obj) {
      return normalizeModuleOverrides(obj.modules);
    }
    if ('module_key' in obj || 'access_level' in obj) {
      return normalizeModuleOverrides([obj]);
    }
    if (Object.keys(obj).every((key) => /^\d+$/.test(key))) {
      return normalizeModuleOverrides(Object.values(obj));
    }
    return Object.entries(obj)
      .map(([key, rawAccess]) => {
        const moduleKey = String(key ?? '').trim() as AdminModuleKey;
        if (!ADMIN_MODULE_KEYS.includes(moduleKey)) return null;
        const nestedAccess =
          rawAccess && typeof rawAccess === 'object' ? (rawAccess as Record<string, unknown>).access_level : rawAccess;
        return {
          module_key: moduleKey,
          access_level: normalizeModuleAccessLevel(nestedAccess)
        };
      })
      .filter((item): item is { module_key: AdminModuleKey; access_level: AdminModuleAccessLevel } => Boolean(item));
  }

  return [];
};

const normalizeAdminAccessAccount = (row: Record<string, unknown>): AdminAccessAccountRecord => {
  const role = normalizeAdminRole(row.role, String(row.user_email ?? '').trim());
  const managedAgencies = parseStringArray(row.managed_agencies);
  const moduleOverrides = normalizeModuleOverrides(row.modules);
  const moduleMap = buildEffectiveModuleMap(role, moduleOverrides);

  return {
    user_id: String(row.user_id ?? '').trim(),
    user_email: String(row.user_email ?? '').trim(),
    display_name: String(row.display_name ?? '').trim(),
    avatar_url: String(row.avatar_url ?? '').trim(),
    role,
    is_active: Boolean(row.is_active ?? true),
    managed_agencies: managedAgencies,
    modules: ADMIN_MODULE_KEYS.map((moduleKey) => ({
      module_key: moduleKey,
      access_level: moduleMap[moduleKey]
    })),
    position_scopes: normalizePositionScopesForContext(row.position_scopes)
  };
};

export const listAdminAccessAccounts = async (supabase: SupabaseClient): Promise<AdminAccessAccountRecord[]> => {
  const rows = await expectRpcSuccess<Array<Record<string, unknown>>>(supabase.rpc('list_admin_access_accounts'));
  return (Array.isArray(rows) ? rows : []).map(normalizeAdminAccessAccount);
};

export const saveAdminAccessAccount = async (supabase: SupabaseClient, payload: AdminAccessSavePayload) =>
  expectRpcSuccess(
    supabase.rpc('save_admin_access_account', {
      p_user_id: payload.user_id,
      p_role: payload.role,
      p_is_active: payload.is_active,
      p_managed_agencies: payload.managed_agencies,
      p_modules: payload.modules,
      p_position_scopes: payload.position_scopes
    })
  );

const normalizeAdminAccessRequest = (row: Record<string, unknown>): AdminAccessRequestRecord => {
  const requestedRole = normalizeAdminAccessContext({
    user_id: row.requester_user_id,
    role: row.requested_role,
    managed_agencies: row.requested_managed_agencies,
    modules: row.requested_modules
  });
  const statusRaw = String(row.status ?? 'pending').trim().toLowerCase();
  const status: AdminAccessRequestRecord['status'] =
    statusRaw === 'approved' || statusRaw === 'rejected' ? statusRaw : 'pending';

  return {
    id: String(row.id ?? '').trim(),
    requester_user_id: String(row.requester_user_id ?? '').trim(),
    requester_user_email: String(row.requester_user_email ?? '').trim(),
    requester_display_name: String(row.requester_display_name ?? '').trim(),
    requested_role: requestedRole.role,
    requested_managed_agencies: requestedRole.managed_agencies,
    requested_modules: requestedRole.modules,
    reason: String(row.reason ?? '').trim(),
    status,
    review_note: String(row.review_note ?? '').trim(),
    reviewed_by_user_id: row.reviewed_by_user_id ? String(row.reviewed_by_user_id).trim() : null,
    reviewed_by_display_name: String(row.reviewed_by_display_name ?? '').trim(),
    created_at: String(row.created_at ?? '').trim(),
    reviewed_at: row.reviewed_at ? String(row.reviewed_at).trim() : null
  };
};

export const listAdminAccessRequests = async (
  supabase: SupabaseClient,
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'all'
): Promise<AdminAccessRequestRecord[]> => {
  const rows = await expectRpcSuccess<Array<Record<string, unknown>>>(
    supabase.rpc('list_admin_access_requests', {
      p_status: status === 'all' ? null : status
    })
  );
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeAdminAccessRequest)
    .filter((row) => row.id && row.requester_user_id);
};

export const createAdminAccessRequest = async (
  supabase: SupabaseClient,
  payload: AdminAccessRequestCreatePayload
) =>
  expectRpcSuccess(
    supabase.rpc('create_admin_access_request', {
      p_requested_role: payload.requested_role,
      p_requested_managed_agencies: payload.requested_managed_agencies,
      p_requested_modules: payload.requested_modules,
      p_reason: payload.reason
    })
  );

export const reviewAdminAccessRequest = async (
  supabase: SupabaseClient,
  requestId: string,
  action: 'approve' | 'reject',
  reviewNote = ''
) =>
  expectRpcSuccess(
    supabase.rpc('review_admin_access_request', {
      p_request_id: requestId,
      p_action: action,
      p_review_note: reviewNote
    })
  );

const normalizeTerminationRequest = (row: Record<string, unknown>): TerminationRequestRecord => {
  const statusRaw = String(row.status ?? 'pending').trim().toLowerCase();
  const status: TerminationRequestRecord['status'] =
    statusRaw === 'approved' || statusRaw === 'rejected' || statusRaw === 'cancelled' ? statusRaw : 'pending';

  return {
    id: String(row.id ?? '').trim(),
    staff_id: String(row.staff_id ?? '').trim(),
    agency: String(row.agency ?? row.employee_user_scope_agency ?? '').trim(),
    requested_by_display: String(row.requested_by_display ?? '').trim(),
    reason: String(row.reason ?? '').trim(),
    status,
    review_note: String(row.review_note ?? '').trim(),
    created_at: String(row.created_at ?? '').trim(),
    reviewed_at: row.reviewed_at ? String(row.reviewed_at).trim() : null,
    reviewed_by_user_id: row.reviewed_by_user_id ? String(row.reviewed_by_user_id).trim() : null,
    employee_snapshot:
      row.employee_snapshot && typeof row.employee_snapshot === 'object'
        ? (row.employee_snapshot as Record<string, unknown>)
        : {}
  };
};

export const listEmployeeTerminationRequests = async (
  supabase: SupabaseClient,
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all' = 'pending'
): Promise<TerminationRequestRecord[]> => {
  const rows = await expectRpcSuccess<Array<Record<string, unknown>>>(
    supabase.rpc('list_employee_termination_requests', {
      p_status: status === 'all' ? null : status
    })
  );
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeTerminationRequest)
    .filter((row) => row.id && row.staff_id);
};

export const reviewEmployeeTerminationRequest = async (
  supabase: SupabaseClient,
  requestId: string,
  action: 'approve' | 'reject',
  reviewNote = ''
) =>
  expectRpcSuccess(
    supabase.rpc('review_employee_termination_request', {
      p_request_id: requestId,
      p_action: action,
      p_review_note: reviewNote
    })
  );

export const cancelPendingEmployeeTerminationRequests = async (
  supabase: SupabaseClient,
  staffId: string,
  reviewNote = ''
): Promise<{ staff_id: string; cancelled_count: number }> =>
  expectRpcSuccess(
    supabase.rpc('cancel_pending_employee_termination_requests', {
      p_staff_id: staffId,
      p_review_note: reviewNote
    })
  );

export const normalizeAdminAccessModulesForSave = (
  modules: Array<{ module_key: string; access_level: string }>
): Array<{ module_key: AdminModuleKey; access_level: AdminModuleAccessLevel }> =>
  modules
    .map((module) => ({
      module_key: String(module.module_key ?? '').trim() as AdminModuleKey,
      access_level: normalizeModuleAccessLevel(module.access_level)
    }))
    .filter((module): module is { module_key: AdminModuleKey; access_level: AdminModuleAccessLevel } =>
      ADMIN_MODULE_KEYS.includes(module.module_key)
    );
