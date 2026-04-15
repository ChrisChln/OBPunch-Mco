import StyledDateInput from '../components/StyledDateInput';

type TranslateFn = (zh: string, en: string) => string;

type TimecardControlsProps = {
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  isLocked: boolean;
  serverTime: Date;
  startOfWeekMonday: (date: Date) => Date;
  addDays: (date: Date, days: number) => Date;
  toDateOnly: (date: Date) => string;
  timecardWeekOffset: number;
  changeTimecardWeek: (value: number, source: string) => void | Promise<void>;
  timecardWeekInput: string;
  setTimecardWeekInput: (value: string) => void;
  fetchTimecard: (payload: { reset: boolean; weekOffset?: number; search?: string; agency?: string; position?: string; lockUi?: boolean }) => void | Promise<any>;
  refreshTimecardWithAudit: (source: string) => void | Promise<void>;
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
  themeMode,
  isLocked,
  serverTime,
  startOfWeekMonday,
  addDays,
  toDateOnly,
  timecardWeekOffset,
  changeTimecardWeek,
  timecardWeekInput,
  setTimecardWeekInput,
  fetchTimecard,
  refreshTimecardWithAudit,
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
  const isLight = themeMode === 'light';
  const ghostButtonClass = [
    'h-9 rounded-2xl px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
    isLight ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100' : 'bg-white/10 text-slate-200 hover:bg-white/15'
  ].join(' ');
  const controlInputClass = [
    'mt-2 w-full rounded-2xl border px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
    isLight
      ? 'border-slate-300 bg-white text-slate-900 focus:border-neon/60'
      : 'border-white/10 bg-black/30 text-white focus:border-neon focus:shadow-glow'
  ].join(' ');

  const baseWeekStart = startOfWeekMonday(serverTime);
  const visibleWeekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
  const visibleWeekEnd = addDays(visibleWeekStart, 6);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl tracking-[0.08em]">{t('打卡', 'Timecard')}</h2>
          <p className={['mt-2 text-xs', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
            {t('周:', 'Week: ')}
            <span className={isLight ? 'text-slate-800' : 'text-slate-200'}>{toDateOnly(visibleWeekStart)}</span>
            <span>{' - '}</span>
            <span className={isLight ? 'text-slate-800' : 'text-slate-200'}>{toDateOnly(visibleWeekEnd)}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className={['flex h-9 items-center gap-1 rounded-lg px-2', isLight ? 'border border-slate-200 bg-slate-100' : 'bg-white/5'].join(' ')}>
            <span className={['text-[10px] uppercase tracking-[0.2em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>Week</span>
            <StyledDateInput
              themeMode={themeMode}
              size="compact"
              disabled={isLocked}
              value={timecardWeekInput}
              onChange={(raw) => {
                setTimecardWeekInput(raw);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
                const dt = new Date(`${raw}T00:00:00`);
                if (Number.isNaN(dt.getTime())) return;
                const targetWeekStart = startOfWeekMonday(dt);
                const nextOffset = Math.round((targetWeekStart.getTime() - baseWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
                void changeTimecardWeek(nextOffset, 'date_input');
              }}
              title={t('选择任意日期', 'Pick any date')}
            />
          </div>

          <button
            type="button"
            disabled={isLocked}
            onClick={() => void changeTimecardWeek(timecardWeekOffset - 1, 'toolbar_prev')}
            className={ghostButtonClass}
          >
            {t('上一周', 'Prev')}
          </button>

          <button
            type="button"
            disabled={isLocked || timecardWeekOffset === 0}
            onClick={() => void changeTimecardWeek(0, 'toolbar_this_week')}
            className={ghostButtonClass}
          >
            {t('本周', 'This week')}
          </button>

          <button
            type="button"
            disabled={isLocked}
            onClick={() => void changeTimecardWeek(timecardWeekOffset + 1, 'toolbar_next')}
            className={ghostButtonClass}
          >
            {t('下一周', 'Next')}
          </button>

          <button
            type="button"
            disabled={isLocked}
            onClick={() => void refreshTimecardWithAudit('toolbar_refresh')}
            className="h-9 rounded-2xl bg-neon px-5 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('刷新', 'Refresh')}
          </button>

          <button
            type="button"
            disabled={isLocked || timecardRowsFilteredCount === 0}
            onClick={() => void exportTimecard()}
            className={ghostButtonClass}
          >
            {t('导出', 'Export')}
          </button>

          <button
            type="button"
            disabled={isLocked}
            onClick={() => void exportDailyPunches()}
            className={ghostButtonClass}
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
              'h-9 rounded-2xl px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
              timecardMissingEmployeeOnly
                ? isLight
                  ? 'border border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200'
                  : 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/25'
                : isLight
                  ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  : 'bg-white/10 text-slate-200 hover:bg-white/15'
            ].join(' ')}
          >
            {timecardMissingEmployeeOnly ? t('显示全部打卡', 'Show all timecards') : t('缺少员工信息', 'Missing employee info')}
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
            className={ghostButtonClass}
          >
            {t('清空筛选', 'Clear filters')}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>Search</label>
          <input
            value={timecardSearch}
            onChange={(e) => setTimecardSearch(e.target.value)}
            disabled={isLocked}
            placeholder={t('按姓名或工号搜索', 'Search by name or staff id')}
            className={controlInputClass}
          />
        </div>

        <div>
          <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>Agency</label>
          <select
            value={timecardAgency}
            onChange={(e) => setTimecardAgency(e.target.value)}
            disabled={isLocked || timecardMissingEmployeeOnly}
            className={controlInputClass}
          >
            <option value="">{t('全部 Agency', 'All agencies')}</option>
            {timecardAgencyOptions.map((agency) => (
              <option key={agency} value={agency}>
                {agency}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>Position</label>
          <select
            value={timecardPosition}
            onChange={(e) => setTimecardPosition(e.target.value)}
            disabled={isLocked || timecardMissingEmployeeOnly}
            className={controlInputClass}
          >
            <option value="">{t('全部岗位', 'All positions')}</option>
            {timecardPositionOptions.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>Shift</label>
          <select
            value={timecardShift}
            onChange={(e) => setTimecardShift((e.target.value as '' | 'early' | 'late') ?? '')}
            disabled={isLocked}
            className={controlInputClass}
          >
            <option value="">{t('全部班次', 'All shifts')}</option>
            <option value="early">{t('早班', 'Morning')}</option>
            <option value="late">{t('晚班', 'Night')}</option>
          </select>
        </div>

        <div className="flex items-end">
          <label
            className={[
              'flex w-full cursor-pointer items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition',
              isLight
                ? 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                : 'border-white/10 bg-black/30 text-slate-200 hover:border-white/20'
            ].join(' ')}
          >
            <input
              type="checkbox"
              checked={timecardInProgressOnly}
              onChange={(e) => setTimecardInProgressOnly(e.target.checked)}
              disabled={isLocked}
              className="h-4 w-4 accent-neon"
            />
            {t('只看进行中', 'In progress only')}
          </label>
        </div>
      </div>

      {timecardError && <p className="mt-3 text-sm text-ember">{timecardError}</p>}
      {!timecardError && timecardRowsFilteredCount === 0 && (
        <p className="mt-3 text-sm text-slate-400">{t('暂无数据，可使用筛选或点击刷新。', 'No data. Use filters or click Refresh.')}</p>
      )}
    </>
  );
}
