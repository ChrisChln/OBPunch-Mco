import type { AdminPage } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type AdminNavProps = {
  page: AdminPage;
  isLocked: boolean;
  onSetPage: (page: AdminPage) => void;
  tabClass: (active: boolean) => string;
  t: TranslateFn;
  leaveApprovalPendingCount?: number;
  todoPendingCount?: number;
};

export default function AdminNav({
  page,
  isLocked,
  onSetPage,
  tabClass,
  t,
  leaveApprovalPendingCount = 0,
  todoPendingCount = 0
}: AdminNavProps) {
  return (
    <nav className="glass reveal flex flex-wrap gap-2 rounded-[30px] border border-white/10 p-3.5">
      <button type="button" disabled={isLocked} onClick={() => onSetPage('home')} className={tabClass(page === 'home')}>
        {t('首页', 'Home')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('employees')} className={tabClass(page === 'employees')}>
        {t('员工信息', 'Employees')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('accounts')} className={tabClass(page === 'accounts')}>
        {t('账号管理', 'Accounts')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('timecard')} className={tabClass(page === 'timecard')}>
        {t('时间卡', 'Timecard')}
      </button>
      <button
        type="button"
        disabled={isLocked}
        onClick={() => onSetPage('leave_approval')}
        className={[tabClass(page === 'leave_approval'), 'relative'].join(' ')}
      >
        {leaveApprovalPendingCount > 0 ? <span className="absolute right-0 top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_0_2px_rgba(15,23,42,0.55)]" /> : null}
        {t('请假审批', 'Leave Approval')}
      </button>
      <button
        type="button"
        disabled={isLocked}
        onClick={() => onSetPage('work_hour_comparison')}
        className={tabClass(page === 'work_hour_comparison')}
      >
        {t('工时对比', 'Work Hour Comparison')}
      </button>
      <button
        type="button"
        disabled={isLocked}
        onClick={() => onSetPage('todo')}
        className={[tabClass(page === 'todo'), 'relative'].join(' ')}
      >
        {todoPendingCount > 0 ? <span className="absolute right-0 top-0.5 min-w-[18px] rounded-full bg-sky-500 px-1.5 text-[10px] font-semibold leading-5 text-white">{todoPendingCount}</span> : null}
        {t('待办', 'ToDo')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('punches')} className={tabClass(page === 'punches')}>
        {t('打卡流水', 'Punches')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('audit')} className={tabClass(page === 'audit')}>
        {t('日志', 'Log')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('schedule')} className={tabClass(page === 'schedule')}>
        {t('排班', 'Schedule')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('devices')} className={tabClass(page === 'devices')}>
        {t('设备管理', 'Devices')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('forecast')} className={tabClass(page === 'forecast')}>
        {t('件量预测', 'Forecast')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('prediction_model')} className={tabClass(page === 'prediction_model')}>
        {t('预测模型', 'Prediction Model')}
      </button>
      <button type="button" disabled={isLocked} onClick={() => onSetPage('efficiency')} className={tabClass(page === 'efficiency')}>
        {t('人效', 'Efficiency')}
      </button>
    </nav>
  );
}
