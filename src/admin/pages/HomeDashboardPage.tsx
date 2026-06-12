import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { LabelToneKey } from '../../lib/labelTone';
import { POSITION_DEPARTMENTS, normalizePositionDepartment, type PositionDepartment } from '../../shared/positions';
import {
  buildDashboardCardPositions,
  buildDashboardPositionOptions,
  resolveDashboardPositionName
} from '../../shared/dashboardPositions';
import { DEFAULT_DASHBOARD_CARD_POSITIONS } from '../../shared/dashboardPositions';
import {
  buildDashboardDepartmentCoverageCards,
  buildDashboardAttendanceStats,
  createDashboardAttendanceStat,
  getDashboardDepartmentLabel,
  getDashboardDepartmentTonePosition,
  getDashboardAttendanceStatKey,
  type DashboardAttendanceStat
} from '../../shared/dashboardAttendanceStats';

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
  getHomeCardToneClass: (value: string, toneMap?: Partial<Record<string, LabelToneKey>>) => string;
  getHomeChipToneClass: (value: string, toneMap?: Partial<Record<string, LabelToneKey>>) => string;
  getScheduleLabelToneClass: (label: string) => string;
  getScheduleTableLabelBadgeClass: (label: string) => string;
  getHomePanelToneClass: (value: string, toneMap?: Partial<Record<string, LabelToneKey>>) => string;
  getSchedulePositionBadgeClass: (position: string) => string;
  getScheduleTablePositionBadgeClass: (position: string) => string;
  getScheduleTableShiftBadgeClass: (value: '' | 'early' | 'late') => string;
  schedulePositionToneByPosition: Partial<Record<string, LabelToneKey>>;
  positionDepartmentByPosition?: Record<string, PositionDepartment>;
  homeDashboardPositionNames: string[];
  homeRosterPositionFilter: string;
  setHomeRosterPositionFilter: (value: string) => void;
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

export const HOME_DASHBOARD_CARD_POSITIONS = DEFAULT_DASHBOARD_CARD_POSITIONS;
const iconStrokeClass = 'h-4 w-4 shrink-0';

const SearchIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l5 5" strokeLinecap="round" />
  </svg>
);

const normalizePositionKey = (value: string, positionNames: readonly string[] = HOME_DASHBOARD_CARD_POSITIONS): string =>
  resolveDashboardPositionName(value, positionNames);

const normalizeShiftValue = (value: unknown): '' | 'early' | 'late' => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'early' || v === 'morning' || v.includes('早')) return 'early';
  if (v === 'late' || v === 'night' || v.includes('晚')) return 'late';
  return '';
};

const hasPunchLog = (row: HomeRosterRow) => (row.punches ?? []).length > 0 || row.attendance === 'Normal' || row.attendance === 'Completed' || row.attendance === 'Off Worked';

const isRowOnClock = (row: HomeRosterRow) => {
  if (row.attendance === 'Normal') return true;
  const punches = row.punches ?? [];
  return punches[punches.length - 1]?.action === 'IN';
};

const formatShiftLabel = (value: string) => {
  const v = normalizeShiftValue(value);
  if (v === 'early') return 'Morning';
  if (v === 'late') return 'Night';
  return value || '-';
};

type DashboardMultiSelectOption<Value extends string = string> = {
  value: Value;
  label: string;
  badgeClass?: string;
};

const buildDashboardMultiSelectLabel = (allLabel: string, selected: string[]) => {
  if (selected.length === 0) return allLabel;
  if (selected.length === 1) return selected[0];
  return `${selected.length} selected`;
};

function DashboardMultiSelect<Value extends string>({
  allLabel,
  selected,
  options,
  onChange,
  isLight
}: {
  allLabel: string;
  selected: Value[];
  options: readonly DashboardMultiSelectOption<Value>[];
  onChange: (value: Value[]) => void;
  isLight: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const selectedSet = new Set(selected);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const root = detailsRef.current;
      if (!root || !root.open) return;
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      root.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const root = detailsRef.current;
      if (root?.open) root.open = false;
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const toggleValue = (value: Value) => {
    onChange(selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  const optionClass = (active: boolean) =>
    [
      'flex w-full cursor-pointer items-center justify-between rounded-lg border px-2 py-1.5 text-left text-sm transition',
      active
        ? isLight
          ? 'border-emerald-700/50 bg-emerald-100 text-emerald-900'
          : 'border-neon/50 bg-neon/10 text-neon'
        : isLight
          ? 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
          : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
    ].join(' ');

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className={[
          'flex h-12 cursor-pointer list-none items-center justify-between rounded-[20px] border px-4 text-sm outline-none transition',
          isLight ? 'border-slate-200 bg-white text-slate-800 hover:border-slate-300' : 'border-white/10 bg-white/[0.04] text-stone-100 hover:border-white/20'
        ].join(' ')}
      >
        <span className="truncate">{buildDashboardMultiSelectLabel(allLabel, selected)}</span>
        <span className={['ml-3 text-xs', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{selected.length}</span>
      </summary>
      <div
        className={[
          'absolute z-40 mt-2 w-full rounded-2xl border p-3',
          isLight
            ? 'border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]'
            : 'border-slate-700 bg-slate-900 shadow-[0_18px_40px_rgba(0,0,0,0.45)]'
        ].join(' ')}
      >
        <div className={['mb-2 flex items-center justify-between text-[11px]', isLight ? 'text-slate-500' : 'text-slate-300'].join(' ')}>
          <span>Multi-select</span>
          <button
            type="button"
            disabled={selected.length === 0}
            onClick={(event) => {
              event.preventDefault();
              onChange([]);
            }}
            className={[
              'min-w-[52px] rounded-md border px-2 py-1 text-[12px] font-medium leading-none transition disabled:cursor-not-allowed disabled:opacity-50',
              isLight
                ? 'border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50'
                : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
            ].join(' ')}
          >
            Clear
          </button>
        </div>
        <div className="max-h-56 space-y-1 overflow-auto pr-1">
          <button type="button" className={optionClass(selected.length === 0)} onClick={() => onChange([])}>
            <span className="inline-flex max-w-[80%] items-center truncate rounded-full border border-white/20 px-2 py-0.5 text-xs font-semibold">{allLabel}</span>
          </button>
          {options.map((option) => {
            const active = selectedSet.has(option.value);
            return (
              <button key={option.value} type="button" className={optionClass(active)} onClick={() => toggleValue(option.value)}>
                <span className={['inline-flex max-w-[80%] items-center truncate rounded-full border px-2 py-0.5 text-xs font-semibold', option.badgeClass ?? 'border-white/20'].join(' ')}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}

const getHomeShiftBadgeClass = (value: '' | 'early' | 'late') => {
  if (value === 'early') return 'badge-elevated-dark border-amber-300/30 bg-amber-400/[0.13] text-amber-100';
  if (value === 'late') return 'badge-elevated-dark border-indigo-300/30 bg-indigo-400/[0.13] text-indigo-100';
  return 'badge-elevated-dark border-white/12 bg-white/[0.05] text-slate-200';
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
  if (position === 'Shipping') return 'border-indigo-300/20 bg-indigo-400/[0.08]';
  if (position === 'Transfer') return 'border-violet-300/20 bg-violet-400/[0.08]';
  if (position === 'Putaway') return 'border-orange-300/20 bg-orange-400/[0.08]';
  if (position === 'Receive') return 'border-lime-300/20 bg-lime-400/[0.08]';
  if (position === 'Load') return 'border-pink-300/20 bg-pink-400/[0.08]';
  if (position === 'Inventory') return 'border-fuchsia-300/20 bg-fuchsia-400/[0.08]';
  return 'border-white/10 bg-white/[0.04]';
};

const getAttendanceCardClassLight = (position: string) => {
  if (position === 'Pick') return 'border-sky-200 bg-sky-50/85';
  if (position === 'Pack') return 'border-emerald-200 bg-emerald-50/85';
  if (position === 'Rebin') return 'border-amber-200 bg-amber-50/85';
  if (position === 'Preship') return 'border-rose-200 bg-rose-50/85';
  if (position === 'Shipping') return 'border-indigo-200 bg-indigo-50/85';
  if (position === 'Transfer') return 'border-violet-200 bg-violet-50/85';
  if (position === 'Putaway') return 'border-orange-200 bg-orange-50/85';
  if (position === 'Receive') return 'border-lime-200 bg-lime-50/85';
  if (position === 'Load') return 'border-pink-200 bg-pink-50/85';
  if (position === 'Inventory') return 'border-fuchsia-200 bg-fuchsia-50/85';
  return 'border-slate-200 bg-white/90';
};

const getAttendanceCardValueClassLight = (position: string) => {
  if (position === 'Pick') return 'text-sky-700';
  if (position === 'Pack') return 'text-emerald-700';
  if (position === 'Rebin') return 'text-amber-700';
  if (position === 'Preship') return 'text-rose-700';
  if (position === 'Shipping') return 'text-indigo-700';
  if (position === 'Transfer') return 'text-violet-700';
  if (position === 'Putaway') return 'text-orange-700';
  if (position === 'Receive') return 'text-lime-700';
  if (position === 'Load') return 'text-pink-700';
  if (position === 'Inventory') return 'text-fuchsia-700';
  return 'text-slate-700';
};

const getAttendanceCardValueClass = (position: string) => {
  if (position === 'Pick') return 'text-sky-100';
  if (position === 'Pack') return 'text-emerald-100';
  if (position === 'Rebin') return 'text-amber-100';
  if (position === 'Preship') return 'text-rose-100';
  if (position === 'Shipping') return 'text-indigo-100';
  if (position === 'Transfer') return 'text-violet-100';
  if (position === 'Putaway') return 'text-orange-100';
  if (position === 'Receive') return 'text-lime-100';
  if (position === 'Load') return 'text-pink-100';
  if (position === 'Inventory') return 'text-fuchsia-100';
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
  getScheduleTableLabelBadgeClass,
  getHomePanelToneClass: _getHomePanelToneClass,
  getSchedulePositionBadgeClass,
  getScheduleTablePositionBadgeClass,
  getScheduleTableShiftBadgeClass,
  schedulePositionToneByPosition: _schedulePositionToneByPosition,
  positionDepartmentByPosition = {},
  homeDashboardPositionNames,
  homeRosterPositionFilter: _homeRosterPositionFilter,
  setHomeRosterPositionFilter,
  onOpenTimecardCalibration,
  homeRosterRowsCurrent
}: HomeDashboardPageProps) {
  const isLight = _themeMode === 'light';
  const [search, setSearch] = useState('');
  const [agencyFilter, setAgencyFilter] = useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [positionFilter, setPositionFilter] = useState<string[]>([]);
  const [shiftFilter, setShiftFilter] = useState<Array<'early' | 'late'>>([]);
  const [absentOnly, setAbsentOnly] = useState(false);
  const [onClockOnly, setOnClockOnly] = useState(false);
  const [offWorkOnly, setOffWorkOnly] = useState(false);

  const summaryByPosition = useMemo(() => {
    const map = new Map<string, { early: number; late: number; total: number }>();
    for (const item of homeExpectedPositionSummaryCards) {
      const key = normalizePositionKey(item.position, homeDashboardPositionNames) || item.position;
      map.set(key, { early: item.early, late: item.late, total: item.total });
    }
    return map;
  }, [homeExpectedPositionSummaryCards, homeDashboardPositionNames]);

  const cardPositions = useMemo(
    () =>
      buildDashboardCardPositions(homeDashboardPositionNames, []),
    [homeDashboardPositionNames, homeExpectedPositionSummaryCards, homeCardStats, homeRosterRowsCurrent]
  );

  const homeAttendanceStats = useMemo(() => {
    const rows = homeRosterRowsCurrent
      .map((row) => {
        const position = normalizePositionKey(row.position, homeDashboardPositionNames);
        const shift = normalizeShiftValue(row.shift);
        if (!position || !shift) return null;
        return {
          staffId: row.staff_id,
          position,
          shift,
          isExpected: row.attendance !== 'Off Worked',
          hasPunch: hasPunchLog(row),
          isOnClock: isRowOnClock(row),
          attendance: row.attendance
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    return buildDashboardAttendanceStats(rows);
  }, [homeRosterRowsCurrent, homeDashboardPositionNames]);

  const departmentCoverageCards = useMemo(
    () =>
      buildDashboardDepartmentCoverageCards({
        positions: cardPositions,
        positionDepartments: positionDepartmentByPosition,
        stats: homeAttendanceStats,
        expectedByPosition: summaryByPosition
      }),
    [cardPositions, homeAttendanceStats, positionDepartmentByPosition, summaryByPosition]
  );

  const departmentAttendanceGroups = useMemo(
    () => {
      return POSITION_DEPARTMENTS.filter((department) => department !== 'hidden').map((department) => {
        const departmentPositions = cardPositions.filter(
          (position) => normalizePositionDepartment(positionDepartmentByPosition[position]) === department
        );
        return {
          department,
          cards: (['early', 'late'] as const).flatMap((shift) =>
            departmentPositions.map((position) => {
              const plan = summaryByPosition.get(position) ?? { early: 0, late: 0, total: 0 };
              const key = getDashboardAttendanceStatKey(shift, position);
              const stat: DashboardAttendanceStat = homeAttendanceStats[key] ?? createDashboardAttendanceStat();
              return {
                position,
                shift,
                expected: shift === 'early' ? plan.early : plan.late,
                present: stat.present,
                onClock: stat.onClock,
                offWorked: stat.offWorked
              };
            })
          )
        };
      }).filter((group) => group.cards.length > 0);
    },
    [cardPositions, homeAttendanceStats, positionDepartmentByPosition, summaryByPosition]
  );

  const positionOptions = useMemo(
    () =>
      buildDashboardPositionOptions(
        homeDashboardPositionNames,
        homeRosterRowsCurrent.map((row) => normalizePositionKey(row.position, homeDashboardPositionNames) || row.position)
      ).filter((position) => departmentFilter.length === 0 || departmentFilter.includes(normalizePositionDepartment(positionDepartmentByPosition[position]))),
    [departmentFilter, homeDashboardPositionNames, homeRosterRowsCurrent, positionDepartmentByPosition]
  );

  const departmentOptions = useMemo(
    () =>
      POSITION_DEPARTMENTS.filter((department) =>
        homeRosterRowsCurrent.some((row) => {
          const position = normalizePositionKey(row.position, homeDashboardPositionNames) || row.position;
          return normalizePositionDepartment(positionDepartmentByPosition[position]) === department;
        })
      ),
    [homeDashboardPositionNames, homeRosterRowsCurrent, positionDepartmentByPosition]
  );

  const agencyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of homeRosterRowsCurrent) {
      const agency = String(row.agency ?? '').trim();
      if (agency) set.add(agency);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }));
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
      if (agencyFilter.length > 0) {
        const agency = String(row.agency ?? '').trim();
        if (!agencyFilter.includes(agency)) return false;
      }
      if (positionFilter.length > 0) {
        const key = normalizePositionKey(row.position, homeDashboardPositionNames) || row.position;
        if (!positionFilter.includes(key)) return false;
      }
      if (departmentFilter.length > 0) {
        const key = normalizePositionKey(row.position, homeDashboardPositionNames) || row.position;
        if (!departmentFilter.includes(normalizePositionDepartment(positionDepartmentByPosition[key]))) return false;
      }
      if (shiftFilter.length > 0) {
        const rowShift = normalizeShiftValue(row.shift);
        if (!rowShift) return false;
        if (!shiftFilter.includes(rowShift)) return false;
      }
      if (attendanceFilters.length > 0 && !attendanceFilters.includes(row.attendance)) return false;
      return true;
    });
  }, [tableRows, search, agencyFilter, departmentFilter, positionDepartmentByPosition, positionFilter, shiftFilter, absentOnly, onClockOnly, offWorkOnly, homeDashboardPositionNames]);

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
      <section className="w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="space-y-3">
          <div className="space-y-2">
            <h1 className={['font-display text-4xl leading-none tracking-[0.03em] sm:text-5xl', isLight ? 'text-slate-900' : 'text-stone-50'].join(' ')}>Dashboard</h1>
          </div>
        </div>

        <div className={['mt-6 flex flex-col gap-4 rounded-[28px] border p-4 sm:p-5', isLight ? 'border-slate-200 bg-white/70' : 'border-white/10 bg-black/20'].join(' ')}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <div className={['text-xl font-semibold tracking-[-0.02em]', isLight ? 'text-slate-900' : 'text-stone-50'].join(' ')}>{operationalDate || '-'}</div>
              <div className={['text-sm', isLight ? 'text-slate-500' : 'text-stone-400'].join(' ')}>Updated {lastUpdatedAt || '-'}</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {departmentCoverageCards.map((card) => {
              const ratio = card.expected > 0 ? (card.present / card.expected) * 100 : 0;
              const isMorning = card.shift === 'early';
              const isOverPlan = card.present > card.expected;
              const tonePosition = getDashboardDepartmentTonePosition(card.department);
              return (
                <div
                    key={`${card.department}:${card.shift}`}
                    className={[
                      'rounded-[24px] border px-5 py-4 shadow-none',
                      isLight ? getAttendanceCardClassLight(tonePosition) : getAttendanceCardClass(tonePosition)
                    ].join(' ')}
                  >
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className={['text-[11px] font-semibold uppercase tracking-[0.18em]', isLight ? 'text-slate-500' : 'text-stone-400'].join(' ')}>{getDashboardDepartmentLabel(card.department)} {isMorning ? 'Morning' : 'Night'}</div>
                      <div className="mt-3 flex items-end gap-3">
                        <span className={['text-3xl font-semibold tracking-[-0.03em]', isOverPlan ? (isLight ? 'text-rose-600' : 'text-rose-300') : isLight ? 'text-slate-800' : 'text-stone-50'].join(' ')}>{card.present}/{card.expected}</span>
                        <span className={['pb-1 text-sm font-semibold', isOverPlan ? (isLight ? 'text-rose-600' : 'text-rose-300') : isLight ? (ratio < 80 ? 'text-rose-500' : ratio >= 90 ? getAttendanceCardValueClassLight(tonePosition) : 'text-slate-500') : ratio < 80 ? 'text-rose-300' : ratio >= 90 ? getAttendanceCardValueClass(tonePosition) : 'text-stone-300'].join(' ')}>
                          {card.expected > 0 ? `${ratio.toFixed(1)}% coverage` : '0.0% coverage'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-4">
            {departmentAttendanceGroups.map((group) => (
              <section key={`attendance:${group.department}`} className="space-y-2">
                <div className={['text-[12px] font-semibold uppercase tracking-[0.18em]', isLight ? 'text-slate-500' : 'text-stone-400'].join(' ')}>
                  {getDashboardDepartmentLabel(group.department)}:
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                  {group.cards.map((card) => {
                    const ratio = card.expected > 0 ? (card.present / card.expected) * 100 : 0;
                    const isOverPlan = card.present > card.expected;
                    return (
                      <div
                        key={`${card.position}:${card.shift}`}
                        className={[
                          'rounded-[24px] border px-4 py-4 shadow-none',
                          isLight
                            ? getAttendanceCardClassLight(card.position)
                            : getAttendanceCardClass(card.position)
                        ].join(' ')}
                      >
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className={['text-sm font-semibold', isLight ? 'text-slate-800' : 'text-stone-100'].join(' ')}>{card.shift === 'early' ? 'Morning' : 'Night'} {card.position}</div>
                            <div className={['mt-2 text-xs', isLight ? 'text-slate-500' : 'text-stone-400'].join(' ')}>
                              <span className={['font-bold', isOverPlan ? (isLight ? 'text-rose-600' : 'text-rose-300') : ''].join(' ')}>
                                {card.present}/{card.expected}
                              </span>
                              <span className={['ml-2 font-semibold', isOverPlan ? (isLight ? 'text-rose-600' : 'text-rose-300') : isLight ? (ratio < 80 ? 'text-rose-500' : ratio >= 90 ? getAttendanceCardValueClassLight(card.position) : 'text-slate-500') : ratio < 80 ? 'text-rose-300' : ratio >= 90 ? 'text-stone-100' : 'text-stone-300'].join(' ')}>
                                {card.expected > 0 ? `${ratio.toFixed(1)}%` : '0.0%'}
                              </span>
                            </div>
                          </div>
                          <div className={[
                            'ml-auto w-[92px] max-w-full shrink-0 rounded-[20px] border px-3 py-2 text-center shadow-none',
                            isLight
                              ? getAttendanceCardClassLight(card.position).replace('/85', '')
                              : getAttendanceCardClass(card.position)
                          ].join(' ')}>
                            <div className={['text-[10px] font-semibold uppercase tracking-[0.18em]', isLight ? 'text-slate-500' : 'text-stone-400'].join(' ')}>On Clock</div>
                            <div className={['mt-1 text-3xl font-semibold leading-none', isLight ? getAttendanceCardValueClassLight(card.position) : getAttendanceCardValueClass(card.position)].join(' ')}>{card.onClock}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_180px_160px_180px_160px_repeat(3,minmax(0,140px))]">
            <label className={['relative flex h-12 items-center overflow-hidden rounded-[20px] border px-4', isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/[0.04]'].join(' ')}>
              <SearchIcon className={['pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2', isLight ? 'text-slate-400' : 'text-stone-400'].join(' ')} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by staff ID or name"
                className={['home-search-input h-full w-full bg-transparent pl-8 text-sm outline-none', isLight ? 'text-slate-800 placeholder:text-slate-400' : 'text-stone-100 placeholder:text-stone-500'].join(' ')}
              />
            </label>
            <DashboardMultiSelect
              allLabel="All agencies"
              selected={agencyFilter}
              options={agencyOptions.map((agency) => ({ value: agency, label: agency }))}
              onChange={setAgencyFilter}
              isLight={isLight}
            />
            <DashboardMultiSelect
              allLabel="All dept"
              selected={departmentFilter}
              options={departmentOptions.map((department) => ({
                value: department,
                label: department === 'hidden' ? 'Hidden' : department
              }))}
              onChange={setDepartmentFilter}
              isLight={isLight}
            />
            <DashboardMultiSelect
              allLabel="All positions"
              selected={positionFilter}
              options={positionOptions.map((position) => ({
                value: position,
                label: position,
                badgeClass: isLight ? getScheduleTablePositionBadgeClass(position) : getSchedulePositionBadgeClass(position)
              }))}
              onChange={(value) => {
                setPositionFilter(value);
                setHomeRosterPositionFilter(value.length === 1 ? value[0] : 'ALL');
              }}
              isLight={isLight}
            />
            <DashboardMultiSelect<'early' | 'late'>
              allLabel="All shifts"
              selected={shiftFilter}
              options={shiftOptions.map((shift) => ({
                value: shift as 'early' | 'late',
                label: formatShiftLabel(shift),
                badgeClass: getHomeShiftBadgeClass(shift as '' | 'early' | 'late')
              }))}
              onChange={setShiftFilter}
              isLight={isLight}
            />
            <label className={['flex h-12 items-center gap-3 rounded-[20px] border px-4 text-sm', isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-white/10 bg-white/[0.04] text-stone-200'].join(' ')}>
              <input type="checkbox" checked={absentOnly} onChange={(e) => setAbsentOnly(e.target.checked)} className="home-filter-checkbox h-4 w-4 shrink-0 appearance-auto rounded border border-slate-300 bg-white accent-indigo-600 shadow-none" />
              Absent
            </label>
            <label className={['flex h-12 items-center gap-3 rounded-[20px] border px-4 text-sm', isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-white/10 bg-white/[0.04] text-stone-200'].join(' ')}>
              <input type="checkbox" checked={onClockOnly} onChange={(e) => setOnClockOnly(e.target.checked)} className="home-filter-checkbox h-4 w-4 shrink-0 appearance-auto rounded border border-slate-300 bg-white accent-indigo-600 shadow-none" />
              On Clock
            </label>
            <label className={['flex h-12 items-center gap-3 rounded-[20px] border px-4 text-sm', isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-white/10 bg-white/[0.04] text-stone-200'].join(' ')}>
              <input type="checkbox" checked={offWorkOnly} onChange={(e) => setOffWorkOnly(e.target.checked)} className="home-filter-checkbox h-4 w-4 shrink-0 appearance-auto rounded border border-slate-300 bg-white accent-indigo-600 shadow-none" />
              Off Work
            </label>
          </div>

        </div>

        <div className={['mt-6 overflow-hidden rounded-[28px] border', isLight ? 'border-slate-300/80 bg-white/80' : 'border-white/10 bg-black/20'].join(' ')}>
          <div className="overflow-auto">
            <table className="min-w-[1200px] w-full border-collapse text-sm">
              <thead className={['sticky top-0 z-10 text-xs uppercase tracking-[0.16em] backdrop-blur', isLight ? 'bg-[#f4efe7]/95 text-slate-600' : 'bg-[#17191c]/95 text-stone-400'].join(' ')}>
                <tr>
                  <th className="px-3 py-3 text-left">SN</th>
                  <th className="px-3 py-3 text-left">Staff ID</th>
                  <th className="px-3 py-3 text-left">Name</th>
                  <th className="px-3 py-3 text-left">Agency</th>
                  <th className="px-3 py-3 text-left">Position</th>
                  <th className="px-3 py-3 text-left">Label</th>
                  <th className="px-3 py-3 text-left">Shift</th>
                  <th className="px-3 py-3 text-left">Punch Logs</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row, idx) => {
                    const rowToneClass = isLight
                      ? row.attendance === 'Absent'
                        ? 'bg-rose-50'
                        : row.attendance === 'Off Worked'
                          ? 'bg-slate-50'
                          : 'odd:bg-white even:bg-slate-50/50'
                      : row.attendance === 'Absent'
                        ? 'bg-rose-950/30'
                        : row.attendance === 'Off Worked'
                          ? 'bg-stone-200/[0.03]'
                          : 'odd:bg-white/[0.02]';
                  return (
                    <tr key={`${row.staff_id}-${idx}`} className={['border-t transition-colors', isLight ? 'border-slate-200 hover:bg-slate-50' : 'border-white/5 hover:bg-white/[0.05]', rowToneClass].join(' ')}>
                      <td className={['whitespace-nowrap px-3 py-3 font-mono', isLight ? 'text-slate-500' : 'text-stone-500'].join(' ')}>{idx + 1}</td>
                      <td className={['whitespace-nowrap px-3 py-3 font-mono', isLight ? 'text-slate-800' : 'text-stone-100'].join(' ')}>{row.staff_id || '-'}</td>
                      <td className={['whitespace-nowrap px-3 py-3', isLight ? 'text-slate-800' : 'text-stone-100'].join(' ')}>{row.name || '-'}</td>
                      <td className={['whitespace-nowrap px-3 py-3', isLight ? 'text-slate-600' : 'text-stone-300'].join(' ')}>{row.agency || '-'}</td>
                      <td className={['whitespace-nowrap px-3 py-3', isLight ? 'text-slate-600' : 'text-stone-300'].join(' ')}>
                        <span className={['inline-flex items-center rounded-full border px-2.5 py-1', isLight ? getScheduleTablePositionBadgeClass(row.position) : getSchedulePositionBadgeClass(row.position)].join(' ')}>
                          {row.position || '-'}
                        </span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3', isLight ? 'text-slate-600' : 'text-stone-300'].join(' ')}>
                        <span className={['inline-flex items-center rounded-full border px-2.5 py-1', isLight ? getScheduleTableLabelBadgeClass(row.label || '-') : getScheduleLabelToneClass(row.label || '-')].join(' ')}>{row.label || '-'}</span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3', isLight ? 'text-slate-600' : 'text-stone-300'].join(' ')}>
                        <span className={['inline-flex items-center rounded-full border px-2.5 py-1', isLight ? getScheduleTableShiftBadgeClass(normalizeShiftValue(row.shift)) : getHomeShiftBadgeClass(normalizeShiftValue(row.shift))].join(' ')}>
                          {formatShiftLabel(row.shift)}
                        </span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3', isLight ? 'text-slate-600' : 'text-stone-300'].join(' ')}>
                        <div className="flex flex-wrap gap-1.5">
                          {row.punches.length > 0 ? (
                            <>
                              {row.punches.slice(0, 4).map((punch, punchIndex) => {
                                const shortGapIndices = getShortGapPunchIndices(row.punches);
                                  const toneClass = isLight
                                    ? shortGapIndices.has(punchIndex)
                                      ? 'badge-elevated-light border-rose-300 bg-rose-50 text-rose-700'
                                      : punch.action === 'IN'
                                        ? 'badge-elevated-light border-emerald-300 bg-emerald-50 text-emerald-700'
                                        : 'badge-elevated-light border-sky-300 bg-sky-50 text-sky-700'
                                    : shortGapIndices.has(punchIndex)
                                      ? 'badge-elevated-dark border-rose-300/30 bg-rose-400/[0.13] text-rose-100'
                                      : punch.action === 'IN'
                                        ? 'badge-elevated-dark border-emerald-300/30 bg-emerald-400/[0.13] text-emerald-100'
                                        : 'badge-elevated-dark border-sky-300/30 bg-sky-400/[0.13] text-sky-100';
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
                                  className={[
                                    'inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold transition',
                                    isLight
                                      ? 'badge-elevated-light border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                      : 'badge-elevated-dark border-amber-300/30 bg-amber-400/[0.13] text-amber-100 hover:bg-amber-400/[0.2]'
                                  ].join(' ')}
                                >
                                  +{row.punches.length - 4}
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <span className={['inline-flex items-center rounded-full border px-2 py-1 text-[10px]', isLight ? 'badge-elevated-light border-slate-200 bg-white text-slate-400' : 'badge-elevated-dark border-white/12 bg-white/[0.05]'].join(' ')}>--</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {renderedRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-sm text-stone-400">{t('当前无记录', 'No records')}</td>
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
