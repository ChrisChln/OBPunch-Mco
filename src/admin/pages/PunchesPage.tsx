type TranslateFn = (zh: string, en: string) => string;

type PunchesPageProps = {
  t: TranslateFn;
  lang: 'zh' | 'en';
  locale: string;
  isLocked: boolean;
  punchesSearch: string;
  setPunchesSearch: (value: string) => void;
  fetchRecentPunches: (params: { search: string }) => void | Promise<void>;
  recentPunchesError: string | null;
  recentPunches: any[];
  employeeByStaffId: Record<string, any>;
};

export default function PunchesPage({
  t,
  lang,
  locale,
  isLocked,
  punchesSearch,
  setPunchesSearch,
  fetchRecentPunches,
  recentPunchesError,
  recentPunches,
  employeeByStaffId
}: PunchesPageProps) {
  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('打卡流水', 'Punch Log')}</h2>
        <button
          type="button"
          disabled={isLocked}
          onClick={() => void fetchRecentPunches({ search: punchesSearch })}
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('刷新流水', 'Refresh')}
        </button>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
          <input
            value={punchesSearch}
            onChange={(e) => setPunchesSearch(e.target.value)}
            disabled={isLocked}
            placeholder={t('通过姓名或工号搜索', 'Search by name or staff id')}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            disabled={isLocked || punchesSearch.trim().length === 0}
            onClick={() => setPunchesSearch('')}
            className="h-12 w-full rounded-2xl bg-white/10 px-6 text-base font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('清空', 'Clear')}
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        {punchesSearch.trim()
          ? lang === 'en'
            ? `Search: ${punchesSearch.trim()}`
            : `搜索：${punchesSearch.trim()}`
          : t('未搜索', 'No search (latest 30)')}
      </p>
      {recentPunchesError && (
        <p className="mt-3 text-sm text-ember">
          {t('加载失败：', 'Load failed: ')}
          {recentPunchesError}
        </p>
      )}
      {!recentPunchesError && recentPunches.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">{t('暂无数据，点击“刷新流水”。', 'No data. Click “Refresh”.')}</p>
      )}
      <div className="mt-4 space-y-2">
        {recentPunches.map((p) => {
          const staff = String(p.staff_id ?? '');
          const employee = employeeByStaffId[staff];
          const action = String(p.action ?? '');
          const createdAt = (p.created_at ?? p.inserted_at ?? p.punch_at ?? '') as string;
          const time = createdAt ? new Date(createdAt).toLocaleString(locale, { hour12: false }) : '';
          const isIn = action.toUpperCase() === 'IN';
          return (
            <div key={String(p.id ?? `${staff}-${action}-${time}`)} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={['font-display text-xl', isIn ? 'text-mint' : 'text-ember'].join(' ')}>{action}</span>
                <span className="text-sm text-slate-200">{staff}</span>
                {employee && (
                  <span className="text-xs text-slate-400">
                    {employee.name || '-'} {employee.agency ? `(${employee.agency})` : ''}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400">{time}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

