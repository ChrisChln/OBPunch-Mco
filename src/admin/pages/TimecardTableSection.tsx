import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ElectricBorder from '../../components/ElectricBorder';
import GlowLabelChip, { getGlowToneForPosition, getGlowToneForShift } from '../../components/GlowLabelChip';
import AdminUserAvatar from '../components/AdminUserAvatar';
import type { AdminUserIdentityView } from '../adminIdentity';
import { getTimecardCellHoursText, getTimecardTotalHoursText } from '../timecardDisplay';

type TranslateFn = (zh: string, en: string) => string;

type TimecardTableSectionProps = {
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  isLocked: boolean;
  timecardLoading: boolean;
  serverTime: Date;
  timecardWeekOffset: number;
  timecardWeekStart: Date;
  startOfWeekMonday: (date: Date) => Date;
  addDays: (date: Date, days: number) => Date;
  toDateOnly: (date: Date) => string;
  formatHours: (value: number) => string;
  getSchedulePositionBadgeClass: (position: string) => string;
  timecardDayTotalHours: number[];
  timecardDayAttendanceCount: number[];
  timecardPresentDayFilter: number | null;
  setTimecardPresentDayFilter: (value: number | null | ((prev: number | null) => number | null)) => void;
  timecardAgencySort: '' | 'asc' | 'desc';
  timecardTotalSort: '' | 'asc' | 'desc';
  onToggleTimecardAgencySort: () => void;
  onToggleTimecardTotalSort: () => void;
  timecardRowsRendered: any[];
  timecardAuditByStaffDate: Map<string, any[]>;
  openTimecardPunchModal: (staffId: string, dayIndex: number | null) => void | Promise<void>;
  formatAuditDetail: (row: any) => { summary: string; details: Array<{ label: string; value: string }> };
  formatCellAuditTime: (value: string | null | undefined) => string;
  normalizeAuditActor: (value: unknown) => string;
  resolveAdminUserIdentity: (input: {
    userId?: string | null;
    userEmail?: string | null;
    actor?: unknown;
    displayName?: string | null;
  }) => AdminUserIdentityView;
  renderAuditSummary: (text: string) => any;
};

const ROW_HEIGHT = 56;
const OVERSCAN = 12;

export default function TimecardTableSection({
  t,
  themeMode,
  isLocked,
  timecardLoading,
  serverTime,
  timecardWeekOffset,
  timecardWeekStart,
  startOfWeekMonday,
  addDays,
  toDateOnly,
  formatHours,
  getSchedulePositionBadgeClass,
  timecardDayTotalHours,
  timecardDayAttendanceCount,
  timecardPresentDayFilter,
  setTimecardPresentDayFilter,
  timecardAgencySort,
  timecardTotalSort,
  onToggleTimecardAgencySort,
  onToggleTimecardTotalSort,
  timecardRowsRendered,
  timecardAuditByStaffDate,
  openTimecardPunchModal,
  formatAuditDetail,
  formatCellAuditTime,
  normalizeAuditActor,
  resolveAdminUserIdentity,
  renderAuditSummary
}: TimecardTableSectionProps) {
  const isLight = themeMode === 'light';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [visibleStartIndex, setVisibleStartIndex] = useState(0);
  const [containerHeightPx, setContainerHeightPx] = useState(() => Math.round(window.innerHeight * 0.68));

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateHeight = () => {
      setContainerHeightPx((prev) => {
        const next = element.clientHeight || Math.round(window.innerHeight * 0.68);
        return next === prev ? prev : next;
      });
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  const visibleRange = useMemo(() => {
    const visibleCount = Math.ceil(containerHeightPx / ROW_HEIGHT) + OVERSCAN * 2;
    const start = Math.max(0, visibleStartIndex - OVERSCAN);
    const end = Math.min(timecardRowsRendered.length, start + visibleCount);
    return { start, end };
  }, [visibleStartIndex, containerHeightPx, timecardRowsRendered.length]);

  const visibleRows = useMemo(
    () => timecardRowsRendered.slice(visibleRange.start, visibleRange.end),
    [timecardRowsRendered, visibleRange]
  );

  const handleBodyScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const nextStart = Math.floor(target.scrollTop / ROW_HEIGHT);
      setVisibleStartIndex((prev) => (prev === nextStart ? prev : nextStart));
    });
  }, []);

  const baseWeekStart = startOfWeekMonday(serverTime);
  const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
  const days = [t('周一', 'Mon'), t('周二', 'Tue'), t('周三', 'Wed'), t('周四', 'Thu'), t('周五', 'Fri'), t('周六', 'Sat'), t('周日', 'Sun')];

  const renderAuditPopover = (rows: any[]) => {
    if (!rows.length) return null;
    return (
      <div
        className={[
          'pointer-events-none invisible absolute right-0 top-full z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border p-2 text-[11px] opacity-0 shadow-2xl transition group-hover:visible group-hover:opacity-100',
          isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-700 bg-[#16181c] text-slate-100'
        ].join(' ')}
      >
        <div className={['mb-1 text-[10px] uppercase tracking-[0.14em]', isLight ? 'text-neon' : 'text-emerald-300'].join(' ')}>
          {t('最近操作', 'Recent changes')}
        </div>
        <div className="space-y-1">
          {rows.slice(0, 1).map((item: any) => {
            const detail = formatAuditDetail(item);
            const actorIdentity = resolveAdminUserIdentity({
              actor: item.actor_raw ?? item.actor,
              displayName: normalizeAuditActor(item.actor_raw ?? item.actor)
            });
            return (
              <div
                key={String(item.id ?? `${item.created_at ?? ''}_${item.action ?? ''}`)}
                className={['rounded-md px-1.5 py-1 text-left', isLight ? 'bg-slate-100' : 'bg-slate-800'].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <AdminUserAvatar
                    name={actorIdentity.displayName}
                    avatarUrl={actorIdentity.avatarUrl}
                    fallbackInitial={actorIdentity.fallbackInitial}
                    size={20}
                    className={isLight ? 'border-slate-200 bg-slate-200 text-slate-700' : 'border-white/10 bg-slate-700 text-slate-100'}
                  />
                  <div className="min-w-0">
                    <div className={['truncate text-[10px] font-medium', isLight ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                      {actorIdentity.displayName || '-'}
                    </div>
                    <div className={['text-[10px]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                      {formatCellAuditTime(item.created_at)}
                    </div>
                  </div>
                </div>
                <div className={['mt-1', isLight ? 'text-slate-800' : 'text-slate-100'].join(' ')}>{renderAuditSummary(detail.summary)}</div>
                {detail.details.slice(0, 2).map((entry: any, index: number) => (
                  <div
                    key={`${String(item.id ?? 'row')}_${entry.label}_${index}`}
                    className={['mt-0.5 text-[10px]', isLight ? 'text-slate-600' : 'text-slate-300'].join(' ')}
                  >
                    <span className={isLight ? 'text-slate-500' : 'text-slate-400'}>{entry.label}: </span>
                    <span className="whitespace-normal break-words">{entry.value}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderRow = (row: any, realIndex: number) => (
    <tr
      key={`${row.staff_id}__${row.position}__${row.agency}__${realIndex}`}
      className={[
        'border-b transition last:border-0',
        isLight ? 'border-slate-200 hover:bg-slate-100' : 'border-white/5 hover:bg-white/5'
      ].join(' ')}
    >
      <td className="px-2 py-1.5 font-mono text-slate-200">{row.staff_id}</td>
      <td className="px-2 py-1.5 truncate text-slate-200">{row.name || '-'}</td>
      <td className="px-2 py-1.5 truncate text-slate-200">{row.agency || '-'}</td>
      <td className="px-2 py-1.5 truncate text-slate-200">
        {isLight ? (
          <span
            className={[
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
              getSchedulePositionBadgeClass(row.position)
            ].join(' ')}
          >
            {row.position || '-'}
          </span>
        ) : (
          <GlowLabelChip tone={getGlowToneForPosition(row.position)} className="min-w-[54px] uppercase tracking-[0.12em]">
            {row.position || '-'}
          </GlowLabelChip>
        )}
      </td>
      <td className="px-2 py-1.5 text-center text-slate-200">
        {row.shift === 'early' ? (
          isLight ? (
            <span className="inline-flex items-center rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
              {t('早班', 'Morning')}
            </span>
          ) : (
            <GlowLabelChip tone={getGlowToneForShift(row.shift)} className="min-w-[52px] uppercase tracking-[0.12em]">
              {t('早班', 'Morning')}
            </GlowLabelChip>
          )
        ) : row.shift === 'late' ? (
          isLight ? (
            <span className="inline-flex items-center rounded-full border border-indigo-300/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-200">
              {t('晚班', 'Night')}
            </span>
          ) : (
            <GlowLabelChip tone={getGlowToneForShift(row.shift)} className="min-w-[52px] uppercase tracking-[0.12em]">
              {t('晚班', 'Night')}
            </GlowLabelChip>
          )
        ) : (
          <span className="text-slate-500">-</span>
        )}
      </td>
      {row.hoursByDay.map((hours: number, dayIndex: number) => (
        <td key={dayIndex} className="w-[92px] px-2 py-1.5 text-center align-middle text-slate-200">
          {(() => {
            const timecardAuditKey = `${row.staff_id}__${toDateOnly(addDays(timecardWeekStart, dayIndex))}`;
            const timecardCellAudit = timecardAuditByStaffDate.get(timecardAuditKey) ?? [];
            const hoursText = getTimecardCellHoursText({
              hours,
              punchCount: Number(row.punchCountByDay?.[dayIndex] ?? 0),
              inProgress: Boolean(row.inProgressByDay?.[dayIndex])
            });
            const late = Boolean(row.lateByDay?.[dayIndex]);
            const lateMinutes = Number(row.lateMinutesByDay?.[dayIndex] ?? 0);
            const lateTitle = late ? `${t('迟到', 'Late')} ${lateMinutes}${t('分钟', 'm')}` : '';

            return (
              <div className="group relative inline-flex items-center justify-center">
                {hoursText ? (
                  (() => {
                    const over8 = hours > 8.5;
                    const button = (
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => void openTimecardPunchModal(row.staff_id, dayIndex)}
                        className={(() => {
                      const inProgress = row.inProgressByDay[dayIndex];
                      const manual = row.manualByDay[dayIndex];
                      const punchCountMismatch = row.punchCountMismatchByDay[dayIndex];
                      const latestPunchReviewAction = timecardCellAudit.find((item: any) => {
                        const action = String(item?.action ?? '').trim();
                        return ['punch_count_verified', 'punch_manual_add', 'punch_manual_edit', 'punch_manual_delete'].includes(action);
                      })?.action;
                      const punchCountVerified = latestPunchReviewAction === 'punch_count_verified';
                      const base = 'rounded px-1.5 py-0.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
                      if (manual) return [base, 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'].join(' ');
                      if (punchCountMismatch) {
                        return punchCountVerified
                          ? [base, 'border-2 border-teal-500 bg-teal-500/20 text-teal-100 shadow-[0_0_0_1px_rgba(20,184,166,0.55)] hover:bg-teal-500/30'].join(' ')
                          : [base, 'border-2 border-rose-500 bg-rose-500/20 text-rose-100 shadow-[0_0_0_1px_rgba(244,63,94,0.55)] hover:bg-rose-500/30'].join(' ');
                      }
                      if (over8) return [base, 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'].join(' ');
                      if (inProgress) return [base, 'bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'].join(' ');
                      return [base, 'bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'].join(' ');
                        })()}
                        title={[t('查看/编辑打卡流水', 'View/Edit Punch Log'), lateTitle].filter(Boolean).join(' | ')}
                      >
                        {hoursText}
                      </button>
                    );
                    if (!over8) return button;
                    return (
                      <ElectricBorder
                        className="eb-chip rounded"
                        color="#fb365d"
                        speed={1.25}
                        chaos={0.09}
                        thickness={1.2}
                        borderRadius={6}
                      >
                        {button}
                      </ElectricBorder>
                    );
                  })()
                ) : late ? (
                  <span
                    className="inline-flex rounded border border-amber-300/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200"
                    title={lateTitle || t('迟到', 'Late')}
                  >
                    {t('迟到', 'Late')}
                  </span>
                ) : row.absentByDay[dayIndex] ? (
                  <span className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold text-rose-200" title="Scheduled but no punch">
                    {t('缺勤', 'Absent')}
                  </span>
                ) : row.leaveByDay[dayIndex] ? (
                  <span className="text-[11px] font-semibold text-violet-300" title="Excuse">
                    {t('请假', 'Excuse')}
                  </span>
                ) : row.tempRestByDay[dayIndex] ? (
                  <span className="text-[11px] font-semibold text-amber-300" title="Temporary Off">
                    {t('临时排休', 'Temp Off')}
                  </span>
                ) : row.terminatedByDay?.[dayIndex] ? (
                  <span className="text-[11px] font-semibold text-slate-400" title="Terminated">
                    {t('离职', 'Terminated')}
                  </span>
                ) : row.restByDay[dayIndex] &&
                  toDateOnly(addDays(addDays(startOfWeekMonday(serverTime), timecardWeekOffset * 7), dayIndex)) <= toDateOnly(serverTime) ? (
                  <span className="text-[11px] font-semibold text-amber-300" title="Off">
                    {t('休息', 'Off')}
                  </span>
                ) : (
                  ''
                )}

                {late ? (
                  <span
                    className="pointer-events-none absolute -left-1 -top-1 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.55)]"
                    title={lateTitle || t('迟到', 'Late')}
                  />
                ) : null}
                {timecardCellAudit.length > 0 ? (
                  <span className="pointer-events-none absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.55)]" />
                ) : null}
                {renderAuditPopover(timecardCellAudit)}
              </div>
            );
          })()}
        </td>
      ))}
      <td className="w-[92px] px-2 py-1.5 text-center align-middle font-semibold text-slate-200">
        {(() => {
          const totalHoursText = getTimecardTotalHoursText({
            totalHours: Number(row.totalHours ?? 0),
            punchCounts: Array.isArray(row.punchCountByDay) ? row.punchCountByDay : [],
            inProgressWeek: Boolean(row.inProgressWeek)
          });
          if (!totalHoursText) return '';
          return (
            <button
              type="button"
              disabled={isLocked}
              onClick={() => void openTimecardPunchModal(row.staff_id, null)}
              className={(() => {
                const hasOver8 = row.hoursByDay.some((value: number) => value > 8.5);
                const inProgress = row.inProgressWeek;
                const manual = row.manualWeek;
                const base = 'rounded px-1.5 py-0.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
                if (manual) return [base, 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'].join(' ');
                if (hasOver8) return [base, 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'].join(' ');
                if (inProgress) return [base, 'bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'].join(' ');
                return [base, 'bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'].join(' ');
              })()}
              title={t('查看本周打卡流水（只读）', 'View this week punch log (read-only)')}
            >
              {totalHoursText}
            </button>
          );
        })()}
      </td>
    </tr>
  );

  return (
    <div
      ref={containerRef}
      className="relative mt-5 min-h-0 flex-1 overflow-auto overscroll-contain rounded-2xl border border-white/10 bg-black/30 [scrollbar-gutter:stable]"
      style={{ contain: 'layout paint style' }}
      onScroll={handleBodyScroll}
    >
      <table className="min-w-[1500px] w-full table-fixed text-left text-xs leading-tight">
        <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-[10px] uppercase tracking-[0.16em] text-slate-400 backdrop-blur">
          <tr>
            <th className="w-[108px] px-2 py-1.5">ID</th>
            <th className="w-[200px] px-2 py-1.5">Name</th>
            <th className="w-[140px] px-2 py-1.5">
              <button
                type="button"
                disabled={isLocked}
                onClick={onToggleTimecardAgencySort}
                className={[
                  'inline-flex items-center gap-1 rounded px-1 py-0.5 transition',
                  timecardAgencySort ? 'text-sky-300 hover:bg-white/10' : 'text-slate-400 hover:bg-white/10',
                  isLocked ? 'cursor-not-allowed opacity-60' : ''
                ].join(' ')}
                title={t('按 Agency 排序', 'Sort by agency')}
              >
                <span>Agency</span>
              </button>
            </th>
            <th className="w-[120px] px-2 py-1.5">{t('岗位', 'Position')}</th>
            <th className="w-[80px] px-2 py-1.5">{t('班次', 'Shift')}</th>
            {days.map((label, index) => (
              <th key={label} className="w-[92px] whitespace-nowrap px-2 py-1.5 text-center">
                <div className="text-neon">{`${t('总工时', 'Total')} ${formatHours(timecardDayTotalHours[index]) || '0'}`}</div>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setTimecardPresentDayFilter((prev) => (prev === index ? null : index))}
                  className={[
                    'rounded px-1 py-0.5 text-[10px] transition',
                    timecardPresentDayFilter === index ? 'bg-sky-500/20 text-sky-100' : 'text-sky-300 hover:bg-white/10',
                    isLocked ? 'cursor-not-allowed opacity-60' : ''
                  ].join(' ')}
                  title={timecardPresentDayFilter === index ? 'Clear present filter' : 'Filter present staff'}
                >
                  {`${t('出勤', 'Present')} ${timecardDayAttendanceCount[index] ?? 0}`}
                </button>
                <div>
                  {label} {toDateOnly(addDays(weekStart, index)).slice(5)}
                </div>
              </th>
            ))}
            <th className="w-[92px] px-2 py-1.5 text-center">
              <button
                type="button"
                disabled={isLocked}
                onClick={onToggleTimecardTotalSort}
                className={[
                  'inline-flex items-center justify-center gap-1 rounded px-1 py-0.5 transition',
                  timecardTotalSort ? 'text-sky-300 hover:bg-white/10' : 'text-slate-400 hover:bg-white/10',
                  isLocked ? 'cursor-not-allowed opacity-60' : ''
                ].join(' ')}
                title={t('按合计工时排序', 'Sort by total hours')}
              >
                <span>{t('合计', 'Total')}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleRange.start > 0 ? (
            <tr>
              <td colSpan={12} style={{ height: `${visibleRange.start * ROW_HEIGHT}px` }} />
            </tr>
          ) : null}

          {visibleRows.map((row, index) => renderRow(row, visibleRange.start + index))}

          {visibleRange.end < timecardRowsRendered.length ? (
            <tr>
              <td colSpan={12} style={{ height: `${(timecardRowsRendered.length - visibleRange.end) * ROW_HEIGHT}px` }} />
            </tr>
          ) : null}
        </tbody>
      </table>

      {timecardLoading ? (
        <div
          className={[
            'pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-2xl border backdrop-blur-sm',
            isLight ? 'border-slate-200/90 bg-white/80' : 'border-white/10 bg-slate-950/70'
          ].join(' ')}
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-neon to-transparent opacity-80" />
        </div>
      ) : null}
    </div>
  );
}
