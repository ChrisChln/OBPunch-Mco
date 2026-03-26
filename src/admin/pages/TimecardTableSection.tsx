type TranslateFn = (zh: string, en: string) => string;

import { useRef, useState, useMemo, useCallback } from 'react';
import { getTimecardCellHoursText, getTimecardTotalHoursText } from '../timecardDisplay';

type TimecardTableSectionProps = {
  t: TranslateFn;
  isLocked: boolean;
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
  onToggleTimecardAgencySort: () => void;
  timecardRowsRendered: any[];
  timecardAuditByStaffDate: Map<string, any[]>;
  openTimecardPunchModal: (staffId: string, dayIndex: number | null) => void | Promise<void>;
  formatAuditDetail: (row: any) => { summary: string; details: Array<{ label: string; value: string }> };
  formatCellAuditTime: (value: string | null | undefined) => string;
  normalizeAuditActor: (value: unknown) => string;
  renderAuditSummary: (text: string) => any;
};

// 虚拟滚动配置
const ROW_HEIGHT = 56;
const OVERSCAN = 12;

export default function TimecardTableSection({
  t,
  isLocked,
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
  onToggleTimecardAgencySort,
  timecardRowsRendered,
  timecardAuditByStaffDate,
  openTimecardPunchModal,
  formatAuditDetail,
  formatCellAuditTime,
  normalizeAuditActor,
  renderAuditSummary
}: TimecardTableSectionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  // 计算可见范围 (虚拟滚动)
  const containerHeightPx = useMemo(() => {
    if (!containerRef.current) return window.innerHeight * 0.68;
    return containerRef.current.clientHeight;
  }, []);

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollOffset / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      timecardRowsRendered.length,
      Math.ceil((scrollOffset + containerHeightPx) / ROW_HEIGHT) + OVERSCAN
    );
    return { start, end };
  }, [scrollOffset, containerHeightPx, timecardRowsRendered.length]);

  // 仅渲染可见的行
  const visibleRows = useMemo(
    () => timecardRowsRendered.slice(visibleRange.start, visibleRange.end),
    [timecardRowsRendered, visibleRange]
  );

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollOffset(target.scrollTop);
  }, []);

  const baseWeekStart = startOfWeekMonday(serverTime);
  const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
  const days = [t('周一', 'Mon'), t('周二', 'Tue'), t('周三', 'Wed'), t('周四', 'Thu'), t('周五', 'Fri'), t('周六', 'Sat'), t('周日', 'Sun')];

  // 提取行渲染逻辑为独立函数
  const renderRow = (r: any, realIndex: number) => (
    <tr key={`${r.staff_id}__${r.position}__${r.agency}__${realIndex}`} className="border-b border-white/5 transition hover:bg-white/5 last:border-0">
      <td className="px-2 py-1.5 font-mono text-slate-200">{r.staff_id}</td>
      <td className="px-2 py-1.5 text-slate-200 truncate">{r.name || '-'}</td>
      <td className="px-2 py-1.5 text-slate-200 truncate">{r.agency || '-'}</td>
      <td className="px-2 py-1.5 text-slate-200 truncate">
        <span
          className={[
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
            getSchedulePositionBadgeClass(r.position)
          ].join(' ')}
        >
          {r.position || '-'}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center text-slate-200">
        {r.shift === 'early' ? (
          <span className="inline-flex items-center rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
            {t('早班', 'Morning')}
          </span>
        ) : r.shift === 'late' ? (
          <span className="inline-flex items-center rounded-full border border-indigo-300/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-200">
            {t('晚班', 'Night')}
          </span>
        ) : (
          <span className="text-slate-500">-</span>
        )}
      </td>
      {r.hoursByDay.map((h: number, idx: number) => (
        <td key={idx} className="w-[92px] px-2 py-1.5 text-center align-middle text-slate-200">
          {(() => {
            const timecardAuditKey = `${r.staff_id}__${toDateOnly(addDays(timecardWeekStart, idx))}`;
            const timecardCellAudit = timecardAuditByStaffDate.get(timecardAuditKey) ?? [];
            const hoursText = getTimecardCellHoursText({
              hours: h,
              punchCount: Number(r.punchCountByDay?.[idx] ?? 0),
              inProgress: Boolean(r.inProgressByDay?.[idx])
            });
            const late = Boolean(r.lateByDay?.[idx]);
            const lateMinutes = Number(r.lateMinutesByDay?.[idx] ?? 0);
            const lateTitle = late ? `${t('迟到', 'Late')} ${lateMinutes}${t('分钟', 'm')}` : '';
            return (
              <div className="group relative inline-flex items-center justify-center">
                {hoursText ? (
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => void openTimecardPunchModal(r.staff_id, idx)}
                    className={(() => {
                      const over8 = h > 8.5;
                      const inProgress = r.inProgressByDay[idx];
                      const manual = r.manualByDay[idx];
                      const punchCountMismatch = r.punchCountMismatchByDay[idx];
                      const latestPunchReviewAction = timecardCellAudit.find((item: any) => {
                        const action = String(item?.action ?? '').trim();
                        return (
                          action === 'punch_count_verified' ||
                          action === 'punch_manual_add' ||
                          action === 'punch_manual_edit' ||
                          action === 'punch_manual_delete'
                        );
                      })?.action;
                      const punchCountVerified = latestPunchReviewAction === 'punch_count_verified';
                      const base = 'rounded px-1.5 py-0.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
                      if (manual) return [base, 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'].join(' ');
                      if (punchCountMismatch) {
                        if (punchCountVerified) {
                          return [
                            base,
                            'border-2 border-teal-500 bg-teal-500/20 text-teal-100 shadow-[0_0_0_1px_rgba(20,184,166,0.55)] hover:bg-teal-500/30'
                          ].join(' ');
                        }
                        return [
                          base,
                          'border-2 border-rose-500 bg-rose-500/20 text-rose-100 shadow-[0_0_0_1px_rgba(244,63,94,0.55)] hover:bg-rose-500/30'
                        ].join(' ');
                      }
                      if (over8) return [base, 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'].join(' ');
                      if (inProgress) return [base, 'bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'].join(' ');
                      return [base, 'bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'].join(' ');
                    })()}
                    title={[t('查看/编辑打卡流水', 'View/Edit Punch Log'), lateTitle].filter(Boolean).join(' | ')}
                  >
                    {hoursText}
                  </button>
                ) : late ? (
                  <span
                    className="inline-flex rounded border border-amber-300/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200"
                    title={lateTitle || t('迟到', 'Late')}
                  >
                    {t('迟到', 'Late')}
                  </span>
                ) : r.absentByDay[idx] ? (
                  <span className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold text-rose-200" title="Scheduled but no punch">
                    {t('缺勤', 'Absent')}
                  </span>
                ) : r.leaveByDay[idx] ? (
                  <span className="text-[11px] font-semibold text-violet-300" title="Excuse">
                    {t('请假', 'Excuse')}
                  </span>
                ) : r.tempRestByDay[idx] ? (
                  <span className="text-[11px] font-semibold text-amber-300" title="Temporary Off">
                    {t('临时排休', 'Temp Off')}
                  </span>
                ) : r.terminatedByDay?.[idx] ? (
                  <span className="text-[11px] font-semibold text-slate-400" title="Terminated">
                    {t('离职', 'Terminated')}
                  </span>
                ) : r.restByDay[idx] &&
                  toDateOnly(addDays(addDays(startOfWeekMonday(serverTime), timecardWeekOffset * 7), idx)) <= toDateOnly(serverTime) ? (
                  <span className="text-[11px] font-semibold text-amber-300" title="Off">
                    {t('休息', 'Off')}
                  </span>
                ) : (
                  ''
                )}
                {late && (
                  <span
                    className="pointer-events-none absolute -left-1 -top-1 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(251,191,36,0.55)]"
                    title={lateTitle || t('迟到', 'Late')}
                  />
                )}
                {timecardCellAudit.length > 0 && (
                  <span className="pointer-events-none absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.55)]" />
                )}
                {timecardCellAudit.length > 0 && (
                  <div className="pointer-events-none invisible absolute right-0 top-full z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 text-[11px] text-slate-700 opacity-0 shadow-2xl transition group-hover:visible group-hover:opacity-100">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-neon">{t('最近操作', 'Recent changes')}</div>
                    <div className="space-y-1">
                      {timecardCellAudit.slice(0, 1).map((item: any) => {
                        const detail = formatAuditDetail(item);
                        return (
                          <div key={String(item.id ?? `${item.created_at ?? ''}_${item.action ?? ''}`)} className="rounded-md bg-slate-100 px-1.5 py-1 text-left">
                            <div className="text-[10px] text-slate-500">
                              {formatCellAuditTime(item.created_at)} · {normalizeAuditActor((item as any).actor) || '-'}
                            </div>
                            <div>{renderAuditSummary(detail.summary)}</div>
                            {detail.details.slice(0, 2).map((d: any, idx2: number) => (
                              <div key={`${String(item.id ?? 'row')}_${d.label}_${idx2}`} className="mt-0.5 text-[10px] text-slate-600">
                                <span className="text-slate-500">{d.label}: </span>
                                <span className="whitespace-normal break-words">{d.value}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </td>
      ))}
      <td className="w-[92px] px-2 py-1.5 text-center align-middle font-semibold text-slate-200">
        {(() => {
          const totalHoursText = getTimecardTotalHoursText({
            totalHours: Number(r.totalHours ?? 0),
            punchCounts: Array.isArray(r.punchCountByDay) ? r.punchCountByDay : [],
            inProgressWeek: Boolean(r.inProgressWeek)
          });
          if (!totalHoursText) return '';
          return (
            <button
              type="button"
              disabled={isLocked}
              onClick={() => void openTimecardPunchModal(r.staff_id, null)}
              className={(() => {
                const hasOver8 = r.hoursByDay.some((v: number) => v > 8.5);
                const inProgress = r.inProgressWeek;
                const manual = r.manualWeek;
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
      className="no-scrollbar mt-5 min-h-[320px] max-h-[68vh] overflow-auto rounded-2xl border border-white/10 bg-black/30"
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
            {days.map((label, idx) => (
              <th key={label} className="w-[92px] px-2 py-1.5 whitespace-nowrap text-center">
                <div className="text-neon">{`${t('总工时', 'Total')} ${formatHours(timecardDayTotalHours[idx]) || '0'}`}</div>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setTimecardPresentDayFilter((prev) => (prev === idx ? null : idx))}
                  className={[
                    'rounded px-1 py-0.5 text-[10px] transition',
                    timecardPresentDayFilter === idx ? 'bg-sky-500/20 text-sky-100' : 'text-sky-300 hover:bg-white/10',
                    isLocked ? 'cursor-not-allowed opacity-60' : ''
                  ].join(' ')}
                  title={timecardPresentDayFilter === idx ? 'Clear present filter' : 'Filter present staff'}
                >
                  {`${t('出勤', 'Present')} ${timecardDayAttendanceCount[idx] ?? 0}`}
                </button>
                <div>
                  {label} {toDateOnly(addDays(weekStart, idx)).slice(5)}
                </div>
              </th>
            ))}
            <th className="w-[92px] px-2 py-1.5 text-center">{t('合计', 'Total')}</th>
          </tr>
        </thead>
        <tbody>
          {/* 顶部 spacer - 占位符以保持滚动位置 */}
          {visibleRange.start > 0 && (
            <tr>
              <td colSpan={12} style={{ height: `${visibleRange.start * ROW_HEIGHT}px` }} />
            </tr>
          )}

          {/* 渲染可见的行 */}
          {visibleRows.map((r, idx) => renderRow(r, visibleRange.start + idx))}

          {/* 底部 spacer - 占位符以保持滚动位置 */}
          {visibleRange.end < timecardRowsRendered.length && (
            <tr>
              <td colSpan={12} style={{ height: `${(timecardRowsRendered.length - visibleRange.end) * ROW_HEIGHT}px` }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
