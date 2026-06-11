import type { UIEvent } from 'react';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type TranslateFn = (zh: string, en: string) => string;

type AccountRow = {
  staff: string;
  name: string;
  agency: string;
  position: string;
  workAccount: string;
  workPassword: string;
  isTemp?: boolean;
};

type AccountManagementPageProps = {
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  isLocked: boolean;
  isReadOnly?: boolean;
  accountSearch: string;
  setAccountSearch: (value: string) => void;
  accountDepartmentFilter: string[];
  setAccountDepartmentFilter: (value: string[]) => void;
  accountDepartmentOptions: Array<{ value: string; label: string }>;
  accountPositionFilter: string;
  setAccountPositionFilter: (value: string) => void;
  accountPositionOptions: string[];
  accountRowsFiltered: AccountRow[];
  accountRowsRendered: AccountRow[];
  setAccountRenderCount: (value: number | ((prev: number) => number)) => void;
  onRefreshEmployees: () => void | Promise<void>;
  onDownloadTemplate: () => void | Promise<void>;
  onImportAccounts: (file: File | null) => void | Promise<void>;
  onExportAccounts: () => void | Promise<void>;
  accountCardPrintingStaffId: string | null;
  onPrintAccountCard: (row: AccountRow) => void | Promise<void>;
  onEditAccount: (
    row: AccountRow,
    payload: { name: string; position: string; workAccount: string; workPassword: string }
  ) => void | Promise<void>;
};

export default function AccountManagementPage({
  t,
  themeMode,
  isLocked,
  isReadOnly = false,
  accountSearch,
  setAccountSearch,
  accountDepartmentFilter,
  setAccountDepartmentFilter,
  accountDepartmentOptions,
  accountPositionFilter,
  setAccountPositionFilter,
  accountPositionOptions,
  accountRowsFiltered,
  accountRowsRendered,
  setAccountRenderCount,
  onRefreshEmployees,
  onDownloadTemplate,
  onImportAccounts,
  onExportAccounts,
  accountCardPrintingStaffId,
  onPrintAccountCard,
  onEditAccount
}: AccountManagementPageProps) {
  const isLight = themeMode === 'light';
  const writeLocked = isLocked || isReadOnly;
  const [editingRow, setEditingRow] = useState<AccountRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editWorkAccount, setEditWorkAccount] = useState('');
  const [editWorkPassword, setEditWorkPassword] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    if (!editingRow) return;
    setEditName(String(editingRow.name ?? '').trim());
    setEditPosition(String(editingRow.position ?? '').trim());
    setEditWorkAccount(String(editingRow.workAccount ?? '').trim());
    setEditWorkPassword(String(editingRow.workPassword ?? '').trim());
  }, [editingRow]);

  const canSubmitEdit = useMemo(
    () => Boolean(editingRow && editWorkAccount.trim() && editWorkPassword.trim()),
    [editingRow, editWorkAccount, editWorkPassword]
  );

  const closeEditModal = () => {
    if (editSaving) return;
    setEditingRow(null);
  };

  const submitEdit = async () => {
    if (!editingRow || !canSubmitEdit) return;
    setEditSaving(true);
    try {
      await onEditAccount(editingRow, {
        name: editName.trim(),
        position: editPosition.trim(),
        workAccount: editWorkAccount.trim(),
        workPassword: editWorkPassword.trim()
      });
      setEditingRow(null);
    } finally {
      setEditSaving(false);
    }
  };

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 48) return;
    setAccountRenderCount((prev) => {
      if (prev >= accountRowsFiltered.length) return prev;
      return Math.min(prev + 120, accountRowsFiltered.length);
    });
  };

  const editModal =
    editingRow && typeof document !== 'undefined'
      ? createPortal(
          <div className={['fixed inset-0 z-40 flex items-center justify-center overflow-y-auto px-4 py-10', isLight ? 'bg-slate-900/35' : 'bg-black/60'].join(' ')}>
            <div
              className={[
                'w-full max-w-4xl rounded-3xl border p-6 shadow-2xl',
                isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/90 backdrop-blur'
              ].join(' ')}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                    {t('编辑账号', 'Edit Account')}
                  </div>
                  <div className={['mt-2 text-sm', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                    USID: <span className={['font-mono', isLight ? 'text-slate-900' : 'text-slate-200'].join(' ')}>{editingRow.staff}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={editSaving}
                  className={[
                    'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                    isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  ].join(' ')}
                >
                  {t('关闭', 'Close')}
                </button>
              </div>

              <div className="mt-6">
                <div className={['mb-4 text-sm font-semibold uppercase tracking-[0.2em]', isLight ? 'text-slate-700' : 'text-slate-300'].join(' ')}>
                  {t('账号信息', 'Account Info')}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>{t('姓名', 'Name')}</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      disabled={editSaving || isReadOnly}
                      className={[
                        'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                        isLight
                          ? 'border border-slate-200 bg-white text-slate-900 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                          : 'border border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
                      ].join(' ')}
                    />
                  </div>
                  <div>
                    <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>{t('岗位', 'Position')}</label>
                    <input
                      value={editPosition}
                      onChange={(e) => setEditPosition(e.target.value)}
                      disabled={editSaving || isReadOnly}
                      className={[
                        'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                        isLight
                          ? 'border border-slate-200 bg-white text-slate-900 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                          : 'border border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
                      ].join(' ')}
                    />
                  </div>
                  <div>
                    <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>{t('工作账号', 'Work account')}</label>
                    <input
                      value={editWorkAccount}
                      onChange={(e) => setEditWorkAccount(e.target.value)}
                      disabled={editSaving || isReadOnly}
                      className={[
                        'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                        isLight
                          ? 'border border-slate-200 bg-white text-slate-900 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                          : 'border border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
                      ].join(' ')}
                    />
                  </div>
                  <div>
                    <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-600' : 'text-slate-400'].join(' ')}>{t('工作密码', 'Work password')}</label>
                    <input
                      value={editWorkPassword}
                      onChange={(e) => setEditWorkPassword(e.target.value)}
                      disabled={editSaving || isReadOnly}
                      className={[
                        'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
                        isLight
                          ? 'border border-slate-200 bg-white text-slate-900 focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)]'
                          : 'border border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
                      ].join(' ')}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={editSaving}
                  className={[
                    'rounded-2xl px-5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                    isLight ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  ].join(' ')}
                >
                  {t('取消', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void submitEdit()}
                  disabled={editSaving || isReadOnly || !canSubmitEdit}
                  className={[
                    'rounded-2xl bg-neon px-6 py-2 text-sm font-semibold shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50',
                    isLight ? 'text-slate-900' : 'text-white'
                  ].join(' ')}
                >
                  {editSaving ? t('保存中...', 'Saving...') : t('保存', 'Save')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <section className="px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('账号管理', 'Account Management')}</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void onDownloadTemplate()}
            className={[
              'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
              isLight ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100' : 'bg-white/10 text-slate-200 hover:bg-white/15'
            ].join(' ')}
          >
            {t('下载模板', 'Download template')}
          </button>
          <label
            className={[
              'cursor-pointer rounded-2xl px-4 py-2 text-sm font-medium transition',
              isLight ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100' : 'bg-white/10 text-slate-200 hover:bg-white/15'
            ].join(' ')}
          >
            {t('导入临时账号', 'Import Temp Accounts')}
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              disabled={writeLocked}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                void onImportAccounts(file);
                e.currentTarget.value = '';
              }}
              className="hidden"
            />
          </label>
          <button
            type="button"
            disabled={writeLocked}
            onClick={() => void onExportAccounts()}
            className={[
              'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
              isLight ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100' : 'bg-white/10 text-slate-200 hover:bg-white/15'
            ].join(' ')}
          >
            {t('导出临时账号', 'Export Temp Accounts')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void onRefreshEmployees()}
            className={[
              'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
              isLight ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100' : 'bg-white/10 text-slate-200 hover:bg-white/15'
            ].join(' ')}
          >
            {t('刷新', 'Refresh')}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-6">
        <div className="md:col-span-3">
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('搜索', 'Search')}</label>
          <input
            value={accountSearch}
            onChange={(e) => setAccountSearch(e.target.value)}
            disabled={isLocked}
            placeholder={t('按账号 / 姓名 / 工号搜索', 'Search by account / name / staff id')}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Dept</label>
          <select
            value={accountDepartmentFilter[0] ?? ''}
            onChange={(e) => setAccountDepartmentFilter(e.target.value ? [e.target.value] : [])}
            disabled={isLocked}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">{t('全部部门', 'All dept')}</option>
            {accountDepartmentOptions.map((department) => (
              <option key={department.value} value={department.value}>
                {department.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('岗位筛选', 'Position filter')}</label>
          <select
            value={accountPositionFilter}
            onChange={(e) => setAccountPositionFilter(e.target.value)}
            disabled={isLocked}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">{t('全部岗位', 'All positions')}</option>
            {accountPositionOptions.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!accountRowsFiltered.length ? (
        <p className="mt-4 text-sm text-slate-400">{t('暂无账号数据', 'No account rows')}</p>
      ) : null}

      <div className="mt-5 max-h-[68vh] overflow-auto rounded-2xl border border-white/10 bg-black/30" onScroll={onScroll}>
        <table className="min-w-[1080px] w-full text-left text-sm">
          <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-[0.2em] text-slate-400 backdrop-blur">
            <tr>
              <th className="px-4 py-3">USID</th>
              <th className="px-4 py-3">{t('姓名', 'Name')}</th>
              <th className="px-4 py-3">{t('岗位', 'Position')}</th>
              <th className="px-4 py-3">{t('工作账号', 'Work account')}</th>
              <th className="px-4 py-3">{t('工作密码', 'Work password')}</th>
              <th className="px-4 py-3 text-right">{t('操作', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {accountRowsRendered.map((row) => (
              <tr key={`${row.staff}__${row.workAccount}__${row.workPassword}`} className="border-b border-white/5 transition-colors hover:bg-white/5 last:border-0">
                <td className="px-4 py-3 font-mono text-slate-200">{row.staff}</td>
                <td className="px-4 py-3 text-slate-200">{row.name || '-'}</td>
                <td className="px-4 py-3 text-slate-200">{row.position || '-'}</td>
                <td className="px-4 py-3 text-slate-200">{row.workAccount || '-'}</td>
                <td className="px-4 py-3 text-slate-200">{row.workPassword || '-'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    disabled={writeLocked}
                    onClick={() => setEditingRow(row)}
                    className="mr-2 rounded-2xl bg-white/10 px-4 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('编辑', 'Edit')}
                  </button>
                  <button
                    type="button"
                    disabled={writeLocked || !row.workAccount || !row.workPassword || accountCardPrintingStaffId === row.staff}
                    onClick={() => void onPrintAccountCard(row)}
                    className="rounded-xl bg-neon px-4 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {accountCardPrintingStaffId === row.staff
                      ? t('生成中...', 'Generating...')
                      : t('打印账号', 'Print account')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {accountRowsRendered.length < accountRowsFiltered.length && (
        <div className="mt-2 text-xs text-slate-500">
          {t(
            `已显示 ${accountRowsRendered.length}/${accountRowsFiltered.length}，向下滚动加载更多`,
            `Showing ${accountRowsRendered.length}/${accountRowsFiltered.length}. Scroll to load more`
          )}
        </div>
      )}
      {editModal}
    </section>
  );
}
