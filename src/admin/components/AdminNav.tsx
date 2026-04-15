import type { AdminPage } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type AdminNavProps = {
  page: AdminPage;
  isLocked: boolean;
  onSetPage: (page: AdminPage) => void;
  t: TranslateFn;
  visiblePages?: AdminPage[];
  leaveApprovalPendingCount?: number;
  todoPendingCount?: number;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

type NavItem = {
  page: AdminPage;
  label: (t: TranslateFn) => string;
  badge?: 'leave' | 'todo';
};

const NAV_ICON_STYLE = 'h-4 w-4';

const DashIcon = ({ active }: { active: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <rect x="3" y="4" width="7" height="7" rx="1.8" />
    <rect x="14" y="4" width="7" height="7" rx="1.8" />
    <rect x="3" y="13" width="7" height="7" rx="1.8" />
    <path d="M14 13h7v7h-7z" opacity={active ? 1 : 0.55} />
  </svg>
);

const UserCircleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M20 21a8 8 0 1 0-16 0" />
    <circle cx="12" cy="8" r="4" />
  </svg>
);

const WalletIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M4 7h16v10H4z" />
    <path d="M16 11h4v4h-4a2 2 0 0 1 0-4Z" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M12 3 19 6.5V12c0 4.4-3 8.3-7 9-4-0.7-7-4.6-7-9V6.5Z" />
    <path d="M9.5 12.2 11.1 14l3.6-4" />
  </svg>
);

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

const ClipboardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <rect x="5" y="4" width="14" height="16" rx="3" />
    <path d="M9 4.5h6" />
  </svg>
);

const ChartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <path d="M7 15l4-4 3 2 5-6" />
  </svg>
);

const ListIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M8 6h12" />
    <path d="M8 12h12" />
    <path d="M8 18h12" />
    <circle cx="4" cy="6" r="1" />
    <circle cx="4" cy="12" r="1" />
    <circle cx="4" cy="18" r="1" />
  </svg>
);

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);

const BoxIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M4 7.5 12 4l8 3.5-8 3.5Z" />
    <path d="M4 7.5V16l8 3.5 8-3.5v-8.5" />
    <path d="M12 11v8.5" />
  </svg>
);

const TrendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M4 17.5 9.2 12l3.8 3.8L20 9" />
  </svg>
);

const NavIcon = ({ page, active }: { page: AdminPage; active: boolean }) => {
  switch (page) {
    case 'home':
      return <DashIcon active={active} />;
    case 'employees':
      return <UserCircleIcon />;
    case 'accounts':
      return <WalletIcon />;
    case 'permissions':
      return <ShieldIcon />;
    case 'timecard':
      return <ClockIcon />;
    case 'leave_approval':
      return <ClipboardIcon />;
    case 'work_hour_comparison':
      return <TrendIcon />;
    case 'todo':
      return <ListIcon />;
    case 'punches':
      return <FolderIcon />;
    case 'audit':
      return <ListIcon />;
    case 'schedule':
      return <ClipboardIcon />;
    case 'devices':
      return <BoxIcon />;
    case 'forecast':
      return <TrendIcon />;
    case 'prediction_model':
      return <ShieldIcon />;
    case 'efficiency':
      return <ChartIcon />;
    default:
      return <DashIcon active={active} />;
  }
};

const NAV_ITEMS: NavItem[] = [
  { page: 'home', label: (t) => t('首页', 'Dashboard') },
  { page: 'employees', label: (t) => t('员工信息', 'Employees') },
  { page: 'accounts', label: (t) => t('账号管理', 'Accounts') },
  { page: 'permissions', label: (t) => t('权限', 'Permissions') },
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
  t,
  visiblePages,
  leaveApprovalPendingCount = 0,
  todoPendingCount = 0,
  expanded = false,
  onExpandedChange
}: AdminNavProps) {
  const visiblePageSet = new Set(visiblePages ?? NAV_ITEMS.map((item) => item.page));
  const items = NAV_ITEMS.filter((item) => visiblePageSet.has(item.page));

  return (
    <aside
      onMouseEnter={() => onExpandedChange?.(true)}
      onMouseLeave={() => onExpandedChange?.(false)}
      onFocusCapture={() => onExpandedChange?.(true)}
      onBlurCapture={() => onExpandedChange?.(false)}
      className="flex h-full min-h-0 w-full shrink-0 flex-col border-r border-slate-200 bg-white/90 backdrop-blur-xl"
    >
      <nav
        className={[
          'min-h-0 flex-1 overflow-y-auto py-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
          expanded ? 'px-3' : 'px-2'
        ].join(' ')}
      >
        <div className="space-y-0">
          {items.map((item) => {
            const active = page === item.page;
            const badgeCount = item.badge === 'leave' ? leaveApprovalPendingCount : item.badge === 'todo' ? todoPendingCount : 0;
            return (
              <button
                key={item.page}
                type="button"
                disabled={isLocked}
                onClick={() => onSetPage(item.page)}
                className={[
                  'group flex w-full items-center rounded-xl border text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                  expanded ? 'h-8 gap-2 px-2.5' : 'h-8 justify-center px-0',
                  active
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-[0_10px_24px_rgba(79,70,229,0.08)]'
                    : 'border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                ].join(' ')}
              >
                <span className={['grid h-7 w-7 shrink-0 place-items-center transition', active ? 'text-indigo-600' : 'text-slate-500'].join(' ')}>
                  <NavIcon page={item.page} active={active} />
                </span>
                {expanded ? (
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-[15px] font-semibold leading-tight">{item.label(t)}</div>
                      {badgeCount > 0 ? (
                        <span className={['rounded-full px-2 py-0.5 text-[10px] font-semibold', item.badge === 'leave' ? 'bg-rose-100 text-rose-700' : 'bg-indigo-100 text-indigo-700'].join(' ')}>
                          {badgeCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
