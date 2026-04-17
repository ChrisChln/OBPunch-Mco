import StyledDateInput from './StyledDateInput';

type TranslateFn = (zh: string, en: string) => string;

type ScheduleToolbarProps = {
  t: TranslateFn;
  isLocked: boolean;
  isReadOnly?: boolean;
  scheduleWeekOffset: number;
  changeScheduleWeek: (value: number, source: string) => void;
  openScheduleDailyList: (source: string) => void;
  schedulePrintDate: string;
  setSchedulePrintDate: (value: string) => void;
  scheduleEmployeesFilteredLength: number;
  printScheduleSignInSheet: () => void;
  exportScheduleTemplate: () => void | Promise<void>;
  refreshSchedulePanelWithAudit: (source: string) => void | Promise<void>;
};

export default function ScheduleToolbar({
  t,
  isLocked,
  isReadOnly = false,
  scheduleWeekOffset,
  changeScheduleWeek,
  openScheduleDailyList,
  schedulePrintDate,
  setSchedulePrintDate,
  scheduleEmployeesFilteredLength,
  printScheduleSignInSheet,
  exportScheduleTemplate,
  refreshSchedulePanelWithAudit
}: ScheduleToolbarProps) {
  const writeLocked = isLocked || isReadOnly;
  const actionButtonClass =
    'admin-btn admin-btn-toolbar inline-flex min-w-[108px] items-center justify-center disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('排班', 'Schedule')}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={writeLocked}
          onClick={() => changeScheduleWeek(scheduleWeekOffset - 1, 'toolbar_prev')}
          className={[actionButtonClass, 'admin-btn-secondary'].join(' ')}
        >
          {t('上一周', 'Prev')}
        </button>

        <button
          type="button"
          disabled={writeLocked}
          onClick={() => changeScheduleWeek(0, 'toolbar_this_week')}
          className={[actionButtonClass, 'admin-btn-secondary'].join(' ')}
        >
          {t('本周', 'This week')}
        </button>

        <button
          type="button"
          disabled={writeLocked}
          onClick={() => changeScheduleWeek(scheduleWeekOffset + 1, 'toolbar_next')}
          className={[actionButtonClass, 'admin-btn-secondary'].join(' ')}
        >
          {t('下一周', 'Next')}
        </button>

        <button
          type="button"
          disabled={writeLocked}
          onClick={() => openScheduleDailyList('toolbar_daily_list')}
          className={[actionButtonClass, 'admin-btn-secondary'].join(' ')}
        >
          {t('明日名单', 'Tomorrow list')}
        </button>

        <StyledDateInput
          themeMode="dark"
          value={schedulePrintDate}
          disabled={writeLocked}
          onChange={setSchedulePrintDate}
          title={t('签到表日期', 'Sign-in print date')}
        />

        <button
          type="button"
          disabled={writeLocked || scheduleEmployeesFilteredLength === 0}
          onClick={printScheduleSignInSheet}
          className={[actionButtonClass, 'admin-btn-secondary'].join(' ')}
        >
          {t('打印签到表', 'Print sign-in')}
        </button>

        <button
          type="button"
          disabled={writeLocked || scheduleEmployeesFilteredLength === 0}
          onClick={() => void exportScheduleTemplate()}
          className={[actionButtonClass, 'admin-btn-secondary'].join(' ')}
        >
          {t('导出排班', 'Export schedule')}
        </button>

        <button
          type="button"
          disabled={writeLocked}
          onClick={() => void refreshSchedulePanelWithAudit('toolbar_refresh')}
          className={[
            actionButtonClass,
            'admin-btn-primary disabled:opacity-50'
          ].join(' ')}
        >
          {t('刷新', 'Refresh')}
        </button>
      </div>
    </div>
  );
}
