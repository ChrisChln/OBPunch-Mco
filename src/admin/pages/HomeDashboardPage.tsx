import { memo, useEffect, useMemo, useState } from 'react';
import type { LabelToneKey } from '../../lib/labelTone';
import { createSupabaseClient } from '../../lib/supabase';
import { POSITION_DEPARTMENTS, normalizePositionDepartment, type PositionDepartment } from '../../shared/positions';
import {
  buildDashboardCardPositions,
  buildDashboardPositionOptions,
  resolveDashboardPositionName
} from '../../shared/dashboardPositions';
import GlowLabelChip, { getGlowToneForPunch, getGlowToneForShift } from '../../components/GlowLabelChip';
import { DEFAULT_DASHBOARD_CARD_POSITIONS } from '../../shared/dashboardPositions';
import {
  buildDashboardDepartmentAttendanceGroups,
  buildDashboardDepartmentCoverageCards,
  buildDashboardAttendanceStats,
  getDashboardDepartmentLabel,
  getDashboardDepartmentTonePosition,
  mergeDashboardAttendanceActualsIntoExpected,
} from '../../shared/dashboardAttendanceStats';
import { isExactOperationalCutoffOut } from '../../shared/operationalPunches';
import ElectricBorder from '../../components/ElectricBorder';
import { MagicMultiSelect } from '../../components/MagicSelectControls';

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
  homeWorkHoursByPositionShift: Record<string, { early: number; late: number }>;
  homeExpectedPositionSummaryCards: Array<{ position: string; early: number; late: number; total: number }>;
  getHomeCardToneClass: (value: string, toneMap?: Partial<Record<string, LabelToneKey>>) => string;
  getHomeChipToneClass: (value: string, toneMap?: Partial<Record<string, LabelToneKey>>) => string;
  getScheduleLabelTone: (label: string) => LabelToneKey;
  getScheduleTableLabelBadgeClass: (label: string) => string;
  getSchedulePositionTone: (position: string) => LabelToneKey;
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

type DashboardSnapshotRow = {
  work_date: string;
  shift: 'early' | 'late';
  position: string;
  department: string;
  expected: number;
  present: number;
  on_clock: number;
  off_worked: number;
  work_hours: number;
  snapshot_status: string;
  expected_captured_at: string | null;
  actual_captured_at: string | null;
  updated_at: string | null;
};

type HistoricalPunchRow = {
  staff_id: string | null;
  action: string | null;
  created_at: string | null;
};

type HistoricalEmployeeRow = {
  staff_id: string | null;
  name?: string | null;
  agency?: string | null;
  Agency?: string | null;
  position?: string | null;
  Position?: string | null;
  shift?: string | null;
  label?: string | null;
  Label?: string | null;
  work_account?: string | null;
  WorkAccount?: string | null;
};

export const HOME_DASHBOARD_CARD_POSITIONS = DEFAULT_DASHBOARD_CARD_POSITIONS;
const iconStrokeClass = 'h-4 w-4 shrink-0';
const DASHBOARD_ATTENDANCE_SNAPSHOT_TABLE =
  (import.meta.env.VITE_DASHBOARD_ATTENDANCE_SNAPSHOT_TABLE as string | undefined) ?? 'ob_dashboard_attendance_snapshots';
const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW)
  ? Math.min(23, Math.max(0, DAY_CUTOFF_HOUR_RAW))
  : 5;
const supabase = createSupabaseClient({ persistSession: true });

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

const computeWorkHoursFromPunches = (punches: Array<{ action: 'IN' | 'OUT'; created_at: string }>, capEnd: Date) => {
  if (!punches.length) return 0;
  const capEndMs = capEnd.getTime();
  if (!Number.isFinite(capEndMs)) return 0;
  let totalMs = 0;
  let currentInMs: number | null = null;
  for (const punch of punches) {
    const atMs = Date.parse(String(punch.created_at ?? ''));
    if (!Number.isFinite(atMs)) continue;
    if (punch.action === 'IN') {
      currentInMs = atMs;
      continue;
    }
    if (punch.action === 'OUT') {
      if (currentInMs !== null && atMs > currentInMs) totalMs += atMs - currentInMs;
      currentInMs = null;
    }
  }
  if (currentInMs !== null && capEndMs > currentInMs) totalMs += capEndMs - currentInMs;
  return totalMs / 3600000;
};

const formatDashboardHours = (value: number) => {
  const rounded = Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });
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

type DashboardDepartmentScope = 'ALL' | Exclude<PositionDepartment, 'hidden'>;

const DASHBOARD_PANEL_DEPARTMENTS: Array<Exclude<PositionDepartment, 'hidden'>> = ['OB', 'IB', 'INV'];
const DASHBOARD_DEPARTMENT_SCOPE_OPTIONS: Array<{ value: DashboardDepartmentScope; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'OB', label: 'OB' },
  { value: 'IB', label: 'IB' },
  { value: 'INV', label: 'INV' }
];
const DASHBOARD_DEPARTMENT_SCOPE_STORAGE_KEY = 'obpunch.homeDashboard.departmentScope';

const readDashboardDepartmentScope = (): DashboardDepartmentScope => {
  if (typeof window === 'undefined') return 'ALL';
  const stored = window.sessionStorage.getItem(DASHBOARD_DEPARTMENT_SCOPE_STORAGE_KEY);
  return DASHBOARD_DEPARTMENT_SCOPE_OPTIONS.some((option) => option.value === stored) ? (stored as DashboardDepartmentScope) : 'ALL';
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
  return <MagicMultiSelect selected={selected} options={options} onChange={onChange} allLabel={allLabel} tone={isLight ? 'light' : 'dark'} />;
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

const toDateOnly = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeDateOnly = (value: unknown) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[tT\s].*)?$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
};

const getCurrentOperationalDate = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
  if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  return toDateOnly(start);
};

const getOperationalDateRange = (dateOnly: string) => {
  const start = new Date(`${dateOnly}T00:00:00`);
  start.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const getShiftFromPunchTime = (value: unknown): '' | 'early' | 'late' => {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= DAY_CUTOFF_HOUR * 60 && minutes < 15 * 60 ? 'early' : 'late';
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

const getAttendanceBorderColor = (position: string, isLight: boolean) => {
  const normalized = normalizePositionKey(position) || position;
  if (normalized === 'Pick') return isLight ? '#0284c7' : '#38bdf8';
  if (normalized === 'Pack') return isLight ? '#059669' : '#34d399';
  if (normalized === 'Rebin') return isLight ? '#d97706' : '#fbbf24';
  if (normalized === 'Preship') return isLight ? '#e11d48' : '#fb7185';
  if (normalized === 'Shipping') return isLight ? '#4f46e5' : '#818cf8';
  if (normalized === 'Transfer') return isLight ? '#7c3aed' : '#a78bfa';
  if (normalized === 'Putaway') return isLight ? '#ea580c' : '#fb923c';
  if (normalized === 'Receive') return isLight ? '#65a30d' : '#a3e635';
  if (normalized === 'Load') return isLight ? '#db2777' : '#f472b6';
  if (normalized === 'Inventory') return isLight ? '#c026d3' : '#e879f9';
  return isLight ? '#64748b' : '#e7e5e4';
};

function HomeDashboardPage({
  t,
  themeMode: _themeMode,
  homeCardStats,
  homeWorkHoursByPositionShift,
  homeExpectedPositionSummaryCards,
  getHomeCardToneClass: _getHomeCardToneClass,
  getHomeChipToneClass: _getHomeChipToneClass,
  getScheduleLabelTone,
  getScheduleTableLabelBadgeClass,
  getSchedulePositionTone,
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
  const [dashboardDepartmentScope, setDashboardDepartmentScope] = useState<DashboardDepartmentScope>(() => readDashboardDepartmentScope());
  const [agencyFilter, setAgencyFilter] = useState<string[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [positionFilter, setPositionFilter] = useState<string[]>([]);
  const [shiftFilter, setShiftFilter] = useState<Array<'early' | 'late'>>([]);
  const [absentOnly, setAbsentOnly] = useState(false);
  const [onClockOnly, setOnClockOnly] = useState(false);
  const [offWorkOnly, setOffWorkOnly] = useState(false);
  const [selectedOperationalDate, setSelectedOperationalDate] = useState(() => getCurrentOperationalDate());
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotStats, setSnapshotStats] = useState<Record<string, { expected: number; present: number; onClock: number; offWorked: number; workHours: number }>>({});
  const [snapshotPositions, setSnapshotPositions] = useState<string[]>([]);
  const [snapshotDepartments, setSnapshotDepartments] = useState<Record<string, PositionDepartment>>({});
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState('');
  const [snapshotStatus, setSnapshotStatus] = useState('');
  const [historicalRosterRows, setHistoricalRosterRows] = useState<HomeRosterRow[]>([]);
  const [historicalRosterLoading, setHistoricalRosterLoading] = useState(false);

  const currentOperationalDate = getCurrentOperationalDate();
  const isLiveDate = selectedOperationalDate === currentOperationalDate;

  const handleDashboardDepartmentScopeChange = (value: DashboardDepartmentScope) => {
    setDashboardDepartmentScope(value);
    window.sessionStorage.setItem(DASHBOARD_DEPARTMENT_SCOPE_STORAGE_KEY, value);
  };

  const loadSnapshot = async (targetDate: string) => {
    const normalizedDate = normalizeDateOnly(targetDate);
    if (!supabase || !normalizedDate) {
      setSnapshotStats({});
      setSnapshotPositions([]);
      setSnapshotDepartments({});
      setSnapshotUpdatedAt('');
      setSnapshotStatus('');
      return;
    }
    setSnapshotLoading(true);
    try {
      const res = await supabase
        .from(DASHBOARD_ATTENDANCE_SNAPSHOT_TABLE)
        .select('work_date, shift, position, department, expected, present, on_clock, off_worked, work_hours, snapshot_status, expected_captured_at, actual_captured_at, updated_at')
        .eq('work_date', normalizedDate)
        .order('shift', { ascending: true })
        .order('position', { ascending: true })
        .limit(1000);
      if (res.error) {
        setSnapshotStats({});
        setSnapshotPositions([]);
        setSnapshotDepartments({});
        setSnapshotUpdatedAt('');
        setSnapshotStatus('');
        return;
      }

      const rows = ((res.data as DashboardSnapshotRow[] | null) ?? []).filter(
        (row) => normalizeDateOnly(row.work_date) === normalizedDate
      );
      const nextStats: Record<string, { expected: number; present: number; onClock: number; offWorked: number; workHours: number }> = {};
      const nextPositions: string[] = [];
      const nextDepartments: Record<string, PositionDepartment> = {};
      let latestUpdated = '';
      let hasActual = false;
      for (const row of rows) {
        const shift = row.shift === 'late' ? 'late' : 'early';
        const position = normalizePositionKey(String(row.position ?? '').trim(), homeDashboardPositionNames) || String(row.position ?? '').trim();
        if (!position) continue;
        nextPositions.push(position);
        nextDepartments[position] = normalizePositionDepartment(row.department);
        nextStats[`${shift}:${position}`] = {
          expected: Math.max(0, Number(row.expected ?? 0) || 0),
          present: Math.max(0, Number(row.present ?? 0) || 0),
          onClock: Math.max(0, Number(row.on_clock ?? 0) || 0),
          offWorked: Math.max(0, Number(row.off_worked ?? 0) || 0),
          workHours: Math.max(0, Number(row.work_hours ?? 0) || 0)
        };
        const updatedAt = String(row.actual_captured_at ?? row.expected_captured_at ?? row.updated_at ?? '').trim();
        if (updatedAt && (!latestUpdated || updatedAt > latestUpdated)) latestUpdated = updatedAt;
        if (String(row.snapshot_status ?? '').trim() === 'actual' || row.actual_captured_at) hasActual = true;
      }

      setSnapshotStats(nextStats);
      setSnapshotPositions(nextPositions);
      setSnapshotDepartments(nextDepartments);
      setSnapshotUpdatedAt(latestUpdated ? new Date(latestUpdated).toLocaleString('en-CA', { hour12: false }) : '');
      setSnapshotStatus(rows.length === 0 ? '' : hasActual ? 'actual' : 'expected');
    } finally {
      setSnapshotLoading(false);
    }
  };

  const loadHistoricalRoster = async (targetDate: string) => {
    const normalizedDate = normalizeDateOnly(targetDate);
    if (!supabase || !normalizedDate) {
      setHistoricalRosterRows([]);
      return;
    }
    setHistoricalRosterLoading(true);
    try {
      const range = getOperationalDateRange(normalizedDate);
      const punchRes = await supabase
        .from('ob_punches')
        .select('staff_id, action, created_at')
        .gte('created_at', range.start.toISOString())
        .lt('created_at', range.end.toISOString())
        .order('created_at', { ascending: true })
        .limit(3000);
      if (punchRes.error) {
        setHistoricalRosterRows([]);
        return;
      }

      const punchesByStaff = new Map<string, Array<{ action: 'IN' | 'OUT'; created_at: string }>>();
      for (const row of ((punchRes.data as HistoricalPunchRow[] | null) ?? [])) {
        const staff = String(row.staff_id ?? '').trim().toUpperCase();
        const createdAt = String(row.created_at ?? '').trim();
        if (!staff || !createdAt) continue;
        const action = String(row.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
        if (isExactOperationalCutoffOut(createdAt, action, DAY_CUTOFF_HOUR)) continue;
        const list = punchesByStaff.get(staff) ?? [];
        list.push({ action, created_at: createdAt });
        punchesByStaff.set(staff, list);
      }

      const staffIds = Array.from(punchesByStaff.keys());
      const employeesByStaff = new Map<string, HistoricalEmployeeRow>();
      for (let index = 0; index < staffIds.length; index += 200) {
        const batch = staffIds.slice(index, index + 200);
        const employeeRes = await supabase
          .from('ob_employees')
          .select('staff_id, name, agency, "Agency", position, "Position", shift, label, "Label", work_account, "WorkAccount"')
          .in('staff_id', batch)
          .limit(500);
        if (employeeRes.error) continue;
        for (const employee of ((employeeRes.data as HistoricalEmployeeRow[] | null) ?? [])) {
          const staff = String(employee.staff_id ?? '').trim().toUpperCase();
          if (staff && !employeesByStaff.has(staff)) employeesByStaff.set(staff, employee);
        }
      }

      const nextRows = staffIds
        .map((staff) => {
          const punches = punchesByStaff.get(staff) ?? [];
          const employee = employeesByStaff.get(staff);
          const firstPunchAt = punches[0]?.created_at ?? '';
          const shift = normalizeShiftValue(employee?.shift) || getShiftFromPunchTime(firstPunchAt) || 'early';
          const lastPunch = punches[punches.length - 1];
          const attendance: AttendanceView = lastPunch?.action === 'IN' ? 'Normal' : 'Completed';
          return {
            staff_id: staff,
            name: String(employee?.name ?? '').trim(),
            agency: String(employee?.agency ?? employee?.Agency ?? '').trim(),
            position: String(employee?.position ?? employee?.Position ?? '').trim(),
            shift: shift === 'early' ? 'Morning' : 'Night',
            attendance,
            label: String(employee?.label ?? employee?.Label ?? '').trim(),
            borrowed_device: '',
            account: String(employee?.work_account ?? employee?.WorkAccount ?? '').trim() || '-',
            mistake_count_7d: 0,
            punches
          };
        })
        .sort((left, right) => {
          const leftAt = left.punches[0]?.created_at ?? '';
          const rightAt = right.punches[0]?.created_at ?? '';
          const timeOrder = leftAt.localeCompare(rightAt, 'en-US');
          return timeOrder || left.staff_id.localeCompare(right.staff_id, 'en-US');
        });

      setHistoricalRosterRows(nextRows);
    } finally {
      setHistoricalRosterLoading(false);
    }
  };

  useEffect(() => {
    if (selectedOperationalDate === getCurrentOperationalDate()) {
      setHistoricalRosterRows([]);
      return;
    }
    void loadSnapshot(selectedOperationalDate);
    void loadHistoricalRoster(selectedOperationalDate);
  }, [selectedOperationalDate, homeDashboardPositionNames]);

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
  const historicalPunchPositions = useMemo(
    () =>
      historicalRosterRows
        .map((row) => normalizePositionKey(row.position, homeDashboardPositionNames) || String(row.position ?? '').trim())
        .filter(Boolean),
    [historicalRosterRows, homeDashboardPositionNames]
  );
  const effectiveCardPositions = useMemo(
    () => (isLiveDate ? cardPositions : buildDashboardCardPositions(homeDashboardPositionNames, [...snapshotPositions, ...historicalPunchPositions])),
    [cardPositions, historicalPunchPositions, homeDashboardPositionNames, isLiveDate, snapshotPositions]
  );

  const homeAttendanceStats = useMemo(() => {
    const rowInputs = homeRosterRowsCurrent
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
          attendance: row.attendance,
          workHours: computeWorkHoursFromPunches(row.punches ?? [], new Date())
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const stats = buildDashboardAttendanceStats(rowInputs);
    for (const position of cardPositions) {
      const live = homeCardStats[position];
      if (!live) continue;
      for (const shift of ['early', 'late'] as const) {
        const key = `${shift}:${position}`;
        const current = stats[key] ?? {
          expected: summaryByPosition.get(position)?.[shift] ?? 0,
          present: 0,
          onClock: 0,
          offWorked: 0,
          workHours: 0
        };
        stats[key] = {
          ...current,
          present: Number(live[shift] ?? 0),
          workHours: Number(homeWorkHoursByPositionShift[position]?.[shift] ?? current.workHours ?? 0)
        };
      }
    }
    return stats;
  }, [
    cardPositions,
    homeCardStats,
    homeWorkHoursByPositionShift,
    homeRosterRowsCurrent,
    homeDashboardPositionNames,
    summaryByPosition
  ]);

  const historicalPunchStats = useMemo(() => {
    const range = getOperationalDateRange(selectedOperationalDate);
    const rowInputs = historicalRosterRows
      .map((row) => {
        const position = normalizePositionKey(row.position, homeDashboardPositionNames);
        const shift = normalizeShiftValue(row.shift);
        const punches = row.punches ?? [];
        if (!position || !shift) return null;
        return {
          staffId: row.staff_id,
          position,
          shift,
          isExpected: false,
          hasPunch: punches.length > 0,
          isOnClock: punches[punches.length - 1]?.action === 'IN',
          attendance: row.attendance,
          workHours: computeWorkHoursFromPunches(punches, range.end)
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return buildDashboardAttendanceStats(rowInputs);
  }, [historicalRosterRows, homeDashboardPositionNames, selectedOperationalDate]);

  const historicalAttendanceStats = useMemo(
    () => mergeDashboardAttendanceActualsIntoExpected(snapshotStats, historicalPunchStats),
    [historicalPunchStats, snapshotStats]
  );

  const effectiveAttendanceStats = isLiveDate ? homeAttendanceStats : historicalAttendanceStats;
  const hasSnapshotStats = Object.keys(snapshotStats).length > 0;
  const hasHistoricalPunchStats = Object.keys(historicalPunchStats).length > 0;
  const hasAttendanceSummary = isLiveDate || hasSnapshotStats || hasHistoricalPunchStats;
  const effectivePositionDepartments = isLiveDate
    ? positionDepartmentByPosition
    : { ...positionDepartmentByPosition, ...snapshotDepartments };
  const effectiveExpectedByPosition = isLiveDate ? summaryByPosition : undefined;
  const effectiveRosterRows = isLiveDate ? homeRosterRowsCurrent : historicalRosterRows;

  const departmentCoverageCards = useMemo(
    () =>
      buildDashboardDepartmentCoverageCards({
        positions: effectiveCardPositions,
        positionDepartments: effectivePositionDepartments,
        stats: effectiveAttendanceStats,
        expectedByPosition: effectiveExpectedByPosition
      }),
    [effectiveCardPositions, effectiveAttendanceStats, effectiveExpectedByPosition, effectivePositionDepartments]
  );

  const visibleDepartmentCoverageCards = useMemo(
    () =>
      departmentCoverageCards.filter((card) =>
        dashboardDepartmentScope === 'ALL'
          ? DASHBOARD_PANEL_DEPARTMENTS.includes(card.department as Exclude<PositionDepartment, 'hidden'>)
          : card.department === dashboardDepartmentScope
      ),
    [dashboardDepartmentScope, departmentCoverageCards]
  );

  const departmentAttendanceGroups = useMemo(
    () =>
      buildDashboardDepartmentAttendanceGroups({
        positions: effectiveCardPositions,
        departments: DASHBOARD_PANEL_DEPARTMENTS,
        positionDepartments: effectivePositionDepartments,
        stats: effectiveAttendanceStats,
        expectedByPosition: effectiveExpectedByPosition
      }),
    [effectiveCardPositions, effectiveAttendanceStats, effectiveExpectedByPosition, effectivePositionDepartments]
  );

  const visibleDepartmentAttendanceGroups = useMemo(
    () =>
      departmentAttendanceGroups.filter((group) =>
        dashboardDepartmentScope === 'ALL' ? true : group.department === dashboardDepartmentScope
      ),
    [dashboardDepartmentScope, departmentAttendanceGroups]
  );

  const positionOptions = useMemo(
    () =>
      buildDashboardPositionOptions(
        homeDashboardPositionNames,
        effectiveRosterRows.map((row) => normalizePositionKey(row.position, homeDashboardPositionNames) || row.position)
      ).filter((position) => departmentFilter.length === 0 || departmentFilter.includes(normalizePositionDepartment(effectivePositionDepartments[position]))),
    [departmentFilter, effectivePositionDepartments, effectiveRosterRows, homeDashboardPositionNames]
  );

  const departmentOptions = useMemo(
    () =>
      POSITION_DEPARTMENTS.filter((department) =>
        effectiveRosterRows.some((row) => {
          const position = normalizePositionKey(row.position, homeDashboardPositionNames) || row.position;
          return normalizePositionDepartment(effectivePositionDepartments[position]) === department;
        })
      ),
    [effectivePositionDepartments, effectiveRosterRows, homeDashboardPositionNames]
  );

  const agencyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of effectiveRosterRows) {
      const agency = String(row.agency ?? '').trim();
      if (agency) set.add(agency);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }));
  }, [effectiveRosterRows]);

  const shiftOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of effectiveRosterRows) {
      const shift = normalizeShiftValue(row.shift);
      if (shift) set.add(shift);
    }
    return Array.from(set);
  }, [effectiveRosterRows]);

  const tableRows = useMemo<TableRow[]>(
    () =>
      effectiveRosterRows.map((row) => ({
        ...row,
        label: String(row.label ?? '').trim(),
        mistake_count_7d: Number(row.mistake_count_7d ?? 0),
        attendance: row.attendance ?? 'Normal',
        punches: Array.isArray(row.punches) ? row.punches : []
      })),
    [effectiveRosterRows]
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
        if (!departmentFilter.includes(normalizePositionDepartment(effectivePositionDepartments[key]))) return false;
      }
      if (shiftFilter.length > 0) {
        const rowShift = normalizeShiftValue(row.shift);
        if (!rowShift) return false;
        if (!shiftFilter.includes(rowShift)) return false;
      }
      if (attendanceFilters.length > 0 && !attendanceFilters.includes(row.attendance)) return false;
      return true;
    });
  }, [tableRows, search, agencyFilter, departmentFilter, effectivePositionDepartments, positionFilter, shiftFilter, absentOnly, onClockOnly, offWorkOnly, homeDashboardPositionNames]);

  const lastUpdatedAt = useMemo(() => {
    if (!isLiveDate) return snapshotUpdatedAt;
    return new Date().toLocaleString('en-CA', { hour12: false });
  }, [isLiveDate, snapshotUpdatedAt]);
  const calibrationWorkDate = normalizeDateOnly(selectedOperationalDate) || getCurrentOperationalDate();

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
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={selectedOperationalDate}
                  onChange={(event) => setSelectedOperationalDate(normalizeDateOnly(event.target.value) || getCurrentOperationalDate())}
                  className={[
                    'h-11 rounded-full border px-4 text-sm font-semibold outline-none transition',
                    isLight
                      ? 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50 focus:border-slate-400'
                      : 'border-white/10 bg-white/[0.05] text-stone-50 [color-scheme:dark] hover:bg-white/[0.08] focus:border-[#d9cfbf]/50'
                  ].join(' ')}
                />
                <button
                  type="button"
                  onClick={() => setSelectedOperationalDate(getCurrentOperationalDate())}
                  className={[
                    'h-11 rounded-full border px-4 text-sm font-semibold transition',
                    isLiveDate
                      ? isLight
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-[#d9cfbf]/40 bg-[#e8dfcf] text-[#181614]'
                      : isLight
                        ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        : 'border-white/10 bg-white/[0.05] text-stone-100 hover:bg-white/[0.08]'
                  ].join(' ')}
                >
                  Today
                </button>
                {!isLiveDate && snapshotStatus ? (
                  <span className={['rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]', isLight ? 'border-slate-200 bg-white text-slate-500' : 'border-white/10 bg-white/[0.04] text-stone-300'].join(' ')}>
                    {snapshotStatus}
                  </span>
                ) : null}
              </div>
              <div className={['text-sm', isLight ? 'text-slate-500' : 'text-stone-400'].join(' ')}>
                {snapshotLoading || historicalRosterLoading ? 'Loading...' : `Updated ${lastUpdatedAt || '-'}`}
              </div>
            </div>
            <div
              className={[
                'inline-flex w-full max-w-full items-center gap-1 rounded-full border p-1 lg:w-auto',
                isLight ? 'border-slate-200 bg-white/80' : 'border-white/10 bg-black/25'
              ].join(' ')}
              role="tablist"
              aria-label="Dashboard department"
            >
              {DASHBOARD_DEPARTMENT_SCOPE_OPTIONS.map((option) => {
                const selected = dashboardDepartmentScope === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    data-gooey-skip="true"
                    data-magic-button-skip="true"
                    onClick={() => handleDashboardDepartmentScopeChange(option.value)}
                    className={[
                      'h-9 min-w-0 flex-1 rounded-full border border-transparent px-4 text-sm font-semibold shadow-none outline-none ring-0 transition focus-visible:ring-2 focus-visible:ring-sky-400/50 lg:min-w-[64px] lg:flex-none',
                      selected
                        ? isLight
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'bg-[#e8dfcf] text-[#181614] shadow-[0_0_18px_rgba(232,223,207,0.16)]'
                        : isLight
                          ? 'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                          : 'bg-transparent text-stone-400 hover:bg-transparent hover:text-stone-100'
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {hasAttendanceSummary ? (
            <>
              <div className={dashboardDepartmentScope === 'ALL' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'grid gap-3 md:grid-cols-2'}>
                {visibleDepartmentCoverageCards.map((card) => {
                  const ratio = card.expected > 0 ? (card.present / card.expected) * 100 : 0;
                  const isMorning = card.shift === 'early';
                  const isOverPlan = card.present > card.expected;
                  const tonePosition = getDashboardDepartmentTonePosition(card.department);
                  return (
                    <ElectricBorder
                      key={`${card.department}:${card.shift}`}
                      color={getAttendanceBorderColor(tonePosition, isLight)}
                      speed={0.85}
                      chaos={0.1}
                      borderRadius={24}
                      className={[
                        'rounded-[24px] border px-5 py-4 shadow-none',
                        isLight ? getAttendanceCardClassLight(tonePosition) : getAttendanceCardClass(tonePosition)
                      ].join(' ')}
                    >
                      <div className="flex items-end justify-between gap-4">
                        <div className="min-w-0">
                          <div className={['text-[11px] font-semibold uppercase tracking-[0.18em]', isLight ? 'text-slate-500' : 'text-stone-400'].join(' ')}>{getDashboardDepartmentLabel(card.department)} {isMorning ? 'Morning' : 'Night'}</div>
                          <div className="mt-3 flex items-end gap-3">
                            <span className={['text-3xl font-semibold tracking-[-0.03em]', isOverPlan ? (isLight ? 'text-rose-600' : 'text-rose-300') : isLight ? 'text-slate-800' : 'text-stone-50'].join(' ')}>{card.present}/{card.expected}</span>
                            <span className={['pb-1 text-sm font-semibold', isOverPlan ? (isLight ? 'text-rose-600' : 'text-rose-300') : isLight ? (ratio < 80 ? 'text-rose-500' : ratio >= 90 ? getAttendanceCardValueClassLight(tonePosition) : 'text-slate-500') : ratio < 80 ? 'text-rose-300' : ratio >= 90 ? getAttendanceCardValueClass(tonePosition) : 'text-stone-300'].join(' ')}>
                              {card.expected > 0 ? `${ratio.toFixed(1)}% coverage` : '0.0% coverage'}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={['text-[10px] font-semibold uppercase tracking-[0.18em]', isLight ? 'text-slate-500' : 'text-stone-400'].join(' ')}>{t('总工时', 'Hours')}</div>
                          <div className={['mt-2 text-2xl font-semibold leading-none', isLight ? getAttendanceCardValueClassLight(tonePosition) : getAttendanceCardValueClass(tonePosition)].join(' ')}>
                            {formatDashboardHours(card.workHours)}
                          </div>
                        </div>
                      </div>
                    </ElectricBorder>
                  );
                })}
              </div>

              {dashboardDepartmentScope !== 'ALL' ? (
                <div className="space-y-4">
                  {visibleDepartmentAttendanceGroups.map((group) => (
                    <section key={`attendance:${group.department}`} className="space-y-2">
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                        {group.columns.map((column) => (
                          <div key={column.position} className="grid min-w-0 grid-rows-2 gap-3">
                            {column.cards.map((card) => {
                              const ratio = card.expected > 0 ? (card.present / card.expected) * 100 : 0;
                              const isOverPlan = card.present > card.expected;
                              return (
                                <ElectricBorder
                                  key={`${card.position}:${card.shift}`}
                                  color={getAttendanceBorderColor(card.position, isLight)}
                                  speed={0.85}
                                  chaos={0.1}
                                  borderRadius={24}
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
                                </ElectricBorder>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className={['rounded-[24px] border px-5 py-10 text-center text-sm font-semibold', isLight ? 'border-slate-200 bg-white/80 text-slate-600' : 'border-white/10 bg-black/20 text-stone-200'].join(' ')}>
              No snapshot for this date.
            </div>
          )}

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
                        {isLight ? (
                          <span className={['inline-flex items-center rounded-full border px-2.5 py-1', getScheduleTablePositionBadgeClass(row.position)].join(' ')}>
                            {row.position || '-'}
                          </span>
                        ) : (
                          <GlowLabelChip tone={getSchedulePositionTone(row.position)} className="min-w-[54px] uppercase tracking-[0.12em]">
                            {row.position || '-'}
                          </GlowLabelChip>
                        )}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3', isLight ? 'text-slate-600' : 'text-stone-300'].join(' ')}>
                        {isLight ? (
                          <span className={['inline-flex items-center rounded-full border px-2.5 py-1', getScheduleTableLabelBadgeClass(row.label || '-')].join(' ')}>{row.label || '-'}</span>
                        ) : (
                          <GlowLabelChip tone={row.label ? getScheduleLabelTone(row.label) : 'slate'} className="min-w-[34px]">
                            {row.label || '-'}
                          </GlowLabelChip>
                        )}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3', isLight ? 'text-slate-600' : 'text-stone-300'].join(' ')}>
                        {isLight ? (
                          <span className={['inline-flex items-center rounded-full border px-2.5 py-1', getScheduleTableShiftBadgeClass(normalizeShiftValue(row.shift))].join(' ')}>
                            {formatShiftLabel(row.shift)}
                          </span>
                        ) : (
                          <GlowLabelChip tone={getGlowToneForShift(row.shift)} className="min-w-[68px]">
                            {formatShiftLabel(row.shift)}
                          </GlowLabelChip>
                        )}
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
                                    : '';
                                return (
                                  <button
                                    key={`${row.staff_id}-${punchIndex}`}
                                    type="button"
                                    disabled={!onOpenTimecardCalibration || !calibrationWorkDate}
                                    onClick={() => {
                                      if (!onOpenTimecardCalibration) return;
                                      if (!row.staff_id || !calibrationWorkDate) return;
                                      void onOpenTimecardCalibration(row.staff_id, calibrationWorkDate);
                                    }}
                                    title={t('打开工时校正', 'Open timecard correction')}
                                    className={[
                                      isLight
                                        ? 'inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase transition focus:outline-none focus:ring-2 focus:ring-sky-400/60 disabled:cursor-default disabled:opacity-80'
                                        : 'inline-flex rounded-full transition focus:outline-none focus:ring-2 focus:ring-sky-400/60 disabled:cursor-default disabled:opacity-80',
                                      onOpenTimecardCalibration ? 'hover:-translate-y-px' : '',
                                      toneClass
                                    ].join(' ')}
                                  >
                                    {isLight ? (
                                      <>{punch.action} {formatTimeOnly(punch.created_at)}</>
                                    ) : (
                                      <GlowLabelChip
                                        tone={shortGapIndices.has(punchIndex) ? 'rose' : getGlowToneForPunch(punch.action)}
                                        className="min-w-[72px] py-1 text-[10px] uppercase"
                                      >
                                        {punch.action} {formatTimeOnly(punch.created_at)}
                                      </GlowLabelChip>
                                    )}
                                  </button>
                                );
                              })}
                              {row.punches.length > 4 ? (
                                <button
                                  type="button"
                                  title={`+${row.punches.length - 4} more`}
                                  onClick={() => {
                                    if (!onOpenTimecardCalibration) return;
                                    if (!row.staff_id || !calibrationWorkDate) return;
                                    void onOpenTimecardCalibration(row.staff_id, calibrationWorkDate);
                                  }}
                                  className={[
                                    isLight
                                      ? 'inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold transition badge-elevated-light border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                      : 'inline-flex rounded-full transition'
                                  ].join(' ')}
                                >
                                  {isLight ? (
                                    <>+{row.punches.length - 4}</>
                                  ) : (
                                    <GlowLabelChip tone="amber" className="min-w-[38px] py-1 text-[10px]">
                                      +{row.punches.length - 4}
                                    </GlowLabelChip>
                                  )}
                                </button>
                              ) : null}
                            </>
                          ) : (
                            isLight ? (
                              <span className="inline-flex items-center rounded-full border px-2 py-1 text-[10px] badge-elevated-light border-slate-200 bg-white text-slate-400">--</span>
                            ) : (
                              <GlowLabelChip tone="slate" className="min-w-[34px] py-1 text-[10px]">
                                --
                              </GlowLabelChip>
                            )
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
