import { useEffect, useMemo, useRef, useState } from 'react';

import { useCallback, type UIEvent } from 'react';
import { isScheduleOnlyAgency } from '../../shared/agencyRules';

type TranslateFn = (zh: string, en: string) => string;

const DEFAULT_WORK_PASSWORD = 'Helloworld2!';
const resolveDefaultWorkPassword = (workAccount: string, workPassword: string) =>
  workAccount && !workPassword ? DEFAULT_WORK_PASSWORD : workPassword;
const normalizeEmploymentType = (value: unknown): 'FT' | 'PT' => String(value ?? '').trim().toUpperCase() === 'PT' ? 'PT' : 'FT';

type EmployeesTableSectionProps = {
  t: TranslateFn;
  isLocked: boolean;
  themeMode: 'dark' | 'light';
  employeesError: string | null;
  employeesFiltered: any[];
  employeeSortByLastPunchDesc: boolean;
  employeePunchMetaLoading: boolean;
  employeeSortByHireDateDesc: boolean;
  onToggleSort: () => void;
  onToggleHireDateSort: () => void;
  displayStaffId: (value: string) => string;
  getSchedulePositionBadgeClass: (position: string) => string;
  getScheduleLabelToneClass: (label: string) => string;
  getShiftBadgeClass: (shift: '' | 'early' | 'late') => string;
  employeeShiftByStaffId: Record<string, any>;
  scheduleRowsByStaffDayIndex: Map<string, any>;
  normalizeStaffId: (value: string) => string;
  normalizeShiftValue: (value: string) => '' | 'early' | 'late';
  homeOperationalDayIndex: number;
  employeeLastPunchAtByStaffId: Record<string, string | null>;
  employeeLastPunchNowMs: number;
  shiftAnalysisDays: number;
  toDateOnly: (date: Date) => string;
  employeeBadgePrintingStaffId: string | null;
  employeeBadgeBatchSelectedStaffIds: string[];
  toggleEmployeeBadgeBatchSelectedStaffId: (payload: {
    staff: string;
    name: string;
    agency: string;
    position: string;
    workAccount?: string;
    workPassword?: string;
  }) => void;
  openEmployeeAuditLog: (staff: string, name?: string) => void | Promise<void>;
  printEmployeeTempBadge: (payload: {
    staff: string;
    name: string;
    agency: string;
    position: string;
    workAccount?: string;
    workPassword?: string;
  }) => void | Promise<void>;
  canOperateEmployeePosition: (position: string) => boolean;
  openEmployeeEdit: (payload: {
    staff: string;
    name: string;
    agency: string;
    position: string;
    employmentType: 'FT' | 'PT';
    shift: '' | 'early' | 'late';
    shiftTime: string;
    label: string;
    workAccount: string;
    workPassword: string;
  }) => void;
  deleteEmployeeRow: (staffId: string) => void | Promise<void>;
};

export default function EmployeesTableSection({
  t,
  isLocked,
  themeMode,
  employeesError,
  employeesFiltered,
  employeeSortByLastPunchDesc,
  employeePunchMetaLoading,
  employeeSortByHireDateDesc,
  onToggleSort,
  onToggleHireDateSort,
  displayStaffId,
  getSchedulePositionBadgeClass,
  getScheduleLabelToneClass,
  getShiftBadgeClass,
  employeeShiftByStaffId,
  scheduleRowsByStaffDayIndex,
  normalizeStaffId,
  normalizeShiftValue,
  homeOperationalDayIndex,
  employeeLastPunchAtByStaffId,
  employeeLastPunchNowMs,
  shiftAnalysisDays,
  toDateOnly,
  employeeBadgePrintingStaffId,
  employeeBadgeBatchSelectedStaffIds,
  toggleEmployeeBadgeBatchSelectedStaffId,
  openEmployeeAuditLog,
  printEmployeeTempBadge,
  canOperateEmployeePosition,
  openEmployeeEdit,
  deleteEmployeeRow
}: EmployeesTableSectionProps) {
  const isLight = themeMode === 'light';
  const ROW_HEIGHT = 56;
  const OVERSCAN = 12;
  const TABLE_COLS = 12;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibleStartRef = useRef(0);
  const pendingScrollTopRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const [visibleStart, setVisibleStart] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);

  const getVisibleStart = useCallback((nextScrollTop: number) => {
    return Math.max(0, Math.floor(nextScrollTop / ROW_HEIGHT) - OVERSCAN);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => setViewportHeight(el.clientHeight || 640);
    sync();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const total = employeesFiltered.length;
  useEffect(() => {
    if (visibleStart < total) return;
    visibleStartRef.current = 0;
    setVisibleStart(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [total, visibleStart]);

  const visibleMeta = useMemo(() => {
    const safeHeight = Math.max(1, viewportHeight);
    const visibleCount = Math.ceil(safeHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const start = Math.min(visibleStart, total);
    const end = Math.min(total, start + visibleCount);
    return { start, end };
  }, [visibleStart, viewportHeight, total]);

  const topSpacerHeight = visibleMeta.start * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (total - visibleMeta.end) * ROW_HEIGHT);
  const employeesVisible = useMemo(
    () => employeesFiltered.slice(visibleMeta.start, visibleMeta.end),
    [employeesFiltered, visibleMeta.start, visibleMeta.end]
  );
  const selectedStaffIds = useMemo(() => new Set(employeeBadgeBatchSelectedStaffIds), [employeeBadgeBatchSelectedStaffIds]);
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      pendingScrollTopRef.current = event.currentTarget.scrollTop;
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const nextStart = getVisibleStart(pendingScrollTopRef.current);
        if (nextStart === visibleStartRef.current) return;
        visibleStartRef.current = nextStart;
        setVisibleStart(nextStart);
      });
    },
    [getVisibleStart]
  );

  return (
    <>
      {employeesError && (
        <p className="mt-3 text-sm text-ember">
          {t('加载失败：', 'Load failed: ')}
          {employeesError}
        </p>
      )}
      {!employeesError && employeesFiltered.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">{t('暂无数据，点击“刷新/搜索”。', 'No data. Click "Refresh/Search".')}</p>
      )}

      <div
        ref={containerRef}
        className={[
          'mt-5 max-h-[68vh] overflow-auto rounded-2xl border',
          isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-black/30'
        ].join(' ')}
        style={{ contain: 'layout paint style' }}
        onScroll={handleScroll}
      >
        <table className="min-w-[1500px] w-full table-fixed text-left text-sm">
          <thead
            className={[
              'sticky top-0 z-20 border-b text-xs uppercase tracking-[0.2em]',
              isLight ? 'border-slate-200 bg-white/95 text-slate-500' : 'border-white/10 bg-slate-950/95 text-slate-400'
            ].join(' ')}
          >
            <tr>
              <th className="w-[190px] px-3 py-3 whitespace-nowrap">Employee ID</th>
              <th className="w-[220px] px-3 py-3">Name</th>
              <th className="w-[92px] px-3 py-3 whitespace-nowrap">Agency</th>
              <th className="w-[112px] px-3 py-3 whitespace-nowrap">Position</th>
              <th className="w-[72px] px-3 py-3 whitespace-nowrap">FT/PT</th>
              <th className="w-[120px] px-3 py-3 whitespace-nowrap">{t('标签', 'Label')}</th>
              <th className="w-[112px] px-3 py-3 whitespace-nowrap">{t('账号', 'Account')}</th>
              <th className="w-[112px] px-3 py-3 whitespace-nowrap">
                <button
                  type="button"
                  onClick={onToggleHireDateSort}
                  className={[
                    'inline-flex items-center gap-1 whitespace-nowrap text-xs uppercase tracking-[0.2em] transition',
                    isLight ? 'text-slate-500 hover:text-slate-700' : 'text-slate-400 hover:text-slate-200'
                  ].join(' ')}
                  title={t('按入职日期从新到旧排序', 'Sort by hire date newest to oldest')}
                >
                  {t('入职日期', 'Hire date')}
                  {employeeSortByHireDateDesc ? ' ↓' : ''}
                </button>
              </th>
              <th className="w-[86px] px-3 py-3 whitespace-nowrap">{t('班次', 'Shift')}</th>
              <th className="w-[96px] px-3 py-3 whitespace-nowrap">{t('班次时间', 'Shift time')}</th>
              <th className="w-[96px] px-3 py-3 whitespace-nowrap">
                <button
                  type="button"
                  disabled={employeePunchMetaLoading}
                  onClick={onToggleSort}
                  className={[
                    'inline-flex items-center gap-1 whitespace-nowrap text-xs uppercase tracking-[0.2em] transition disabled:cursor-wait disabled:opacity-60',
                    isLight ? 'text-slate-500 hover:text-slate-700' : 'text-slate-400 hover:text-slate-200'
                  ].join(' ')}
                  title={t('按天数从高到低排序', 'Sort by days high to low')}
                >
                  {employeePunchMetaLoading ? t('加载中...', 'Loading...') : t('最后打卡', 'Last punch')}
                  {employeeSortByLastPunchDesc ? ' ↓' : ''}
                </button>
              </th>
              <th className="w-[188px] px-3 py-3 text-right whitespace-nowrap">{t('操作', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={TABLE_COLS} style={{ height: topSpacerHeight, padding: 0, border: 0 }} />
              </tr>
            )}
            {employeesVisible.map((e) => {
              const staff = String(e.staff_id ?? '').trim();
              const name = String(e.name ?? '').trim();
              const agency = String(e.agency ?? e.Agency ?? '').trim();
              const isProtectedAgencyEmployee = isScheduleOnlyAgency(agency);
              const position = String(e.position ?? e.Position ?? '').trim();
              const employmentType = normalizeEmploymentType((e as any).employment_type ?? (e as any).EmploymentType ?? '');
              const label = String(e.label ?? e.Label ?? '').trim();
              const workAccount = String(e.work_account ?? e.WorkAccount ?? '').trim();
              const workPassword = resolveDefaultWorkPassword(
                workAccount,
                String(e.work_password ?? e.WorkPassword ?? '').trim()
              );
              const createdAt = String(e.created_at ?? '').trim();
              const hireDate = (() => {
                if (!createdAt) return '-';
                const dt = new Date(createdAt);
                if (Number.isNaN(dt.getTime())) return '-';
                return toDateOnly(dt);
              })();
              const shiftInfo = employeeShiftByStaffId[staff];
              const scheduleRow = scheduleRowsByStaffDayIndex.get(`${normalizeStaffId(staff)}__${homeOperationalDayIndex}`);
              const scheduledShift = normalizeShiftValue(String(scheduleRow?.shift ?? '').trim());
              const dbShift = normalizeShiftValue(String(e.shift ?? '').trim());
              const shiftTime = String((e as any).shift_time ?? (e as any).ShiftTime ?? '').trim();
              let weeklyScheduledShift: '' | 'early' | 'late' = '';
              if (!scheduledShift) {
                const normalizedStaff = normalizeStaffId(staff);
                for (let idx = 0; idx < 7; idx += 1) {
                  const row = scheduleRowsByStaffDayIndex.get(`${normalizedStaff}__${idx}`);
                  const s = normalizeShiftValue(String(row?.shift ?? '').trim());
                  if (s) {
                    weeklyScheduledShift = s;
                    break;
                  }
                }
              }
              const shift = shiftInfo?.shift || scheduledShift || dbShift || weeklyScheduledShift || '';
              const shiftLabel = shift === 'early' ? t('白班', 'Day') : shift === 'late' ? t('晚班', 'Night') : '-';
              const lastPunchAt = String(employeeLastPunchAtByStaffId[staff] ?? '').trim();
              let lastPunchDaysText = '-';
              if (lastPunchAt) {
                const at = new Date(lastPunchAt);
                if (!Number.isNaN(at.getTime())) {
                  const days = Math.max(0, Math.floor((employeeLastPunchNowMs - at.getTime()) / (24 * 60 * 60 * 1000)));
                  lastPunchDaysText = t(`${days}天前`, `${days}d ago`);
                }
              }
              const shiftTitle = shiftInfo
                ? t(
                    `近${shiftAnalysisDays}天：白班 ${shiftInfo.earlyHours.toFixed(1)}h / 晚班 ${shiftInfo.lateHours.toFixed(1)}h`,
                    `Last ${shiftAnalysisDays}d: Day ${shiftInfo.earlyHours.toFixed(1)}h / Night ${shiftInfo.lateHours.toFixed(1)}h`
                  )
                : scheduledShift
                  ? t(
                      `当前排班：${scheduledShift === 'early' ? '白班' : '晚班'}`,
                      `Scheduled now: ${scheduledShift === 'early' ? 'Day' : 'Night'}`
                    )
                  : '';
              const displayEmployeeId = isProtectedAgencyEmployee ? '-' : displayStaffId(staff);
              const isSelected = selectedStaffIds.has(staff);
              const rowIsLocked = isLocked || !canOperateEmployeePosition(position);
              const selectedRowStyle = isSelected
                ? themeMode === 'light'
                  ? { backgroundColor: '#e2e8f0' }
                  : { backgroundColor: 'rgba(148,163,184,0.2)' }
                : undefined;

              return (
                <tr
                  key={String(e.id ?? staff)}
                  onClick={() => {
                    if (rowIsLocked) return;
                    toggleEmployeeBadgeBatchSelectedStaffId({
                      staff,
                      name,
                      agency,
                      position,
                      workAccount,
                      workPassword
                    });
                  }}
                  style={selectedRowStyle}
                  className={[
                    'border-b border-white/5 transition-colors last:border-0',
                    rowIsLocked ? 'cursor-default' : 'cursor-pointer',
                    isSelected || rowIsLocked ? '' : 'hover:bg-white/5'
                  ].join(' ')}
                >
                  <td className={['w-[190px] max-w-[190px] px-3 py-3 font-mono', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                    <span className="block truncate" title={displayEmployeeId}>{displayEmployeeId}</span>
                  </td>
                  <td className={['w-[220px] max-w-[220px] px-3 py-3', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                    <span className="block truncate" title={name || '-'}>{name || '-'}</span>
                  </td>
                  <td className={['w-[92px] px-3 py-3 whitespace-nowrap', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{agency || '-'}</td>
                  <td className={['w-[112px] px-3 py-3 whitespace-nowrap', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                    <span
                      className={[
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
                        getSchedulePositionBadgeClass(position)
                      ].join(' ')}
                    >
                      {position || '-'}
                    </span>
                  </td>
                  <td className={['w-[72px] px-3 py-3 whitespace-nowrap', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{employmentType}</td>
                  <td className={['w-[120px] px-3 py-3', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                    {label ? (
                      <span
                        className={[
                          'inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                          getScheduleLabelToneClass(label)
                        ].join(' ')}
                      >
                        <span className="truncate">{label}</span>
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className={['w-[112px] px-3 py-3 whitespace-nowrap', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                    <span className="block truncate" title={workAccount || '-'}>{workAccount || '-'}</span>
                  </td>
                  <td className={['w-[112px] px-3 py-3 whitespace-nowrap', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{hireDate}</td>
                  <td className={['w-[86px] px-3 py-3 whitespace-nowrap', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                    <span
                      title={shiftTitle}
                      className={[
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
                        getShiftBadgeClass(shift)
                      ].join(' ')}
                    >
                      {shiftLabel}
                    </span>
                  </td>
                  <td className={['w-[96px] px-3 py-3 font-mono whitespace-nowrap', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{shiftTime || '-'}</td>
                  <td className={['w-[96px] px-3 py-3 whitespace-nowrap', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{lastPunchDaysText}</td>
                  <td className="w-[188px] px-3 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={(evt) => {
                        evt.stopPropagation();
                        void openEmployeeAuditLog(staff, name);
                      }}
                      className={[
                        'mr-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60',
                        themeMode === 'light'
                          ? 'border border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
                          : 'bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30'
                      ].join(' ')}
                    >
                      {t('日志', 'Log')}
                    </button>
                    <button
                      type="button"
                      disabled={rowIsLocked || employeeBadgePrintingStaffId === staff}
                      onClick={(evt) => {
                        evt.stopPropagation();
                        void printEmployeeTempBadge({ staff, name, agency, position, workAccount, workPassword });
                      }}
                      className="mr-1.5 rounded-xl bg-neon px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {employeeBadgePrintingStaffId === staff ? t('生成中...', 'Generating...') : t('工牌', 'Badge')}
                    </button>
                    <button
                      type="button"
                      disabled={rowIsLocked}
                      onClick={(evt) => {
                        evt.stopPropagation();
                        openEmployeeEdit({
                          staff,
                          name,
                          agency,
                          position,
                          employmentType,
                          shift: shift as '' | 'early' | 'late',
                          shiftTime,
                          label,
                          workAccount,
                          workPassword
                        });
                      }}
                      className={[
                        'mr-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60',
                        themeMode === 'light'
                          ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                          : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      ].join(' ')}
                    >
                      {t('编辑', 'Edit')}
                    </button>
                    <button
                      type="button"
                      disabled={rowIsLocked || isProtectedAgencyEmployee}
                      onClick={(evt) => {
                        evt.stopPropagation();
                        void deleteEmployeeRow(staff);
                      }}
                      title={isProtectedAgencyEmployee ? t('JDL员工不能删除', 'JDL employees cannot be deleted') : undefined}
                      className="rounded-xl bg-ember px-3 py-1.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('删', 'Del')}
                    </button>
                  </td>
                </tr>
              );
            })}
            {bottomSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={TABLE_COLS} style={{ height: bottomSpacerHeight, padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!employeesError && employeesFiltered.length > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          {t(
            `总计 ${employeesFiltered.length}，当前渲染 ${employeesVisible.length} 行（虚拟滚动）`,
            `${employeesFiltered.length} total, rendering ${employeesVisible.length} rows (virtualized)`
          )}
        </div>
      )}
    </>
  );
}
