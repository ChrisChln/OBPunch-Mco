import { useEffect, useMemo, useState } from 'react';
import AdminAccessManagementSection from './AdminAccessManagementSection';
import {
  ADMIN_MODULE_KEYS,
  getDefaultModuleAccess,
  type AdminAccessContext,
  type AdminModuleAccessLevel,
  type AdminModuleKey,
  type AdminRole
} from '../../shared/adminAccess';
import AdminUserAvatar from '../components/AdminUserAvatar';
import type { AdminUserIdentityView } from '../adminIdentity';
import type {
  AdminAccessAccountRecord,
  AdminAccessRequestCreatePayload,
  AdminAccessRequestRecord,
  AdminAccessSavePayload,
  AdminAccessUserOption
} from '../adminAccessApi';

type TranslateFn = (zh: string, en: string) => string;

type AdminPermissionsPageProps = {
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  isLocked: boolean;
  canManage: boolean;
  accessContext: AdminAccessContext | null;
  accessRows: AdminAccessAccountRecord[];
  userOptions: AdminAccessUserOption[];
  agencyOptions: string[];
  requestRows: AdminAccessRequestRecord[];
  resolveAdminUserIdentity: (input: {
    userId?: string | null;
    userEmail?: string | null;
    actor?: unknown;
    displayName?: string | null;
  }) => AdminUserIdentityView;
  onRefreshAccess: () => void | Promise<void>;
  onSaveAccess: (payload: AdminAccessSavePayload) => void | Promise<void>;
  onRefreshRequests: () => void | Promise<void>;
  onCreateRequest: (payload: AdminAccessRequestCreatePayload) => void | Promise<void>;
  onReviewRequest: (request: AdminAccessRequestRecord, action: 'approve' | 'reject') => void | Promise<void>;
};

const ROLE_OPTIONS: AdminRole[] = ['level1', 'level2', 'level3', 'agency'];
const ACCESS_OPTIONS: AdminModuleAccessLevel[] = ['hidden', 'view', 'operate'];

const MODULE_LABELS: Record<AdminModuleKey, { zh: string; en: string }> = {
  package_metrics: { zh: '日报', en: 'Daily' },
  consumables: { zh: '耗材', en: 'Consumables' },
  home: { zh: '首页', en: 'Home' },
  employees: { zh: '员工', en: 'Employees' },
  accounts: { zh: '账号', en: 'Accounts' },
  permissions: { zh: '权限', en: 'Permissions' },
  timecard: { zh: '时间卡', en: 'Timecard' },
  leave_approval: { zh: '请假审批', en: 'Leave Approval' },
  work_hour_comparison: { zh: '工时对比', en: 'Work Hour Comparison' },
  todo: { zh: '待办', en: 'Todo' },
  punches: { zh: '打卡流水', en: 'Punches' },
  audit: { zh: '日志', en: 'Audit' },
  schedule: { zh: '排班', en: 'Schedule' },
  devices: { zh: '设备', en: 'Devices' },
  forecast: { zh: '件量预测', en: 'Forecast' },
  prediction_model: { zh: '预测模型', en: 'Prediction Model' },
  efficiency: { zh: '人效', en: 'Efficiency' },
  agency: { zh: 'Agency', en: 'Agency' }
};

const buildDefaultModuleState = (role: AdminRole) =>
  ADMIN_MODULE_KEYS.map((moduleKey) => ({
    module_key: moduleKey,
    access_level: getDefaultModuleAccess(role, moduleKey)
  }));

const buildModuleSummary = (
  modules: Array<{ module_key: AdminModuleKey; access_level: AdminModuleAccessLevel }>
) => ({
  operate: modules.filter((item) => item.access_level === 'operate').length,
  view: modules.filter((item) => item.access_level === 'view').length,
  hidden: modules.filter((item) => item.access_level === 'hidden').length
});

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return String(value);
  return time.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const buildFormStateFromContext = (context: AdminAccessContext | null) => {
  if (!context) {
    return {
      requestedRole: 'level3' as AdminRole,
      requestedManagedAgencies: [] as string[],
      requestedModules: buildDefaultModuleState('level3')
    };
  }

  return {
    requestedRole: context.role,
    requestedManagedAgencies: [...context.managed_agencies],
    requestedModules: context.modules.map((module) => ({
      module_key: module.module_key,
      access_level: module.access_level
    }))
  };
};

export default function AdminPermissionsPage({
  t,
  themeMode,
  isLocked,
  canManage,
  accessContext,
  accessRows,
  userOptions,
  agencyOptions,
  requestRows,
  resolveAdminUserIdentity,
  onRefreshAccess,
  onSaveAccess,
  onRefreshRequests,
  onCreateRequest,
  onReviewRequest
}: AdminPermissionsPageProps) {
  const isLight = themeMode === 'light';
  const [requestedRole, setRequestedRole] = useState<AdminRole>('level3');
  const [requestedManagedAgencies, setRequestedManagedAgencies] = useState<string[]>([]);
  const [requestedModules, setRequestedModules] = useState<
    Array<{ module_key: AdminModuleKey; access_level: AdminModuleAccessLevel }>
  >(buildDefaultModuleState('level3'));
  const [reason, setReason] = useState('');
  const [savingRequest, setSavingRequest] = useState(false);

  useEffect(() => {
    const nextState = buildFormStateFromContext(accessContext);
    setRequestedRole(nextState.requestedRole);
    setRequestedManagedAgencies(nextState.requestedManagedAgencies);
    setRequestedModules(nextState.requestedModules);
  }, [accessContext]);

  const pendingOwnRequest = useMemo(
    () =>
      requestRows.find(
        (row) => row.status === 'pending' && row.requester_user_id === String(accessContext?.user_id ?? '').trim()
      ) ?? null,
    [accessContext?.user_id, requestRows]
  );

  const currentModuleSummary = useMemo(
    () =>
      buildModuleSummary(
        (accessContext?.modules ?? []).map((module) => ({
          module_key: module.module_key,
          access_level: module.access_level
        }))
      ),
    [accessContext?.modules]
  );

  const refreshAll = async () => {
    await Promise.all([onRefreshRequests(), canManage ? onRefreshAccess() : Promise.resolve()]);
  };
  const resolveRequestIdentity = (row: AdminAccessRequestRecord) =>
    resolveAdminUserIdentity({
      userId: row.requester_user_id,
      userEmail: row.requester_user_email,
      displayName: row.requester_display_name
    });

  const toggleAgency = (agency: string) => {
    setRequestedManagedAgencies((prev) =>
      prev.includes(agency)
        ? prev.filter((item) => item !== agency)
        : [...prev, agency].sort((left, right) => left.localeCompare(right, 'en-US'))
    );
  };

  const setModuleAccess = (moduleKey: AdminModuleKey, accessLevel: AdminModuleAccessLevel) => {
    setRequestedModules((prev) =>
      prev.map((module) => (module.module_key === moduleKey ? { ...module, access_level: accessLevel } : module))
    );
  };

  const applyRequestedRoleDefaults = (nextRole: AdminRole = requestedRole) => {
    setRequestedModules(buildDefaultModuleState(nextRole));
  };

  const submitRequest = async () => {
    if (savingRequest || pendingOwnRequest) return;
    setSavingRequest(true);
    try {
      await onCreateRequest({
        requested_role: requestedRole,
        requested_managed_agencies: requestedManagedAgencies,
        requested_modules: requestedModules,
        reason
      });
      setReason('');
    } finally {
      setSavingRequest(false);
    }
  };

  const renderStatusPill = (status: 'pending' | 'approved' | 'rejected') => {
    const className =
      status === 'approved'
        ? isLight
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
        : status === 'rejected'
          ? isLight
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          : isLight
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-200';

    return (
      <span
        className={[
          'inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]',
          className
        ].join(' ')}
      >
        {status}
      </span>
    );
  };

  return (
    <section className="space-y-6">
      {canManage ? (
        <AdminAccessManagementSection
          t={t}
          themeMode={themeMode}
          isLocked={isLocked}
          rows={accessRows}
          userOptions={userOptions}
          agencyOptions={agencyOptions}
          onRefresh={onRefreshAccess}
          onSave={onSaveAccess}
        />
      ) : (
        <section className="px-6 py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl tracking-[0.08em]">{t('当前权限', 'Current Access')}</h2>
            <button
              type="button"
              disabled={isLocked}
              onClick={() => void onRefreshRequests()}
              className={[
                'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                isLight
                  ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  : 'bg-white/10 text-slate-200 hover:bg-white/15'
              ].join(' ')}
            >
              {t('刷新', 'Refresh')}
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <div className={['rounded-2xl border p-4', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
              <div className={['text-xs uppercase tracking-[0.2em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                {t('角色', 'Role')}
              </div>
              <div className={['mt-2 text-xl font-semibold', isLight ? 'text-slate-900' : 'text-slate-100'].join(' ')}>
                {accessContext?.role ?? '-'}
              </div>
            </div>
            <div className={['rounded-2xl border p-4', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
              <div className={['text-xs uppercase tracking-[0.2em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                {t('可操作', 'Operate')}
              </div>
              <div className={['mt-2 text-xl font-semibold', isLight ? 'text-slate-900' : 'text-slate-100'].join(' ')}>
                {currentModuleSummary.operate}
              </div>
            </div>
            <div className={['rounded-2xl border p-4', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
              <div className={['text-xs uppercase tracking-[0.2em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                {t('只读', 'View')}
              </div>
              <div className={['mt-2 text-xl font-semibold', isLight ? 'text-slate-900' : 'text-slate-100'].join(' ')}>
                {currentModuleSummary.view}
              </div>
            </div>
            <div className={['rounded-2xl border p-4', isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'].join(' ')}>
              <div className={['text-xs uppercase tracking-[0.2em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                Agency
              </div>
              <div className={['mt-2 text-xl font-semibold', isLight ? 'text-slate-900' : 'text-slate-100'].join(' ')}>
                {accessContext?.managed_agencies?.length ? accessContext.managed_agencies.join(', ') : t('全部', 'All')}
              </div>
            </div>
          </div>
        </section>
      )}

      {!canManage ? (
        <section className="px-6 py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl tracking-[0.08em]">{t('权限申请', 'Request Access')}</h2>
            {pendingOwnRequest ? renderStatusPill('pending') : null}
          </div>

          {pendingOwnRequest ? (
            <p className={['mt-4 text-sm', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
              {t('当前已有待审批申请，审批前不能重复提交。', 'A pending request already exists.')}
            </p>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label>
              <div className={['text-xs uppercase tracking-[0.2em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>
                {t('申请角色', 'Requested Role')}
              </div>
              <select
                value={requestedRole}
                onChange={(event) => setRequestedRole(event.target.value as AdminRole)}
                disabled={isLocked || savingRequest || Boolean(pendingOwnRequest)}
                className={[
                  'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                  isLight
                    ? 'border border-slate-200 bg-white text-slate-900 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                    : 'border border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
                ].join(' ')}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <div className={['text-xs uppercase tracking-[0.2em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>
                {t('原因', 'Reason')}
              </div>
              <input
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={isLocked || savingRequest || Boolean(pendingOwnRequest)}
                placeholder={t('填写申请原因', 'Reason')}
                className={[
                  'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                  isLight
                    ? 'border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                    : 'border border-white/10 bg-black/30 text-white placeholder:text-slate-500 focus:border-neon focus:shadow-glow'
                ].join(' ')}
              />
            </label>
          </div>

          <div className="mt-6">
            <div className={['text-xs uppercase tracking-[0.2em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>
              {t('Agency 范围', 'Agency Scope')}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {agencyOptions.map((agency) => {
                const active = requestedManagedAgencies.includes(agency);
                return (
                  <button
                    key={agency}
                    type="button"
                    onClick={() => toggleAgency(agency)}
                    disabled={isLocked || savingRequest || Boolean(pendingOwnRequest)}
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
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <div className={['text-xs uppercase tracking-[0.2em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>
                {t('模块权限', 'Modules')}
              </div>
              <button
                type="button"
                disabled={isLocked || savingRequest || Boolean(pendingOwnRequest)}
                onClick={() => applyRequestedRoleDefaults()}
                className={[
                  'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                  isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                ].join(' ')}
              >
                {t('应用默认', 'Apply Defaults')}
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {requestedModules.map((module) => (
                <label
                  key={module.module_key}
                  className={[
                    'rounded-2xl border p-3',
                    isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/[0.03]'
                  ].join(' ')}
                >
                  <div className={['text-sm font-semibold', isLight ? 'text-slate-900' : 'text-slate-100'].join(' ')}>
                    {t(MODULE_LABELS[module.module_key].zh, MODULE_LABELS[module.module_key].en)}
                  </div>
                  <select
                    value={module.access_level}
                    onChange={(event) => setModuleAccess(module.module_key, event.target.value as AdminModuleAccessLevel)}
                    disabled={isLocked || savingRequest || Boolean(pendingOwnRequest)}
                    className={[
                      'mt-2 h-10 w-full rounded-xl px-3 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                      isLight
                        ? 'border border-slate-200 bg-white text-slate-900 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                        : 'border border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
                    ].join(' ')}
                  >
                    {ACCESS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              disabled={isLocked || savingRequest || Boolean(pendingOwnRequest)}
              onClick={() => void submitRequest()}
              className="rounded-2xl bg-neon px-6 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingRequest ? t('提交中...', 'Submitting...') : t('提交申请', 'Submit')}
            </button>
          </div>
        </section>
      ) : null}

      <section className="px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl tracking-[0.08em]">
            {canManage ? t('权限审批', 'Approvals') : t('申请记录', 'Requests')}
          </h2>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void refreshAll()}
            className={[
              'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
              isLight
                ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                : 'bg-white/10 text-slate-200 hover:bg-white/15'
            ].join(' ')}
          >
            {t('刷新', 'Refresh')}
          </button>
        </div>

        {!requestRows.length ? (
          <p className={['mt-4 text-sm', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
            {t('暂无申请记录', 'No requests')}
          </p>
        ) : null}

        <div className="mt-5 overflow-auto rounded-2xl border border-white/10 bg-black/30">
          <table className="min-w-[1180px] w-full text-left text-sm">
            <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-[0.2em] text-slate-400 backdrop-blur">
              <tr>
                <th className="px-4 py-3">{t('账号', 'User')}</th>
                <th className="px-4 py-3">{t('申请角色', 'Role')}</th>
                <th className="px-4 py-3">Agency</th>
                <th className="px-4 py-3">{t('模块', 'Modules')}</th>
                <th className="px-4 py-3">{t('原因', 'Reason')}</th>
                <th className="px-4 py-3">{t('状态', 'Status')}</th>
                <th className="px-4 py-3">{t('时间', 'Time')}</th>
                <th className="px-4 py-3 text-right">{t('操作', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {requestRows.map((row) => {
                const summary = buildModuleSummary(row.requested_modules);
                const canReview = canManage && row.status === 'pending';
                const requesterIdentity = resolveRequestIdentity(row);
                return (
                  <tr key={row.id} className="border-b border-white/5 transition-colors hover:bg-white/5 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <AdminUserAvatar
                          name={requesterIdentity.displayName}
                          avatarUrl={requesterIdentity.avatarUrl}
                          fallbackInitial={requesterIdentity.fallbackInitial}
                          size={28}
                          className={isLight ? 'border-slate-200 bg-slate-200 text-slate-700' : 'border-white/10 bg-slate-800 text-slate-100'}
                        />
                        <div className="min-w-0">
                          <div className={['truncate', isLight ? 'text-slate-900' : 'text-slate-100'].join(' ')}>
                            {requesterIdentity.displayName}
                          </div>
                          <div className={['truncate text-xs', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                            {row.requester_user_email || row.requester_user_id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full border border-neon/40 bg-neon/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-neon">
                        {row.requested_role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.requested_managed_agencies.length ? row.requested_managed_agencies.join(', ') : t('全部', 'All')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
                          {t('可操作', 'Operate')} {summary.operate}
                        </span>
                        <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-200">
                          {t('只读', 'View')} {summary.view}
                        </span>
                        <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-xs text-slate-200">
                          {t('隐藏', 'Hidden')} {summary.hidden}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className={['max-w-[260px] truncate', isLight ? 'text-slate-700' : 'text-slate-300'].join(' ')}>
                        {row.reason || '-'}
                      </div>
                      {row.review_note ? (
                        <div className={['mt-1 text-xs', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                          {t('审批', 'Review')}: {row.review_note}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{renderStatusPill(row.status)}</td>
                    <td className="px-4 py-3">
                      <div>{formatDateTime(row.created_at)}</div>
                      {row.reviewed_at ? (
                        <div className={['mt-1 text-xs', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                          {row.reviewed_by_display_name || '-'} · {formatDateTime(row.reviewed_at)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {canReview ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => void onReviewRequest(row, 'approve')}
                            className="rounded-2xl bg-neon px-4 py-2 text-xs font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t('批准', 'Approve')}
                          </button>
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => void onReviewRequest(row, 'reject')}
                            className={[
                              'rounded-2xl px-4 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                              isLight
                                ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                : 'bg-white/10 text-slate-200 hover:bg-white/15'
                            ].join(' ')}
                          >
                            {t('拒绝', 'Reject')}
                          </button>
                        </div>
                      ) : (
                        <div className="text-right text-xs text-slate-400">-</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
