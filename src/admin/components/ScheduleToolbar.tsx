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
  schedulePublishForDate,
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
            'rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
            schedulePublishTomorrow ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/60' : 'bg-white/10 text-slate-200 hover:bg-white/15'
          ].join(' ')}
          title={t('手动发布明日名单', 'Manual publish tomorrow roster')}
        >
          {schedulePublishTomorrow
            ? t(`明日名单已开启 (${schedulePublishForDate || '-'})`, `Tomorrow list ON (${schedulePublishForDate || '-'})`)
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
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
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
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
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
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
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
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('每日名单', 'Daily list')}
        </button>
        <input
          type="date"
          value={schedulePrintDate}
          disabled={isLocked}
          onChange={(e) => setSchedulePrintDate(e.target.value)}
          className="h-10 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          title={t('打印签到表日期', 'Sign-in print date')}
        />
        <button
          type="button"
          disabled={isLocked || scheduleEmployeesFilteredLength === 0}
          onClick={printScheduleSignInSheet}
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('打印签到表', 'Print sign-in')}
        </button>
        <button
          type="button"
          disabled={isLocked || scheduleEmployeesFilteredLength === 0}
          onClick={() => void exportScheduleTemplate()}
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('导出排班', 'Export schedule')}
        </button>
        <button
          type="button"
          disabled={isLocked}
          onClick={() => void refreshSchedulePanel()}
          className="rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('刷新', 'Refresh')}
        </button>
      </div>
    </div>
  );
}

