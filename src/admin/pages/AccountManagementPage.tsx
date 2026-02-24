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
  accountRowsFiltered: AccountRow[];
  accountRowsRendered: AccountRow[];
  accountRenderCount: number;
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
  accountRowsFiltered,
  accountRowsRendered,
  accountRenderCount,
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
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('Account Management', 'Account Management')}</h2>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15">
            {t('Import Accounts', 'Import Accounts')}
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
            {t('Export Accounts', 'Export Accounts')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void onRefreshEmployees()}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('Refresh', 'Refresh')}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-6">
        <div className="md:col-span-3">
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('Search', 'Search')}</label>
          <input
            value={accountSearch}
            onChange={(e) => setAccountSearch(e.target.value)}
            disabled={isLocked}
            placeholder={t('Search by account / name / staff id', 'Search by account / name / staff id')}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      </div>

      {!accountRowsFiltered.length ? (
        <p className="mt-4 text-sm text-slate-400">{t('No account rows', 'No account rows')}</p>
      ) : null}

      <div className="mt-5 max-h-[68vh] overflow-auto rounded-2xl border border-white/10 bg-black/30" onScroll={onScroll}>
        <table className="min-w-[1080px] w-full text-left text-sm">
          <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-[0.2em] text-slate-400 backdrop-blur">
            <tr>
              <th className="px-4 py-3">USID</th>
              <th className="px-4 py-3">{t('Name', 'Name')}</th>
              <th className="px-4 py-3">Agency</th>
              <th className="px-4 py-3">{t('Position', 'Position')}</th>
              <th className="px-4 py-3">{t('Work account', 'Work account')}</th>
              <th className="px-4 py-3">{t('Work password', 'Work password')}</th>
              <th className="px-4 py-3 text-right">{t('Actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {accountRowsRendered.map((row) => (
              <tr key={`${row.staff}__${row.workAccount}__${row.workPassword}`} className="border-b border-white/5 transition-colors hover:bg-white/5 last:border-0">
                <td className="px-4 py-3 font-mono text-slate-200">{row.staff}</td>
                <td className="px-4 py-3 text-slate-200">{row.name || '-'}</td>
                <td className="px-4 py-3 text-slate-200">{row.agency || '-'}</td>
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
                      ? t('Generating...', 'Generating...')
                      : t('Print account', 'Print account')}
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
            `Showing ${accountRowsRendered.length}/${accountRowsFiltered.length}. Scroll to load more`,
            `Showing ${accountRowsRendered.length}/${accountRowsFiltered.length}. Scroll to load more`
          )}
        </div>
      )}
      {accountRenderCount > 0 && accountRowsFiltered.length > 0 && (
        <div className="mt-1 text-xs text-slate-500">{t('Print size: 4 x 2 inch label.', 'Print size: 4 x 2 inch label.')}</div>
      )}
    </section>
  );
}

