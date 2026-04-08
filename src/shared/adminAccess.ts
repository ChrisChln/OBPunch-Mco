export const ADMIN_MODULE_KEYS = [
  'home',
  'employees',
  'accounts',
  'timecard',
  'leave_approval',
  'todo',
  'punches',
  'audit',
  'schedule',
  'devices',
  'forecast',
  'prediction_model',
  'efficiency',
  'agency'
] as const;

export type AdminModuleKey = (typeof ADMIN_MODULE_KEYS)[number];
export type AdminRole = 'level1' | 'level2' | 'level3' | 'agency';
export type AdminModuleAccessLevel = 'hidden' | 'view' | 'operate';

export type AdminAccessModule = {
  module_key: AdminModuleKey;
  access_level: AdminModuleAccessLevel;
};

export type AdminAccessContext = {
  user_id: string;
  role: AdminRole;
  managed_agencies: string[];
  modules: AdminAccessModule[];
};

export const DEFAULT_LEVEL1_EMAIL = 'lnchen4201@gmail.com';

const ADMIN_ROLE_VALUES: AdminRole[] = ['level1', 'level2', 'level3', 'agency'];
const ADMIN_ACCESS_LEVEL_VALUES: AdminModuleAccessLevel[] = ['hidden', 'view', 'operate'];

export const normalizeAdminRole = (value: unknown, fallbackEmail?: string | null): AdminRole => {
  const role = String(value ?? '').trim().toLowerCase() as AdminRole;
  if (ADMIN_ROLE_VALUES.includes(role)) return role;
  if (String(fallbackEmail ?? '').trim().toLowerCase() === DEFAULT_LEVEL1_EMAIL) return 'level1';
  return 'agency';
};

export const normalizeModuleAccessLevel = (value: unknown): AdminModuleAccessLevel => {
  const level = String(value ?? '').trim().toLowerCase() as AdminModuleAccessLevel;
  return ADMIN_ACCESS_LEVEL_VALUES.includes(level) ? level : 'hidden';
};

export const getDefaultModuleAccess = (role: AdminRole, moduleKey: AdminModuleKey): AdminModuleAccessLevel => {
  if (role === 'level1' || role === 'level2') return 'operate';
  if (role === 'level3') return 'view';
  return moduleKey === 'agency' ? 'view' : 'hidden';
};

export const buildEffectiveModuleMap = (
  role: AdminRole,
  overrides: Array<Partial<AdminAccessModule>> | null | undefined
): Record<AdminModuleKey, AdminModuleAccessLevel> => {
  const next = Object.fromEntries(
    ADMIN_MODULE_KEYS.map((moduleKey) => [moduleKey, getDefaultModuleAccess(role, moduleKey)])
  ) as Record<AdminModuleKey, AdminModuleAccessLevel>;

  for (const override of overrides ?? []) {
    const moduleKey = String(override.module_key ?? '').trim() as AdminModuleKey;
    if (!ADMIN_MODULE_KEYS.includes(moduleKey)) continue;
    next[moduleKey] = normalizeModuleAccessLevel(override.access_level);
  }

  return next;
};

export const hasModuleAccess = (
  moduleMap: Record<AdminModuleKey, AdminModuleAccessLevel>,
  moduleKey: AdminModuleKey,
  required: AdminModuleAccessLevel = 'view'
) => {
  const actual = moduleMap[moduleKey] ?? 'hidden';
  if (required === 'operate') return actual === 'operate';
  if (required === 'view') return actual === 'view' || actual === 'operate';
  return actual !== 'hidden';
};

export const normalizeAdminAccessContext = (
  payload: unknown,
  fallbackEmail?: string | null
): AdminAccessContext => {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const role = normalizeAdminRole(raw.role, fallbackEmail);
  const managedAgencies = Array.isArray(raw.managed_agencies)
    ? raw.managed_agencies.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const modulesRaw = Array.isArray(raw.modules) ? raw.modules : [];
  const moduleMap = buildEffectiveModuleMap(role, modulesRaw as Array<Partial<AdminAccessModule>>);

  return {
    user_id: String(raw.user_id ?? '').trim(),
    role,
    managed_agencies: managedAgencies,
    modules: ADMIN_MODULE_KEYS.map((moduleKey) => ({
      module_key: moduleKey,
      access_level: moduleMap[moduleKey]
    }))
  };
};

export const getModuleMapFromContext = (context: AdminAccessContext | null | undefined) =>
  buildEffectiveModuleMap(context?.role ?? 'agency', context?.modules ?? []);

export const getVisibleModules = (context: AdminAccessContext | null | undefined) =>
  ADMIN_MODULE_KEYS.filter((moduleKey) => hasModuleAccess(getModuleMapFromContext(context), moduleKey, 'view'));

export const canManageAdminAccess = (context: AdminAccessContext | null | undefined) => {
  if (!context || context.role !== 'level1') return false;
  return hasModuleAccess(getModuleMapFromContext(context), 'accounts', 'operate');
};

export const canReviewTerminationRequests = (context: AdminAccessContext | null | undefined) => {
  if (!context) return false;
  if (!hasModuleAccess(getModuleMapFromContext(context), 'schedule', 'operate')) return false;
  return context.role === 'level1' || context.role === 'level2' || context.role === 'level3';
};
