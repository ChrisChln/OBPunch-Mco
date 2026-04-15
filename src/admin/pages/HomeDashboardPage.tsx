import { memo, useMemo, useState } from 'react';
import type { LabelToneKey } from '../../lib/labelTone';
import type { AllowedPosition } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type HomeRosterRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: string;
  attendance?: AttendanceView;
  label?: string;
  borrowed_device?: string;
  account?: string;
  mistake_count_7d?: number;
  punches?: Array<{ action: 'IN' | 'OUT'; created_at: string }>;
};

type HomeDashboardPageProps = {
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  homeCardStats: Record<string, { early: number; late: number; active: number }>;
  homeExpectedPositionSummaryCards: Array<{ position: string; early: number; late: number; total: number }>;
  getHomeCardToneClass: (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) => string;
  getHomeChipToneClass: (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) => string;
  getScheduleLabelToneClass: (label: string) => string;
  getHomePanelToneClass: (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) => string;
  getSchedulePositionBadgeClass: (position: string) => string;
  schedulePositionToneByPosition: Partial<Record<AllowedPosition, LabelToneKey>>;
  homeRosterPositionFilter: 'ALL' | AllowedPosition;
  setHomeRosterPositionFilter: (value: 'ALL' | AllowedPosition) => void;
  onOpenTimecardCalibration?: (staffId: string, workDate: string) => void | Promise<void>;
  homeRosterRowsCurrent: HomeRosterRow[];
};

type IconProps = { className?: string };

type AttendanceView = 'Absent' | 'Off Worked' | 'Normal' | 'Completed';

type TableRow = HomeRosterRow & {
  label: string;
  mistake_count_7d: number;
  attendance: AttendanceView;
  punches: Array<{ action: 'IN' | 'OUT'; created_at: string }>;
};

const POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'FLEX TEAM'] as const;
const OUTBOUND_SUMMARY_POSITIONS = POSITIONS.filter((position) => position !== 'Transfer');
const iconStrokeClass = 'h-4 w-4 shrink-0';

const SearchIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l5 5" strokeLinecap="round" />
  </svg>
);

const ChevronDownIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const normalizePositionKey = (value: string): '' | (typeof POSITIONS)[number] => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v.includes('pick')) return 'Pick';
  if (v.includes('pack')) return 'Pack';
  if (v.includes('rebin')) return 'Rebin';
  if (v.includes('preship')) return 'Preship';
  if (v.includes('transfer')) return 'Transfer';
  if (v.includes('flex') || v.includes('兜底') || v.includes('wrap')) return 'FLEX TEAM';
  return '';
};

const normalizeShiftValue = (value: unknown): '' | 'early' | 'late' => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'early' || v === 'morning' || v.includes('早')) return 'early';
  if (v === 'late' || v === 'night' || v.includes('晚')) return 'late';
  return '';
};

const formatShiftLabel = (value: string) => {
  const v = normalizeShiftValue(value);
  if (v === 'early') return 'Morning';
  if (v === 'late') return 'Night';
  return value || '-';
};

const formatTimeOnly = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-CA', { hour12: false });
};

const toLocalDateOnly = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const SHORT_GAP_MINUTES = 10;

const getShortGapPunchIndices = (punches: Array<{ action: 'IN' | 'OUT'; created_at: string }>) => {
  const result = new Set<number>();
  for (let index = 1; index < punches.length; index += 1) {
    const prevMs = new Date(String(punches[index - 1]?.created_at ?? '')).getTime();
    const currentMs = new Date(String(punches[index]?.created_at ?? '')).getTime();
    if (!Number.isFinite(prevMs) || !Number.isFinite(currentMs)) continue;
    const diffMinutes = Math.abs(currentMs - prevMs) / (60 * 1000);
    if (diffMinutes <= SHORT_GAP_MINUTES) {
      result.add(index - 1);
      result.add(index);
    }
  }
  return result;
};

const getAttendanceCardClass = (position: string) => {
  if (position === 'Pick') return 'border-sky-300/20 bg-sky-400/[0.08]';
  if (position === 'Pack') return 'border-emerald-300/20 bg-emerald-400/[0.08]';
  if (position === 'Rebin') return 'border-amber-300/20 bg-amber-400/[0.08]';
  if (position === 'Preship') return 'border-rose-300/20 bg-rose-400/[0.08]';
  if (position === 'Transfer') return 'border-violet-300/20 bg-violet-400/[0.08]';
  return 'border-white/10 bg-white/[0.04]';
};

const getAttendanceCardValueClass = (position: string) => {
  if (position === 'Pick') return 'text-sky-100';
  if (position === 'Pack') return 'text-emerald-100';
  if (position === 'Rebin') return 'text-amber-100';
  if (position === 'Preship') return 'text-rose-100';
  if (position === 'Transfer') return 'text-violet-100';
  return 'text-stone-100';
};

function HomeDashboardPage({
  t,
  themeMode: _themeMode,
  homeCardStats,
  homeExpectedPositionSummaryCards,
  getHomeCardToneClass: _getHomeCardToneClass,
  getHomeChipToneClass: _getHomeChipToneClass,
  getScheduleLabelToneClass,
  getHomePanelToneClass: _getHomePanelToneClass,
  getSchedulePositionBadgeClass,
  schedulePositionToneByPosition: _schedulePositionToneByPosition,
  homeRosterPositionFilter: _homeRosterPositionFilter,
  setHomeRosterPositionFilter,
  onOpenTimecardCalibration,
  homeRosterRowsCurrent
}: HomeDashboardPageProps) {
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [absentOnly, setAbsentOnly] = useState(false);
  const [onClockOnly, setOnClockOnly] = useState(false);
  const [offWorkOnly, setOffWorkOnly] = useState(false);

  const summaryByPosition = useMemo(() => {
    const map = new Map<string, { early: number; late: number; total: number }>();
    for (const item of homeExpectedPositionSummaryCards) {
      const key = normalizePositionKey(item.position) || item.position;
      map.set(key, { early: item.early, late: item.late, total: item.total });
    }
    return map;
  }, [homeExpectedPositionSummaryCards]);

  const outboundShiftCards = useMemo(() => {
    const morningPresent = OUTBOUND_SUMMARY_POSITIONS.reduce((sum, position) => sum + (homeCardStats[position]?.early ?? 0), 0);
    const morningExpected = OUTBOUND_SUMMARY_POSITIONS.reduce((sum, position) => sum + (summaryByPosition.get(position)?.early ?? 0), 0);
    const nightPresent = OUTBOUND_SUMMARY_POSITIONS.reduce((sum, position) => sum + (homeCardStats[position]?.late ?? 0), 0);
    const nightExpected = OUTBOUND_SUMMARY_POSITIONS.reduce((sum, position) => sum + (summaryByPosition.get(position)?.late ?? 0), 0);
    return [
      { shift: 'early' as const, present: morningPresent, expected: morningExpected },
      { shift: 'late' as const, present: nightPresent, expected: nightExpected }
    ];
  }, [homeCardStats, summaryByPosition]);

  const attendanceCardGroups = useMemo(
    () =>
      (['early', 'late'] as const).map((shift) => ({
        shift,
        cards: POSITIONS.map((position) => {
          const stats = homeCardStats[position] ?? { early: 0, late: 0, active: 0 };
          const plan = summaryByPosition.get(position) ?? { early: 0, late: 0, total: 0 };
          const offWorked =
            shift === 'early'
              ? 0
              : homeRosterRowsCurrent.filter((row) => normalizePositionKey(row.position) === position && row.attendance === 'Off Worked').length;
          return {
            position,
            shift,
            expected: shift === 'early' ? plan.early : plan.late,
            present: shift === 'early' ? stats.early : stats.late,
            onClock: shift === 'early' ? stats.early : stats.late,
            offWorked
          };
        })
      })),
    [homeCardStats, summaryByPosition, homeRosterRowsCurrent]
  );

  const positionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of homeRosterRowsCurrent) {
      const key = normalizePositionKey(row.position) || row.position;
      if (key) set.add(key);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [homeRosterRowsCurrent]);

  const shiftOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of homeRosterRowsCurrent) {
      const shift = normalizeShiftValue(row.shift);
      if (shift) set.add(shift);
    }
    return Array.from(set);
  }, [homeRosterRowsCurrent]);

  const tableRows = useMemo<TableRow[]>(
    () =>
      homeRosterRowsCurrent.map((row) => ({
        ...row,
        label: String(row.label ?? '').trim() || (row.position ? `${row.position} Lead` : '-'),
        mistake_count_7d: Number(row.mistake_count_7d ?? 0),
        attendance: row.attendance ?? 'Normal',
        punches: Array.isArray(row.punches) ? row.punches : []
      })),
    [homeRosterRowsCurrent]
  );

  const renderedRows = useMemo(() => {
    const attendanceFilters: AttendanceView[] = [];
    if (absentOnly) attendanceFilters.push('Absent');
    if (onClockOnly) attendanceFilters.push('Normal');
    if (offWorkOnly) attendanceFilters.push('Off Worked');

    return tableRows.filter((row) => {
      const q = search.trim().toLowerCase();
      if (
        q &&
        !String(row.staff_id ?? '').toLowerCase().includes(q) &&
        !String(row.name ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      if (positionFilter) {
        const key = normalizePositionKey(row.position) || row.position;
        if (key !== positionFilter) return false;
      }
      if (shiftFilter) {
        const rowShift = normalizeShiftValue(row.shift);
        if (rowShift !== shiftFilter) return false;
      }
      if (attendanceFilters.length > 0 && !attendanceFilters.includes(row.attendance)) return false;
      return true;
    });
  }, [tableRows, search, positionFilter, shiftFilter, absentOnly, onClockOnly, offWorkOnly]);

  const operationalDate = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const lastUpdatedAt = useMemo(() => {
    return new Date().toLocaleString('en-CA', { hour12: false });
  }, []);

  return (
    <main className="h-full w-full text-paper">
      <section className="glass w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="space-y-3">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-300">
            Operational Dashboard
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-4xl leading-none tracking-[0.03em] text-stone-50 sm:text-5xl">Dashboard</h1>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 rounded-[28px] border border-white/10 bg-black/20 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Schedule Date</div>
              <div className="text-xl font-semibold tracking-[-0.02em] text-stone-50">{operationalDate || '-'}</div>
              <div className="text-sm text-stone-400">Updated {lastUpdatedAt || '-'}</div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {outboundShiftCards.map((card) => {
              const ratio = card.expected > 0 ? (card.present / card.expected) * 100 : 0;
              const isMorning = card.shift === 'early';
              return (
                <div key={`outbound:${card.shift}`} className={['rounded-[24px] border px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]', getAttendanceCardClass(isMorning ? 'Pick' : 'Transfer')].join(' ')}>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">{isMorning ? 'Outbound Morning' : 'Outbound Night'}</div>
                      <div className="mt-3 flex items-end gap-3">
                        <span className="text-3xl font-semibold tracking-[-0.03em] text-stone-50">{card.present}/{card.expected}</span>
                        <span className={['pb-1 text-sm font-semibold', ratio < 80 ? 'text-rose-300' : ratio >= 90 ? getAttendanceCardValueClass(isMorning ? 'Pick' : 'Transfer') : 'text-stone-300'].join(' ')}>
                          {card.expected > 0 ? `${ratio.toFixed(1)}% coverage` : '0.0% coverage'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            {attendanceCardGroups.map((group) => (
              <div key={`attendance:${group.shift}`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                {group.cards.map((card) => {
                  const ratio = card.expected > 0 ? (card.present / card.expected) * 100 : 0;
                  return (
                    <div key={`${card.position}:${card.shift}`} className={['rounded-[24px] border px-4 py-4', getAttendanceCardClass(card.position)].join(' ')}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-stone-100">{card.shift === 'early' ? 'Morning' : 'Night'} {card.position}</div>
                          <div className="mt-2 text-xs text-stone-400">
                            {card.present}/{card.expected}
                            <span className={['ml-2 font-semibold', ratio < 80 ? 'text-rose-300' : ratio >= 90 ? 'text-stone-100' : 'text-stone-300'].join(' ')}>
                              {card.expected > 0 ? `${ratio.toFixed(1)}%` : '0.0%'}
                            </span>
                          </div>
                          {card.offWorked > 0 ? <div className="mt-2 text-xs font-medium text-stone-300">+{card.offWorked} off worked</div> : null}
                        </div>
                        <div className={[
                          'min-w-[92px] rounded-[20px] border px-3 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
                          card.position === 'Pick'
                            ? 'border-sky-300/20 bg-sky-400/[0.10]'
                            : card.position === 'Pack'
                              ? 'border-emerald-300/20 bg-emerald-400/[0.10]'
                              : card.position === 'Rebin'
                                ? 'border-amber-300/20 bg-amber-400/[0.10]'
                                : card.position === 'Preship'
                                  ? 'border-rose-300/20 bg-rose-400/[0.10]'
                                  : card.position === 'Transfer'
                                    ? 'border-violet-300/20 bg-violet-400/[0.10]'
                                    : 'border-white/10 bg-white/[0.04]'
                        ].join(' ')}>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">On Clock</div>
                          <div className={['mt-1 text-3xl font-semibold leading-none', getAttendanceCardValueClass(card.position)].join(' ')}>{card.onClock}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_220px_220px_repeat(3,minmax(0,160px))]">
            <label className="relative flex h-12 items-center overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.04] px-4">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by staff ID or name"
                className="home-search-input h-full w-full bg-transparent pl-8 text-sm text-stone-100 outline-none placeholder:text-stone-500"
              />
            </label>
            <div className="relative">
              <select
                value={positionFilter}
                onChange={(e) => {
                  setPositionFilter(e.target.value);
                  if (e.target.value === 'ALL') {
                    setHomeRosterPositionFilter('ALL');
                  } else {
                    const casted = normalizePositionKey(e.target.value);
                    if (casted) setHomeRosterPositionFilter(casted);
                  }
                }}
                className="h-12 w-full appearance-none rounded-[20px] border border-white/10 bg-white/[0.04] px-4 pr-10 text-sm text-stone-100 outline-none transition focus:border-white/20"
              >
                <option value="">All positions</option>
                {positionOptions.map((position) => (
                  <option key={position} value={position}>{position}</option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            </div>
            <div className="relative">
              <select
                value={shiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
                className="h-12 w-full appearance-none rounded-[20px] border border-white/10 bg-white/[0.04] px-4 pr-10 text-sm text-stone-100 outline-none transition focus:border-white/20"
              >
                <option value="">All shifts</option>
                {shiftOptions.map((shift) => (
                  <option key={shift} value={shift}>{formatShiftLabel(shift)}</option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            </div>
            <label className="flex h-12 items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-200">
              <input type="checkbox" checked={absentOnly} onChange={(e) => setAbsentOnly(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#e8dfcf]" />
              Absent
            </label>
            <label className="flex h-12 items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-200">
              <input type="checkbox" checked={onClockOnly} onChange={(e) => setOnClockOnly(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#e8dfcf]" />
              On Clock
            </label>
            <label className="flex h-12 items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-200">
              <input type="checkbox" checked={offWorkOnly} onChange={(e) => setOffWorkOnly(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#e8dfcf]" />
              Off Work
            </label>
          </div>

        </div>

        <div className="mt-6 overflow-hidden rounded-[28px] border border-white/10 bg-black/20">
          <div className="overflow-auto">
            <table className="min-w-[1100px] w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-[#17191c]/95 text-xs uppercase tracking-[0.16em] text-stone-400 backdrop-blur">
                <tr>
                  <th className="px-3 py-3 text-left">SN</th>
                  <th className="px-3 py-3 text-left">Staff ID</th>
                  <th className="px-3 py-3 text-left">Name</th>
                  <th className="px-3 py-3 text-left">Position</th>
                  <th className="px-3 py-3 text-left">Label</th>
                  <th className="px-3 py-3 text-left">Shift</th>
                  <th className="px-3 py-3 text-left">Punch Logs</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row, idx) => {
                  const rowToneClass =
                    row.attendance === 'Absent' ? 'bg-rose-950/30' : row.attendance === 'Off Worked' ? 'bg-stone-200/[0.03]' : 'odd:bg-white/[0.02]';
                  return (
                    <tr key={`${row.staff_id}-${idx}`} className={['border-t border-white/5 transition-colors hover:bg-white/[0.05]', rowToneClass].join(' ')}>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-stone-500">{idx + 1}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-stone-100">{row.staff_id || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-stone-100">{row.name || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-stone-300">
                        <span className={['inline-flex items-center rounded-full border px-2.5 py-1', getSchedulePositionBadgeClass(row.position)].join(' ')}>
                          {row.position || '-'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-stone-300">
                        <span className={['inline-flex items-center rounded-full border px-2.5 py-1', getScheduleLabelToneClass(row.label || '-')].join(' ')}>{row.label || '-'}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-stone-300">
                        <span className="inline-flex items-center rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-slate-200">
                          {formatShiftLabel(row.shift)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-stone-300">
                        <div className="flex flex-wrap gap-1.5">
                          {row.punches.length > 0 ? (
                            <>
                              {row.punches.slice(0, 4).map((punch, punchIndex) => {
                                const shortGapIndices = getShortGapPunchIndices(row.punches);
                                const toneClass = shortGapIndices.has(punchIndex)
                                  ? 'border-rose-300/35 bg-rose-500/[0.14] text-rose-100'
                                  : punch.action === 'IN'
                                    ? 'border-emerald-300/35 bg-emerald-500/[0.14] text-emerald-100'
                                    : 'border-sky-300/35 bg-sky-500/[0.14] text-sky-100';
                                return (
                                  <span key={`${row.staff_id}-${punchIndex}`} className={['inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase', toneClass].join(' ')}>
                                    {punch.action} {formatTimeOnly(punch.created_at)}
                                  </span>
                                );
                              })}
                              {row.punches.length > 4 ? (
                                <button
                                  type="button"
                                  title={`+${row.punches.length - 4} more`}
                                  onClick={() => {
                                    if (!onOpenTimecardCalibration) return;
                                    const firstValidPunch = row.punches.find((item) => toLocalDateOnly(item.created_at));
                                    const workDate = firstValidPunch ? toLocalDateOnly(firstValidPunch.created_at) : '';
                                    if (!row.staff_id || !workDate) return;
                                    void onOpenTimecardCalibration(row.staff_id, workDate);
                                  }}
                                  className="inline-flex items-center rounded-full border border-amber-300/35 bg-amber-500/[0.14] px-2 py-1 text-[10px] font-semibold text-amber-100 transition hover:bg-amber-500/[0.24]"
                                >
                                  +{row.punches.length - 4}
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-white/12 bg-white/[0.03] px-2 py-1 text-[10px]">--</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {renderedRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-stone-400">{t('当前无记录', 'No records')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}

export default memo(HomeDashboardPage);
