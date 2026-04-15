import { memo, useEffect, useRef, useState } from 'react';
import type { IconType } from 'react-icons';
import {
  HiBriefcase,
  HiChartBar,
  HiChartPie,
  HiClipboardDocumentList,
  HiClock,
  HiCog6Tooth,
  HiCube,
  HiCurrencyDollar,
  HiDocumentText,
  HiFolder,
  HiHome,
  HiShieldCheck,
  HiSquares2X2,
  HiUserGroup,
  HiUsers
} from 'react-icons/hi2';
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

const NAV_ICON_STYLE = 'h-5 w-5';

const PAGE_ICONS: Record<AdminPage, IconType> = {
  home: HiSquares2X2,
  employees: HiUsers,
  employee_upload: HiUserGroup,
  accounts: HiBriefcase,
  permissions: HiShieldCheck,
  timecard: HiClock,
  leave_approval: HiClipboardDocumentList,
  work_hour_comparison: HiChartBar,
  todo: HiDocumentText,
  punches: HiFolder,
  audit: HiDocumentText,
  schedule: HiClipboardDocumentList,
  devices: HiCube,
  forecast: HiChartPie,
  prediction_model: HiCog6Tooth,
  efficiency: HiCurrencyDollar
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

const NavIcon = ({ page }: { page: AdminPage }) => {
  const Icon = PAGE_ICONS[page] ?? HiHome;
  return <Icon className={NAV_ICON_STYLE} aria-hidden="true" />;
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
              const showLeaveDot = !expanded && item.badge === 'leave' && badgeCount > 0;
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
                  <span className={['relative grid h-7 w-7 shrink-0 place-items-center transition', active ? 'text-indigo-600' : 'text-slate-500'].join(' ')}>
                    <NavIcon page={item.page} />
                    {showLeaveDot ? (
                      <span
                        className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-slate-950/80 bg-rose-500"
                        aria-hidden="true"
                      />
                    ) : null}
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
