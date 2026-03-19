import type { AdminPage } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type AdminNavProps = {
  page: AdminPage;
  isLocked: boolean;
  onSetPage: (page: AdminPage) => void;
  tabClass: (active: boolean) => string;
  t: TranslateFn;
};

export default function AdminNav({ page, isLocked, onSetPage, tabClass, t }: AdminNavProps) {
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
