import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
  HiExclamationTriangle,
  HiFolder,
  HiHome,
  HiShieldCheck,
  HiSquares2X2,
  HiUserGroup,
  HiUsers
} from 'react-icons/hi2';
import type { AdminPage } from '../types';
import GooeyNav, { type GooeyNavItem } from './GooeyNav';

type TranslateFn = (zh: string, en: string) => string;

type AdminNavProps = {
  page: AdminPage;
  isLocked: boolean;
  themeMode: 'light' | 'dark';
  onSetPage: (page: AdminPage) => void;
  t: TranslateFn;
  visiblePages?: AdminPage[];
  leaveApprovalPendingCount?: number;
  scheduleTerminationPendingCount?: number;
  todoPendingCount?: number;
};

type NavItem = {
  page: AdminPage;
  label: (t: TranslateFn) => string;
  badge?: 'leave' | 'schedule' | 'todo';
};

const NAV_ICON_STYLE = 'h-5 w-5';

const PAGE_ICONS: Record<AdminPage, IconType> = {
  home: HiSquares2X2,
  package_metrics: HiChartBar,
  consumables: HiCube,
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
  efficiency: HiCurrencyDollar,
  exceptions: HiExclamationTriangle
};

const NAV_ITEMS: NavItem[] = [
  { page: 'home', label: (t) => t('首页', 'Dashboard') },
  { page: 'package_metrics', label: (t) => t('日报', 'Daily') },
  { page: 'consumables', label: (t) => t('耗材', 'Consumables') },
  { page: 'employees', label: (t) => t('员工信息', 'Employees') },
  { page: 'accounts', label: (t) => t('账号管理', 'Accounts') },
  { page: 'permissions', label: (t) => t('权限', 'Permissions') },
  { page: 'timecard', label: (t) => t('时间卡', 'Timecard') },
  { page: 'schedule', label: (t) => t('排班', 'Schedule'), badge: 'schedule' },
  { page: 'leave_approval', label: (t) => t('请假审批', 'Leave Approval'), badge: 'leave' },
  { page: 'work_hour_comparison', label: (t) => t('工时对比', 'Work Hour Comparison') },
  { page: 'todo', label: (t) => t('待办', 'ToDo'), badge: 'todo' },
  { page: 'punches', label: (t) => t('打卡流水', 'Punches') },
  { page: 'audit', label: (t) => t('日志', 'Log') },
  { page: 'devices', label: (t) => t('设备管理', 'Devices') },
  { page: 'forecast', label: (t) => t('件量预测', 'Forecast') },
  { page: 'prediction_model', label: (t) => t('预测模型', 'Prediction Model') },
  { page: 'efficiency', label: (t) => t('人效', 'Efficiency') },
  { page: 'exceptions', label: (t) => t('Exceptions', 'Exceptions') }
];

const ALL_NAV_PAGES = NAV_ITEMS.map((item) => item.page);

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
  scheduleTerminationPendingCount = 0,
  todoPendingCount = 0
}: AdminNavProps) {
  const [expanded, setExpanded] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);
  const items = useMemo(() => {
    const visiblePageSet = new Set(visiblePages ?? ALL_NAV_PAGES);
    return NAV_ITEMS.filter((item) => visiblePageSet.has(item.page));
  }, [visiblePages]);
  const shellClass =
    themeMode === 'light'
      ? 'border-r border-slate-200 bg-white text-slate-900'
      : 'border-r border-slate-800/90 bg-slate-950 text-slate-100';
  const activeIndex = Math.max(0, items.findIndex((item) => item.page === page));
  const navItems: GooeyNavItem[] = items.map((item) => {
    const badgeCount =
      item.badge === 'leave'
        ? leaveApprovalPendingCount
        : item.badge === 'schedule'
          ? scheduleTerminationPendingCount
          : item.badge === 'todo'
            ? todoPendingCount
            : 0;
    const showBadgeDot = !expanded && badgeCount > 0;
    const badgeTone = item.badge === 'todo' ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700';

    return {
      label: item.label(t),
      disabled: isLocked,
      icon: (
        <span className="relative grid h-7 w-7 shrink-0 place-items-center">
          <NavIcon page={item.page} />
          {showBadgeDot ? (
            <span
              className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-slate-950/80 bg-rose-500"
              aria-hidden="true"
            />
          ) : null}
        </span>
      ),
      rightSlot:
        expanded && badgeCount > 0 ? (
          <span className={['rounded-full px-2 py-0.5 text-[10px] font-semibold', badgeTone].join(' ')}>
            {badgeCount}
          </span>
        ) : null,
      onClick: () => onSetPage(item.page),
    };
  });

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
      className={[
        'relative z-30 h-full min-h-0 w-[60px] shrink-0 overflow-visible'
      ].join(' ')}
      onMouseEnter={() => {
        clearCollapseTimer();
        if (!expanded) setExpanded(true);
      }}
      onMouseLeave={() => {
        clearCollapseTimer();
        collapseTimerRef.current = window.setTimeout(() => {
          if (expanded) setExpanded(false);
          collapseTimerRef.current = null;
        }, 80);
      }}
    >
      <div
        className={[
          'absolute left-0 top-0 flex h-full min-h-0 flex-col overflow-hidden will-change-[width] transition-[width,box-shadow] duration-150 ease-out',
          expanded ? 'w-[176px] shadow-[0_10px_30px_rgba(2,6,23,0.24)]' : 'w-[60px]',
          shellClass
        ].join(' ')}
      >
        <div
          className={[
            'min-h-0 flex-1 overflow-y-auto py-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
            expanded ? 'px-2' : 'px-2'
          ].join(' ')}
        >
          <GooeyNav
            items={navItems}
            activeIndex={activeIndex}
            initialActiveIndex={activeIndex}
            particleCount={49}
            particleDistances={[132, 14]}
            particleR={520}
            animationTime={600}
            timeVariance={720}
            colors={[1, 2, 3, 1, 2, 3, 1, 4]}
            className={[
              'admin-sidebar-gooey',
              themeMode === 'light' ? 'admin-sidebar-gooey-light' : 'admin-sidebar-gooey-dark',
              expanded ? 'admin-sidebar-gooey-expanded' : 'admin-sidebar-gooey-collapsed',
            ].join(' ')}
            ariaLabel={t('管理导航', 'Admin navigation')}
          />
        </div>
      </div>
    </aside>
  );
}

export default memo(AdminNav);
