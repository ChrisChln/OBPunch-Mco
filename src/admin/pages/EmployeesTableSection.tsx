type TranslateFn = (zh: string, en: string) => string;

type EmployeesTableSectionProps = {
  t: TranslateFn;
  isLocked: boolean;
  employeesError: string | null;
  employeesFiltered: any[];
  employeesRendered: any[];
  employeeSortByLastPunchDesc: boolean;
  onToggleSort: () => void;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
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
  serverTime: Date;
  shiftAnalysisDays: number;
  toDateOnly: (date: Date) => string;
  employeeBadgePrintingStaffId: string | null;
  openEmployeeAuditLog: (staff: string, name?: string) => void | Promise<void>;
  printEmployeeTempBadge: (payload: {
    staff: string;
    name: string;
    agency: string;
    position: string;
    workAccount?: string;
    workPassword?: string;
  }) => void | Promise<void>;
  openEmployeeEdit: (payload: {
    staff: string;
    name: string;
    agency: string;
    position: string;
    shift: '' | 'early' | 'late';
    label: string;
    workAccount: string;
    workPassword: string;
  }) => void;
  deleteEmployeeRow: (staffId: string) => void | Promise<void>;
};

export default function EmployeesTableSection({
  t,
  isLocked,
  employeesError,
  employeesFiltered,
  employeesRendered,
  employeeSortByLastPunchDesc,
  onToggleSort,
  onScroll,
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
  serverTime,
  shiftAnalysisDays,
  toDateOnly,
  employeeBadgePrintingStaffId,
  openEmployeeAuditLog,
  printEmployeeTempBadge,
  openEmployeeEdit,
  deleteEmployeeRow
}: EmployeesTableSectionProps) {
  return (
    <>
      {employeesError && (
        <p className="mt-3 text-sm text-ember">
          {t('加载失败：', 'Load failed: ')}
          {employeesError}
        </p>
      )}
      {!employeesError && employeesFiltered.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">{t('暂无数据，点击“刷新/搜索”。', 'No data. Click “Refresh/Search”.')}</p>
      )}

      <div className="mt-5 max-h-[68vh] overflow-auto rounded-2xl border border-white/10 bg-black/30" onScroll={onScroll}>
        <table className="min-w-[1360px] w-full text-left text-sm">
          <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-[0.2em] text-slate-400 backdrop-blur">
            <tr>
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Agency</th>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3">{t('标签', 'Label')}</th>
              <th className="px-4 py-3">{t('工作账号', 'Work account')}</th>
              <th className="px-4 py-3">{t('工作密码', 'Work password')}</th>
              <th className="px-4 py-3">{t('入职日期', 'Hire date')}</th>
              <th className="px-4 py-3">{t('班次', 'Shift')}</th>
              <th className="px-4 py-3">
                <button
                  type="button"
                  onClick={onToggleSort}
                  className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.2em] text-slate-400 transition hover:text-slate-200"
                  title={t('按天数从高到低排序', 'Sort by days high to low')}
                >
                  {t('最后打卡', 'Last punch')}
                  {employeeSortByLastPunchDesc ? '↓' : ''}
                </button>
              </th>
              <th className="px-4 py-3 text-right">{t('操作', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {employeesRendered.map((e) => {
              const staff = String(e.staff_id ?? '').trim();
              const name = String(e.name ?? '').trim();
              const agency = String(e.agency ?? e.Agency ?? '').trim();
              const position = String(e.position ?? e.Position ?? '').trim();
              const label = String(e.label ?? e.Label ?? '').trim();
              const workAccount = String(e.work_account ?? e.WorkAccount ?? '').trim();
              const workPassword = String(e.work_password ?? e.WorkPassword ?? '').trim();
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
                  const days = Math.max(0, Math.floor((serverTime.getTime() - at.getTime()) / (24 * 60 * 60 * 1000)));
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

              return (
                <tr key={String(e.id ?? staff)} className="border-b border-white/5 transition-colors hover:bg-white/5 last:border-0">
                  <td className="px-4 py-3 font-mono text-slate-200">{displayStaffId(staff)}</td>
                  <td className="px-4 py-3 text-slate-200">{name}</td>
                  <td className="px-4 py-3 text-slate-200">{agency}</td>
                  <td className="px-4 py-3 text-slate-200">
                    <span
                      className={[
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
                        getSchedulePositionBadgeClass(position)
                      ].join(' ')}
                    >
                      {position || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-200">
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
                  <td className="px-4 py-3 text-slate-200">{workAccount || '-'}</td>
                  <td className="px-4 py-3 text-slate-200">{workPassword || '-'}</td>
                  <td className="px-4 py-3 text-slate-200">{hireDate}</td>
                  <td className="px-4 py-3 text-slate-200">
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
                  <td className="px-4 py-3 text-slate-200">{lastPunchDaysText}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void openEmployeeAuditLog(staff, name)}
                      className="mr-2 rounded-xl bg-cyan-500/20 px-4 py-1.5 text-xs font-semibold text-cyan-200 transition hover:-translate-y-0.5 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('日志', 'Log')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked || employeeBadgePrintingStaffId === staff}
                      onClick={() => void printEmployeeTempBadge({ staff, name, agency, position, workAccount, workPassword })}
                      className="mr-2 rounded-xl bg-neon px-4 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {employeeBadgePrintingStaffId === staff ? t('生成中...', 'Generating...') : t('工牌', 'Badge')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => openEmployeeEdit({ staff, name, agency, position, shift: (shift as '' | 'early' | 'late'), label, workAccount, workPassword })}
                      className="mr-2 rounded-xl bg-white/10 px-4 py-1.5 text-xs font-semibold text-slate-200 transition hover:-translate-y-0.5 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('编辑', 'Edit')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void deleteEmployeeRow(staff)}
                      className="rounded-xl bg-ember px-4 py-1.5 text-xs font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('删除', 'Delete')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!employeesError && employeesRendered.length < employeesFiltered.length && (
        <div className="mt-2 text-xs text-slate-500">
          {t(
            `已显示 ${employeesRendered.length}/${employeesFiltered.length}，向下滚动加载更多`,
            `Showing ${employeesRendered.length}/${employeesFiltered.length}. Scroll to load more`
          )}
        </div>
      )}
    </>
  );
}
import type { UIEvent } from 'react';
