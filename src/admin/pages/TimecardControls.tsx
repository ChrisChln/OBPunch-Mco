import StyledDateInput from '../components/StyledDateInput';

type TranslateFn = (zh: string, en: string) => string;

type TimecardControlsProps = {
  t: TranslateFn;
  isLocked: boolean;
  serverTime: Date;
  startOfWeekMonday: (date: Date) => Date;
  addDays: (date: Date, days: number) => Date;
  toDateOnly: (date: Date) => string;
  timecardWeekOffset: number;
  setTimecardWeekOffset: (value: number) => void;
  timecardWeekInput: string;
  setTimecardWeekInput: (value: string) => void;
  fetchTimecard: (payload: { reset: boolean; weekOffset?: number; search?: string; agency?: string; position?: string; lockUi?: boolean }) => void | Promise<any>;
  recomputeTimecardAttendanceMarks: () => void | Promise<void>;
  timecardRowsFilteredCount: number;
  exportTimecard: () => void | Promise<void>;
  exportDailyPunches: () => void | Promise<void>;
  timecardMissingEmployeeOnly: boolean;
  setTimecardMissingEmployeeOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  setTimecardAgency: (value: string) => void;
  setTimecardPosition: (value: string) => void;
  setTimecardSearch: (value: string) => void;
  setTimecardShift: (value: '' | 'early' | 'late') => void;
  setTimecardInProgressOnly: (value: boolean) => void;
  setTimecardPresentDayFilter: (value: number | null) => void;
  timecardSearch: string;
  timecardAgency: string;
  timecardAgencyOptions: string[];
  timecardPosition: string;
  timecardPositionOptions: readonly string[];
  timecardShift: '' | 'early' | 'late';
  timecardInProgressOnly: boolean;
  timecardError: string | null;
};

export default function TimecardControls({
  t,
  isLocked,
  serverTime,
  startOfWeekMonday,
  addDays,
  toDateOnly,
  timecardWeekOffset,
  setTimecardWeekOffset,
  timecardWeekInput,
  setTimecardWeekInput,
  fetchTimecard,
  recomputeTimecardAttendanceMarks,
  timecardRowsFilteredCount,
  exportTimecard,
  exportDailyPunches,
  timecardMissingEmployeeOnly,
  setTimecardMissingEmployeeOnly,
  setTimecardAgency,
  setTimecardPosition,
  setTimecardSearch,
  setTimecardShift,
  setTimecardInProgressOnly,
  setTimecardPresentDayFilter,
  timecardSearch,
  timecardAgency,
  timecardAgencyOptions,
  timecardPosition,
  timecardPositionOptions,
  timecardShift,
  timecardInProgressOnly,
  timecardError
}: TimecardControlsProps) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-[0.08em]">{t('时间卡', 'Timecard')}</h2>
          {(() => {
            const baseWeekStart = startOfWeekMonday(serverTime);
            const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
            const weekEnd = addDays(weekStart, 6);
            return (
              <p className="mt-2 text-xs text-slate-400">
                {t('周期：', 'Week: ')}
                <span className="text-slate-200">{toDateOnly(weekStart)}</span> ～ <span className="text-slate-200">{toDateOnly(weekEnd)}</span>
              </p>
            );
          })()}
        </div>
        <div className="flex flex-wrap gap-3">
          {(() => {
            const baseWeekStart = startOfWeekMonday(serverTime);
            return (
              <div className="flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-2">
                <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Week</span>
                <StyledDateInput
                  themeMode="dark"
                  disabled={isLocked}
                  value={timecardWeekInput}
                  onChange={(raw) => {
                    setTimecardWeekInput(raw);
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
                    const dt = new Date(`${raw}T00:00:00`);
                    if (Number.isNaN(dt.getTime())) return;
                    const targetWeekStart = startOfWeekMonday(dt);
                    const nextOffset = Math.round((targetWeekStart.getTime() - baseWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
                    setTimecardWeekOffset(nextOffset);
                    void fetchTimecard({ reset: true, weekOffset: nextOffset, lockUi: false });
                  }}
                  title={t('选择任意日期', 'Pick any date')}
                />
              </div>
            );
          })()}
          <button
            type="button"
            disabled={isLocked}
            onClick={() => {
              const next = timecardWeekOffset - 1;
              setTimecardWeekOffset(next);
              const baseWeekStart = startOfWeekMonday(serverTime);
              setTimecardWeekInput(toDateOnly(addDays(baseWeekStart, next * 7)));
              void fetchTimecard({ reset: true, weekOffset: next, lockUi: false });
            }}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('上一周', 'Prev')}
          </button>
          <button
            type="button"
            disabled={isLocked || timecardWeekOffset === 0}
            onClick={() => {
              setTimecardWeekOffset(0);
              const baseWeekStart = startOfWeekMonday(serverTime);
              setTimecardWeekInput(toDateOnly(baseWeekStart));
              void fetchTimecard({ reset: true, weekOffset: 0, lockUi: false });
            }}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('本周', 'This week')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => {
              const next = timecardWeekOffset + 1;
              setTimecardWeekOffset(next);
              const baseWeekStart = startOfWeekMonday(serverTime);
              setTimecardWeekInput(toDateOnly(addDays(baseWeekStart, next * 7)));
              void fetchTimecard({ reset: true, weekOffset: next, lockUi: false });
            }}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('下一周', 'Next')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void recomputeTimecardAttendanceMarks()}
            className="rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('刷新', 'Refresh')}
          </button>
          <button
            type="button"
            disabled={isLocked || timecardRowsFilteredCount === 0}
            onClick={() => void exportTimecard()}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('导出', 'Export')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void exportDailyPunches()}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('导出流水', 'Export punches')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => {
              setTimecardMissingEmployeeOnly((prev) => {
                const next = !prev;
                if (next) {
                  setTimecardAgency('');
                  setTimecardPosition('');
                }
                return next;
              });
            }}
            className={[
              'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
              timecardMissingEmployeeOnly ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/25' : 'bg-white/10 text-slate-200 hover:bg-white/15'
            ].join(' ')}
          >
            {timecardMissingEmployeeOnly ? t('显示全部时间卡', 'Show all timecards') : t('三无员工', 'Missing employee info')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => {
              setTimecardSearch('');
              setTimecardAgency('');
              setTimecardPosition('');
              setTimecardShift('');
              setTimecardInProgressOnly(false);
              setTimecardPresentDayFilter(null);
              setTimecardMissingEmployeeOnly(false);
              void fetchTimecard({ reset: true, search: '', agency: '', position: '', lockUi: false });
            }}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('清空筛选', 'Clear filters')}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
          <input
            value={timecardSearch}
            onChange={(e) => setTimecardSearch(e.target.value)}
            disabled={isLocked}
            placeholder={t('通过名字和USid搜索', 'Search by name or staff id')}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Agency</label>
          <select
            value={timecardAgency}
            onChange={(e) => setTimecardAgency(e.target.value)}
            disabled={isLocked || timecardMissingEmployeeOnly}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">{t('全部Agency', 'All agencies')}</option>
            {timecardAgencyOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Position</label>
          <select
            value={timecardPosition}
            onChange={(e) => setTimecardPosition(e.target.value)}
            disabled={isLocked || timecardMissingEmployeeOnly}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">{t('全部岗位', 'All positions')}</option>
            {timecardPositionOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Shift</label>
          <select
            value={timecardShift}
            onChange={(e) => setTimecardShift((e.target.value as '' | 'early' | 'late') ?? '')}
            disabled={isLocked}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">{t('全部班次', 'All shifts')}</option>
            <option value="early">{t('早班', 'Morning')}</option>
            <option value="late">{t('晚班', 'Night')}</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex w-full cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-200 transition hover:border-white/20">
            <input
              type="checkbox"
              checked={timecardInProgressOnly}
              onChange={(e) => setTimecardInProgressOnly(e.target.checked)}
              disabled={isLocked}
              className="h-4 w-4 accent-neon"
            />
            {t('只看打卡中', 'In progress only')}
          </label>
        </div>
      </div>

      {timecardError && <p className="mt-3 text-sm text-ember">加载失败：{timecardError}</p>}
      {!timecardError && timecardRowsFilteredCount === 0 && (
        <p className="mt-3 text-sm text-slate-400">{t('暂无数据，可输入搜索/筛选或点击“刷新”。', 'No data. Use filters or click “Refresh”.')}</p>
      )}
    </>
  );
}
