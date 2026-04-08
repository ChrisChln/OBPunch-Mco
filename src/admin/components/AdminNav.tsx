import type { AdminPage } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type AdminNavProps = {
  page: AdminPage;
  isLocked: boolean;
  onSetPage: (page: AdminPage) => void;
  tabClass: (active: boolean) => string;
  t: TranslateFn;
  visiblePages?: AdminPage[];
  leaveApprovalPendingCount?: number;
  todoPendingCount?: number;
};

type NavItem = {
  page: AdminPage;
  label: (t: TranslateFn) => string;
  badge?: 'leave' | 'todo';
};

const NAV_ITEMS: NavItem[] = [
  { page: 'home', label: (t) => t('首页', 'Home') },
  { page: 'employees', label: (t) => t('员工信息', 'Employees') },
  { page: 'accounts', label: (t) => t('账号管理', 'Accounts') },
  { page: 'timecard', label: (t) => t('时间卡', 'Timecard') },
  { page: 'leave_approval', label: (t) => t('请假审批', 'Leave Approval'), badge: 'leave' },
  { page: 'work_hour_comparison', label: (t) => t('工时对比', 'Work Hour Comparison') },
  { page: 'todo', label: (t) => t('待办', 'ToDo'), badge: 'todo' },
  { page: 'punches', label: (t) => t('打卡流水', 'Punches') },
  { page: 'audit', label: (t) => t('日志', 'Log') },
  { page: 'schedule', label: (t) => t('排班', 'Schedule') },
  { page: 'devices', label: (t) => t('设备管理', 'Devices') },
  { page: 'forecast', label: (t) => t('件量预测', 'Forecast') },
  { page: 'prediction_model', label: (t) => t('预测模型', 'Prediction Model') },
  { page: 'efficiency', label: (t) => t('人效', 'Efficiency') }
];

export default function AdminNav({
  page,
  isLocked,
  onSetPage,
  tabClass,
  t,
  visiblePages,
  leaveApprovalPendingCount = 0,
  todoPendingCount = 0
}: AdminNavProps) {
  const visiblePageSet = new Set(visiblePages ?? NAV_ITEMS.map((item) => item.page));
  const items = NAV_ITEMS.filter((item) => visiblePageSet.has(item.page));

  return (
    <nav className="glass reveal flex flex-wrap gap-2 rounded-[30px] border border-white/10 p-3.5">
      {items.map((item) => (
        <button
          key={item.page}
          type="button"
          disabled={isLocked}
          onClick={() => onSetPage(item.page)}
          className={[tabClass(page === item.page), 'relative'].join(' ')}
        >
          {item.badge === 'leave' && leaveApprovalPendingCount > 0 ? (
            <span className="absolute right-0 top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_0_2px_rgba(15,23,42,0.55)]" />
          ) : null}
          {item.badge === 'todo' && todoPendingCount > 0 ? (
            <span className="absolute right-0 top-0.5 min-w-[18px] rounded-full bg-sky-500 px-1.5 text-[10px] font-semibold leading-5 text-white">
              {todoPendingCount}
            </span>
          ) : null}
          {item.label(t)}
        </button>
      ))}
    </nav>
  );
}
