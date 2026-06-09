import StyledDateInput from '../components/StyledDateInput';

type TranslateFn = (zh: string, en: string) => string;
type TimecardShiftFilter = 'early' | 'late';
type MultiSelectOption<Value extends string = string> = {
  value: Value;
  label: string;
};

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
  fetchTimecard: (payload: { reset: boolean; weekOffset?: number; search?: string; agency?: string[]; position?: string[]; lockUi?: boolean }) => void | Promise<any>;
  refreshTimecardWithAudit: (source: string) => void | Promise<void>;
  timecardRowsFilteredCount: number;
  exportTimecard: () => void | Promise<void>;
  exportDailyPunches: () => void | Promise<void>;
  timecardMissingEmployeeOnly: boolean;
  setTimecardMissingEmployeeOnly: (value: boolean | ((prev: boolean) => boolean)) => void;
  setTimecardAgency: (value: string[]) => void;
  setTimecardPosition: (value: string[]) => void;
  setTimecardSearch: (value: string) => void;
  setTimecardShift: (value: TimecardShiftFilter[]) => void;
  setTimecardInProgressOnly: (value: boolean) => void;
  setTimecardPresentDayFilter: (value: number | null) => void;
  timecardSearch: string;
  timecardAgency: string[];
  timecardAgencyOptions: string[];
  timecardPosition: string[];
  timecardPositionOptions: readonly string[];
  timecardShift: TimecardShiftFilter[];
  timecardInProgressOnly: boolean;
  timecardError: string | null;
};

function buildMultiSelectLabel(allLabel: string, selected: string[]) {
  if (selected.length === 0) return allLabel;
  if (selected.length === 1) return selected[0];
  return `${selected.length} selected`;
}

function TimecardMultiSelect<Value extends string>({
  label,
  allLabel,
  selected,
  options,
  onChange,
  disabled,
  isLight,
  controlClass
}: {
  label: string;
  allLabel: string;
  selected: Value[];
  options: readonly MultiSelectOption<Value>[];
  onChange: (value: Value[]) => void;
  disabled: boolean;
  isLight: boolean;
  controlClass: string;
}) {
  const selectedSet = new Set(selected);
  const menuClass = [
    'absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-2xl border p-2 shadow-2xl',
    isLight ? 'border-slate-200 bg-white text-slate-900 shadow-slate-200/70' : 'border-white/10 bg-[#11161f] text-white shadow-black/40'
  ].join(' ');
  const optionClass = (active: boolean) =>
    [
      'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
      active
        ? isLight
          ? 'bg-sky-50 text-sky-900'
          : 'bg-sky-500/15 text-sky-100'
        : isLight
          ? 'text-slate-700 hover:bg-slate-100'
          : 'text-slate-200 hover:bg-white/10'
    ].join(' ');

  const toggleValue = (value: Value) => {
    onChange(selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <div className="relative">
      <label className={['text-xs uppercase tracking-[0.25em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{label}</label>
      <details className="group">
        <summary
          aria-disabled={disabled}
          className={[
            controlClass,
            'flex cursor-pointer list-none items-center justify-between gap-3 truncate',
            disabled ? 'pointer-events-none cursor-not-allowed opacity-60' : ''
          ].join(' ')}
        >
          <span className="truncate">{buildMultiSelectLabel(allLabel, selected)}</span>
          <span className={['text-xs transition group-open:rotate-180', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>v</span>
        </summary>
        <div className={menuClass}>
          <button
            type="button"
            className={optionClass(selected.length === 0)}
            onClick={() => onChange([])}
          >
            <input type="checkbox" checked={selected.length === 0} readOnly className="h-4 w-4 accent-neon" />
            <span className="truncate">{allLabel}</span>
          </button>
          {options.map((option) => {
            const active = selectedSet.has(option.value);
            return (
              <button
                type="button"
                key={option.value}
                className={optionClass(active)}
                onClick={() => toggleValue(option.value)}
              >
                <input type="checkbox" checked={active} readOnly className="h-4 w-4 accent-neon" />
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}

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
    'admin-btn admin-btn-toolbar inline-flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-60',
    isLight ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100' : 'admin-btn-secondary'
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
            className="admin-btn admin-btn-toolbar admin-btn-primary inline-flex items-center justify-center px-5 disabled:cursor-not-allowed disabled:opacity-50"
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
                  setTimecardAgency([]);
                  setTimecardPosition([]);
                }
                return next;
              });
            }}
            className={[
              'admin-btn admin-btn-toolbar inline-flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-60',
              timecardMissingEmployeeOnly
                ? isLight
                  ? 'border border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200'
                  : 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/25'
                : isLight
                  ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  : 'admin-btn-secondary'
            ].join(' ')}
          >
            {timecardMissingEmployeeOnly ? t('显示全部打卡', 'Show all timecards') : t('缺少员工信息', 'Missing employee info')}
          </button>

          <button
            type="button"
            disabled={isLocked}
            onClick={() => {
              setTimecardSearch('');
              setTimecardAgency([]);
              setTimecardPosition([]);
              setTimecardShift([]);
              setTimecardInProgressOnly(false);
              setTimecardPresentDayFilter(null);
              setTimecardMissingEmployeeOnly(false);
              void fetchTimecard({ reset: true, search: '', agency: [], position: [], lockUi: false });
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

        <TimecardMultiSelect
          label="Agency"
          allLabel={t('全部 Agency', 'All agencies')}
          selected={timecardAgency}
          options={timecardAgencyOptions.map((agency) => ({ value: agency, label: agency }))}
          onChange={setTimecardAgency}
            disabled={isLocked || timecardMissingEmployeeOnly}
          isLight={isLight}
          controlClass={controlInputClass}
        />

        <TimecardMultiSelect
          label="Position"
          allLabel={t('全部岗位', 'All positions')}
          selected={timecardPosition}
          options={timecardPositionOptions.map((position) => ({ value: position, label: position }))}
          onChange={setTimecardPosition}
            disabled={isLocked || timecardMissingEmployeeOnly}
          isLight={isLight}
          controlClass={controlInputClass}
        />

        <TimecardMultiSelect
          label="Shift"
          allLabel={t('全部班次', 'All shifts')}
          selected={timecardShift}
          options={[
            { value: 'early', label: t('早班', 'Morning') },
            { value: 'late', label: t('晚班', 'Night') }
          ]}
          onChange={setTimecardShift}
          disabled={isLocked}
          isLight={isLight}
          controlClass={controlInputClass}
        />

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
