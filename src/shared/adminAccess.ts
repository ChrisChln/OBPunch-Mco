export const ADMIN_MODULE_KEYS = [
  'home',
  'package_metrics',
  'consumables',
  'employee_upload',
  'employees',
  'accounts',
  'permissions',
  'timecard',
  'leave_approval',
  'work_hour_comparison',
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
export type PositionScopedModuleKey = 'employees' | 'schedule' | 'timecard';
export type PositionScopeMode = 'all' | 'selected';

export type AdminAccessModule = {
  module_key: AdminModuleKey;
  access_level: AdminModuleAccessLevel;
};

export type AdminPositionScopeEntry = {
  position: string;
  access_level: Exclude<AdminModuleAccessLevel, 'hidden'>;
};

export type AdminPositionScope = {
  mode: PositionScopeMode;
  positions: AdminPositionScopeEntry[];
};

export type AdminPositionScopes = Record<PositionScopedModuleKey, AdminPositionScope>;

export type AdminAccessContext = {
  user_id: string;
  role: AdminRole;
  is_active: boolean;
  managed_agencies: string[];
  modules: AdminAccessModule[];
  position_scopes: AdminPositionScopes;
};

export const DEFAULT_LEVEL1_EMAIL = 'lnchen4201@gmail.com';

const ADMIN_ROLE_VALUES: AdminRole[] = ['level1', 'level2', 'level3', 'agency'];
const ADMIN_ACCESS_LEVEL_VALUES: AdminModuleAccessLevel[] = ['hidden', 'view', 'operate'];
export const POSITION_SCOPED_MODULE_KEYS: PositionScopedModuleKey[] = ['employees', 'schedule', 'timecard'];

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

const normalizePositionScopeAccessLevel = (value: unknown): Exclude<AdminModuleAccessLevel, 'hidden'> =>
  normalizeModuleAccessLevel(value) === 'operate' ? 'operate' : 'view';

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

const emptyAllPositionScopes = (): AdminPositionScopes => ({
  employees: { mode: 'all', positions: [] },
  schedule: { mode: 'all', positions: [] },
  timecard: { mode: 'all', positions: [] }
});

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
        const normalizedModuleKey = module_key as AdminModuleKey;
        const nestedAccess =
          access_level && typeof access_level === 'object'
            ? (access_level as Record<string, unknown>).access_level
            : access_level;
        return {
          module_key: normalizedModuleKey,
          access_level: normalizeModuleAccessLevel(nestedAccess)
        };
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

export const normalizePositionScopesForContext = (value: unknown): AdminPositionScopes => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return emptyAllPositionScopes();
    try {
      return normalizePositionScopesForContext(JSON.parse(trimmed));
    } catch {
      return emptyAllPositionScopes();
    }
  }

  const source = isPlainObject(value) ? value : {};
  const normalized = emptyAllPositionScopes();

  for (const moduleKey of POSITION_SCOPED_MODULE_KEYS) {
    const rawScope = source[moduleKey];
    if (!isPlainObject(rawScope)) continue;

    const mode = String(rawScope.mode ?? '').trim().toLowerCase() === 'selected' ? 'selected' : 'all';
    const seen = new Set<string>();
    const positions = (Array.isArray(rawScope.positions) ? rawScope.positions : [])
      .map((entry) => {
        if (!isPlainObject(entry)) return null;
        const position = String(entry.position ?? entry.name ?? '').trim().replace(/\s+/g, ' ');
        if (!position) return null;
        const dedupeKey = position.toLowerCase();
        if (seen.has(dedupeKey)) return null;
        seen.add(dedupeKey);
        return {
          position,
          access_level: normalizePositionScopeAccessLevel(entry.access_level)
        };
      })
      .filter((entry): entry is AdminPositionScopeEntry => Boolean(entry));

    normalized[moduleKey] = {
      mode: mode === 'selected' && positions.length > 0 ? 'selected' : 'all',
      positions: mode === 'selected' ? positions : []
    };
  }

  return normalized;
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

export const hasPositionAccess = (
  context: AdminAccessContext | null | undefined,
  moduleKey: PositionScopedModuleKey,
  position: unknown,
  required: Exclude<AdminModuleAccessLevel, 'hidden'> = 'view'
) => {
  if (!context || !context.is_active) return false;
  if (!hasModuleAccess(getModuleMapFromContext(context), moduleKey, required)) return false;

  const scope = context.position_scopes?.[moduleKey] ?? { mode: 'all', positions: [] };
  if (scope.mode === 'all') return true;

  const normalizedPosition = String(position ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalizedPosition) return false;
  const entry = scope.positions.find((item) => item.position.trim().toLowerCase() === normalizedPosition);
  if (!entry) return false;
  if (required === 'operate') return entry.access_level === 'operate';
  return entry.access_level === 'view' || entry.access_level === 'operate';
};

export const filterRowsByPositionAccess = <T>(
  context: AdminAccessContext | null | undefined,
  moduleKey: PositionScopedModuleKey,
  rows: T[],
  getPosition: (row: T) => unknown,
  required: Exclude<AdminModuleAccessLevel, 'hidden'> = 'view'
) => rows.filter((row) => hasPositionAccess(context, moduleKey, getPosition(row), required));

export const normalizeAdminAccessContext = (
  payload: unknown,
  fallbackEmail?: string | null
): AdminAccessContext => {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const role = normalizeAdminRole(raw.role, fallbackEmail);
  const isActive = Boolean(raw.is_active ?? true);
  const managedAgencies = parseJsonArray(raw.managed_agencies)
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  const hasModulesField = Object.prototype.hasOwnProperty.call(raw, 'modules');
  const { modules: moduleEntries, malformed } = normalizeModuleEntries(raw.modules);
  const moduleMap =
    !isActive || (hasModulesField && malformed && moduleEntries.length === 0)
      ? buildHiddenModuleMap()
      : buildEffectiveModuleMap(role, moduleEntries);

  return {
    user_id: String(raw.user_id ?? '').trim(),
    role,
    is_active: isActive,
    managed_agencies: managedAgencies,
    modules: ADMIN_MODULE_KEYS.map((moduleKey) => ({
      module_key: moduleKey,
      access_level: moduleMap[moduleKey]
    })),
    position_scopes: normalizePositionScopesForContext(raw.position_scopes)
  };
};

const buildHiddenModuleMap = () =>
  Object.fromEntries(ADMIN_MODULE_KEYS.map((moduleKey) => [moduleKey, 'hidden'])) as Record<
    AdminModuleKey,
    AdminModuleAccessLevel
  >;

export const getModuleMapFromContext = (context: AdminAccessContext | null | undefined) =>
  context && context.is_active ? buildEffectiveModuleMap(context.role, context.modules ?? []) : buildHiddenModuleMap();

export const getVisibleModules = (context: AdminAccessContext | null | undefined) =>
  ADMIN_MODULE_KEYS.filter((moduleKey) => hasModuleAccess(getModuleMapFromContext(context), moduleKey, 'view'));

export const canManageAdminAccess = (context: AdminAccessContext | null | undefined) => {
  if (!context || context.role !== 'level1') return false;
  return hasModuleAccess(getModuleMapFromContext(context), 'permissions', 'operate');
};

export const canReviewTerminationRequests = (context: AdminAccessContext | null | undefined) => {
  if (!context) return false;
  if (!hasModuleAccess(getModuleMapFromContext(context), 'schedule', 'operate')) return false;
  return context.role === 'level1' || context.role === 'level2' || context.role === 'level3';
};

export const canUnlockPunchScreen = (context: AdminAccessContext | null | undefined) => {
  if (!context) return false;
  return context.role === 'level1' || context.role === 'level2';
};


