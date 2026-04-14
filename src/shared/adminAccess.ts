export const ADMIN_MODULE_KEYS = [
  'home',
  'employees',
  'accounts',
  'permissions',
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
  return 'level3';
};

export const normalizeModuleAccessLevel = (value: unknown): AdminModuleAccessLevel => {
  const level = String(value ?? '').trim().toLowerCase() as AdminModuleAccessLevel;
  return ADMIN_ACCESS_LEVEL_VALUES.includes(level) ? level : 'hidden';
};

export const getDefaultModuleAccess = (role: AdminRole, moduleKey: AdminModuleKey): AdminModuleAccessLevel => {
  if (role === 'level1' || role === 'level2') return 'operate';
  if (role === 'level3') return 'view';
  return moduleKey === 'agency' || moduleKey === 'permissions' ? 'view' : 'hidden';
};

const parseJsonArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeModuleEntries = (
  value: unknown
): { modules: Array<Partial<AdminAccessModule>>; malformed: boolean } => {
  if (Array.isArray(value)) {
    return { modules: value as Array<Partial<AdminAccessModule>>, malformed: false };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return { modules: [], malformed: false };

    try {
      const parsed = JSON.parse(trimmed);
      return normalizeModuleEntries(parsed);
    } catch {
      return { modules: [], malformed: true };
    }
  }

  if (isPlainObject(value)) {
    if ('modules' in value) {
      return normalizeModuleEntries((value as Record<string, unknown>).modules);
    }

    // Some RPC responses can serialize JSON arrays as objects with numeric keys.
    const objectValues = Object.values(value);
    if (objectValues.length > 0 && Object.keys(value).every((key) => /^\d+$/.test(key))) {
      return normalizeModuleEntries(objectValues);
    }

    if ('module_key' in value || 'access_level' in value) {
      return { modules: [value], malformed: false };
    }

    const mapped = Object.entries(value)
      .filter(([moduleKey]) => ADMIN_MODULE_KEYS.includes(moduleKey as AdminModuleKey))
      .map(([module_key, access_level]) => {
        const nestedAccess =
          access_level && typeof access_level === 'object'
            ? (access_level as Record<string, unknown>).access_level
            : access_level;
        return { module_key, access_level: nestedAccess };
      });

    return mapped.length > 0 ? { modules: mapped, malformed: false } : { modules: [], malformed: true };
  }

  if (value == null) {
    return { modules: [], malformed: false };
  }

  return { modules: [], malformed: true };
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
  const managedAgencies = parseJsonArray(raw.managed_agencies)
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  const hasModulesField = Object.prototype.hasOwnProperty.call(raw, 'modules');
  const { modules: moduleEntries, malformed } = normalizeModuleEntries(raw.modules);
  const moduleMap =
    hasModulesField && malformed && moduleEntries.length === 0 ? buildHiddenModuleMap() : buildEffectiveModuleMap(role, moduleEntries);

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

const buildHiddenModuleMap = () =>
  Object.fromEntries(ADMIN_MODULE_KEYS.map((moduleKey) => [moduleKey, 'hidden'])) as Record<
    AdminModuleKey,
    AdminModuleAccessLevel
  >;

export const getModuleMapFromContext = (context: AdminAccessContext | null | undefined) =>
  context ? buildEffectiveModuleMap(context.role, context.modules ?? []) : buildHiddenModuleMap();

export const getVisibleModules = (context: AdminAccessContext | null | undefined) =>
  ADMIN_MODULE_KEYS.filter((moduleKey) => hasModuleAccess(getModuleMapFromContext(context), moduleKey, 'view'));

export const canManageAdminAccess = (context: AdminAccessContext | null | undefined) => {
  if (!context || context.role !== 'level1') return false;
  return hasModuleAccess(getModuleMapFromContext(context), 'permissions', 'operate');
};

export const canReviewTerminationRequests = (context: AdminAccessContext | null | undefined) => {
  if (!context) return false;
  if (!hasModuleAccess(getModuleMapFromContext(context), 'schedule', 'operate')) return false;
  return context.role === 'level1' || context.role === 'level2';
};

export const canUnlockPunchScreen = (context: AdminAccessContext | null | undefined) => {
  if (!context) return false;
  return context.role === 'level1' || context.role === 'level2';
};
