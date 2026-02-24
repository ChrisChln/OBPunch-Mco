import type { UIEvent } from 'react';

type TranslateFn = (zh: string, en: string) => string;

type AccountRow = {
  staff: string;
  name: string;
  agency: string;
  position: string;
  workAccount: string;
  workPassword: string;
};

type AccountManagementPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  accountSearch: string;
  setAccountSearch: (value: string) => void;
  accountPositionFilter: string;
  setAccountPositionFilter: (value: string) => void;
  accountPositionOptions: string[];
  accountRowsFiltered: AccountRow[];
  accountRowsRendered: AccountRow[];
  setAccountRenderCount: (value: number | ((prev: number) => number)) => void;
  onRefreshEmployees: () => void | Promise<void>;
  onImportAccounts: (file: File | null) => void | Promise<void>;
  onExportAccounts: () => void | Promise<void>;
  accountCardPrintingStaffId: string | null;
  onPrintAccountCard: (row: AccountRow) => void | Promise<void>;
};

export default function AccountManagementPage({
  t,
  isLocked,
  accountSearch,
  setAccountSearch,
  accountPositionFilter,
  setAccountPositionFilter,
  accountPositionOptions,
  accountRowsFiltered,
  accountRowsRendered,
  setAccountRenderCount,
  onRefreshEmployees,
  onImportAccounts,
  onExportAccounts,
  accountCardPrintingStaffId,
  onPrintAccountCard
}: AccountManagementPageProps) {
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 48) return;
    setAccountRenderCount((prev) => {
      if (prev >= accountRowsFiltered.length) return prev;
      return Math.min(prev + 120, accountRowsFiltered.length);
    });
  };

  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('账号管理', 'Account Management')}</h2>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15">
            {t('导入账号', 'Import Accounts')}
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              disabled={isLocked}
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
            disabled={isLocked}
            onClick={() => void onExportAccounts()}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('导出账号', 'Export Accounts')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void onRefreshEmployees()}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
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
                    disabled={isLocked || !row.workAccount || !row.workPassword || accountCardPrintingStaffId === row.staff}
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
    </section>
  );
}

