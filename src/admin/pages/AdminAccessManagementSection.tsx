import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  ADMIN_MODULE_KEYS,
  getDefaultModuleAccess,
  normalizeAdminRole,
  type AdminModuleAccessLevel,
  type AdminModuleKey,
  type AdminRole
} from '../../shared/adminAccess';
import type {
  AdminAccessAccountRecord,
  AdminAccessSavePayload,
  AdminAccessUserOption
} from '../adminAccessApi';

type TranslateFn = (zh: string, en: string) => string;

type AdminAccessManagementSectionProps = {
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  isLocked: boolean;
  rows: AdminAccessAccountRecord[];
  userOptions: AdminAccessUserOption[];
  agencyOptions: string[];
  onRefresh: () => void | Promise<void>;
  onSave: (payload: AdminAccessSavePayload) => void | Promise<void>;
};

type EditingState = {
  mode: 'create' | 'edit';
  row: AdminAccessAccountRecord | null;
};

const ROLE_OPTIONS: AdminRole[] = ['level1', 'level2', 'level3', 'agency'];
const ACCESS_OPTIONS: AdminModuleAccessLevel[] = ['hidden', 'view', 'operate'];

const MODULE_LABELS: Record<AdminModuleKey, { zh: string; en: string }> = {
  home: { zh: '首页', en: 'Home' },
  employees: { zh: '员工', en: 'Employees' },
  accounts: { zh: '账号', en: 'Accounts' },
  timecard: { zh: '时间卡', en: 'Timecard' },
  leave_approval: { zh: '请假审批', en: 'Leave' },
  todo: { zh: '待办', en: 'Todo' },
  punches: { zh: '打卡流水', en: 'Punches' },
  audit: { zh: '日志', en: 'Audit' },
  schedule: { zh: '排班', en: 'Schedule' },
  devices: { zh: '设备', en: 'Devices' },
  forecast: { zh: '件量预测', en: 'Forecast' },
  prediction_model: { zh: '预测模型', en: 'Model' },
  efficiency: { zh: '人效', en: 'Efficiency' },
  permissions: { zh: '权限', en: 'Permissions' },
  agency: { zh: 'Agency', en: 'Agency' }
};

const buildDefaultModuleState = (role: AdminRole) =>
  ADMIN_MODULE_KEYS.map((moduleKey) => ({
    module_key: moduleKey,
    access_level: getDefaultModuleAccess(role, moduleKey)
  }));

const normalizeDisplayName = (user: AdminAccessUserOption | null) =>
  user ? user.display_name || user.user_email || user.user_id : '';

export default function AdminAccessManagementSection({
  t,
  themeMode,
  isLocked,
  rows,
  userOptions,
  agencyOptions,
  onRefresh,
  onSave
}: AdminAccessManagementSectionProps) {
  const isLight = themeMode === 'light';
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [role, setRole] = useState<AdminRole>('agency');
  const [isActive, setIsActive] = useState(true);
  const [managedAgencies, setManagedAgencies] = useState<string[]>([]);
  const [modules, setModules] = useState<Array<{ module_key: AdminModuleKey; access_level: AdminModuleAccessLevel }>>(
    buildDefaultModuleState('agency')
  );
  const [searchKeyword, setSearchKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | AdminRole>('all');
  const [saving, setSaving] = useState(false);

  const mergedRows = useMemo(() => {
    const explicitRowMap = new Map(rows.map((row) => [row.user_id, row] as const));
    const merged = userOptions.map((user) => {
      const explicitRow = explicitRowMap.get(user.user_id);
      if (explicitRow) return explicitRow;

      const nextRole = normalizeAdminRole('', user.user_email);
      return {
        user_id: user.user_id,
        user_email: user.user_email,
        display_name: user.display_name,
        role: nextRole,
        is_active: true,
        managed_agencies: [],
        modules: buildDefaultModuleState(nextRole)
      } satisfies AdminAccessAccountRecord;
    });

    const knownUserIds = new Set(merged.map((row) => row.user_id));
    for (const row of rows) {
      if (!knownUserIds.has(row.user_id)) merged.push(row);
    }

    return merged.sort((left, right) => {
      const leftLabel = (left.display_name || left.user_email || left.user_id).trim().toLowerCase();
      const rightLabel = (right.display_name || right.user_email || right.user_id).trim().toLowerCase();
      return leftLabel.localeCompare(rightLabel, 'en-US');
    });
  }, [rows, userOptions]);

  const existingUserIds = useMemo(() => new Set(mergedRows.map((row) => row.user_id)), [mergedRows]);

  const selectableUsers = useMemo(
    () => userOptions.filter((option) => editing?.mode === 'edit' || !existingUserIds.has(option.user_id)),
    [editing?.mode, existingUserIds, userOptions]
  );

  const normalizedSearchKeyword = searchKeyword.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    return mergedRows.filter((row) => {
      if (roleFilter !== 'all' && row.role !== roleFilter) return false;
      if (!normalizedSearchKeyword) return true;
      const searchable = [
        row.display_name,
        row.user_email,
        row.user_id,
        row.role,
        row.managed_agencies.join(' ')
      ]
        .join(' ')
        .toLowerCase();
      return searchable.includes(normalizedSearchKeyword);
    });
  }, [mergedRows, normalizedSearchKeyword, roleFilter]);

  useEffect(() => {
    if (!editing) return;
    const sourceRow = editing.row;
    setSelectedUserId(sourceRow?.user_id ?? '');
    setRole(sourceRow?.role ?? 'agency');
    setIsActive(sourceRow?.is_active ?? true);
    setManagedAgencies(sourceRow?.managed_agencies ?? []);
    setModules(
      sourceRow?.modules?.length
        ? sourceRow.modules.map((module) => ({
            module_key: module.module_key,
            access_level: module.access_level
          }))
        : buildDefaultModuleState(sourceRow?.role ?? 'agency')
    );
  }, [editing]);

  const closeModal = () => {
    if (saving) return;
    setEditing(null);
  };

  const toggleAgency = (agency: string) => {
    setManagedAgencies((prev) =>
      prev.includes(agency)
        ? prev.filter((item) => item !== agency)
        : [...prev, agency].sort((a, b) => a.localeCompare(b, 'en-US'))
    );
  };

  const setModuleAccess = (moduleKey: AdminModuleKey, accessLevel: AdminModuleAccessLevel) => {
    setModules((prev) =>
      prev.map((module) => (module.module_key === moduleKey ? { ...module, access_level: accessLevel } : module))
    );
  };

  const applyRoleDefaults = (nextRole: AdminRole = role) => {
    setModules(buildDefaultModuleState(nextRole));
  };

  const applyAllModuleAccess = (nextAccess: AdminModuleAccessLevel) => {
    setModules((prev) => prev.map((module) => ({ ...module, access_level: nextAccess })));
  };

  const moduleSummary = useMemo(
    () => ({
      operate: modules.filter((module) => module.access_level === 'operate').length,
      view: modules.filter((module) => module.access_level === 'view').length,
      hidden: modules.filter((module) => module.access_level === 'hidden').length
    }),
    [modules]
  );

  const submit = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      await onSave({
        user_id: selectedUserId,
        role,
        is_active: isActive,
        managed_agencies: managedAgencies,
        modules
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const modal =
    editing && typeof document !== 'undefined'
      ? createPortal(
          <div
            className={[
              'fixed inset-0 z-40 flex items-center justify-center overflow-y-auto px-4 py-10',
              isLight ? 'bg-slate-900/35' : 'bg-black/60'
            ].join(' ')}
          >
            <div
              className={[
                'w-full max-w-5xl rounded-3xl border p-6 shadow-2xl',
                isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/90 backdrop-blur'
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                    {editing.mode === 'create' ? t('新增权限', 'New Access') : t('编辑权限', 'Edit Access')}
                  </div>
                  <div className={['mt-2 text-sm', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                    {editing.mode === 'edit'
                      ? normalizeDisplayName(userOptions.find((option) => option.user_id === selectedUserId) ?? null) || selectedUserId
                      : t('配置角色、模块和 Agency 范围', 'Set role, modules, and agency scope')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className={[
                    'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                    isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  ].join(' ')}
                >
                  {t('关闭', 'Close')}
                </button>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div>
                  <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>
                    {t('账号', 'User')}
                  </label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    disabled={saving || editing.mode === 'edit'}
                    className={[
                      'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                      isLight
                        ? 'border border-slate-200 bg-white text-slate-900 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                        : 'border border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
                    ].join(' ')}
                  >
                    <option value="">{t('选择账号', 'Select user')}</option>
                    {selectableUsers.map((option) => (
                      <option key={option.user_id} value={option.user_id}>
                        {option.display_name || option.user_email} {option.user_email ? `(${option.user_email})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>
                    {t('角色', 'Role')}
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as AdminRole)}
                    disabled={saving}
                    className={[
                      'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                      isLight
                        ? 'border border-slate-200 bg-white text-slate-900 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                        : 'border border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
                    ].join(' ')}
                  >
                    {ROLE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <label
                    className={[
                      'flex h-11 w-full items-center justify-between rounded-2xl border px-4 text-sm',
                      isLight ? 'border-slate-200 bg-white text-slate-900' : 'border-white/10 bg-black/30 text-white'
                    ].join(' ')}
                  >
                    <span>{t('启用', 'Active')}</span>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      disabled={saving}
                      className="h-4 w-4 rounded border-slate-400 text-neon focus:ring-neon"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-6">
                <div className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>
                  {t('Agency 范围', 'Agency Scope')}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {agencyOptions.map((agency) => {
                    const active = managedAgencies.includes(agency);
                    return (
                      <button
                        key={agency}
                        type="button"
                        onClick={() => toggleAgency(agency)}
                        disabled={saving}
                        className={[
                          'rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                          active
                            ? isLight
                              ? 'border-neon/60 bg-neon/15 text-slate-900'
                              : 'border-neon/60 bg-neon/20 text-neon'
                            : isLight
                              ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                              : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                        ].join(' ')}
                      >
                        {agency}
                      </button>
                    );
                  })}
                  {!agencyOptions.length && (
                    <span className={isLight ? 'text-sm text-slate-500' : 'text-sm text-slate-400'}>
                      {t('暂无 Agency', 'No agencies')}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>
                      {t('模块权限', 'Modules')}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className={[
                          'rounded-full border px-2.5 py-1 text-xs font-semibold',
                          isLight
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                        ].join(' ')}
                      >
                        {t('可操作', 'Operate')} {moduleSummary.operate}
                      </span>
                      <span
                        className={[
                          'rounded-full border px-2.5 py-1 text-xs font-semibold',
                          isLight ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-sky-400/40 bg-sky-500/10 text-sky-200'
                        ].join(' ')}
                      >
                        {t('只读', 'View')} {moduleSummary.view}
                      </span>
                      <span
                        className={[
                          'rounded-full border px-2.5 py-1 text-xs font-semibold',
                          isLight
                            ? 'border-slate-300 bg-slate-100 text-slate-700'
                            : 'border-slate-400/30 bg-slate-500/10 text-slate-300'
                        ].join(' ')}
                      >
                        {t('隐藏', 'Hidden')} {moduleSummary.hidden}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => applyAllModuleAccess('hidden')}
                      disabled={saving}
                      className={[
                        'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                        isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      ].join(' ')}
                    >
                      {t('全部隐藏', 'All Hidden')}
                    </button>
                    <button
                      type="button"
                      onClick={() => applyAllModuleAccess('view')}
                      disabled={saving}
                      className={[
                        'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                        isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      ].join(' ')}
                    >
                      {t('全部只读', 'All View')}
                    </button>
                    <button
                      type="button"
                      onClick={() => applyAllModuleAccess('operate')}
                      disabled={saving}
                      className={[
                        'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                        isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      ].join(' ')}
                    >
                      {t('全部可操作', 'All Operate')}
                    </button>
                    <button
                      type="button"
                      onClick={() => applyRoleDefaults()}
                      disabled={saving}
                      className={[
                        'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                        isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      ].join(' ')}
                    >
                      {t('应用默认', 'Apply Defaults')}
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {modules.map((module) => (
                    <div
                      key={module.module_key}
                      className={[
                        'rounded-2xl border p-3',
                        isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'
                      ].join(' ')}
                    >
                      <div className={['text-sm font-semibold', isLight ? 'text-slate-900' : 'text-slate-100'].join(' ')}>
                        {t(MODULE_LABELS[module.module_key].zh, MODULE_LABELS[module.module_key].en)}
                      </div>
                      <div
                        className={[
                          'mt-2 grid grid-cols-3 gap-1 rounded-xl p-1',
                          isLight ? 'bg-white border border-slate-200' : 'bg-black/30 border border-white/10'
                        ].join(' ')}
                      >
                        {ACCESS_OPTIONS.map((option) => {
                          const selected = module.access_level === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => setModuleAccess(module.module_key, option)}
                              disabled={saving}
                              className={[
                                'rounded-lg px-2 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                                selected
                                  ? option === 'operate'
                                    ? 'bg-emerald-500 text-white'
                                    : option === 'view'
                                      ? 'bg-sky-500 text-white'
                                      : 'bg-slate-600 text-white'
                                  : isLight
                                    ? 'text-slate-600 hover:bg-slate-100'
                                    : 'text-slate-300 hover:bg-white/10'
                              ].join(' ')}
                            >
                              {option === 'operate'
                                ? t('可操作', 'Operate')
                                : option === 'view'
                                  ? t('只读', 'View')
                                  : t('隐藏', 'Hidden')}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className={[
                    'rounded-2xl px-5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                    isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  ].join(' ')}
                >
                  {t('取消', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={saving || !selectedUserId}
                  className={[
                    'rounded-2xl bg-neon px-6 py-2 text-sm font-semibold shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50',
                    isLight ? 'text-slate-900' : 'text-white'
                  ].join(' ')}
                >
                  {saving ? t('保存中...', 'Saving...') : t('保存', 'Save')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('权限分配', 'Access')}</h2>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as 'all' | AdminRole)}
            className={[
              'h-10 rounded-2xl px-4 text-sm outline-none transition',
              isLight
                ? 'border border-slate-300 bg-white text-slate-900 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                : 'border border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
            ].join(' ')}
          >
            <option value="all">{t('全部角色', 'All Roles')}</option>
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder={t('搜索账号 / 邮箱 / Agency', 'Search user / email / agency')}
            className={[
              'h-10 w-full max-w-xs rounded-2xl px-4 text-sm outline-none transition',
              isLight
                ? 'border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                : 'border border-white/10 bg-black/30 text-white placeholder:text-slate-500 focus:border-neon focus:shadow-glow'
            ].join(' ')}
          />
          <button
            type="button"
            disabled={isLocked}
            onClick={() => setEditing({ mode: 'create', row: null })}
            className="hidden rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('新增账号', 'New Access')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void onRefresh()}
            className={[
              'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
              isLight ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100' : 'bg-white/10 text-slate-200 hover:bg-white/15'
            ].join(' ')}
          >
            {t('刷新', 'Refresh')}
          </button>
        </div>
      </div>

      {!filteredRows.length ? (
        <p className={['mt-4 text-sm', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
          {normalizedSearchKeyword || roleFilter !== 'all'
            ? t('没有匹配的账号', 'No matching rows')
            : t('暂无权限账号', 'No access rows')}
        </p>
      ) : null}

      <div className="mt-5 overflow-auto rounded-2xl border border-white/10 bg-black/30">
        <table className="min-w-[1080px] w-full text-left text-sm">
          <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-[0.2em] text-slate-400 backdrop-blur">
            <tr>
              <th className="px-4 py-3">{t('账号', 'User')}</th>
              <th className="px-4 py-3">{t('角色', 'Role')}</th>
              <th className="px-4 py-3">Agency</th>
              <th className="px-4 py-3">{t('模块', 'Modules')}</th>
              <th className="px-4 py-3">{t('状态', 'Status')}</th>
              <th className="px-4 py-3 text-right">{t('操作', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const operateCount = row.modules.filter((module) => module.access_level === 'operate').length;
              const viewCount = row.modules.filter((module) => module.access_level === 'view').length;
              const hiddenCount = row.modules.filter((module) => module.access_level === 'hidden').length;

              return (
                <tr key={row.user_id} className="border-b border-white/5 transition-colors hover:bg-white/5 last:border-0">
                  <td className="px-4 py-3">
                    <div className={isLight ? 'text-slate-900' : 'text-slate-100'}>{row.display_name || '-'}</div>
                    <div className={['text-xs', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                      {row.user_email || row.user_id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        'inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]',
                        isLight
                          ? 'border-lime-400 bg-lime-100 text-lime-800'
                          : 'border-neon/40 bg-neon/10 text-neon'
                      ].join(' ')}
                    >
                      {row.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-200">
                    {row.managed_agencies.length ? row.managed_agencies.join(', ') : t('全部', 'All')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={[
                          'rounded-full border px-2.5 py-1 text-xs font-semibold',
                          isLight
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                        ].join(' ')}
                      >
                        {t('可操作', 'Operate')} {operateCount}
                      </span>
                      <span
                        className={[
                          'rounded-full border px-2.5 py-1 text-xs font-semibold',
                          isLight ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-sky-400/40 bg-sky-500/10 text-sky-200'
                        ].join(' ')}
                      >
                        {t('只读', 'View')} {viewCount}
                      </span>
                      <span
                        className={[
                          'rounded-full border px-2.5 py-1 text-xs font-semibold',
                          isLight
                            ? 'border-slate-300 bg-slate-100 text-slate-700'
                            : 'border-slate-400/30 bg-slate-500/10 text-slate-300'
                        ].join(' ')}
                      >
                        {t('隐藏', 'Hidden')} {hiddenCount}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        'inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold',
                        row.is_active
                          ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                          : 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                      ].join(' ')}
                    >
                      {row.is_active ? t('启用', 'Active') : t('停用', 'Disabled')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setEditing({ mode: 'edit', row })}
                      className="rounded-2xl bg-white/10 px-4 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('编辑', 'Edit')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal}
    </section>
  );
}
