import { memo, useEffect, useRef, useState } from 'react';
import type { AdminPage } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type AdminNavProps = {
  page: AdminPage;
  isLocked: boolean;
  themeMode: 'light' | 'dark';
  onSetPage: (page: AdminPage) => void;
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

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const ClipboardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

const TrendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

const ListIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const BoxIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const ChartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <line x1="12" y1="2" x2="12" y2="22" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const WalletIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={NAV_ICON_STYLE} aria-hidden="true">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z" />
    <path d="M18 5v4" />
  </svg>
);

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

function AdminNav({
  page,
  isLocked,
  themeMode,
  onSetPage,
  t,
  visiblePages,
  leaveApprovalPendingCount = 0,
  todoPendingCount = 0
}: AdminNavProps) {
  const [expanded, setExpanded] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);
  const visiblePageSet = new Set(visiblePages ?? NAV_ITEMS.map((item) => item.page));
  const items = NAV_ITEMS.filter((item) => visiblePageSet.has(item.page));
  const shellClass =
    themeMode === 'light'
      ? 'border-r border-slate-200 bg-white/90 text-slate-900 backdrop-blur-xl'
      : 'border-r border-slate-800/90 bg-slate-950/96 text-slate-100 backdrop-blur-xl';
  const activeClass =
    themeMode === 'light'
      ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-[0_10px_24px_rgba(79,70,229,0.08)]'
      : 'border-indigo-500/20 bg-indigo-500/12 text-indigo-200 shadow-[0_10px_24px_rgba(2,6,23,0.28)]';
  const inactiveClass =
    themeMode === 'light'
      ? 'border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'
      : 'border-transparent bg-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-900/80 hover:text-slate-50';

  const clearCollapseTimer = () => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearCollapseTimer();
    };
  }, []);

  return (
    <aside
      className="relative h-full min-h-0 w-[60px]"
      onMouseEnter={() => {
        clearCollapseTimer();
        if (!expanded) {
          setExpanded(true);
        }
      }}
      onMouseLeave={() => {
        clearCollapseTimer();
        collapseTimerRef.current = window.setTimeout(() => {
          if (expanded) {
            setExpanded(false);
          }
          collapseTimerRef.current = null;
        }, 80);
      }}
    >
      <div
        className={[
          'absolute inset-y-0 left-0 z-20 flex min-h-0 flex-col overflow-hidden transition-[width] duration-200 ease-out',
          expanded ? 'w-[240px] shadow-[0_10px_30px_rgba(2,6,23,0.24)]' : 'w-[60px]',
          shellClass
        ].join(' ')}
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
                    active ? activeClass : inactiveClass
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
      </div>
    </aside>
  );
}

export default memo(AdminNav);
