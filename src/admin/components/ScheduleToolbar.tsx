import StyledDateInput from './StyledDateInput';

type TranslateFn = (zh: string, en: string) => string;

type ScheduleToolbarProps = {
  t: TranslateFn;
  isLocked: boolean;
  schedulePublishTomorrow: boolean;
  schedulePublishForDate: string;
  setSchedulePublishSetting: (value: boolean) => void | Promise<void>;
  scheduleWeekOffset: number;
  setScheduleWeekOffset: (value: number) => void;
  setScheduleWeekInput: (value: string) => void;
  serverTime: Date;
  startOfWeekMonday: (value: Date) => Date;
  toDateOnly: (value: Date) => string;
  addDays: (value: Date, days: number) => Date;
  setDailyListDateInput: (value: string) => void;
  setDailyListFilterPositions: (value: any) => void;
  createEmptyPositionFlags: () => any;
  loadDailyListSelectedPositionsGlobal: (arg?: { targetDateOverride?: string }) => void | Promise<void>;
  setDailyListOpen: (value: boolean) => void;
  schedulePrintDate: string;
  setSchedulePrintDate: (value: string) => void;
  scheduleEmployeesFilteredLength: number;
  printScheduleSignInSheet: () => void;
  exportScheduleTemplate: () => void | Promise<void>;
  refreshSchedulePanel: () => void | Promise<void>;
};

export default function ScheduleToolbar({
  t,
  isLocked,
  schedulePublishTomorrow,
  setSchedulePublishSetting,
  scheduleWeekOffset,
  setScheduleWeekOffset,
  setScheduleWeekInput,
  serverTime,
  startOfWeekMonday,
  toDateOnly,
  addDays,
  setDailyListDateInput,
  setDailyListFilterPositions,
  createEmptyPositionFlags,
  loadDailyListSelectedPositionsGlobal,
  setDailyListOpen,
  schedulePrintDate,
  setSchedulePrintDate,
  scheduleEmployeesFilteredLength,
  printScheduleSignInSheet,
  exportScheduleTemplate,
  refreshSchedulePanel
}: ScheduleToolbarProps) {
  const actionButtonClass =
    'inline-flex h-10 min-w-[104px] items-center justify-center rounded-2xl px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('排班', 'Schedule')}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isLocked}
          onClick={() => void setSchedulePublishSetting(!schedulePublishTomorrow)}
          className={[
            `${actionButtonClass} min-w-[136px] font-semibold`,
            schedulePublishTomorrow
              ? 'border border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
              : 'bg-white/10 text-slate-200 hover:bg-white/15'
          ].join(' ')}
          title={t('手动发布明日名单', 'Manual publish tomorrow roster')}
        >
          {schedulePublishTomorrow
            ? t(`明日名单已开启`, `Tomorrow list ON`)
            : t('明日名单已关闭', 'Tomorrow list OFF')}
        </button>

        <button
          type="button"
          disabled={isLocked}
          onClick={() => {
            const next = scheduleWeekOffset - 1;
            setScheduleWeekOffset(next);
            const baseWeekStart = startOfWeekMonday(serverTime);
            setScheduleWeekInput(toDateOnly(addDays(baseWeekStart, next * 7)));
          }}
          className={[actionButtonClass, 'bg-white/10 text-slate-200 hover:bg-white/15'].join(' ')}
        >
          {t('上一周', 'Prev')}
        </button>

        <button
          type="button"
          disabled={isLocked}
          onClick={() => {
            setScheduleWeekOffset(0);
            const baseWeekStart = startOfWeekMonday(serverTime);
            setScheduleWeekInput(toDateOnly(baseWeekStart));
          }}
          className={[actionButtonClass, 'bg-white/10 text-slate-200 hover:bg-white/15'].join(' ')}
        >
          {t('本周', 'This week')}
        </button>

        <button
          type="button"
          disabled={isLocked}
          onClick={() => {
            const next = scheduleWeekOffset + 1;
            setScheduleWeekOffset(next);
            const baseWeekStart = startOfWeekMonday(serverTime);
            setScheduleWeekInput(toDateOnly(addDays(baseWeekStart, next * 7)));
          }}
          className={[actionButtonClass, 'bg-white/10 text-slate-200 hover:bg-white/15'].join(' ')}
        >
          {t('下一周', 'Next')}
        </button>

        <button
          type="button"
          disabled={isLocked}
          onClick={() => {
            const targetDate = toDateOnly(addDays(new Date(serverTime), 1));
            setDailyListDateInput(targetDate);
            setDailyListFilterPositions(createEmptyPositionFlags());
            void loadDailyListSelectedPositionsGlobal({ targetDateOverride: targetDate });
            setDailyListOpen(true);
          }}
          className={[actionButtonClass, 'bg-white/10 text-slate-200 hover:bg-white/15'].join(' ')}
        >
          {t('每日名单', 'Daily list')}
        </button>

        <StyledDateInput
          themeMode="dark"
          value={schedulePrintDate}
          disabled={isLocked}
          onChange={setSchedulePrintDate}
          title={t('打印签到表日期', 'Sign-in print date')}
        />

        <button
          type="button"
          disabled={isLocked || scheduleEmployeesFilteredLength === 0}
          onClick={printScheduleSignInSheet}
          className={[actionButtonClass, 'bg-white/10 text-slate-200 hover:bg-white/15'].join(' ')}
        >
          {t('打印签到表', 'Print sign-in')}
        </button>

        <button
          type="button"
          disabled={isLocked || scheduleEmployeesFilteredLength === 0}
          onClick={() => void exportScheduleTemplate()}
          className={[actionButtonClass, 'bg-white/10 text-slate-200 hover:bg-white/15'].join(' ')}
        >
          {t('导出排班', 'Export schedule')}
        </button>

        <button
          type="button"
          disabled={isLocked}
          onClick={() => void refreshSchedulePanel()}
          className={[
            actionButtonClass,
            'bg-neon font-semibold text-white shadow-glow hover:-translate-y-0.5 hover:shadow-2xl disabled:opacity-50'
          ].join(' ')}
        >
          {t('刷新', 'Refresh')}
        </button>
      </div>
    </div>
  );
}
