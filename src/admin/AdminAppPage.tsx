import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';

import { createSupabaseClient, createSupabaseClientWithCredentials } from '../lib/supabase';
import { isValidStaffId as isValidStaffIdValue, normalizeStaffId } from '../lib/staffId';
import { matchesLooseSearch } from '../lib/textSearch';
import {
  LABEL_TONE_KEYS,
  type LabelToneKey,
  loadLabelToneMap,
  saveLabelToneMap
} from '../lib/labelTone';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import AdminHeader from './components/AdminHeader';
import AdminNav from './components/AdminNav';
import BusyOverlay from './components/BusyOverlay';
import AdminLoginPanel from './components/AdminLoginPanel';
import ScheduleToolbar from './components/ScheduleToolbar';
import DailyListNewHireModal from './components/DailyListNewHireModal';
import AdminUserAvatar from './components/AdminUserAvatar';
import DevicesPage from './pages/DevicesPage';
import EmployeeUploadPage from './pages/EmployeeUploadPage';
import AccountManagementPage from './pages/AccountManagementPage';
import AdminPermissionsPage from './pages/AdminPermissionsPage';
import EmployeesToolbar from './pages/EmployeesToolbar';
import EmployeeAddModal from './pages/EmployeeAddModal';
import EmployeesTableSection from './pages/EmployeesTableSection';
import EmployeeAuditModal from './pages/EmployeeAuditModal';
import EmployeeEditModal from './pages/EmployeeEditModal';
import EmployeeBadgePreviewModal from './pages/EmployeeBadgePreviewModal';
import TimecardControls from './pages/TimecardControls';
import TimecardTableSection from './pages/TimecardTableSection';
import HomeDashboardPage from './pages/HomeDashboardPage';
import PackageMetricsPage from './pages/PackageMetricsPage';
import AuditPage from './pages/AuditPage';
import PunchesPage from './pages/PunchesPage';
import ForecastPage from './pages/ForecastPage';
import PredictionModelPage from './pages/PredictionModelPage';
import EfficiencyPage from './pages/EfficiencyPage';
import WorkHourComparisonPage from './pages/WorkHourComparisonPage';
import LeaveApprovalPage from './pages/LeaveApprovalPage';
import TodoPage from './pages/TodoPage';
import AppDialog from '../components/AppDialog';
import {
  canManageAdminAccess,
  canReviewTerminationRequests,
  getModuleMapFromContext,
  hasModuleAccess,
  type AdminAccessContext
} from '../shared/adminAccess';
import {
  DAILY_LIST_LIGHTS_KEY,
  DAILY_LIST_LIGHT_POSITIONS,
  buildDailyListLightsSettingValue,
  createEmptyDailyListLightFlags,
  normalizeDailyListLightPosition,
  readDailyListLightsForDate,
  type DailyListLightFlags,
  type DailyListLightPosition
} from '../shared/dailyListLights';
import { isScheduleOnlyAgency } from '../shared/agencyRules';
import {
  createAdminAccessRequest,
  fetchAdminAccessContext,
  listAdminAccessAccounts,
  listAdminAccessRequests,
  listEmployeeTerminationRequests,
  reviewAdminAccessRequest,
  reviewEmployeeTerminationRequest,
  saveAdminAccessAccount,
  type AdminAccessAccountRecord,
  type AdminAccessRequestCreatePayload,
  type AdminAccessRequestRecord,
  type AdminAccessSavePayload,
  type AdminAccessUserOption,
  type TerminationRequestRecord
} from './adminAccessApi';
import { useScheduleRealtime } from './useScheduleRealtime';
import {
  activatePlannedScheduleNote,
  buildDailyPlannedActivationUpserts,
  buildWeeklyRolloverUpserts,
  normalizeScheduleNoteForWeeklyReset,
  shouldActivateDailyPlannedStates,
  shouldRunWeeklyScheduleReset,
  shouldRunWeeklyScheduleRollover
} from './scheduleWeek';
import { formatRoundedHours, getTimecardTerminatedByDay } from './timecardDisplay';
import {
  buildStaleLateAutoDeletePlan,
  evaluateLateDecision,
  formatClockMinutes,
  getClockMinutesFromDate,
  LATE_GUARDRAIL_BUFFER_MINUTES,
  LATE_GRACE_MINUTES,
  parseClockTextToMinutes,
  type LateBaselineSource,
  type LateRoundingFamily,
  type LateSample
} from './lateMarks';
import { fetchTodoNavPendingCount, fetchTodoProfiles } from './todoData';
import { TODO_UPDATED_EVENT } from './todoShared';
import { buildAdminUserIdentityView, type AdminUserIdentityView } from './adminIdentity';
import { shouldAutofillShiftTime } from './shiftTimeAutofill';
import {
  loadDailyCapacityStaffStats,
  type DailyCapacityProcKey,
  type DailyCapacityStaffStats
} from './dailyCapacity';
import {
  applyFlexCoverageToRecommendedRows,
  buildFlexCoverageByDayIndex,
  normalizeFlexCoverageTargetPosition
} from './flexCoverage';
import type {
  AdminPage,
  AllowedPosition,
  AppSettingRow,
  AuditRow,
  DailyListRow,
  DeviceLabelPrintPayload,
  DeviceLabelPrintPreview,
  DeviceLoanRow,
  DeviceRow,
  DeviceType,
  EmploymentType,
  EmployeeRow,
  PunchRow,
  ScheduleBaseState,
  ScheduleDisplayState,
  SchedulePickerState,
  ScheduleRow,
  Status,
  TimecardRow
} from './types';

type ScheduleMistakeDetail = {
  operational_date: string;
  position: string;
  reason: string;
  reporter_staff_id: string;
  created_at: string;
};
type ScheduleMistakeDraft = {
  open: boolean;
  staff_id: string;
  name: string;
  position: string;
  reason: string;
  saving: boolean;
};
type LateMarkView = {
  minutesLate: number;
  source: LateBaselineSource;
  roundingFamily: LateRoundingFamily;
  learnedExpectedStartRaw: string;
  learnedExpectedStartRounded: string;
  guardrailExpectedStart: string;
  finalExpectedStart: string;
  firstIn: string;
  sampleCount: number;
};
type LateMarkPersistRow = {
  staff_id: string;
  work_date: string;
  mark_type: 'late';
  source: string;
  operator: string | null;
  payload: Record<string, unknown>;
  updated_at: string;
};
type NonLateAttendanceMarkPersistRow = {
  staff_id: string;
  work_date: string;
  mark_type: 'absent' | 'excuse' | 'temporary_leave';
  source: string;
  operator: string | null;
  payload: Record<string, unknown>;
  updated_at: string;
};
type SyncLateMarksForWeekResult = {
  lateByStaffDayKey: Record<string, LateMarkView>;
  persistRows: LateMarkPersistRow[];
  targetStaffIds: string[];
  rangeStart: string;
  rangeEnd: string;
};
type DailyListCapacitySource = 'recent14' | 'template_fallback' | 'excluded' | 'transfer' | 'unmapped';
type DailyListCapacityView = {
  capacity: number | null;
  source: DailyListCapacitySource;
  procKey: DailyCapacityProcKey | null;
  uph: number | null;
  ewh: number | null;
};

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const ALLOWED_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'Water Spider', 'FLEX TEAM'] as const;
const DAILY_LIST_VISIBLE_POSITIONS = DAILY_LIST_LIGHT_POSITIONS.filter((position) => position !== 'FLEX TEAM');
const AUDIT_TABLE = (import.meta.env.VITE_AUDIT_TABLE as string | undefined) ?? 'ob_audit_logs';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';
const APP_SETTINGS_TABLE = (import.meta.env.VITE_APP_SETTINGS_TABLE as string | undefined) ?? 'ob_app_settings';
const USER_PROFILE_TABLE = (import.meta.env.VITE_USER_PROFILE_TABLE as string | undefined) ?? 'ob_user_profiles';
const PROFILE_AVATAR_BUCKET = (import.meta.env.VITE_PROFILE_AVATAR_BUCKET as string | undefined) ?? 'profile-avatars';
const ATTENDANCE_MARKS_TABLE = (import.meta.env.VITE_ATTENDANCE_MARKS_TABLE as string | undefined) ?? 'ob_attendance_marks';
const DEVICE_TABLE = (import.meta.env.VITE_DEVICE_TABLE as string | undefined) ?? 'ob_devices';
const DEVICE_LOANS_TABLE = (import.meta.env.VITE_DEVICE_LOANS_TABLE as string | undefined) ?? 'ob_device_loans';
const DEVICE_LOANS_FETCH_LIMIT = 500; // Paginated fetch: 500 records per page
const DEVICE_LOANS_LOOKBACK_DAYS = 30; // Only fetch loans from last 30 days
const TEMP_ACCOUNT_TABLE = (import.meta.env.VITE_TEMP_ACCOUNT_TABLE as string | undefined) ?? 'ob_temp_accounts';
const TEMP_ACCOUNT_ASSIGNMENT_TABLE =
  (import.meta.env.VITE_TEMP_ACCOUNT_ASSIGNMENT_TABLE as string | undefined) ?? 'ob_temp_account_assignments';
const DEFAULT_WORK_PASSWORD = 'Helloworld2!';
const resolveDefaultWorkPassword = (workAccount: string, workPassword: string) =>
  workAccount && !workPassword ? DEFAULT_WORK_PASSWORD : workPassword;
const DEVICE_COUNTING_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const DEVICE_COUNTED_AT_NOTE_PATTERN = /\[COUNTED_AT=([^\]]+)\]/i;
const OBUP_REPORTS_TABLE = (import.meta.env.VITE_OBUP_REPORTS_TABLE as string | undefined) ?? 'reports';
const OBUP_REPORT_DETAILS_TABLE =
  (import.meta.env.VITE_OBUP_REPORT_DETAILS_TABLE as string | undefined) ?? 'report_details';
const OBUP_UPLOAD_RECORDS_TABLE = (import.meta.env.VITE_OBUP_UPLOAD_RECORDS_TABLE as string | undefined) ?? 'upload_records';
const MISTAKE_REPORT_TABLE = (import.meta.env.VITE_MISTAKE_REPORT_TABLE as string | undefined) ?? 'ob_mistake_reports';
const SCHEDULE_UPH_DAYS = 30;
const STAFF_ID_EDITOR_EMAIL = 'lnchen4201@gmail.com';
const ATTENDANCE_MARK_TYPES = ['absent', 'excuse', 'temporary_leave', 'late'] as const;
const NON_LATE_ATTENDANCE_MARK_TYPES = ['absent', 'excuse', 'temporary_leave'] as const;
const DEFAULT_TIMECARD_ATTENDANCE_SYNC_TABLES = ATTENDANCE_MARKS_TABLE === 'ob_attendance_marks';
const LATE_LOOKBACK_DAYS = 120;
const LATE_MIN_VALID_PUNCH_COUNT = 2;
const SCHEDULE_WEEK_RESET_KEY = 'schedule_transient_reset_week';
const SCHEDULE_WEEK_ROLLOVER_KEY = 'schedule_week_rollover_marker';
const SCHEDULE_DAILY_PLAN_ACTIVATION_KEY = 'schedule_daily_plan_activation_marker';
const SCHEDULE_LABEL_TONES_KEY = 'schedule_label_tones_v1';
const SCHEDULE_POSITION_TONES_KEY = 'schedule_position_tones_v1';
const SCHEDULE_REST_NOTE = '__rest__';
const SCHEDULE_NEW_NOTE = '__new__';
const SCHEDULE_FIXED_WORK_NOTE = '__fixed_work__';
const SCHEDULE_TEMP_WORK_NOTE = '__temp_work__';
const SCHEDULE_LEAVE_NOTE = '__leave__';
const SCHEDULE_TEMP_REST_NOTE = '__temp_rest__';
const SCHEDULE_REPLACEMENT_NOTE = '__replacement__';
const SCHEDULE_PLANNED_TEMP_WORK_NOTE = '__planned_temp_work__';
const SCHEDULE_PLANNED_LEAVE_NOTE = '__planned_leave__';
const SCHEDULE_PLANNED_TEMP_REST_NOTE = '__planned_temp_rest__';
const STALE_TIMECARD_REQUEST = '__stale_timecard_request__';
// 预定义的默认设备类型（用于向后兼容和作为初始化默认值）
// 实际可用的设备类型会在运行时从导入的数据中动态生成
const DEFAULT_DEVICE_TYPES = ['PDA', 'CART'] as const;
const EFFICIENCY_TEMPLATE_TABLE = 'efficiency_templates';
const EFFICIENCY_FORECAST_INPUT_TABLE = 'volume_forecast_daily_inputs';
const EFFICIENCY_HISTORY_TABLE = 'volume_history';
const EFF_HOUR_COLUMNS = [
  'h00', 'h01', 'h02', 'h03', 'h04', 'h05', 'h06', 'h07', 'h08', 'h09', 'h10', 'h11',
  'h12', 'h13', 'h14', 'h15', 'h16', 'h17', 'h18', 'h19', 'h20', 'h21', 'h22', 'h23'
] as const;

type EffInboundKey =
  | 'oi_pieces'
  | 'oi_packages'
  | 'single_ratio_pcs'
  | 'multi_ratio_pcs'
  | 'single_ratio_pkgs'
  | 'multi_ratio_pkgs'
  | 'multi_pcs_per_pkg'
  | 'single_pkgs'
  | 'single_piece'
  | 'multi_pkgs'
  | 'multi_piece';
type EffProcKey = 'pick' | 'consolidation' | 'rebin' | 'waterspider' | 'multi_pack' | 'single_pack' | 'pre_ship';
type EffInboundMap = Record<EffInboundKey, string>;
type EffProcRowLite = { uph: string; goal: string; ewh: string; people: string; lead: string };
type EffProcMap = Record<EffProcKey, EffProcRowLite>;
type EffPayloadLite = {
  orderInboundDs: EffInboundMap;
  orderInboundNs: EffInboundMap;
  areaEfficiencyDs: EffProcMap;
  areaEfficiencyNs: EffProcMap;
};
type EffForecastInputRow = {
  input_date: string;
  previous_day_backlog: number;
  full_day_capacity: number;
  yesterday_inflow_00_14: number;
  actual_day_shift_plan?: number | null;
  actual_night_shift_plan?: number | null;
};
type EffVolumeHistoryRow = {
  date: string;
  last_filled_hour?: number | null;
} & Record<(typeof EFF_HOUR_COLUMNS)[number], number | null>;
type ScheduleRecommendedPosition = {
  key: 'Pick' | 'Rebin' | 'Pack' | 'Preship' | 'Water Spider';
  total: number;
  ds: number;
  ns: number;
};
type ScheduleRecommendedByDate = Record<string, ScheduleRecommendedPosition[]>;

const getScheduleBaseStateFromNote = (note: unknown): ScheduleBaseState => {
  const value = String(note ?? '').trim();
  if (value === SCHEDULE_NEW_NOTE) return 'new';
  if (value === SCHEDULE_FIXED_WORK_NOTE) return 'fixed_work';
  if (value === SCHEDULE_TEMP_WORK_NOTE) return 'temp_work';
  if (value === SCHEDULE_LEAVE_NOTE) return 'leave';
  if (value === SCHEDULE_TEMP_REST_NOTE) return 'temp_rest';
  if (value === SCHEDULE_REPLACEMENT_NOTE) return 'planned_temp_work';
  if (value === SCHEDULE_PLANNED_TEMP_WORK_NOTE) return 'planned_temp_work';
  if (value === SCHEDULE_PLANNED_LEAVE_NOTE) return 'planned_leave';
  if (value === SCHEDULE_PLANNED_TEMP_REST_NOTE) return 'planned_temp_rest';
  if (value === SCHEDULE_REST_NOTE) return 'rest';
  return 'work';
};

const getScheduleNoteFromBaseState = (state: ScheduleBaseState): string | null => {
  if (state === 'new') return SCHEDULE_NEW_NOTE;
  if (state === 'work') return null;
  if (state === 'fixed_work') return SCHEDULE_FIXED_WORK_NOTE;
  if (state === 'temp_work') return SCHEDULE_TEMP_WORK_NOTE;
  if (state === 'leave') return SCHEDULE_LEAVE_NOTE;
  if (state === 'temp_rest') return SCHEDULE_TEMP_REST_NOTE;
  if (state === 'planned_temp_work') return SCHEDULE_REPLACEMENT_NOTE;
  if (state === 'planned_leave') return SCHEDULE_PLANNED_LEAVE_NOTE;
  if (state === 'planned_temp_rest') return SCHEDULE_PLANNED_TEMP_REST_NOTE;
  return SCHEDULE_REST_NOTE;
};

const isWorkingScheduleBaseState = (state: ScheduleBaseState) =>
  state === 'new' || state === 'work' || state === 'fixed_work' || state === 'temp_work' || state === 'planned_temp_work';
const isRestLikeScheduleBaseState = (state: ScheduleBaseState) =>
  state === 'rest' || state === 'temp_rest' || state === 'leave' || state === 'planned_temp_rest' || state === 'planned_leave';

const isWorkingScheduleRow = (row: ScheduleRow | null | undefined) =>
  Boolean(row && isWorkingScheduleBaseState(getScheduleBaseStateFromNote(row.note)));

const toSortEpochMs = (value: unknown) => {
  const ms = Date.parse(String(value ?? '').trim());
  return Number.isFinite(ms) ? ms : 0;
};

const toSortId = (value: unknown) => {
  const id = Number(value);
  return Number.isFinite(id) ? id : 0;
};

const isScheduleRowNewer = (candidate: ScheduleRow, current: ScheduleRow) => {
  const candidateMs = Math.max(toSortEpochMs(candidate.updated_at), toSortEpochMs(candidate.created_at));
  const currentMs = Math.max(toSortEpochMs(current.updated_at), toSortEpochMs(current.created_at));
  if (candidateMs !== currentMs) return candidateMs > currentMs;
  return toSortId(candidate.id) > toSortId(current.id);
};

const pickLatestScheduleRowsByStaffDate = (rows: ScheduleRow[]) => {
  const byKey = new Map<string, ScheduleRow>();
  for (const row of rows) {
    const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
    const workDate = String(row.date ?? '').trim();
    if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) continue;
    const key = `${staff}__${workDate}`;
    const existing = byKey.get(key);
    if (!existing || isScheduleRowNewer(row, existing)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
};

const getScheduleDisplayState = (
  row: ScheduleRow | undefined,
  hasPunch: boolean,
  options?: { showAbsent?: boolean }
): ScheduleDisplayState => {
  if (!row) return hasPunch ? 'rest_worked' : 'rest';
  const base = getScheduleBaseStateFromNote(row.note);
  if (hasPunch && isRestLikeScheduleBaseState(base)) return 'rest_worked';
  if (!hasPunch && options?.showAbsent && isWorkingScheduleBaseState(base)) return 'absent';
  return base;
};

const supabase = createSupabaseClient({ persistSession: true });

// --- Session restoration logic for Admin auto-login ---


const obupSupabase = createSupabaseClientWithCredentials({
  persistSession: false,
  url: import.meta.env.VITE_OBUP_SUPABASE_URL as string | undefined,
  anonKey: import.meta.env.VITE_OBUP_SUPABASE_ANON_KEY as string | undefined
});

const normalizeWorkAccountKey = (value: string) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  const parenMatch = raw.match(/\(([^)]+)\)/);
  if (parenMatch?.[1]) {
    const inside = parenMatch[1].replace(/\s+/g, '');
    const digitsInside = inside.match(/\d{5,}/g);
    if (digitsInside && digitsInside.length > 0) return digitsInside[digitsInside.length - 1];
    if (inside) return inside;
  }
  const allDigits = raw.match(/\d{5,}/g);
  if (allDigits && allDigits.length > 0) return allDigits[allDigits.length - 1];
  return raw.replace(/\s+/g, '');
};

const parseUph = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return n;
};

const isMissingTableError = (message: unknown, table: string) => {
  const text = String(message ?? '').toLowerCase();
  const target = String(table ?? '').toLowerCase();
  return (
    text.includes('could not find the table') ||
    text.includes('relation') ||
    text.includes('does not exist')
  ) && text.includes(target);
};

const isMissingLateSyncRpcError = (error: unknown) => {
  const text = String(
    typeof error === 'object' && error !== null
      ? `${(error as { code?: unknown }).code ?? ''} ${(error as { message?: unknown }).message ?? ''} ${(error as { details?: unknown }).details ?? ''}`
      : error ?? ''
  ).toLowerCase();
  return (
    text.includes('sync_late_attendance_marks') &&
    (text.includes('could not find') || text.includes('function') || text.includes('schema cache') || text.includes('pgrst'))
  );
};

const isMissingTimecardAttendanceSyncRpcError = (error: unknown) => {
  const text = String(
    typeof error === 'object' && error !== null
      ? `${(error as { code?: unknown }).code ?? ''} ${(error as { message?: unknown }).message ?? ''} ${(error as { details?: unknown }).details ?? ''}`
      : error ?? ''
  ).toLowerCase();
  return (
    text.includes('sync_timecard_attendance_marks') &&
    (text.includes('could not find') || text.includes('function') || text.includes('schema cache') || text.includes('pgrst'))
  );
};

const fetchAllPagedRows = async <T,>(options: {
  pageSize?: number;
  fetchPage: (from: number, to: number) => Promise<{ data?: T[] | null; error?: { message?: string } | null }>;
  shouldStop?: () => boolean;
  stopError?: string;
}) => {
  const pageSize = Math.max(1, Number(options.pageSize ?? 1000));
  const allRows: T[] = [];
  for (let page = 0; ; page += 1) {
    if (options.shouldStop?.()) {
      return { rows: [] as T[], error: options.stopError ?? 'Stopped' };
    }
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const res = await options.fetchPage(from, to);
    if (res.error?.message) {
      return { rows: [] as T[], error: res.error.message };
    }
    const pageRows = Array.isArray(res.data) ? res.data : [];
    allRows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return { rows: allRows, error: null as string | null };
};

const formatUph = (value: number | null | undefined) => (value === null || value === undefined ? '-' : value.toFixed(1));
const formatCapacityValue = (value: number | null | undefined) =>
  value === null || value === undefined ? '-' : Math.round(value).toLocaleString('en-US');
const isEmployeeActive = (employee: EmployeeRow | null | undefined) => {
  if (!employee) return true;
  const raw = (employee as any).active;
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  if (!text) return true;
  if (text === 'false' || text === '0' || text === 'f' || text === 'no') return false;
  return true;
};

const formatTime = (value: Date, locale: string = 'zh-CN') =>
  value.toLocaleString(locale, {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

const toDateOnly = (value: Date) => {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const startOfWeekMonday = (value: Date) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d;
};

const addDays = (value: Date, days: number) => {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d;
};

const effToNum = (value: string | number | null | undefined) => {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const effToPercent = (value: string | number | null | undefined) => {
  const text = String(value ?? '').trim().replace('%', '');
  const n = Number(text);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
};
const effRoundRule = (value: number, mode: 'ceil' | 'floor' | 'round') => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (mode === 'ceil') return Math.ceil(value);
  if (mode === 'floor') return Math.floor(value);
  return Math.round(value);
};
const effDefaultInbound = (values: Partial<EffInboundMap> = {}): EffInboundMap => ({
  oi_pieces: '',
  oi_packages: '',
  single_ratio_pcs: '',
  multi_ratio_pcs: '',
  single_ratio_pkgs: '',
  multi_ratio_pkgs: '',
  multi_pcs_per_pkg: '',
  single_pkgs: '',
  single_piece: '',
  multi_pkgs: '',
  multi_piece: '',
  ...values
});
const effDefaultProc = (values: Partial<EffProcMap>): EffProcMap => ({
  pick: { uph: '', goal: '', ewh: '', people: '', lead: '' },
  consolidation: { uph: '', goal: '', ewh: '', people: '', lead: '' },
  rebin: { uph: '', goal: '', ewh: '', people: '', lead: '' },
  waterspider: { uph: '', goal: '', ewh: '', people: '', lead: '' },
  multi_pack: { uph: '', goal: '', ewh: '', people: '', lead: '' },
  single_pack: { uph: '', goal: '', ewh: '', people: '', lead: '' },
  pre_ship: { uph: '', goal: '', ewh: '', people: '', lead: '' },
  ...values
});
const effDefaultPayload = (): EffPayloadLite => ({
  orderInboundDs: effDefaultInbound(),
  orderInboundNs: effDefaultInbound(),
  areaEfficiencyDs: effDefaultProc({
    pick: { uph: '120', goal: '120', ewh: '7.5', people: '34', lead: '4' },
    consolidation: { uph: '1000', goal: 'N/A', ewh: '7.5', people: '1', lead: '0' },
    rebin: { uph: '400', goal: '400', ewh: '6.5', people: '5', lead: '1' },
    waterspider: { uph: '700', goal: 'N/A', ewh: '7.5', people: '4', lead: '0' },
    multi_pack: { uph: '200', goal: '170', ewh: '6.5', people: '8', lead: '1' },
    single_pack: { uph: '140', goal: '115', ewh: '7.5', people: '18', lead: '2' },
    pre_ship: { uph: '400', goal: '500', ewh: '8', people: '7', lead: '1' }
  }),
  areaEfficiencyNs: effDefaultProc({
    pick: { uph: '120', goal: '113', ewh: '7.5', people: '12', lead: '2' },
    consolidation: { uph: '1000', goal: '938', ewh: '7.5', people: '1', lead: '1' },
    rebin: { uph: '450', goal: '366', ewh: '6.5', people: '2', lead: '1' },
    waterspider: { uph: '700', goal: '656', ewh: '7.5', people: '1', lead: '0' },
    multi_pack: { uph: '200', goal: '163', ewh: '6.5', people: '3', lead: '1' },
    single_pack: { uph: '130', goal: '122', ewh: '7.5', people: '7', lead: '1' },
    pre_ship: { uph: '400', goal: '400', ewh: '8', people: '2', lead: '1' }
  })
});
const effNormalizePayload = (payload: any): EffPayloadLite => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const inboundMap = (rows: any[]) =>
    effDefaultInbound(Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [String(row?.key ?? ''), String(row?.value ?? '')])) as Partial<EffInboundMap>);
  const procMap = (rows: any[]) =>
    effDefaultProc(Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [String(row?.key ?? ''), { uph: String(row?.uph ?? ''), goal: String(row?.goal ?? ''), ewh: String(row?.ewh ?? ''), people: String(row?.people ?? ''), lead: String(row?.lead ?? '') }])) as Partial<EffProcMap>);
  return {
    orderInboundDs: inboundMap(source.orderInboundDs),
    orderInboundNs: inboundMap(source.orderInboundNs),
    areaEfficiencyDs: procMap(source.areaEfficiencyDs),
    areaEfficiencyNs: procMap(source.areaEfficiencyNs)
  };
};
const effGetInbound = (rows: EffInboundMap, key: EffInboundKey) => rows[key] ?? '';
const effWithInboundPieces = (rows: EffInboundMap, nextPieces: number | null): EffInboundMap => {
  if (!Number.isFinite(nextPieces ?? NaN) || nextPieces === null) return rows;
  const totalPieces = Math.max(0, Math.round(nextPieces));
  const basePieces = effToNum(effGetInbound(rows, 'oi_pieces'));
  const basePackages = effToNum(effGetInbound(rows, 'oi_packages'));
  const singleRatioPcs = effToPercent(effGetInbound(rows, 'single_ratio_pcs'));
  const multiRatioPcs = effToPercent(effGetInbound(rows, 'multi_ratio_pcs'));
  const singleRatioPkgs = effToPercent(effGetInbound(rows, 'single_ratio_pkgs'));
  const multiRatioPkgs = effToPercent(effGetInbound(rows, 'multi_ratio_pkgs'));
  const multiPcsPerPkg = effToNum(effGetInbound(rows, 'multi_pcs_per_pkg'));
  const packagePerPiece = basePieces > 0 && basePackages > 0 ? basePackages / basePieces : 0;
  const totalPackages = packagePerPiece > 0 ? Math.max(0, Math.round(totalPieces * packagePerPiece)) : basePackages;
  const singlePiece = Math.max(0, Math.round(totalPieces * singleRatioPcs));
  const multiPiece = Math.max(0, Math.round(totalPieces * (multiRatioPcs > 0 ? multiRatioPcs : 1 - singleRatioPcs)));
  const singlePkgs = singleRatioPkgs > 0 ? Math.max(0, Math.round(totalPackages * singleRatioPkgs)) : effToNum(effGetInbound(rows, 'single_pkgs'));
  const multiPkgs = multiPcsPerPkg > 0
    ? Math.max(0, Math.round(multiPiece / multiPcsPerPkg))
    : multiRatioPkgs > 0
      ? Math.max(0, Math.round(totalPackages * multiRatioPkgs))
      : effToNum(effGetInbound(rows, 'multi_pkgs'));
  return {
    ...rows,
    oi_pieces: String(totalPieces),
    oi_packages: totalPackages > 0 ? String(totalPackages) : '',
    single_piece: singlePiece > 0 ? String(singlePiece) : '',
    multi_piece: multiPiece > 0 ? String(multiPiece) : '',
    single_pkgs: singlePkgs > 0 ? String(singlePkgs) : '',
    multi_pkgs: multiPkgs > 0 ? String(multiPkgs) : ''
  };
};
const effDeriveInboundVolume = (rows: EffInboundMap) => {
  const totalPieces = effToNum(effGetInbound(rows, 'oi_pieces'));
  const totalPackages = effToNum(effGetInbound(rows, 'oi_packages'));
  const singleRatioPcs = effToPercent(effGetInbound(rows, 'single_ratio_pcs'));
  const multiRatioPcs = effToPercent(effGetInbound(rows, 'multi_ratio_pcs'));
  const singleRatioPkgs = effToPercent(effGetInbound(rows, 'single_ratio_pkgs'));
  const multiRatioPkgs = effToPercent(effGetInbound(rows, 'multi_ratio_pkgs'));
  const multiPcsPerPkg = effToNum(effGetInbound(rows, 'multi_pcs_per_pkg'));
  const singlePiece = effToNum(effGetInbound(rows, 'single_piece')) || Math.round(totalPieces * singleRatioPcs);
  const multiPiece = effToNum(effGetInbound(rows, 'multi_piece')) || Math.round(totalPieces * multiRatioPcs);
  const singlePkgs = effToNum(effGetInbound(rows, 'single_pkgs')) || Math.round(totalPackages * singleRatioPkgs);
  const multiPkgs =
    effToNum(effGetInbound(rows, 'multi_pkgs')) ||
    Math.round(totalPackages * multiRatioPkgs) ||
    (multiPcsPerPkg > 0 ? Math.round(multiPiece / multiPcsPerPkg) : 0);
  return { totalPieces, totalPackages, singlePiece, multiPiece, singlePkgs, multiPkgs };
};
const effCalcRequirement = (workload: number, proc: EffProcRowLite | undefined, mode: 'ceil' | 'floor' | 'round') => {
  if (!proc) return 0;
  const uph = effToNum(proc.uph);
  const ewh = effToNum(proc.ewh);
  const lead = effToNum(proc.lead);
  if (!uph || !ewh || workload <= 0) return lead;
  return effRoundRule(workload / (uph * ewh), mode) + lead;
};
const effGetProcRowForShift = (
  payload: EffPayloadLite,
  shift: 'early' | 'late',
  procKey: DailyCapacityProcKey
): EffProcRowLite | undefined => (shift === 'early' ? payload.areaEfficiencyDs[procKey] : payload.areaEfficiencyNs[procKey]);
const resolveDailyListCapacityForRow = (
  row: DailyListRow,
  staffStatsByStaffId: Record<string, DailyCapacityStaffStats>,
  templatePayload: EffPayloadLite
): DailyListCapacityView => {
  const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
  const position = normalizeAllowedPosition(String(row.position ?? '').trim());
  if (!staff || !position) {
    return { capacity: null, source: 'unmapped', procKey: null, uph: null, ewh: null };
  }
  if (position === 'Transfer') {
    return { capacity: null, source: 'transfer', procKey: null, uph: null, ewh: null };
  }
  const stats = staffStatsByStaffId[staff];
  if (!stats) {
    return { capacity: null, source: 'unmapped', procKey: null, uph: null, ewh: null };
  }
  if (stats.excluded) {
    return { capacity: null, source: 'excluded', procKey: null, uph: null, ewh: null };
  }
  if (!stats.procKey) {
    return { capacity: null, source: 'unmapped', procKey: null, uph: null, ewh: null };
  }
  const proc = effGetProcRowForShift(templatePayload, row.shift, stats.procKey);
  const ewh = effToNum(proc?.ewh);
  const templateUph = effToNum(proc?.uph);
  const resolvedUph = stats.recent14Uph ?? (templateUph > 0 ? templateUph : null);
  if (!resolvedUph || !ewh) {
    return {
      capacity: null,
      source: stats.recent14Uph !== null ? 'recent14' : 'template_fallback',
      procKey: stats.procKey,
      uph: resolvedUph,
      ewh: ewh || null
    };
  }
  return {
    capacity: resolvedUph * ewh,
    source: stats.recent14Uph !== null ? 'recent14' : 'template_fallback',
    procKey: stats.procKey,
    uph: resolvedUph,
    ewh
  };
};

const SCHEDULE_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');
const getTemplateDateByDayIndex = (dayIndex: number, weekOffset = 0) =>
  toDateOnly(addDays(SCHEDULE_TEMPLATE_WEEK_START, dayIndex + weekOffset * 7));
const getDayIndexFromTemplateDate = (dateOnly: string, weekOffset = 0) => {
  const dt = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  const weekStart = addDays(SCHEDULE_TEMPLATE_WEEK_START, weekOffset * 7);
  const diffDays = Math.round((dt.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0 || diffDays > 6) return null;
  return diffDays;
};
const getMonthDateRange = (value: Date) => {
  const start = new Date(value);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1, 0);
  end.setHours(0, 0, 0, 0);
  return {
    start,
    end,
    startKey: toDateOnly(start),
    endKey: toDateOnly(end)
  };
};
const formatYearMonthKey = (value: Date) => `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, '0')}`;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const parseDeviceCountedAtFromNote = (note: unknown) => {
  const text = String(note ?? '');
  const m = text.match(DEVICE_COUNTED_AT_NOTE_PATTERN);
  return m?.[1] ? String(m[1]).trim() : '';
};
const isDateOnlyValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
const SCHEDULE_PICKER_WIDTH = 176;
const SCHEDULE_PICKER_HEIGHT_ESTIMATE = 180;
const SCHEDULE_PICKER_MARGIN = 8;
const SCHEDULE_PICKER_GAP = 6;
const isAbortLikeError = (error: unknown) => {
  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  const name = String((error as any)?.name ?? '');
  return (
    name === 'AbortError' ||
    message.includes('aborterror') ||
    message.includes('signal is aborted') ||
    message.includes('aborted without reason')
  );
};
const normalizeAttendanceFetchError = (error: unknown) => {
  const rawMessage = String((error as any)?.message ?? error ?? '').trim();
  const message = rawMessage.toLowerCase();
  if (
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    (message.includes('typeerror') && message.includes('fetch'))
  ) {
    return '无法连接考勤服务，请检查网络或稍后重试。';
  }
  return rawMessage || '考勤服务请求失败。';
};

const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW) ? clamp(DAY_CUTOFF_HOUR_RAW, 0, 23) : 5;
const DAY_CUTOFF_MS = DAY_CUTOFF_HOUR * 60 * 60 * 1000;
const TIMECARD_ABSENT_VISIBLE_HOUR_RAW = Number(import.meta.env.VITE_TIMECARD_ABSENT_VISIBLE_HOUR ?? 12);
const TIMECARD_ABSENT_VISIBLE_HOUR = Number.isFinite(TIMECARD_ABSENT_VISIBLE_HOUR_RAW)
  ? clamp(TIMECARD_ABSENT_VISIBLE_HOUR_RAW, 0, 23)
  : 12;
const ATTENDANCE_RESET_HOUR_RAW = Number(import.meta.env.VITE_ATTENDANCE_RESET_HOUR ?? 5);
const ATTENDANCE_RESET_HOUR = Number.isFinite(ATTENDANCE_RESET_HOUR_RAW)
  ? clamp(ATTENDANCE_RESET_HOUR_RAW, 0, 23)
  : 5;
const SHIFT_ANALYSIS_DAYS_RAW = Number(import.meta.env.VITE_SHIFT_ANALYSIS_DAYS ?? 30);
const SHIFT_ANALYSIS_DAYS = Number.isFinite(SHIFT_ANALYSIS_DAYS_RAW) ? clamp(SHIFT_ANALYSIS_DAYS_RAW, 1, 90) : 30;

const getDayRange = (weekStart: Date, dayIndex: number, dayCount = 1) => {
  const startBase = addDays(weekStart, dayIndex);
  const endBase = addDays(weekStart, dayIndex + dayCount);
  return {
    start: new Date(startBase.getTime() + DAY_CUTOFF_MS),
    end: new Date(endBase.getTime() + DAY_CUTOFF_MS)
  };
};
// Day bucketing uses [start, end). Shift OUT by 1ms so exact-cutoff OUT belongs to previous operational day.
const getOperationalBucketTimeMs = (at: Date, action: 'IN' | 'OUT') => at.getTime() - (action === 'OUT' ? 1 : 0);
const getWorkDateRange = (workDate: string) => {
  const base = new Date(`${workDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const start = new Date(base);
  start.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
  const end = addDays(start, 1);
  return { start, end };
};
const isExactOperationalCutoffOut = (atRaw: string, actionRaw?: string) => {
  const at = new Date(atRaw);
  if (Number.isNaN(at.getTime())) return false;
  const action = String(actionRaw ?? '').trim().toUpperCase();
  return action === 'OUT' && at.getHours() === DAY_CUTOFF_HOUR && at.getMinutes() === 0 && at.getSeconds() === 0;
};
const toOperationalWorkDate = (atRaw: string, actionRaw?: string) => {
  const at = new Date(atRaw);
  if (Number.isNaN(at.getTime())) return '';
  const action = String(actionRaw ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
  const bucketMs = getOperationalBucketTimeMs(at, action);
  const shifted = new Date(bucketMs - DAY_CUTOFF_MS);
  return toDateOnly(shifted);
};
const extractPunchAuditWorkDates = (row: Pick<AuditRow, 'action' | 'created_at' | 'payload'>) => {
  const action = String(row.action ?? '').trim();
  const payload = ((row.payload ?? {}) as Record<string, any>) ?? {};
  const dates = new Set<string>();
  const explicitWorkDate = String(payload.work_date ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicitWorkDate)) dates.add(explicitWorkDate);
  if (action === 'punch_manual_add') {
    const key = toOperationalWorkDate(String(payload.created_at ?? ''), String(payload.action ?? ''));
    if (key) dates.add(key);
  } else if (action === 'punch_manual_edit') {
    const before = (payload.before ?? null) as Record<string, any> | null;
    const after = (payload.after ?? null) as Record<string, any> | null;
    const beforeKey = before ? toOperationalWorkDate(String(before.created_at ?? ''), String(before.action ?? '')) : '';
    const afterKey = after ? toOperationalWorkDate(String(after.created_at ?? ''), String(after.action ?? '')) : '';
    if (beforeKey) dates.add(beforeKey);
    if (afterKey) dates.add(afterKey);
  } else if (action === 'punch_manual_delete') {
    const before = (payload.before ?? null) as Record<string, any> | null;
    const beforeKey = before ? toOperationalWorkDate(String(before.created_at ?? ''), String(before.action ?? '')) : '';
    if (beforeKey) dates.add(beforeKey);
  }
  if (dates.size === 0) {
    const fallback = toOperationalWorkDate(String(row.created_at ?? ''));
    if (fallback) dates.add(fallback);
  }
  return Array.from(dates);
};
const normalizeAllowedPosition = (value: string): AllowedPosition | '' => {
  const normalized = String(value ?? '').trim().toLowerCase();
  const hit = ALLOWED_POSITIONS.find((p) => p.toLowerCase() === normalized);
  if (hit) return hit;
  if (normalized === 'water spider' || normalized === 'waterspider' || normalized === 'water-spider') {
    return 'Water Spider';
  }
  if (
    normalized === '兜底组' ||
    normalized === '兜底' ||
    normalized === 'flex team（机动组）' ||
    normalized === 'flex team' ||
    normalized === 'flexteam' ||
    normalized === 'wrap-up team' ||
    normalized === 'wrap up team' ||
    normalized === 'wrapup team' ||
    normalized === 'fallback' ||
    normalized === 'backup'
  ) {
    return 'FLEX TEAM';
  }
  return '';
};
const isNewHirePlaceholderStaffId = (value: string) => {
  const staff = String(value ?? '').trim().toUpperCase();
  if (!staff) return false;
  if (/^NEWREQ-\d{8}(?:-[A-Z]+)?-\d{3,}$/i.test(staff)) return true; // legacy format
  return /^\d{4}[A-Z]+\d{3,}$/i.test(staff); // MMDD + POSITION + SEQ
};
const isNewHirePlaceholderName = (value: string) => /^\d{2}\/\d{2}NEW\s+[A-Z]+(\d+)$/i.test(String(value ?? '').trim());
const isNewHireFirstWorkDate = (staffId: string, workDate: Date | string) => {
  const staff = String(staffId ?? '').trim().toUpperCase();
  if (!staff) return false;
  const dateText = typeof workDate === 'string' ? workDate : toDateOnly(workDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return false;

  const compactDate = dateText.replace(/-/g, '');
  const legacyMatch = staff.match(/^NEWREQ-(\d{8})(?:-[A-Z]+)?-\d{3,}$/i);
  if (legacyMatch?.[1]) {
    return legacyMatch[1] === compactDate;
  }

  const match = staff.match(/^(\d{2})(\d{2})[A-Z]+\d{3,}$/);
  if (!match) return false;
  const month = match[1];
  const day = match[2];
  return dateText.slice(5, 7) === month && dateText.slice(8, 10) === day;
};
const displayStaffId = (value: string) => String(value ?? '').trim();
const normalizeDeviceSn = (value: string) => String(value ?? '').trim().toUpperCase();
const normalizeDeviceType = (value: string): DeviceType => {
  const raw = String(value ?? '').trim();
  if (!raw) return 'PDA'; // 空值默认为 PDA
  
  // 别名兼容性：保留对旧数据的支持
  const upper = raw.toUpperCase();
  if (upper === 'CAR' || raw === '车') return 'CART';
  
  // 返回规范化后的值（去除前后空白，保留原始大小写）
  return raw;
};

const getDefaultPositionToneKey = (value: string): LabelToneKey => {
  const pos = normalizeAllowedPosition(value);
  if (pos === 'Pick') return 'sky';
  if (pos === 'Pack') return 'emerald';
  if (pos === 'Rebin') return 'amber';
  if (pos === 'Preship') return 'rose';
  if (pos === 'Transfer') return 'violet';
  if (pos === 'FLEX TEAM') return 'slate';
  return 'slate';
};

const POSITION_TONE_CLASS_DARK: Record<LabelToneKey, string> = {
  sky: 'badge-elevated-dark border-sky-300/30 text-sky-100 bg-sky-400/[0.13]',
  emerald: 'badge-elevated-dark border-emerald-300/30 text-emerald-100 bg-emerald-400/[0.13]',
  amber: 'badge-elevated-dark border-amber-300/30 text-amber-100 bg-amber-400/[0.13]',
  violet: 'badge-elevated-dark border-violet-300/30 text-violet-100 bg-violet-400/[0.13]',
  rose: 'badge-elevated-dark border-rose-300/30 text-rose-100 bg-rose-400/[0.13]',
  slate: 'badge-elevated-dark border-white/12 text-slate-200 bg-white/[0.05]'
};

const POSITION_TONE_CLASS_LIGHT: Record<LabelToneKey, string> = {
  sky: 'badge-elevated-light border-sky-300 bg-sky-50 text-sky-700',
  emerald: 'badge-elevated-light border-emerald-300 bg-emerald-50 text-emerald-700',
  amber: 'badge-elevated-light border-amber-300 bg-amber-50 text-amber-700',
  violet: 'badge-elevated-light border-violet-300 bg-violet-50 text-violet-700',
  rose: 'badge-elevated-light border-rose-300 bg-rose-50 text-rose-700',
  slate: 'badge-elevated-light border-slate-300 bg-slate-100 text-slate-700'
};

const getPositionBadgeClass = (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) => {
  const pos = normalizeAllowedPosition(value);
  const tone = (pos ? toneMap?.[pos] : undefined) ?? getDefaultPositionToneKey(value);
  return POSITION_TONE_CLASS_DARK[tone] ?? POSITION_TONE_CLASS_DARK.slate;
};
const getPositionBadgeClassLight = (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) => {
  const pos = normalizeAllowedPosition(value);
  const tone = (pos ? toneMap?.[pos] : undefined) ?? getDefaultPositionToneKey(value);
  return POSITION_TONE_CLASS_LIGHT[tone] ?? POSITION_TONE_CLASS_LIGHT.slate;
};
const HOME_CARD_TONE_CLASS: Record<LabelToneKey, string> = {
  sky: 'border-sky-400/35 bg-sky-500/[0.05]',
  emerald: 'border-emerald-400/35 bg-emerald-500/[0.05]',
  amber: 'border-amber-400/35 bg-amber-500/[0.05]',
  violet: 'border-violet-400/35 bg-violet-500/[0.05]',
  rose: 'border-rose-400/35 bg-rose-500/[0.05]',
  slate: 'border-white/15 bg-white/5'
};
const HOME_CHIP_TONE_CLASS: Record<LabelToneKey, string> = {
  sky: 'border border-sky-400/40 bg-sky-500/15 text-sky-100',
  emerald: 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-100',
  amber: 'border border-amber-400/40 bg-amber-500/15 text-amber-100',
  violet: 'border border-violet-400/40 bg-violet-500/15 text-violet-100',
  rose: 'border border-rose-400/40 bg-rose-500/15 text-rose-100',
  slate: 'bg-white/10 text-slate-300'
};
const HOME_PANEL_TONE_CLASS: Record<LabelToneKey, string> = {
  sky: 'border border-sky-400/20 bg-sky-950/35',
  emerald: 'border border-emerald-400/20 bg-emerald-950/35',
  amber: 'border border-amber-400/20 bg-amber-950/35',
  violet: 'border border-violet-400/20 bg-violet-950/35',
  rose: 'border border-rose-400/20 bg-rose-950/35',
  slate: 'bg-black/30'
};
const getHomeToneKey = (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) => {
  const pos = normalizeAllowedPosition(value);
  return (pos ? toneMap?.[pos] : undefined) ?? getDefaultPositionToneKey(value);
};
const getHomeCardToneClass = (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) =>
  HOME_CARD_TONE_CLASS[getHomeToneKey(value, toneMap)] ?? HOME_CARD_TONE_CLASS.slate;
const getHomeChipToneClass = (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) =>
  HOME_CHIP_TONE_CLASS[getHomeToneKey(value, toneMap)] ?? HOME_CHIP_TONE_CLASS.slate;
const getHomePanelToneClass = (value: string, toneMap?: Partial<Record<AllowedPosition, LabelToneKey>>) =>
  HOME_PANEL_TONE_CLASS[getHomeToneKey(value, toneMap)] ?? HOME_PANEL_TONE_CLASS.slate;

const ORDINAL_CN = ['第一次', '第二次', '第三次', '第四次', '第五次', '第六次', '第七次', '第八次', '第九次', '第十次'];

const toLocalDateTimeInputValue = (value: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
};

const parseLocalDateTimeInputValue = (value: string) => {
  // "YYYY-MM-DDTHH:mm" is treated as local time by Date constructor
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          cell += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      pushCell();
      continue;
    }

    if (ch === '\n') {
      pushCell();
      pushRow();
      continue;
    }

    if (ch === '\r') {
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    pushCell();
    pushRow();
  }

  const headerRow = rows[0] ?? [];
  const headers = headerRow.map((h) => h.trim()).filter(Boolean);
  const dataRows = rows
    .slice(1)
    .filter((r) => r.some((value) => value.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < headers.length; i += 1) {
        const key = headers[i]!;
        obj[key] = (r[i] ?? '').trim();
      }
      return obj;
    });

  return { headers, rows: dataRows };
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const normalizeHeaderKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');

const getVisibleAdminPages = (accessContext: AdminAccessContext | null | undefined): AdminPage[] => {
  const moduleMap = getModuleMapFromContext(accessContext);
  const pages: AdminPage[] = [];

  if (hasModuleAccess(moduleMap, 'home', 'view')) pages.push('home');
  if (hasModuleAccess(moduleMap, 'package_metrics', 'view')) pages.push('package_metrics');
  if (hasModuleAccess(moduleMap, 'employees', 'view')) pages.push('employees');
  if (hasModuleAccess(moduleMap, 'accounts', 'view')) pages.push('accounts');
  if (hasModuleAccess(moduleMap, 'permissions', 'view')) pages.push('permissions');
  if (hasModuleAccess(moduleMap, 'timecard', 'view')) pages.push('timecard');
  if (hasModuleAccess(moduleMap, 'leave_approval', 'view')) pages.push('leave_approval');
  if (hasModuleAccess(moduleMap, 'work_hour_comparison', 'view')) pages.push('work_hour_comparison');
  if (hasModuleAccess(moduleMap, 'todo', 'view')) pages.push('todo');
  if (hasModuleAccess(moduleMap, 'punches', 'view')) pages.push('punches');
  if (hasModuleAccess(moduleMap, 'audit', 'view')) pages.push('audit');
  if (hasModuleAccess(moduleMap, 'schedule', 'view')) pages.push('schedule');
  if (hasModuleAccess(moduleMap, 'devices', 'view')) pages.push('devices');
  if (hasModuleAccess(moduleMap, 'forecast', 'view')) pages.push('forecast');
  if (hasModuleAccess(moduleMap, 'prediction_model', 'view')) pages.push('prediction_model');
  if (hasModuleAccess(moduleMap, 'efficiency', 'view')) pages.push('efficiency');

  return pages.length > 0 ? pages : ['home'];
};

const EMPLOYEE_KEY_ALIASES: Record<string, string> = {
  employee_id: 'staff_id',
  employeeid: 'staff_id',
  uid: 'staff_id',
  staffid: 'staff_id',
  staff_id: 'staff_id',
  '工号': 'staff_id',
  '员工号': 'staff_id',
  name: 'name',
  agency: 'agency',
  'agency ': 'agency',
  position: 'position',
  '岗位': 'position',
  '职位': 'position',
  employment_type: 'employment_type',
  employmenttype: 'employment_type',
  ft_pt: 'employment_type',
  ftpt: 'employment_type',
  full_part_time: 'employment_type',
  fullparttime: 'employment_type',
  'ft/pt': 'employment_type',
  '全职兼职': 'employment_type',
  '用工类型': 'employment_type',
  label: 'label',
  '标签': 'label',
  work_account: 'work_account',
  workaccount: 'work_account',
  '工作账号': 'work_account',
  '账号': 'work_account',
  work_password: 'work_password',
  workpassword: 'work_password',
  '工作密码': 'work_password',
  '密码': 'work_password',
  shift_time: 'shift_time',
  shifttime: 'shift_time',
  start_time: 'shift_time',
  starttime: 'shift_time',
  '班次时间': 'shift_time',
  '上班时间': 'shift_time',
  '开始时间': 'shift_time'
};

const DEVICE_KEY_ALIASES: Record<string, string> = {
  device_name: 'device_name',
  devicename: 'device_name',
  name: 'device_name',
  device: 'device_name',
  '设备名': 'device_name',
  '设备名称': 'device_name',
  device_sn: 'device_sn',
  devicesn: 'device_sn',
  sn: 'device_sn',
  '序列号': 'device_sn',
  'sn码': 'device_sn',
  type: 'device_type',
  device_type: 'device_type',
  '类型': 'device_type',
  position: 'position',
  '岗位': 'position',
  note: 'note',
  remark: 'note',
  '备注': 'note',
  active: 'active',
  enabled: 'active',
  status: 'active',
  '启用': 'active',
  '状态': 'active'
};

const TEMP_ACCOUNT_KEY_ALIASES: Record<string, string> = {
  staff_id: 'staff_id',
  staffid: 'staff_id',
  employee_id: 'staff_id',
  employeeid: 'staff_id',
  usid: 'staff_id',
  uid: 'staff_id',
  '工号': 'staff_id',
  '员工号': 'staff_id',
  name: 'name',
  agency: 'agency',
  position: 'position',
  work_account: 'work_account',
  workaccount: 'work_account',
  account: 'work_account',
  '工作账号': 'work_account',
  '账号': 'work_account',
  work_password: 'work_password',
  workpassword: 'work_password',
  password: 'work_password',
  '工作密码': 'work_password',
  '密码': 'work_password',
  note: 'note',
  remark: 'note',
  '备注': 'note'
};

export default function AdminAppPage() {
  // --- Session restoration logic for Admin auto-login ---
  const [user, setUser] = useState<SupabaseUser | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isLocked = Boolean(busy);
  const [busyVisible, setBusyVisible] = useState(false);
  const timecardFetchSeqRef = useRef(0);
  const punchesFetchSeqRef = useRef(0);
  const attendanceFetchSeqRef = useRef(0);
  const timecardPunchFetchSeqRef = useRef(0);
  const timecardRecomputeLastRunByWeekRef = useRef<Record<string, number>>({});
  const timecardWeekCacheRef = useRef<{
    weekKey: string;
    allEmployees: Array<{
      staff_id: string;
      name: string;
      agency: string;
      position: string;
      shift: '' | 'early' | 'late';
      terminatedAt: string | null;
    }>;
    eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT'; manual: boolean }>>;
    scheduledByStaff: Record<string, boolean[]>;
    scheduleStateByStaff: Record<string, ScheduleBaseState[]>;
    scheduleKnownByStaff: Record<string, boolean[]>;
    marksByStaff: Record<
      string,
      {
        absentByDay: boolean[];
        leaveByDay: boolean[];
        tempRestByDay: boolean[];
        lateByDay: boolean[];
        lateMinutesByDay: number[];
        lateSourceByDay: string[];
        lateRoundingFamilyByDay: string[];
        lateLearnedExpectedStartRawByDay: string[];
        lateLearnedExpectedStartRoundedByDay: string[];
        lateGuardrailExpectedStartByDay: string[];
        lateFinalExpectedStartByDay: string[];
        lateFirstInByDay: string[];
        lateSampleCountByDay: number[];
      }
    >;
    lateByStaffDayKey: Record<string, LateMarkView>;
    lateMarksSynced: boolean;
  } | null>(null);
  const scheduleLabelToneReadyRef = useRef(false);
  const scheduleLabelToneHydratingRef = useRef(false);
  const scheduleLabelToneLastSavedJsonRef = useRef('');
  const schedulePositionToneHydratingRef = useRef(false);
  const schedulePositionToneLastSavedJsonRef = useRef('');
  const schedulePositionToneReadyRef = useRef(false);
  const scheduleRenderFilterKeyRef = useRef('');
  const scheduleTableScrollRef = useRef<HTMLDivElement | null>(null);
  type EmployeeColumnMode = 'lower' | 'cased';
  const employeeColumnModeRef = useRef<EmployeeColumnMode | null>(null);
  const scheduleUphRequestRef = useRef(0);
  const dailyCapacityRequestRef = useRef(0);
  const scheduleMistakeRequestRef = useRef(0);
  const scheduleLateRequestRef = useRef(0);
  const scheduleMonthlyAbsentRequestRef = useRef(0);
  const schedulePunchPresenceRequestRef = useRef(0);
  const fetchScheduleRef = useRef<((options?: { weekOffsetOverride?: number; lockUi?: boolean }) => Promise<any>) | null>(null);
  const scheduleRealtimeDebounceTimerRef = useRef<number | null>(null);

  const [page, setPage] = useState<AdminPage>('home');
  const [adminAccessContext, setAdminAccessContext] = useState<AdminAccessContext | null>(null);
  const [adminAccessRequests, setAdminAccessRequests] = useState<AdminAccessRequestRecord[]>([]);
  const [terminationRequests, setTerminationRequests] = useState<TerminationRequestRecord[]>([]);
  const [adminAccessAccounts, setAdminAccessAccounts] = useState<AdminAccessAccountRecord[]>([]);
  const [adminAccessUserOptions, setAdminAccessUserOptions] = useState<AdminAccessUserOption[]>([]);
  const [leaveApprovalPendingCount, setLeaveApprovalPendingCount] = useState(0);
  const visibleAdminPages = useMemo(() => getVisibleAdminPages(adminAccessContext), [adminAccessContext]);
  const adminModuleMap = useMemo(() => getModuleMapFromContext(adminAccessContext), [adminAccessContext]);
  const canOperateFlags = useMemo(
    () => ({
      employees: hasModuleAccess(adminModuleMap, 'employees', 'operate'),
      accounts: hasModuleAccess(adminModuleMap, 'accounts', 'operate'),
      schedule: hasModuleAccess(adminModuleMap, 'schedule', 'operate'),
      timecard: hasModuleAccess(adminModuleMap, 'timecard', 'operate'),
      devices: hasModuleAccess(adminModuleMap, 'devices', 'operate'),
      forecast: hasModuleAccess(adminModuleMap, 'forecast', 'operate'),
      packageMetrics: hasModuleAccess(adminModuleMap, 'package_metrics', 'operate'),
      consumables: hasModuleAccess(adminModuleMap, 'consumables', 'operate'),
      predictionModel: hasModuleAccess(adminModuleMap, 'prediction_model', 'operate'),
      efficiency: hasModuleAccess(adminModuleMap, 'efficiency', 'operate'),
      leaveApproval: hasModuleAccess(adminModuleMap, 'leave_approval', 'operate'),
      todo: hasModuleAccess(adminModuleMap, 'todo', 'operate'),
      audit: hasModuleAccess(adminModuleMap, 'audit', 'operate')
    }),
    [adminModuleMap]
  );
  const {
    employees: employeesCanOperate,
    accounts: accountsCanOperate,
    schedule: scheduleCanOperate,
    timecard: timecardCanOperate,
    devices: devicesCanOperate,
    forecast: forecastCanOperate,
    packageMetrics: packageMetricsCanOperate,
    consumables: consumablesCanOperate,
    predictionModel: predictionModelCanOperate,
    efficiency: efficiencyCanOperate,
    leaveApproval: leaveApprovalCanOperate,
    todo: todoCanOperate,
    audit: auditCanOperate
  } = canOperateFlags;
  const employeesReadOnly = isLocked || !employeesCanOperate;
  const scheduleReadOnly = isLocked || !scheduleCanOperate;
  const timecardReadOnly = isLocked || !timecardCanOperate;
  const forecastReadOnly = isLocked || !forecastCanOperate;
  const predictionModelReadOnly = isLocked || !predictionModelCanOperate;
  const efficiencyReadOnly = isLocked || !efficiencyCanOperate;
  const scheduleCanReviewTermination = useMemo(
    () => canReviewTerminationRequests(adminAccessContext),
    [adminAccessContext]
  );
  const accountsCanManageAdminAccess = useMemo(
    () => canManageAdminAccess(adminAccessContext),
    [adminAccessContext]
  );
  const pendingTerminationRequestsByStaffId = useMemo(() => {
    const map = new Map<string, TerminationRequestRecord>();
    for (const request of terminationRequests) {
      if (request.status !== 'pending') continue;
      const staff = normalizeStaffId(String(request.staff_id ?? '').trim());
      if (!staff || map.has(staff)) continue;
      map.set(staff, request);
    }
    return map;
  }, [terminationRequests]);
  const scheduleTerminationPendingCount = useMemo(
    () => terminationRequests.filter((request) => request.status === 'pending').length,
    [terminationRequests]
  );

  useEffect(() => {
    let cancelled = false;
    const loadLeaveApprovalPendingCount = async () => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('ob_leave_requests')
        .select('status, leave_date')
        .eq('status', 'pending')
        .limit(2000);
      if (cancelled || error) return;
      const now = new Date();
      const operationalStart = new Date(now);
      operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
      if (now.getTime() < operationalStart.getTime()) operationalStart.setDate(operationalStart.getDate() - 1);
      const editableStart = toDateOnly(startOfWeekMonday(operationalStart));
      const nextPending = (((data ?? []) as any[]) ?? []).filter((item) => String(item?.leave_date ?? '').trim() >= editableStart).length;
      setLeaveApprovalPendingCount(nextPending);
    };
    void loadLeaveApprovalPendingCount();
    return () => {
      cancelled = true;
    };
  }, []);

  type Lang = 'zh' | 'en';
  type ThemeMode = 'dark' | 'light';
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const v = localStorage.getItem('obpunch_lang');
      return v === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const value = localStorage.getItem('obpunch_admin_theme');
      return value === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('obpunch_lang', lang);
    } catch {
      // ignore
    }
  }, [lang]);
  useEffect(() => {
    try {
      localStorage.setItem('obpunch_admin_theme', themeMode);
    } catch {
      // ignore
    }
    document.body.dataset.theme = themeMode;
    return () => {
      delete document.body.dataset.theme;
    };
  }, [themeMode]);
  const locale = lang === 'en' ? 'en-US' : 'zh-CN';
  const t = (zh: string, en: string) => (lang === 'en' ? en : zh);
  const getScheduleStateButtonClass = (state: ScheduleDisplayState) => {
    const base =
      'h-7 min-w-[42px] rounded-[10px] border px-1.5 text-[9px] font-semibold leading-tight tracking-[0.01em] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-55';
    if (themeMode === 'light') {
      switch (state) {
        case 'work':
          return `${base} border-lime-300 bg-lime-50 text-lime-800 shadow-none`;
        case 'new':
          return `${base} border-cyan-300 bg-cyan-50 text-cyan-800 shadow-none`;
        case 'fixed_work':
          return `${base} border-amber-300 bg-amber-50 text-amber-800 shadow-none`;
        case 'temp_work':
          return `${base} border-emerald-300 bg-emerald-50 text-emerald-800 shadow-none`;
        case 'planned_temp_work':
          return `${base} border-sky-300 bg-sky-50 text-sky-800 shadow-none`;
        case 'leave':
          return `${base} border-violet-300 bg-violet-50 text-violet-800 shadow-none`;
        case 'planned_leave':
          return `${base} border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800 shadow-none`;
        case 'rest_worked':
          return `${base} border-cyan-300 bg-cyan-50 text-cyan-800 shadow-none`;
        case 'absent':
          return `${base} border-slate-300 bg-slate-100 text-slate-700 shadow-none`;
        case 'temp_rest':
          return `${base} border-rose-300 bg-rose-50 text-rose-800 shadow-none`;
        case 'planned_temp_rest':
          return `${base} border-orange-300 bg-orange-50 text-orange-800 shadow-none`;
        default:
          return `${base} border-slate-200 bg-white text-slate-500 shadow-none`;
      }
    }
    switch (state) {
      case 'work':
        return `${base} border-lime-400/35 bg-lime-500/14 text-lime-100 shadow-[inset_0_1px_0_rgba(190,242,100,0.12),0_8px_18px_rgba(101,163,13,0.16)]`;
      case 'new':
        return `${base} border-cyan-400/35 bg-cyan-500/14 text-cyan-100 shadow-[inset_0_1px_0_rgba(103,232,249,0.12),0_8px_18px_rgba(8,145,178,0.16)]`;
      case 'fixed_work':
        return `${base} border-amber-400/35 bg-amber-500/14 text-amber-100 shadow-[inset_0_1px_0_rgba(253,224,71,0.12),0_8px_18px_rgba(180,83,9,0.16)]`;
      case 'temp_work':
        return `${base} border-emerald-400/35 bg-emerald-500/14 text-emerald-100 shadow-[inset_0_1px_0_rgba(110,231,183,0.12),0_8px_18px_rgba(5,150,105,0.16)]`;
      case 'planned_temp_work':
        return `${base} border-sky-400/35 bg-sky-500/14 text-sky-100 shadow-[inset_0_1px_0_rgba(125,211,252,0.12),0_8px_18px_rgba(2,132,199,0.16)]`;
      case 'leave':
        return `${base} border-violet-400/35 bg-violet-500/14 text-violet-100 shadow-[inset_0_1px_0_rgba(196,181,253,0.12),0_8px_18px_rgba(124,58,237,0.16)]`;
      case 'planned_leave':
        return `${base} border-fuchsia-400/35 bg-fuchsia-500/14 text-fuchsia-100 shadow-[inset_0_1px_0_rgba(240,171,252,0.12),0_8px_18px_rgba(192,38,211,0.16)]`;
      case 'rest_worked':
        return `${base} border-cyan-400/35 bg-cyan-500/14 text-cyan-100 shadow-[inset_0_1px_0_rgba(103,232,249,0.12),0_8px_18px_rgba(14,116,144,0.16)]`;
      case 'absent':
        return `${base} border-slate-400/45 bg-slate-200 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_18px_rgba(15,23,42,0.12)]`;
      case 'temp_rest':
        return `${base} border-rose-400/35 bg-rose-500/14 text-rose-100 shadow-[inset_0_1px_0_rgba(253,164,175,0.12),0_8px_18px_rgba(190,24,93,0.16)]`;
      case 'planned_temp_rest':
        return `${base} border-orange-400/35 bg-orange-500/14 text-orange-100 shadow-[inset_0_1px_0_rgba(253,186,116,0.12),0_8px_18px_rgba(194,65,12,0.16)]`;
      default:
        return `${base} border-white/10 bg-white/[0.04] text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_18px_rgba(15,23,42,0.12)]`;
    }
  };
  const scheduleLateDotClass =
    themeMode === 'light'
      ? 'bg-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.22)]'
      : 'bg-amber-300 shadow-[0_0_0_1px_rgba(252,211,77,0.24)]';
  const getScheduleAuditDotClass = (state: ScheduleDisplayState) => {
    if (themeMode === 'light') {
      return state === 'rest' || state === 'temp_rest' || state === 'planned_temp_rest'
        ? 'bg-slate-500 shadow-[0_0_0_1px_rgba(100,116,139,0.18)]'
        : 'bg-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.20)]';
    }
    return state === 'rest' || state === 'temp_rest' || state === 'planned_temp_rest'
      ? 'bg-slate-300 shadow-[0_0_0_1px_rgba(226,232,240,0.12)]'
      : 'bg-rose-400 shadow-[0_0_0_1px_rgba(251,113,133,0.22)]';
  };
  const schedulePickerMetaClass =
    themeMode === 'light'
      ? 'border border-slate-200 bg-slate-100 text-slate-600'
      : 'border border-white/10 bg-white/[0.06] text-slate-300';
  const scheduleBadgeBaseClass =
    themeMode === 'light'
      ? 'badge-elevated-light inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold'
      : 'badge-elevated-dark inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold';
  const getScheduleWorkDaysBadgeClass = (value: number) => {
    const tone =
      value > 5
        ? themeMode === 'light'
          ? 'border-rose-300 bg-rose-50 text-rose-700'
          : 'border-rose-400/35 bg-rose-500/14 text-rose-100'
        : value >= 5
          ? themeMode === 'light'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : 'border-emerald-400/35 bg-emerald-500/14 text-emerald-100'
          : value >= 1
            ? themeMode === 'light'
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-amber-400/35 bg-amber-500/14 text-amber-100'
            : themeMode === 'light'
              ? 'border-slate-300 bg-slate-100 text-slate-600'
              : 'border-slate-400/35 bg-slate-500/12 text-slate-200';
    return `${scheduleBadgeBaseClass} min-w-[32px] justify-center px-2.5 py-[5px] tabular-nums ${tone}`;
  };
  const getScheduleTablePositionBadgeClass = (position: string) => {
    const toneClass =
      themeMode === 'light'
        ? getSchedulePositionBadgeClassLight(position)
        : getSchedulePositionBadgeClass(position);
    return `${scheduleBadgeBaseClass} px-2.5 py-[5px] uppercase tracking-[0.12em] ${toneClass}`;
  };
  const getScheduleTableLabelBadgeClass = (label: string) => {
    const toneClass =
      themeMode === 'light'
        ? POSITION_TONE_CLASS_LIGHT[getScheduleLabelTone(label)] ?? POSITION_TONE_CLASS_LIGHT.slate
        : getScheduleLabelToneClass(label);
    return `${scheduleBadgeBaseClass} max-w-full px-2.5 py-[5px] ${toneClass}`;
  };
  const getScheduleTableShiftBadgeClass = (value: '' | 'early' | 'late') => {
    let toneClass = '';
    if (value === 'early') {
      toneClass =
        themeMode === 'light'
          ? 'border-amber-300 bg-amber-50 text-amber-700'
          : 'border-amber-400/35 bg-amber-500/14 text-amber-100';
    } else if (value === 'late') {
      toneClass =
        themeMode === 'light'
          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
          : 'border-indigo-400/35 bg-indigo-500/14 text-indigo-100';
    } else {
      toneClass =
        themeMode === 'light'
          ? 'border-slate-300 bg-slate-100 text-slate-600'
          : 'border-slate-400/35 bg-slate-500/12 text-slate-200';
    }
    return `${scheduleBadgeBaseClass} min-w-[52px] justify-center px-2.5 py-[5px] tracking-[0.04em] ${toneClass}`;
  };

  const [, setStatus] = useState<Status>({ tone: 'idle', message: '请登录后台' });
  const [loginErrorDialog, setLoginErrorDialog] = useState<{ open: boolean; title: string; message: string }>({
    open: false,
    title: '',
    message: ''
  });
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; message: string }>({
    open: false,
    title: '',
    message: ''
  });
  const openLoginErrorDialog = (message: string) => {
    setLoginErrorDialog({ open: true, title: t('登录失败', 'Login Failed'), message });
  };
  const closeLoginErrorDialog = () => {
    setLoginErrorDialog((prev) => ({ ...prev, open: false }));
  };
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const suppressNextSignedOutStatusRef = useRef(false);
  const askConfirm = (message: string, title?: string) =>
    new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({ open: true, title: title || t('确认操作', 'Confirm'), message });
    });
  const closeConfirmDialog = (ok: boolean) => {
    setConfirmDialog((prev) => ({ ...prev, open: false }));
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    resolver?.(ok);
  };

  const [offsetMs, setOffsetMs] = useState(0);
  const [serverTime, setServerTime] = useState(() => new Date());


  const [userDisplayName, setUserDisplayName] = useState('');
  const [userDisplayNameInput, setUserDisplayNameInput] = useState('');
  const [userAvatarUrl, setUserAvatarUrl] = useState('');
  const [userAvatarUrlInput, setUserAvatarUrlInput] = useState('');
  const [userAvatarFileInput, setUserAvatarFileInput] = useState<File | null>(null);
  const [userDisplayNamePromptOpen, setUserDisplayNamePromptOpen] = useState(false);
  const [userDisplayNameSaving, setUserDisplayNameSaving] = useState(false);
  const isMissingAvatarUrlColumnError = (message: string) => /avatar_url/i.test(message) && /column/i.test(message);
  const isMissingStorageBucketError = (message: string) =>
    /bucket/i.test(message) && /(not found|does not exist|missing|invalid)/i.test(message);
  const getFallbackProfileName = () => {
    const candidates = [
      userDisplayName,
      String(user?.user_metadata?.display_name ?? '').trim(),
      String(user?.user_metadata?.name ?? '').trim()
    ];
    for (const candidate of candidates) {
      const next = String(candidate ?? '').trim();
      if (next) return next;
    }
    return '';
  };
  type AdminProfileCacheEntry = { userId: string; userEmail: string; displayName: string; avatarUrl: string };
  const adminProfileByUserIdRef = useRef<Map<string, AdminProfileCacheEntry>>(new Map());
  const adminProfileByEmailRef = useRef<Map<string, AdminProfileCacheEntry>>(new Map());
  const adminProfileByDisplayNameRef = useRef<Map<string, AdminProfileCacheEntry>>(new Map());
  const auditActorDisplayMapLoadedRef = useRef(false);
  const rememberAdminProfile = (row: { user_id?: unknown; user_email?: unknown; display_name?: unknown; avatar_url?: unknown }) => {
    const userId = String(row.user_id ?? '').trim();
    const userEmail = String(row.user_email ?? '').trim();
    const displayName = String(row.display_name ?? '').trim();
    const avatarUrl = String(row.avatar_url ?? '').trim();
    if (!userId && !userEmail && !displayName) return;
    const entry: AdminProfileCacheEntry = { userId, userEmail, displayName, avatarUrl };
    if (userId) adminProfileByUserIdRef.current.set(userId, entry);
    if (userEmail) adminProfileByEmailRef.current.set(userEmail.toLowerCase(), entry);
    if (displayName && !adminProfileByDisplayNameRef.current.has(displayName.toLowerCase())) {
      adminProfileByDisplayNameRef.current.set(displayName.toLowerCase(), entry);
    }
  };
  const loadAuditActorDisplayNameMap = async () => {
    if (!supabase || auditActorDisplayMapLoadedRef.current) return;
    const res = await supabase.from(USER_PROFILE_TABLE).select('user_id, user_email, display_name, avatar_url').limit(5000);
    if (res.error) {
      return;
    }
    for (const row of ((res.data as any[]) ?? [])) {
      rememberAdminProfile(row ?? {});
    }
    auditActorDisplayMapLoadedRef.current = true;
  };
  const rememberAuditActorDisplayNames = async (actors: Array<unknown>) => {
    if (!supabase) return;
    await loadAuditActorDisplayNameMap();
    const missingEmails: string[] = [];
    const seen = new Set<string>();
    for (const value of actors) {
      const raw = String(value ?? '').trim();
      if (!raw || !raw.includes('@')) continue;
      const key = raw.toLowerCase();
      if (seen.has(key) || adminProfileByEmailRef.current.has(key)) continue;
      seen.add(key);
      missingEmails.push(raw);
    }
    if (missingEmails.length === 0) return;

    const res = await supabase.from(USER_PROFILE_TABLE).select('user_id, user_email, display_name, avatar_url').in('user_email', missingEmails as any);
    if (res.error) {
      return;
    }
    for (const row of ((res.data as any[]) ?? [])) {
      rememberAdminProfile(row ?? {});
    }
  };
  const normalizeAuditActor = (value: unknown) => {
    const raw = String(value ?? '').trim();
    const resolved = adminProfileByEmailRef.current.get(raw.toLowerCase())?.displayName;
    const emailValue = String(user?.email ?? '').trim();
    const displayValue = userDisplayName.trim();
    if (!raw) return raw;
    if (raw.toLowerCase() === 'system') return t('系统', 'System');
    if (resolved) return resolved;
    if (displayValue && emailValue && raw.toLowerCase() === emailValue.toLowerCase()) {
      return displayValue;
    }
    return raw;
  };
  const getAuditActorDisplay = (row: AuditRow) => {
    if (String(row.action ?? '').trim() === 'schedule_auto_daily_activation') {
      return t('系统', 'System');
    }
    return normalizeAuditActor((row as any).actor);
  };
  const resolveAdminUserIdentity = ({
    userId,
    userEmail,
    actor,
    displayName
  }: {
    userId?: string | null;
    userEmail?: string | null;
    actor?: unknown;
    displayName?: string | null;
  }): AdminUserIdentityView => {
    const normalizedUserId = String(userId ?? '').trim();
    const normalizedUserEmail = String(userEmail ?? '').trim();
    const normalizedDisplayName = String(displayName ?? '').trim();
    const normalizedActor = String(actor ?? '').trim();
    const currentUserEmail = String(user?.email ?? '').trim();
    const currentProfile =
      (normalizedUserId ? adminProfileByUserIdRef.current.get(normalizedUserId) : undefined) ??
      (normalizedUserEmail ? adminProfileByEmailRef.current.get(normalizedUserEmail.toLowerCase()) : undefined) ??
      (normalizedActor.includes('@') ? adminProfileByEmailRef.current.get(normalizedActor.toLowerCase()) : undefined) ??
      (normalizedDisplayName ? adminProfileByDisplayNameRef.current.get(normalizedDisplayName.toLowerCase()) : undefined) ??
      (normalizedActor ? adminProfileByDisplayNameRef.current.get(normalizedActor.toLowerCase()) : undefined);

    if (currentProfile) {
      return buildAdminUserIdentityView({
        userId: normalizedUserId || currentProfile.userId,
        userEmail: normalizedUserEmail || currentProfile.userEmail,
        actor: normalizedActor,
        displayName: normalizedDisplayName || currentProfile.displayName,
        avatarUrl: currentProfile.avatarUrl
      });
    }

    if (currentUserEmail && normalizedActor && normalizedActor.toLowerCase() === currentUserEmail.toLowerCase()) {
      return buildAdminUserIdentityView({
        userId: String(user?.id ?? ''),
        userEmail: currentUserEmail,
        actor: normalizedActor,
        displayName: normalizedDisplayName || userDisplayName,
        avatarUrl: userAvatarUrlInput || userAvatarUrl
      });
    }

    return buildAdminUserIdentityView({
      userId: normalizedUserId,
      userEmail: normalizedUserEmail,
      actor: normalizedActor,
      displayName: normalizedDisplayName
    });
  };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [recentPunches, setRecentPunches] = useState<Record<string, unknown>[]>([]);
  const [recentPunchesError, setRecentPunchesError] = useState<string | null>(null);
  const [employeeByStaffId, setEmployeeByStaffId] = useState<Record<string, { name: string; agency: string }>>({});
  const [punchesSearch, setPunchesSearch] = useState('');
  const [todoPendingCount, setTodoPendingCount] = useState(0);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const homeEmployeesRef = useRef<EmployeeRow[]>([]);
  const [tempAccounts, setTempAccounts] = useState<
    Array<{
      staff_id: string;
      name: string;
      agency: string;
      position: string;
      work_account: string;
      work_password: string;
      note: string;
    }>
  >([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [employeeShiftByStaffId, setEmployeeShiftByStaffId] = useState<
    Record<string, { shift: '' | 'early' | 'late'; earlyHours: number; lateHours: number }>
  >({});
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountPositionFilter, setAccountPositionFilter] = useState('');
  const [employeeAgency, setEmployeeAgency] = useState('');
  const [employeePosition, setEmployeePosition] = useState('');
  const [employeeShiftFilter, setEmployeeShiftFilter] = useState<'' | 'early' | 'late'>('');
  const [employeeLabels, setEmployeeLabels] = useState<string[]>([]);
  const [, setEmployeesHasMore] = useState(false);
  useEffect(() => {
    homeEmployeesRef.current = employees;
  }, [employees]);
  const [employeeNewStaffId, setEmployeeNewStaffId] = useState('');
  const [employeeNewName, setEmployeeNewName] = useState('');
  const [employeeNewAgency, setEmployeeNewAgency] = useState('');
  const [employeeNewPosition, setEmployeeNewPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [employeeNewEmploymentType, setEmployeeNewEmploymentType] = useState<EmploymentType>('FT');
  const [employeeNewShift, setEmployeeNewShift] = useState<'' | 'early' | 'late'>('');
  const [employeeNewShiftTime, setEmployeeNewShiftTime] = useState('');
  const [employeeNewLabel, setEmployeeNewLabel] = useState('');
  const [employeeNewWorkAccount, setEmployeeNewWorkAccount] = useState('');
  const [employeeNewWorkPassword, setEmployeeNewWorkPassword] = useState('');
  const [employeeAddOpen, setEmployeeAddOpen] = useState(false);
  const [employeeEditOpen, setEmployeeEditOpen] = useState(false);
  const [employeeEditOriginalStaffId, setEmployeeEditOriginalStaffId] = useState<string | null>(null);
  const [employeeEditStaffId, setEmployeeEditStaffId] = useState<string | null>(null);
  const [employeeEditName, setEmployeeEditName] = useState('');
  const [employeeEditAgency, setEmployeeEditAgency] = useState('');
  const [employeeEditPosition, setEmployeeEditPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [employeeEditEmploymentType, setEmployeeEditEmploymentType] = useState<EmploymentType>('FT');
  const [employeeEditShift, setEmployeeEditShift] = useState<'' | 'early' | 'late'>('');
  const [employeeEditShiftTime, setEmployeeEditShiftTime] = useState('');
  const [employeeEditLabel, setEmployeeEditLabel] = useState('');
  const [employeeEditWorkAccount, setEmployeeEditWorkAccount] = useState('');
  const [employeeEditWorkPassword, setEmployeeEditWorkPassword] = useState('');
  const [employeeAuditOpen, setEmployeeAuditOpen] = useState(false);
  const [employeeAuditStaffId, setEmployeeAuditStaffId] = useState('');
  const [employeeAuditName, setEmployeeAuditName] = useState('');
  const [employeeAuditRows, setEmployeeAuditRows] = useState<AuditRow[]>([]);
  const [employeeAuditLoading, setEmployeeAuditLoading] = useState(false);
  const [employeeAuditError, setEmployeeAuditError] = useState<string | null>(null);
  const [employeeLastPunchAtByStaffId, setEmployeeLastPunchAtByStaffId] = useState<Record<string, string | null>>({});
  const [employeeSortByLastPunchDesc, setEmployeeSortByLastPunchDesc] = useState(false);
  const [employeeSortByHireDateDesc, setEmployeeSortByHireDateDesc] = useState(false);
  const [employeeBadgePrintingStaffId, setEmployeeBadgePrintingStaffId] = useState<string | null>(null);
  const [accountCardPrintingStaffId, setAccountCardPrintingStaffId] = useState<string | null>(null);
  const [employeeBadgeBatchPrinting, setEmployeeBadgeBatchPrinting] = useState(false);
  const [employeeBadgeBatchSelectedStaffIds, setEmployeeBadgeBatchSelectedStaffIds] = useState<string[]>([]);
  const [employeeBadgeBatchSelectedRowsByStaff, setEmployeeBadgeBatchSelectedRowsByStaff] = useState<
    Record<string, { staff: string; name: string; agency: string; position: string; workAccount?: string; workPassword?: string }>
  >({});
  const [employeeBadgePreview, setEmployeeBadgePreview] = useState<{
    staff: string;
    name: string;
    agency: string;
    position: string;
    qrDataUrl: string;
  } | null>(null);
  const [deviceLabelPrintingSn, setDeviceLabelPrintingSn] = useState<string | null>(null);
  const [deviceLabelBatchPrinting, setDeviceLabelBatchPrinting] = useState(false);
  const [deviceSelectedLabelSns, setDeviceSelectedLabelSns] = useState<string[]>([]);
  const [deviceLabelPreview, setDeviceLabelPreview] = useState<DeviceLabelPrintPreview | null>(null);

  const [timecardRows, setTimecardRows] = useState<TimecardRow[]>([]);
  const [timecardError, setTimecardError] = useState<string | null>(null);
  const [timecardLoading, setTimecardLoading] = useState(false);
  const [timecardSearch, setTimecardSearch] = useState('');
  const [timecardAgency, setTimecardAgency] = useState('');
  const [timecardAgencySort, setTimecardAgencySort] = useState<'' | 'asc' | 'desc'>('');
  const [timecardTotalSort, setTimecardTotalSort] = useState<'' | 'asc' | 'desc'>('');
  const [timecardPosition, setTimecardPosition] = useState('');
  const [timecardShift, setTimecardShift] = useState<'' | 'early' | 'late'>('');
  const [timecardInProgressOnly, setTimecardInProgressOnly] = useState(false);
  const [timecardPresentDayFilter, setTimecardPresentDayFilter] = useState<number | null>(null);
  const [timecardMissingEmployeeOnly, setTimecardMissingEmployeeOnly] = useState(false);
  const [timecardRenderCount, setTimecardRenderCount] = useState(120);
  const [accountRenderCount, setAccountRenderCount] = useState(120);
  const [timecardWeekOffset, setTimecardWeekOffset] = useState(0);
  const [timecardWeekInput, setTimecardWeekInput] = useState(() =>
    toDateOnly(startOfWeekMonday(new Date()))
  );
  const [, setTimecardHasMore] = useState(false);

  const [timecardPunchOpen, setTimecardPunchOpen] = useState(false);
  const [timecardPunchStaffId, setTimecardPunchStaffId] = useState<string | null>(null);
  const [timecardPunchDayIndex, setTimecardPunchDayIndex] = useState<number | null>(null); // 0..6 (Mon..Sun) or null=whole week
  const [timecardPunchRows, setTimecardPunchRows] = useState<PunchRow[]>([]);
  const [timecardPunchError, setTimecardPunchError] = useState<string | null>(null);
  const [timecardPunchShowAll, setTimecardPunchShowAll] = useState(false);
  const [timecardPunchPendingAddRows, setTimecardPunchPendingAddRows] = useState<PunchRow[]>([]);
  const [timecardPunchPendingDeleteIds, setTimecardPunchPendingDeleteIds] = useState<string[]>([]);
  const [timecardPunchAddOpen, setTimecardPunchAddOpen] = useState(false);
  const [timecardPunchEdits, setTimecardPunchEdits] = useState<Record<string, { action: 'IN' | 'OUT'; atLocal: string }>>({});
  const [timecardPunchDraggingId, setTimecardPunchDraggingId] = useState<string | null>(null);
  const [timecardPunchDragOverId, setTimecardPunchDragOverId] = useState<string | null>(null);
  const [timecardPunchOrderIds, setTimecardPunchOrderIds] = useState<string[]>([]);
  const [timecardPunchNew, setTimecardPunchNew] = useState<{ inAtLocal: string; outAtLocal: string }>({
    inAtLocal: '',
    outAtLocal: ''
  });

  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [cellAuditRows, setCellAuditRows] = useState<AuditRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [deviceLoans, setDeviceLoans] = useState<DeviceLoanRow[]>([]);
  const [availableDeviceTypes, setAvailableDeviceTypes] = useState<string[]>([]);
  const [_deviceLoansPage, setDeviceLoansPage] = useState(0);
  const [_deviceLoansHasMore, setDeviceLoansHasMore] = useState(true);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceFilterPosition, setDeviceFilterPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [deviceFilterType, setDeviceFilterType] = useState<DeviceType | ''>('');
  const [deviceBorrowedOnly, setDeviceBorrowedOnly] = useState(false);

  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scheduleRowsWeekOffset, setScheduleRowsWeekOffset] = useState(0);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [schedulePunchPresenceKeys, setSchedulePunchPresenceKeys] = useState<Set<string>>(new Set());
  const [schedulePunchPresenceReady, setSchedulePunchPresenceReady] = useState(false);
  const [schedulePunchPresenceWeekOffset, setSchedulePunchPresenceWeekOffset] = useState<number | null>(null);
  const [scheduleFirstInByStaffDayKey, setScheduleFirstInByStaffDayKey] = useState<Record<string, string>>({});
  const [homePunchesByStaffId, setHomePunchesByStaffId] = useState<Record<string, Array<{ action: 'IN' | 'OUT'; created_at: string }>>>({});
  const [scheduleUphByStaffId, setScheduleUphByStaffId] = useState<Record<string, number | null>>({});
  const [dailyCapacityStaffStatsByStaffId, setDailyCapacityStaffStatsByStaffId] = useState<Record<string, DailyCapacityStaffStats>>({});
  const [dailyCapacityTemplatePayload, setDailyCapacityTemplatePayload] = useState<EffPayloadLite>(() => effDefaultPayload());
  const [dailyCapacityLoading, setDailyCapacityLoading] = useState(false);
  const [dailyCapacityError, setDailyCapacityError] = useState<string | null>(null);
  const [scheduleMistakeByStaffId, setScheduleMistakeByStaffId] = useState<Record<string, number>>({});
  const [scheduleMistakeDetailsByStaffId, setScheduleMistakeDetailsByStaffId] = useState<Record<string, ScheduleMistakeDetail[]>>({});
  const [scheduleMonthlyAbsentDatesByStaffId, setScheduleMonthlyAbsentDatesByStaffId] = useState<Record<string, string[]>>({});
  const [scheduleLateByStaffDayKey, setScheduleLateByStaffDayKey] = useState<Record<string, LateMarkView>>({});
  const [scheduleMistakeDraft, setScheduleMistakeDraft] = useState<ScheduleMistakeDraft>({
    open: false,
    staff_id: '',
    name: '',
    position: '',
    reason: '',
    saving: false
  });
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);
  const [scheduleWeekInput, setScheduleWeekInput] = useState(() => toDateOnly(startOfWeekMonday(new Date())));
  const [schedulePrintDate, setSchedulePrintDate] = useState(() => toDateOnly(new Date()));
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [scheduleSearchInput, setScheduleSearchInput] = useState('');
  const [schedulePosition, setSchedulePosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [scheduleEmploymentType, setScheduleEmploymentType] = useState<'' | EmploymentType>('');
  const [schedulePositionToneByPosition, setSchedulePositionToneByPosition] = useState<Record<AllowedPosition, LabelToneKey>>({
    Pick: 'sky',
    Pack: 'emerald',
    Rebin: 'amber',
    Preship: 'rose',
    Transfer: 'violet',
    'Water Spider': 'sky',
    'FLEX TEAM': 'slate'
  });
  const [scheduleLabels, setScheduleLabels] = useState<string[]>([]);
  const [scheduleLabelToneByName, setScheduleLabelToneByName] = useState<Record<string, LabelToneKey>>(() =>
    loadLabelToneMap()
  );
  const [scheduleShift, setScheduleShift] = useState<'' | 'early' | 'late'>('');
  const [schedulePickerShowMore, setSchedulePickerShowMore] = useState(false);
  const [scheduleSortByUphDesc, setScheduleSortByUphDesc] = useState(false);
  const [scheduleWorkDayFilter, setScheduleWorkDayFilter] = useState<number | null>(null);
  const [scheduleRenderCount, setScheduleRenderCount] = useState(120);
  const [scheduleRecommendedByDate, setScheduleRecommendedByDate] = useState<ScheduleRecommendedByDate>({});
  const [schedulePicker, setSchedulePicker] = useState<SchedulePickerState>({
    open: false,
    cellKey: '',
    employee: null,
    dayIndex: 0,
    workDate: '',
    targetShift: 'early',
    currentState: 'empty',
    anchorLeft: 0,
    anchorTop: 0
  });
  const [dailyListOpen, setDailyListOpen] = useState(false);
  const [dailyListDateInput, setDailyListDateInput] = useState(() => toDateOnly(addDays(new Date(), 1)));
  const [dailyListNewHireOpen, setDailyListNewHireOpen] = useState(false);
  const [dailyListNewHirePosition, setDailyListNewHirePosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [dailyListNewHireCount, setDailyListNewHireCount] = useState(1);
  const [dailyListNewHireAgency, setDailyListNewHireAgency] = useState('');
  const [dailyListNewHireShift, setDailyListNewHireShift] = useState<'' | 'early' | 'late'>('');
  const [dailyListNewHireLabel, setDailyListNewHireLabel] = useState('');
  const [dailyListNewHireEntryTime, setDailyListNewHireEntryTime] = useState('');
  const [dailyListNewHireNote, setDailyListNewHireNote] = useState('');
  const [dailyListSelectedPositions, setDailyListSelectedPositions] = useState<DailyListLightFlags>(
    createEmptyDailyListLightFlags
  );
  const [dailyListFilterPositions, setDailyListFilterPositions] = useState<DailyListLightFlags>(
    createEmptyDailyListLightFlags
  );
  const dailyListTargetDateKey = useMemo(() => {
    const parsedTarget =
      /^\d{4}-\d{2}-\d{2}$/.test(dailyListDateInput)
        ? new Date(`${dailyListDateInput}T00:00:00`)
        : addDays(new Date(serverTime), 1);
    const targetDay = Number.isNaN(parsedTarget.getTime()) ? addDays(new Date(serverTime), 1) : parsedTarget;
    return toDateOnly(targetDay);
  }, [dailyListDateInput, serverTime]);
  const schedulePositionDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const scheduleLabelDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const deferredScheduleSearch = useDeferredValue(scheduleSearch);
  const deferredEmployeeSearch = useDeferredValue(employeeSearch);
  const deferredAccountSearch = useDeferredValue(accountSearch);
  const deferredAccountPositionFilter = useDeferredValue(accountPositionFilter);
  const deferredSchedulePosition = useDeferredValue(schedulePosition);
  const deferredScheduleEmploymentType = useDeferredValue(scheduleEmploymentType);
  const deferredScheduleShift = useDeferredValue(scheduleShift);
  const deferredScheduleLabels = useDeferredValue(scheduleLabels);

  // Real-time schedule synchronization across devices
  useScheduleRealtime({
    supabase,
    scheduleTableName: SCHEDULE_TABLE,
    onScheduleChange: (event) => {
      console.log(`[Schedule Realtime] Change detected: staff_id=${event.staffId}, date=${event.date}, type=${event.type}`);
      // Debounce rapid consecutive changes to avoid excessive fetches
      if (scheduleRealtimeDebounceTimerRef.current !== null) {
        window.clearTimeout(scheduleRealtimeDebounceTimerRef.current);
      }
      scheduleRealtimeDebounceTimerRef.current = window.setTimeout(() => {
        scheduleRealtimeDebounceTimerRef.current = null;
        if (fetchScheduleRef.current) {
          void fetchScheduleRef.current({ lockUi: false });
        }
      }, 300); // Debounce for 300ms
    },
    enabled: page === 'schedule' && !!supabase
  });

  useEffect(() => {
    if (page !== 'schedule') return;
    if (!supabase) {
      setScheduleRecommendedByDate({});
      return;
    }
    let cancelled = false;
    const loadScheduleRecommendedPositions = async () => {
      const planningDates = Array.from({ length: 7 }, (_, index) =>
        toDateOnly(addDays(addDays(startOfWeekMonday(serverTime), scheduleWeekOffset * 7), index))
      );
      if (planningDates.length === 0) {
        if (!cancelled) setScheduleRecommendedByDate({});
        return;
      }

      const latestTemplateRes = await supabase
        .from(EFFICIENCY_TEMPLATE_TABLE)
        .select('payload, updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestTemplateRes.error && !isMissingTableError(latestTemplateRes.error.message, EFFICIENCY_TEMPLATE_TABLE)) {
        if (!cancelled) setScheduleRecommendedByDate({});
        return;
      }

      const payload = effNormalizePayload(latestTemplateRes.data?.payload ?? effDefaultPayload());
      const sourceDates = planningDates.map((date) => toDateOnly(addDays(new Date(`${date}T00:00:00`), -1)));
      const previousDates = sourceDates.map((date) => toDateOnly(addDays(new Date(`${date}T00:00:00`), -1)));
      const datePool = Array.from(new Set([...planningDates, ...sourceDates, ...previousDates]));
      const historyRes = await supabase
        .from(EFFICIENCY_HISTORY_TABLE)
        .select(`date,last_filled_hour,${EFF_HOUR_COLUMNS.join(',')}`)
        .in('date', sourceDates);

      if (historyRes.error && !isMissingTableError(historyRes.error.message, EFFICIENCY_HISTORY_TABLE)) {
        if (!cancelled) setScheduleRecommendedByDate({});
        return;
      }

      const historyRows = (((historyRes.data as EffVolumeHistoryRow[] | null) ?? []) as EffVolumeHistoryRow[]).map((row) => ({
        ...row,
        date: String((row as any).date ?? '')
      }));
      void historyRows;

      const modelRes = await supabase.rpc('get_forecasting_model', { p_lookback_days: null });
      if (modelRes.error) {
        if (!cancelled) setScheduleRecommendedByDate({});
        return;
      }

      void modelRes.data;
      const inputRes = await supabase
        .from(EFFICIENCY_FORECAST_INPUT_TABLE)
        .select('input_date,previous_day_backlog,full_day_capacity,yesterday_inflow_00_14,actual_day_shift_plan,actual_night_shift_plan')
        .in('input_date', datePool);
      if (inputRes.error && !isMissingTableError(inputRes.error.message, EFFICIENCY_FORECAST_INPUT_TABLE)) {
        if (!cancelled) setScheduleRecommendedByDate({});
        return;
      }

      const inputRows = (((inputRes.data as EffForecastInputRow[] | null) ?? []) as EffForecastInputRow[]).map((row) => ({
        input_date: String((row as any).input_date ?? ''),
        previous_day_backlog: Number((row as any).previous_day_backlog ?? 0),
        full_day_capacity: Number((row as any).full_day_capacity ?? 0),
        yesterday_inflow_00_14: Number((row as any).yesterday_inflow_00_14 ?? 0),
        actual_day_shift_plan: (row as any).actual_day_shift_plan == null ? null : Number((row as any).actual_day_shift_plan),
        actual_night_shift_plan: (row as any).actual_night_shift_plan == null ? null : Number((row as any).actual_night_shift_plan)
      }));
      const inputByDate = new Map(inputRows.map((row) => [row.input_date, row] as const));
      const nextByDate: ScheduleRecommendedByDate = {};

      for (const planningDate of planningDates) {
        const planningRow = inputByDate.get(planningDate) ?? null;
        const dsOiPieces = planningRow?.actual_day_shift_plan ?? null;
        const nsOiPieces = planningRow?.actual_night_shift_plan ?? null;
        if (dsOiPieces === null || nsOiPieces === null) {
          nextByDate[planningDate] = [];
          continue;
        }

        const sourceDate = toDateOnly(addDays(new Date(`${planningDate}T00:00:00`), -1));
        void sourceDate;

        const inboundDs = effWithInboundPieces(payload.orderInboundDs, dsOiPieces);
        const inboundNs = effWithInboundPieces(payload.orderInboundNs, nsOiPieces);
        const derivedDs = effDeriveInboundVolume(inboundDs);
        const derivedNs = effDeriveInboundVolume(inboundNs);

        const dsValues = {
          pick: effCalcRequirement(derivedDs.totalPieces, payload.areaEfficiencyDs.pick, 'ceil'),
          rebin: effCalcRequirement(derivedDs.multiPiece, payload.areaEfficiencyDs.rebin, 'ceil'),
          con:
            derivedDs.multiPkgs > 0
              ? Math.max(1, effCalcRequirement(derivedDs.multiPkgs, payload.areaEfficiencyDs.consolidation, 'ceil'))
              : 0,
          pack:
            effCalcRequirement(derivedDs.singlePiece, payload.areaEfficiencyDs.single_pack, 'round') +
            effCalcRequirement(derivedDs.multiPiece, payload.areaEfficiencyDs.multi_pack, 'round'),
          preship: effCalcRequirement(derivedDs.totalPackages, payload.areaEfficiencyDs.pre_ship, 'round'),
          waterSpider: effCalcRequirement(derivedDs.totalPackages, payload.areaEfficiencyDs.waterspider, 'floor')
        };
        const nsValues = {
          pick: effCalcRequirement(derivedNs.totalPieces, payload.areaEfficiencyNs.pick, 'ceil'),
          rebin: effCalcRequirement(derivedNs.multiPiece, payload.areaEfficiencyNs.rebin, 'ceil'),
          con:
            derivedNs.multiPkgs > 0
              ? Math.max(1, effCalcRequirement(derivedNs.multiPkgs, payload.areaEfficiencyNs.consolidation, 'ceil'))
              : 0,
          pack:
            effCalcRequirement(derivedNs.singlePiece, payload.areaEfficiencyNs.single_pack, 'round') +
            effCalcRequirement(derivedNs.multiPiece, payload.areaEfficiencyNs.multi_pack, 'round'),
          preship: effCalcRequirement(derivedNs.totalPackages, payload.areaEfficiencyNs.pre_ship, 'round'),
          waterSpider: effCalcRequirement(derivedNs.totalPackages, payload.areaEfficiencyNs.waterspider, 'floor')
        };

        nextByDate[planningDate] = [
          { key: 'Pick', ds: dsValues.pick, ns: nsValues.pick, total: dsValues.pick + nsValues.pick },
          {
            key: 'Rebin',
            ds: dsValues.rebin + dsValues.con,
            ns: nsValues.rebin + nsValues.con,
            total: dsValues.rebin + dsValues.con + nsValues.rebin + nsValues.con
          },
          { key: 'Pack', ds: dsValues.pack, ns: nsValues.pack, total: dsValues.pack + nsValues.pack },
          { key: 'Preship', ds: dsValues.preship, ns: nsValues.preship, total: dsValues.preship + nsValues.preship },
          {
            key: 'Water Spider',
            ds: dsValues.waterSpider,
            ns: nsValues.waterSpider,
            total: dsValues.waterSpider + nsValues.waterSpider
          }
        ];
      }

      if (!cancelled) setScheduleRecommendedByDate(nextByDate);
    };

    void loadScheduleRecommendedPositions();
    return () => {
      cancelled = true;
    };
  }, [page, scheduleWeekOffset, serverTime]);
  const canonicalDeviceRows = useMemo(() => {
    return devices.map((row) => {
      const sn = normalizeDeviceSn(String(row.device_sn ?? row.sn ?? ''));
      const deviceName = String(row.device_name ?? row.name ?? '').trim();
      const type = normalizeDeviceType(String(row.device_type ?? row.type ?? 'PDA'));
      const position = normalizeAllowedPosition(String(row.position ?? ''));
      return {
        ...row,
        device_name: deviceName || null,
        device_sn: sn,
        device_type: type,
        position: position || null,
        active: row.active !== false
      };
    });
  }, [devices]);
  const canonicalDeviceLoans = useMemo(() => {
    return deviceLoans.map((row) => {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const sn = normalizeDeviceSn(String(row.device_sn ?? ''));
      const action = String(row.action ?? '').trim().toLowerCase() === 'return' ? 'return' : 'borrow';
      return {
        ...row,
        staff_id: staff,
        device_sn: sn,
        action
      } as DeviceLoanRow & { action: 'borrow' | 'return' };
    });
  }, [deviceLoans]);
  const employeeNameByStaffId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [staffRaw, profile] of Object.entries(employeeByStaffId)) {
      const staff = normalizeStaffId(String(staffRaw ?? '').trim());
      const name = String(profile?.name ?? '').trim();
      if (!staff || !name) continue;
      map.set(staff, name);
    }
    for (const row of employees) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const name = String(row.name ?? '').trim();
      if (!staff || !name) continue;
      map.set(staff, name);
    }
    return map;
  }, [employeeByStaffId, employees]);
  const deviceCurrentBorrowBySn = useMemo(() => {
    const sorted = [...canonicalDeviceLoans].sort((a, b) => {
      const aMs = Date.parse(String(a.created_at ?? '')) || 0;
      const bMs = Date.parse(String(b.created_at ?? '')) || 0;
      if (aMs !== bMs) return aMs - bMs;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''), 'en-US');
    });
    const map = new Map<string, { staff_id: string; staff_name: string; created_at: string; operator: string; note: string }>();
    for (const row of sorted) {
      const sn = normalizeDeviceSn(String(row.device_sn ?? ''));
      if (!sn) continue;
      if (row.action === 'borrow') {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        map.set(sn, {
          staff_id: staff,
          staff_name: employeeNameByStaffId.get(staff) ?? '',
          created_at: String(row.created_at ?? ''),
          operator: String(row.operator ?? '').trim(),
          note: String(row.note ?? '').trim()
        });
      } else {
        map.delete(sn);
      }
    }
    return map;
  }, [canonicalDeviceLoans, employeeNameByStaffId]);
  const deviceLastLoanAtBySn = useMemo(() => {
    const sortedDesc = [...canonicalDeviceLoans].sort((a, b) => {
      const aMs = Date.parse(String(a.created_at ?? '')) || 0;
      const bMs = Date.parse(String(b.created_at ?? '')) || 0;
      if (aMs !== bMs) return bMs - aMs;
      return String(b.id ?? '').localeCompare(String(a.id ?? ''), 'en-US');
    });
    const map = new Map<string, string>();
    for (const row of sortedDesc) {
      const sn = normalizeDeviceSn(String(row.device_sn ?? ''));
      if (!sn || map.has(sn)) continue;
      map.set(sn, String(row.created_at ?? ''));
    }
    return map;
  }, [canonicalDeviceLoans]);
  const deviceLastUserBySn = useMemo(() => {
    const sortedDesc = [...canonicalDeviceLoans].sort((a, b) => {
      const aMs = Date.parse(String(a.created_at ?? '')) || 0;
      const bMs = Date.parse(String(b.created_at ?? '')) || 0;
      if (aMs !== bMs) return bMs - aMs;
      return String(b.id ?? '').localeCompare(String(a.id ?? ''), 'en-US');
    });
    const map = new Map<string, string>();
    for (const row of sortedDesc) {
      const sn = normalizeDeviceSn(String(row.device_sn ?? ''));
      if (!sn || map.has(sn)) continue;
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const staffName = employeeNameByStaffId.get(staff) ?? staff;
      map.set(sn, staffName || '-');
    }
    return map;
  }, [canonicalDeviceLoans, employeeNameByStaffId]);
  
  // 动态计算所有可用的设备类型（从导入的数据中提取）
  const computedAvailableDeviceTypes = useMemo(() => {
    const types = new Set<string>();
    
    // 添加默认预定义类型以保持向后兼容
    (DEFAULT_DEVICE_TYPES as readonly string[]).forEach(t => types.add(t));
    
    // 从现有设备数据中提取所有不同的类型
    canonicalDeviceRows.forEach(dev => {
      const type = String(dev.device_type ?? '').trim();
      if (type) types.add(type);
    });
    
    // 返回排序后的类型列表
    return Array.from(types).sort();
  }, [canonicalDeviceRows]);
  
  // 同步更新 availableDeviceTypes 状态
  useEffect(() => {
    setAvailableDeviceTypes(computedAvailableDeviceTypes);
  }, [computedAvailableDeviceTypes]);
  
  const deviceRowsFiltered = useMemo(() => {
    const search = deviceSearch.trim().toLowerCase();
    return canonicalDeviceRows
      .filter((row) => {
      const deviceName = String(row.device_name ?? '').trim();
      const sn = normalizeDeviceSn(String(row.device_sn ?? ''));
      const pos = String(row.position ?? '');
      const type = normalizeDeviceType(String(row.device_type ?? 'PDA'));
      const borrowed = deviceCurrentBorrowBySn.get(sn);
      if (deviceFilterPosition && pos !== deviceFilterPosition) return false;
      if (deviceFilterType && type !== deviceFilterType) return false;
      if (deviceBorrowedOnly && !borrowed) return false;
      if (!search) return true;
      return `${deviceName} ${sn} ${type} ${pos}`.toLowerCase().includes(search);
      })
      .sort((a, b) => {
        const aName = String(a.device_name ?? '').trim();
        const bName = String(b.device_name ?? '').trim();
        if (aName !== bName) return aName.localeCompare(bName, 'en-US', { numeric: true, sensitivity: 'base' });
        const aSn = normalizeDeviceSn(String(a.device_sn ?? ''));
        const bSn = normalizeDeviceSn(String(b.device_sn ?? ''));
        return aSn.localeCompare(bSn, 'en-US', { numeric: true, sensitivity: 'base' });
      });
  }, [canonicalDeviceRows, deviceCurrentBorrowBySn, deviceBorrowedOnly, deviceFilterPosition, deviceFilterType, deviceSearch]);
  const selectedDeviceLabelSnSet = useMemo(() => new Set(deviceSelectedLabelSns), [deviceSelectedLabelSns]);
  const isAllFilteredDevicesSelected = useMemo(() => {
    if (deviceRowsFiltered.length === 0) return false;
    for (const row of deviceRowsFiltered) {
      const sn = normalizeDeviceSn(String(row.device_sn ?? row.sn ?? ''));
      if (!sn || !selectedDeviceLabelSnSet.has(sn)) return false;
    }
    return true;
  }, [deviceRowsFiltered, selectedDeviceLabelSnSet]);
  const deviceSelectedLabelRows = useMemo(() => {
    const out: DeviceLabelPrintPayload[] = [];
    for (const row of deviceRowsFiltered) {
      const sn = normalizeDeviceSn(String(row.device_sn ?? row.sn ?? ''));
      if (!sn || !selectedDeviceLabelSnSet.has(sn)) continue;
      const type = normalizeDeviceType(String(row.device_type ?? row.type ?? 'PDA'));
      const name = String(row.device_name ?? row.name ?? '').trim();
      out.push({
        sn,
        name: name || sn,
        position: String(row.position ?? '').trim() || '-',
        type
      });
    }
    return out;
  }, [deviceRowsFiltered, selectedDeviceLabelSnSet]);

  useEffect(() => {
    const allowed = new Set<string>();
    for (const row of deviceRowsFiltered) {
      const sn = normalizeDeviceSn(String(row.device_sn ?? row.sn ?? ''));
      if (sn) allowed.add(sn);
    }
    setDeviceSelectedLabelSns((prev) => {
      const next = prev.filter((sn) => allowed.has(sn));
      if (next.length === prev.length && next.every((sn, idx) => sn === prev[idx])) return prev;
      return next;
    });
  }, [deviceRowsFiltered]);

  const normalizeLabelToneMap = (value: unknown): Record<string, LabelToneKey> => {
    const raw = (value ?? {}) as Record<string, unknown>;
    const next: Record<string, LabelToneKey> = {};
    for (const [k, v] of Object.entries(raw)) {
      const name = String(k ?? '').trim().toLowerCase();
      const tone = String(v ?? '').trim() as LabelToneKey;
      if (!name || !LABEL_TONE_KEYS.includes(tone)) continue;
      next[name] = tone;
    }
    return next;
  };

  const normalizePositionToneMap = (value: unknown): Record<AllowedPosition, LabelToneKey> => {
    const raw = (value ?? {}) as Record<string, unknown>;
    const next: Record<AllowedPosition, LabelToneKey> = {
      Pick: 'sky',
      Pack: 'emerald',
      Rebin: 'amber',
      Preship: 'rose',
      Transfer: 'violet',
      'Water Spider': 'sky',
      'FLEX TEAM': 'slate'
    };
    for (const pos of ALLOWED_POSITIONS) {
      const tone = String(raw[pos] ?? '').trim() as LabelToneKey;
      if (!LABEL_TONE_KEYS.includes(tone)) continue;
      next[pos] = tone;
    }
    return next;
  };

  const saveScheduleLabelToneGlobal = async (next: Record<string, LabelToneKey>) => {
    if (!supabase) return;
    const nowIso = new Date(serverTime).toISOString();
    const payload = {
      key: SCHEDULE_LABEL_TONES_KEY,
      value: {
        tones: next,
        updated_at: nowIso,
        operator: user?.email ?? null
      },
      updated_at: nowIso
    };
    const upsertRes = await supabase.from(APP_SETTINGS_TABLE).upsert([payload as any], { onConflict: 'key' });
    if (!upsertRes.error) return;
    const updateRes = await supabase.from(APP_SETTINGS_TABLE).update(payload as any).eq('key', SCHEDULE_LABEL_TONES_KEY);
    if (!updateRes.error) return;
    await supabase.from(APP_SETTINGS_TABLE).insert([payload as any]);
  };

  const loadScheduleLabelToneGlobal = async () => {
    if (!supabase) {
      scheduleLabelToneReadyRef.current = true;
      return;
    }
    try {
      const res = await supabase
        .from(APP_SETTINGS_TABLE)
        .select('id, key, value, updated_at')
        .eq('key', SCHEDULE_LABEL_TONES_KEY)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (res.error) return;
      const row = (((res.data as any[]) ?? [])[0] ?? null) as AppSettingRow | null;
      if (!row) return;
      const value = (row.value ?? {}) as Record<string, unknown>;
      const next = normalizeLabelToneMap(value.tones ?? {});
      const nextJson = JSON.stringify(next);
      if (nextJson === scheduleLabelToneLastSavedJsonRef.current) return;
      scheduleLabelToneHydratingRef.current = true;
      scheduleLabelToneLastSavedJsonRef.current = nextJson;
      saveLabelToneMap(next);
      setScheduleLabelToneByName(next);
    } finally {
      scheduleLabelToneReadyRef.current = true;
    }
  };

  const saveSchedulePositionToneGlobal = async (next: Record<AllowedPosition, LabelToneKey>) => {
    if (!supabase) return;
    const nowIso = new Date(serverTime).toISOString();
    const payload = {
      key: SCHEDULE_POSITION_TONES_KEY,
      value: {
        tones: next,
        updated_at: nowIso,
        operator: user?.email ?? null
      },
      updated_at: nowIso
    };
    const upsertRes = await supabase.from(APP_SETTINGS_TABLE).upsert([payload as any], { onConflict: 'key' });
    if (!upsertRes.error) return;
    const updateRes = await supabase.from(APP_SETTINGS_TABLE).update(payload as any).eq('key', SCHEDULE_POSITION_TONES_KEY);
    if (!updateRes.error) return;
    await supabase.from(APP_SETTINGS_TABLE).insert([payload as any]);
  };

  const loadSchedulePositionToneGlobal = async () => {
    if (!supabase) {
      schedulePositionToneReadyRef.current = true;
      return;
    }
    try {
      const res = await supabase
        .from(APP_SETTINGS_TABLE)
        .select('id, key, value, updated_at')
        .eq('key', SCHEDULE_POSITION_TONES_KEY)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (res.error) return;
      const row = (((res.data as any[]) ?? [])[0] ?? null) as AppSettingRow | null;
      if (!row) return;
      const value = (row.value ?? {}) as Record<string, unknown>;
      const next = normalizePositionToneMap(value.tones ?? {});
      const nextJson = JSON.stringify(next);
      if (nextJson === schedulePositionToneLastSavedJsonRef.current) return;
      schedulePositionToneHydratingRef.current = true;
      schedulePositionToneLastSavedJsonRef.current = nextJson;
      setSchedulePositionToneByPosition(next);
    } finally {
      schedulePositionToneReadyRef.current = true;
    }
  };

  useEffect(() => {
    if (!scheduleLabelToneReadyRef.current) return;
    saveLabelToneMap(scheduleLabelToneByName);
    const json = JSON.stringify(scheduleLabelToneByName);
    if (scheduleLabelToneHydratingRef.current) {
      scheduleLabelToneHydratingRef.current = false;
      scheduleLabelToneLastSavedJsonRef.current = json;
      return;
    }
    if (json === scheduleLabelToneLastSavedJsonRef.current) return;
    scheduleLabelToneLastSavedJsonRef.current = json;
    void saveScheduleLabelToneGlobal(scheduleLabelToneByName);
  }, [scheduleLabelToneByName]);

  useEffect(() => {
    if (!schedulePositionToneReadyRef.current) return;
    const json = JSON.stringify(schedulePositionToneByPosition);
    if (schedulePositionToneHydratingRef.current) {
      schedulePositionToneHydratingRef.current = false;
      schedulePositionToneLastSavedJsonRef.current = json;
      return;
    }
    if (json === schedulePositionToneLastSavedJsonRef.current) return;
    schedulePositionToneLastSavedJsonRef.current = json;
    void saveSchedulePositionToneGlobal(schedulePositionToneByPosition);
  }, [schedulePositionToneByPosition]);

  useEffect(() => {
    scheduleLabelToneReadyRef.current = false;
    schedulePositionToneReadyRef.current = false;
    void loadScheduleLabelToneGlobal();
    void loadSchedulePositionToneGlobal();
  }, [user?.email]);

  useEffect(() => {
    if (page !== 'schedule') return;
    let active = true;
    const sync = async () => {
      if (!active) return;
      await loadScheduleLabelToneGlobal();
      await loadSchedulePositionToneGlobal();
    };
    const timer = window.setInterval(() => {
      void sync();
    }, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [page, user?.email, offsetMs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setScheduleSearch(scheduleSearchInput);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [scheduleSearchInput]);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFillDuplicates, setUploadFillDuplicates] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [deviceUploadError, setDeviceUploadError] = useState<string | null>(null);
  const deviceFileInputRef = useRef<HTMLInputElement | null>(null);

  const [, setAttendanceStats] = useState<
    Record<string, { early: number; late: number; active: number }>
  >({});
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [homeOnClockShiftByStaffId, setHomeOnClockShiftByStaffId] = useState<Record<string, 'early' | 'late'>>({});
  const [homeRosterPositionFilter, setHomeRosterPositionFilter] = useState<'ALL' | AllowedPosition>('ALL');

  const resolveEmployeeColumnMode = async (): Promise<EmployeeColumnMode> => {
    const cached = employeeColumnModeRef.current;
    if (cached) return cached;
    if (!supabase) {
      employeeColumnModeRef.current = 'lower';
      return 'lower';
    }

    const cased = await supabase.from(EMPLOYEE_TABLE).select('staff_id, "Agency", "Position"').limit(1);
    if (!cased.error) {
      employeeColumnModeRef.current = 'cased';
      return 'cased';
    }

    const lower = await supabase.from(EMPLOYEE_TABLE).select('staff_id, agency, position').limit(1);
    if (!lower.error) {
      employeeColumnModeRef.current = 'lower';
      return 'lower';
    }

    employeeColumnModeRef.current = 'cased';
    return 'cased';
  };

  const normalizePositionKey = (value: string) => {
    const v = value.trim().toLowerCase();
    if (v === 'pick') return 'Pick';
    if (v === 'pack') return 'Pack';
    if (v === 'rebin') return 'Rebin';
    if (v === 'preship') return 'Preship';
    if (v === 'transfer') return 'Transfer';
    if (v === 'water spider' || v === 'waterspider' || v === 'water-spider') return 'Water Spider';
    if (
      v === '兜底组' ||
      v === '兜底' ||
      v === 'flex team（机动组）' ||
      v === 'flex team' ||
      v === 'flexteam' ||
      v === 'wrap-up team' ||
      v === 'wrap up team' ||
      v === 'wrapup team' ||
      v === 'fallback' ||
      v === 'backup'
    ) {
      return 'FLEX TEAM';
    }
    return null;
  };

  const normalizeDailyListPositionKey = (value: string) => {
    const normalized = normalizeDailyListLightPosition(value);
    return normalized || null;
  };

const getShiftBucket = (inAtIso: string) => {
    const dt = new Date(inAtIso);
    if (Number.isNaN(dt.getTime())) return null;
    const h = dt.getHours();
    const m = dt.getMinutes();
    const minutes = h * 60 + m;
  const earlyStart = 5 * 60;
  const earlyEnd = 15 * 60; // 3pm
  return minutes >= earlyStart && minutes < earlyEnd ? 'early' : 'late';
};

const getShiftBadgeClass = (value: '' | 'early' | 'late') => {
  if (value === 'early') return 'badge-elevated-dark border-amber-300/30 text-amber-100 bg-amber-400/[0.13]';
  if (value === 'late') return 'badge-elevated-dark border-indigo-300/30 text-indigo-100 bg-indigo-400/[0.13]';
  return 'badge-elevated-dark border-white/12 text-slate-200 bg-white/[0.05]';
};
const normalizeShiftValue = (value: string): '' | 'early' | 'late' => {
  const v = value.trim().toLowerCase();
  if (v === 'early' || v === 'day' || v === 'morning') return 'early';
  if (v === 'late' || v === 'night' || v === 'evening') return 'late';
  return '';
};
const normalizeShiftTimeValue = (value: unknown) => {
  const parsed = parseClockTextToMinutes(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return '';
  return formatClockMinutes(parsed as number);
};
const normalizeEmploymentTypeValue = (value: unknown): EmploymentType => {
  const text = String(value ?? '').trim().toUpperCase();
  return text === 'PT' ? 'PT' : 'FT';
};
const getDefaultShiftStartTime = (shift: 'early' | 'late', position: string) => {
  const pos = normalizePositionKey(position) ?? '';
  const isPickTrack = pos === 'Pick';
  if (shift === 'early') return isPickTrack ? '07:00' : '08:00';
  return isPickTrack ? '15:30' : '16:30';
};
const resolveShiftStartTime = (shift: 'early' | 'late', position: string, shiftTimeRaw?: unknown) => {
  const normalized = normalizeShiftTimeValue(shiftTimeRaw);
  if (normalized) return normalized;
  return getDefaultShiftStartTime(shift, position);
};
const getPlannedStartTime = (shift: 'early' | 'late', position: string) => getDefaultShiftStartTime(shift, position);

  const fetchRealtimeAttendance = async () => {
    if (!supabase) {
      setAttendanceError('缺少 Supabase 配置。');
      return;
    }

    const seq = ++attendanceFetchSeqRef.current;
    setAttendanceError(null);

    try {
      const now = new Date(serverTime);
      const rangeStart = new Date(now);
      rangeStart.setHours(ATTENDANCE_RESET_HOUR, 0, 0, 0);
      if (now.getTime() < rangeStart.getTime()) {
        rangeStart.setDate(rangeStart.getDate() - 1);
      }

      const pageSize = 1000;
      const latestByStaff = new Map<string, { action: 'IN' | 'OUT'; at: string }>();
      const firstInByStaff = new Map<string, { at: string }>();
      const runAttendanceQuery = async <T,>(queryFactory: () => PromiseLike<{ data: T | null; error: any }>) => {
        let lastRes = await queryFactory();
        if (!lastRes.error) return lastRes;
        if (isAbortLikeError(lastRes.error)) return lastRes;
        const normalized = normalizeAttendanceFetchError(lastRes.error);
        if (normalized === '无法连接考勤服务，请检查网络或稍后重试。') {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          lastRes = await queryFactory();
        }
        return lastRes;
      };

      const latestPunchRowsRes = await fetchAllPagedRows<any>({
        pageSize,
        shouldStop: () => seq !== attendanceFetchSeqRef.current,
        stopError: STALE_TIMECARD_REQUEST,
        fetchPage: async (from, to) =>
          await runAttendanceQuery(() =>
            supabase
              .from('ob_punches')
              .select('staff_id, action, created_at, id')
              .gte('created_at', rangeStart.toISOString())
              .order('created_at', { ascending: false })
              .range(from, to)
          )
      });
      if (latestPunchRowsRes.error) {
        if (latestPunchRowsRes.error === STALE_TIMECARD_REQUEST) return;
        setAttendanceError(normalizeAttendanceFetchError(latestPunchRowsRes.error));
        return;
      }
      for (const r of latestPunchRowsRes.rows) {
        const staff = String(r.staff_id ?? '').trim();
        if (!staff || latestByStaff.has(staff)) continue;
        const action = String(r.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
        const at = String(r.created_at ?? '').trim();
        if (!at) continue;
        latestByStaff.set(staff, { action, at });
      }

      const firstPunchRowsRes = await fetchAllPagedRows<any>({
        pageSize,
        shouldStop: () => seq !== attendanceFetchSeqRef.current,
        stopError: STALE_TIMECARD_REQUEST,
        fetchPage: async (from, to) =>
          await runAttendanceQuery(() =>
            supabase
              .from('ob_punches')
              .select('staff_id, created_at, id')
              .order('created_at', { ascending: true })
              .range(from, to)
          )
      });
      if (firstPunchRowsRes.error) {
        if (firstPunchRowsRes.error === STALE_TIMECARD_REQUEST) return;
        setAttendanceError(normalizeAttendanceFetchError(firstPunchRowsRes.error));
        return;
      }
      for (const r of firstPunchRowsRes.rows) {
        const staff = String(r.staff_id ?? '').trim();
        if (!staff || firstInByStaff.has(staff)) continue;
        const at = String(r.created_at ?? '').trim();
        if (!at) continue;
        firstInByStaff.set(staff, { at });
      }

      const activeStaff = Array.from(latestByStaff.entries())
        .filter(([, v]) => v.action === 'IN')
        .map(([staff]) => staff);
      const attendanceStaff = Array.from(firstInByStaff.keys());

      if (activeStaff.length === 0 && attendanceStaff.length === 0) {
        setAttendanceStats({});
        setHomeOnClockShiftByStaffId({});
        return;
      }

      const mode = await resolveEmployeeColumnMode();
      const staffToPosition = new Map<string, string>();
      const allStaff = Array.from(new Set([...activeStaff, ...attendanceStaff]));
      const batches = chunk(allStaff, 200);
      for (const batch of batches) {
        const select = mode === 'cased' ? 'staff_id, "Position"' : 'staff_id, position';
        let res = await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', batch);
        if (res.error) {
          const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
          employeeColumnModeRef.current = flipped;
          const select2 = flipped === 'cased' ? 'staff_id, "Position"' : 'staff_id, position';
          res = await supabase.from(EMPLOYEE_TABLE).select(select2).in('staff_id', batch);
        }
        if (seq !== attendanceFetchSeqRef.current) return;
        if (res.error) {
          if (!isAbortLikeError(res.error)) setAttendanceError(normalizeAttendanceFetchError(res.error));
          return;
        }
        for (const r of (res.data as any[] | null) ?? []) {
          const staff = String(r.staff_id ?? '').trim();
          const posRaw = String(r.position ?? r.Position ?? '').trim();
          if (!staff || !posRaw) continue;
          const key = normalizePositionKey(posRaw);
          if (!key) continue;
          staffToPosition.set(staff, key);
        }
      }

      const stats: Record<string, { early: number; late: number; active: number }> = {};
      const onClockShiftByStaffId: Record<string, 'early' | 'late'> = {};
      const shiftByStaffId: Record<string, 'early' | 'late'> = {};
      for (const staff of activeStaff) {
        const latest = latestByStaff.get(staff);
        if (!latest || latest.action !== 'IN') continue;
        const shift = getShiftBucket(latest.at);
        if (!shift) continue;
        shiftByStaffId[staff] = shift;
        onClockShiftByStaffId[staff] = shift;
      }
      for (const staff of attendanceStaff) {
        const firstIn = firstInByStaff.get(staff);
        if (!firstIn) continue;
        const pos = staffToPosition.get(staff);
        if (!pos) continue;
        const shift = shiftByStaffId[staff] ?? getShiftBucket(firstIn.at);
        if (!shift) continue;
        shiftByStaffId[staff] = shift;
        const s = (stats[pos] ??= { early: 0, late: 0, active: 0 });
        s[shift] += 1;
      }

      for (const staff of activeStaff) {
        const pos = staffToPosition.get(staff);
        if (!pos) continue;
        const s = (stats[pos] ??= { early: 0, late: 0, active: 0 });
        s.active += 1;
      }

      setAttendanceStats(stats);
      setHomeOnClockShiftByStaffId(onClockShiftByStaffId);
    } catch (err: any) {
      if (!isAbortLikeError(err)) {
        setAttendanceError(normalizeAttendanceFetchError(err));
      }
    }
  };

  const runLocked = async (reason: string, fn: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(reason);
    try {
      await fn();
    } catch (err) {
      if (!isAbortLikeError(err)) {
        throw err;
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  useEffect(() => {
    const tick = () => {
      setServerTime(new Date(Date.now() + offsetMs));
    };
    const intervalMs =
      page === 'home'
        ? 60000
        : page === 'schedule'
          ? 60000
          : page === 'timecard'
            ? 15000
            : 60000;
    const timer = window.setInterval(tick, intervalMs);
    tick();
    return () => window.clearInterval(timer);
  }, [offsetMs, page]);

  useEffect(() => {
    if (!busy) {
      setBusyVisible(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setBusyVisible(true);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [busy]);

  const saveDailyListSelectedPositionsGlobal = async (
    next: DailyListLightFlags,
    targetDateOverride?: string
  ) => {
    if (!supabase) return;
    const fallbackDate = toDateOnly(addDays(new Date(serverTime), 1));
    const targetDateRaw = targetDateOverride ?? dailyListDateInput;
    const targetDate = isDateOnlyValue(targetDateRaw) ? targetDateRaw : fallbackDate;
    const baseRes = await supabase
      .from(APP_SETTINGS_TABLE)
      .select('id, key, value, updated_at')
      .eq('key', DAILY_LIST_LIGHTS_KEY)
      .order('updated_at', { ascending: false })
      .limit(1);
    const currentValue = ((((baseRes.data as any[]) ?? [])[0] as AppSettingRow | undefined)?.value ?? {}) as Record<string, unknown>;
    const updatedAt = new Date(serverTime).toISOString();
    const payload = {
      key: DAILY_LIST_LIGHTS_KEY,
      value: buildDailyListLightsSettingValue(currentValue, targetDate, next, {
        updatedAt,
        operator: user?.email ?? null
      }),
      updated_at: updatedAt
    };
    const upsertRes = await supabase.from(APP_SETTINGS_TABLE).upsert([payload as any], { onConflict: 'key' });
    if (!upsertRes.error) return;
    const updateRes = await supabase.from(APP_SETTINGS_TABLE).update(payload as any).eq('key', DAILY_LIST_LIGHTS_KEY);
    if (!updateRes.error) return;
    await supabase.from(APP_SETTINGS_TABLE).insert([payload as any]);
  };

  const loadDailyListSelectedPositionsGlobal = async (options?: { targetDateOverride?: string }) => {
    if (!supabase) return;
    const fallbackDate = toDateOnly(addDays(new Date(serverTime), 1));
    const targetDateRaw = options?.targetDateOverride ?? dailyListDateInput;
    const targetDate = isDateOnlyValue(targetDateRaw) ? targetDateRaw : fallbackDate;
    const res = await supabase
      .from(APP_SETTINGS_TABLE)
      .select('id, key, value, updated_at')
      .eq('key', DAILY_LIST_LIGHTS_KEY)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (res.error) return;

    const row = (((res.data as any[]) ?? [])[0] ?? null) as AppSettingRow | null;
    setDailyListSelectedPositions(
      row ? readDailyListLightsForDate(row.value, targetDate) : createEmptyDailyListLightFlags()
    );
  };

  const toggleDailyListSelectedPosition = (position: DailyListLightPosition) => {
    setDailyListSelectedPositions((prev) => {
      const next = {
        ...prev,
        [position]: !prev[position]
      };
      void saveDailyListSelectedPositionsGlobal(next, tomorrowDailyList.targetDate);
      return next;
    });
  };

  useEffect(() => {
    void loadDailyListSelectedPositionsGlobal({ targetDateOverride: dailyListDateInput });
  }, [user?.email, dailyListDateInput]);

  useEffect(() => {
    if (!dailyListOpen) return;
    let active = true;
    const sync = async () => {
      if (!active) return;
      await loadDailyListSelectedPositionsGlobal({ targetDateOverride: dailyListDateInput });
    };
    void sync();
    const timer = window.setInterval(() => {
      void sync();
    }, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [dailyListOpen, user?.email, offsetMs, dailyListDateInput]);

  useEffect(() => {
    if (page !== 'timecard') {
      return;
    }
    if (timecardWeekInput) {
      return;
    }
    const baseWeekStart = startOfWeekMonday(serverTime);
    setTimecardWeekInput(toDateOnly(baseWeekStart));
  }, [page, timecardWeekInput, toDateOnly(serverTime)]);

  useEffect(() => {
    if (page !== 'timecard') {
      return;
    }
    const handle = window.setTimeout(() => {
      void fetchTimecard({ reset: true, lockUi: false });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [page, timecardSearch, timecardAgency, timecardPosition, timecardMissingEmployeeOnly]);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      if (!supabase) {
        return;
      }
      const { data, error } = await supabase.rpc('now');
      if (!active) {
        return;
      }
      if (error || !data) {
        setOffsetMs(0);
        return;
      }
      const server = new Date(data as string);
      if (!Number.isNaN(server.getTime())) {
        setOffsetMs(server.getTime() - Date.now());
      }
    };
    sync();
    const timer = window.setInterval(sync, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const syncUserDisplayName = async () => {
      if (!supabase || !user?.id) {
        setUserDisplayName('');
        setUserDisplayNameInput('');
        setUserAvatarUrl('');
        setUserAvatarUrlInput('');
        setUserAvatarFileInput(null);
        setUserDisplayNamePromptOpen(false);
        return;
      }
      let res = await supabase
        .from(USER_PROFILE_TABLE)
        .select('display_name, avatar_url')
        .eq('user_id', user.id)
        .maybeSingle();
      if (res.error && isMissingAvatarUrlColumnError(String(res.error.message ?? ''))) {
        res = await supabase
          .from(USER_PROFILE_TABLE)
          .select('display_name')
          .eq('user_id', user.id)
          .maybeSingle();
      }
      if (!active) {
        return;
      }
      if (res.error) {
        const fallbackName = getFallbackProfileName();
        setStatus({ tone: 'error', message: t(`读取用户名称失败：${res.error.message}`, `Failed to load profile name: ${res.error.message}`) });
        setUserDisplayName(fallbackName);
        setUserDisplayNameInput(fallbackName);
        setUserAvatarUrl('');
        setUserAvatarUrlInput('');
        setUserAvatarFileInput(null);
        setUserDisplayNamePromptOpen(!fallbackName);
        return;
      }
      const nextName = String((res.data as any)?.display_name ?? '').trim();
      const nextAvatarUrl = String((res.data as any)?.avatar_url ?? '').trim();
      setUserDisplayName(nextName);
      setUserDisplayNameInput(nextName);
      setUserAvatarUrl(nextAvatarUrl);
      setUserAvatarUrlInput(nextAvatarUrl);
      setUserAvatarFileInput(null);
      setUserDisplayNamePromptOpen(!nextName);
    };
    void syncUserDisplayName();
    return () => {
      active = false;
    };
  }, [user?.id, lang]);

  const saveUserDisplayName = async () => {
    if (!supabase || !user?.id) {
      return;
    }
    const nextName = userDisplayNameInput.trim();
    if (!nextName) {
      setStatus({ tone: 'error', message: t('请先填写用户名。', 'Please enter your name first.') });
      return;
    }
    setUserDisplayNameSaving(true);
    try {
      let nextAvatarUrl = userAvatarUrlInput.trim();
      let avatarColumnUnavailable = false;
      if (userAvatarFileInput) {
        const objectPath = `users/${user.id}/avatar`;
        const uploadRes = await supabase.storage.from(PROFILE_AVATAR_BUCKET).upload(objectPath, userAvatarFileInput, {
          upsert: true,
          contentType: userAvatarFileInput.type,
          cacheControl: '31536000'
        });
        if (uploadRes.error) {
          const errorMessage = String(uploadRes.error.message ?? '');
          setStatus({
            tone: 'error',
            message: isMissingStorageBucketError(errorMessage)
              ? t(
                  `头像桶 ${PROFILE_AVATAR_BUCKET} 不存在，请先创建 Storage bucket。`,
                  `Avatar bucket ${PROFILE_AVATAR_BUCKET} is missing. Create the Storage bucket first.`
                )
              : t(`上传头像失败：${errorMessage}`, `Failed to upload avatar: ${errorMessage}`)
          });
          return;
        }
        const publicUrlRes = supabase.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(objectPath);
        const publicUrl = String(publicUrlRes.data.publicUrl ?? '').trim();
        if (!publicUrl) {
          setStatus({ tone: 'error', message: t('生成头像地址失败。', 'Failed to generate avatar URL.') });
          return;
        }
        nextAvatarUrl = `${publicUrl}?v=${Date.now()}`;
      }
      let upsertRes = await supabase.from(USER_PROFILE_TABLE).upsert(
        [
          {
            user_id: user.id,
            user_email: user.email ?? null,
            display_name: nextName,
            avatar_url: nextAvatarUrl || null
          }
        ] as any[],
        { onConflict: 'user_id' }
      );
      if (upsertRes.error && isMissingAvatarUrlColumnError(String(upsertRes.error.message ?? ''))) {
        avatarColumnUnavailable = true;
        upsertRes = await supabase.from(USER_PROFILE_TABLE).upsert(
          [
            {
              user_id: user.id,
              user_email: user.email ?? null,
              display_name: nextName
            }
          ] as any[],
          { onConflict: 'user_id' }
        );
      }
      if (upsertRes.error) {
        setStatus({
          tone: 'error',
          message: t(`保存用户名失败：${upsertRes.error.message}`, `Failed to save profile name: ${upsertRes.error.message}`)
        });
        return;
      }
      setUserDisplayName(nextName);
      setUserDisplayNamePromptOpen(false);
      if (avatarColumnUnavailable && nextAvatarUrl) {
        setUserAvatarFileInput(null);
        setStatus({
          tone: 'error',
          message: t(
            '名字已保存，但头像地址字段还没建。请先执行 2026-04-16_add_avatar_url_to_user_profiles.sql。',
            'Name saved, but the avatar_url column is missing. Run 2026-04-16_add_avatar_url_to_user_profiles.sql first.'
          )
        });
        return;
      }
      setUserAvatarUrl(nextAvatarUrl);
      setUserAvatarUrlInput(nextAvatarUrl);
      setUserAvatarFileInput(null);
      setStatus({ tone: 'success', message: t('资料已保存。', 'Profile saved.') });
    } finally {
      setUserDisplayNameSaving(false);
    }
  };
  const onProfileAvatarPick = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus({ tone: 'error', message: t('请选择图片文件。', 'Please choose an image file.') });
      return;
    }
    if (file.size > 1024 * 1024) {
      setStatus({ tone: 'error', message: t('头像图片请控制在 1MB 内。', 'Avatar image must be under 1MB.') });
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('read_failed'));
      reader.readAsDataURL(file);
    }).catch(() => '');
    if (!dataUrl) {
      setStatus({ tone: 'error', message: t('读取头像失败。', 'Failed to read avatar image.') });
      return;
    }
    setUserAvatarFileInput(file);
    setUserAvatarUrlInput(dataUrl);
  };

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) {
        setStatus({ tone: 'success', message: 'Auto-signed in' });
      } else {
        setStatus({ tone: 'idle', message: 'Please sign in' });
      }
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'SIGNED_OUT') {
        if (suppressNextSignedOutStatusRef.current) {
          suppressNextSignedOutStatusRef.current = false;
        } else {
          setStatus({ tone: 'idle', message: 'Signed out' });
        }
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user?.id) {
      setTodoPendingCount(0);
      return;
    }
    let active = true;
    const refreshTodoCount = async () => {
      try {
        const nextCount = await fetchTodoNavPendingCount(supabase, user.id);
        if (active) setTodoPendingCount(nextCount);
      } catch {
        if (active) setTodoPendingCount(0);
      }
    };
    void refreshTodoCount();
    if (typeof window === 'undefined') {
      return () => {
        active = false;
      };
    }
    const handler = () => {
      void refreshTodoCount();
    };
    window.addEventListener(TODO_UPDATED_EVENT, handler as EventListener);
    return () => {
      active = false;
      window.removeEventListener(TODO_UPDATED_EVENT, handler as EventListener);
    };
  }, [supabase, user?.id]);

  useEffect(() => {
    let active = true;
    const loadAdminAccessContext = async () => {
      if (!supabase || !user) {
        setAdminAccessContext(null);
        return;
      }
      try {
        const context = await fetchAdminAccessContext(supabase, user.email);
        if (!active) return;
        if (!context.is_active) {
          suppressNextSignedOutStatusRef.current = true;
          setAdminAccessContext(null);
          setStatus({ tone: 'error', message: 'Account was locked' });
          await supabase.auth.signOut();
          return;
        }
        setAdminAccessContext(context);
      } catch (error) {
        if (!active) return;
        console.error('Failed to load admin access context.', error);
        setAdminAccessContext(null);
      }
    };
    void loadAdminAccessContext();
    return () => {
      active = false;
    };
  }, [supabase, user?.id, user?.email]);

  useEffect(() => {
    if (!visibleAdminPages.includes(page)) {
      setPage(visibleAdminPages[0] ?? 'home');
    }
  }, [page, visibleAdminPages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user || !adminAccessContext) return;
    if (adminAccessContext.role !== 'agency') return;
    if (window.location.pathname.startsWith('/agency')) return;
    window.location.replace('/agency/');
  }, [adminAccessContext, user]);

  useEffect(() => {
    if (page !== 'schedule') return;
    void fetchTerminationRequests({ lockUi: false });
  }, [page, user?.id, adminAccessContext?.role]);

  useEffect(() => {
    if (page !== 'accounts') return;
    if (!accountsCanManageAdminAccess) return;
    void fetchAdminAccessAccountsAndUsers({ lockUi: false });
  }, [page, user?.id, accountsCanManageAdminAccess]);

  useEffect(() => {
    if (page !== 'permissions') return;
    if (!hasModuleAccess(adminModuleMap, 'permissions', 'view')) return;
    void fetchAdminAccessRequests({ lockUi: false, status: 'all' });
    if (accountsCanManageAdminAccess) {
      void fetchAdminAccessAccountsAndUsers({ lockUi: false });
    }
  }, [page, user?.id, accountsCanManageAdminAccess, adminModuleMap]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!supabase || page !== 'permissions') return;
    if (!hasModuleAccess(adminModuleMap, 'permissions', 'view')) return;

    let disposed = false;
    const refreshRequests = () => {
      if (disposed) return;
      void fetchAdminAccessRequests({ lockUi: false, status: 'all' });
    };
    const handleFocus = () => {
      refreshRequests();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshRequests();
      }
    };

    const timer = window.setInterval(refreshRequests, 10000);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [page, supabase, user?.id, adminModuleMap]);

  const doLogin = async () => {
    if (!supabase) {
      const message = '缺少 Supabase 配置，请检查环境变量。';
      setStatus({ tone: 'error', message });
      openLoginErrorDialog(message);
      return;
    }
    await runLocked('login', async () => {
      setStatus({ tone: 'pending', message: '登录中...' });
      const nextEmail = email.trim();
      const { error } = await supabase.auth.signInWithPassword({ email: nextEmail, password });
      if (error) {
        const message = `登录失败：${error.message}`;
        setStatus({ tone: 'error', message });
        openLoginErrorDialog(message);
        return;
      }
      const context = await fetchAdminAccessContext(supabase, nextEmail);
      if (!context.is_active) {
        suppressNextSignedOutStatusRef.current = true;
        await supabase.auth.signOut();
        const message = 'Account was locked';
        setStatus({ tone: 'error', message });
        openLoginErrorDialog(message);
        setPassword('');
        return;
      }
      setStatus({ tone: 'success', message: '登录成功' });
      setLoginErrorDialog({ open: false, title: '', message: '' });
      setPassword('');
    });
  };

  const doLogout = async () => {
    if (!supabase) {
      return;
    }
    await runLocked('logout', async () => {
      await supabase.auth.signOut();
      setStatus({ tone: 'idle', message: '已退出登录' });
    });
  };

  const fetchTerminationRequests = async (options?: { lockUi?: boolean; status?: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all' }) => {
    if (!supabase || !hasModuleAccess(adminModuleMap, 'schedule', 'view')) {
      setTerminationRequests([]);
      return [];
    }

    const statusFilter = options?.status ?? 'pending';
    const exec = async () => {
      const rows = await listEmployeeTerminationRequests(supabase, statusFilter);
      setTerminationRequests(rows);
      return rows;
    };

    if (options?.lockUi === false) {
      return exec();
    }

    let rows: TerminationRequestRecord[] = [];
    await runLocked('termination_requests', async () => {
      rows = await exec();
    });
    return rows;
  };

  const fetchAdminAccessAccountsAndUsers = async (options?: { lockUi?: boolean }) => {
    if (!supabase || !accountsCanManageAdminAccess) {
      setAdminAccessAccounts([]);
      setAdminAccessUserOptions([]);
      return [] as AdminAccessAccountRecord[];
    }

    const exec = async () => {
      const [rows, users] = await Promise.all([listAdminAccessAccounts(supabase), fetchTodoProfiles(supabase)]);
      const avatarByUserId = new Map(
        users
          .map((item) => [String(item.user_id ?? '').trim(), String(item.avatar_url ?? '').trim()] as const)
          .filter(([userId]) => Boolean(userId))
      );
      setAdminAccessAccounts(rows.map((row) => ({ ...row, avatar_url: avatarByUserId.get(row.user_id) ?? row.avatar_url ?? '' })));
      setAdminAccessUserOptions(
        users
          .map((item) => ({
            user_id: String(item.user_id ?? '').trim(),
            user_email: String(item.user_email ?? '').trim(),
            display_name: String(item.display_name ?? '').trim(),
            avatar_url: String(item.avatar_url ?? '').trim()
          }))
          .filter((item) => item.user_id)
      );
      return rows;
    };

    if (options?.lockUi === false) {
      return exec();
    }

    let rows: AdminAccessAccountRecord[] = [];
    await runLocked('admin_access_accounts', async () => {
      rows = await exec();
    });
    return rows;
  };

  const fetchAdminAccessRequests = async (options?: {
    lockUi?: boolean;
    status?: 'pending' | 'approved' | 'rejected' | 'all';
  }) => {
    if (!supabase || !hasModuleAccess(adminModuleMap, 'permissions', 'view')) {
      setAdminAccessRequests([]);
      return [];
    }

    const statusFilter = options?.status ?? 'all';
    const exec = async () => {
      const rows = await listAdminAccessRequests(supabase, statusFilter);
      setAdminAccessRequests(rows);
      return rows;
    };

    if (options?.lockUi === false) {
      return exec();
    }

    let rows: AdminAccessRequestRecord[] = [];
    await runLocked('admin_access_requests', async () => {
      rows = await exec();
    });
    return rows;
  };

  const reviewTerminationRequest = async (request: TerminationRequestRecord, action: 'approve' | 'reject') => {
    if (!supabase) {
      setStatus({ tone: 'error', message: t('缺少 Supabase 配置。', 'Missing Supabase config.') });
      return;
    }
    if (!scheduleCanReviewTermination) {
      setStatus({ tone: 'error', message: t('当前账号不能审批离职。', 'This account cannot review termination requests.') });
      return;
    }

    const ok = await askConfirm(
      action === 'approve'
        ? t(`确认离职 ${request.staff_id} 吗？`, `Approve departure for ${request.staff_id}?`)
        : t(`拒绝离职 ${request.staff_id} 吗？`, `Reject departure for ${request.staff_id}?`),
      action === 'approve' ? t('确认离职', 'Confirm Departure') : t('拒绝离职', 'Reject Departure')
    );
    if (!ok) return;

    await runLocked(`termination_${action}`, async () => {
      await reviewEmployeeTerminationRequest(supabase, request.id, action);
      setStatus({
        tone: 'success',
        message:
          action === 'approve'
            ? t(`已确认离职：${request.staff_id}`, `Departure approved: ${request.staff_id}`)
            : t(`已拒绝离职：${request.staff_id}`, `Departure rejected: ${request.staff_id}`)
      });
      await Promise.all([refreshSchedulePanel({ lockUi: false }), fetchTerminationRequests({ lockUi: false })]);
    });
  };

  const saveAdminAccessConfig = async (payload: AdminAccessSavePayload) => {
    if (!supabase) {
      setStatus({ tone: 'error', message: t('缺少 Supabase 配置。', 'Missing Supabase config.') });
      return;
    }

    await runLocked('admin_access_save', async () => {
      await saveAdminAccessAccount(supabase, payload);
      if (user?.id && payload.user_id === user.id) {
        const nextContext = await fetchAdminAccessContext(supabase, user.email);
        setAdminAccessContext(nextContext);
      }
      const refreshedRows = await fetchAdminAccessAccountsAndUsers({ lockUi: false });

      const expectedModules = new Map(
        payload.modules.map((module) => [module.module_key, module.access_level] as const)
      );
      const refreshed = refreshedRows.find((row) => row.user_id === payload.user_id) ?? null;
      const actualModules = new Map(
        (refreshed?.modules ?? []).map((module) => [module.module_key, module.access_level] as const)
      );
      const mismatchedModules: string[] = [];
      for (const [moduleKey, expectedAccess] of expectedModules.entries()) {
        const actualAccess = actualModules.get(moduleKey);
        if (actualAccess !== expectedAccess) {
          mismatchedModules.push(`${moduleKey}:${expectedAccess}->${actualAccess ?? 'missing'}`);
        }
      }

      if (
        refreshed &&
        (refreshed.role !== payload.role || refreshed.is_active !== payload.is_active || mismatchedModules.length > 0)
      ) {
        setStatus({
          tone: 'error',
          message: t(
            `保存后回读不一致：${mismatchedModules.slice(0, 3).join(', ') || '角色或启用状态被重写'}`,
            `Saved but backend returned different values: ${mismatchedModules.slice(0, 3).join(', ') || 'role/active overwritten'}`
          )
        });
        return;
      }

      setStatus({ tone: 'success', message: t('权限已保存。', 'Access saved.') });
    });
  };

  const submitAdminAccessRequest = async (payload: AdminAccessRequestCreatePayload) => {
    if (!supabase) {
      setStatus({ tone: 'error', message: t('缺少 Supabase 配置。', 'Missing Supabase config.') });
      return;
    }

    await runLocked('admin_access_request_create', async () => {
      await createAdminAccessRequest(supabase, payload);
      await fetchAdminAccessRequests({ lockUi: false, status: 'all' });
      setStatus({ tone: 'success', message: t('申请已提交。', 'Request submitted.') });
    });
  };

  const reviewAdminAccessRequestAction = async (
    request: AdminAccessRequestRecord,
    action: 'approve' | 'reject'
  ) => {
    if (!supabase) {
      setStatus({ tone: 'error', message: t('缺少 Supabase 配置。', 'Missing Supabase config.') });
      return;
    }
    if (!accountsCanManageAdminAccess) {
      setStatus({ tone: 'error', message: t('当前账号不能审批权限。', 'This account cannot review access requests.') });
      return;
    }

    const ok = await askConfirm(
      action === 'approve'
        ? t(`确认批准 ${request.requester_display_name || request.requester_user_email} 的权限申请吗？`, `Approve access request for ${request.requester_display_name || request.requester_user_email}?`)
        : t(`确认拒绝 ${request.requester_display_name || request.requester_user_email} 的权限申请吗？`, `Reject access request for ${request.requester_display_name || request.requester_user_email}?`),
      action === 'approve' ? t('批准申请', 'Approve Request') : t('拒绝申请', 'Reject Request')
    );
    if (!ok) return;

    await runLocked(`admin_access_request_${action}`, async () => {
      await reviewAdminAccessRequest(supabase, request.id, action);
      await fetchAdminAccessRequests({ lockUi: false, status: 'all' });
      await fetchAdminAccessAccountsAndUsers({ lockUi: false });
      if (user?.id && request.requester_user_id === user.id) {
        const nextContext = await fetchAdminAccessContext(supabase, user.email);
        setAdminAccessContext(nextContext);
      }
      setStatus({
        tone: 'success',
        message:
          action === 'approve'
            ? t('权限申请已批准。', 'Access request approved.')
            : t('权限申请已拒绝。', 'Access request rejected.')
      });
    });
  };

  const writeAudit = async ({
    action,
    staffId,
    target,
    payload,
    actor
  }: {
    action: string;
    staffId?: string | null;
    target?: string | null;
    payload?: any;
    actor?: string | null;
  }) => {
    const actorForAudit = String(actor ?? '').trim() || userDisplayName.trim() || user?.email || null;
    const row: AuditRow = {
      id: `local_${Date.now()}`,
      created_at: new Date(serverTime).toISOString(),
      actor: actorForAudit,
      action,
      staff_id: staffId ?? null,
      target: target ?? null,
      payload: payload ?? null
    };
    setAuditRows((prev) => [row, ...prev].slice(0, 200));
    if (
      action === 'schedule_work' ||
      action === 'schedule_fixed_work' ||
      action === 'schedule_temp_work' ||
      action === 'schedule_planned_temp_work' ||
      action === 'schedule_leave' ||
      action === 'schedule_planned_leave' ||
      action === 'schedule_temp_rest' ||
      action === 'schedule_planned_temp_rest' ||
      action === 'agency_schedule_state_set' ||
      action === 'schedule_auto_week_reset' ||
      action === 'schedule_auto_daily_activation' ||
      action === 'schedule_rest' ||
      action === 'schedule_clear' ||
      action === 'punch_manual_add' ||
      action === 'punch_manual_edit' ||
      action === 'punch_manual_delete' ||
      action === 'punch_count_verified'
    ) {
      setCellAuditRows((prev) => [row, ...prev].slice(0, 1200));
    }

    if (!supabase) return;
    try {
      const { error } = await supabase.from(AUDIT_TABLE).insert([
        {
          actor: row.actor,
          action: row.action,
          staff_id: row.staff_id,
          target: row.target,
          payload: row.payload
        }
      ]);
      if (error) {
        // keep local log even if remote fails
        setAuditError(error.message);
      }
    } catch (err: any) {
      setAuditError(String(err?.message ?? err));
    }
  };

  const getWeekAuditPayload = (weekOffset: number) => {
    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, weekOffset * 7);
    const weekEnd = addDays(weekStart, 6);
    return {
      week_offset: weekOffset,
      week_start: toDateOnly(weekStart),
      week_end: toDateOnly(weekEnd)
    };
  };

  const changeScheduleWeek = (nextOffset: number, source: string) => {
    const previousWeek = getWeekAuditPayload(scheduleWeekOffset);
    const nextWeek = getWeekAuditPayload(nextOffset);
    setScheduleWorkDayFilter(null);
    setScheduleWeekOffset(nextOffset);
    setScheduleWeekInput(nextWeek.week_start);
    void writeAudit({
      action: 'schedule_week_switch',
      target: SCHEDULE_TABLE,
      payload: {
        source,
        previous_week_offset: previousWeek.week_offset,
        previous_week_start: previousWeek.week_start,
        previous_week_end: previousWeek.week_end,
        next_week_offset: nextWeek.week_offset,
        next_week_start: nextWeek.week_start,
        next_week_end: nextWeek.week_end
      }
    });
  };

  const openScheduleDailyList = (source: string) => {
    const targetDate = toDateOnly(addDays(new Date(serverTime), 1));
    setDailyListDateInput(targetDate);
    setDailyListFilterPositions(createEmptyDailyListLightFlags());
    void loadDailyListSelectedPositionsGlobal({ targetDateOverride: targetDate });
    setDailyListOpen(true);
    void writeAudit({
      action: 'schedule_open_daily_list',
      target: SCHEDULE_TABLE,
      payload: {
        source,
        target_date: targetDate,
        schedule_week_offset: scheduleWeekOffset
      }
    });
  };

  const refreshSchedulePanelWithAudit = async (source: string) => {
    const week = getWeekAuditPayload(scheduleWeekOffset);
    setScheduleWorkDayFilter(null);
    void writeAudit({
      action: 'schedule_refresh',
      target: SCHEDULE_TABLE,
      payload: {
        source,
        week_offset: week.week_offset,
        week_start: week.week_start,
        week_end: week.week_end
      }
    });
    await refreshSchedulePanel();
  };

  const changeTimecardWeek = async (nextOffset: number, source: string) => {
    const previousWeek = getWeekAuditPayload(timecardWeekOffset);
    const nextWeek = getWeekAuditPayload(nextOffset);
    setTimecardWeekOffset(nextOffset);
    setTimecardWeekInput(nextWeek.week_start);
    void writeAudit({
      action: 'timecard_week_switch',
      target: 'timecard',
      payload: {
        source,
        previous_week_offset: previousWeek.week_offset,
        previous_week_start: previousWeek.week_start,
        previous_week_end: previousWeek.week_end,
        next_week_offset: nextWeek.week_offset,
        next_week_start: nextWeek.week_start,
        next_week_end: nextWeek.week_end
      }
    });
    await fetchTimecard({ reset: true, weekOffset: nextOffset, lockUi: false });
  };

  const refreshTimecardWithAudit = async (source: string) => {
    const week = getWeekAuditPayload(timecardWeekOffset);
    void writeAudit({
      action: 'timecard_refresh',
      target: 'timecard',
      payload: {
        source,
        week_offset: week.week_offset,
        week_start: week.week_start,
        week_end: week.week_end
      }
    });
    await recomputeTimecardAttendanceMarks();
  };

  const changeAdminPage = useCallback((nextPage: AdminPage, _source: string) => {
    if (!visibleAdminPages.includes(nextPage)) {
      return;
    }
    setPage(nextPage);
  }, [visibleAdminPages]);

  const handleNavSetPage = useCallback((nextPage: AdminPage) => changeAdminPage(nextPage, 'nav'), [changeAdminPage]);
  const handleBack = useCallback(() => {
    window.location.href = '/';
  }, []);

  const fetchAudit = async (options?: { search?: string }) => {
    if (!supabase) {
      setAuditError('缺少 Supabase 配置。');
      setAuditRows([]);
      return;
    }
    const searchValue = (options?.search ?? auditSearch).trim();

    await runLocked('audit', async () => {
      setAuditError(null);
      const auditEmployees =
        employees.length > 0
          ? employees
          : ((await fetchEmployees({ reset: true, lockUi: false, includePunchMeta: false, streamPartialState: false })) ?? []);
      const employeeNameByAuditStaffId = new Map<string, string>();
      for (const employee of auditEmployees) {
        const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
        const name = String(employee.name ?? '').trim();
        if (!staff || !name) continue;
        employeeNameByAuditStaffId.set(staff, name);
      }
      const matchedStaffIds = searchValue
        ? auditEmployees
            .filter((employee) => matchesLooseSearch(String(employee.name ?? '').trim(), searchValue))
            .map((employee) => normalizeStaffId(String(employee.staff_id ?? '').trim()))
            .filter(Boolean)
        : [];
      let q = supabase
        .from(AUDIT_TABLE)
        .select('id, created_at, actor, action, staff_id, target, payload')
        .neq('action', 'admin_page_switch')
        .order('created_at', { ascending: false })
        .limit(searchValue ? 500 : 200);
      if (searchValue) {
        const term = `%${searchValue}%`;
        q = q.or(`staff_id.ilike.${term},actor.ilike.${term},action.ilike.${term}`);
      }
      const [res, nameRes] = await Promise.all([
        q,
        matchedStaffIds.length > 0
          ? supabase
              .from(AUDIT_TABLE)
              .select('id, created_at, actor, action, staff_id, target, payload')
              .in('staff_id', matchedStaffIds as any)
              .order('created_at', { ascending: false })
              .limit(500)
          : Promise.resolve({ data: [], error: null } as any)
      ]);
      if (res.error || nameRes?.error) {
        setAuditError(res.error?.message ?? nameRes?.error?.message ?? 'Failed to load audit records.');
        return;
      }
      const byId = new Map<string, AuditRow>();
      for (const row of (((res.data as any[]) ?? []) as AuditRow[])) {
        byId.set(String(row.id ?? `${row.created_at}_${row.staff_id}_${row.action}`), row);
      }
      for (const row of (((nameRes.data as any[]) ?? []) as AuditRow[])) {
        byId.set(String(row.id ?? `${row.created_at}_${row.staff_id}_${row.action}`), row);
      }
      const rawRows = Array.from(byId.values()).sort((a, b) =>
        String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''), 'en-US')
      );
      await rememberAuditActorDisplayNames(rawRows.map((row) => row.actor));
      const nextAuditRows = rawRows
        .map((row) => ({
          ...row,
          actor_raw: (row as any).actor,
          actor: getAuditActorDisplay(row)
        }))
        .filter((row) => {
          if (!searchValue) return true;
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const employeeName = staff ? String(employeeNameByAuditStaffId.get(staff) ?? '').trim() : '';
          const haystack = [staff, employeeName, String(row.actor ?? '').trim(), String(row.action ?? '').trim(), String(row.target ?? '').trim()].join(
            ' '
          );
          return matchesLooseSearch(haystack, searchValue);
        })
        .slice(0, 200);
      setAuditRows(nextAuditRows);
    });
  };

  const formatAuditActionLabel = (actionRaw: string) => {
    const action = String(actionRaw ?? '').trim();
    if (!action) return '-';
    const labels: Record<string, string> = {
      employee_upsert: t('员工导入', 'Employee Upsert'),
      employee_update: t('员工更新', 'Employee Update'),
      employee_delete: t('员工删除', 'Employee Delete'),
      employee_upload: t('批量上传', 'Employee Upload'),
      punch_manual_add: t('补打卡', 'Punch Add'),
      punch_manual_edit: t('改打卡', 'Punch Edit'),
      punch_manual_delete: t('删打卡', 'Punch Delete'),
      punch_count_verified: t('次数核实', 'Punch Verified'),
      schedule_work: t('排班工作', 'Schedule Work'),
      schedule_fixed_work: t('固定排班', 'Fixed Shift'),
      schedule_temp_work: t('临时工作', 'Temp Work'),
      schedule_planned_temp_work: t('替补', 'Replacement'),
      schedule_leave: t('请假', 'Leave'),
      schedule_planned_leave: t('计划请假', 'Planned Leave'),
      schedule_temp_rest: t('临时排休', 'Temp Off'),
      schedule_planned_temp_rest: t('计划临时排休', 'Planned Temp Off'),
      schedule_auto_week_reset: t('自动周重置', 'Auto Weekly Reset'),
      schedule_auto_daily_activation: t('自动计划激活', 'Auto Daily Activation'),
      schedule_week_switch: t('排班切换周', 'Schedule Week Switch'),
      schedule_refresh: t('排班刷新', 'Schedule Refresh'),
      schedule_open_daily_list: t('打开明日名单', 'Open Tomorrow List'),
      admin_page_switch: t('页面切换', 'Page Switch'),
      schedule_rest: t('排班休息', 'Schedule Off'),
      schedule_clear: t('清空排班', 'Schedule Clear'),
      agency_planned_leave: t('中介计划请假', 'Agency Planned Leave'),
      agency_substitute_assign: t('中介替补安排', 'Agency Substitute'),
      agency_leave_request_create: t('中介请假申请', 'Agency Leave Request'),
      agency_leave_request_cancel: t('中介撤回请假申请', 'Agency Leave Cancel'),
      agency_schedule_state_set: t('中介排班更新', 'Agency Schedule Update'),
      agency_new_hire_create: t('中介新人需求', 'Agency New Hire Create'),
      agency_new_hire_update: t('中介新人需求更新', 'Agency New Hire Update'),
      agency_termination_request: t('中介离职申请', 'Agency Termination Request'),
      agency_termination_request_cancel: t('中介撤回离职申请', 'Agency Termination Cancel'),
      admin_access_save: t('权限更新', 'Access Updated'),
      employee_termination_approve: t('确认离职', 'Termination Approved'),
      employee_termination_cancel: t('撤回离职申请', 'Termination Request Cancelled'),
      employee_termination_reject: t('拒绝离职', 'Termination Rejected'),
      timecard_week_switch: t('打卡切换周', 'Timecard Week Switch'),
      timecard_refresh: t('打卡刷新', 'Timecard Refresh'),
      device_add: t('新增设备', 'Device Add'),
      device_update: t('更新设备', 'Device Update'),
      device_borrow: t('借出设备', 'Device Borrow'),
      device_return: t('归还设备', 'Device Return'),
      audit_undo: t('撤销日志', 'Audit Undo')
    };
    return labels[action] ?? action.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const resolveAuditStaffName = (staffIdRaw: string) => {
    const staffId = normalizeStaffId(String(staffIdRaw ?? '').trim());
    if (!staffId) return '';
    const employee = employees.find((row) => normalizeStaffId(String(row.staff_id ?? '').trim()) === staffId);
    return String(employee?.name ?? '').trim();
  };

  const formatAuditCreatedAt = (value: string | null | undefined) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return raw;
    const weekday = dt.toLocaleDateString(locale, { weekday: 'short' });
    const dateText = dt.toLocaleString(locale, { hour12: false });
    return `${weekday} ${dateText}`;
  };

  const resolveAuditBusinessDate = (row: AuditRow) => {
    const payload = ((row.payload ?? {}) as Record<string, unknown>) ?? {};
    const workDate = String(payload.work_date ?? '').trim();
    const operationalDate = String(payload.operational_date ?? '').trim();
    const formatRealDate = (dateOnly: string) => {
      const dt = new Date(`${dateOnly}T00:00:00`);
      if (!Number.isNaN(dt.getTime())) {
        const weekday = dt.toLocaleDateString(locale, { weekday: 'short' });
        return `${weekday} ${dateOnly}`;
      }
      return dateOnly;
    };

    if (/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return formatRealDate(workDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(operationalDate)) return formatRealDate(operationalDate);

    const templateDate = String(payload.template_date ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(templateDate)) {
      const templateDt = new Date(`${templateDate}T00:00:00`);
      const createdAt = new Date(String(row.created_at ?? ''));
      if (!Number.isNaN(templateDt.getTime()) && !Number.isNaN(createdAt.getTime())) {
        const diffDays = Math.round((templateDt.getTime() - SCHEDULE_TEMPLATE_WEEK_START.getTime()) / (24 * 60 * 60 * 1000));
        if (diffDays >= 0) {
          const bucketWeekOffset = Math.floor(diffDays / 7);
          const dayIndex = diffDays % 7;
          const operationalStart = new Date(createdAt);
          operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
          if (createdAt.getTime() < operationalStart.getTime()) operationalStart.setDate(operationalStart.getDate() - 1);
          const actualWeekStart = startOfWeekMonday(operationalStart);
          const actualDate = toDateOnly(addDays(actualWeekStart, bucketWeekOffset * 7 + dayIndex));
          return formatRealDate(actualDate);
        }
      }
      return '';
    }

    const action = String(row.action ?? '').trim();
    const payloadAny = payload as Record<string, any>;
    if (action === 'punch_manual_add') {
      const key = toOperationalDateFromAudit(String(payloadAny.created_at ?? ''), String(payloadAny.action ?? ''));
      if (key) return `${new Date(`${key}T00:00:00`).toLocaleDateString(locale, { weekday: 'short' })} ${key}`;
    }
    if (action === 'punch_manual_edit' || action === 'punch_manual_delete') {
      const before = (payloadAny.before ?? null) as Record<string, any> | null;
      const key = before ? toOperationalDateFromAudit(String(before.created_at ?? ''), String(before.action ?? '')) : '';
      if (key) return `${new Date(`${key}T00:00:00`).toLocaleDateString(locale, { weekday: 'short' })} ${key}`;
    }
    return '';
  };

  const fetchCellAuditLogs = async () => {
    if (!supabase) {
      setCellAuditRows([]);
      return;
    }
    const actions = [
      'schedule_work',
      'schedule_fixed_work',
      'schedule_temp_work',
      'schedule_planned_temp_work',
      'schedule_leave',
      'schedule_planned_leave',
      'schedule_temp_rest',
      'schedule_planned_temp_rest',
      'agency_schedule_state_set',
      'schedule_auto_week_reset',
      'schedule_auto_daily_activation',
      'schedule_rest',
      'schedule_clear',
      'punch_manual_add',
      'punch_manual_edit',
      'punch_manual_delete',
      'punch_count_verified'
    ];
    const res = await supabase
      .from(AUDIT_TABLE)
      .select('id, created_at, actor, action, staff_id, target, payload')
      .in('action', actions as any)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1200);
    if (res.error) {
      return;
    }
    const rawRows = (((res.data as any[]) ?? []) as AuditRow[]).slice(0, 1200);
    await rememberAuditActorDisplayNames(rawRows.map((row) => row.actor));
    const nextCellRows = rawRows.map((row) => ({
      ...row,
      actor_raw: (row as any).actor,
      actor: getAuditActorDisplay(row)
    }));
    setCellAuditRows(nextCellRows);
  };

  const fetchDevices = async ({ lockUi = true }: { lockUi?: boolean } = {}) => {
    if (!supabase) {
      setDevicesError('缺少 Supabase 配置。');
      setDevices([]);
      return;
    }
    const exec = async () => {
      setDevicesError(null);
      const res = await supabase
        .from(DEVICE_TABLE)
        .select('id, device_name, device_sn, device_type, position, active, note, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(2000);
      if (res.error) {
        setDevicesError(res.error.message);
        setDevices([]);
        return;
      }
      setDevices(((res.data as any[]) ?? []) as DeviceRow[]);
    };
    if (lockUi) {
      await runLocked('devices', exec);
    } else {
      await exec();
    }
  };

  const fetchDeviceLoans = async ({ lockUi = true, pageNumber = 0, isLoadMore = false }: { lockUi?: boolean; pageNumber?: number; isLoadMore?: boolean } = {}) => {
    if (!supabase) {
      setDeviceLoans([]);
      return;
    }
    const exec = async () => {
      // Calculate date range (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - DEVICE_LOANS_LOOKBACK_DAYS);
      const dateStr = thirtyDaysAgo.toISOString();
      
      const offset = pageNumber * DEVICE_LOANS_FETCH_LIMIT;
      const res = await supabase
        .from(DEVICE_LOANS_TABLE)
        .select('id, created_at, operator, staff_id, device_sn, action, note')
        .gte('created_at', dateStr) // Only fetch loans from last 30 days
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + DEVICE_LOANS_FETCH_LIMIT - 1); // Pagination with range
      if (res.error) {
        setDeviceLoans(isLoadMore ? deviceLoans : []);
        setDeviceLoansHasMore(false);
        return;
      }
      
      const data = ((res.data as any[]) ?? []) as DeviceLoanRow[];
      const hasMore = (data ?? []).length >= DEVICE_LOANS_FETCH_LIMIT;
      
      if (isLoadMore) {
        setDeviceLoans([...deviceLoans, ...data]);
      } else {
        setDeviceLoans(data);
      }
      setDeviceLoansPage(pageNumber);
      setDeviceLoansHasMore(hasMore);
    };
    if (lockUi) {
      await runLocked('device_loans', exec);
    } else {
      await exec();
    }
  };

  const refreshDevicePanel = async ({ lockUi = true }: { lockUi?: boolean } = {}) => {
    if (lockUi) {
      await runLocked('devices_refresh', async () => {
        setDeviceLoansPage(0); // Reset pagination
        setDeviceLoansHasMore(true);
        await fetchDevices({ lockUi: false });
        await fetchDeviceLoans({ lockUi: false, pageNumber: 0 });
      });
      return;
    }
    setDeviceLoansPage(0); // Reset pagination
    setDeviceLoansHasMore(true);
    await fetchDevices({ lockUi: false });
    await fetchDeviceLoans({ lockUi: false, pageNumber: 0 });
  };

  const onDeviceFileSelected = async (file: File | null) => {
    if (!devicesCanOperate) {
      setDeviceUploadError(t('设备模块当前为只读。', 'Devices is read-only.'));
      return;
    }
    if (!file) {
      setDeviceUploadError(null);
      return;
    }
    const name = (file.name ?? '').toLowerCase();
    if (
      name.endsWith('.csv') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      file.type === 'text/csv' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel'
    ) {
      setDeviceUploadError(null);
      return;
    }
    setDeviceUploadError(t('不支持的文件类型，请上传 CSV 或 Excel。', 'Unsupported file type. Please upload CSV or Excel.'));
  };

  const uploadDevices = async () => {
    if (!devicesCanOperate) {
      setDeviceUploadError(t('设备模块当前为只读。', 'Devices is read-only.'));
      return;
    }
    if (!supabase) {
      setDeviceUploadError(t('缺少 Supabase 配置。', 'Missing Supabase configuration.'));
      return;
    }
    const file = deviceFileInputRef.current?.files?.[0] ?? null;
    if (!file) {
      setDeviceUploadError(t('请先选择设备 Excel/CSV 文件。', 'Please choose a device Excel/CSV file first.'));
      return;
    }

    let parsedRows: Record<string, string>[] = [];
    const name = (file.name ?? '').toLowerCase();
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      const parsed = parseCsv(await file.text());
      parsedRows = parsed.rows;
    } else {
      try {
        const XLSX = await import('xlsx');
        const ab = await file.arrayBuffer();
        const workbook = XLSX.read(ab, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]) || [];
        const headerRow = (rows[0] ?? []).map((h: any) => String(h ?? '').trim());
        parsedRows = rows
          .slice(1)
          .map((r) => {
            const obj: Record<string, string> = {};
            for (let i = 0; i < headerRow.length; i += 1) {
              const key = headerRow[i] ?? '';
              obj[key] = String(r[i] ?? '').trim();
            }
            return obj;
          })
          .filter((r) => Object.values(r).some((v) => String(v).trim() !== ''));
      } catch {
        setDeviceUploadError(t('无法解析上传文件，请确保是 CSV 或 Excel。', 'Cannot parse uploaded file. Please use CSV or Excel.'));
        return;
      }
    }

    const parseActiveFlag = (raw: string) => {
      const v = String(raw ?? '').trim().toLowerCase();
      if (!v) return true;
      if (['0', 'false', 'no', 'n', 'disabled', 'disable', 'off', '停用', '否'].includes(v)) return false;
      return true;
    };

    const uniqueBySn = new Map<
      string,
      { device_name: string | null; device_sn: string; device_type: DeviceType; position: AllowedPosition | null; note: string | null; active: boolean }
    >();
    let duplicateInFileCount = 0;
    for (const r of parsedRows) {
      const canonical: Record<string, string> = {};
      for (const [rawKey, rawValue] of Object.entries(r)) {
        if (!rawKey) continue;
        const value = String(rawValue ?? '').trim();
        if (!value) continue;
        const normalized = normalizeHeaderKey(rawKey);
        const mapped = DEVICE_KEY_ALIASES[normalized] ?? normalized;
        if (!canonical[mapped]) canonical[mapped] = value;
      }

      const sn = normalizeDeviceSn(canonical.device_sn ?? '');
      if (!sn) continue;
      if (uniqueBySn.has(sn)) {
        duplicateInFileCount += 1;
        continue;
      }
      const deviceName = String(canonical.device_name ?? '').trim() || null;
      const type = normalizeDeviceType(String(canonical.device_type ?? 'PDA'));
      const positionRaw = String(canonical.position ?? '').trim();
      const position = positionRaw ? normalizeAllowedPosition(positionRaw) : '';
      const note = String(canonical.note ?? '').trim() || null;
      const active = parseActiveFlag(canonical.active ?? '');
      uniqueBySn.set(sn, {
        device_name: deviceName,
        device_sn: sn,
        device_type: type,
        position: position || null,
        note,
        active
      });
    }

    const rows = Array.from(uniqueBySn.values());
    if (rows.length === 0) {
      setDeviceUploadError(t('文件没有可用设备数据（device_sn 为空）。', 'No valid device rows found (device_sn is empty).'));
      return;
    }

    const invalidPositions = rows.filter((r) => r.position && !ALLOWED_POSITIONS.includes(r.position as any));
    if (invalidPositions.length > 0) {
      setDeviceUploadError(
        t(
          '岗位仅支持 Pick/Pack/Rebin/Preship/Transfer/FLEX TEAM。',
          'Position must be Pick/Pack/Rebin/Preship/Transfer/FLEX TEAM.'
        )
      );
      return;
    }

    await runLocked('device_upload', async () => {
      const upsertRows = async (payloadRows: any[]) =>
        supabase.from(DEVICE_TABLE).upsert(payloadRows as any[], { onConflict: 'device_sn' });

      let res = await upsertRows(rows as any[]);
      if (res.error) {
        setDeviceUploadError(t(`导入失败：${res.error.message}`, `Import failed: ${res.error.message}`));
        return;
      }
      await writeAudit({
        action: 'device_upload',
        target: DEVICE_TABLE,
        payload: {
          file_name: file.name,
          total_rows: rows.length,
          duplicate_in_file: duplicateInFileCount,
          device_type_fallback: null
        }
      });
      setDeviceUploadError(null);
      if (deviceFileInputRef.current) deviceFileInputRef.current.value = '';
      setStatus({
        tone: 'success',
        message: t(
          `设备导入成功：${rows.length} 条。`,
          `Devices imported: ${rows.length}.`
        )
      });
      await refreshDevicePanel({ lockUi: false });
    });
  };

  const toggleDeviceActive = async (row: DeviceRow) => {
    if (!devicesCanOperate) {
      setStatus({ tone: 'error', message: t('设备模块当前为只读。', 'Devices is read-only.') });
      return;
    }
    const sn = normalizeDeviceSn(String(row.device_sn ?? row.sn ?? ''));
    if (!sn || !supabase) return;
    const nextActive = !(row.active !== false);
    await runLocked('device_toggle', async () => {
      const res = await supabase.from(DEVICE_TABLE).update({ active: nextActive }).eq('device_sn', sn);
      if (res.error) {
        setStatus({ tone: 'error', message: t(`更新设备状态失败：${res.error.message}`, `Update device status failed: ${res.error.message}`) });
        return;
      }
      await writeAudit({
        action: 'device_update',
        target: DEVICE_TABLE,
        payload: { device_sn: sn, active: nextActive }
      });
      setStatus({ tone: 'success', message: nextActive ? t(`设备已启用：${sn}`, `Device enabled: ${sn}`) : t(`设备已停用：${sn}`, `Device disabled: ${sn}`) });
      await refreshDevicePanel({ lockUi: false });
    });
  };

  const fetchSchedule = async (options?: { weekOffsetOverride?: number; lockUi?: boolean }) => {
    if (!supabase) {
      setScheduleError('缺少 Supabase 配置。');
      setScheduleRows([]);
      return [] as ScheduleRow[];
    }

    const weekOffset = options?.weekOffsetOverride ?? scheduleWeekOffset;
    const lockUi = options?.lockUi ?? true;
    const startDate = getTemplateDateByDayIndex(0, weekOffset);
    const endDate = getTemplateDateByDayIndex(6, weekOffset);

    const exec = async () => {
      setScheduleError(null);
      const res = await fetchAllPagedRows<ScheduleRow>({
        pageSize: 1000,
        fetchPage: async (from, to) =>
          await supabase
            .from(SCHEDULE_TABLE)
            .select('id, staff_id, date, position, note, operator, updated_at, created_at')
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date', { ascending: false })
            .order('staff_id', { ascending: true })
            .range(from, to)
      });
      if (res.error) {
        if (!isAbortLikeError(res.error)) setScheduleError(res.error);
        setScheduleRows([]);
        return [] as ScheduleRow[];
      }
      const allRows = res.rows;

      const latestRows = pickLatestScheduleRowsByStaffDate(allRows).sort((a, b) => {
        const dateDelta = String(b.date ?? '').localeCompare(String(a.date ?? ''));
        if (dateDelta !== 0) return dateDelta;
        const staffDelta = String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''));
        if (staffDelta !== 0) return staffDelta;
        if (isScheduleRowNewer(a, b)) return -1;
        if (isScheduleRowNewer(b, a)) return 1;
        return 0;
      });

      setScheduleRows(latestRows);
      setScheduleRowsWeekOffset(weekOffset);
      return latestRows;
    };

    if (!lockUi) {
      return await exec();
    }
    let loadedRows: ScheduleRow[] = [];
    await runLocked('schedule', async () => {
      loadedRows = await exec();
    });
    return loadedRows;
  };
  
  // Save fetchSchedule reference for use in realtime callbacks
  fetchScheduleRef.current = fetchSchedule;

  const setScheduleCellState = async (
    employee: EmployeeRow,
    dayIndex: number,
    nextState: 'empty' | ScheduleBaseState,
    _targetShift: 'early' | 'late',
    workDate?: string
  ) => {
    if (!scheduleCanOperate) {
      setScheduleError(t('排班模块当前为只读。', 'Schedule is read-only.'));
      return;
    }
    if (!supabase) {
      setScheduleError('Missing Supabase configuration.');
      return;
    }
    const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
    if (!staff || !isValidStaffIdValue(staff)) {
      setScheduleError('Invalid staff id.');
      return;
    }
    const templateDate = getTemplateDateByDayIndex(dayIndex, scheduleWeekOffset);
    const targetWorkDate =
      workDate && /^\d{4}-\d{2}-\d{2}$/.test(workDate)
        ? workDate
        : toDateOnly(addDays(startOfWeekMonday(new Date(serverTime)), dayIndex));
    const existing = scheduleRows.find((row) => {
      const rowStaff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const rowDayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim(), scheduleWeekOffset);
      return rowStaff === staff && rowDayIndex === dayIndex;
    });
    const resolvedEmployeeShift =
      employeeShiftByStaffId[staff]?.shift || normalizeShiftValue(String(employee.shift ?? '')) || '';
    const resolvedScheduleShift: 'early' | 'late' = resolvedEmployeeShift === 'late' ? 'late' : 'early';
    const existingState: 'empty' | ScheduleBaseState = !existing ? 'empty' : getScheduleBaseStateFromNote(existing.note);
    if (nextState === existingState) return;
    if (nextState === 'empty' && !existing) return;

    await runLocked('schedule_toggle', async () => {
      setScheduleError(null);
      const syncAttendanceMark = async () => {
        const latestScheduleRes = await supabase
          .from(SCHEDULE_TABLE)
          .select('id, staff_id, date, note, updated_at, created_at')
          .eq('staff_id', staff)
          .eq('date', templateDate)
          .limit(10);
        if (latestScheduleRes.error) {
          setScheduleError(latestScheduleRes.error.message);
          return false;
        }
        const latestScheduleRows = pickLatestScheduleRowsByStaffDate((((latestScheduleRes.data as any[]) ?? []) as ScheduleRow[]));
        const effectiveScheduleRow = latestScheduleRows[0] ?? null;
        const effectiveState: 'empty' | ScheduleBaseState = effectiveScheduleRow
          ? getScheduleBaseStateFromNote(effectiveScheduleRow.note)
          : 'empty';

        // Only clear marks from schedule automation (source='schedule'), not manual marks
        const clearRes = await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .delete()
          .eq('staff_id', staff)
          .eq('work_date', targetWorkDate)
          .eq('source', 'schedule');
        if (clearRes.error) {
          setScheduleError(clearRes.error.message);
          return false;
        }

        const marksToWrite: Array<'absent' | 'excuse' | 'temporary_leave'> = [];
        if (effectiveState === 'leave' || effectiveState === 'planned_leave') {
          marksToWrite.push('excuse');
        } else if (effectiveState === 'temp_rest' || effectiveState === 'planned_temp_rest') {
          marksToWrite.push('temporary_leave');
        } else if (
          effectiveState === 'work' ||
          effectiveState === 'fixed_work' ||
          effectiveState === 'temp_work' ||
          effectiveState === 'planned_temp_work'
        ) {
          const workRange = getWorkDateRange(targetWorkDate);
          if (workRange) {
            const now = new Date(serverTime);
            if (workRange.end.getTime() <= now.getTime()) {
              const punchRes = await supabase
                .from('ob_punches')
                .select('id', { count: 'exact', head: true })
                .eq('staff_id', staff)
                .gte('created_at', workRange.start.toISOString())
                .lt('created_at', workRange.end.toISOString());
              if (punchRes.error) {
                setScheduleError(punchRes.error.message);
                return false;
              }
              if (Number(punchRes.count ?? 0) === 0) {
                marksToWrite.push('absent');
              }
            }
          }
        }

        if (marksToWrite.length > 0) {
          const payload = marksToWrite.map((markType) => ({
            staff_id: staff,
            work_date: targetWorkDate,
            mark_type: markType,
            source: 'schedule',
            operator: user?.email ?? null,
            payload: { state: effectiveState, template_date: templateDate, weekday: dayIndex + 1 },
            updated_at: new Date(serverTime).toISOString()
          }));
          const upsertRes = await supabase.from(ATTENDANCE_MARKS_TABLE).upsert(payload as any, {
            onConflict: 'staff_id,work_date,mark_type'
          });
          if (upsertRes.error) {
            setScheduleError(upsertRes.error.message);
            return false;
          }
        }
        return true;
      };

      // 修改本周时同步到下周；修改下周不影响本周
      const syncToNextWeek = scheduleWeekOffset === 0;
      const nextWeekTemplateDate = syncToNextWeek ? getTemplateDateByDayIndex(dayIndex, 1) : null;

      if (nextState === 'empty') {
        const delRes =
          existing?.id != null
            ? await supabase.from(SCHEDULE_TABLE).delete().eq('id', existing.id as any)
            : await supabase.from(SCHEDULE_TABLE).delete().eq('staff_id', staff).eq('date', templateDate);
        if (delRes.error) {
          setScheduleError(delRes.error.message);
          return;
        }
        if (nextWeekTemplateDate) {
          await supabase.from(SCHEDULE_TABLE).delete().eq('staff_id', staff).eq('date', nextWeekTemplateDate);
        }
        setScheduleRows((prev) =>
          prev.filter((row) => {
            const rowStaff = normalizeStaffId(String(row.staff_id ?? '').trim());
            const rowDayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim(), scheduleWeekOffset);
            return !(rowStaff === staff && rowDayIndex === dayIndex);
          })
        );
        const synced = await syncAttendanceMark();
        if (synced) {
          await fetchScheduleMonthlyAbsentDates();
        }
        void writeAudit({
          action: 'schedule_clear',
          staffId: staff,
          target: SCHEDULE_TABLE,
          payload: {
            weekday: dayIndex + 1,
            template_date: templateDate,
            removed_id: existing?.id ?? null,
            from_state: existingState,
            from_shift: existing?.shift ?? null,
            from_position: existing?.position ?? null,
            to_state: 'empty',
            to_shift: null,
            to_position: null
          }
        });
        return;
      }

      const employeePosition = String(employee.position ?? employee.Position ?? '').trim();
      const normalizedPosition =
        ALLOWED_POSITIONS.find((p) => p.toLowerCase() === employeePosition.toLowerCase()) ?? ALLOWED_POSITIONS[0];
      const payload = {
        staff_id: staff,
        date: templateDate,
        position: normalizedPosition,
        note: getScheduleNoteFromBaseState(nextState),
        operator: user?.email ?? null,
        updated_at: new Date(serverTime).toISOString()
      };
      const upsertRes = await supabase.from(SCHEDULE_TABLE).upsert([payload as any], { onConflict: 'staff_id,date' });
      if (upsertRes.error) {
        if (existing?.id != null) {
          const updateRes = await supabase.from(SCHEDULE_TABLE).update(payload as any).eq('id', existing.id as any);
          if (updateRes.error) {
            setScheduleError(updateRes.error.message);
            return;
          }
        } else {
          const insertRes = await supabase.from(SCHEDULE_TABLE).insert([payload as any]);
          if (insertRes.error) {
            setScheduleError(insertRes.error.message);
            return;
          }
        }
      }
      if (nextWeekTemplateDate) {
        const nextWeekPayload = {
          staff_id: staff,
          date: nextWeekTemplateDate,
          position: payload.position,
          note: payload.note,
          operator: payload.operator,
          updated_at: payload.updated_at
        };
        await supabase.from(SCHEDULE_TABLE).upsert([nextWeekPayload as any], { onConflict: 'staff_id,date' });
      }

      const localRow: ScheduleRow = {
        id: existing?.id ?? undefined,
        staff_id: staff,
        date: templateDate,
        position: normalizedPosition,
        shift: resolvedScheduleShift,
        note: getScheduleNoteFromBaseState(nextState),
        operator: user?.email ?? null,
        updated_at: new Date(serverTime).toISOString()
      };
      setScheduleRows((prev) => {
        let replaced = false;
        const next = prev.map((row) => {
          const rowStaff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const rowDayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim(), scheduleWeekOffset);
          if (rowStaff === staff && rowDayIndex === dayIndex) {
            replaced = true;
            return { ...row, ...localRow };
          }
          return row;
        });
        if (!replaced) next.push(localRow);
        return next;
      });
      const synced = await syncAttendanceMark();
      if (synced) {
        await fetchScheduleMonthlyAbsentDates();
      }

      void writeAudit({
        action:
          nextState === 'work'
            ? 'schedule_work'
            : nextState === 'fixed_work'
              ? 'schedule_fixed_work'
            : nextState === 'temp_work'
              ? 'schedule_temp_work'
              : nextState === 'planned_temp_work'
                ? 'schedule_planned_temp_work'
              : nextState === 'leave'
                ? 'schedule_leave'
                : nextState === 'planned_leave'
                  ? 'schedule_planned_leave'
                : nextState === 'temp_rest'
                  ? 'schedule_temp_rest'
                  : nextState === 'planned_temp_rest'
                    ? 'schedule_planned_temp_rest'
                  : 'schedule_rest',
        staffId: staff,
        target: SCHEDULE_TABLE,
        payload: {
          weekday: dayIndex + 1,
          template_date: templateDate,
          position: normalizedPosition,
          shift: resolvedEmployeeShift,
          state: nextState,
          from_state: existingState,
          from_shift: existing?.shift ?? null,
          from_position: existing?.position ?? null,
          to_state: nextState,
          to_shift: resolvedScheduleShift,
          to_position: normalizedPosition
        }
      });
    });
  };

  const scheduleWeekResetInFlightRef = useRef(false);
  const scheduleWeekResetDoneKeyRef = useRef('');
  const resetScheduleTransientStatesForWeek = async (options?: { lockUi?: boolean }) => {
    if (!scheduleCanOperate) return;
    if (!supabase) return;
    const localNow = new Date(Date.now() + offsetMs);
    let gateNow = localNow;
    const serverNowRes = await supabase.rpc('now');
    if (!serverNowRes.error && serverNowRes.data) {
      const parsed = new Date(serverNowRes.data as string);
      if (!Number.isNaN(parsed.getTime())) {
        gateNow = parsed;
      }
    }
    const thisMonday = startOfWeekMonday(gateNow);
    const weekStart = toDateOnly(thisMonday);
    const lockUi = options?.lockUi ?? true;

    const settingRes = await supabase
      .from(APP_SETTINGS_TABLE)
      .select('key, value, updated_at')
      .eq('key', SCHEDULE_WEEK_RESET_KEY)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (settingRes.error) {
      scheduleWeekResetInFlightRef.current = false;
      return;
    }

    const existing = (((settingRes.data as any[]) ?? [])[0] ?? null) as { value?: Record<string, unknown> } | null;
    const existingWeek = String(existing?.value?.week_start ?? '');
    const gate = shouldRunWeeklyScheduleReset({
      now: gateNow,
      inFlight: scheduleWeekResetInFlightRef.current,
      doneWeek: scheduleWeekResetDoneKeyRef.current,
      existingWeek
    });
    if (!gate.shouldRun) {
      if (existingWeek === weekStart) scheduleWeekResetDoneKeyRef.current = weekStart;
      return;
    }
    scheduleWeekResetInFlightRef.current = true;

    const exec = async () => {
      setScheduleError(null);
      const nowIso = gateNow.toISOString();
      const op = user?.email ?? null;
      // 临时排休 -> 工作 (note=null); 临时工作 -> 休息 (note=__rest__)
      const toWorkRes = await supabase
        .from(SCHEDULE_TABLE)
        .update({ note: null, operator: op, updated_at: nowIso } as any)
        .in('note', [SCHEDULE_TEMP_REST_NOTE] as any)
        .select('staff_id, date');
      if (toWorkRes.error) {
        setScheduleError(toWorkRes.error.message);
        return;
      }
      const toRestRes = await supabase
        .from(SCHEDULE_TABLE)
        .update({ note: SCHEDULE_REST_NOTE, operator: op, updated_at: nowIso } as any)
        .eq('note', SCHEDULE_TEMP_WORK_NOTE)
        .select('staff_id, date');
      if (toRestRes.error) {
        setScheduleError(toRestRes.error.message);
        return;
      }
      const tempRestToWorkCount = Array.isArray(toWorkRes.data) ? toWorkRes.data.length : 0;
      const tempWorkToRestCount = Array.isArray(toRestRes.data) ? toRestRes.data.length : 0;

      const payload = {
        key: SCHEDULE_WEEK_RESET_KEY,
        value: {
          week_start: weekStart,
          updated_at: nowIso,
          operator: user?.email ?? null
        },
        updated_at: nowIso
      };
      const upsertRes = await supabase.from(APP_SETTINGS_TABLE).upsert([payload as any], { onConflict: 'key' });
      if (upsertRes.error) {
        const updateRes = await supabase.from(APP_SETTINGS_TABLE).update(payload as any).eq('key', SCHEDULE_WEEK_RESET_KEY);
        if (updateRes.error) {
          const insertRes = await supabase.from(APP_SETTINGS_TABLE).insert([payload as any]);
          if (insertRes.error) {
            setScheduleError(insertRes.error.message);
            return;
          }
        }
      }

      setScheduleRows((prev) =>
        prev.map((row) => {
          const nextNote = normalizeScheduleNoteForWeeklyReset(
            String(row.note ?? '').trim() || null,
            SCHEDULE_REST_NOTE,
            SCHEDULE_TEMP_WORK_NOTE,
            SCHEDULE_TEMP_REST_NOTE
          );
          return nextNote === row.note ? row : { ...row, note: nextNote };
        })
      );
      await writeAudit({
        action: 'schedule_auto_week_reset',
        target: SCHEDULE_TABLE,
        payload: {
          week_start: weekStart,
          temp_rest_to_work_count: tempRestToWorkCount,
          temp_work_to_rest_count: tempWorkToRestCount
        }
      });
      scheduleWeekResetDoneKeyRef.current = weekStart;
    };

    try {
      if (!lockUi) {
        await exec();
        return;
      }
      await runLocked('schedule_week_reset', exec);
    } finally {
      scheduleWeekResetInFlightRef.current = false;
    }
  };

  const scheduleDailyPlanActivationInFlightRef = useRef(false);
  const scheduleDailyPlanActivationDoneDateRef = useRef('');
  const activatePlannedScheduleStatesForToday = async (options?: { lockUi?: boolean }) => {
    if (!scheduleCanOperate) return;
    if (!supabase) return;
    const now = new Date(Date.now() + offsetMs);
    const dateKey = toDateOnly(now);
    const operationalDayIndex = (() => {
      const operationalStart = new Date(now);
      operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
      if (now.getTime() < operationalStart.getTime()) operationalStart.setDate(operationalStart.getDate() - 1);
      return (operationalStart.getDay() + 6) % 7;
    })();
    const currentWeekStartTemplateDateKey = getTemplateDateByDayIndex(0, 0);
    const activationTemplateDateKey = getTemplateDateByDayIndex(operationalDayIndex, 0);
    const lockUi = options?.lockUi ?? true;

    const markerRes = await supabase
      .from(APP_SETTINGS_TABLE)
      .select('key, value, updated_at')
      .eq('key', SCHEDULE_DAILY_PLAN_ACTIVATION_KEY)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (markerRes.error) {
      scheduleDailyPlanActivationInFlightRef.current = false;
      return;
    }

    const existing = (((markerRes.data as any[]) ?? [])[0] ?? null) as { value?: Record<string, unknown> } | null;
    const existingDate = String(existing?.value?.date ?? '');
    const existingStatus = String(existing?.value?.status ?? '').trim();
    const gate = shouldActivateDailyPlannedStates({
      now,
      inFlight: scheduleDailyPlanActivationInFlightRef.current,
      doneDate: scheduleDailyPlanActivationDoneDateRef.current,
      existingDate: existingStatus === 'done' ? existingDate : '',
      triggerHour: 6
    });
    if (!gate.shouldRun) {
      if (existingStatus === 'done' && existingDate === dateKey) scheduleDailyPlanActivationDoneDateRef.current = dateKey;
      return;
    }
    scheduleDailyPlanActivationInFlightRef.current = true;

    const exec = async () => {
      setScheduleError(null);
      const nowIso = new Date(serverTime).toISOString();
      const op = 'system';
      const lockToken = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const lockPayload = {
        key: SCHEDULE_DAILY_PLAN_ACTIVATION_KEY,
        value: {
          date: dateKey,
          status: 'running',
          lock_token: lockToken,
          updated_at: nowIso,
          operator: op
        },
        updated_at: nowIso
      };
      const lockRes = await supabase.from(APP_SETTINGS_TABLE).upsert([lockPayload as any], { onConflict: 'key' });
      if (lockRes.error) {
        setScheduleError(lockRes.error.message);
        return;
      }

      const lockCheckRes = await supabase
        .from(APP_SETTINGS_TABLE)
        .select('value')
        .eq('key', SCHEDULE_DAILY_PLAN_ACTIVATION_KEY)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (lockCheckRes.error) {
        setScheduleError(lockCheckRes.error.message);
        return;
      }
      const lockRow = (((lockCheckRes.data as any[]) ?? [])[0] ?? null) as { value?: Record<string, unknown> } | null;
      const lockValue = (lockRow?.value ?? {}) as Record<string, unknown>;
      if (
        String(lockValue.date ?? '') !== dateKey ||
        String(lockValue.status ?? '') !== 'running' ||
        String(lockValue.lock_token ?? '') !== lockToken
      ) {
        return;
      }

      const planRowsRes = await supabase
        .from(SCHEDULE_TABLE)
        .select('staff_id, date, position, note, operator')
        .gte('date', currentWeekStartTemplateDateKey)
        .lte('date', activationTemplateDateKey)
        .in('note', [SCHEDULE_PLANNED_TEMP_WORK_NOTE, SCHEDULE_PLANNED_LEAVE_NOTE, SCHEDULE_PLANNED_TEMP_REST_NOTE] as any);
      if (planRowsRes.error) {
        setScheduleError(planRowsRes.error.message);
        return;
      }

      const rows = (((planRowsRes.data as any[]) ?? []) as Array<{
        staff_id?: string;
        date?: string;
        position?: string | null;
        note?: string | null;
        operator?: string | null;
      }>);
      if (rows.length > 0) {
        const payload = buildDailyPlannedActivationUpserts(
          rows,
          activationTemplateDateKey,
          currentWeekStartTemplateDateKey,
          nowIso,
          SCHEDULE_TEMP_WORK_NOTE,
          SCHEDULE_LEAVE_NOTE,
          SCHEDULE_TEMP_REST_NOTE,
          SCHEDULE_PLANNED_TEMP_WORK_NOTE,
          SCHEDULE_PLANNED_LEAVE_NOTE,
          SCHEDULE_PLANNED_TEMP_REST_NOTE
        ).map((row) => ({
          ...row,
          staff_id: normalizeStaffId(row.staff_id),
          operator: op
        }));
        const employeeNameByStaffId = new Map(
          employees.map((employee) => [normalizeStaffId(String(employee.staff_id ?? '').trim()), String(employee.name ?? '').trim()] as const)
        );
        const activatedEntries = payload.map((entry) => {
          const source = rows.find(
            (row) =>
              normalizeStaffId(String(row.staff_id ?? '').trim()) === entry.staff_id && String(row.date ?? '').trim() === String(entry.date ?? '').trim()
          );
          return {
            staff_id: entry.staff_id,
            staff_name: employeeNameByStaffId.get(entry.staff_id) ?? '',
            date: String(entry.date ?? '').trim(),
            position: String(entry.position ?? '').trim(),
            from_note: source?.note ?? null,
            to_note: entry.note ?? null
          };
        });
        const upsertRes = await supabase.from(SCHEDULE_TABLE).upsert(payload as any[], { onConflict: 'staff_id,date' });
        if (upsertRes.error) {
          setScheduleError(upsertRes.error.message);
          return;
        }
        await writeAudit({
          action: 'schedule_auto_daily_activation',
          target: SCHEDULE_TABLE,
          actor: op,
          payload: {
            date: dateKey,
            activated_count: payload.length,
            activated_entries: activatedEntries
          }
        });
      }

      const markerPayload = {
        key: SCHEDULE_DAILY_PLAN_ACTIVATION_KEY,
        value: {
          date: dateKey,
          status: 'done',
          lock_token: lockToken,
          updated_at: new Date(serverTime).toISOString(),
          operator: op
        },
        updated_at: new Date(serverTime).toISOString()
      };
      const markerUpsertRes = await supabase.from(APP_SETTINGS_TABLE).upsert([markerPayload as any], { onConflict: 'key' });
      if (markerUpsertRes.error) {
        const updateRes = await supabase.from(APP_SETTINGS_TABLE).update(markerPayload as any).eq('key', SCHEDULE_DAILY_PLAN_ACTIVATION_KEY);
        if (updateRes.error) {
          const insertRes = await supabase.from(APP_SETTINGS_TABLE).insert([markerPayload as any]);
          if (insertRes.error) {
            setScheduleError(insertRes.error.message);
            return;
          }
        }
      }

      if (rows.length > 0) {
        setScheduleRows((prev) =>
          prev.map((row) => {
            const rowDate = String(row.date ?? '').trim();
            if (!rowDate || rowDate < currentWeekStartTemplateDateKey || rowDate > activationTemplateDateKey) return row;
            const nextNote = activatePlannedScheduleNote(
              row.note ?? null,
              SCHEDULE_TEMP_WORK_NOTE,
              SCHEDULE_LEAVE_NOTE,
              SCHEDULE_TEMP_REST_NOTE,
              SCHEDULE_PLANNED_TEMP_WORK_NOTE,
              SCHEDULE_PLANNED_LEAVE_NOTE,
              SCHEDULE_PLANNED_TEMP_REST_NOTE
            );
            return nextNote === row.note ? row : { ...row, note: nextNote, operator: op, updated_at: nowIso };
          })
        );
      }
      scheduleDailyPlanActivationDoneDateRef.current = dateKey;
    };

    try {
      if (!lockUi) {
        await exec();
        return;
      }
      await runLocked('schedule_daily_plan_activation', exec);
    } finally {
      scheduleDailyPlanActivationInFlightRef.current = false;
    }
  };

  const refreshSchedulePanel = async (options?: { lockUi?: boolean }) => {
    const lockUi = options?.lockUi ?? true;
    const exec = async () => {
      await resetScheduleTransientStatesForWeek({ lockUi: false });
      await activatePlannedScheduleStatesForToday({ lockUi: false });
      const latestScheduleRows = await fetchSchedule({ lockUi: false });
      const latestEmployees = await fetchEmployees({
        reset: true,
        search: '',
        agency: '',
        position: '',
        labels: [],
        lockUi: false,
        includePunchMeta: false,
        streamPartialState: false
      });
      await Promise.all([
        fetchSchedulePunchPresence({ employeesOverride: latestEmployees }),
        fetchScheduleUph({ employeesOverride: latestEmployees }),
        fetchScheduleMistakeCounts({ employeesOverride: latestEmployees }),
        fetchScheduleMonthlyAbsentDates({ employeesOverride: latestEmployees, monthDateOverride: scheduleMonthAnchor }),
        fetchTerminationRequests({ lockUi: false }),
        fetchScheduleLateMarks({
          employeesOverride: latestEmployees,
          scheduleRowsOverride: latestScheduleRows
        })
      ]);
    };
    if (!lockUi) {
      await exec();
      return;
    }
    await runLocked('schedule_refresh', exec);
  };

  const refreshHomePanel = async (options?: { lockUi?: boolean }) => {
    const lockUi = options?.lockUi ?? true;
    await fetchSchedule({ weekOffsetOverride: 0, lockUi: false });
    const latestEmployees = await fetchEmployees({
      reset: true,
      search: '',
      agency: '',
      position: '',
      labels: [],
      lockUi,
      includePunchMeta: false,
      streamPartialState: false
    });
    await fetchRealtimeAttendance();
    // Home dashboard should use current week punch presence, independent of Schedule page week navigation.
    await fetchSchedulePunchPresence({
      employeesOverride: latestEmployees,
      weekOffsetOverride: 0,
      mode: 'operational_day',
      keepPreviousWhileLoading: true
    });
  };

  const scheduleWeekRolloverInFlightRef = useRef(false);
  const scheduleWeekRolloverDoneKeyRef = useRef('');
  const maybeRolloverScheduleWeek = async () => {
    if (!supabase) return;
    const now = new Date(Date.now() + offsetMs);
    const thisMonday = startOfWeekMonday(now);
    try {
      const markerRes = await supabase
        .from(APP_SETTINGS_TABLE)
        .select('value')
        .eq('key', SCHEDULE_WEEK_ROLLOVER_KEY)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (markerRes.error) return;
      const marker = (((markerRes.data as any[]) ?? [])[0] ?? null) as { value?: Record<string, unknown> } | null;
      const doneWeek = String(marker?.value?.week_start ?? '').trim();
      const weekKey = toDateOnly(thisMonday);
      const gate = shouldRunWeeklyScheduleRollover({
        now,
        inFlight: scheduleWeekRolloverInFlightRef.current,
        doneWeek: scheduleWeekRolloverDoneKeyRef.current,
        existingWeek: doneWeek
      });
      if (!gate.shouldRun) {
        if (doneWeek === weekKey) scheduleWeekRolloverDoneKeyRef.current = weekKey;
        return;
      }
      scheduleWeekRolloverInFlightRef.current = true;

      const nextStart = getTemplateDateByDayIndex(0, 1);
      const nextEnd = getTemplateDateByDayIndex(6, 1);
      const nextWeekRes = await supabase
        .from(SCHEDULE_TABLE)
        .select('staff_id, date, position, note, operator, updated_at')
        .gte('date', nextStart)
        .lte('date', nextEnd);
      if (nextWeekRes.error) return;
      const nextRows = (((nextWeekRes.data as any[]) ?? []) as any[]);
      if (nextRows.length === 0) return;

      const nowIso = now.toISOString();
      const migrated = buildWeeklyRolloverUpserts(nextRows, nowIso).map((row) => ({
        ...row,
        staff_id: normalizeStaffId(row.staff_id)
      }));
      if (migrated.length > 0) {
        const upsertRes = await supabase.from(SCHEDULE_TABLE).upsert(migrated as any[], { onConflict: 'staff_id,date' });
        if (upsertRes.error) return;
      }

      // 不删除下周数据，仅复制到本周，下周保持不变，实现永久循环
      // Do NOT delete next week; only copy to this week; next week stays for permanent cycle

      await supabase.from(APP_SETTINGS_TABLE).upsert(
        [
          {
            key: SCHEDULE_WEEK_ROLLOVER_KEY,
            value: { week_start: weekKey, rolled_at: now.toISOString() },
            operator: user?.email ?? null,
            updated_at: now.toISOString()
          }
        ] as any[],
        { onConflict: 'key' }
      );
      scheduleWeekRolloverDoneKeyRef.current = weekKey;
      await fetchSchedule();
    } finally {
      scheduleWeekRolloverInFlightRef.current = false;
    }
  };

  const openScheduleStatePicker = (
    cellKey: string,
    employee: EmployeeRow,
    dayIndex: number,
    workDate: string,
    targetShift: 'early' | 'late',
    currentState: ScheduleDisplayState,
    anchorRect: DOMRect
  ) => {
    if (schedulePicker.open && schedulePicker.cellKey === cellKey) {
      setSchedulePickerShowMore(false);
      setSchedulePicker((prev) => ({ ...prev, open: false, employee: null, cellKey: '' }));
      return;
    }

    const visual = typeof window !== 'undefined' ? window.visualViewport : null;
    const viewportLeft = visual ? visual.offsetLeft : 0;
    const viewportTop = visual ? visual.offsetTop : 0;
    const viewportWidth = visual ? visual.width : window.innerWidth;
    const viewportHeight = visual ? visual.height : window.innerHeight;
    const halfWidth = SCHEDULE_PICKER_WIDTH / 2;
    const minLeft = viewportLeft + halfWidth + SCHEDULE_PICKER_MARGIN;
    const maxLeft = viewportLeft + viewportWidth - halfWidth - SCHEDULE_PICKER_MARGIN;
    const preferredLeft = anchorRect.left + anchorRect.width / 2;
    const anchorLeft = clamp(preferredLeft, minLeft, Math.max(minLeft, maxLeft));

    const minTop = viewportTop + SCHEDULE_PICKER_MARGIN;
    const maxTop = viewportTop + viewportHeight - SCHEDULE_PICKER_HEIGHT_ESTIMATE - SCHEDULE_PICKER_MARGIN;
    const belowTop = anchorRect.bottom + SCHEDULE_PICKER_GAP;
    const aboveTop = anchorRect.top - SCHEDULE_PICKER_HEIGHT_ESTIMATE - SCHEDULE_PICKER_GAP;
    const preferredTop = belowTop <= maxTop ? belowTop : aboveTop;
    const anchorTop = clamp(preferredTop, minTop, Math.max(minTop, maxTop));

    setSchedulePicker({
      open: true,
      cellKey,
      employee,
      dayIndex,
      workDate,
      targetShift,
      currentState,
      anchorLeft,
      anchorTop
    });
    setSchedulePickerShowMore(false);
  };

  const schedulePickerMode = useMemo(() => {
    const workDate = String(schedulePicker.workDate ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return 'current';
    const now = new Date(serverTime);
    const operationalStart = new Date(now);
    operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
    if (now.getTime() < operationalStart.getTime()) operationalStart.setDate(operationalStart.getDate() - 1);
    const operationalDate = toDateOnly(operationalStart);
    if (workDate > operationalDate) return 'future';
    return 'current';
  }, [schedulePicker.workDate, serverTime]);

  const schedulePickerOptions = useMemo(() => {
    const base = [
      {
        key: 'work',
        labelZh: '工作',
        labelEn: 'Work',
        mode: 'all'
      },
      {
        key: 'fixed_work',
        labelZh: '固定排班',
        labelEn: 'Fixed Shift',
        mode: 'all'
      },
      { key: 'temp_work', labelZh: '临时工作', labelEn: 'Tem Work', mode: 'current' },
      { key: 'planned_temp_work', labelZh: '替补', labelEn: 'Replacement', mode: 'future' },
      { key: 'leave', labelZh: '请假', labelEn: 'Excuse', mode: 'current' },
      { key: 'planned_leave', labelZh: '计划请假', labelEn: 'Planned Leave', mode: 'future' },
      { key: 'temp_rest', labelZh: '临时排休', labelEn: 'Tem Off', mode: 'current' },
      { key: 'planned_temp_rest', labelZh: '计划临时排休', labelEn: 'Planned Tem Off', mode: 'future' },
      { key: 'rest', labelZh: '休息', labelEn: 'Off', mode: 'all' }
    ] as Array<{ key: ScheduleBaseState; labelZh: string; labelEn: string; mode: 'all' | 'current' | 'future' }>;

    const preferred = base.filter((item) => item.mode === 'all' || item.mode === schedulePickerMode);
    const secondary = base.filter((item) => item.mode !== 'all' && item.mode !== schedulePickerMode);
    return [...preferred, ...secondary];
  }, [schedulePickerMode]);
  const schedulePickerSecondaryOptions = useMemo(
    () => schedulePickerOptions.filter((item) => item.mode !== 'all' && item.mode !== schedulePickerMode),
    [schedulePickerOptions, schedulePickerMode]
  );
  const schedulePickerVisibleOptions = useMemo(() => {
    if (schedulePickerShowMore) return schedulePickerOptions;
    const primary = schedulePickerOptions.filter((item) => item.mode === 'all' || item.mode === schedulePickerMode);
    const currentSecondary = schedulePickerOptions.find((item) => item.key === schedulePicker.currentState && !primary.some((p) => p.key === item.key));
    return currentSecondary ? [...primary, currentSecondary] : primary;
  }, [schedulePicker.currentState, schedulePickerOptions, schedulePickerMode, schedulePickerShowMore]);

  useEffect(() => {
    if (!schedulePicker.open) {
      setSchedulePickerShowMore(false);
    }
  }, [schedulePicker.open]);
  useEffect(() => {
    if (!schedulePicker.open) return;
    const onDocumentClickCapture = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-schedule-popover="true"]')) return;
      if (target.closest('[data-schedule-trigger="true"]')) return;
      setSchedulePickerShowMore(false);
      setSchedulePicker((prev) => ({ ...prev, open: false, employee: null, cellKey: '' }));
    };
    document.addEventListener('click', onDocumentClickCapture, true);
    return () => document.removeEventListener('click', onDocumentClickCapture, true);
  }, [schedulePicker.open]);

  useEffect(() => {
    if (!schedulePicker.open) return;
    const close = () => setSchedulePicker((prev) => ({ ...prev, open: false, employee: null, cellKey: '' }));
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [schedulePicker.open]);

  useEffect(() => {
    if (page !== 'schedule') return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      const posRoot = schedulePositionDetailsRef.current;
      const labelRoot = scheduleLabelDetailsRef.current;
      if (posRoot?.open && target && !posRoot.contains(target)) posRoot.open = false;
      if (labelRoot?.open && target && !labelRoot.contains(target)) labelRoot.open = false;
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [page]);

  const fetchSchedulePunchPresence = async (options?: {
    employeesOverride?: EmployeeRow[] | null;
    weekOffsetOverride?: number;
    mode?: 'week' | 'operational_day';
    keepPreviousWhileLoading?: boolean;
  }) => {
    const requestId = schedulePunchPresenceRequestRef.current + 1;
    schedulePunchPresenceRequestRef.current = requestId;
    const isStale = () => requestId !== schedulePunchPresenceRequestRef.current;
    if (!supabase) {
      if (!isStale()) {
        setSchedulePunchPresenceKeys(new Set());
        setScheduleFirstInByStaffDayKey({});
        setHomePunchesByStaffId({});
        setSchedulePunchPresenceReady(true);
        setSchedulePunchPresenceWeekOffset(null);
      }
      return;
    }
    const keepPreviousWhileLoading = options?.keepPreviousWhileLoading === true;
    if (!keepPreviousWhileLoading && !isStale()) {
      setSchedulePunchPresenceReady(false);
      setSchedulePunchPresenceWeekOffset(null);
    }

    const sourceEmployees = options?.employeesOverride ?? employees;
    const staffSet = new Set(
      sourceEmployees
        .map((e) => normalizeStaffId(String(e.staff_id ?? '').trim()))
        .filter((staff): staff is string => Boolean(staff))
    );
    if (staffSet.size === 0) {
      if (!isStale()) {
        setSchedulePunchPresenceKeys(new Set());
        setScheduleFirstInByStaffDayKey({});
        setHomePunchesByStaffId({});
        setSchedulePunchPresenceReady(true);
        setSchedulePunchPresenceWeekOffset(options?.weekOffsetOverride ?? scheduleWeekOffset);
      }
      return;
    }

    const mode = options?.mode ?? 'week';
    const dayMs = 24 * 60 * 60 * 1000;
    const found = new Set<string>();
    const firstInByDayKey: Record<string, string> = {};
    const operationalPunchesByStaffId: Record<string, Array<{ action: 'IN' | 'OUT'; created_at: string }>> = {};
    const staffBatches = chunk(Array.from(staffSet), 120);

    if (mode === 'operational_day') {
      const now = new Date(serverTime);
      const operationalStart = new Date(now);
      operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
      if (now.getTime() < operationalStart.getTime()) {
        operationalStart.setDate(operationalStart.getDate() - 1);
      }
      const dayIndex = (operationalStart.getDay() + 6) % 7;

      for (const batch of staffBatches) {
        const res = await fetchAllPagedRows<any>({
          pageSize: 1000,
          shouldStop: isStale,
          fetchPage: async (from, to) =>
            await supabase
              .from('ob_punches')
              .select('staff_id, action, created_at')
              .in('staff_id', batch)
              .gte('created_at', operationalStart.toISOString())
              .lte('created_at', now.toISOString())
              .order('created_at', { ascending: true })
              .range(from, to)
        });

        if (res.error) {
          if (!isStale()) {
            if (!keepPreviousWhileLoading) {
              setSchedulePunchPresenceKeys(new Set());
              setScheduleFirstInByStaffDayKey({});
              setHomePunchesByStaffId({});
              setSchedulePunchPresenceReady(false);
              setSchedulePunchPresenceWeekOffset(null);
            }
          }
          return;
        }

        for (const row of res.rows) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          if (!staff || !staffSet.has(staff)) continue;
          const at = new Date(String((row as any).created_at ?? ''));
          if (Number.isNaN(at.getTime())) continue;
          const action = String((row as any).action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
          // Keep the home dashboard consistent with its visible punch list:
          // exact-cutoff OUT events are hidden from display, so they should not
          // independently make someone count as having punched for the day.
          if (isExactOperationalCutoffOut(at.toISOString(), action)) continue;
          found.add(`${staff}__${dayIndex}`);
          const list = operationalPunchesByStaffId[staff] ?? [];
          list.push({ action, created_at: at.toISOString() });
          operationalPunchesByStaffId[staff] = list;
          if (action === 'IN') {
            const firstInKey = `${staff}__${dayIndex}`;
            const prev = firstInByDayKey[firstInKey];
            if (!prev || at.getTime() < new Date(prev).getTime()) {
              firstInByDayKey[firstInKey] = at.toISOString();
            }
          }
        }
      }

      for (const staff of Object.keys(operationalPunchesByStaffId)) {
        operationalPunchesByStaffId[staff] = operationalPunchesByStaffId[staff].sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      }

      if (!isStale()) {
        setSchedulePunchPresenceKeys(found);
        setScheduleFirstInByStaffDayKey(firstInByDayKey);
        setHomePunchesByStaffId(operationalPunchesByStaffId);
        setSchedulePunchPresenceReady(true);
        setSchedulePunchPresenceWeekOffset(null);
      }
      return;
    }

    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekOffset = options?.weekOffsetOverride ?? scheduleWeekOffset;
    const weekStart = addDays(baseWeekStart, weekOffset * 7);
    const { start, end } = getDayRange(weekStart, 0, 7);
    const day0StartMs = start.getTime();

    for (const batch of staffBatches) {
      const res = await fetchAllPagedRows<any>({
        pageSize: 1000,
        shouldStop: isStale,
        fetchPage: async (from, to) =>
          await supabase
            .from('ob_punches')
            .select('staff_id, action, created_at')
            .in('staff_id', batch)
            .gte('created_at', start.toISOString())
            .lt('created_at', end.toISOString())
            .order('created_at', { ascending: true })
            .range(from, to)
      });

      if (res.error) {
        if (!isStale()) {
          if (!keepPreviousWhileLoading) {
            setSchedulePunchPresenceKeys(new Set());
            setScheduleFirstInByStaffDayKey({});
            setSchedulePunchPresenceReady(false);
            setSchedulePunchPresenceWeekOffset(null);
          }
        }
        return;
      }

      for (const row of res.rows) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (!staff || !staffSet.has(staff)) continue;
        const at = new Date(String(row.created_at ?? ''));
        if (Number.isNaN(at.getTime())) continue;
        const action = String((row as any).action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
        const dayIndex = Math.floor((getOperationalBucketTimeMs(at, action) - day0StartMs) / dayMs);
        if (dayIndex < 0 || dayIndex > 6) continue;
        found.add(`${staff}__${dayIndex}`);
        if (action === 'IN') {
          const firstInKey = `${staff}__${dayIndex}`;
          const prev = firstInByDayKey[firstInKey];
          if (!prev || at.getTime() < new Date(prev).getTime()) {
            firstInByDayKey[firstInKey] = at.toISOString();
          }
        }
      }
    }

    if (!isStale()) {
      setSchedulePunchPresenceKeys(found);
      setScheduleFirstInByStaffDayKey(firstInByDayKey);
      setSchedulePunchPresenceReady(true);
      setSchedulePunchPresenceWeekOffset(weekOffset);
    }
  };

  const fetchScheduleUph = async (options?: { employeesOverride?: EmployeeRow[] | null }) => {
    const requestId = scheduleUphRequestRef.current + 1;
    scheduleUphRequestRef.current = requestId;
    const employeesForUph = options?.employeesOverride ?? employees;

    const positionToStage = (positionRaw: string) => {
      const position = normalizePositionKey(positionRaw);
      if (position === 'Pick') return 'picking' as const;
      if (position === 'Pack') return 'packing' as const;
      if (position === 'Rebin') return 'sorting' as const;
      return null;
    };

    const latestEmployeeByStaff = new Map<string, EmployeeRow>();
    const toMs = (value: unknown) => {
      const n = Date.parse(String(value ?? '').trim());
      return Number.isFinite(n) ? n : 0;
    };
    for (const employee of employeesForUph) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      const prev = latestEmployeeByStaff.get(staff);
      if (!prev) {
        latestEmployeeByStaff.set(staff, employee);
        continue;
      }
      const prevMs = Math.max(toMs((prev as any).updated_at), toMs((prev as any).created_at));
      const curMs = Math.max(toMs((employee as any).updated_at), toMs((employee as any).created_at));
      if (curMs > prevMs) {
        latestEmployeeByStaff.set(staff, employee);
        continue;
      }
      if (curMs < prevMs) continue;
      const prevId = Number((prev as any).id ?? 0);
      const curId = Number((employee as any).id ?? 0);
      if (Number.isFinite(curId) && Number.isFinite(prevId) && curId > prevId) {
        latestEmployeeByStaff.set(staff, employee);
      }
    }

    const stageByStaff = new Map<string, 'picking' | 'sorting' | 'packing'>();
    const stageEmployees = new Map<'picking' | 'sorting' | 'packing', Map<string, string[]>>();
    for (const employee of latestEmployeeByStaff.values()) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      const workAccount = String(employee.work_account ?? employee.WorkAccount ?? '').trim();
      const stage = positionToStage(String(employee.position ?? employee.Position ?? '').trim());
      if (!staff || !stage) continue;
      stageByStaff.set(staff, stage);
      const key = normalizeWorkAccountKey(workAccount);
      if (!key) continue;
      if (!stageEmployees.has(stage)) stageEmployees.set(stage, new Map<string, string[]>());
      const byKey = stageEmployees.get(stage)!;
      const list = byKey.get(key) ?? [];
      if (!list.includes(staff)) list.push(staff);
      byKey.set(key, list);
    }

    // Include temporary account usage within UPH window, so temp account UPH can be attributed back to employees.
    if (supabase && stageByStaff.size > 0) {
      const uphWindowStart = new Date(serverTime);
      uphWindowStart.setHours(0, 0, 0, 0);
      uphWindowStart.setDate(uphWindowStart.getDate() - (SCHEDULE_UPH_DAYS - 1));
      const uphWindowEnd = new Date(serverTime);
      uphWindowEnd.setHours(0, 0, 0, 0);
      uphWindowEnd.setDate(uphWindowEnd.getDate() + 1);
      const staffIds = Array.from(stageByStaff.keys());
      for (const batch of chunk(staffIds, 200)) {
        const assignmentsRes = await supabase
          .from(TEMP_ACCOUNT_ASSIGNMENT_TABLE)
          .select('staff_id, work_account, created_at')
          .in('staff_id', batch as any[])
          .gte('created_at', uphWindowStart.toISOString())
          .lt('created_at', uphWindowEnd.toISOString())
          .order('created_at', { ascending: false })
          .limit(5000);
        if (assignmentsRes.error) {
          continue;
        }
        const assignmentRows =
          (assignmentsRes.data as Array<{ staff_id?: string | null; work_account?: string | null }> | null) ?? [];
        for (const row of assignmentRows) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const stage = staff ? stageByStaff.get(staff) : null;
          const key = normalizeWorkAccountKey(String(row.work_account ?? '').trim());
          if (!staff || !stage || !key) continue;
          if (!stageEmployees.has(stage)) stageEmployees.set(stage, new Map<string, string[]>());
          const byKey = stageEmployees.get(stage)!;
          const list = byKey.get(key) ?? [];
          if (!list.includes(staff)) list.push(staff);
          byKey.set(key, list);
        }
      }
    }

    if (stageEmployees.size === 0 || !obupSupabase) {
      if (requestId === scheduleUphRequestRef.current) {
        setScheduleUphByStaffId({});
      }
      return;
    }

    const stages = Array.from(stageEmployees.keys());
    const endKey = toDateOnly(serverTime);
    const startKey = toDateOnly(addDays(serverTime, -(SCHEDULE_UPH_DAYS - 1)));

    const uploadRes = await obupSupabase
      .from(OBUP_UPLOAD_RECORDS_TABLE)
      .select('work_date, stage')
      .gte('work_date', startKey)
      .lte('work_date', endKey)
      .in('stage', stages as any[]);
    if (uploadRes.error) {
      if (requestId === scheduleUphRequestRef.current) setScheduleUphByStaffId({});
      return;
    }

    const validWorkStageKeys = new Set<string>();
    for (const row of ((uploadRes.data as Array<{ work_date?: string | null; stage?: string | null }> | null) ?? [])) {
      const stage = String(row.stage ?? '').trim().toLowerCase();
      const workDate = String(row.work_date ?? '').trim();
      if (!stage || !workDate) continue;
      validWorkStageKeys.add(`${workDate}__${stage}`);
    }
    if (validWorkStageKeys.size === 0) {
      if (requestId === scheduleUphRequestRef.current) setScheduleUphByStaffId({});
      return;
    }

    const reportRowsRes = await obupSupabase
      .from(OBUP_REPORTS_TABLE)
      .select('id, work_date, stage, created_at')
      .gte('work_date', startKey)
      .lte('work_date', endKey)
      .in('stage', stages as any[])
      .order('created_at', { ascending: false });
    if (reportRowsRes.error) {
      if (requestId === scheduleUphRequestRef.current) setScheduleUphByStaffId({});
      return;
    }

    const latestReportIdByWorkStage = new Map<string, { id: string; stage: 'picking' | 'sorting' | 'packing' }>();
    for (const row of ((reportRowsRes.data as Array<{ id?: string | null; work_date?: string | null; stage?: string | null }> | null) ?? [])) {
      const id = String(row.id ?? '').trim();
      const stage = String(row.stage ?? '').trim().toLowerCase() as 'picking' | 'sorting' | 'packing';
      const workDate = String(row.work_date ?? '').trim();
      if (!id || !stage || !workDate) continue;
      const workStageKey = `${workDate}__${stage}`;
      if (!validWorkStageKeys.has(workStageKey)) continue;
      if (!latestReportIdByWorkStage.has(workStageKey)) {
        latestReportIdByWorkStage.set(workStageKey, { id, stage });
      }
    }

    const reportIdToStage = new Map<string, 'picking' | 'sorting' | 'packing'>();
    for (const item of latestReportIdByWorkStage.values()) {
      reportIdToStage.set(item.id, item.stage);
    }
    const reportIds = Array.from(reportIdToStage.keys());
    if (reportIds.length === 0) {
      if (requestId === scheduleUphRequestRef.current) setScheduleUphByStaffId({});
      return;
    }

    const batches = chunk(reportIds, 200);
    const avgByStageOperatorKey = new Map<
      'picking' | 'sorting' | 'packing',
      Map<string, { sum: number; count: number }>
    >();

    for (const batch of batches) {
      const detailsRes = await fetchAllPagedRows<{ report_id?: string | null; operator?: string | null; uph?: number | null }>({
        pageSize: 1000,
        fetchPage: async (from, to) =>
          await obupSupabase
            .from(OBUP_REPORT_DETAILS_TABLE)
            .select('report_id, operator, uph')
            .in('report_id', batch as any[])
            .range(from, to)
      });
      if (detailsRes.error) {
        if (requestId === scheduleUphRequestRef.current) setScheduleUphByStaffId({});
        return;
      }

      for (const row of detailsRes.rows) {
        const reportId = String(row.report_id ?? '').trim();
        const stage = reportIdToStage.get(reportId);
        if (!stage) continue;
        const operatorRaw = String(row.operator ?? '').trim();
        const key = normalizeWorkAccountKey(operatorRaw);
        if (!key) continue;
        const uph = parseUph(row.uph);
        if (uph === null) continue;
        if (!avgByStageOperatorKey.has(stage)) avgByStageOperatorKey.set(stage, new Map());
        const byOperator = avgByStageOperatorKey.get(stage)!;
        const prev = byOperator.get(key) ?? { sum: 0, count: 0 };
        prev.sum += uph;
        prev.count += 1;
        byOperator.set(key, prev);
      }
    }

    const nextMap: Record<string, number | null> = {};
    for (const [stage, employeesByKey] of stageEmployees.entries()) {
      const operatorAvgByKey = avgByStageOperatorKey.get(stage) ?? new Map<string, { sum: number; count: number }>();

      for (const [employeeKey, staffIds] of employeesByKey.entries()) {
        const rec = operatorAvgByKey.get(employeeKey) ?? null;
        const uph = rec && rec.count > 0 ? rec.sum / rec.count : null;
        for (const staff of staffIds) {
          nextMap[staff] = uph;
        }
      }
    }

    if (requestId === scheduleUphRequestRef.current) {
      const resolvedCount = Object.values(nextMap).filter((v) => v !== null && v !== undefined).length;
      console.info('[UPH] resolved', {
        total: Object.keys(nextMap).length,
        resolved: resolvedCount,
        startKey,
        endKey,
        stages
      });
      setScheduleUphByStaffId(nextMap);
    }
  };

  const fetchScheduleMistakeCounts = async (options?: { employeesOverride?: EmployeeRow[] | null }) => {
    const requestId = scheduleMistakeRequestRef.current + 1;
    scheduleMistakeRequestRef.current = requestId;
    const employeesForMistake = options?.employeesOverride ?? employees;

    if (!supabase) {
      if (requestId === scheduleMistakeRequestRef.current) {
        setScheduleMistakeByStaffId({});
        setScheduleMistakeDetailsByStaffId({});
      }
      return;
    }

    const staffIds = Array.from(
      new Set(
        employeesForMistake
          .map((employee) => normalizeStaffId(String(employee.staff_id ?? '').trim()))
          .filter(Boolean)
      )
    );
    if (staffIds.length === 0) {
      if (requestId === scheduleMistakeRequestRef.current) {
        setScheduleMistakeByStaffId({});
        setScheduleMistakeDetailsByStaffId({});
      }
      return;
    }

    const endDate = toDateOnly(serverTime);
    const startDate = toDateOnly(addDays(serverTime, -6));
    const countByStaff = new Map<string, number>();
    const detailByStaff = new Map<string, ScheduleMistakeDetail[]>();
    for (const batch of chunk(staffIds, 200)) {
      const res = await supabase
        .from(MISTAKE_REPORT_TABLE)
        .select('employee_staff_id, operational_date, position, reason, reporter_staff_id, created_at')
        .in('employee_staff_id', batch as any[])
        .gte('operational_date', startDate)
        .lte('operational_date', endDate)
        .limit(10000);
      if (res.error) {
        if (!isMissingTableError(res.error.message, MISTAKE_REPORT_TABLE)) {
          console.warn('[schedule] load mistake counts failed:', res.error.message);
        }
        if (requestId === scheduleMistakeRequestRef.current) {
          setScheduleMistakeByStaffId({});
          setScheduleMistakeDetailsByStaffId({});
        }
        return;
      }
      for (const row of ((res.data as any[] | null) ?? [])) {
        const staff = normalizeStaffId(String(row.employee_staff_id ?? '').trim());
        if (!staff) continue;
        countByStaff.set(staff, (countByStaff.get(staff) ?? 0) + 1);
        const list = detailByStaff.get(staff) ?? [];
        list.push({
          operational_date: String(row.operational_date ?? '').trim(),
          position: String(row.position ?? '').trim(),
          reason: String(row.reason ?? '').trim(),
          reporter_staff_id: normalizeStaffId(String(row.reporter_staff_id ?? '').trim()),
          created_at: String(row.created_at ?? '').trim()
        });
        detailByStaff.set(staff, list);
      }
    }

    const nextMap: Record<string, number> = {};
    const nextDetailMap: Record<string, ScheduleMistakeDetail[]> = {};
    for (const staff of staffIds) {
      nextMap[staff] = countByStaff.get(staff) ?? 0;
      const sorted = [...(detailByStaff.get(staff) ?? [])].sort((a, b) => {
        const aTs = Date.parse(a.created_at) || 0;
        const bTs = Date.parse(b.created_at) || 0;
        return bTs - aTs;
      });
      nextDetailMap[staff] = sorted.slice(0, 12);
    }
    if (requestId === scheduleMistakeRequestRef.current) {
      setScheduleMistakeByStaffId(nextMap);
      setScheduleMistakeDetailsByStaffId(nextDetailMap);
    }
  };
  const fetchScheduleMonthlyAbsentDates = async (options?: {
    employeesOverride?: EmployeeRow[] | null;
    monthDateOverride?: Date;
  }) => {
    const requestId = scheduleMonthlyAbsentRequestRef.current + 1;
    scheduleMonthlyAbsentRequestRef.current = requestId;
    const employeesForMonthlyAbsent = options?.employeesOverride ?? employees;

    if (!supabase) {
      if (requestId === scheduleMonthlyAbsentRequestRef.current) {
        setScheduleMonthlyAbsentDatesByStaffId({});
      }
      return;
    }

    const staffIds = Array.from(
      new Set(
        employeesForMonthlyAbsent
          .filter((employee) => !isScheduleOnlyAgency(String(employee.agency ?? employee.Agency ?? '').trim()))
          .map((employee) => normalizeStaffId(String(employee.staff_id ?? '').trim()))
          .filter(Boolean)
      )
    );
    if (staffIds.length === 0) {
      if (requestId === scheduleMonthlyAbsentRequestRef.current) {
        setScheduleMonthlyAbsentDatesByStaffId({});
      }
      return;
    }

    const monthBase = options?.monthDateOverride ?? scheduleMonthAnchor;
    const { startKey, endKey } = getMonthDateRange(monthBase);
    const datesByStaff = new Map<string, Set<string>>();

    for (const batch of chunk(staffIds, 200)) {
      const res = await supabase
        .from(ATTENDANCE_MARKS_TABLE)
        .select('staff_id, work_date')
        .in('staff_id', batch as any[])
        .eq('mark_type', 'absent')
        .gte('work_date', startKey)
        .lte('work_date', endKey)
        .limit(10000);
      if (res.error) {
        if (!isMissingTableError(res.error.message, ATTENDANCE_MARKS_TABLE)) {
          console.warn('[schedule] load monthly absent counts failed:', res.error.message);
        }
        if (requestId === scheduleMonthlyAbsentRequestRef.current) {
          setScheduleMonthlyAbsentDatesByStaffId({});
        }
        return;
      }
      for (const row of ((res.data as any[] | null) ?? [])) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        const workDate = String(row.work_date ?? '').trim();
        if (!staff || !workDate) continue;
        const existing = datesByStaff.get(staff) ?? new Set<string>();
        existing.add(workDate);
        datesByStaff.set(staff, existing);
      }
    }

    const nextMap: Record<string, string[]> = {};
    for (const staff of staffIds) {
      nextMap[staff] = Array.from(datesByStaff.get(staff) ?? []).sort((a, b) => a.localeCompare(b, 'en-US'));
    }
    if (requestId === scheduleMonthlyAbsentRequestRef.current) {
      setScheduleMonthlyAbsentDatesByStaffId(nextMap);
    }
  };
  const fetchScheduleLateMarks = async (options?: {
    employeesOverride?: EmployeeRow[] | null;
    scheduleRowsOverride?: ScheduleRow[] | null;
  }) => {
    const requestId = scheduleLateRequestRef.current + 1;
    scheduleLateRequestRef.current = requestId;
    const employeesForLate = options?.employeesOverride ?? employees;

    if (!supabase) {
      if (requestId === scheduleLateRequestRef.current) setScheduleLateByStaffDayKey({});
      return;
    }

    try {
      const staffIds = Array.from(
        new Set(
          (employeesForLate ?? [])
            .filter((employee) => !isScheduleOnlyAgency(String(employee.agency ?? employee.Agency ?? '').trim()))
            .map((employee) => normalizeStaffId(String(employee.staff_id ?? '').trim()))
            .filter(Boolean)
        )
      );
      if (staffIds.length === 0) {
        if (requestId === scheduleLateRequestRef.current) setScheduleLateByStaffDayKey({});
        return;
      }

      const weekDateKeys = Array.from({ length: 7 }, (_, idx) => toDateOnly(addDays(scheduleWeekStart, idx)));
      const weekStartKey = weekDateKeys[0] ?? '';
      const weekEndKey = weekDateKeys[6] ?? '';
      if (!weekStartKey || !weekEndKey) {
        if (requestId === scheduleLateRequestRef.current) setScheduleLateByStaffDayKey({});
        return;
      }

      const nextMap: Record<string, LateMarkView> = {};
      for (const batch of chunk(staffIds, 200)) {
        const res = await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .select('staff_id, work_date, payload')
          .in('staff_id', batch as any[])
          .eq('mark_type', 'late')
          .gte('work_date', weekStartKey)
          .lte('work_date', weekEndKey)
          .limit(10000);
        if (res.error) throw new Error(res.error.message);

        for (const row of (((res.data as any[]) ?? []) as Array<{ staff_id?: string; work_date?: string; payload?: Record<string, unknown> | null }>)) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const workDate = String(row.work_date ?? '').trim();
          if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) continue;
          const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
          const minutesLate = Number(payload.minutes_late ?? 0);
          nextMap[`${staff}__${workDate}`] = {
            minutesLate: Number.isFinite(minutesLate) ? Math.max(0, Math.round(minutesLate)) : 0,
            source:
              payload.baseline_source === 'personal' || payload.baseline_source === 'team' || payload.baseline_source === 'planned'
                ? (payload.baseline_source as LateBaselineSource)
                : 'planned',
            roundingFamily:
              payload.rounding_family === 'late_shift_points' || payload.rounding_family === 'early_hour'
                ? (payload.rounding_family as LateRoundingFamily)
                : 'early_hour',
            learnedExpectedStartRaw: String(payload.learned_expected_start_raw ?? payload.final_expected_start ?? '').trim(),
            learnedExpectedStartRounded: String(payload.learned_expected_start_rounded ?? payload.final_expected_start ?? '').trim(),
            guardrailExpectedStart: String(payload.guardrail_expected_start ?? payload.final_expected_start ?? '').trim(),
            finalExpectedStart: String(payload.final_expected_start ?? '').trim(),
            firstIn: String(payload.first_in ?? '').trim(),
            sampleCount: Number.isFinite(Number(payload.sample_count ?? 0)) ? Math.max(0, Number(payload.sample_count ?? 0)) : 0
          };
        }
      }

      if (requestId === scheduleLateRequestRef.current) {
        setScheduleLateByStaffDayKey(nextMap);
      }
    } catch (error) {
      console.warn('[schedule] sync late marks failed:', error);
      if (requestId === scheduleLateRequestRef.current) {
        setScheduleLateByStaffDayKey({});
      }
    }
  };
  const getCurrentOperationalDate = () => {
    return currentOperationalDate;
  };
  const openScheduleMistakeCreate = (employee: EmployeeRow) => {
    const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
    if (!staff) return;
    const name = String(employee.name ?? '').trim();
    const position = String(employee.position ?? employee.Position ?? '').trim();
    setScheduleMistakeDraft({
      open: true,
      staff_id: staff,
      name,
      position,
      reason: '',
      saving: false
    });
  };
  const closeScheduleMistakeCreate = () => {
    setScheduleMistakeDraft((prev) => ({ ...prev, open: false, saving: false }));
  };
  const saveScheduleMistakeCreate = async () => {
    if (!scheduleCanOperate) {
      setStatus({ tone: 'error', message: t('排班模块当前为只读。', 'Schedule is read-only.') });
      return;
    }
    if (!supabase) {
      setStatus({ tone: 'error', message: t('缺少 Supabase 配置。', 'Missing Supabase config.') });
      return;
    }
    const staff = normalizeStaffId(String(scheduleMistakeDraft.staff_id ?? '').trim());
    const reason = String(scheduleMistakeDraft.reason ?? '').trim();
    const position = String(scheduleMistakeDraft.position ?? '').trim();
    if (!staff) {
      setStatus({ tone: 'error', message: t('员工工号无效。', 'Invalid employee USID.') });
      return;
    }
    if (!reason) {
      setStatus({ tone: 'error', message: t('请填写原因。', 'Please enter a reason.') });
      return;
    }
    const reporterName = String(userDisplayName ?? '').trim() || String(user?.email ?? '').trim() || 'ADMIN';
    const operationalDate = getCurrentOperationalDate();
    setScheduleMistakeDraft((prev) => ({ ...prev, saving: true }));
    await runLocked('schedule_mistake_create', async () => {
      const { error } = await supabase.from(MISTAKE_REPORT_TABLE).insert([
        {
          position: position || '-',
          employee_staff_id: staff,
          reason,
          reporter_staff_id: reporterName,
          operational_date: operationalDate,
          created_at: new Date(serverTime).toISOString()
        }
      ] as any);
      if (error) {
        setStatus({ tone: 'error', message: `${t('保存失败：', 'Save failed: ')}${error.message}` });
        setScheduleMistakeDraft((prev) => ({ ...prev, saving: false }));
        return;
      }
      setScheduleMistakeDraft({
        open: false,
        staff_id: '',
        name: '',
        position: '',
        reason: '',
        saving: false
      });
      setStatus({ tone: 'success', message: t('Mistake 已添加。', 'Mistake added.') });
      await fetchScheduleMistakeCounts();
    });
  };

  const fetchRecentPunches = async (options?: { search?: string; lockUi?: boolean }) => {
    if (!supabase) {
      setRecentPunchesError('缺少 Supabase 配置。');
      return;
    }

    const searchValue = (options?.search ?? '').trim().replace(/,/g, ' ');
    const shouldSearch = searchValue.length > 0;
    const lockUi = options?.lockUi ?? true;

    const exec = async () => {
      setRecentPunchesError(null);
      let data: Record<string, unknown>[] | null = null;
      let errorMessage: string | null = null;

      const base = () => {
        let q = supabase.from('ob_punches').select('*').limit(30);
        return q;
      };

      const searchStaffIds = async (): Promise<string[]> => {
        const term = `%${searchValue}%`;
        const mode = await resolveEmployeeColumnMode();
        const run = async (m: EmployeeColumnMode) => {
          const select = m === 'cased' ? 'staff_id, name, "Agency"' : 'staff_id, name, agency';
          return await supabase.from(EMPLOYEE_TABLE).select(select).or(`staff_id.ilike.${term},name.ilike.${term}`).limit(200);
        };

        let res = await run(mode);
        if (res.error) {
          const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
          employeeColumnModeRef.current = flipped;
          res = await run(flipped);
        }

        if (res.error) {
          return [];
        }

        return ((res.data as any[] | null) ?? []).map((r) => String(r.staff_id ?? '').trim()).filter(Boolean);
      };

      const extraFromTypedStaffId = () => {
        const normalized = normalizeStaffId(searchValue);
        return isValidStaffIdValue(normalized) ? normalized : null;
      };

      const runQuery = async () => {
        if (!shouldSearch) {
          return await base().order('created_at', { ascending: false });
        }

        const staffIds = Array.from(new Set([...(await searchStaffIds()), extraFromTypedStaffId()].filter(Boolean)));
        if (staffIds.length === 0) {
          return { data: [] as any[], error: null as any };
        }

        return await supabase.from('ob_punches').select('*').in('staff_id', staffIds).order('created_at', { ascending: false }).limit(30);
      };

      const attempt = await runQuery();
      if (attempt.error) {
        const fallback = shouldSearch ? await runQuery() : await base();
        if (fallback.error) {
          errorMessage = fallback.error.message;
        } else {
          data = (fallback.data as Record<string, unknown>[] | null) ?? [];
        }
      } else {
        data = (attempt.data as Record<string, unknown>[] | null) ?? [];
      }

      if (errorMessage) {
        return { rows: [] as Record<string, unknown>[], error: errorMessage };
      }

      const rows = data ?? [];

      const staffIds = Array.from(
        new Set(
          rows
            .map((p) => String(p.staff_id ?? '').trim())
            .filter(Boolean)
        )
      );
      if (staffIds.length === 0) {
        return { rows, employeeMap: {} as Record<string, { name: string; agency: string }>, error: null as string | null };
      }

      const fetchEmployeeMap = async () => {
        const mode = await resolveEmployeeColumnMode();
        const run = async (m: EmployeeColumnMode) => {
          const select = m === 'cased' ? 'staff_id, name, "Agency"' : 'staff_id, name, agency';
          return await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', staffIds);
        };

        let res = await run(mode);
        if (res.error) {
          const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
          employeeColumnModeRef.current = flipped;
          res = await run(flipped);
        }

        if (res.error) {
          return null;
        }

        return (res.data as any[]) ?? [];
      };

      const employees = await fetchEmployeeMap();
      if (!employees) {
        return { rows, employeeMap: {} as Record<string, { name: string; agency: string }>, error: null as string | null };
      }

      const map: Record<string, { name: string; agency: string }> = {};
      for (const e of employees) {
        const staff = String(e.staff_id ?? '').trim();
        if (!staff) continue;
        map[staff] = {
          name: String(e.name ?? '').trim(),
          agency: String(e.agency ?? e.Agency ?? '').trim()
        };
      }
      return { rows, employeeMap: map, error: null as string | null };
    };

    if (!lockUi) {
      const seq = ++punchesFetchSeqRef.current;
      const result = await exec();
      if (seq !== punchesFetchSeqRef.current) {
        return;
      }
      if (result.error) {
        if (!isAbortLikeError(result.error)) setRecentPunchesError(result.error);
        setRecentPunches([]);
        setEmployeeByStaffId({});
        return;
      }
      setRecentPunches(result.rows);
      setEmployeeByStaffId(result.employeeMap ?? {});
      return;
    }

    await runLocked('punches', async () => {
      const result = await exec();
      if (result.error) {
        if (!isAbortLikeError(result.error)) setRecentPunchesError(result.error);
        setRecentPunches([]);
        setEmployeeByStaffId({});
        return;
      }
      setRecentPunches(result.rows);
      setEmployeeByStaffId(result.employeeMap ?? {});
    });
  };

  const fetchEmployees = async ({
    reset: _reset,
    lockUi: lockUiOption,
    includePunchMeta = true,
    streamPartialState = true
  }: {
    reset: boolean;
    search?: string;
    agency?: string;
    position?: string;
    labels?: string[];
    lockUi?: boolean;
    includePunchMeta?: boolean;
    streamPartialState?: boolean;
  }): Promise<EmployeeRow[] | null> => {
    if (!supabase) {
      setEmployeesError('缺少 Supabase 配置。');
      return null;
    }

    const lockUi = lockUiOption ?? true;

    let fetchedEmployees: EmployeeRow[] | null = null;

    const exec = async () => {
      setEmployeesError(null);

      const firstPageSize = 60;
      const nextPageSize = 200;

      const build = (_mode: EmployeeColumnMode, from: number, to: number) => {
        // Use wildcard select to tolerate mixed legacy schemas:
        // some deployments use "Agency"/"Position"/"Label", others use lower-case.
        return supabase.from(EMPLOYEE_TABLE).select('*').order('staff_id', { ascending: true }).range(from, to);
      };

      const mode = await resolveEmployeeColumnMode();
      const run = async (m: EmployeeColumnMode, from: number, to: number) => {
        const attemptCreatedAt = await build(m, from, to).order('created_at', { ascending: false });
        return attemptCreatedAt.error ? await build(m, from, to).order('id', { ascending: false }) : attemptCreatedAt;
      };

      const all: EmployeeRow[] = [];
      const activeLoaded: EmployeeRow[] = [];
      let from = 0;
      let done = false;
      let pageCount = 0;
      let previousPageSignature = '';
      while (!done) {
        const pageSize = pageCount === 0 ? firstPageSize : nextPageSize;
        const to = from + pageSize - 1;
        let attempt = await run(mode, from, to);
        if (attempt.error) {
          const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
          employeeColumnModeRef.current = flipped;
          attempt = await run(flipped, from, to);
        }

        if (attempt.error) {
          if (!isAbortLikeError(attempt.error.message)) setEmployeesError(attempt.error.message);
          setEmployees([]);
          setEmployeesHasMore(false);
          return;
        }

        const rows = (attempt.data as EmployeeRow[] | null) ?? [];
        const pageSignature =
          rows.length > 0
            ? `${rows.length}|${String(rows[0]?.staff_id ?? rows[0]?.id ?? '')}|${String(rows[rows.length - 1]?.staff_id ?? rows[rows.length - 1]?.id ?? '')}`
            : '0';
        if (rows.length === pageSize && pageSignature === previousPageSignature) {
          setEmployeesError('Employee list paging loop detected. Please refresh and retry.');
          break;
        }
        previousPageSignature = pageSignature;
        all.push(...rows);
        const loadedChunk = rows
          .map((row) => {
            const workAccount = String((row as any)?.work_account ?? (row as any)?.WorkAccount ?? '').trim();
            const workPassword = String((row as any)?.work_password ?? (row as any)?.WorkPassword ?? '').trim();
            const shiftTime = normalizeShiftTimeValue((row as any)?.shift_time ?? (row as any)?.ShiftTime ?? '');
            const employmentType = normalizeEmploymentTypeValue((row as any)?.employment_type ?? (row as any)?.EmploymentType ?? '');
            return {
              ...row,
              employment_type: employmentType,
              work_password: resolveDefaultWorkPassword(workAccount, workPassword),
              shift_time: shiftTime || null
            } as EmployeeRow;
          })
          .filter((row) => isEmployeeActive(row));
        activeLoaded.push(...loadedChunk);
        if (streamPartialState) {
          setEmployees([...activeLoaded]);
        }
        pageCount += 1;
        if (rows.length < pageSize) {
          done = true;
        } else {
          from += pageSize;
          await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), 0);
          });
        }
      }

      setEmployees([...activeLoaded]);
      setEmployeesHasMore(false);
      fetchedEmployees = [...activeLoaded];

      const staffIdsRaw = all.map((e) => String(e.staff_id ?? '').trim()).filter(Boolean);
      const staffIds = Array.from(new Set(staffIdsRaw.map((id) => normalizeStaffId(id)).filter(Boolean)));
      if (staffIds.length === 0) {
        setEmployeeShiftByStaffId({});
        if (includePunchMeta) setEmployeeLastPunchAtByStaffId({});
        return;
      }

      const shiftMap: Record<string, { shift: '' | 'early' | 'late'; earlyHours: number; lateHours: number }> = {};
      for (const emp of fetchedEmployees ?? []) {
        const s = normalizeStaffId(String(emp.staff_id ?? '').trim());
        if (!s) continue;
        const dbShift = normalizeShiftValue(String(emp.shift ?? '').trim());
        shiftMap[s] = { shift: dbShift, earlyHours: 0, lateHours: 0 };
      }
      setEmployeeShiftByStaffId(shiftMap);

      if (!includePunchMeta) {
        return;
      }

      const staffIdsForQuery = Array.from(
        new Set(
          staffIdsRaw
            .flatMap((id) => {
              const trimmed = String(id ?? '').trim();
              if (!trimmed) return [] as string[];
              return [trimmed, trimmed.toUpperCase(), trimmed.toLowerCase(), normalizeStaffId(trimmed)];
            })
            .filter(Boolean)
        )
      );

      const fetchLatestPunchAtByStaff = async (ids: string[]) => {
        const out: Record<string, string | null> = {};
        const batches = chunk(ids, 200);
        const pageSize = 1000;

        for (const batch of batches) {
          const found = new Set<string>();
          const base = () => supabase.from('ob_punches').select('staff_id, created_at, id').in('staff_id', batch);

          for (let from = 0; ; from += pageSize) {
            const to = from + pageSize - 1;
            const attemptCreatedAt = await base().order('created_at', { ascending: false }).range(from, to);
            const attempt = attemptCreatedAt.error
              ? await base().order('id', { ascending: false }).range(from, to)
              : attemptCreatedAt;
            if (attempt.error) {
              return { map: {} as Record<string, string | null>, error: attempt.error.message };
            }

            const rows = (attempt.data as Array<{ staff_id?: string | null; created_at?: string | null }> | null) ?? [];
            for (const row of rows) {
              const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
              if (!staff || found.has(staff)) continue;
              out[staff] = String(row.created_at ?? '').trim() || null;
              found.add(staff);
            }

            if (found.size >= batch.length || rows.length < pageSize) break;
          }

          for (const staff of batch) {
            const key = normalizeStaffId(String(staff ?? '').trim());
            if (!key) continue;
            if (!(key in out)) out[key] = null;
          }
        }

        return { map: out, error: null as string | null };
      };

      const latestPunchRes = await fetchLatestPunchAtByStaff(staffIdsForQuery);
      if (latestPunchRes.error) {
        setEmployeeLastPunchAtByStaffId({});
      } else {
        setEmployeeLastPunchAtByStaffId(latestPunchRes.map);
      }

    };
    if (!lockUi) {
      await exec();
    } else {
      await runLocked('employees', exec);
    }
    return fetchedEmployees;
  };

  const fetchTempAccounts = async ({ lockUi = false }: { lockUi?: boolean } = {}) => {
    if (!supabase) {
      setTempAccounts([]);
      return;
    }
    const exec = async () => {
      const res = await supabase
        .from(TEMP_ACCOUNT_TABLE)
        .select('staff_id, name, agency, position, work_account, work_password, note, updated_at')
        .order('updated_at', { ascending: false })
        .limit(5000);
      if (res.error) {
        setTempAccounts([]);
        setStatus({ tone: 'error', message: t(`读取临时账号失败：${res.error.message}`, `Failed to load temp accounts: ${res.error.message}`) });
        return;
      }
      const rows = ((res.data as any[]) ?? []).map((row) => ({
        staff_id: normalizeStaffId(String(row?.staff_id ?? '').trim()),
        name: String(row?.name ?? '').trim(),
        agency: String(row?.agency ?? '').trim(),
        position: String(row?.position ?? '').trim(),
        work_account: String(row?.work_account ?? '').trim(),
        work_password: resolveDefaultWorkPassword(
          String(row?.work_account ?? '').trim(),
          String(row?.work_password ?? '').trim()
        ),
        note: String(row?.note ?? '').trim()
      }));
      setTempAccounts(rows.filter((row) => Boolean(row.staff_id && (row.work_account || row.work_password))));
    };
    if (lockUi) {
      await runLocked('temp_accounts', exec);
    } else {
      await exec();
    }
  };

  const addEmployeeRow = async () => {
    if (!employeesCanOperate) {
      setEmployeesError(t('员工模块当前为只读。', 'Employees is read-only.'));
      return;
    }
    if (!supabase) {
      setEmployeesError('缺少 Supabase 配置。');
      return;
    }

    const staffRaw = employeeNewStaffId.trim();
    const staff = normalizeStaffId(staffRaw);
    if (!staff || !isValidStaffIdValue(staff)) {
      setEmployeesError('员工ID格式不正确。');
      return;
    }

    const name = employeeNewName.trim();
    const agency = employeeNewAgency.trim();
    const position = employeeNewPosition.trim();
    const employmentType = normalizeEmploymentTypeValue(employeeNewEmploymentType);
    const shift = employeeNewShift;
    const shiftTime = normalizeShiftTimeValue(employeeNewShiftTime);
    const label = employeeNewLabel.trim();
    const workAccount = employeeNewWorkAccount.trim();
    const workPassword = resolveDefaultWorkPassword(workAccount, employeeNewWorkPassword.trim());
    if (!name) {
      setEmployeesError('Name is required.');
      return;
    }
    if (!agency) {
      setEmployeesError('Agency is required.');
      return;
    }
    if (!position) {
      setEmployeesError('Position is required.');
      return;
    }
    if (!shift) {
      setEmployeesError('Shift is required.');
      return;
    }
    if (!label) {
      setEmployeesError('Label is required.');
      return;
    }
    const normalizedPos = normalizePositionKey(position);
    if (!normalizedPos) {
      setEmployeesError(`Position 只能是：${ALLOWED_POSITIONS.join(', ')}`);
      return;
    }
    const resolvedShiftTime = resolveShiftStartTime(shift, normalizedPos, shiftTime);

    await runLocked('employee_add', async () => {
      setEmployeesError(null);

      const mode = await resolveEmployeeColumnMode();
      const payload =
        mode === 'cased'
          ? {
              staff_id: staff,
              name,
              Agency: agency,
              Position: normalizedPos,
              employment_type: employmentType,
              shift: shift || null,
              shift_time: resolvedShiftTime || null,
              label: label || null,
              work_account: workAccount || null,
              work_password: workPassword || null,
              active: true,
              terminated_at: null
            }
          : {
              staff_id: staff,
              name,
              agency,
              position: normalizedPos,
              employment_type: employmentType,
              shift: shift || null,
              shift_time: resolvedShiftTime || null,
              label: label || null,
              work_account: workAccount || null,
              work_password: workPassword || null,
              active: true,
              terminated_at: null
            };

      let attemptUpsert = await supabase
        .from(EMPLOYEE_TABLE)
        .upsert([payload as any], { onConflict: 'staff_id', ignoreDuplicates: false });
      if (attemptUpsert.error && /active|terminated_at/i.test(String(attemptUpsert.error.message ?? ''))) {
        const fallbackPayload = { ...payload } as Record<string, unknown>;
        delete fallbackPayload.active;
        delete fallbackPayload.terminated_at;
        attemptUpsert = await supabase
          .from(EMPLOYEE_TABLE)
          .upsert([fallbackPayload as any], { onConflict: 'staff_id', ignoreDuplicates: false });
      }

      if (attemptUpsert.error) {
        const attemptInsert = await supabase.from(EMPLOYEE_TABLE).insert([payload as any]);
        if (attemptInsert.error) {
          setEmployeesError(attemptInsert.error.message);
          return;
        }
      }

      setStatus({ tone: 'success', message: `已添加/更新员工：${staff}` });
      await writeAudit({
        action: 'employee_upsert',
        staffId: staff,
        target: EMPLOYEE_TABLE,
        payload: {
          staff_id: staff,
          name,
          agency,
          position: normalizedPos,
          employment_type: employmentType,
          shift,
          shift_time: resolvedShiftTime,
          label,
          work_account: workAccount,
          work_password: workPassword
        }
      });
      setEmployeeNewStaffId('');
      setEmployeeNewName('');
      setEmployeeNewAgency('');
      setEmployeeNewPosition('');
      setEmployeeNewEmploymentType('FT');
      setEmployeeNewShift('');
      setEmployeeNewShiftTime('');
      setEmployeeNewLabel('');
      setEmployeeNewWorkAccount('');
      setEmployeeNewWorkPassword('');
      setEmployeeAddOpen(false);
      await fetchEmployees({ reset: true });
    });
  };

  const deleteEmployeeRow = async (staffId: string) => {
    if (!employeesCanOperate) {
      setEmployeesError(t('员工模块当前为只读。', 'Employees is read-only.'));
      return;
    }
    if (!supabase) {
      setEmployeesError('缺少 Supabase 配置。');
      return;
    }
    const staff = String(staffId ?? '').trim();
    if (!staff) return;
    const normalizedStaff = normalizeStaffId(staff);
    const employeeSnapshot =
      employees.find((row) => normalizeStaffId(String(row.staff_id ?? '').trim()) === normalizedStaff) ?? null;
    const employeeName = employeeSnapshot?.name?.trim() || '';
    const displayName = employeeName ? `${employeeName} (${staff})` : staff;

    const ok = await askConfirm(
      t(
        `确定要删除员工 ${displayName} 吗？此操作不可撤销。`,
        `Are you sure you want to remove employee ${displayName}? This action cannot be undone.`
      ),
      t('离职确认', 'Confirm Departure')
    );
    if (!ok) return;

    await runLocked('employee_delete', async () => {
      setEmployeesError(null);
      const scheduleDeleteRes = await supabase.from(SCHEDULE_TABLE).delete().eq('staff_id', staff).select('id');
      if (scheduleDeleteRes.error) {
        setEmployeesError(scheduleDeleteRes.error.message);
        return;
      }
      const deletedScheduleCount = ((scheduleDeleteRes.data as any[] | null) ?? []).length;

      const departPayload = {
        active: false,
        terminated_at: new Date(serverTime).toISOString()
      };
      const employeeDeleteRes = await supabase.from(EMPLOYEE_TABLE).update(departPayload as any).eq('staff_id', staff);
      if (employeeDeleteRes.error) {
        setEmployeesError(
          /active|terminated_at/i.test(String(employeeDeleteRes.error.message ?? ''))
            ? `离职失败：${employeeDeleteRes.error.message}。请先执行 sql/2026-02-28_add_employee_soft_delete_columns.sql`
            : employeeDeleteRes.error.message
        );
        return;
      }
      setStatus({ tone: 'success', message: `已离职员工：${displayName}（同时删除排班 ${deletedScheduleCount} 条）` });
      await writeAudit({
        action: 'employee_delete',
        staffId: staff,
        target: EMPLOYEE_TABLE,
        payload: {
          deleted_schedule_rows: deletedScheduleCount,
          soft_deleted: true,
          staff_id: staff,
          name: String(employeeSnapshot?.name ?? '').trim() || null,
          agency: String(employeeSnapshot?.agency ?? employeeSnapshot?.Agency ?? '').trim() || null,
          position: String(employeeSnapshot?.position ?? employeeSnapshot?.Position ?? '').trim() || null,
          shift: normalizeShiftValue(String(employeeSnapshot?.shift ?? '').trim()) || null
        }
      });
      setEmployees((prev) =>
        prev.filter((row) => normalizeStaffId(String(row.staff_id ?? '').trim()) !== normalizedStaff)
      );
      setEmployeeShiftByStaffId((prev) => {
        if (!(normalizedStaff in prev)) return prev;
        const next = { ...prev };
        delete next[normalizedStaff];
        return next;
      });
      setEmployeeLastPunchAtByStaffId((prev) => {
        if (!(normalizedStaff in prev)) return prev;
        const next = { ...prev };
        delete next[normalizedStaff];
        return next;
      });
    });
  };

  const printEmployeeBadgeCards = async (
    input: Array<{ staff: string; name: string; agency: string; position: string; workAccount?: string; workPassword?: string }>
  ) => {
    const rows = input
      .map((r) => ({
        staff: normalizeStaffId(String(r.staff ?? '').trim()),
        name: String(r.name ?? '').trim() || '-',
        agency: String(r.agency ?? '').trim() || '-',
        position: String(r.position ?? '').trim() || '-',
        workAccount: String(r.workAccount ?? '').trim() || '-',
        workPassword: String(r.workPassword ?? '').trim() || '-'
      }))
      .filter((r) => Boolean(r.staff));
    if (rows.length === 0) {
      setStatus({ tone: 'error', message: t('没有可打印的工牌数据。', 'No badge data to print.') });
      return;
    }
    const safe = (v: string) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const logoUrls = [1, 2, 3, 4, 5, 6].map((idx) => new URL(`/img/${idx}.png`, window.location.origin).toString());
    const logoByStaff = new Map<string, string>();
    const pickLogo = (staff: string) => {
      const key = String(staff ?? '').trim();
      if (!key) return logoUrls[0];
      const cached = logoByStaff.get(key);
      if (cached) return cached;
      let hash = 0;
      for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
      const selected = logoUrls[hash % logoUrls.length];
      logoByStaff.set(key, selected);
      return selected;
    };
    const logoHtml = (staff: string) => `<img src="${safe(pickLogo(staff))}" alt="logo" />`;
    const getFooterColorByPosition = (position: string) => {
      const key = String(position ?? '').trim().toLowerCase();
      if (key === 'pick') return '#38bdf8';
      if (key === 'pack') return '#fb7185';
      if (key === 'rebin') return '#34d399';
      if (key === 'preship') return '#facc15';
      if (key === 'transfer') return '#a78bfa';
      return '#fa4949';
    };
    const getFooterTextColor = (hex: string) => {
      const h = String(hex ?? '').trim().replace('#', '');
      if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#ffffff';
      const n = Number.parseInt(h, 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return lum > 0.72 ? '#0f172a' : '#ffffff';
    };
    const footerStyle = (position: string) => {
      const bg = getFooterColorByPosition(position);
      const fg = getFooterTextColor(bg);
      return `background:${bg};color:${fg};`;
    };
    const chunk8 = <T,>(arr: T[]) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += 8) out.push(arr.slice(i, i + 8));
      return out;
    };

    const rowsWithQr: Array<{
      staff: string;
      name: string;
      agency: string;
      position: string;
      workAccount: string;
      workPassword: string;
      qrEmp: string;
      qrAcc: string;
      qrPwd: string;
    }> = [];
    for (const row of rows) {
      const [qrEmp, qrAcc, qrPwd] = await Promise.all([
        QRCode.toDataURL(row.staff, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 560,
          color: { dark: '#0b1220', light: '#ffffff' }
        }),
        QRCode.toDataURL(row.workAccount, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 560,
          color: { dark: '#0b1220', light: '#ffffff' }
        }),
        QRCode.toDataURL(row.workPassword, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 560,
          color: { dark: '#0b1220', light: '#ffffff' }
        })
      ]);
      rowsWithQr.push({ ...row, qrEmp, qrAcc, qrPwd });
    }
    const groups = chunk8(rowsWithQr);
    const byStaff = new Map(rowsWithQr.map((r) => [r.staff, r]));

    const frontCard = (r?: (typeof rowsWithQr)[number]) =>
      r
        ? `
    <div class="badge">
      <div class="badge-header">
        <div class="brand">
          <div class="logo">${logoHtml(r.staff)}</div>
          <div class="brand-text">
            <div class="h">JD Outbound</div>
            <div class="s">Employee Work Card</div>
          </div>
        </div>
        <div class="hdr-right">JD Logistics</div>
      </div>
      <div class="badge-body">
        <div class="fields">
          <div class="name">${safe(r.name)}</div>
          <div class="meta">
            <div class="row"><div class="k">Agency</div><div class="v">${safe(r.agency)}</div></div>
            <div class="row"><div class="k">Position</div><div class="v">${safe(r.position)}</div></div>
          </div>
          <div class="empid"><span>Emp ID</span><code>${safe(r.staff)}</code></div>
        </div>
        <div class="qr"><img src="${safe(r.qrEmp)}" alt="QR ${safe(r.staff)}" /></div>
      </div>
      <div class="badge-footer" style="${footerStyle(r.position)}">
        <div class="footer-name">${safe(r.name)}</div>
        <div class="footer-emp">ID ${safe(r.staff)}</div>
      </div>
    </div>`
        : '<div class="badge empty"></div>';

    const backCard = (r?: (typeof rowsWithQr)[number]) =>
      r
        ? `
    <div class="badge">
      <div class="badge-header">
        <div class="brand">
          <div class="logo">${logoHtml(r.staff)}</div>
          <div class="brand-text">
            <div class="h">JD Outbound</div>
            <div class="s">Work Account</div>
          </div>
        </div>
        <div class="hdr-right">JD Logistics</div>
      </div>
      <div class="badge-body-back">
        <div class="pair">
          <div class="qrbox">
            <div class="label">ACCOUNT</div>
            <code>${safe(r.workAccount)}</code>
            <div class="qrsq"><img src="${safe(r.qrAcc)}" alt="QR account ${safe(r.staff)}" /></div>
          </div>
          <div class="qrbox">
            <div class="label">PASSWORD</div>
            <code>${safe(r.workPassword)}</code>
            <div class="qrsq"><img src="${safe(r.qrPwd)}" alt="QR password ${safe(r.staff)}" /></div>
          </div>
        </div>
      </div>
      <div class="badge-footer" style="${footerStyle(r.position)}">
        <div class="footer-name">${safe(r.name)}</div>
        <div class="footer-emp">ID ${safe(r.staff)}</div>
      </div>
    </div>`
        : '<div class="badge empty"></div>';

    const pagesHtml = groups
      .map((group) => {
        const frontSlots = new Array<ReturnType<typeof frontCard>>(8).fill('<div class="badge empty"></div>');
        const backSlots = new Array<ReturnType<typeof backCard>>(8).fill('<div class="badge empty"></div>');
        for (let i = 0; i < 8; i += 1) {
          const row = group[i];
          if (!row) continue;
          frontSlots[i] = frontCard(row);
          backSlots[i ^ 1] = backCard(byStaff.get(row.staff));
        }
        return `<section class="page front">${frontSlots.join('')}</section><section class="page back">${backSlots.join('')}</section>`;
      })
      .join('');

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      :root {
        --pageW: 215.9mm;
        --pageH: 279.4mm;
        --pagePad: 12mm;
        --pageGap: 7mm;
        --badgeW: calc((var(--pageW) - (2 * var(--pagePad)) - var(--pageGap)) / 2);
        --badgeH: calc((var(--pageH) - (2 * var(--pagePad)) - (3 * var(--pageGap))) / 4);
        --backShiftX: 0mm;
        --backShiftY: 0mm;
        --cardPadX: 14px;
        --cardPadY: 12px;
        --headerH: 44px;
        --footerH: 22px;
      }
      @page { size: Letter; margin: 0; }
      html, body {
        margin: 0;
        padding: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body {
        background: #fff;
        font-family: Arial, "Microsoft YaHei", sans-serif;
      }
      .page {
        width: var(--pageW);
        height: var(--pageH);
        padding: var(--pagePad);
        box-sizing: border-box;
        display: grid;
        grid-template-columns: var(--badgeW) var(--badgeW);
        grid-template-rows: repeat(4, var(--badgeH));
        gap: var(--pageGap);
        align-content: start;
        justify-content: start;
        margin: 0;
        overflow: hidden;
      }
      .page:not(:last-child) { page-break-after: always; break-after: page; }
      .page.back {
        position: relative;
        transform: translate(var(--backShiftX), var(--backShiftY));
      }
      .badge {
        width: var(--badgeW);
        height: var(--badgeH);
        border: 1px solid #e5e7eb;
        border-radius: 0;
        display: grid;
        grid-template-rows: var(--headerH) minmax(0, 1fr) var(--footerH);
        background: #fff;
        color: #0f172a;
        overflow: hidden;
        box-sizing: border-box;
      }
      .badge.empty { visibility: hidden; }
      .badge-header {
        height: var(--headerH);
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
        padding: 0 var(--cardPadX);
        border-bottom: 1px solid #e5e7eb;
        box-sizing: border-box;
      }
      .brand-text .h { font-size: 12.5px; font-weight: 800; line-height: 1.1; }
      .brand-text .s { font-size: 10.5px; color: #64748b; line-height: 1.2; }
      .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .logo { width: 24px; height: 24px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }
      .logo img { width: 24px; height: 24px; display: block; object-fit: contain; }
      .logo svg { width: 24px; height: 24px; display: block; }
      .hdr-right { font-size: 10px; font-weight: 800; color: #64748b; white-space: nowrap; }
      .badge-body {
        display: grid;
        grid-template-columns: 1fr 64px;
        gap: 10px;
        padding: var(--cardPadY) var(--cardPadX);
        min-height: 0;
        box-sizing: border-box;
      }
      .fields { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
      .name { font-size: 22px; font-weight: 900; line-height: 1.1; word-break: break-word; }
      .meta { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
      .row { display: flex; gap: 8px; align-items: baseline; }
      .k { color: #64748b; font-weight: 700; width: 56px; flex: 0 0 auto; }
      .v { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .empid { margin-top: 2px; font-size: 11px; color: #64748b; display: flex; gap: 8px; }
      .empid code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; font-size: 10.5px; }
      .qr { width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; }
      .qr img { width: 64px; height: 64px; display: block; image-rendering: pixelated; }
      .badge-footer {
        height: var(--footerH);
        padding: 0 var(--cardPadX);
        background: #fa4949;
        color: #fff;
        font-size: 10.5px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-sizing: border-box;
      }
      .footer-name { max-width: 60mm; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 9.5px; }
      .badge-body-back {
        padding: var(--cardPadY) var(--cardPadX);
        min-height: 0;
        display: flex;
        box-sizing: border-box;
      }
      .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; align-content: start; }
      .qrbox { display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .label { font-size: 10px; font-weight: 800; color: #64748b; letter-spacing: .2px; }
      .qrbox code { font-size: 9.5px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .qrsq img { width: 80px; height: 80px; display: block; image-rendering: pixelated; }
    </style>
  </head>
  <body>${pagesHtml}</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      setStatus({ tone: 'error', message: t('打印失败：无法创建打印页。', 'Print failed: cannot create print page.') });
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const imgs = Array.from(doc.images ?? []);
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            const done = () => {
              img.removeEventListener('load', done);
              img.removeEventListener('error', done);
              resolve();
            };
            img.addEventListener('load', done);
            img.addEventListener('error', done);
          })
      )
    );
    await new Promise((r) => setTimeout(r, 80));
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 2500);
  };

  const printEmployeeTempBadgeSheet = async (payload: { staff: string; name: string; position: string }) => {
    const staff = normalizeStaffId(String(payload.staff ?? '').trim());
    if (!staff) return;
    const name = String(payload.name ?? '').trim() || '-';
    const position = String(payload.position ?? '').trim() || '-';
    const safe = (v: string) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const qrDataUrl = await QRCode.toDataURL(staff, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 560,
      color: { dark: '#0b1220', light: '#ffffff' }
    });
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      @page { size: 4in 2in; margin: 0; }
      html, body { margin: 0; padding: 0; width: 4in; height: 2in; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { background: #ffffff; font-family: Arial, "Microsoft YaHei", sans-serif; color: #0f172a; }
      .sheet { width: 4in; height: 2in; box-sizing: border-box; padding: 0.12in; border: 0; border-radius: 0; display: grid; grid-template-rows: auto 1fr; gap: 0.05in; background: #ffffff; }
      .name { font-size: 14pt; line-height: 1.1; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #0f172a; padding: 0; }
      .sub { margin-top: 0.02in; font-size: 8.5pt; letter-spacing: 0.08em; font-weight: 700; color: #334155; text-transform: uppercase; }
      .pair { min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.08in; }
      .box { border: 0; border-radius: 0; padding: 0; display: grid; grid-template-columns: 0.92in 1fr; gap: 0.06in; align-items: center; min-width: 0; background: #ffffff; box-shadow: none; }
      .qrsq { width: 0.92in; height: 0.92in; border: 0; border-radius: 0; background: #fff; display: flex; align-items: center; justify-content: center; }
      .qrsq img { width: 0.82in; height: 0.82in; display: block; image-rendering: pixelated; }
      .meta { min-width: 0; }
      .k { font-size: 7.5pt; letter-spacing: 0.1em; font-weight: 700; color: #334155; text-transform: uppercase; }
      .v { margin-top: 0.04in; font-size: 9pt; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div>
        <div class="name">${safe(name)}</div>
        <div class="sub">${safe(position)}</div>
      </div>
      <div class="pair">
        <div class="box">
          <div class="qrsq"><img src="${safe(qrDataUrl)}" alt="QR ${safe(staff)}" /></div>
          <div class="meta">
            <div class="k">USID</div>
            <div class="v">${safe(staff)}</div>
          </div>
        </div>
        <div></div>
      </div>
    </div>
  </body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      setStatus({ tone: 'error', message: t('打印失败：无法创建打印页。', 'Print failed: cannot create print page.') });
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const imgs = Array.from(doc.images ?? []);
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            const done = () => {
              img.removeEventListener('load', done);
              img.removeEventListener('error', done);
              resolve();
            };
            img.addEventListener('load', done);
            img.addEventListener('error', done);
          })
      )
    );
    await new Promise((r) => setTimeout(r, 80));
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 1500);
  };

  const toggleEmployeeBadgeBatchSelectedStaffId = (payload: {
    staff: string;
    name: string;
    agency: string;
    position: string;
    workAccount?: string;
    workPassword?: string;
  }) => {
    const staff = normalizeStaffId(String(payload.staff ?? '').trim());
    if (!staff) return;
    setEmployeeBadgeBatchSelectedStaffIds((prev) => {
      const selected = prev.includes(staff);
      const next = selected ? prev.filter((id) => id !== staff) : [...prev, staff];
      setEmployeeBadgeBatchSelectedRowsByStaff((rowsPrev) => {
        if (selected) {
          if (!(staff in rowsPrev)) return rowsPrev;
          const nextRows = { ...rowsPrev };
          delete nextRows[staff];
          return nextRows;
        }
        return {
          ...rowsPrev,
          [staff]: {
            staff,
            name: String(payload.name ?? '').trim() || '-',
            agency: String(payload.agency ?? '').trim() || '-',
            position: String(payload.position ?? '').trim() || '-',
            workAccount: String(payload.workAccount ?? '').trim() || '-',
            workPassword: String(payload.workPassword ?? '').trim() || '-'
          }
        };
      });
      return next;
    });
  };

  const printSelectedEmployeeBadgeCards = async () => {
    if (employeeBadgeBatchPrinting) return;
    const selectedIds = employeeBadgeBatchSelectedStaffIds
      .map((item) => normalizeStaffId(String(item ?? '').trim()))
      .filter(Boolean);
    const selectedSet = new Set(selectedIds);
    if (selectedSet.size === 0) {
      setStatus({ tone: 'error', message: t('请先在员工表中选择要打印的行。', 'Please select rows in Employees before printing.') });
      return;
    }
    const employeeByStaff = new Map<string, EmployeeRow>();
    for (const row of employees) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) continue;
      if (!employeeByStaff.has(staff)) employeeByStaff.set(staff, row);
    }
    const selectedRows = selectedIds
      .map((staff) => {
        const selectedSnapshot = employeeBadgeBatchSelectedRowsByStaff[staff];
        if (selectedSnapshot) return selectedSnapshot;
        const e = employeeByStaff.get(staff);
        if (!e) return null;
        return {
          staff,
          name: String(e.name ?? '').trim() || '-',
          agency: String(e.agency ?? e.Agency ?? '').trim() || '-',
          position: String(e.position ?? e.Position ?? '').trim() || '-',
          workAccount: String(e.work_account ?? e.WorkAccount ?? '').trim() || '-',
          workPassword: String(e.work_password ?? e.WorkPassword ?? '').trim() || '-'
        };
      })
      .filter(Boolean) as Array<{ staff: string; name: string; agency: string; position: string; workAccount?: string; workPassword?: string }>;
    if (selectedRows.length === 0) {
      setStatus({ tone: 'error', message: t('已选员工不在当前员工数据中，请先刷新。', 'Selected employees are not in current employee data. Please refresh.') });
      return;
    }
    if (selectedRows.length < selectedSet.size) {
      setStatus({
        tone: 'pending',
        message: t(
          `部分已选员工未找到，实际打印 ${selectedRows.length}/${selectedSet.size} 张。`,
          `Some selected employees were not found. Printing ${selectedRows.length}/${selectedSet.size}.`
        )
      });
    }
    setEmployeeBadgeBatchPrinting(true);
    try {
      await printEmployeeBadgeCards(selectedRows);
    } finally {
      setEmployeeBadgeBatchPrinting(false);
    }
  };

  useEffect(() => {
    setEmployeeBadgeBatchSelectedRowsByStaff((prev) => {
      if (employeeBadgeBatchSelectedStaffIds.length === 0) {
        return Object.keys(prev).length === 0 ? prev : {};
      }
      const keep = new Set(employeeBadgeBatchSelectedStaffIds.map((item) => normalizeStaffId(String(item ?? '').trim())).filter(Boolean));
      const next: typeof prev = {};
      for (const [staff, row] of Object.entries(prev)) {
        if (keep.has(staff)) next[staff] = row;
      }
      const sameSize = Object.keys(next).length === Object.keys(prev).length;
      if (sameSize) return prev;
      return next;
    });
  }, [employeeBadgeBatchSelectedStaffIds]);

  const printEmployeeTempBadge = async (payload: { staff: string; name: string; agency: string; position: string; workAccount?: string; workPassword?: string }) => {
    const staff = normalizeStaffId(String(payload.staff ?? '').trim());
    if (!staff) return;
    setEmployeeBadgePrintingStaffId(staff);
    try {
      await printEmployeeTempBadgeSheet({
        staff,
        name: payload.name || '-',
        position: payload.position || '-'
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
      setStatus({ tone: 'error', message: t(`打印失败：${message}`, `Print failed: ${message}`) });
    } finally {
      setEmployeeBadgePrintingStaffId((current) => (current === staff ? null : current));
    }
  };

  const printAccountCard = async (payload: { staff: string; name: string; workAccount: string; workPassword: string }) => {
    const staff = normalizeStaffId(String(payload.staff ?? '').trim());
    const name = String(payload.name ?? '').trim() || '-';
    const workAccount = String(payload.workAccount ?? '').trim();
    const workPassword = resolveDefaultWorkPassword(workAccount, String(payload.workPassword ?? '').trim());
    if (!staff || !workAccount || !workPassword) return;
    setAccountCardPrintingStaffId(staff);
    try {
      const safe = (v: string) =>
        String(v ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      const [qrAcc, qrPwd] = await Promise.all([
        QRCode.toDataURL(workAccount, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 560,
          color: { dark: '#0b1220', light: '#ffffff' }
        }),
        QRCode.toDataURL(workPassword, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 560,
          color: { dark: '#0b1220', light: '#ffffff' }
        })
      ]);
      const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      @page { size: 4in 2in; margin: 0; }
      html, body {
        margin: 0;
        padding: 0;
        width: 4in;
        height: 2in;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body {
        background: #ffffff;
        font-family: Arial, "Microsoft YaHei", sans-serif;
        color: #0f172a;
      }
      .sheet {
        width: 4in;
        height: 2in;
        box-sizing: border-box;
        padding: 0.12in;
        border: 0;
        border-radius: 0;
        display: grid;
        grid-template-rows: auto 1fr;
        gap: 0.05in;
        background: #ffffff;
      }
      .name {
        font-size: 14pt;
        line-height: 1.1;
        font-weight: 800;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #0f172a;
        padding: 0;
      }
      .subtitle {
        margin-top: 0;
        padding: 0;
        font-size: 6.8pt;
        color: #64748b;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-weight: 600;
      }
      .pair {
        min-height: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.08in;
      }
      .box {
        border: 0;
        border-radius: 0;
        padding: 0;
        display: grid;
        grid-template-columns: 0.92in 1fr;
        gap: 0.06in;
        align-items: center;
        min-width: 0;
        background: #ffffff;
        box-shadow: none;
      }
      .qrsq {
        width: 0.92in;
        height: 0.92in;
        border: 0;
        border-radius: 0;
        background: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .qrsq img {
        width: 0.82in;
        height: 0.82in;
        display: block;
        image-rendering: pixelated;
      }
      .meta { min-width: 0; }
      .k {
        font-size: 7.5pt;
        letter-spacing: 0.1em;
        font-weight: 700;
        color: #334155;
        text-transform: uppercase;
      }
      .v {
        margin-top: 0.04in;
        font-size: 9pt;
        font-weight: 700;
        color: #0f172a;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="name">${safe(name)}</div>
      <div class="pair">
        <div class="box">
          <div class="qrsq"><img src="${safe(qrAcc)}" alt="QR account ${safe(staff)}" /></div>
          <div class="meta">
            <div class="k">Account</div>
            <div class="v">${safe(workAccount)}</div>
          </div>
        </div>
        <div class="box">
          <div class="qrsq"><img src="${safe(qrPwd)}" alt="QR password ${safe(staff)}" /></div>
          <div class="meta">
            <div class="k">Password</div>
            <div class="v">${safe(workPassword)}</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        iframe.remove();
        setStatus({ tone: 'error', message: t('打印失败：无法创建打印页。', 'Print failed: cannot create print page.') });
        return;
      }
      doc.open();
      doc.write(html);
      doc.close();
      const imgs = Array.from(doc.images ?? []);
      await Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) {
                resolve();
                return;
              }
              const done = () => {
                img.removeEventListener('load', done);
                img.removeEventListener('error', done);
                resolve();
              };
              img.addEventListener('load', done);
              img.addEventListener('error', done);
            })
        )
      );
      await new Promise((r) => setTimeout(r, 80));
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => iframe.remove(), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
      setStatus({ tone: 'error', message: t(`打印失败：${message}`, `Print failed: ${message}`) });
    } finally {
      setAccountCardPrintingStaffId((current) => (current === staff ? null : current));
    }
  };

  const openEmployeeAuditLog = async (staff: string, name?: string) => {
    const staffKey = normalizeStaffId(String(staff ?? '').trim());
    if (!staffKey) return;
    setEmployeeAuditStaffId(staffKey);
    setEmployeeAuditName(String(name ?? '').trim());
    setEmployeeAuditRows([]);
    setEmployeeAuditError(null);
    setEmployeeAuditOpen(true);
    setEmployeeAuditLoading(true);
    if (!supabase) {
      setEmployeeAuditRows(auditRows.filter((r) => normalizeStaffId(String(r.staff_id ?? '').trim()) === staffKey).slice(0, 30));
      setEmployeeAuditLoading(false);
      return;
    }
    try {
      const res = await supabase
        .from(AUDIT_TABLE)
        .select('id, created_at, actor, action, staff_id, target, payload')
        .eq('staff_id', staffKey)
        .order('created_at', { ascending: false })
        .limit(30);
      if (res.error) {
        setEmployeeAuditError(res.error.message);
        setEmployeeAuditRows(
          auditRows.filter((r) => normalizeStaffId(String(r.staff_id ?? '').trim()) === staffKey).slice(0, 30)
        );
      } else {
        const rawRows = (((res.data as any[]) ?? []) as AuditRow[]);
        await rememberAuditActorDisplayNames(rawRows.map((row) => row.actor));
        const nextRows = rawRows.map((row) => ({
          ...row,
          actor_raw: (row as any).actor,
          actor: getAuditActorDisplay(row)
        }));
        setEmployeeAuditRows(nextRows);
      }
    } catch (err: any) {
      setEmployeeAuditError(String(err?.message ?? err ?? 'Unknown error'));
      setEmployeeAuditRows(auditRows.filter((r) => normalizeStaffId(String(r.staff_id ?? '').trim()) === staffKey).slice(0, 30));
    } finally {
      setEmployeeAuditLoading(false);
    }
  };

  const printDeviceLabel = async (payload: DeviceLabelPrintPayload) => {
    const sn = normalizeDeviceSn(String(payload.sn ?? '').trim());
    if (!sn) return;
    setDeviceLabelPrintingSn(sn);
    try {
      const qrDataUrl = await QRCode.toDataURL(sn, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 560,
        color: { dark: '#0b1220', light: '#ffffff' }
      });
      setDeviceLabelPreview({
        sn,
        name: String(payload.name ?? '').trim() || sn,
        position: String(payload.position ?? '').trim() || '-',
        type: String(payload.type ?? '').trim() || '-',
        qrDataUrl
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
      setStatus({ tone: 'error', message: t(`打印失败：${message}`, `Print failed: ${message}`) });
    } finally {
      setDeviceLabelPrintingSn((current) => (current === sn ? null : current));
    }
  };

  const printDeviceLabelBatch = async (payloads: DeviceLabelPrintPayload[]) => {
    const bySn = new Map<string, DeviceLabelPrintPayload>();
    for (const raw of payloads) {
      const sn = normalizeDeviceSn(String(raw.sn ?? '').trim());
      if (!sn) continue;
      bySn.set(sn, {
        sn,
        name: String(raw.name ?? '').trim() || sn,
        position: String(raw.position ?? '').trim() || '-',
        type: String(raw.type ?? '').trim() || '-'
      });
    }
    const list = [...bySn.values()];
    if (list.length === 0) {
      setStatus({ tone: 'error', message: t('请先选择要打印的设备。', 'Please select devices to print.') });
      return;
    }
    setDeviceLabelBatchPrinting(true);
    try {
      const labels: DeviceLabelPrintPreview[] = [];
      for (const item of list) {
        const qrDataUrl = await QRCode.toDataURL(item.sn, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 560,
          color: { dark: '#0b1220', light: '#ffffff' }
        });
        labels.push({ ...item, qrDataUrl });
      }
      printDeviceLabelSheet(labels);
      setDeviceSelectedLabelSns([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
      setStatus({ tone: 'error', message: t(`打印失败：${message}`, `Print failed: ${message}`) });
    } finally {
      setDeviceLabelBatchPrinting(false);
    }
  };

  const printDeviceLabelSheet = (input: DeviceLabelPrintPreview | DeviceLabelPrintPreview[]) => {
    const labels = Array.isArray(input) ? input : [input];
    if (labels.length === 0) return;
    const isBatch = labels.length > 1;
    const safe = (v: string) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const renderSheet = (label: DeviceLabelPrintPreview) => `
    <div class="sheet">
      <div class="qr-wrap"><img src="${safe(label.qrDataUrl)}" alt="QR ${safe(label.sn)}" /></div>
      <div class="meta">
        <div class="kicker">OUTBOUND DEVICE</div>
        <div class="name">${safe(label.name)}</div>
        <div class="sub">${safe(label.type)} · ${safe(label.position)}</div>
        <div></div>
        <div class="sn">${safe(label.sn)}</div>
      </div>
    </div>`;
    const chunks: DeviceLabelPrintPreview[][] = [];
    if (isBatch) {
      const perPage = 14; // 4x6 portrait, 2 columns x 7 rows
      for (let i = 0; i < labels.length; i += perPage) chunks.push(labels.slice(i, i + perPage));
    }
    const bodyHtml = isBatch
      ? chunks
          .map(
            (page) => `
    <section class="page">
      ${page.map(renderSheet).join('')}
    </section>`
          )
          .join('')
      : renderSheet(labels[0]);
    const html = `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      @page { size: ${isBatch ? '4in 6in' : '2in 0.7in'}; margin: 0; }
      html, body {
        margin: 0;
        padding: 0;
        width: ${isBatch ? '4in' : '2in'};
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body {
        background: #fff;
        ${isBatch ? 'padding: 0.12in; box-sizing: border-box;' : ''}
      }
      .page {
        width: 3.76in;
        min-height: 5.76in;
        box-sizing: border-box;
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        grid-auto-rows: 0.72in;
        gap: 0.06in 0.08in;
        align-content: start;
        page-break-after: always;
        break-after: page;
      }
      .page:last-child { page-break-after: auto; break-after: auto; }
      .sheet {
        width: ${isBatch ? '1.84in' : '2in'};
        height: ${isBatch ? '0.72in' : '0.7in'};
        box-sizing: border-box;
        padding: 0.045in;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%);
        color: #0f172a;
        font-family: Arial, "Microsoft YaHei", sans-serif;
        display: grid;
        grid-template-columns: 0.58in 1fr;
        gap: 0.045in;
        overflow: hidden;
      }
      .qr-wrap {
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        background: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.012in;
      }
      .qr-wrap img { width: 100%; max-width: 0.5in; height: auto; }
      .meta {
        display: grid;
        grid-template-rows: auto auto auto 1fr auto;
        gap: 0.008in;
        min-width: 0;
      }
      .kicker { font-size: 7pt; font-weight: 800; letter-spacing: 0.08em; color: #334155; }
      .name { font-size: 9pt; font-weight: 800; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font-size: 7pt; color: #475569; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sn { font-size: 7pt; font-weight: 700; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    </style>
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      setStatus({ tone: 'error', message: t('打印失败：无法创建打印页。', 'Print failed: cannot create print page.') });
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();

    const waitImagesReady = async () => {
      const images = Array.from(doc.images ?? []);
      if (images.length > 0) {
        await Promise.all(
          images.map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete && img.naturalWidth > 0) {
                  resolve();
                  return;
                }
                const done = () => {
                  img.removeEventListener('load', done);
                  img.removeEventListener('error', done);
                  resolve();
                };
                img.addEventListener('load', done);
                img.addEventListener('error', done);
                window.setTimeout(done, 1200);
              })
          )
        );
      }
      const docWithFonts = doc as Document & { fonts?: { ready?: Promise<unknown> } };
      if (docWithFonts.fonts?.ready) {
        try {
          await docWithFonts.fonts.ready;
        } catch {
          // ignore font wait failure
        }
      }
    };

    const doPrint = async () => {
      const win = iframe.contentWindow;
      if (!win) {
        iframe.remove();
        return;
      }
      await waitImagesReady();
      win.focus();
      win.print();
      window.setTimeout(() => iframe.remove(), 1200);
    };

    if (iframe.contentWindow?.document.readyState === 'complete') void doPrint();
    else iframe.onload = () => void doPrint();
  };

  useEffect(() => {
    const onAfterPrint = () => {
      setEmployeeBadgePreview(null);
      setDeviceLabelPreview(null);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, []);

  const openEmployeeEdit = (payload: {
    staff: string;
    name: string;
    agency: string;
    position: string;
    employmentType: EmploymentType;
    shift: '' | 'early' | 'late';
    shiftTime: string;
    label: string;
    workAccount: string;
    workPassword: string;
  }) => {
    setEmployeesError(null);
    setEmployeeEditOriginalStaffId(payload.staff);
    setEmployeeEditStaffId(isNewHirePlaceholderStaffId(payload.staff) ? '' : payload.staff);
    setEmployeeEditName(payload.name);
    setEmployeeEditAgency(payload.agency);
    const normalized = normalizePositionKey(payload.position);
    setEmployeeEditPosition((normalized ?? '') as (typeof ALLOWED_POSITIONS)[number] | '');
    setEmployeeEditEmploymentType(normalizeEmploymentTypeValue(payload.employmentType));
    setEmployeeEditShift(payload.shift);
    setEmployeeEditShiftTime(normalizeShiftTimeValue(payload.shiftTime));
    setEmployeeEditLabel(payload.label);
    setEmployeeEditWorkAccount(payload.workAccount);
    setEmployeeEditWorkPassword(payload.workPassword);
    setEmployeeEditOpen(true);
  };

  const closeEmployeeEdit = () => {
    setEmployeeEditOpen(false);
    setEmployeeEditOriginalStaffId(null);
    setEmployeeEditStaffId(null);
    setEmployeeEditName('');
    setEmployeeEditAgency('');
    setEmployeeEditPosition('');
    setEmployeeEditEmploymentType('FT');
    setEmployeeEditShift('');
    setEmployeeEditShiftTime('');
    setEmployeeEditLabel('');
    setEmployeeEditWorkAccount('');
    setEmployeeEditWorkPassword('');
  };

  const closeEmployeeAdd = () => {
    setEmployeeAddOpen(false);
    setEmployeeNewStaffId('');
    setEmployeeNewName('');
    setEmployeeNewAgency('');
    setEmployeeNewPosition('');
    setEmployeeNewEmploymentType('FT');
    setEmployeeNewShift('');
    setEmployeeNewShiftTime('');
    setEmployeeNewLabel('');
    setEmployeeNewWorkAccount('');
    setEmployeeNewWorkPassword('');
  };

  const saveEmployeeEdit = async () => {
    if (!employeesCanOperate) {
      setEmployeesError(t('员工模块当前为只读。', 'Employees is read-only.'));
      return;
    }
    if (!supabase) {
      setEmployeesError('Missing Supabase config.');
      return;
    }
    const canEditStaffIdByEmail = String(user?.email ?? '').trim().toLowerCase() === STAFF_ID_EDITOR_EMAIL;
    const originalStaffRaw = String(employeeEditOriginalStaffId ?? '').trim();
    const isPlaceholderOriginal = isNewHirePlaceholderStaffId(originalStaffRaw);
    const originalStaff = isPlaceholderOriginal ? originalStaffRaw : normalizeStaffId(originalStaffRaw);
    const nextStaffInputRaw = String(employeeEditStaffId ?? '').trim();
    const nextStaffNormalized = normalizeStaffId(nextStaffInputRaw);
    const nextStaff = isPlaceholderOriginal && !nextStaffInputRaw ? originalStaff : nextStaffNormalized;
    if (!originalStaff || !nextStaff) return;
    if (!isPlaceholderOriginal && !canEditStaffIdByEmail && nextStaff !== originalStaff) {
      setEmployeesError(`Only ${STAFF_ID_EDITOR_EMAIL} can change staff ID.`);
      return;
    }
    if (!isPlaceholderOriginal && !isValidStaffIdValue(nextStaff)) {
      setEmployeesError('Invalid staff ID format (e.g. US010454).');
      return;
    }
    if (isPlaceholderOriginal && nextStaff !== originalStaff && !isValidStaffIdValue(nextStaff)) {
      setEmployeesError('Invalid staff ID format (e.g. US010454).');
      return;
    }

    const name = employeeEditName.trim();
    const agency = employeeEditAgency.trim();
    const positionRaw = employeeEditPosition.trim();
    const employmentType = normalizeEmploymentTypeValue(employeeEditEmploymentType);
    const label = employeeEditLabel.trim();
    const workAccount = employeeEditWorkAccount.trim();
    const workPassword = resolveDefaultWorkPassword(workAccount, employeeEditWorkPassword.trim());
    const shiftTimeInput = normalizeShiftTimeValue(employeeEditShiftTime);
    const normalizedPos = positionRaw ? normalizePositionKey(positionRaw) : null;
    const resolvedShiftTime =
      normalizedPos && employeeEditShift ? resolveShiftStartTime(employeeEditShift, normalizedPos, shiftTimeInput) : shiftTimeInput;
    if (positionRaw && !normalizedPos) {
      setEmployeesError('Position must be one of: ' + ALLOWED_POSITIONS.join(', '));
      return;
    }

    let shouldRefresh = false;
    await runLocked('employee_edit', async () => {
      setEmployeesError(null);
      const isStaffIdChanged = nextStaff !== originalStaff;
      let migratedPunchCount = 0;
      let migratedScheduleCount = 0;
      let punchIdsToMigrate: Array<string | number> = [];
      let scheduleIdsToMigrate: Array<string | number> = [];

      if (isStaffIdChanged) {
        const duplicateRes = await supabase.from(EMPLOYEE_TABLE).select('staff_id').eq('staff_id', nextStaff).limit(1);
        if (duplicateRes.error) {
          setEmployeesError(duplicateRes.error.message);
          return;
        }
        if ((((duplicateRes.data as any[]) ?? []).length) > 0) {
          setEmployeesError('Staff ID already exists: ' + nextStaff);
          return;
        }

        const nextPunchRes = await supabase.from('ob_punches').select('id', { count: 'exact', head: true }).eq('staff_id', nextStaff);
        if (nextPunchRes.error) {
          setEmployeesError(nextPunchRes.error.message);
          return;
        }
        if ((nextPunchRes.count ?? 0) > 0) {
          setEmployeesError('Target staff ID already has punch rows. Migration blocked for data safety.');
          return;
        }

        const nextScheduleRes = await supabase.from(SCHEDULE_TABLE).select('id', { count: 'exact', head: true }).eq('staff_id', nextStaff);
        if (nextScheduleRes.error) {
          setEmployeesError(nextScheduleRes.error.message);
          return;
        }
        if ((nextScheduleRes.count ?? 0) > 0) {
          setEmployeesError('Target staff ID already has schedule rows. Migration blocked for data safety.');
          return;
        }

        const punchListRes = await supabase.from('ob_punches').select('id').eq('staff_id', originalStaff);
        if (punchListRes.error) {
          setEmployeesError(punchListRes.error.message);
          return;
        }
        punchIdsToMigrate = ((punchListRes.data as any[]) ?? []).map((r) => r.id).filter((id) => id !== null && id !== undefined);

        const scheduleListRes = await supabase.from(SCHEDULE_TABLE).select('id').eq('staff_id', originalStaff);
        if (scheduleListRes.error) {
          setEmployeesError(scheduleListRes.error.message);
          return;
        }
        scheduleIdsToMigrate = ((scheduleListRes.data as any[]) ?? []).map((r) => r.id).filter((id) => id !== null && id !== undefined);
      }

      const mode = await resolveEmployeeColumnMode();
      const originalEmployeeRes = await supabase
        .from(EMPLOYEE_TABLE)
        .select(
          mode === 'cased'
            ? 'staff_id,name,"Agency","Position",employment_type,shift,shift_time,label,work_account,work_password'
            : 'staff_id,name,agency,position,employment_type,shift,shift_time,label,work_account,work_password'
        )
        .eq('staff_id', originalStaff)
        .maybeSingle();
      if (originalEmployeeRes.error) {
        setEmployeesError(originalEmployeeRes.error.message);
        return;
      }
      const originalEmployeeRow = originalEmployeeRes.data as Record<string, any> | null;
      if (!originalEmployeeRow) {
        setEmployeesError('Original employee record not found.');
        return;
      }

      const payload =
        mode === 'cased'
          ? {
              staff_id: nextStaff,
              name,
              Agency: agency || null,
              Position: normalizedPos,
              employment_type: employmentType,
              shift: employeeEditShift || null,
              shift_time: resolvedShiftTime || null,
              label: label || null,
              work_account: workAccount || null,
              work_password: workPassword || null,
              active: true,
              terminated_at: null
            }
          : {
              staff_id: nextStaff,
              name,
              agency: agency || null,
              position: normalizedPos,
              employment_type: employmentType,
              shift: employeeEditShift || null,
              shift_time: resolvedShiftTime || null,
              label: label || null,
              work_account: workAccount || null,
              work_password: workPassword || null,
              active: true,
              terminated_at: null
            };
      let { error } = await supabase.from(EMPLOYEE_TABLE).update(payload as any).eq('staff_id', originalStaff);
      if (error && /active|terminated_at/i.test(String(error.message ?? ''))) {
        const fallbackPayload = { ...payload } as Record<string, unknown>;
        delete fallbackPayload.active;
        delete fallbackPayload.terminated_at;
        const retry = await supabase.from(EMPLOYEE_TABLE).update(fallbackPayload as any).eq('staff_id', originalStaff);
        error = retry.error as any;
      }
      if (error) {
        setEmployeesError(error.message);
        return;
      }

      if (isStaffIdChanged) {
        const rollbackEmployee = async () => {
          const restorePayload =
            mode === 'cased'
              ? {
                  staff_id: String(originalEmployeeRow.staff_id ?? originalStaff),
                  name: originalEmployeeRow.name ?? null,
                  Agency: originalEmployeeRow.Agency ?? null,
                  Position: originalEmployeeRow.Position ?? null,
                  employment_type: originalEmployeeRow.employment_type ?? null,
                  shift: originalEmployeeRow.shift ?? null,
                  shift_time: originalEmployeeRow.shift_time ?? originalEmployeeRow.ShiftTime ?? null,
                  label: originalEmployeeRow.label ?? originalEmployeeRow.Label ?? null,
                  work_account: originalEmployeeRow.work_account ?? originalEmployeeRow.WorkAccount ?? null,
                  work_password: originalEmployeeRow.work_password ?? originalEmployeeRow.WorkPassword ?? null
                }
              : {
                  staff_id: String(originalEmployeeRow.staff_id ?? originalStaff),
                  name: originalEmployeeRow.name ?? null,
                  agency: originalEmployeeRow.agency ?? null,
                  position: originalEmployeeRow.position ?? null,
                  employment_type: originalEmployeeRow.employment_type ?? null,
                  shift: originalEmployeeRow.shift ?? null,
                  shift_time: originalEmployeeRow.shift_time ?? originalEmployeeRow.ShiftTime ?? null,
                  label: originalEmployeeRow.label ?? originalEmployeeRow.Label ?? null,
                  work_account: originalEmployeeRow.work_account ?? originalEmployeeRow.WorkAccount ?? null,
                  work_password: originalEmployeeRow.work_password ?? originalEmployeeRow.WorkPassword ?? null
                };
          await supabase.from(EMPLOYEE_TABLE).update(restorePayload as any).eq('staff_id', nextStaff);
        };

        if (punchIdsToMigrate.length > 0) {
          const punchUpdateRes = await supabase.from('ob_punches').update({ staff_id: nextStaff } as any).eq('staff_id', originalStaff);
          if (punchUpdateRes.error) {
            await rollbackEmployee();
            setEmployeesError('Migration failed and rolled back. Punch migration error: ' + punchUpdateRes.error.message);
            return;
          }
          migratedPunchCount = punchIdsToMigrate.length;
        }

        if (scheduleIdsToMigrate.length > 0) {
          const scheduleUpdateRes = await supabase.from(SCHEDULE_TABLE).update({ staff_id: nextStaff } as any).eq('staff_id', originalStaff);
          if (scheduleUpdateRes.error) {
            if (punchIdsToMigrate.length > 0) {
              await supabase.from('ob_punches').update({ staff_id: originalStaff } as any).in('id', punchIdsToMigrate as any[]);
            }
            await rollbackEmployee();
            setEmployeesError('Migration failed and rolled back. Schedule migration error: ' + scheduleUpdateRes.error.message);
            return;
          }
          migratedScheduleCount = scheduleIdsToMigrate.length;
        }
      }

      const statusMessage = isStaffIdChanged ? ('Employee updated: ' + originalStaff + ' -> ' + nextStaff + ' (Punches ' + migratedPunchCount + ', Schedules ' + migratedScheduleCount + ')') : ('Employee updated: ' + originalStaff);
      setStatus({ tone: 'success', message: statusMessage });
      await writeAudit({
        action: 'employee_update',
        staffId: nextStaff,
        target: EMPLOYEE_TABLE,
        payload: {
          old_staff_id: originalStaff,
          staff_id: nextStaff,
          name,
          agency,
          position: normalizedPos,
          employment_type: employmentType,
          shift: employeeEditShift,
          shift_time: resolvedShiftTime,
          label,
          work_account: workAccount,
          work_password: workPassword,
          migrated_punch_rows: migratedPunchCount,
          migrated_schedule_rows: migratedScheduleCount,
          before: {
            staff_id: String(originalEmployeeRow.staff_id ?? originalStaff),
            name: String(originalEmployeeRow.name ?? '').trim(),
            agency: String(originalEmployeeRow.agency ?? originalEmployeeRow.Agency ?? '').trim(),
            position: String(originalEmployeeRow.position ?? originalEmployeeRow.Position ?? '').trim(),
            employment_type: normalizeEmploymentTypeValue(originalEmployeeRow.employment_type),
            shift: normalizeShiftValue(String(originalEmployeeRow.shift ?? '').trim()),
            shift_time: normalizeShiftTimeValue(originalEmployeeRow.shift_time ?? originalEmployeeRow.ShiftTime),
            label: String(originalEmployeeRow.label ?? originalEmployeeRow.Label ?? '').trim(),
            work_account: String(originalEmployeeRow.work_account ?? originalEmployeeRow.WorkAccount ?? '').trim(),
            work_password: String(originalEmployeeRow.work_password ?? originalEmployeeRow.WorkPassword ?? '').trim()
          },
          after: {
            staff_id: nextStaff,
            name,
            agency,
            position: normalizedPos ?? '',
            employment_type: employmentType,
            shift: employeeEditShift,
            shift_time: resolvedShiftTime,
            label,
            work_account: workAccount,
            work_password: workPassword
          }
        }
      });
      closeEmployeeEdit();
      shouldRefresh = true;
    });
    if (shouldRefresh) {
      await fetchEmployees({
        reset: true,
        search: employeeSearch,
        agency: employeeAgency,
        position: employeePosition,
        labels: employeeLabels
      });
    }
  };
  const computeHoursByDay = (intervals: Array<{ start: Date; end: Date }>, weekStart: Date) => {
    const out = Array.from({ length: 7 }, () => 0);
    for (const { start, end } of intervals) {
      const startMs = start.getTime();
      const endMs = end.getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

      for (let i = 0; i < 7; i += 1) {
        const { start: dayStart, end: dayEnd } = getDayRange(weekStart, i);
        const overlapStart = Math.max(startMs, dayStart.getTime());
        const overlapEnd = Math.min(endMs, dayEnd.getTime());
        if (overlapEnd > overlapStart) {
          out[i] += (overlapEnd - overlapStart) / 3600000;
        }
      }
    }
    return out;
  };

  const formatHours = (value: number) => formatRoundedHours(value);

  const formatAuditDetail = (row: AuditRow) => {
    const action = String(row.action ?? '').trim();
    const payload = row.payload ?? null;
    const details: Array<{ label: string; value: string }> = [];
    const push = (label: string, value: any) => {
      const text = String(value ?? '').trim();
      if (text) details.push({ label, value: text });
    };
    const fmtHoursValue = (value: any) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return '';
      return formatHours(n) || '0';
    };
    const fmtHoursDelta = (before: any, after: any) => {
      const beforeText = fmtHoursValue(before);
      const afterText = fmtHoursValue(after);
      if (!beforeText || !afterText) return '';
      return `${beforeText}h -> ${afterText}h`;
    };
    const fmtScheduleState = (value: any) => {
      const state = String(value ?? '').trim().toLowerCase();
      if (!state || state === '-' || state === 'null' || state === 'undefined' || state === 'none' || state === 'n/a') {
        return t('休息', 'Off');
      }
      if (state === 'new') return t('新人', 'NEW');
      if (state === 'work') return t('工作', 'Work');
      if (state === 'fixed_work') return t('固定排班', 'Fixed Shift');
      if (state === 'temp_work') return t('临时工作', 'Temporary Work');
      if (state === 'planned_temp_work') return t('替补', 'Replacement');
      if (state === 'leave') return t('请假', 'Excuse');
      if (state === 'planned_leave') return t('计划请假', 'Planned Leave');
      if (state === 'temp_rest') return t('临时排休', 'Temporary Off');
      if (state === 'planned_temp_rest') return t('计划临时排休', 'Planned Temporary Off');
      if (state === 'rest') return t('休息', 'Off');
      if (state === 'rest_worked') return t('休息', 'Off');
      if (state === 'absent') return t('缺勤', 'Absent');
      if (state === 'empty') return t('休息', 'Off');
      if (state === '新人') return t('新人', 'NEW');
      if (state === '工作') return t('工作', 'Work');
      if (state === '固定排班') return t('固定排班', 'Fixed Shift');
      if (state === '临时工作') return t('临时工作', 'Temporary Work');
      if (state === '计划临时工作' || state === '替补') return t('替补', 'Replacement');
      if (state === '请假') return t('请假', 'Excuse');
      if (state === '计划请假') return t('计划请假', 'Planned Leave');
      if (state === '临时排休') return t('临时排休', 'Temporary Off');
      if (state === '计划临时排休') return t('计划临时排休', 'Planned Temporary Off');
      if (state === '休息') return t('休息', 'Off');
      return '-';
    };
    const getScheduleFromState = (fallback: string) =>
      payload?.from_state ?? payload?.state_before ?? payload?.before_state ?? payload?.old_state ?? payload?.from ?? fallback;
    const getScheduleToState = (fallback: string) =>
      payload?.to_state ?? payload?.state_after ?? payload?.next_state ?? payload?.state ?? payload?.to ?? fallback;
    const fmtText = (value: any) => {
      const text = String(value ?? '').trim();
      return text || '-';
    };
    const pushChanged = (label: string, beforeValue: any, afterValue: any) => {
      const beforeText = fmtText(beforeValue);
      const afterText = fmtText(afterValue);
      if (beforeText === afterText) return;
      details.push({ label, value: `${beforeText} -> ${afterText}` });
    };

    let summary = action || '-';
    if (action === 'employee_upsert') {
      summary = t('新增/更新员工', 'Employee upsert');
      push(t('姓名', 'Name'), payload?.name);
      push('Agency', payload?.agency);
      push(t('岗位', 'Position'), payload?.position);
      push(t('班次', 'Shift'), payload?.shift);
      push(t('班次时间', 'Shift time'), payload?.shift_time);
      push(t('工作账号', 'Work account'), payload?.work_account);
      push(t('工作密码', 'Work password'), payload?.work_password);
    } else if (action === 'employee_update') {
      summary = t('更新员工信息', 'Employee updated');
      const before = (payload?.before ?? null) as Record<string, any> | null;
      const after = (payload?.after ?? null) as Record<string, any> | null;
      if (before || after) {
        pushChanged(t('工号', 'Staff ID'), before?.staff_id ?? payload?.old_staff_id, after?.staff_id ?? payload?.staff_id);
        pushChanged(t('姓名', 'Name'), before?.name, after?.name ?? payload?.name);
        pushChanged('Agency', before?.agency, after?.agency ?? payload?.agency);
        pushChanged(t('岗位', 'Position'), before?.position, after?.position ?? payload?.position);
        pushChanged(t('班次', 'Shift'), before?.shift, after?.shift ?? payload?.shift);
        pushChanged(t('班次时间', 'Shift time'), before?.shift_time, after?.shift_time ?? payload?.shift_time);
        pushChanged(t('标签', 'Label'), before?.label, after?.label ?? payload?.label);
        pushChanged(t('工作账号', 'Work account'), before?.work_account, after?.work_account ?? payload?.work_account);
        pushChanged(t('工作密码', 'Work password'), before?.work_password, after?.work_password ?? payload?.work_password);
      } else {
        if (payload?.old_staff_id && payload?.staff_id && String(payload.old_staff_id) !== String(payload.staff_id)) {
          pushChanged(t('工号', 'Staff ID'), payload.old_staff_id, payload.staff_id);
        }
        push(t('姓名', 'Name'), payload?.name);
        push('Agency', payload?.agency);
        push(t('岗位', 'Position'), payload?.position);
        push(t('班次', 'Shift'), payload?.shift);
        push(t('班次时间', 'Shift time'), payload?.shift_time);
        push(t('标签', 'Label'), payload?.label);
        push(t('工作账号', 'Work account'), payload?.work_account);
        push(t('工作密码', 'Work password'), payload?.work_password);
      }
    } else if (action === 'employee_delete') {
      const deletedName = String(payload?.name ?? '').trim();
      summary = deletedName
        ? t(`删除员工：${deletedName}`, `Employee deleted: ${deletedName}`)
        : t('删除员工', 'Employee deleted');
      push(t('姓名', 'Name'), payload?.name);
      push('Agency', payload?.agency);
      push(t('岗位', 'Position'), payload?.position);
      push(t('班次', 'Shift'), payload?.shift);
    } else if (action === 'employee_upload') {
      summary = t('批量上传员工', 'Employee upload');
      push(t('文件', 'File'), payload?.file_name);
      push(t('总行数', 'Total rows'), payload?.total_rows);
      push(t('插入', 'Inserted'), payload?.inserted);
      push(t('更新', 'Updated'), payload?.updated_fill);
      push(t('跳过', 'Skipped'), payload?.skipped_total);
    } else if (action === 'punch_manual_add') {
      summary = t('手动新增打卡', 'Manual punch add');
      const hoursText = fmtHoursDelta(payload?.hours_before, payload?.hours_after);
      if (hoursText) summary = `${summary}: ${hoursText}`;
    } else if (action === 'punch_manual_edit') {
      summary = t('手动修改打卡', 'Manual punch edit');
      const hoursText = fmtHoursDelta(payload?.hours_before, payload?.hours_after);
      if (hoursText) summary = `${summary}: ${hoursText}`;
    } else if (action === 'punch_manual_delete') {
      summary = t('手动删除打卡', 'Manual punch delete');
      const hoursText = fmtHoursDelta(payload?.hours_before, payload?.hours_after);
      if (hoursText) summary = `${summary}: ${hoursText}`;
    } else if (action === 'punch_count_verified') {
      summary = t('打卡次数已核实', 'Punch count verified');
      push(t('打卡次数', 'Punch count'), payload?.punch_count);
      push(t('期望次数', 'Expected count'), payload?.expected_count);
    } else if (action === 'device_add') {
      summary = t('新增设备', 'Device added');
      push(t('设备名', 'Device name'), payload?.device_name);
      push('SN', payload?.device_sn);
      push(t('类型', 'Type'), payload?.device_type);
      push(t('岗位', 'Position'), payload?.position);
    } else if (action === 'device_update') {
      summary = t('更新设备', 'Device updated');
      push('SN', payload?.device_sn);
      push(t('启用', 'Active'), payload?.active);
    } else if (action === 'device_borrow') {
      summary = t('设备借出', 'Device borrowed');
      push('SN', payload?.device_sn);
    } else if (action === 'device_return') {
      summary = t('设备归还', 'Device returned');
      push('SN', payload?.device_sn);
    }

    if (action === 'schedule_work') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('work');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_fixed_work') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('fixed_work');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_temp_work') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('temp_work');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_planned_temp_work') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('planned_temp_work');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_leave') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('leave');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_planned_leave') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('planned_leave');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_temp_rest') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('temp_rest');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_planned_temp_rest') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('planned_temp_rest');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_rest') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('rest');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_clear') {
      const fromState = getScheduleFromState('rest');
      const toState = getScheduleToState('empty');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'agency_schedule_state_set') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('rest');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
      push('Agency', payload?.agency);
      push(t('岗位', 'Position'), payload?.position);
      push(t('日期', 'Date'), payload?.work_date ?? payload?.template_date);
    } else if (action === 'agency_substitute_assign') {
      const toState = getScheduleToState('planned_temp_work');
      summary = `${t('休息', 'Off')} -> ${fmtScheduleState(toState)}`;
      push('Agency', payload?.agency);
      push(t('岗位', 'Position'), payload?.position);
      push(t('日期', 'Date'), payload?.work_date ?? payload?.template_date);
      push(t('替补员工', 'Substitute'), payload?.substitute_staff_id);
    } else if (action === 'schedule_auto_week_reset') {
      summary = t('自动周重置已执行', 'Automatic weekly reset applied');
      push(t('重置周起始', 'Reset week start'), payload?.week_start);
      push(t('临时排休->工作', 'Temp off -> work'), payload?.temp_rest_to_work_count);
      push(t('临时工作->休息', 'Temp work -> off'), payload?.temp_work_to_rest_count);
    } else if (action === 'schedule_auto_daily_activation') {
      summary = t('自动计划激活已执行', 'Automatic daily plan activation applied');
      push(t('激活日期', 'Activation date'), payload?.date);
      push(t('激活条数', 'Activated rows'), payload?.activated_count);
      const activatedEntries = Array.isArray(payload?.activated_entries)
        ? (payload.activated_entries as Array<Record<string, unknown>>)
        : [];
      activatedEntries.forEach((entry: Record<string, unknown>, index: number) => {
        const staffId = normalizeStaffId(String(entry?.staff_id ?? '').trim());
        const staffName = String(entry?.staff_name ?? '').trim();
        const fromState = fmtScheduleState(getScheduleBaseStateFromNote(entry?.from_note ?? null));
        const toState = fmtScheduleState(getScheduleBaseStateFromNote(entry?.to_note ?? null));
        const labelBase = staffName ? `${staffName} (${staffId || '-'})` : staffId || t('员工', 'Employee');
        const dateText = fmtText(entry?.date);
        const positionText = fmtText(entry?.position);
        details.push({
          label: `${t('变更', 'Change')} ${index + 1}`,
          value: `${labelBase} · ${dateText} · ${positionText} · ${fromState} -> ${toState}`
        });
      });
    } else if (action === 'schedule_week_switch') {
      summary = `Week: ${fmtText(payload?.previous_week_start)} -> ${fmtText(payload?.next_week_start)}`;
      push(t('来源', 'Source'), payload?.source);
      push(t('上一周', 'Previous week'), `${fmtText(payload?.previous_week_start)} ~ ${fmtText(payload?.previous_week_end)}`);
      push(t('下一周', 'Next week'), `${fmtText(payload?.next_week_start)} ~ ${fmtText(payload?.next_week_end)}`);
    } else if (action === 'schedule_refresh') {
      summary = t('排班页面已刷新', 'Schedule refreshed');
      push(t('来源', 'Source'), payload?.source);
      push(t('周', 'Week'), `${fmtText(payload?.week_start)} ~ ${fmtText(payload?.week_end)}`);
    } else if (action === 'schedule_open_daily_list') {
      summary = t('打开明日名单', 'Tomorrow list opened');
      push(t('来源', 'Source'), payload?.source);
      push(t('目标日期', 'Target date'), payload?.target_date);
      push(t('排班周偏移', 'Schedule week offset'), payload?.schedule_week_offset);
    } else if (action === 'timecard_week_switch') {
      summary = `Week: ${fmtText(payload?.previous_week_start)} -> ${fmtText(payload?.next_week_start)}`;
      push(t('来源', 'Source'), payload?.source);
      push(t('上一周', 'Previous week'), `${fmtText(payload?.previous_week_start)} ~ ${fmtText(payload?.previous_week_end)}`);
      push(t('下一周', 'Next week'), `${fmtText(payload?.next_week_start)} ~ ${fmtText(payload?.next_week_end)}`);
    } else if (action === 'timecard_refresh') {
      summary = t('打卡页面已刷新', 'Timecard refreshed');
      push(t('来源', 'Source'), payload?.source);
      push(t('周', 'Week'), `${fmtText(payload?.week_start)} ~ ${fmtText(payload?.week_end)}`);
    } else if (action === 'admin_page_switch') {
      summary = `${fmtText(payload?.previous_page)} -> ${fmtText(payload?.next_page)}`;
      push(t('来源', 'Source'), payload?.source);
    }

    return { summary, details };
  };

  const formatCellAuditTime = (value: string | null | undefined) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '-';
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return raw;
    return dt.toLocaleString(locale, { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const renderAuditSummary = (summary: string) => {
    const text = String(summary ?? '').trim();
    const labeledArrowMatch = text.match(/^(.+?):\s*(.+?)\s*->\s*(.+)$/);
    if (labeledArrowMatch) {
      const titleText = String(labeledArrowMatch[1] ?? '').trim() || '-';
      const fromText = String(labeledArrowMatch[2] ?? '').trim() || '-';
      const toText = String(labeledArrowMatch[3] ?? '').trim() || '-';
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] leading-4">
          <span className="text-slate-100">{titleText}</span>
          <span className="rounded-md border border-white/20 bg-white/5 px-1.5 py-0.5 text-slate-200">{fromText}</span>
          <span className="font-semibold text-cyan-300">→</span>
          <span className="rounded-md border border-neon/40 bg-neon/15 px-1.5 py-0.5 font-semibold text-neon">{toText}</span>
        </span>
      );
    }

    const arrowMatch = text.match(/^(.+?)\s*->\s*(.+)$/);
    if (!arrowMatch) {
      return <span className="whitespace-normal text-[11px] leading-4 text-slate-100">{text || '-'}</span>;
    }
    const fromText = String(arrowMatch[1] ?? '').trim() || '-';
    const toText = String(arrowMatch[2] ?? '').trim() || '-';
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] leading-4">
        <span className="rounded-md border border-white/20 bg-white/5 px-1.5 py-0.5 text-slate-200">{fromText}</span>
        <span className="font-semibold text-cyan-300">→</span>
        <span className="rounded-md border border-neon/40 bg-neon/15 px-1.5 py-0.5 font-semibold text-neon">{toText}</span>
      </span>
    );
  };

  const isUndoableAuditRow = (row: AuditRow) => {
    const action = String(row?.action ?? '').trim();
    return (
      action === 'employee_delete' ||
      action === 'schedule_work' ||
      action === 'schedule_fixed_work' ||
      action === 'schedule_rest' ||
      action === 'schedule_temp_work' ||
      action === 'schedule_planned_temp_work' ||
      action === 'schedule_temp_rest' ||
      action === 'schedule_planned_temp_rest' ||
      action === 'schedule_leave' ||
      action === 'schedule_planned_leave' ||
      action === 'schedule_clear'
    );
  };

  const undoneAuditIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const row of auditRows) {
      const action = String(row?.action ?? '').trim();
      if (action !== 'audit_undo') continue;
      const payload = ((row?.payload ?? {}) as Record<string, unknown>) ?? {};
      const sourceAuditId = String(payload.source_audit_id ?? '').trim();
      if (sourceAuditId) set.add(sourceAuditId);
    }
    return set;
  }, [auditRows]);

  const isAuditRowUndone = (row: AuditRow) => {
    const id = String(row?.id ?? '').trim();
    if (!id) return false;
    return undoneAuditIdSet.has(id);
  };

  const undoAuditRow = async (row: AuditRow) => {
    if (!auditCanOperate) {
      setStatus({ tone: 'error', message: t('日志模块当前为只读。', 'Audit is read-only.') });
      return;
    }
    if (!supabase) {
      setStatus({ tone: 'error', message: 'Missing Supabase configuration.' });
      return;
    }
    if (!isUndoableAuditRow(row)) {
      setStatus({ tone: 'error', message: t('该日志暂不支持撤销。', 'This log item is not undoable yet.') });
      return;
    }
    if (isAuditRowUndone(row)) {
      setStatus({ tone: 'error', message: t('该日志已撤销。', 'This log entry is already undone.') });
      return;
    }

    const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
    const payload = ((row.payload ?? {}) as Record<string, unknown>) ?? {};
    const action = String(row.action ?? '').trim();
    if (action === 'employee_delete') {
      const staffFromPayload = normalizeStaffId(String(payload.staff_id ?? row.staff_id ?? '').trim());
      if (!staffFromPayload) {
        setStatus({ tone: 'error', message: t('日志缺少工号，无法撤销。', 'Missing staff id in log payload.') });
        return;
      }

      const rowCreatedAtMs = Number.isFinite(Date.parse(String(row.created_at ?? '')))
        ? Date.parse(String(row.created_at ?? ''))
        : Number.MAX_SAFE_INTEGER;
      const pickSnapshot = (raw: Record<string, unknown> | null | undefined) => {
        const p = (raw ?? {}) as Record<string, unknown>;
        const after = ((p.after ?? null) as Record<string, unknown> | null) ?? null;
        const before = ((p.before ?? null) as Record<string, unknown> | null) ?? null;
        const shiftValue =
          normalizeShiftValue(String(p.shift ?? after?.shift ?? before?.shift ?? '').trim()) || '';
        return {
          name:
            String(p.name ?? after?.name ?? before?.name ?? '').trim() ||
            '',
          agency:
            String(p.agency ?? after?.agency ?? before?.agency ?? '').trim() ||
            '',
          position:
            String(p.position ?? after?.position ?? before?.position ?? '').trim() ||
            '',
          shift: shiftValue
        };
      };

      let resolved = pickSnapshot(payload);
      const needLookup = !resolved.name || !resolved.agency || !resolved.position;
      if (needLookup || !resolved.shift) {
        // 1) Try currently loaded logs first.
        for (const candidate of auditRows) {
          const cStaff = normalizeStaffId(String(candidate.staff_id ?? '').trim());
          if (cStaff !== staffFromPayload) continue;
          const cAction = String(candidate.action ?? '').trim();
          if (cAction !== 'employee_update' && cAction !== 'employee_upsert' && cAction !== 'employee_delete') continue;
          const cMs = Number.isFinite(Date.parse(String(candidate.created_at ?? '')))
            ? Date.parse(String(candidate.created_at ?? ''))
            : 0;
          if (cMs >= rowCreatedAtMs) continue;
          const snap = pickSnapshot(((candidate as any).payload ?? {}) as Record<string, unknown>);
          if (!resolved.name && snap.name) resolved.name = snap.name;
          if (!resolved.agency && snap.agency) resolved.agency = snap.agency;
          if (!resolved.position && snap.position) resolved.position = snap.position;
          if (!resolved.shift && snap.shift) resolved.shift = snap.shift;
          if (resolved.name && resolved.agency && resolved.position && resolved.shift) break;
        }
      }
      if ((!resolved.name || !resolved.agency || !resolved.position || !resolved.shift) && supabase) {
        // 2) Query DB logs for older entries if local page doesn't include enough history.
        const historyRes = await supabase
          .from(AUDIT_TABLE)
          .select('id, created_at, action, payload, staff_id')
          .eq('staff_id', staffFromPayload)
          .in('action', ['employee_update', 'employee_upsert', 'employee_delete'] as any)
          .order('created_at', { ascending: false })
          .limit(300);
        if (!historyRes.error) {
          for (const candidate of (((historyRes.data as any[]) ?? []) as Array<Record<string, unknown>>)) {
            const cMs = Number.isFinite(Date.parse(String(candidate.created_at ?? '')))
              ? Date.parse(String(candidate.created_at ?? ''))
              : 0;
            if (cMs >= rowCreatedAtMs) continue;
            const snap = pickSnapshot(((candidate.payload ?? null) as Record<string, unknown> | null) ?? null);
            if (!resolved.name && snap.name) resolved.name = snap.name;
            if (!resolved.agency && snap.agency) resolved.agency = snap.agency;
            if (!resolved.position && snap.position) resolved.position = snap.position;
            if (!resolved.shift && snap.shift) resolved.shift = snap.shift;
            if (resolved.name && resolved.agency && resolved.position && resolved.shift) break;
          }
        }
      }
      const name = resolved.name;
      const agency = resolved.agency;
      const position = resolved.position;
      const shift = resolved.shift as '' | 'early' | 'late';
      const ok = await askConfirm(
        t(
          `确定撤销删除员工 ${staffFromPayload} 吗？将仅恢复员工信息（不恢复排班）。`,
          `Undo delete for ${staffFromPayload}? This restores employee info only (not schedules).`
        ),
        t('撤销确认', 'Undo Confirmation')
      );
      if (!ok) return;

      await runLocked('audit_undo_employee_delete', async () => {
        const mode = await resolveEmployeeColumnMode();
        const payloadRow =
          mode === 'cased'
            ? {
                staff_id: staffFromPayload,
                name: name || null,
                Agency: agency || null,
                Position: position || null,
                shift: shift || null,
                active: true,
                terminated_at: null
              }
            : {
                staff_id: staffFromPayload,
                name: name || null,
                agency: agency || null,
                position: position || null,
                shift: shift || null,
                active: true,
                terminated_at: null
              };
        const restoreRes = await supabase.from(EMPLOYEE_TABLE).upsert([payloadRow as any], { onConflict: 'staff_id' });
        if (restoreRes.error) {
          if (/active|terminated_at/i.test(String(restoreRes.error.message ?? ''))) {
            const fallbackRow =
              mode === 'cased'
                ? {
                    staff_id: staffFromPayload,
                    name: name || null,
                    Agency: agency || null,
                    Position: position || null,
                    shift: shift || null
                  }
                : {
                    staff_id: staffFromPayload,
                    name: name || null,
                    agency: agency || null,
                    position: position || null,
                    shift: shift || null
                  };
            const fallbackRes = await supabase.from(EMPLOYEE_TABLE).upsert([fallbackRow as any], { onConflict: 'staff_id' });
            if (fallbackRes.error) {
              setStatus({ tone: 'error', message: `${t('撤销失败：', 'Undo failed: ')}${fallbackRes.error.message}` });
              return;
            }
          } else {
            setStatus({ tone: 'error', message: `${t('撤销失败：', 'Undo failed: ')}${restoreRes.error.message}` });
            return;
          }
        }
        setEmployees((prev) => {
          const next = [...prev];
          const idx = next.findIndex((e) => normalizeStaffId(String(e.staff_id ?? '').trim()) === staffFromPayload);
          const localRow: EmployeeRow = {
            staff_id: staffFromPayload,
            name: name || '',
            agency: agency || '',
            position: position || '',
            shift: shift || ''
          };
          if (idx >= 0) next[idx] = { ...next[idx], ...localRow };
          else next.push(localRow);
          next.sort((a, b) => String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''), 'en-US'));
          return next;
        });
        await writeAudit({
          action: 'audit_undo',
          staffId: staffFromPayload,
          target: EMPLOYEE_TABLE,
          payload: {
            source_audit_id: row.id ?? null,
            source_action: row.action ?? null,
            restored_employee_only: true
          }
        });
        setStatus({ tone: 'success', message: t('已恢复员工信息（未恢复排班）。', 'Employee info restored (schedules not restored).') });
        await fetchAudit({ search: auditSearch });
      });
      return;
    }

    const templateDate = String(payload.template_date ?? '').trim();
    const fromStateRaw = String(payload.from_state ?? '').trim();
    if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(templateDate)) {
      setStatus({ tone: 'error', message: t('日志缺少必要信息，无法撤销。', 'Log payload is incomplete and cannot be undone.') });
      return;
    }
    const validState = (value: string): value is 'empty' | ScheduleBaseState =>
      value === 'empty' ||
      value === 'new' ||
      value === 'work' ||
      value === 'fixed_work' ||
      value === 'temp_work' ||
      value === 'planned_temp_work' ||
      value === 'leave' ||
      value === 'planned_leave' ||
      value === 'temp_rest' ||
      value === 'planned_temp_rest' ||
      value === 'rest';
    if (!validState(fromStateRaw)) {
      setStatus({ tone: 'error', message: t('日志状态无效，无法撤销。', 'Invalid previous state in log payload.') });
      return;
    }

    const ok = await askConfirm(
      t(
        `确定撤销这条日志吗？员工 ${staff} 将回到 ${fromStateRaw} 状态。`,
        `Undo this log entry? Staff ${staff} will be reverted to state "${fromStateRaw}".`
      ),
      t('撤销确认', 'Undo Confirmation')
    );
    if (!ok) return;

    await runLocked('audit_undo', async () => {
      const nowIso = new Date(serverTime).toISOString();
      const isThisWeekBucket =
        templateDate >= '2000-01-03' && templateDate <= '2000-01-09';
      const nextWeekTemplateDate = isThisWeekBucket
        ? toDateOnly(addDays(new Date(`${templateDate}T00:00:00`), 7))
        : null;

      if (fromStateRaw === 'empty') {
        const delRes = await supabase.from(SCHEDULE_TABLE).delete().eq('staff_id', staff).eq('date', templateDate);
        if (delRes.error) {
          setStatus({ tone: 'error', message: `${t('撤销失败：', 'Undo failed: ')}${delRes.error.message}` });
          return;
        }
        if (nextWeekTemplateDate) {
          await supabase.from(SCHEDULE_TABLE).delete().eq('staff_id', staff).eq('date', nextWeekTemplateDate);
        }
        setScheduleRows((prev) =>
          prev.filter((item) => {
            const itemStaff = normalizeStaffId(String(item.staff_id ?? '').trim());
            const itemDate = String(item.date ?? '').trim();
            return !(itemStaff === staff && (itemDate === templateDate || itemDate === nextWeekTemplateDate));
          })
        );
      } else {
        const fromPosition =
          normalizePositionKey(String(payload.from_position ?? payload.position ?? '').trim()) ||
          normalizePositionKey(
            String(
              employees.find((e) => normalizeStaffId(String(e.staff_id ?? '').trim()) === staff)?.position ?? ''
            ).trim()
          ) ||
          ALLOWED_POSITIONS[0];

        const basePayload: Record<string, unknown> = {
          staff_id: staff,
          date: templateDate,
          position: fromPosition,
          note: getScheduleNoteFromBaseState(fromStateRaw),
          operator: user?.email ?? null,
          updated_at: nowIso
        };

        let upsertRes = await supabase.from(SCHEDULE_TABLE).upsert([basePayload as any], { onConflict: 'staff_id,date' });
        if (upsertRes.error && /null value in column "shift"/i.test(String(upsertRes.error.message ?? ''))) {
          const employeeShift =
            employeeShiftByStaffId[staff]?.shift ||
            normalizeShiftValue(
              String(employees.find((e) => normalizeStaffId(String(e.staff_id ?? '').trim()) === staff)?.shift ?? '').trim()
            ) ||
            'early';
          upsertRes = await supabase
            .from(SCHEDULE_TABLE)
            .upsert([{ ...basePayload, shift: employeeShift } as any], { onConflict: 'staff_id,date' });
        }
        if (upsertRes.error) {
          setStatus({ tone: 'error', message: `${t('撤销失败：', 'Undo failed: ')}${upsertRes.error.message}` });
          return;
        }
        if (nextWeekTemplateDate) {
          const nextWeekPayload = {
            staff_id: staff,
            date: nextWeekTemplateDate,
            position: basePayload.position,
            note: basePayload.note,
            operator: basePayload.operator,
            updated_at: nowIso
          };
          await supabase.from(SCHEDULE_TABLE).upsert([nextWeekPayload as any], { onConflict: 'staff_id,date' });
        }

        const localRow: ScheduleRow = {
          staff_id: staff,
          date: templateDate,
          position: fromPosition,
          note: getScheduleNoteFromBaseState(fromStateRaw),
          operator: user?.email ?? null,
          updated_at: nowIso
        };
        setScheduleRows((prev) => {
          let replaced = false;
          const next = prev.map((item) => {
            const itemStaff = normalizeStaffId(String(item.staff_id ?? '').trim());
            const itemDate = String(item.date ?? '').trim();
            if (itemStaff === staff && itemDate === templateDate) {
              replaced = true;
              return { ...item, ...localRow };
            }
            return item;
          });
          if (!replaced) next.push(localRow);
          return next;
        });
      }

      await writeAudit({
        action: 'audit_undo',
        staffId: staff,
        target: SCHEDULE_TABLE,
        payload: {
          source_audit_id: row.id ?? null,
          source_action: row.action ?? null,
          template_date: templateDate,
          restored_state: fromStateRaw
        }
      });
      setStatus({ tone: 'success', message: t('已撤销该日志操作。', 'Log operation has been undone.') });
      await fetchAudit({ search: auditSearch });
    });
  };

  const persistLateAttendanceMarks = async (options: {
    rangeStart: string;
    rangeEnd: string;
    staffIds: string[];
    rows: LateMarkPersistRow[];
    actor: string | null;
  }) => {
    if (!supabase) return;
    const { rangeStart, rangeEnd, staffIds, rows, actor } = options;

    const persistLateMarksFallback = async () => {
      const existingLateRows: Array<{ staff_id: string; work_date: string; source: string }> = [];
      for (const batch of chunk(staffIds, 200)) {
        const existingRes = await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .select('staff_id, work_date, source')
          .in('staff_id', batch as any)
          .gte('work_date', rangeStart)
          .lte('work_date', rangeEnd)
          .eq('mark_type', 'late');
        if (existingRes.error) throw new Error(existingRes.error.message);
        for (const row of (((existingRes.data as any[]) ?? []) as Array<{ staff_id?: string; work_date?: string; source?: string }>)) {
          const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
          const workDate = String(row.work_date ?? '').trim();
          if (!staffId || !workDate) continue;
          existingLateRows.push({
            staff_id: staffId,
            work_date: workDate,
            source: String(row.source ?? '').trim()
          });
        }
      }

      const protectedManualKeySet = new Set(
        existingLateRows
          .filter((row) => row.source && row.source !== 'late_auto')
          .map((row) => `${row.staff_id}__${row.work_date}`)
      );
      const marksToPersist = rows.filter(
        (row) => !protectedManualKeySet.has(`${row.staff_id}__${row.work_date}`)
      );

      if (marksToPersist.length > 0) {
        for (const batch of chunk(marksToPersist, 500)) {
          const upsertRes = await supabase.from(ATTENDANCE_MARKS_TABLE).upsert(batch as any, {
            onConflict: 'staff_id,work_date,mark_type'
          });
          if (upsertRes.error) throw new Error(upsertRes.error.message);
        }
      }

      const staleDeletePlan = buildStaleLateAutoDeletePlan({
        existingRows: existingLateRows.filter((row) => row.source === 'late_auto'),
        nextRows: marksToPersist.map((row) => ({
          staff_id: row.staff_id,
          work_date: row.work_date
        }))
      });
      for (const item of staleDeletePlan) {
        for (const workDateBatch of chunk(item.workDates, 50)) {
          const clearRes = await supabase
            .from(ATTENDANCE_MARKS_TABLE)
            .delete()
            .eq('staff_id', item.staffId)
            .in('work_date', workDateBatch as any)
            .eq('mark_type', 'late')
            .eq('source', 'late_auto');
          if (clearRes.error) throw new Error(clearRes.error.message);
        }
      }
    };

    const rpcRes = await supabase.rpc('sync_late_attendance_marks', {
      p_range_start: rangeStart,
      p_range_end: rangeEnd,
      p_staff_ids: staffIds,
      p_rows: rows,
      p_actor: actor
    });
    if (rpcRes.error) {
      if (isMissingLateSyncRpcError(rpcRes.error)) {
        await persistLateMarksFallback();
        return;
      }
      throw new Error(rpcRes.error.message);
    }
  };

  const syncLateMarksForWeek = async (options: {
    weekStart: Date;
    targetEmployees: Array<
      Pick<EmployeeRow, 'staff_id' | 'position' | 'shift' | 'shift_time' | 'terminated_at' | 'name' | 'agency'> & {
        ShiftTime?: string | null;
        terminatedAt?: string | null;
      }
    >;
    scheduleRowsForWeek?: ScheduleRow[];
    persist?: boolean;
  }): Promise<SyncLateMarksForWeekResult> => {
    const empty: SyncLateMarksForWeekResult = {
      lateByStaffDayKey: {},
      persistRows: [],
      targetStaffIds: [],
      rangeStart: '',
      rangeEnd: ''
    };
    if (!supabase) return empty;

    const weekStart = new Date(options.weekStart);
    if (Number.isNaN(weekStart.getTime())) return empty;
    const weekDateKeys = Array.from({ length: 7 }, (_, idx) => toDateOnly(addDays(weekStart, idx)));
    const weekStartKey = weekDateKeys[0] ?? '';
    const weekEndKey = weekDateKeys[6] ?? '';
    if (!weekStartKey || !weekEndKey) return empty;

    const profileByStaff = new Map<
      string,
      {
        position: string;
        shift: '' | 'early' | 'late';
        shiftTime: string;
        terminatedAt: string | null;
        name: string;
        agency: string;
      }
    >();
    for (const employee of options.targetEmployees ?? []) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      profileByStaff.set(staff, {
        position: String(employee.position ?? '').trim(),
        shift: normalizeShiftValue(String(employee.shift ?? '').trim()),
        shiftTime: normalizeShiftTimeValue((employee as any).shift_time ?? (employee as any).ShiftTime ?? ''),
        terminatedAt: String(employee.terminated_at ?? employee.terminatedAt ?? '').trim() || null,
        name: String(employee.name ?? '').trim(),
        agency: String(employee.agency ?? '').trim()
      });
    }
    const targetStaffIds = Array.from(profileByStaff.keys());
    if (targetStaffIds.length === 0) return empty;

    const fetchScheduleRowsPaged = async (buildQuery: (from: number, to: number) => any) => {
      const res = await fetchAllPagedRows<ScheduleRow>({
        pageSize: 2000,
        fetchPage: async (from, to) => await buildQuery(from, to)
      });
      return {
        rows: res.rows.map((row) => ({
          ...row,
          shift: normalizeShiftValue(String((row as any).shift ?? '').trim()) || null,
          position: String((row as any).position ?? '').trim()
        })),
        error: res.error
      };
    };

    const fetchEmployeeShiftByStaffIds = async (staffIds: string[]) => {
      const shiftByStaff = new Map<string, '' | 'early' | 'late'>();
      if (staffIds.length === 0) return shiftByStaff;
      const mode = await resolveEmployeeColumnMode();
      for (const batch of chunk(staffIds, 200)) {
        const select =
          mode === 'cased'
            ? 'staff_id, shift, shift_time, "Position", name, "Agency", terminated_at'
            : 'staff_id, shift, shift_time, position, name, agency, terminated_at';
        const res = await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', batch as any);
        if (res.error) throw new Error(res.error.message);
        for (const row of ((res.data as any[]) ?? [])) {
          const staff = normalizeStaffId(String(row?.staff_id ?? '').trim());
          if (!staff) continue;
          shiftByStaff.set(staff, normalizeShiftValue(String(row?.shift ?? '').trim()));
          if (!profileByStaff.has(staff)) {
            profileByStaff.set(staff, {
              position: String(row?.position ?? row?.Position ?? '').trim(),
              shift: normalizeShiftValue(String(row?.shift ?? '').trim()),
              shiftTime: normalizeShiftTimeValue(row?.shift_time ?? ''),
              terminatedAt: String(row?.terminated_at ?? '').trim() || null,
              name: String(row?.name ?? '').trim(),
              agency: String(row?.agency ?? row?.Agency ?? '').trim()
            });
          }
        }
      }
      return shiftByStaff;
    };

    let weekScheduleRows = options.scheduleRowsForWeek;
    if (!weekScheduleRows) {
      const weekScheduleRes = await fetchScheduleRowsPaged((from, to) =>
        supabase
          .from(SCHEDULE_TABLE)
          .select('staff_id, date, position, note')
          .in('staff_id', targetStaffIds as any)
          .gte('date', weekStartKey)
          .lte('date', weekEndKey)
          .range(from, to)
      );
      if (weekScheduleRes.error) throw new Error(weekScheduleRes.error);
      weekScheduleRows = weekScheduleRes.rows;
    }

    const initialShiftByStaff = await fetchEmployeeShiftByStaffIds(targetStaffIds);

    const weekScheduleByKey = new Map<string, ScheduleRow>();
    for (const row of weekScheduleRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const workDate = String(row.date ?? '').trim();
      if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) continue;
      weekScheduleByKey.set(`${staff}__${workDate}`, row);
    }

    const targetWorkDays: Array<{ staff: string; workDate: string; shift: 'early' | 'late'; position: string; shiftTime: string }> = [];
    for (const workDate of weekDateKeys) {
      for (const staff of targetStaffIds) {
        const row = weekScheduleByKey.get(`${staff}__${workDate}`);
        if (!row) continue;
        const state = getScheduleBaseStateFromNote(row.note);
        if (!isWorkingScheduleBaseState(state)) continue;
        const profile = profileByStaff.get(staff);
        const shift = initialShiftByStaff.get(staff) || profile?.shift || 'early';
        const position = String((row as any).position ?? profile?.position ?? '').trim();
        if (!position) continue;
        const terminatedAt = String(profile?.terminatedAt ?? '').trim();
        if (terminatedAt) {
          const terminatedDate = toDateOnly(new Date(terminatedAt));
          if (terminatedDate && workDate >= terminatedDate) continue;
        }
        targetWorkDays.push({ staff, workDate, shift, position, shiftTime: profile?.shiftTime ?? '' });
      }
    }

    const relevantPositions = Array.from(
      new Set([
        ...targetWorkDays.map((item) => item.position).filter(Boolean),
        ...Array.from(profileByStaff.values())
          .map((profile) => String(profile.position ?? '').trim())
          .filter(Boolean)
      ])
    );
    const relevantShifts = Array.from(
      new Set([
        ...targetWorkDays.map((item) => item.shift).filter(Boolean),
        ...Array.from(profileByStaff.values())
          .map((profile) => profile.shift)
          .filter((shift): shift is 'early' | 'late' => shift === 'early' || shift === 'late')
      ])
    ) as Array<'early' | 'late'>;
    const lookbackStartKey = toDateOnly(addDays(weekStart, -LATE_LOOKBACK_DAYS));

    const [personalHistoryRes, teamHistoryRes] = await Promise.all([
      fetchScheduleRowsPaged((from, to) =>
        supabase
          .from(SCHEDULE_TABLE)
          .select('staff_id, date, position, note')
          .in('staff_id', targetStaffIds as any)
          .gte('date', lookbackStartKey)
          .lte('date', weekEndKey)
          .range(from, to)
      ),
      relevantPositions.length === 0 || relevantShifts.length === 0
        ? Promise.resolve({ rows: [] as ScheduleRow[], error: null as string | null })
        : fetchScheduleRowsPaged((from, to) =>
            supabase
              .from(SCHEDULE_TABLE)
              .select('staff_id, date, position, note')
              .in('position', relevantPositions as any)
              .gte('date', lookbackStartKey)
              .lte('date', weekEndKey)
              .range(from, to)
          )
    ]);
    if (personalHistoryRes.error) throw new Error(personalHistoryRes.error);
    if (teamHistoryRes.error) throw new Error(teamHistoryRes.error);

    const historicalScheduleRows = new Map<string, ScheduleRow>();
    for (const row of [...personalHistoryRes.rows, ...teamHistoryRes.rows]) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const workDate = String(row.date ?? '').trim();
      if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) continue;
      const position = String((row as any).position ?? '').trim();
      historicalScheduleRows.set(`${staff}__${workDate}__${position}`, {
        ...row,
        position
      });
    }

    const historicalStaffIds = Array.from(
      new Set([
        ...targetStaffIds,
        ...Array.from(historicalScheduleRows.values())
          .map((row) => normalizeStaffId(String(row.staff_id ?? '').trim()))
          .filter(Boolean)
      ])
    );
    const historicalShiftByStaff = await fetchEmployeeShiftByStaffIds(historicalStaffIds);

    const fetchPunchRows = async (staffIds: string[], startIso: string, endIso: string) => {
      if (staffIds.length === 0) return { rows: [] as any[], error: null as string | null };
      const all: any[] = [];
      for (const batch of chunk(staffIds, 200)) {
        const base = () =>
          supabase
            .from('ob_punches')
            .select('staff_id, action, created_at, id')
            .in('staff_id', batch as any)
            .gte('created_at', startIso)
            .lt('created_at', endIso);
        const batchRes = await fetchAllPagedRows<any>({
          pageSize: 1000,
          fetchPage: async (from, to) => {
            const attemptCreatedAt = await base().order('created_at', { ascending: true }).range(from, to);
            return attemptCreatedAt.error ? await base().order('id', { ascending: true }).range(from, to) : attemptCreatedAt;
          }
        });
        if (batchRes.error) return { rows: [] as any[], error: batchRes.error };
        all.push(...batchRes.rows);
      }
      return { rows: all, error: null as string | null };
    };

    const historyStartRange = getWorkDateRange(lookbackStartKey);
    const historyEndRange = getWorkDateRange(toDateOnly(addDays(weekStart, 7)));
    const punchesRes = await fetchPunchRows(
      historicalStaffIds,
      historyStartRange?.start.toISOString() ?? new Date(`${lookbackStartKey}T00:00:00`).toISOString(),
      historyEndRange?.start.toISOString() ?? new Date(`${weekEndKey}T23:59:59.999`).toISOString()
    );
    if (punchesRes.error) throw new Error(punchesRes.error);

    const firstInByStaffDay = new Map<string, Date>();
    const punchCountByStaffDay = new Map<string, number>();
    for (const row of punchesRes.rows ?? []) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const action = String(row.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
      const atRaw = String(row.created_at ?? '').trim();
      if (!staff || !atRaw) continue;
      const at = new Date(atRaw);
      if (Number.isNaN(at.getTime())) continue;
      const workDate = toOperationalWorkDate(atRaw, action);
      if (!workDate) continue;
      const key = `${staff}__${workDate}`;
      punchCountByStaffDay.set(key, Number(punchCountByStaffDay.get(key) ?? 0) + 1);
      if (action !== 'IN') continue;
      const prev = firstInByStaffDay.get(key);
      if (!prev || at.getTime() < prev.getTime()) firstInByStaffDay.set(key, at);
    }

    const manualAuditRows: AuditRow[] = [];
    for (const batch of chunk(historicalStaffIds, 200)) {
      const res = await supabase
        .from(AUDIT_TABLE)
        .select('staff_id, action, created_at, payload')
        .in('staff_id', batch as any)
        .in('action', ['punch_manual_add', 'punch_manual_edit', 'punch_manual_delete'] as any)
        .gte('created_at', new Date(`${lookbackStartKey}T00:00:00`).toISOString());
      if (res.error) throw new Error(res.error.message);
      manualAuditRows.push(...(((res.data as any[]) ?? []) as AuditRow[]));
    }
    const manualDayKeys = new Set<string>();
    for (const row of manualAuditRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) continue;
      for (const workDate of extractPunchAuditWorkDates(row)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) continue;
        manualDayKeys.add(`${staff}__${workDate}`);
      }
    }

    const targetWorkDayKeySet = new Set(targetWorkDays.map((item) => `${item.staff}__${item.workDate}`));
    for (const workDate of weekDateKeys) {
      for (const staff of targetStaffIds) {
        const dayKey = `${staff}__${workDate}`;
        if (targetWorkDayKeySet.has(dayKey)) continue;
        if (!firstInByStaffDay.has(dayKey)) continue;
        const row = weekScheduleByKey.get(dayKey);
        if (row) {
          const state = getScheduleBaseStateFromNote(row.note);
          if (!isWorkingScheduleBaseState(state)) continue;
        }
        const profile = profileByStaff.get(staff);
        const shift = initialShiftByStaff.get(staff) || profile?.shift || 'early';
        const position = String((row as any)?.position ?? profile?.position ?? '').trim();
        if (!position) continue;
        const terminatedAt = String(profile?.terminatedAt ?? '').trim();
        if (terminatedAt) {
          const terminatedDate = toDateOnly(new Date(terminatedAt));
          if (terminatedDate && workDate >= terminatedDate) continue;
        }
        targetWorkDays.push({ staff, workDate, shift, position, shiftTime: profile?.shiftTime ?? '' });
        targetWorkDayKeySet.add(dayKey);
      }
    }

    const personalSamplesByKey = new Map<string, LateSample[]>();
    const teamSamplesByKey = new Map<string, LateSample[]>();
    const punchOnlyPersonalSamplesByStaff = new Map<string, LateSample[]>();
    for (const row of historicalScheduleRows.values()) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const workDate = String(row.date ?? '').trim();
      if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) continue;
      const state = getScheduleBaseStateFromNote(row.note);
      if (!isWorkingScheduleBaseState(state)) continue;
      if (manualDayKeys.has(`${staff}__${workDate}`)) continue;
      const firstIn = firstInByStaffDay.get(`${staff}__${workDate}`);
      const punchCount = Number(punchCountByStaffDay.get(`${staff}__${workDate}`) ?? 0);
      if (!firstIn || punchCount < LATE_MIN_VALID_PUNCH_COUNT) continue;
      const shift = historicalShiftByStaff.get(staff) || profileByStaff.get(staff)?.shift || '';
      const position = String((row as any).position ?? '').trim();
      if (!shift || !position) continue;
      const firstInMinutes = getClockMinutesFromDate(firstIn);
      const sample: LateSample = { workDate, firstInMinutes };
      const personalKey = `${staff}__${shift}__${position}`;
      const teamKey = `${shift}__${position}`;
      if (!personalSamplesByKey.has(personalKey)) personalSamplesByKey.set(personalKey, []);
      personalSamplesByKey.get(personalKey)!.push(sample);
      if (!teamSamplesByKey.has(teamKey)) teamSamplesByKey.set(teamKey, []);
      teamSamplesByKey.get(teamKey)!.push(sample);
    }
    for (const [key, firstIn] of firstInByStaffDay.entries()) {
      const [staff, workDate] = String(key).split('__');
      if (!staff || !workDate) continue;
      if (manualDayKeys.has(`${staff}__${workDate}`)) continue;
      const punchCount = Number(punchCountByStaffDay.get(`${staff}__${workDate}`) ?? 0);
      if (punchCount < LATE_MIN_VALID_PUNCH_COUNT) continue;
      const firstInMinutes = getClockMinutesFromDate(firstIn);
      if (!punchOnlyPersonalSamplesByStaff.has(staff)) punchOnlyPersonalSamplesByStaff.set(staff, []);
      punchOnlyPersonalSamplesByStaff.get(staff)!.push({ workDate, firstInMinutes });
    }

    const marksToInsert: LateMarkPersistRow[] = [];
    const lateByStaffDayKey: Record<string, LateMarkView> = {};
    const nowIso = new Date(serverTime).toISOString();
    for (const item of targetWorkDays) {
      const dayKey = `${item.staff}__${item.workDate}`;
      const firstIn = firstInByStaffDay.get(dayKey);
      if (!firstIn) continue;
      const normalizedShiftTime = normalizeShiftTimeValue(item.shiftTime);
      const shiftTimeMinutes = parseClockTextToMinutes(normalizedShiftTime);
      const fallbackPlannedStartMinutes = parseClockTextToMinutes(
        resolveShiftStartTime(item.shift, item.position, item.shiftTime)
      );
      if (!Number.isFinite(fallbackPlannedStartMinutes)) continue;
      const usesEmployeeShiftTime = Number.isFinite(shiftTimeMinutes);
      const plannedStartMinutes = usesEmployeeShiftTime ? (shiftTimeMinutes as number) : (fallbackPlannedStartMinutes as number);
      const decision = evaluateLateDecision({
        firstInMinutes: getClockMinutesFromDate(firstIn),
        personalSamples: [],
        teamSamples: [],
        shift: item.shift,
        plannedStartMinutes: plannedStartMinutes as number,
        graceMinutes: LATE_GRACE_MINUTES,
        guardrailBufferMinutes: LATE_GUARDRAIL_BUFFER_MINUTES
      });
      if (!decision.isLate) continue;
      const view: LateMarkView = {
        minutesLate: decision.minutesLate,
        source: decision.source,
        roundingFamily: decision.roundingFamily,
        learnedExpectedStartRaw: formatClockMinutes(decision.learnedExpectedStartMinutesRaw),
        learnedExpectedStartRounded: formatClockMinutes(decision.learnedExpectedStartMinutesRounded),
        guardrailExpectedStart: formatClockMinutes(decision.guardrailExpectedStartMinutes),
        finalExpectedStart: formatClockMinutes(decision.finalExpectedStartMinutes),
        firstIn: formatClockMinutes(decision.firstInMinutes),
        sampleCount: decision.sampleCount
      };
      lateByStaffDayKey[dayKey] = view;
      marksToInsert.push({
        staff_id: item.staff,
        work_date: item.workDate,
        mark_type: 'late',
        source: 'late_auto',
        operator: user?.email ?? null,
        payload: {
          reason: usesEmployeeShiftTime ? 'employee_shift_time' : 'schedule_fallback',
          learned_expected_start_raw: view.learnedExpectedStartRaw,
          learned_expected_start_rounded: view.learnedExpectedStartRounded,
          guardrail_expected_start: view.guardrailExpectedStart,
          final_expected_start: view.finalExpectedStart,
          first_in: view.firstIn,
          minutes_late: view.minutesLate,
          sample_count: view.sampleCount,
          baseline_source: view.source,
          rounding_family: view.roundingFamily,
          shift: item.shift,
          position: item.position
        },
        updated_at: nowIso
      });
    }

    if (options.persist !== false) {
      try {
        await persistLateAttendanceMarks({
          rangeStart: weekStartKey,
          rangeEnd: weekEndKey,
          staffIds: targetStaffIds,
          rows: marksToInsert,
          actor: user?.email ?? null
        });
      } catch (error) {
        console.warn('[late] persist late marks failed:', error);
      }
    }

    return {
      lateByStaffDayKey,
      persistRows: marksToInsert,
      targetStaffIds,
      rangeStart: weekStartKey,
      rangeEnd: weekEndKey
    };
  };

  const fetchTimecard = async ({
    reset,
    weekOffset,
    search,
    agency,
    position,
    missingEmployeeOnly,
    lockUi,
    deferLateSync
  }: {
    reset: boolean;
    weekOffset?: number;
    search?: string;
    agency?: string;
    position?: string;
    missingEmployeeOnly?: boolean;
    lockUi?: boolean;
    deferLateSync?: boolean;
  }) => {
    if (!supabase) {
      setTimecardError('缺少 Supabase 配置。');
      return;
    }

    const requestId = ++timecardFetchSeqRef.current;
    const isStale = () => requestId !== timecardFetchSeqRef.current;

    const baseWeekStart = startOfWeekMonday(serverTime);
    const offset = weekOffset ?? timecardWeekOffset;
    const weekStart = addDays(baseWeekStart, offset * 7);
    const weekEnd = addDays(weekStart, 7);

    const rangeStart = addDays(weekStart, -1);
    const rangeEnd = addDays(weekEnd, 1);

    const searchValue = (search ?? timecardSearch).trim().replace(/,/g, ' ');
    const agencyValue = (agency ?? timecardAgency).trim();
    const positionValue = (position ?? timecardPosition).trim();
    const missingOnly = missingEmployeeOnly ?? timecardMissingEmployeeOnly;
    const shouldDeferLateSync = deferLateSync ?? true;
    setTimecardLoading(true);
    const finishLoading = () => {
      if (requestId === timecardFetchSeqRef.current) {
        setTimecardLoading(false);
      }
    };

    try {
    const nowMs = serverTime.getTime();
    const closedDayByIndex = Array.from({ length: 7 }, (_, dayIndex) => {
      const { end } = getDayRange(weekStart, dayIndex);
      return end.getTime() <= nowMs;
    });

    const weekStartDate = toDateOnly(weekStart);
    const weekEndDate = toDateOnly(addDays(weekStart, 6));
    const filterEmployeesForView = (
      employees: Array<{ staff_id: string; name: string; agency: string; position: string; shift: '' | 'early' | 'late'; terminatedAt: string | null }>
    ) => {
      const normalizedPositionNeedle = normalizePositionKey(positionValue);
      const normalizedSearchStaff = normalizeStaffId(searchValue);
      const searchTerms = searchValue
        .split(/\s+/g)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      return employees.filter((employee) => {
        if (isScheduleOnlyAgency(String(employee.agency ?? '').trim())) return false;
        if (agencyValue && String(employee.agency ?? '').trim().toLowerCase() !== agencyValue.toLowerCase()) return false;
        if (positionValue) {
          const rowPos = String(employee.position ?? '').trim();
          const rowPosNormalized = normalizePositionKey(rowPos);
          if (normalizedPositionNeedle) {
            if (rowPosNormalized !== normalizedPositionNeedle) return false;
          } else if (!rowPos.toLowerCase().includes(positionValue.toLowerCase())) {
            return false;
          }
        }
        if (searchTerms.length > 0 || normalizedSearchStaff) {
          const hay = [employee.staff_id, employee.name].map((x) => String(x ?? '').toLowerCase()).join(' ');
          const staffHay = normalizeStaffId(String(employee.staff_id ?? ''));
          if (normalizedSearchStaff && !staffHay.includes(normalizedSearchStaff)) {
            const allTermsHit = searchTerms.every((term) => hay.includes(term));
            if (!allTermsHit) return false;
          } else if (searchTerms.length > 0 && !searchTerms.every((term) => hay.includes(term))) {
            return false;
          }
        }
        return true;
      });
    };

    const fetchProfilesByStaffId = async (staffIds: string[]) => {
      if (isStale()) {
        return {
          staffToProfile: new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late'; terminatedAt: string | null }>(),
          error: STALE_TIMECARD_REQUEST
        };
      }
      const staffToProfile = new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late'; terminatedAt: string | null }>();
      if (!supabase) {
        return { staffToProfile, error: 'Missing Supabase config.' };
      }
      if (staffIds.length === 0) {
        return { staffToProfile, error: null as string | null };
      }

      const mode = await resolveEmployeeColumnMode();
      if (isStale()) {
        return {
          staffToProfile: new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late'; terminatedAt: string | null }>(),
          error: STALE_TIMECARD_REQUEST
        };
      }
      const batches = chunk(staffIds, 200);
      for (const batch of batches) {
        const run = async (m: EmployeeColumnMode) => {
          const select = m === 'cased'
            ? 'staff_id, name, "Agency", "Position", shift, terminated_at'
            : 'staff_id, name, agency, position, shift, terminated_at';
          return await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', batch);
        };

        let res = await run(mode);
        if (isStale()) {
          return {
            staffToProfile: new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late'; terminatedAt: string | null }>(),
            error: STALE_TIMECARD_REQUEST
          };
        }
        if (res.error) {
          const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
          employeeColumnModeRef.current = flipped;
          res = await run(flipped);
        }
        if (res.error) {
          return {
            staffToProfile: new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late'; terminatedAt: string | null }>(),
            error: res.error.message
          };
        }

        for (const r of (res.data as any[] | null) ?? []) {
          const staff = String(r.staff_id ?? '').trim();
          if (!staff) continue;
          staffToProfile.set(staff, {
            name: String(r.name ?? '').trim(),
            agency: String(r.agency ?? r.Agency ?? '').trim(),
            position: String(r.position ?? r.Position ?? '').trim(),
            shift: normalizeShiftValue(String(r.shift ?? '').trim()),
            terminatedAt: String((r as any).terminated_at ?? '').trim() || null
          });
        }
      }

      return { staffToProfile, error: null as string | null };
    };

    const fetchActiveStaffIdsForWeek = async () => {
      const set = new Set<string>();
      if (!supabase) {
        return { staffIds: [] as string[], error: 'Missing Supabase config.' };
      }

      const collectFromPaged = async (
        run: (from: number, to: number) => any
      ) => {
        const res = await fetchAllPagedRows<any>({
          pageSize: 1000,
          shouldStop: isStale,
          stopError: STALE_TIMECARD_REQUEST,
          fetchPage: async (from, to) => await run(from, to)
        });
        if (res.error) return res.error;
        for (const row of res.rows) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          if (staff) set.add(staff);
        }
        return null;
      };

      const scheduleError = await collectFromPaged(async (from, to) =>
        await supabase
          .from(SCHEDULE_TABLE)
          .select('staff_id')
          .gte('date', weekStartDate)
          .lte('date', weekEndDate)
          .range(from, to)
      );
      if (scheduleError) return { staffIds: [] as string[], error: scheduleError };

      const marksError = await collectFromPaged(async (from, to) =>
        await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .select('staff_id')
          .gte('work_date', weekStartDate)
          .lte('work_date', weekEndDate)
          .in('mark_type', ATTENDANCE_MARK_TYPES as any)
          .range(from, to)
      );
      if (marksError) return { staffIds: [] as string[], error: marksError };

      return { staffIds: Array.from(set), error: null as string | null };
    };

    const fetchScheduledByStaff = async (staffIds: string[]) => {
      if (isStale()) {
        return {
          scheduledByStaff: {} as Record<string, boolean[]>,
          scheduleStateByStaff: {} as Record<string, ScheduleBaseState[]>,
          error: STALE_TIMECARD_REQUEST
        };
      }
      const scheduledByStaff: Record<string, boolean[]> = {};
      const scheduleStateByStaff: Record<string, ScheduleBaseState[]> = {};
      const scheduleKnownByStaff: Record<string, boolean[]> = {};
      if (!supabase || staffIds.length === 0) {
        return { scheduledByStaff, scheduleStateByStaff, scheduleKnownByStaff, error: null as string | null };
      }
      const batches = chunk(staffIds, 200);
      const startDate = getTemplateDateByDayIndex(0, offset);
      const endDate = getTemplateDateByDayIndex(6, offset);
      for (const batch of batches) {
        const { data, error } = await supabase
          .from(SCHEDULE_TABLE)
          .select('staff_id, date, note')
          .in('staff_id', batch)
          .gte('date', startDate)
          .lte('date', endDate);
        if (isStale()) {
          return {
            scheduledByStaff: {} as Record<string, boolean[]>,
            scheduleStateByStaff: {} as Record<string, ScheduleBaseState[]>,
            scheduleKnownByStaff: {} as Record<string, boolean[]>,
            error: STALE_TIMECARD_REQUEST
          };
        }
        if (error) {
          return {
            scheduledByStaff: {} as Record<string, boolean[]>,
            scheduleStateByStaff: {} as Record<string, ScheduleBaseState[]>,
            scheduleKnownByStaff: {} as Record<string, boolean[]>,
            error: error.message
          };
        }
        for (const row of (data as any[] | null) ?? []) {
          const staff = String(row.staff_id ?? '').trim();
          const dayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim(), offset);
          if (!staff || dayIndex === null) continue;
          const arr = (scheduledByStaff[staff] ??= new Array(7).fill(false) as boolean[]);
          const stateArr = (scheduleStateByStaff[staff] ??= new Array(7).fill('work') as ScheduleBaseState[]);
          const knownArr = (scheduleKnownByStaff[staff] ??= new Array(7).fill(false) as boolean[]);
          const state = getScheduleBaseStateFromNote((row as ScheduleRow).note);
          stateArr[dayIndex] = state;
          knownArr[dayIndex] = true;
          arr[dayIndex] = isWorkingScheduleBaseState(state);
        }
      }
      return { scheduledByStaff, scheduleStateByStaff, scheduleKnownByStaff, error: null as string | null };
    };

    const fetchAttendanceMarksByStaff = async (staffIds: string[]) => {
      if (isStale()) {
        return {
          marksByStaff: {} as Record<
            string,
            {
              absentByDay: boolean[];
              leaveByDay: boolean[];
              tempRestByDay: boolean[];
              lateByDay: boolean[];
              lateMinutesByDay: number[];
              lateSourceByDay: string[];
              lateRoundingFamilyByDay: string[];
              lateLearnedExpectedStartRawByDay: string[];
              lateLearnedExpectedStartRoundedByDay: string[];
              lateGuardrailExpectedStartByDay: string[];
              lateFinalExpectedStartByDay: string[];
              lateFirstInByDay: string[];
              lateSampleCountByDay: number[];
            }
          >,
          error: STALE_TIMECARD_REQUEST
        };
      }
      const marksByStaff: Record<
        string,
        {
          absentByDay: boolean[];
          leaveByDay: boolean[];
          tempRestByDay: boolean[];
          lateByDay: boolean[];
          lateMinutesByDay: number[];
          lateSourceByDay: string[];
          lateRoundingFamilyByDay: string[];
          lateLearnedExpectedStartRawByDay: string[];
          lateLearnedExpectedStartRoundedByDay: string[];
          lateGuardrailExpectedStartByDay: string[];
          lateFinalExpectedStartByDay: string[];
          lateFirstInByDay: string[];
          lateSampleCountByDay: number[];
        }
      > = {};
      if (!supabase || staffIds.length === 0) {
        return { marksByStaff, error: null as string | null };
      }

      const batches = chunk(staffIds, 200);
      for (const batch of batches) {
        const { data, error } = await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .select('staff_id, work_date, mark_type, payload')
          .in('staff_id', batch)
          .gte('work_date', weekStartDate)
          .lte('work_date', weekEndDate)
          .in('mark_type', ATTENDANCE_MARK_TYPES as any);
        if (isStale()) {
          return {
            marksByStaff: {} as Record<
              string,
              {
                absentByDay: boolean[];
                leaveByDay: boolean[];
                tempRestByDay: boolean[];
                lateByDay: boolean[];
                lateMinutesByDay: number[];
                lateSourceByDay: string[];
                lateRoundingFamilyByDay: string[];
                lateLearnedExpectedStartRawByDay: string[];
                lateLearnedExpectedStartRoundedByDay: string[];
                lateGuardrailExpectedStartByDay: string[];
                lateFinalExpectedStartByDay: string[];
                lateFirstInByDay: string[];
                lateSampleCountByDay: number[];
              }
            >,
            error: STALE_TIMECARD_REQUEST
          };
        }
        if (error) {
          return {
            marksByStaff: {} as Record<
              string,
              {
                absentByDay: boolean[];
                leaveByDay: boolean[];
                tempRestByDay: boolean[];
                lateByDay: boolean[];
                lateMinutesByDay: number[];
                lateSourceByDay: string[];
                lateRoundingFamilyByDay: string[];
                lateLearnedExpectedStartRawByDay: string[];
                lateLearnedExpectedStartRoundedByDay: string[];
                lateGuardrailExpectedStartByDay: string[];
                lateFinalExpectedStartByDay: string[];
                lateFirstInByDay: string[];
                lateSampleCountByDay: number[];
              }
            >,
            error: error.message
          };
        }
        for (const row of (data as any[] | null) ?? []) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const workDateRaw = String(row.work_date ?? '').trim();
          const markType = String(row.mark_type ?? '').trim();
          if (!staff || !workDateRaw) continue;
          const workDate = new Date(`${workDateRaw}T00:00:00`);
          if (Number.isNaN(workDate.getTime())) continue;
          const dayIndex = Math.round((workDate.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000));
          if (dayIndex < 0 || dayIndex > 6) continue;
          const rec = (marksByStaff[staff] ??= {
            absentByDay: new Array(7).fill(false) as boolean[],
            leaveByDay: new Array(7).fill(false) as boolean[],
            tempRestByDay: new Array(7).fill(false) as boolean[],
            lateByDay: new Array(7).fill(false) as boolean[],
            lateMinutesByDay: new Array(7).fill(0) as number[],
            lateSourceByDay: new Array(7).fill('') as string[],
            lateRoundingFamilyByDay: new Array(7).fill('') as string[],
            lateLearnedExpectedStartRawByDay: new Array(7).fill('') as string[],
            lateLearnedExpectedStartRoundedByDay: new Array(7).fill('') as string[],
            lateGuardrailExpectedStartByDay: new Array(7).fill('') as string[],
            lateFinalExpectedStartByDay: new Array(7).fill('') as string[],
            lateFirstInByDay: new Array(7).fill('') as string[],
            lateSampleCountByDay: new Array(7).fill(0) as number[]
          });
          if (markType === 'absent') rec.absentByDay[dayIndex] = true;
          if (markType === 'excuse') rec.leaveByDay[dayIndex] = true;
          if (markType === 'temporary_leave') rec.tempRestByDay[dayIndex] = true;
          if (markType === 'late') {
            const payload = ((row as any).payload ?? {}) as Record<string, unknown>;
            rec.lateByDay[dayIndex] = true;
            rec.lateMinutesByDay[dayIndex] = Number(payload.minutes_late ?? 0);
            rec.lateSourceByDay[dayIndex] = String(payload.baseline_source ?? '').trim();
            rec.lateRoundingFamilyByDay[dayIndex] = String(payload.rounding_family ?? '').trim();
            rec.lateLearnedExpectedStartRawByDay[dayIndex] = String(payload.learned_expected_start_raw ?? '').trim();
            rec.lateLearnedExpectedStartRoundedByDay[dayIndex] = String(payload.learned_expected_start_rounded ?? '').trim();
            rec.lateGuardrailExpectedStartByDay[dayIndex] = String(payload.guardrail_expected_start ?? '').trim();
            rec.lateFinalExpectedStartByDay[dayIndex] = String(payload.final_expected_start ?? '').trim();
            rec.lateFirstInByDay[dayIndex] = String(payload.first_in ?? '').trim();
            rec.lateSampleCountByDay[dayIndex] = Number(payload.sample_count ?? 0);
          }
        }
      }
      return { marksByStaff, error: null as string | null };
    };

    const fetchPunchesInRange = async () => {
      if (isStale()) {
        return { rows: [] as any[], error: STALE_TIMECARD_REQUEST };
      }
      if (!supabase) {
        return { rows: [] as any[], error: 'Missing Supabase config.' };
      }

      const base = () =>
        supabase
          .from('ob_punches')
          .select('id, staff_id, action, created_at')
          .gte('created_at', rangeStart.toISOString())
          .lt('created_at', rangeEnd.toISOString());
      return await fetchAllPagedRows<any>({
        pageSize: 1000,
        shouldStop: isStale,
        stopError: STALE_TIMECARD_REQUEST,
        fetchPage: async (from, to) => {
          const attemptCreatedAt = await base().order('created_at', { ascending: true }).range(from, to);
          return attemptCreatedAt.error ? await base().order('id', { ascending: true }).range(from, to) : attemptCreatedAt;
        }
      });
    };

    const buildTimecardRow = ({
      staff,
      name,
      agency,
      position,
      profileShift,
      terminatedAt,
      eventsByStaff,
      scheduledByStaff,
      scheduleStateByStaff,
      scheduleKnownByStaff,
      marksByStaff,
      lateByStaffDayKey,
      lateMarksSynced,
      capEnd
    }: {
      staff: string;
      name: string;
      agency: string;
      position: string;
      profileShift: '' | 'early' | 'late';
      terminatedAt: string | null;
      eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT'; manual: boolean }>>;
      scheduledByStaff: Record<string, boolean[]>;
      scheduleStateByStaff: Record<string, ScheduleBaseState[]>;
      scheduleKnownByStaff: Record<string, boolean[]>;
      marksByStaff: Record<
        string,
        {
          absentByDay: boolean[];
          leaveByDay: boolean[];
          tempRestByDay: boolean[];
          lateByDay: boolean[];
          lateMinutesByDay: number[];
          lateSourceByDay: string[];
          lateRoundingFamilyByDay: string[];
          lateLearnedExpectedStartRawByDay: string[];
          lateLearnedExpectedStartRoundedByDay: string[];
          lateGuardrailExpectedStartByDay: string[];
          lateFinalExpectedStartByDay: string[];
          lateFirstInByDay: string[];
          lateSampleCountByDay: number[];
        }
      >;
      lateByStaffDayKey: Record<string, LateMarkView>;
      lateMarksSynced: boolean;
      capEnd: Date;
    }): TimecardRow => {
      const events = eventsByStaff[staff] ?? [];
      const intervals: Array<{ start: Date; end: Date }> = [];
      let currentIn: Date | null = null;
      for (const ev of events) {
        if (ev.action === 'IN') {
          currentIn = ev.at;
          continue;
        }
        if (ev.action === 'OUT') {
          if (currentIn && ev.at.getTime() > currentIn.getTime()) {
            intervals.push({ start: currentIn, end: ev.at });
            currentIn = null;
          }
        }
      }

      const openInterval = currentIn && capEnd.getTime() > currentIn.getTime() ? { start: currentIn, end: capEnd } : null;
      if (openInterval) {
        intervals.push(openInterval);
      }

      const hoursByDay = computeHoursByDay(intervals, weekStart);
      const inProgressByDay = new Array(7).fill(false) as boolean[];
      if (openInterval) {
        for (let idx = 0; idx < 7; idx++) {
          const { start: dayStart, end: dayEnd } = getDayRange(weekStart, idx);
          const overlapStart = Math.max(openInterval.start.getTime(), dayStart.getTime());
          const overlapEnd = Math.min(openInterval.end.getTime(), dayEnd.getTime());
          if (overlapEnd > overlapStart) inProgressByDay[idx] = true;
        }
      }
      const inProgressWeek = inProgressByDay.some(Boolean);
      const punchCountByDay = new Array(7).fill(0) as number[];
      const hasPunchByDay = new Array(7).fill(false) as boolean[];
      for (const ev of events) {
        const bucketTimeMs = getOperationalBucketTimeMs(ev.at, ev.action);
        for (let idx = 0; idx < 7; idx += 1) {
          const { start: dayStart, end: dayEnd } = getDayRange(weekStart, idx);
          if (bucketTimeMs >= dayStart.getTime() && bucketTimeMs < dayEnd.getTime()) {
            punchCountByDay[idx] += 1;
            hasPunchByDay[idx] = true;
            break;
          }
        }
      }
      const manualByDay = new Array(7).fill(false) as boolean[];
      for (const ev of events) {
        if (!ev.manual) continue;
        const bucketTimeMs = getOperationalBucketTimeMs(ev.at, ev.action);
        for (let idx = 0; idx < 7; idx++) {
          const { start: dayStart, end: dayEnd } = getDayRange(weekStart, idx);
          if (bucketTimeMs >= dayStart.getTime() && bucketTimeMs < dayEnd.getTime()) {
            manualByDay[idx] = true;
            break;
          }
        }
      }
      const manualWeek = manualByDay.some(Boolean);
      const totalHours = hoursByDay.reduce((sum, v) => sum + v, 0);
      const shift = profileShift;
      const scheduledByDay = scheduledByStaff[staff] ?? (new Array(7).fill(false) as boolean[]);
      const markRec = marksByStaff[staff] ?? {
        absentByDay: new Array(7).fill(false) as boolean[],
        leaveByDay: new Array(7).fill(false) as boolean[],
        tempRestByDay: new Array(7).fill(false) as boolean[],
        lateByDay: new Array(7).fill(false) as boolean[],
        lateMinutesByDay: new Array(7).fill(0) as number[],
        lateSourceByDay: new Array(7).fill('') as string[],
        lateRoundingFamilyByDay: new Array(7).fill('') as string[],
        lateLearnedExpectedStartRawByDay: new Array(7).fill('') as string[],
        lateLearnedExpectedStartRoundedByDay: new Array(7).fill('') as string[],
        lateGuardrailExpectedStartByDay: new Array(7).fill('') as string[],
        lateFinalExpectedStartByDay: new Array(7).fill('') as string[],
        lateFirstInByDay: new Array(7).fill('') as string[],
        lateSampleCountByDay: new Array(7).fill(0) as number[]
      };
      const absentByDay = [...markRec.absentByDay];
      const leaveByDay = [...markRec.leaveByDay];
      const tempRestByDay = [...markRec.tempRestByDay];
      const lateByDay = lateMarksSynced ? (new Array(7).fill(false) as boolean[]) : [...markRec.lateByDay];
      const lateMinutesByDay = lateMarksSynced ? (new Array(7).fill(0) as number[]) : [...markRec.lateMinutesByDay];
      const lateSourceByDay = lateMarksSynced ? (new Array(7).fill('') as string[]) : [...markRec.lateSourceByDay];
      const lateRoundingFamilyByDay = lateMarksSynced ? (new Array(7).fill('') as string[]) : [...markRec.lateRoundingFamilyByDay];
      const lateLearnedExpectedStartRawByDay = lateMarksSynced ? (new Array(7).fill('') as string[]) : [...markRec.lateLearnedExpectedStartRawByDay];
      const lateLearnedExpectedStartRoundedByDay = lateMarksSynced ? (new Array(7).fill('') as string[]) : [...markRec.lateLearnedExpectedStartRoundedByDay];
      const lateGuardrailExpectedStartByDay = lateMarksSynced ? (new Array(7).fill('') as string[]) : [...markRec.lateGuardrailExpectedStartByDay];
      const lateFinalExpectedStartByDay = lateMarksSynced ? (new Array(7).fill('') as string[]) : [...markRec.lateFinalExpectedStartByDay];
      const lateFirstInByDay = lateMarksSynced ? (new Array(7).fill('') as string[]) : [...markRec.lateFirstInByDay];
      const lateSampleCountByDay = lateMarksSynced ? (new Array(7).fill(0) as number[]) : [...markRec.lateSampleCountByDay];
      const scheduleStates = scheduleStateByStaff[staff] ?? (new Array(7).fill('work') as ScheduleBaseState[]);
      const scheduleKnownByDay = scheduleKnownByStaff[staff] ?? (new Array(7).fill(false) as boolean[]);
      const restByDay = scheduleStates.map((state, idx) => state === 'rest' && scheduleKnownByDay[idx]);
      const weekDateKeys = Array.from({ length: 7 }, (_, idx) => toDateOnly(addDays(weekStart, idx)));
      const terminatedByDay = getTimecardTerminatedByDay({
        terminatedAt,
        weekDateKeys
      });
      for (let idx = 0; idx < 7; idx += 1) {
        const late = lateByStaffDayKey[`${staff}__${weekDateKeys[idx]}`];
        if (!late) continue;
        lateByDay[idx] = true;
        lateMinutesByDay[idx] = Number(late.minutesLate ?? 0);
        lateSourceByDay[idx] = String(late.source ?? '').trim();
        lateRoundingFamilyByDay[idx] = String(late.roundingFamily ?? '').trim();
        lateLearnedExpectedStartRawByDay[idx] = String(late.learnedExpectedStartRaw ?? '').trim();
        lateLearnedExpectedStartRoundedByDay[idx] = String(late.learnedExpectedStartRounded ?? '').trim();
        lateGuardrailExpectedStartByDay[idx] = String(late.guardrailExpectedStart ?? '').trim();
        lateFinalExpectedStartByDay[idx] = String(late.finalExpectedStart ?? '').trim();
        lateFirstInByDay[idx] = String(late.firstIn ?? '').trim();
        lateSampleCountByDay[idx] = Number(late.sampleCount ?? 0);
      }
      const absentVisibleByNoon = Array.from({ length: 7 }, (_, idx) => {
        const workDate = weekDateKeys[idx] ?? '';
        const noon = new Date(`${workDate}T00:00:00`);
        if (Number.isNaN(noon.getTime())) return false;
        noon.setHours(TIMECARD_ABSENT_VISIBLE_HOUR, 0, 0, 0);
        return capEnd.getTime() >= noon.getTime();
      });
      for (let idx = 0; idx < 7; idx += 1) {
        if (terminatedByDay[idx]) continue;
        if (hasPunchByDay[idx]) continue;
        const state = scheduleStates[idx] ?? 'work';
        if (scheduleKnownByDay[idx]) {
          if (state === 'leave' || state === 'planned_leave') {
            leaveByDay[idx] = true;
            continue;
          }
          if (state === 'temp_rest' || state === 'planned_temp_rest') {
            tempRestByDay[idx] = true;
            continue;
          }
          if (state === 'rest') {
            restByDay[idx] = true;
            continue;
          }
        }
        if (!closedDayByIndex[idx]) continue;
        if (absentByDay[idx] || leaveByDay[idx] || tempRestByDay[idx]) continue;
        if (!scheduledByDay[idx]) {
          restByDay[idx] = true;
        }
      }
      for (let idx = 0; idx < 7; idx += 1) {
        if (terminatedByDay[idx]) continue;
        const isWorking = isWorkingScheduleBaseState(scheduleStates[idx] ?? 'work');
        if (!isWorking) continue;
        if (!scheduledByDay[idx]) continue;
        if (hasPunchByDay[idx]) continue;
        if (leaveByDay[idx] || tempRestByDay[idx]) continue;
        if (!absentVisibleByNoon[idx]) continue;
        absentByDay[idx] = true;
      }
      if (offset < 0) {
        for (let idx = 0; idx < 7; idx += 1) {
          if (terminatedByDay[idx]) continue;
          if (scheduleKnownByDay[idx]) continue;
          if (hasPunchByDay[idx]) continue;
          if (absentByDay[idx] || leaveByDay[idx] || tempRestByDay[idx]) continue;
          if (!closedDayByIndex[idx]) continue;
          restByDay[idx] = true;
        }
      }
      const punchCountMismatchByDay = punchCountByDay.map((count, idx) => {
        if (!closedDayByIndex[idx]) return false;
        if (count <= 0) return false;
        return count !== 4;
      });

      return {
        staff_id: staff,
        name,
        agency,
        position,
        hoursByDay,
        punchCountByDay,
        punchCountMismatchByDay,
        scheduledByDay,
        absentByDay,
        leaveByDay,
        tempRestByDay,
        lateByDay,
        lateMinutesByDay,
        lateSourceByDay,
        lateRoundingFamilyByDay,
        lateLearnedExpectedStartRawByDay,
        lateLearnedExpectedStartRoundedByDay,
        lateGuardrailExpectedStartByDay,
        lateFinalExpectedStartByDay,
        lateFirstInByDay,
        lateSampleCountByDay,
        restByDay,
        terminatedByDay,
        inProgressByDay,
        inProgressWeek,
        manualByDay,
        manualWeek,
        totalHours,
        shift
      };
    };

    const exec = async () => {
      if (isStale()) {
        return { rows: [] as TimecardRow[], hasMore: false, error: STALE_TIMECARD_REQUEST };
      }
      if (missingOnly) {
        const punchesRes = await fetchPunchesInRange();
        if (punchesRes.error) {
          return { rows: [] as TimecardRow[], hasMore: false, error: punchesRes.error };
        }

        const eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT'; manual: boolean }>> = {};
        for (const p of punchesRes.rows ?? []) {
          const staff = String(p.staff_id ?? '').trim();
          const actionRaw = String(p.action ?? '').toUpperCase();
          const atRaw = String(p.created_at ?? '').trim();
          if (!staff || (actionRaw !== 'IN' && actionRaw !== 'OUT') || !atRaw) continue;
          const at = new Date(atRaw);
          if (Number.isNaN(at.getTime())) continue;
          const manual = false;
          const action = (actionRaw === 'OUT' ? 'OUT' : 'IN') as 'IN' | 'OUT';
          (eventsByStaff[staff] ??= []).push({ at, action, manual });
        }
        for (const staff of Object.keys(eventsByStaff)) {
          eventsByStaff[staff]!.sort((a, b) => a.at.getTime() - b.at.getTime());
        }

        const allStaffIds = Object.keys(eventsByStaff).sort((a, b) => a.localeCompare(b, 'zh-CN'));
        if (allStaffIds.length === 0) {
          return { rows: [] as TimecardRow[], hasMore: false, error: null as string | null };
        }

        const now = new Date(serverTime);
        const capEnd = new Date(clamp(now.getTime(), rangeStart.getTime(), rangeEnd.getTime()));

        const profilesRes = await fetchProfilesByStaffId(allStaffIds);
        if (profilesRes.error) {
          return { rows: [] as TimecardRow[], hasMore: false, error: profilesRes.error };
        }

        const isMissingProfile = (profile: { name: string; agency: string; position: string; shift: '' | 'early' | 'late' } | undefined) => {
          if (!profile) return true;
          return !profile.name && !profile.agency && !profile.position;
        };

        let staffIds = allStaffIds.filter((staff) => isMissingProfile(profilesRes.staffToProfile.get(staff)));

        if (searchValue) {
          const terms = searchValue
            .split(/\s+/g)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s.toLowerCase());
          const normalized = normalizeStaffId(searchValue);
          const needles = Array.from(new Set([normalized, ...terms].filter(Boolean)));
          staffIds = staffIds.filter((staff) => {
            const hay = staff.toLowerCase();
            return needles.every((needle) => hay.includes(needle));
          });
        }

        const [scheduledRes, marksRes] = await Promise.all([
          fetchScheduledByStaff(staffIds),
          fetchAttendanceMarksByStaff(staffIds)
        ]);
        if (scheduledRes.error) {
          return { rows: [] as TimecardRow[], hasMore: false, error: scheduledRes.error };
        }
        if (marksRes.error) {
          return { rows: [] as TimecardRow[], hasMore: false, error: marksRes.error };
        }

        const rows: TimecardRow[] = staffIds.map((staff) => {
          const profile = profilesRes.staffToProfile.get(staff) ?? { name: '', agency: '', position: '', shift: '' as '' | 'early' | 'late' };
          return buildTimecardRow({
            staff,
            name: profile.name,
            agency: profile.agency,
            position: profile.position,
            profileShift: profile.shift,
            terminatedAt: null,
            eventsByStaff,
            scheduledByStaff: scheduledRes.scheduledByStaff,
            scheduleStateByStaff: scheduledRes.scheduleStateByStaff,
            scheduleKnownByStaff: scheduledRes.scheduleKnownByStaff ?? {},
            marksByStaff: marksRes.marksByStaff,
            lateByStaffDayKey: {},
            lateMarksSynced: false,
            capEnd
          });
        });

        return { rows, hasMore: false, error: null as string | null };
      }

      const cachedWeek = timecardWeekCacheRef.current;
      if (cachedWeek && cachedWeek.weekKey === weekStartDate) {
        const viewEmployees = filterEmployeesForView(cachedWeek.allEmployees);
        const now = new Date(serverTime);
        const capEnd = new Date(clamp(now.getTime(), rangeStart.getTime(), rangeEnd.getTime()));
        const rows: TimecardRow[] = viewEmployees.map((e) =>
          buildTimecardRow({
            staff: e.staff_id,
            name: e.name,
            agency: e.agency,
            position: e.position,
            profileShift: e.shift,
            terminatedAt: e.terminatedAt,
            eventsByStaff: cachedWeek.eventsByStaff,
            scheduledByStaff: cachedWeek.scheduledByStaff,
            scheduleStateByStaff: cachedWeek.scheduleStateByStaff,
            scheduleKnownByStaff: cachedWeek.scheduleKnownByStaff,
            marksByStaff: cachedWeek.marksByStaff,
            lateByStaffDayKey: cachedWeek.lateByStaffDayKey,
            lateMarksSynced: cachedWeek.lateMarksSynced,
            capEnd
          })
        );
        return { rows, hasMore: false, error: null as string | null };
      }

      const [punchesRes, activeStaffRes] = await Promise.all([
        fetchPunchesInRange(),
        fetchActiveStaffIdsForWeek()
      ]);
      if (isStale()) {
        return { rows: [] as TimecardRow[], hasMore: false, error: STALE_TIMECARD_REQUEST };
      }
      if (punchesRes.error) {
        return { rows: [] as TimecardRow[], hasMore: false, error: punchesRes.error };
      }
      if (activeStaffRes.error) {
        return { rows: [] as TimecardRow[], hasMore: false, error: activeStaffRes.error };
      }

      const eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT'; manual: boolean }>> = {};
      const activeStaffSet = new Set<string>(activeStaffRes.staffIds);
      for (const p of punchesRes.rows ?? []) {
        const staff = normalizeStaffId(String(p.staff_id ?? '').trim());
        const action = String(p.action ?? '').toUpperCase();
        const atRaw = String(p.created_at ?? '').trim();
        if (!staff || (action !== 'IN' && action !== 'OUT') || !atRaw) continue;
        const at = new Date(atRaw);
        if (Number.isNaN(at.getTime())) continue;
        const manual = false;
        activeStaffSet.add(staff);
        (eventsByStaff[staff] ??= []).push({ at, action, manual });
      }

      const activeStaffIds = Array.from(activeStaffSet).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      if (activeStaffIds.length === 0) {
        return { rows: [] as TimecardRow[], hasMore: false, error: null as string | null };
      }

      const profilesRes = await fetchProfilesByStaffId(activeStaffIds);
      if (profilesRes.error) {
        return { rows: [] as TimecardRow[], hasMore: false, error: profilesRes.error };
      }

      const allEmployees = activeStaffIds
        .map((staff) => {
          const profile = profilesRes.staffToProfile.get(staff);
          return {
            staff_id: staff,
            name: profile?.name ?? '',
            agency: profile?.agency ?? '',
            position: profile?.position ?? '',
            shift: profile?.shift ?? ('' as '' | 'early' | 'late'),
            terminatedAt: profile?.terminatedAt ?? null
          };
        })
        .filter((employee) => !isScheduleOnlyAgency(String(employee.agency ?? '').trim()));

      const uniqueEmployees = filterEmployeesForView(allEmployees);

      const staffIds = uniqueEmployees.map((e) => e.staff_id);
      if (staffIds.length === 0) {
        return { rows: [] as TimecardRow[], hasMore: false, error: null as string | null };
      }

      const [scheduledRes, marksRes] = await Promise.all([
        fetchScheduledByStaff(activeStaffIds),
        fetchAttendanceMarksByStaff(activeStaffIds)
      ]);
      if (isStale()) {
        return { rows: [] as TimecardRow[], hasMore: false, error: STALE_TIMECARD_REQUEST };
      }
      if (scheduledRes.error) {
        return { rows: [] as TimecardRow[], hasMore: false, error: scheduledRes.error };
      }
      if (marksRes.error) {
        return { rows: [] as TimecardRow[], hasMore: false, error: marksRes.error };
      }

      for (const staff of Object.keys(eventsByStaff)) {
        eventsByStaff[staff]!.sort((a, b) => a.at.getTime() - b.at.getTime());
      }

      const now = new Date(serverTime);
      const capEnd = new Date(clamp(now.getTime(), rangeStart.getTime(), rangeEnd.getTime()));

      let lateByStaffDayKey: Record<string, LateMarkView> = {};
      let lateMarksSynced = false;
      if (!shouldDeferLateSync) {
        try {
          lateByStaffDayKey = (
            await syncLateMarksForWeek({
              weekStart,
              targetEmployees: allEmployees.map((employee) => ({
                staff_id: employee.staff_id,
                name: employee.name,
                agency: employee.agency,
                position: employee.position,
                shift: employee.shift,
                terminated_at: employee.terminatedAt
              }))
            })
          ).lateByStaffDayKey;
          lateMarksSynced = true;
        } catch (error) {
          console.warn('[timecard] sync late marks failed:', error);
        }
      }

      timecardWeekCacheRef.current = {
        weekKey: weekStartDate,
        allEmployees,
        eventsByStaff,
        scheduledByStaff: scheduledRes.scheduledByStaff,
        scheduleStateByStaff: scheduledRes.scheduleStateByStaff,
        scheduleKnownByStaff: scheduledRes.scheduleKnownByStaff ?? {},
        marksByStaff: marksRes.marksByStaff,
        lateByStaffDayKey,
        lateMarksSynced
      };

      const rows: TimecardRow[] = uniqueEmployees.map((e) => {
        const staff = e.staff_id;
        const name = e.name;
        const agency = e.agency;
        const position = e.position;
        const profileShift = e.shift;
        return buildTimecardRow({
          staff,
          name,
          agency,
          position,
          profileShift,
          terminatedAt: e.terminatedAt,
          eventsByStaff,
          scheduledByStaff: scheduledRes.scheduledByStaff,
          scheduleStateByStaff: scheduledRes.scheduleStateByStaff,
          scheduleKnownByStaff: scheduledRes.scheduleKnownByStaff ?? {},
          marksByStaff: marksRes.marksByStaff,
          lateByStaffDayKey,
          lateMarksSynced,
          capEnd
        });
      });

      return { rows, hasMore: false, error: null as string | null };
    };

    const fetchAll = async () => {
      const all: TimecardRow[] = [];
      let hasMore = true;
      while (hasMore) {
        if (isStale()) {
          return { rows: [] as TimecardRow[], hasMore: false, error: STALE_TIMECARD_REQUEST };
        }
        const result = await exec();
        if (result.error) {
          return { rows: [] as TimecardRow[], hasMore: false, error: result.error };
        }
        all.push(...result.rows);
        hasMore = result.hasMore;
        if (result.rows.length === 0) {
          hasMore = false;
        }
      }
      return { rows: all, hasMore: false, error: null as string | null };
    };

    const shouldLockUi = lockUi ?? true;
    const queueLateSyncPass = () => {
      if (!shouldDeferLateSync || missingOnly) return;
      const cachedWeek = timecardWeekCacheRef.current;
      if (cachedWeek && cachedWeek.weekKey === weekStartDate && cachedWeek.lateMarksSynced) return;
      if (requestId !== timecardFetchSeqRef.current) return;
      window.setTimeout(() => {
        if (requestId !== timecardFetchSeqRef.current) return;
        void fetchTimecard({
          reset: true,
          weekOffset: offset,
          search: searchValue,
          agency: agencyValue,
          position: positionValue,
          missingEmployeeOnly: missingOnly,
          lockUi: false,
          deferLateSync: false
        });
      }, 0);
    };
    if (!shouldLockUi) {
      // Only support reset in soft mode to avoid pagination races.
      if (!reset) {
        await fetchTimecard({ reset, weekOffset, search, agency, position, lockUi: true });
        return;
      }
      const result = await fetchAll();
      if (isStale() || result.error === STALE_TIMECARD_REQUEST) {
        return;
      }
      const dedupedRows = (() => {
        const map = new Map<string, TimecardRow>();
        for (const row of result.rows) {
          const staff = String(row.staff_id ?? '').trim();
          if (!staff) continue;
          if (!map.has(staff)) map.set(staff, row);
        }
        return Array.from(map.values());
      })();
      setTimecardError(isAbortLikeError(result.error) ? null : result.error);
      setTimecardRows(dedupedRows);
      setTimecardHasMore(false);
      queueLateSyncPass();
      return;
    }

    await runLocked('timecard', async () => {
      setTimecardError(null);
      const result = await fetchAll();
      if (isStale() || result.error === STALE_TIMECARD_REQUEST) return;
      if (result.error) {
        if (!isAbortLikeError(result.error)) setTimecardError(result.error);
        setTimecardRows([]);
        setTimecardHasMore(false);
        return;
      }
      const dedupedRows = (() => {
        const map = new Map<string, TimecardRow>();
        for (const row of result.rows) {
          const staff = String(row.staff_id ?? '').trim();
          if (!staff) continue;
          if (!map.has(staff)) map.set(staff, row);
        }
        return Array.from(map.values());
      })();
      setTimecardRows(dedupedRows);
      setTimecardHasMore(false);
      queueLateSyncPass();
    });
    } finally {
      finishLoading();
    }
  };

  const recomputeTimecardAttendanceMarks = async () => {
    if (!supabase) {
      setStatus({ tone: 'error', message: '缺少 Supabase 配置。' });
      return;
    }

    const RECOMPUTE_COOLDOWN_MS = 90 * 1000;
    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
    const weekKey = toDateOnly(weekStart);
    const nowMs = Date.now();
    const lastRunMs = timecardRecomputeLastRunByWeekRef.current[weekKey] ?? 0;
    if (nowMs - lastRunMs < RECOMPUTE_COOLDOWN_MS) {
      const remainSec = Math.max(1, Math.ceil((RECOMPUTE_COOLDOWN_MS - (nowMs - lastRunMs)) / 1000));
      timecardRecomputeLastRunByWeekRef.current[weekKey] = Date.now();
      setStatus({
        tone: 'success',
        message: t(
          `本周标记刚重算过，已跳过重算并刷新列表（约 ${remainSec} 秒后可再次重算）。`,
          `This week was recomputed recently. Skipped recompute and refreshed only (${remainSec}s until next recompute).`
        )
      });
      await fetchTimecard({ reset: true, lockUi: false });
      return;
    }

    await runLocked('attendance_marks_recompute_week', async () => {
      const weekDateByIndex = Array.from({ length: 7 }, (_, idx) => toDateOnly(addDays(weekStart, idx)));
      const templateStart = getTemplateDateByDayIndex(0, timecardWeekOffset);
      const templateEnd = getTemplateDateByDayIndex(6, timecardWeekOffset);

      const scheduleRes = await supabase
        .from(SCHEDULE_TABLE)
        .select('staff_id, date, note')
        .gte('date', templateStart)
        .lte('date', templateEnd);
      if (scheduleRes.error) {
        setStatus({ tone: 'error', message: `重算失败：${scheduleRes.error.message}` });
        return;
      }

      const stateByStaffDay = new Map<string, ScheduleBaseState>();
      for (const row of ((scheduleRes.data as any[]) ?? []) as ScheduleRow[]) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        const dayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim(), timecardWeekOffset);
        if (!staff || dayIndex === null || dayIndex < 0 || dayIndex > 6) continue;
        stateByStaffDay.set(`${staff}__${dayIndex}`, getScheduleBaseStateFromNote(row.note));
      }

      // 本周之前 ob_schedules 无数据（只有本周/下周 bucket），跳过重算避免误删已有标记
      if (timecardWeekOffset < 0 && stateByStaffDay.size === 0) {
        setStatus({
          tone: 'idle',
          message: t(
            '历史周无排班模板数据，无法重算；仅刷新列表，保留已有标记。',
            'Past week has no schedule template; skip recompute, keep existing marks.'
          )
        });
        await fetchTimecard({ reset: true, lockUi: false });
        return;
      }

      const weekRange = getDayRange(weekStart, 0, 7);
      const dayIndexByDate = new Map<string, number>();
      weekDateByIndex.forEach((d, idx) => dayIndexByDate.set(d, idx));
      const hasPunchByStaffDay = new Set<string>();

      const weekPunchRowsRes = await fetchAllPagedRows<any>({
        pageSize: 1000,
        fetchPage: async (from, to) =>
          await supabase
            .from('ob_punches')
            .select('staff_id, action, created_at, id')
            .gte('created_at', weekRange.start.toISOString())
            .lt('created_at', weekRange.end.toISOString())
            .order('created_at', { ascending: true })
            .range(from, to)
      });
      if (weekPunchRowsRes.error) {
        setStatus({ tone: 'error', message: `重算失败：${weekPunchRowsRes.error}` });
        return;
      }
      for (const row of weekPunchRowsRes.rows) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        const atRaw = String(row.created_at ?? '').trim();
        if (!staff || !atRaw) continue;
        const at = new Date(atRaw);
        if (Number.isNaN(at.getTime())) continue;
        const action = String((row as any).action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
        const opDayDate = new Date(getOperationalBucketTimeMs(at, action) - DAY_CUTOFF_MS);
        const workDate = toDateOnly(opDayDate);
        const dayIndex = dayIndexByDate.get(workDate);
        if (dayIndex == null) continue;
        hasPunchByStaffDay.add(`${staff}__${dayIndex}`);
      }

      const now = new Date(serverTime);
      const marksToInsert: NonLateAttendanceMarkPersistRow[] = [];

      for (const [key, state] of stateByStaffDay.entries()) {
        const [staff, dayIndexRaw] = key.split('__');
        const dayIndex = Number(dayIndexRaw);
        if (!staff || !Number.isFinite(dayIndex) || dayIndex < 0 || dayIndex > 6) continue;
        const workDate = weekDateByIndex[dayIndex];
        if (!workDate) continue;

        if (state === 'leave' || state === 'planned_leave') {
          marksToInsert.push({
            staff_id: staff,
            work_date: workDate,
            mark_type: 'excuse',
            source: 'recompute',
            operator: user?.email ?? null,
            payload: { state, weekday: dayIndex + 1, reason: 'weekly_recompute' },
            updated_at: now.toISOString()
          });
          continue;
        }
        if (state === 'temp_rest' || state === 'planned_temp_rest') {
          marksToInsert.push({
            staff_id: staff,
            work_date: workDate,
            mark_type: 'temporary_leave',
            source: 'recompute',
            operator: user?.email ?? null,
            payload: { state, weekday: dayIndex + 1, reason: 'weekly_recompute' },
            updated_at: now.toISOString()
          });
          continue;
        }

        if (!isWorkingScheduleBaseState(state)) continue;
        const absentVisibleAt = new Date(`${workDate}T00:00:00`);
        if (Number.isNaN(absentVisibleAt.getTime())) continue;
        absentVisibleAt.setHours(TIMECARD_ABSENT_VISIBLE_HOUR, 0, 0, 0);
        if (absentVisibleAt.getTime() > now.getTime()) continue;
        if (hasPunchByStaffDay.has(key)) continue;
        marksToInsert.push({
          staff_id: staff,
          work_date: workDate,
          mark_type: 'absent',
          source: 'recompute',
          operator: user?.email ?? null,
          payload: { state, weekday: dayIndex + 1, reason: 'weekly_recompute' },
          updated_at: now.toISOString()
        });
      }

      let lateCount = 0;
      let latePersistRows: LateMarkPersistRow[] = [];
      let lateTargetStaffIds: string[] = [];
      try {
        const staffIds = Array.from(new Set(Array.from(stateByStaffDay.keys()).map((key) => String(key.split('__')[0] ?? '').trim()).filter(Boolean)));
        const employeeMap = new Map<string, EmployeeRow>();
        for (const employee of employees) {
          const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
          if (!staff || employeeMap.has(staff)) continue;
          employeeMap.set(staff, employee);
        }
        const lateRes = await syncLateMarksForWeek({
          weekStart,
          targetEmployees: staffIds.map((staff) => {
            const employee = employeeMap.get(staff);
            return {
              staff_id: staff,
              name: String(employee?.name ?? '').trim(),
              agency: String(employee?.agency ?? employee?.Agency ?? '').trim(),
              position: String(employee?.position ?? employee?.Position ?? '').trim(),
              shift: normalizeShiftValue(String(employee?.shift ?? '').trim()),
              terminated_at: String((employee as any)?.terminated_at ?? '').trim() || null
            };
          }),
          persist: false
        });
        lateCount = Object.keys(lateRes.lateByStaffDayKey).length;
        latePersistRows = lateRes.persistRows;
        lateTargetStaffIds = lateRes.targetStaffIds;
      } catch (error: any) {
        setStatus({ tone: 'error', message: `重算迟到失败：${String(error?.message ?? error ?? 'Unknown error')}` });
        return;
      }

      let persistedWithRpc = false;
      if (DEFAULT_TIMECARD_ATTENDANCE_SYNC_TABLES) {
        const rpcRes = await supabase.rpc('sync_timecard_attendance_marks', {
          p_range_start: weekDateByIndex[0] ?? '',
          p_range_end: weekDateByIndex[6] ?? '',
          p_rows: marksToInsert,
          p_late_rows: latePersistRows,
          p_staff_ids: lateTargetStaffIds,
          p_actor: user?.email ?? null
        });
        if (rpcRes.error) {
          if (!isMissingTimecardAttendanceSyncRpcError(rpcRes.error)) {
            setStatus({ tone: 'error', message: `重算失败：${rpcRes.error.message}` });
            return;
          }
        } else {
          persistedWithRpc = true;
        }
      }

      if (!persistedWithRpc) {
        const clearRes = await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .delete()
          .gte('work_date', weekDateByIndex[0] ?? '')
          .lte('work_date', weekDateByIndex[6] ?? '')
          .in('mark_type', NON_LATE_ATTENDANCE_MARK_TYPES as any)
          .in('source', ['schedule', 'recompute'] as any);
        if (clearRes.error) {
          setStatus({ tone: 'error', message: `重算失败：${clearRes.error.message}` });
          return;
        }

        if (marksToInsert.length > 0) {
          const upsertRes = await supabase.from(ATTENDANCE_MARKS_TABLE).upsert(marksToInsert as any, {
            onConflict: 'staff_id,work_date,mark_type'
          });
          if (upsertRes.error) {
            setStatus({ tone: 'error', message: `重算失败：${upsertRes.error.message}` });
            return;
          }
        }

        try {
          await persistLateAttendanceMarks({
            rangeStart: weekDateByIndex[0] ?? '',
            rangeEnd: weekDateByIndex[6] ?? '',
            staffIds: lateTargetStaffIds,
            rows: latePersistRows,
            actor: user?.email ?? null
          });
        } catch (latePersistError: any) {
          setStatus({ tone: 'error', message: `重算迟到失败：${String(latePersistError?.message ?? latePersistError ?? 'Unknown error')}` });
          return;
        }
      }

      setStatus({
        tone: 'success',
        message: `已重算本周标记：${weekDateByIndex[0]} ~ ${weekDateByIndex[6]}（缺勤/请假 ${marksToInsert.length} 条，迟到 ${lateCount} 条）`
      });
      await fetchTimecard({ reset: true, lockUi: false });
    });
  };

  const exportTimecard = async () => {
    await runLocked('timecard_export', async () => {
      const rows = timecardRowsFiltered;
      if (rows.length === 0) {
        setStatus({ tone: 'error', message: '暂无可导出的时间卡数据。' });
        return;
      }

      const baseWeekStart = startOfWeekMonday(serverTime);
      const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
      const dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      const headers = [
        '工号',
        '姓名',
        'Agency',
        '岗位',
        '班次',
        ...dayLabels.map((label, idx) => `${label} ${toDateOnly(addDays(weekStart, idx)).slice(5)}`),
        '合计'
      ];

      const body = rows.map((r) => [
        r.staff_id,
        r.name,
        r.agency,
        r.position,
        r.shift,
        ...r.hoursByDay.map((h) => formatHours(h)),
        formatHours(r.totalHours)
      ]);

      try {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'timecard');
        const filename = `ob_timecard_${toDateOnly(weekStart)}.xlsx`;
        XLSX.writeFile(wb, filename);
        setStatus({ tone: 'success', message: `已导出：${filename}` });
      } catch (err) {
        const filename = `ob_timecard_${toDateOnly(weekStart)}.csv`;
        const csv = [headers, ...body]
          .map((row) =>
            row
              .map((cell) => {
                const v = String(cell ?? '');
                if (v.includes('"') || v.includes(',') || v.includes('\n')) {
                  return `"${v.replace(/"/g, '""')}"`;
                }
                return v;
              })
              .join(',')
          )
          .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus({ tone: 'success', message: `已导出：${filename}` });
      }
    });
  };

  const exportDailyPunches = async () => {
    await runLocked('timecard_export_daily', async () => {
      if (!supabase) {
        setStatus({ tone: 'error', message: '缺少 Supabase 配置。' });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(timecardWeekInput)) {
        setStatus({ tone: 'error', message: '请先在 Week 日历里选择日期。' });
        return;
      }

      const selectedDate = new Date(`${timecardWeekInput}T00:00:00`);
      if (Number.isNaN(selectedDate.getTime())) {
        setStatus({ tone: 'error', message: '日期无效，请重新选择。' });
        return;
      }

      const dayStart = new Date(selectedDate);
      dayStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const filteredStaffIds = new Set(
        timecardRowsFiltered
          .map((row) => normalizeStaffId(String(row.staff_id ?? '').trim()))
          .filter(Boolean)
      );

      const punches: Array<{ staff_id: string; action: 'IN' | 'OUT'; created_at: string }> = [];
      const punchRowsRes = await fetchAllPagedRows<any>({
        pageSize: 1000,
        fetchPage: async (from, to) =>
          await supabase
            .from('ob_punches')
            .select('staff_id, action, created_at, id')
            .gte('created_at', dayStart.toISOString())
            .lt('created_at', dayEnd.toISOString())
            .order('created_at', { ascending: true })
            .range(from, to)
      });
      if (punchRowsRes.error) {
        setStatus({ tone: 'error', message: `导出失败：${punchRowsRes.error}` });
        return;
      }

      for (const r of punchRowsRes.rows) {
        const staff = String(r.staff_id ?? '').trim();
        const action = String(r.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
        const at = String(r.created_at ?? '').trim();
        if (!staff || !at) continue;
        punches.push({ staff_id: staff, action, created_at: at });
      }

      const filteredPunches = punches.filter((p) =>
        filteredStaffIds.has(normalizeStaffId(String(p.staff_id ?? '').trim()))
      );

      if (filteredPunches.length === 0) {
        setStatus({ tone: 'error', message: '该日期暂无打卡记录。' });
        return;
      }

      const staffIds = Array.from(new Set(filteredPunches.map((p) => p.staff_id)));
      const mode = await resolveEmployeeColumnMode();
      const staffToProfile = new Map<string, { name: string; agency: string; position: string }>();
      const batches = chunk(staffIds, 200);
      for (const batch of batches) {
        const select = mode === 'cased' ? 'staff_id, name, "Agency", "Position"' : 'staff_id, name, agency, position';
        let res = await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', batch);
        if (res.error) {
          const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
          employeeColumnModeRef.current = flipped;
          const select2 =
            flipped === 'cased' ? 'staff_id, name, "Agency", "Position"' : 'staff_id, name, agency, position';
          res = await supabase.from(EMPLOYEE_TABLE).select(select2).in('staff_id', batch);
        }
        if (res.error) {
          setStatus({ tone: 'error', message: `读取员工信息失败：${res.error.message}` });
          return;
        }
        for (const r of (res.data as any[] | null) ?? []) {
          const staff = String(r.staff_id ?? '').trim();
          if (!staff) continue;
          staffToProfile.set(staff, {
            name: String(r.name ?? '').trim(),
            agency: String(r.agency ?? r.Agency ?? '').trim(),
            position: String(r.position ?? r.Position ?? '').trim()
          });
        }
      }

      const punchesByStaff = new Map<string, Array<{ action: 'IN' | 'OUT'; at: string }>>();
      for (const p of filteredPunches) {
        const list = punchesByStaff.get(p.staff_id) ?? [];
        list.push({ action: p.action, at: p.created_at });
        punchesByStaff.set(p.staff_id, list);
      }

      let maxPairs = 0;
      const body: string[][] = [];
      for (const staff of staffIds) {
        const list = punchesByStaff.get(staff) ?? [];
        list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
        const profile = staffToProfile.get(staff) ?? { name: '', agency: '', position: '' };
        const times: string[] = [];
        for (const item of list) {
          const timeText = formatTime(new Date(item.at));
          times.push(timeText);
        }
        maxPairs = Math.max(maxPairs, Math.ceil(times.length / 2));
        body.push([staff, profile.name, profile.agency, profile.position, ...times]);
      }

      const pairCount = Math.max(1, maxPairs);
      const headers = ['ID', '名字', 'Agency', 'Position'];
      for (let i = 0; i < pairCount; i += 1) {
        const label = ORDINAL_CN[i] ?? `第${i + 1}次`;
        headers.push(`${label}打入`, `${label}打出`);
      }

      const paddedBody = body.map((row) => {
        const out = [...row];
        while (out.length < headers.length) out.push('');
        return out;
      });

      try {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet([headers, ...paddedBody]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'daily_punches');
        const filename = `ob_punches_${timecardWeekInput}.xlsx`;
        XLSX.writeFile(wb, filename);
        setStatus({ tone: 'success', message: `已导出：${filename}` });
      } catch (err) {
        const filename = `ob_punches_${timecardWeekInput}.csv`;
        const csv = [headers, ...paddedBody]
          .map((row) =>
            row
              .map((cell) => {
                const v = String(cell ?? '');
                if (v.includes('"') || v.includes(',') || v.includes('\n')) {
                  return `"${v.replace(/"/g, '""')}"`;
                }
                return v;
              })
              .join(',')
          )
          .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus({ tone: 'success', message: `已导出：${filename}` });
      }
    });
  };

  const fetchPunchRowsForTimecard = async (staffId: string, dayIndex: number | null) => {
    if (!supabase) {
      return { rows: [] as PunchRow[], error: '缺少 Supabase 配置。' };
    }

    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);

    const dayRange =
      dayIndex === null ? getDayRange(weekStart, 0, 7) : getDayRange(weekStart, dayIndex);
    const dayStart = dayRange.start;
    const dayEnd = dayRange.end;

    // include an extra day on each side to cover cross-night shifts
    const rangeStart = addDays(dayStart, -1);
    const rangeEnd = addDays(dayEnd, 1);

    const base = () =>
      supabase
        .from('ob_punches')
        .select('id, staff_id, action, created_at')
        .eq('staff_id', staffId)
        .gte('created_at', rangeStart.toISOString())
        .lt('created_at', rangeEnd.toISOString())
        .limit(200);

    const attemptCreatedAt = await base().order('created_at', { ascending: true });
    const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: true }) : attemptCreatedAt;
    if (attempt.error) {
      return { rows: [] as PunchRow[], error: attempt.error.message };
    }

    const rows = (((attempt.data as any[]) ?? []) as any[]).map((r) => ({
      id: r.id,
      staff_id: String(r.staff_id ?? '').trim(),
      action: String(r.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
      created_at: (r.created_at ?? null) as string | null
    })) as PunchRow[];

    return { rows, error: null as string | null };
  };

  const openTimecardPunchModal = async (staffId: string, dayIndex: number | null) => {
    const staff = staffId.trim();
    if (!staff) return;

    setTimecardPunchOpen(true);
    setTimecardPunchStaffId(staff);
    setTimecardPunchDayIndex(dayIndex);
    setTimecardPunchError(null);
    setTimecardPunchRows([]);
    setTimecardPunchShowAll(false);
    setTimecardPunchPendingAddRows([]);
    setTimecardPunchPendingDeleteIds([]);
    setTimecardPunchAddOpen(false);
    setTimecardPunchEdits({});
    setTimecardPunchDraggingId(null);
    setTimecardPunchDragOverId(null);
    setTimecardPunchOrderIds([]);
    const nowLocal = toLocalDateTimeInputValue(new Date(serverTime));
    setTimecardPunchNew({ inAtLocal: nowLocal, outAtLocal: nowLocal });

    const requestId = ++timecardPunchFetchSeqRef.current;
    const res = await fetchPunchRowsForTimecard(staff, dayIndex);
    if (requestId !== timecardPunchFetchSeqRef.current) return;
    if (res.error) {
      setTimecardPunchError(res.error);
      setTimecardPunchRows([]);
      return;
    }
    setTimecardPunchRows(res.rows);

    const edits: Record<string, { action: 'IN' | 'OUT'; atLocal: string }> = {};
    for (const r of res.rows) {
      const dt = r.created_at ? new Date(r.created_at) : null;
      edits[String(r.id)] = {
        action: r.action,
        atLocal: dt && !Number.isNaN(dt.getTime()) ? toLocalDateTimeInputValue(dt) : ''
      };
    }
    setTimecardPunchEdits(edits);
  };

  const openTimecardPunchModalForDate = async (staffId: string, workDate: string) => {
    const staff = normalizeStaffId(String(staffId ?? '').trim());
    const dateOnly = String(workDate ?? '').trim();
    const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!staff || !match) return;

    const targetDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(targetDate.getTime())) return;

    const baseWeekStart = startOfWeekMonday(serverTime);
    const targetWeekStart = startOfWeekMonday(targetDate);
    const weekOffset = Math.round((targetWeekStart.getTime() - baseWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const dayIndex = Math.floor((targetDate.getTime() - targetWeekStart.getTime()) / (24 * 60 * 60 * 1000));
    if (dayIndex < 0 || dayIndex > 6) return;

    setTimecardWeekOffset(weekOffset);
    setTimecardWeekInput(dateOnly);
    await fetchTimecard({
      reset: true,
      weekOffset,
      search: staff,
      agency: '',
      position: '',
      missingEmployeeOnly: false,
      lockUi: false,
      deferLateSync: false
    });
    await openTimecardPunchModal(staff, dayIndex);
  };

  const closeTimecardPunchModal = () => {
    setTimecardPunchOpen(false);
    setTimecardPunchStaffId(null);
    setTimecardPunchDayIndex(null);
    setTimecardPunchRows([]);
    setTimecardPunchError(null);
    setTimecardPunchShowAll(false);
    setTimecardPunchPendingAddRows([]);
    setTimecardPunchPendingDeleteIds([]);
    setTimecardPunchAddOpen(false);
    setTimecardPunchEdits({});
    setTimecardPunchDraggingId(null);
    setTimecardPunchDragOverId(null);
    setTimecardPunchOrderIds([]);
    setTimecardPunchNew({ inAtLocal: '', outAtLocal: '' });
  };

  const notifyTimecardPunchSaved = (staffId: string, workDate: string) => {
    if (typeof window === 'undefined') return;
    const normalizedStaffId = normalizeStaffId(String(staffId ?? '').trim());
    const dateOnly = String(workDate ?? '').trim();
    if (!normalizedStaffId || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return;
    window.dispatchEvent(
      new CustomEvent('ob-timecard-punch-saved', {
        detail: {
          staffId: normalizedStaffId,
          workDate: dateOnly
        }
      })
    );
  };

  const renderTimecardPunchModal = () => {
    if (!timecardPunchOpen || typeof document === 'undefined') return null;
    return createPortal(
      <div
        className={[
          'fixed inset-0 z-50 flex items-center justify-center p-4',
          themeMode === 'light' ? 'bg-slate-900/35' : 'bg-black/70'
        ].join(' ')}
        role="dialog"
        aria-modal="true"
      >
        <div
          className={[
            'flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl shadow-2xl',
            themeMode === 'light' ? 'border border-slate-200 bg-white' : 'border border-white/10 bg-slate-950/90 backdrop-blur'
          ].join(' ')}
        >
          <div
            className={[
              'flex items-start justify-between gap-4 px-6 py-5',
              themeMode === 'light' ? 'border-b border-slate-200' : 'border-b border-white/10'
            ].join(' ')}
          >
            <div>
              <div className={['text-base font-semibold tracking-[0.06em]', themeMode === 'light' ? 'text-slate-800' : 'text-slate-100'].join(' ')}>
                工时校正
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className={['rounded-full px-2 py-0.5', themeMode === 'light' ? 'bg-slate-100 text-slate-700' : 'bg-white/10 text-slate-200'].join(' ')}>
                  {timecardPunchHeaderMeta.name}
                </span>
                <span className={['rounded-full px-2 py-0.5', themeMode === 'light' ? 'bg-slate-100 text-slate-700' : 'bg-white/10 text-slate-200'].join(' ')}>
                  {timecardPunchHeaderMeta.position}
                </span>
                <span className={['rounded-full px-2 py-0.5', themeMode === 'light' ? 'bg-slate-100 text-slate-700' : 'bg-white/10 text-slate-200'].join(' ')}>
                  {timecardPunchHeaderMeta.label}
                </span>
                <span className={['rounded-full px-2 py-0.5 font-semibold', themeMode === 'light' ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-500/15 text-emerald-200'].join(' ')}>
                  {timecardPunchHeaderMeta.finalHoursText}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!timecardPunchReadOnly && (
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setTimecardPunchAddOpen((prev) => !prev)}
                  className={[
                    'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                    themeMode === 'light'
                      ? 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                      : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  ].join(' ')}
                >
                  {timecardPunchAddOpen ? t('隐藏新增', 'Hide add') : t('新增打卡', 'Add punch')}
                </button>
              )}
              {!timecardPunchReadOnly && (
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => void saveAllTimecardPunchRows()}
                  className="rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('保存全部', 'Save all')}
                </button>
              )}
              <button
                type="button"
                disabled={isLocked}
                onClick={closeTimecardPunchModal}
                className={[
                  'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                  themeMode === 'light'
                    ? 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                    : 'bg-white/10 text-slate-200 hover:bg-white/15'
                ].join(' ')}
              >
                {t('关闭', 'Close')}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {!timecardPunchReadOnly && timecardPunchAddOpen && (
              <div
                className={[
                  'rounded-2xl px-4 py-4',
                  themeMode === 'light' ? 'border border-neon/50 bg-emerald-50' : 'border border-neon/40 bg-black/30 shadow-glow'
                ].join(' ')}
              >
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_7rem] md:items-end">
                  <div>
                    <div className={['text-xs uppercase tracking-[0.25em]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>IN Time</div>
                    <input
                      value={timecardPunchNew.inAtLocal}
                      disabled={isLocked}
                      onChange={(e) => setTimecardPunchNew((prev) => ({ ...prev, inAtLocal: e.target.value }))}
                      type="datetime-local"
                      className={[
                        'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                        themeMode === 'light'
                          ? 'border border-slate-300 bg-white text-slate-900'
                          : 'border border-white/10 bg-black/30 text-white'
                      ].join(' ')}
                    />
                  </div>
                  <div>
                    <div className={['text-xs uppercase tracking-[0.25em]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>OUT Time</div>
                    <input
                      value={timecardPunchNew.outAtLocal}
                      disabled={isLocked}
                      onChange={(e) => setTimecardPunchNew((prev) => ({ ...prev, outAtLocal: e.target.value }))}
                      type="datetime-local"
                      className={[
                        'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                        themeMode === 'light'
                          ? 'border border-slate-300 bg-white text-slate-900'
                          : 'border border-white/10 bg-black/30 text-white'
                      ].join(' ')}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => void addTimecardPunchRow()}
                    className="h-11 rounded-2xl bg-neon px-6 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('添加', 'Add')}
                  </button>
                </div>
                <p className={['mt-3 text-xs', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{t('手动一次添加一组 IN / OUT 打卡记录。', 'Add one IN/OUT pair manually.')}</p>
              </div>
            )}

            {timecardPunchError && <p className="text-sm text-ember">{t('操作失败：', 'Failed: ')}{timecardPunchError}</p>}
            {!timecardPunchError && timecardPunchRowsVisible.length === 0 && (
              <p className={['text-sm', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{t('暂无记录', 'No records')}</p>
            )}

            {timecardPunchCardsVisible.length > 0 && (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {timecardPunchCardsRendered.map((row) => {
                  const pendingAddIdSet = new Set(timecardPunchPendingAddRows.map((r) => String(r.id)));
                  const rowId = String(row.id);
                  const edit = timecardPunchEdits[rowId] ?? {
                    action: row.action,
                    atLocal: row.created_at ? toLocalDateTimeInputValue(new Date(row.created_at)) : ''
                  };
                  const rowLocal = row.created_at ? toLocalDateTimeInputValue(new Date(row.created_at)) : '';
                  const isDirty = edit.action !== row.action || edit.atLocal !== rowLocal;
                  const isPendingAdd = pendingAddIdSet.has(rowId);
                  const showEditedTone = isDirty || isPendingAdd;
                  const isDragSource = timecardPunchDraggingId === rowId;
                  const isDragTarget = timecardPunchDragOverId === rowId && timecardPunchDraggingId !== rowId;
                  const isSwapPairHighlighted =
                    Boolean(timecardPunchDraggingId && timecardPunchDragOverId) && (isDragSource || isDragTarget);

                  return (
                    <div
                      key={rowId}
                      draggable={!isLocked && !timecardPunchReadOnly}
                      onDragStart={(e) => {
                        if (isLocked || timecardPunchReadOnly) return;
                        setTimecardPunchDraggingId(rowId);
                        setTimecardPunchDragOverId(null);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', rowId);
                      }}
                      onDragOver={(e) => {
                        if (isLocked || timecardPunchReadOnly || !timecardPunchDraggingId || timecardPunchDraggingId === rowId) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (timecardPunchDragOverId !== rowId) setTimecardPunchDragOverId(rowId);
                      }}
                      onDragEnter={(e) => {
                        if (isLocked || timecardPunchReadOnly || !timecardPunchDraggingId || timecardPunchDraggingId === rowId) return;
                        e.preventDefault();
                        if (timecardPunchDragOverId !== rowId) setTimecardPunchDragOverId(rowId);
                      }}
                      onDrop={(e) => {
                        if (isLocked || timecardPunchReadOnly) return;
                        e.preventDefault();
                        const dragId = String(timecardPunchDraggingId ?? '').trim();
                        const dropId = String(timecardPunchDragOverId || rowId).trim();
                        if (dragId && dropId && dragId !== dropId) {
                          const targetRow = timecardPunchCardsVisible.find((r) => String(r.id) === dropId);
                          if (targetRow) {
                            const targetEdit = timecardPunchEdits[dropId] ?? {
                              action: targetRow.action,
                              atLocal: targetRow.created_at ? toLocalDateTimeInputValue(new Date(targetRow.created_at)) : ''
                            };
                            const targetAction: 'IN' | 'OUT' = targetEdit.action === 'OUT' ? 'OUT' : 'IN';
                            setTimecardPunchEdits((prev) => {
                              const sourceRow = timecardPunchCardsVisible.find((r) => String(r.id) === dragId);
                              if (!sourceRow) return prev;
                              const sourceEdit = prev[dragId] ?? {
                                action: sourceRow.action,
                                atLocal: sourceRow.created_at ? toLocalDateTimeInputValue(new Date(sourceRow.created_at)) : ''
                              };
                              if (sourceEdit.action === targetAction) return prev;
                              return {
                                ...prev,
                                [dragId]: { ...sourceEdit, action: targetAction }
                              };
                            });
                          }
                        }
                        swapTimecardPunchOrder(dragId, dropId);
                        setTimecardPunchDraggingId(null);
                        setTimecardPunchDragOverId(null);
                      }}
                      onDragEnd={() => {
                        swapTimecardPunchOrder(timecardPunchDraggingId, timecardPunchDragOverId);
                        setTimecardPunchDraggingId(null);
                        setTimecardPunchDragOverId(null);
                      }}
                      className={[
                        'relative rounded-2xl px-4 py-4 transition-[transform,box-shadow,opacity,background-color] duration-200 ease-out will-change-transform',
                        themeMode === 'light' ? 'border border-slate-200 bg-slate-50' : 'bg-white/5',
                        !isLocked && !timecardPunchReadOnly ? 'cursor-grab active:cursor-grabbing' : '',
                        isDragSource ? 'opacity-70 scale-[0.985]' : '',
                        isSwapPairHighlighted
                          ? themeMode === 'light'
                            ? 'ring-2 ring-neon/70 shadow-[0_0_24px_rgba(132,255,0,0.18)]'
                            : 'ring-2 ring-neon/70 shadow-glow'
                          : ''
                      ].join(' ')}
                    >
                      {!timecardPunchReadOnly && (
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => void deleteTimecardPunchRow(row)}
                          className="absolute right-3 top-3 h-7 w-7 rounded-full bg-ember/85 text-sm font-bold text-white transition hover:bg-ember disabled:cursor-not-allowed disabled:opacity-60"
                          title={t('删除此条', 'Delete this row')}
                        >
                          ×
                        </button>
                      )}
                      <div className="grid gap-3 md:grid-cols-[7rem_1fr] md:items-end">
                        <div>
                          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Action</div>
                          <select
                            value={edit.action}
                            disabled={isLocked || timecardPunchReadOnly}
                            onChange={(e) =>
                              setTimecardPunchEdits((prev) => ({
                                ...prev,
                                [rowId]: { ...edit, action: e.target.value === 'OUT' ? 'OUT' : 'IN' }
                              }))
                            }
                            className={[
                              'mt-2 h-10 w-full rounded-xl px-3 font-display text-lg tracking-[0.08em] outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                              showEditedTone
                                ? themeMode === 'light'
                                  ? 'border border-amber-400 bg-amber-50 text-slate-900'
                                  : 'border border-amber-400/70 bg-amber-500/10'
                                : themeMode === 'light'
                                  ? 'border border-slate-300 bg-white'
                                  : 'border border-white/10 bg-black/30',
                              edit.action === 'IN' ? 'text-mint' : 'text-ember'
                            ].join(' ')}
                          >
                            <option value="IN">IN</option>
                            <option value="OUT">OUT</option>
                          </select>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Time</div>
                          <input
                            value={edit.atLocal}
                            disabled={isLocked || timecardPunchReadOnly}
                            onChange={(e) =>
                              setTimecardPunchEdits((prev) => ({
                                ...prev,
                                [rowId]: { ...edit, atLocal: e.target.value }
                              }))
                            }
                            type="datetime-local"
                            className={[
                              'mt-2 h-10 w-full rounded-xl px-3 text-sm outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                              showEditedTone
                                ? themeMode === 'light'
                                  ? 'border border-amber-400 bg-amber-50 text-slate-900'
                                  : 'border border-amber-400/70 bg-amber-500/10 text-white'
                                : themeMode === 'light'
                                  ? 'border border-slate-300 bg-white text-slate-900'
                                  : 'border border-white/10 bg-black/30 text-white'
                            ].join(' ')}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const addTimecardPunchRow = async () => {
    if (!timecardCanOperate) {
      setTimecardPunchError(t('当前账号只有查看权限。', 'This account is read-only.'));
      return;
    }
    const staff = timecardPunchStaffId;
    if (!staff) {
      return;
    }

    const inCreatedAt = parseLocalDateTimeInputValue(timecardPunchNew.inAtLocal);
    const outCreatedAt = parseLocalDateTimeInputValue(timecardPunchNew.outAtLocal);
    if (!inCreatedAt || !outCreatedAt) {
      setTimecardPunchError('时间格式不正确。');
      return;
    }
    if (new Date(outCreatedAt).getTime() <= new Date(inCreatedAt).getTime()) {
      setTimecardPunchError('OUT 时间必须晚于 IN 时间。');
      return;
    }
    if (timecardPunchDayIndex === null || timecardPunchDayIndex < 0 || timecardPunchDayIndex > 6) {
      setTimecardPunchError('仅支持在单天视图新增打卡。');
      return;
    }
    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
    const dayRange = getDayRange(weekStart, timecardPunchDayIndex);
    const inMs = new Date(inCreatedAt).getTime();
    const outMs = new Date(outCreatedAt).getTime();
    const startMs = dayRange.start.getTime();
    const endMs = dayRange.end.getTime();
    if (inMs < startMs || inMs >= endMs || outMs < startMs || outMs >= endMs) {
      const startText = formatTime(dayRange.start);
      const endText = formatTime(dayRange.end);
      setTimecardPunchError(`时间必须在单天范围内（${startText} ~ ${endText}，允许跨夜）。`);
      return;
    }
    const inTempId = `tmp_add_${Date.now()}_in_${Math.random().toString(36).slice(2, 8)}`;
    const outTempId = `tmp_add_${Date.now()}_out_${Math.random().toString(36).slice(2, 8)}`;
    const stagedRows: PunchRow[] = [
      { id: inTempId, staff_id: staff, action: 'IN', created_at: inCreatedAt },
      { id: outTempId, staff_id: staff, action: 'OUT', created_at: outCreatedAt }
    ];
    setTimecardPunchError(null);
    setTimecardPunchPendingAddRows((prev) => [...prev, ...stagedRows]);
    setTimecardPunchEdits((prev) => ({
      ...prev,
      [inTempId]: { action: 'IN', atLocal: timecardPunchNew.inAtLocal },
      [outTempId]: { action: 'OUT', atLocal: timecardPunchNew.outAtLocal }
    }));
    const nowLocal = toLocalDateTimeInputValue(new Date(serverTime));
    setTimecardPunchNew({ inAtLocal: nowLocal, outAtLocal: nowLocal });
    setStatus({ tone: 'idle', message: t('已暂存新增，请点击保存全部提交。', 'Add staged. Click Save all to apply.') });
  };

  const saveAllTimecardPunchRows = async () => {
    if (!timecardCanOperate) {
      setTimecardPunchError(t('当前账号只有查看权限。', 'This account is read-only.'));
      return;
    }
    if (!supabase) {
      setTimecardPunchError('缺少 Supabase 配置。');
      return;
    }
    const staff = timecardPunchStaffId;
    if (!staff) return;
    const pendingAddIdSet = new Set(timecardPunchPendingAddRows.map((r) => String(r.id)));

    const changed = timecardPunchRowsVisible
      .map((row) => {
        const rowId = String(row.id);
        if (pendingAddIdSet.has(rowId)) return null;
        const edit = timecardPunchEdits[rowId];
        if (!edit) return null;
        const rowLocal = row.created_at ? toLocalDateTimeInputValue(new Date(row.created_at)) : '';
        const changed = edit.action !== row.action || edit.atLocal !== rowLocal;
        return changed ? { rowId, edit } : null;
      })
      .filter(Boolean) as Array<{ rowId: string; edit: { action: 'IN' | 'OUT'; atLocal: string } }>;
    const pendingAdds = timecardPunchPendingAddRows.filter((row) => !timecardPunchPendingDeleteIds.includes(String(row.id)));
    const deleteIds = timecardPunchPendingDeleteIds.filter((id) => !pendingAddIdSet.has(String(id)));
    const canCalcDayHours =
      timecardPunchDayIndex !== null && Number.isInteger(timecardPunchDayIndex) && timecardPunchDayIndex >= 0 && timecardPunchDayIndex <= 6;
    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
    const dayRangeForAudit = canCalcDayHours ? getDayRange(weekStart, timecardPunchDayIndex as number) : null;
    const snapshotSourceRows = timecardPunchRows;
    const punchSnapshot = new Map<string, { action: 'IN' | 'OUT'; created_at: string }>();
    for (const row of snapshotSourceRows) {
      const rowId = String(row.id ?? '').trim();
      const createdAt = String(row.created_at ?? '').trim();
      if (!rowId || !createdAt) continue;
      punchSnapshot.set(rowId, {
        action: row.action === 'OUT' ? 'OUT' : 'IN',
        created_at: createdAt
      });
    }
    const computeSnapshotDayHours = () => {
      if (!dayRangeForAudit) return Number.NaN;
      const events = Array.from(punchSnapshot.entries())
        .map(([id, row]) => {
          const at = new Date(row.created_at);
          if (Number.isNaN(at.getTime())) return null;
          return { id, action: row.action, at };
        })
        .filter(Boolean) as Array<{ id: string; action: 'IN' | 'OUT'; at: Date }>;
      events.sort((a, b) => {
        const diff = a.at.getTime() - b.at.getTime();
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id, 'en-US');
      });
      let openIn: Date | null = null;
      let totalMs = 0;
      for (const ev of events) {
        if (ev.action === 'IN') {
          openIn = ev.at;
          continue;
        }
        if (!openIn || ev.at.getTime() <= openIn.getTime()) continue;
        const overlapStart = Math.max(openIn.getTime(), dayRangeForAudit.start.getTime());
        const overlapEnd = Math.min(ev.at.getTime(), dayRangeForAudit.end.getTime());
        if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
        openIn = null;
      }
      if (openIn) {
        const capEnd = new Date(
          clamp(new Date(serverTime).getTime(), dayRangeForAudit.start.getTime(), dayRangeForAudit.end.getTime())
        );
        const overlapStart = Math.max(openIn.getTime(), dayRangeForAudit.start.getTime());
        const overlapEnd = Math.min(capEnd.getTime(), dayRangeForAudit.end.getTime());
        if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
      }
      return totalMs / 3600000;
    };
    const computeSnapshotDayPunchCount = () => {
      if (!dayRangeForAudit) return Number.NaN;
      let count = 0;
      for (const row of punchSnapshot.values()) {
        const at = new Date(row.created_at);
        if (Number.isNaN(at.getTime())) continue;
        const bucketTimeMs = getOperationalBucketTimeMs(at, row.action);
        if (bucketTimeMs >= dayRangeForAudit.start.getTime() && bucketTimeMs < dayRangeForAudit.end.getTime()) {
          count += 1;
        }
      }
      return count;
    };
    const dayDateForAudit = dayRangeForAudit ? toDateOnly(dayRangeForAudit.start) : '';
    const queueTimecardRefresh = () => {
      const run = () => {
        if (page === 'home') {
          void refreshHomePanel({ lockUi: false });
          return;
        }
        timecardWeekCacheRef.current = null;
        void fetchTimecard({ reset: true, lockUi: false });
      };
      if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
        (window as any).requestIdleCallback(run, { timeout: 1500 });
      } else {
        window.setTimeout(run, 200);
      }
    };

    if (changed.length === 0 && deleteIds.length === 0 && pendingAdds.length === 0) {
      setTimecardPunchError(null);
      const punchCount = computeSnapshotDayPunchCount();
      if (dayDateForAudit && Number.isFinite(punchCount) && punchCount > 0 && punchCount !== 4) {
        await writeAudit({
          action: 'punch_count_verified',
          staffId: staff,
          target: 'ob_punches',
          payload: {
            work_date: dayDateForAudit,
            punch_count: punchCount,
            expected_count: 4
          }
        });
        setStatus({ tone: 'success', message: t('Punch count verified and saved.', 'Punch count verified and saved.') });
      } else {
        setStatus({ tone: 'idle', message: t('No changes to save.', 'No changes to save.') });
      }
      closeTimecardPunchModal();
      void fetchCellAuditLogs();
      queueTimecardRefresh();
      return;
    }

    for (const item of changed) {
      const createdAt = parseLocalDateTimeInputValue(item.edit.atLocal);
      if (!createdAt) {
        setTimecardPunchError('时间格式不正确。');
        return;
      }
    }
    for (const row of pendingAdds) {
      const rowId = String(row.id);
      const edit = timecardPunchEdits[rowId] ?? {
        action: row.action,
        atLocal: row.created_at ? toLocalDateTimeInputValue(new Date(row.created_at)) : ''
      };
      const createdAt = parseLocalDateTimeInputValue(edit.atLocal);
      if (!createdAt) {
        setTimecardPunchError('时间格式不正确。');
        return;
      }
    }
    if (timecardPunchDayIndex !== null && timecardPunchDayIndex >= 0 && timecardPunchDayIndex <= 6) {
      const dayRange = getDayRange(weekStart, timecardPunchDayIndex);
      const startMs = dayRange.start.getTime();
      const endMs = dayRange.end.getTime();
      const startText = formatTime(dayRange.start);
      const endText = formatTime(dayRange.end);
      const ensureInRange = (createdAt: string) => {
        const ms = new Date(createdAt).getTime();
        return ms >= startMs && ms < endMs;
      };
      for (const item of changed) {
        const createdAt = parseLocalDateTimeInputValue(item.edit.atLocal);
        if (!createdAt) continue;
        if (!ensureInRange(createdAt)) {
          setTimecardPunchError(`编辑时间必须在当前日期范围内（${startText} ~ ${endText}）。`);
          return;
        }
      }
      for (const row of pendingAdds) {
        const rowId = String(row.id);
        const edit = timecardPunchEdits[rowId] ?? {
          action: row.action,
          atLocal: row.created_at ? toLocalDateTimeInputValue(new Date(row.created_at)) : ''
        };
        const createdAt = parseLocalDateTimeInputValue(edit.atLocal);
        if (!createdAt) continue;
        if (!ensureInRange(createdAt)) {
          setTimecardPunchError(`新增时间必须在当前日期范围内（${startText} ~ ${endText}）。`);
          return;
        }
      }
    }

    let saveFailed = false;
    await runLocked('timecard_edit_all', async () => {
      setTimecardPunchError(null);
      const hoursBeforeBatch = computeSnapshotDayHours();
      let editedCount = 0;
      let addedCount = 0;
      let deletedCount = 0;
      if (changed.length > 0) {
        const changedIds = changed.map((item) => item.rowId);
        const prevRowsRes = await supabase.from('ob_punches').select('id, metadata').in('id', changedIds as any[]);
        if (prevRowsRes.error) {
          saveFailed = true;
          setTimecardPunchError(prevRowsRes.error.message);
          return;
        }
        const prevMetaById = new Map<string, any>();
        for (const rec of ((prevRowsRes.data as any[]) ?? [])) {
          const id = String(rec?.id ?? '').trim();
          if (!id) continue;
          prevMetaById.set(id, rec?.metadata ?? null);
        }

        const editedAtIso = new Date(serverTime).toISOString();
        for (const batch of chunk(changed, 20)) {
          const updateJobs = batch.map(async (item) => {
            const createdAt = parseLocalDateTimeInputValue(item.edit.atLocal);
            if (!createdAt) return { ok: false as const, error: '时间格式不正确。', item };
            const prevMeta = prevMetaById.get(item.rowId);
            const nextMeta =
              prevMeta && typeof prevMeta === 'object'
                ? {
                    ...prevMeta,
                    device: 'admin_console',
                    kind: 'manual_edit',
                    manual: true,
                    operator: user?.email ?? null,
                    edited_at: editedAtIso
                  }
                : {
                    device: 'admin_console',
                    kind: 'manual_edit',
                    manual: true,
                    operator: user?.email ?? null,
                    edited_at: editedAtIso
                  };
            const { error } = await supabase
              .from('ob_punches')
              .update({ action: item.edit.action, created_at: createdAt, metadata: nextMeta })
              .eq('id', item.rowId);
            if (error) return { ok: false as const, error: error.message, item };
            return { ok: true as const, item, createdAt };
          });
          const updateResults = await Promise.all(updateJobs);
          const firstError = updateResults.find((r) => !r.ok);
          if (firstError && !firstError.ok) {
            saveFailed = true;
            setTimecardPunchError(firstError.error);
            return;
          }
          for (const result of updateResults) {
            if (!result.ok) continue;
            punchSnapshot.set(result.item.rowId, {
              action: result.item.edit.action,
              created_at: result.createdAt
            });
            editedCount += 1;
          }
        }
        if (saveFailed) return;
      }
      if (pendingAdds.length > 0) {
        const rowsToInsert = pendingAdds
          .map((row) => {
            const rowId = String(row.id);
            const edit = timecardPunchEdits[rowId] ?? {
              action: row.action,
              atLocal: row.created_at ? toLocalDateTimeInputValue(new Date(row.created_at)) : ''
            };
            const createdAt = parseLocalDateTimeInputValue(edit.atLocal);
            if (!createdAt) return null;
            return {
              staff_id: staff,
              action: edit.action,
              created_at: createdAt,
              metadata: {
                device: 'admin_console',
                kind: 'manual_add',
                manual: true,
                operator: user?.email ?? null
              }
            };
          })
          .filter(Boolean) as Array<Record<string, unknown>>;
        if (rowsToInsert.length > 0) {
          const insertRes = await supabase.from('ob_punches').insert(rowsToInsert).select('id');
          if (insertRes.error) {
            saveFailed = true;
            setTimecardPunchError(insertRes.error.message);
            return;
          }
          const insertedIds = ((insertRes.data as any[] | null) ?? []).map((x: any) => String(x?.id ?? '').trim());
          for (let i = 0; i < rowsToInsert.length; i += 1) {
            const row = rowsToInsert[i] as { action?: string; created_at?: string };
            const insertedId = insertedIds[i] || null;
            const rowAction = String(row.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
            const rowCreatedAt = String(row.created_at ?? '');
            if (insertedId && rowCreatedAt) {
              punchSnapshot.set(insertedId, { action: rowAction, created_at: rowCreatedAt });
            }
            addedCount += 1;
          }
        }
      }
      if (deleteIds.length > 0) {
        const beforeDeleteRes = await supabase
          .from('ob_punches')
          .select('id, action, created_at')
          .in('id', deleteIds as any[]);
        if (beforeDeleteRes.error) {
          saveFailed = true;
          setTimecardPunchError(beforeDeleteRes.error.message);
          return;
        }
        const { error: deleteError } = await supabase.from('ob_punches').delete().in('id', deleteIds as any[]);
        if (deleteError) {
          saveFailed = true;
          setTimecardPunchError(deleteError.message);
          return;
        }
        const beforeRows = ((beforeDeleteRes.data as any[]) ?? []) as Array<{ id?: string | number; action?: string; created_at?: string }>;
        for (const row of beforeRows) {
          const rowId = String(row.id ?? '').trim();
          if (rowId) punchSnapshot.delete(rowId);
          deletedCount += 1;
        }
      }

      const totalChanged = editedCount + addedCount + deletedCount;
      if (totalChanged > 0) {
        const hoursAfterBatch = computeSnapshotDayHours();
        const punchCountAfterBatch = computeSnapshotDayPunchCount();
        let batchAction = 'punch_manual_edit';
        if (editedCount === 0 && addedCount > 0 && deletedCount === 0) batchAction = 'punch_manual_add';
        else if (editedCount === 0 && addedCount === 0 && deletedCount > 0) batchAction = 'punch_manual_delete';
        await writeAudit({
          action: batchAction,
          staffId: staff,
          target: 'ob_punches',
          payload: {
            changed_rows: totalChanged,
            edited_rows: editedCount,
            added_rows: addedCount,
            deleted_rows: deletedCount,
            work_date: dayDateForAudit || null,
            hours_before: Number.isFinite(hoursBeforeBatch) ? Math.round(hoursBeforeBatch * 100) / 100 : null,
            hours_after: Number.isFinite(hoursAfterBatch) ? Math.round(hoursAfterBatch * 100) / 100 : null
          }
        });
        if (dayDateForAudit && Number.isFinite(punchCountAfterBatch) && punchCountAfterBatch > 0 && punchCountAfterBatch !== 4) {
          await writeAudit({
            action: 'punch_count_verified',
            staffId: staff,
            target: 'ob_punches',
            payload: {
              work_date: dayDateForAudit,
              punch_count: punchCountAfterBatch,
              expected_count: 4
            }
          });
        }
      }
    });
    if (saveFailed) return;
    setStatus({ tone: 'success', message: t('打卡流水已保存。', 'Punch records saved.') });
    if (dayDateForAudit) notifyTimecardPunchSaved(staff, dayDateForAudit);
    closeTimecardPunchModal();
    void fetchCellAuditLogs();
    queueTimecardRefresh();
  };
  const deleteTimecardPunchRow = async (row: PunchRow) => {
    if (!timecardCanOperate) {
      setTimecardPunchError(t('当前账号只有查看权限。', 'This account is read-only.'));
      return;
    }
    const rowId = String(row.id ?? '').trim();
    if (!rowId) return;
    const ok = await askConfirm(
      t('确定要删除这条打卡记录吗？', 'Delete this punch record?'),
      t('删除确认', 'Delete Confirmation')
    );
    if (!ok) return;

    const pendingAddIdSet = new Set(timecardPunchPendingAddRows.map((r) => String(r.id)));
    const isPendingAdd = pendingAddIdSet.has(rowId);

    setTimecardPunchError(null);
    if (isPendingAdd) {
      setTimecardPunchPendingAddRows((prev) => prev.filter((item) => String(item.id) !== rowId));
      setTimecardPunchEdits((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
      setTimecardPunchPendingDeleteIds((prev) => prev.filter((id) => String(id) !== rowId));
    } else {
      setTimecardPunchPendingDeleteIds((prev) => Array.from(new Set([...prev, rowId])));
    }
    setStatus({ tone: 'idle', message: t('已暂存删除，请点击保存全部提交。', 'Delete staged. Click Save all to apply.') });
  };
  const swapTimecardPunchOrder = (dragIdRaw: string | null | undefined, dropIdRaw: string | null | undefined) => {
    const dragId = String(dragIdRaw ?? '').trim();
    const dropId = String(dropIdRaw ?? '').trim();
    if (!dragId || !dropId || dragId === dropId) return;
    setTimecardPunchOrderIds((prev) => {
      if (prev.length === 0) return prev;
      const fromIdx = prev.findIndex((id) => id === dragId);
      const toIdx = prev.findIndex((id) => id === dropId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
      const next = [...prev];
      const temp = next[fromIdx];
      next[fromIdx] = next[toIdx]!;
      next[toIdx] = temp!;
      return next;
    });
  };

  useEffect(() => {
    // 当切换到页面时自动加载
    if (page === 'home') {
      void refreshHomePanel({ lockUi: false });
    }
    if (page === 'punches') {
      void fetchRecentPunches({ search: punchesSearch, lockUi: false });
    }
    if (page === 'employees') {
      void fetchEmployees({ reset: true, lockUi: false });
    }
    if (page === 'accounts') {
      void fetchEmployees({ reset: true, lockUi: false });
      void fetchTempAccounts({ lockUi: false });
    }
    if (page === 'timecard') {
      void fetchTimecard({ reset: true, lockUi: false });
    }
    if (page === 'work_hour_comparison') {
      setStatus({ tone: 'idle', message: t('工时对比：请选择日期后上传 iAMS 文件。', 'Work hour comparison: select a date and upload iAMS file.') });
    }
    if (page === 'todo') {
      setStatus({ tone: 'idle', message: t('待办：管理分配、完成和删除确认。', 'ToDo: manage assignments, completion, and delete approvals.') });
    }
    if (page === 'audit') {
      void fetchAudit({ search: auditSearch });
    }
    if (page === 'schedule') {
      void refreshSchedulePanel({ lockUi: false });
    }
    if (page === 'devices') {
      void refreshDevicePanel({ lockUi: false });
    }
  }, [page]);

  useEffect(() => {
    if (page !== 'timecard' && page !== 'schedule') return;
    void fetchCellAuditLogs();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void fetchCellAuditLogs();
    }, 180000);
    return () => window.clearInterval(timer);
  }, [page]);

  useEffect(() => {
    if (!user || page !== 'home') {
      setAttendanceStats({});
      setAttendanceError(null);
      return;
    }
    let active = true;
    const sync = async () => {
      if (!active) return;
      await fetchRealtimeAttendance();
      const currentEmployees = homeEmployeesRef.current;
      if (currentEmployees.length > 0) {
        await fetchSchedulePunchPresence({
          employeesOverride: currentEmployees,
          weekOffsetOverride: 0,
          mode: 'operational_day',
          keepPreviousWhileLoading: true
        });
      }
    };
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void sync();
    }, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user, offsetMs, page]);

  useEffect(() => {
    if (page !== 'punches') {
      return;
    }
    const handle = window.setTimeout(() => {
      void fetchRecentPunches({ search: punchesSearch, lockUi: false });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [page, punchesSearch]);

  useEffect(() => {
    if (page !== 'schedule') return;
    void fetchSchedule();
  }, [page, scheduleWeekOffset]);

  useEffect(() => {
    if (page !== 'schedule') return;
    void fetchSchedulePunchPresence();
  }, [page, scheduleWeekOffset, employees]);

  useEffect(() => {
    if (page !== 'schedule') return;
    void fetchScheduleUph();
    void fetchScheduleMistakeCounts();
  }, [page, employees]);

  useEffect(() => {
    if (page !== 'schedule') return;
    void fetchScheduleMonthlyAbsentDates();
  }, [page, employees, scheduleWeekOffset, toDateOnly(serverTime)]);

  useEffect(() => {
    if (page !== 'schedule') return;
    if (scheduleRowsWeekOffset !== scheduleWeekOffset) return;
    void fetchScheduleLateMarks();
  }, [page, employees, scheduleRows, scheduleRowsWeekOffset, scheduleWeekOffset, toDateOnly(serverTime)]);

  useEffect(() => {
    if (page !== 'schedule' || !dailyListOpen) return;
    const requestId = dailyCapacityRequestRef.current + 1;
    dailyCapacityRequestRef.current = requestId;
    setDailyCapacityLoading(true);
    setDailyCapacityError(null);

    void (async () => {
      let nextTemplatePayload = effDefaultPayload();
      let templateError: string | null = null;

      if (supabase) {
        const latestTemplateRes = await supabase
          .from(EFFICIENCY_TEMPLATE_TABLE)
          .select('payload, updated_at')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestTemplateRes.error && !isMissingTableError(latestTemplateRes.error.message, EFFICIENCY_TEMPLATE_TABLE)) {
          templateError = String(latestTemplateRes.error.message ?? 'Failed to load efficiency template.');
        } else {
          nextTemplatePayload = effNormalizePayload(latestTemplateRes.data?.payload ?? effDefaultPayload());
        }
      } else {
        templateError = 'Missing Supabase configuration.';
      }

      const result = await loadDailyCapacityStaffStats({
        supabase,
        employees,
        targetDate: dailyListTargetDateKey,
        serverTime
      });

      if (requestId !== dailyCapacityRequestRef.current) return;
      setDailyCapacityTemplatePayload(nextTemplatePayload);
      setDailyCapacityStaffStatsByStaffId(result.byStaffId);
      setDailyCapacityError(result.error ?? templateError);
      setDailyCapacityLoading(false);
    })();
  }, [page, dailyListOpen, dailyListTargetDateKey, employees, toDateOnly(serverTime)]);

  useEffect(() => {
    if (page !== 'schedule') return;
    void maybeRolloverScheduleWeek();
    void activatePlannedScheduleStatesForToday({ lockUi: false });
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void maybeRolloverScheduleWeek();
      void activatePlannedScheduleStatesForToday({ lockUi: false });
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [page, user?.id, offsetMs]);

  const onFileSelected = async (file: File | null) => {
    if (!file) {
      setUploadError(null);
      return;
    }

    const name = (file.name ?? '').toLowerCase();
    try {
      if (
        name.endsWith('.csv') ||
        name.endsWith('.xlsx') ||
        name.endsWith('.xls') ||
        file.type === 'text/csv' ||
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.type === 'application/vnd.ms-excel'
      ) {
        setUploadError(null);
        return;
      }

      setUploadError('不支持的文件类型，请上传 CSV 或 Excel (.xlsx/.xls)。');
    } catch (err: any) {
      setUploadError(String(err?.message ?? err));
    }
  };

  const uploadEmployees = async () => {
    if (!supabase) {
      setUploadError('缺少 Supabase 配置，请检查环境变量。');
      return;
    }

    const file = fileInputRef.current?.files?.[0] ?? null;
    if (!file) {
      setUploadError('请先选择 CSV 文件。');
      return;
    }

    let parsedRows: Record<string, string>[] = [];
    const name = (file.name ?? '').toLowerCase();
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      const parsed = parseCsv(await file.text());
      parsedRows = parsed.rows;
    } else {
      try {
        const XLSX = await import('xlsx');
        const ab = await file.arrayBuffer();
        const workbook = XLSX.read(ab, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]) || [];
        const headerRow = (rows[0] ?? []).map((h: any) => String(h ?? '').trim());
        parsedRows = rows
          .slice(1)
          .map((r) => {
            const obj: Record<string, string> = {};
            for (let i = 0; i < headerRow.length; i += 1) {
              const key = headerRow[i] ?? '';
              obj[key] = String(r[i] ?? '').trim();
            }
            return obj;
          })
          .filter((r) => Object.values(r).some((v) => String(v).trim() !== ''));
      } catch (err) {
        setUploadError('无法解析上传文件，请确保是 CSV 或 Excel。');
        return;
      }
    }

    // Normalize rows, accept UID as alias for staff_id
    const allowedPositions = ['Pack', 'Pick', 'Rebin', 'Preship', 'Transfer', 'FLEX TEAM'] as const;
    const normalizePosition = (positionRaw: string) => {
      const v = positionRaw.trim().toLowerCase();
      const map: Record<string, (typeof allowedPositions)[number]> = {
        pack: 'Pack',
        pick: 'Pick',
        rebin: 'Rebin',
        preship: 'Preship',
        transfer: 'Transfer',
        '兜底组': 'FLEX TEAM',
        '兜底': 'FLEX TEAM',
        'flex team（机动组）': 'FLEX TEAM',
        'flex team': 'FLEX TEAM',
        flexteam: 'FLEX TEAM',
        'wrap-up team': 'FLEX TEAM',
        'wrap up team': 'FLEX TEAM',
        wrapupteam: 'FLEX TEAM',
        fallback: 'FLEX TEAM',
        backup: 'FLEX TEAM'
      };
      return map[v] ?? null;
    };

    const uniqueByStaff = new Map<
      string,
      {
        staff_id: string;
        name?: string;
        agency?: string;
        position?: string;
        employment_type?: EmploymentType;
        shift_time?: string;
        label?: string;
        work_account?: string;
        work_password?: string;
      }
    >();
    let duplicateInFileCount = 0;

    for (const r of parsedRows) {
      const canonical: Record<string, string> = {};
      for (const [rawKey, rawValue] of Object.entries(r)) {
        if (!rawKey) continue;
        const value = String(rawValue ?? '').trim();
        if (!value) continue;
        const normalized = normalizeHeaderKey(rawKey);
        const mapped = EMPLOYEE_KEY_ALIASES[normalized] ?? normalized;
        if (!canonical[mapped]) canonical[mapped] = value;
      }

      const staff = (canonical.staff_id ?? '').trim().toUpperCase();
      if (!staff) continue;
      if (uniqueByStaff.has(staff)) {
        duplicateInFileCount += 1;
        continue;
      }

      const name = canonical.name?.trim();
      const agency = canonical.agency?.trim();
      const positionRaw = canonical.position?.trim();
      const position = positionRaw ? normalizePosition(positionRaw) : null;
      const employmentType = normalizeEmploymentTypeValue(canonical.employment_type ?? '');
      const label = canonical.label?.trim();
      const shiftTime = normalizeShiftTimeValue(canonical.shift_time ?? '');
      const workAccount = canonical.work_account?.trim();
      const workPassword = canonical.work_password?.trim();

      const record: {
        staff_id: string;
        name?: string;
        agency?: string;
        position?: string;
        employment_type?: EmploymentType;
        shift_time?: string;
        label?: string;
        work_account?: string;
        work_password?: string;
      } = { staff_id: staff };
      if (name) record.name = name;
      if (agency) record.agency = agency;
      if (position) record.position = position;
      if (positionRaw && !position) record.position = positionRaw;
      record.employment_type = employmentType;
      if (shiftTime) record.shift_time = shiftTime;
      if (label) record.label = label;
      if (workAccount) record.work_account = workAccount;
      if (workPassword) record.work_password = workPassword;
      uniqueByStaff.set(staff, record);
    }

    const rows = Array.from(uniqueByStaff.values());

    if (rows.length === 0) {
      setUploadError('CSV 没有可用数据行（staff_id 为空）。');
      return;
    }

    const invalidPositions = rows
      .map((r) => ({
        staff_id: String((r as any).staff_id ?? '').trim(),
        position: String((r as any).position ?? '').trim()
      }))
      .filter(({ position }) => position && !allowedPositions.includes(position as any));

    if (invalidPositions.length > 0) {
      const sample = invalidPositions
        .slice(0, 8)
        .map((x) => `${x.staff_id || '(no staff_id)'}=${x.position}`)
        .join('，');
      setUploadError(
        `Position 只允许 Pack / Pick / Rebin / Preship / Transfer / FLEX TEAM。发现不合法值：${sample}${
          invalidPositions.length > 8 ? ` …（共 ${invalidPositions.length} 条）` : ''
        }`
      );
      return;
    }

    // Guard rail: reject import when staff_id appears to be modified.
    // Rule: if incoming staff_id does not exist, but another existing row matches same
    // work_account OR (name + agency), treat as USID-change attempt and reject whole import.
    const detectModifiedStaffIds = async () => {
      const mode = await resolveEmployeeColumnMode();
      const run = async (m: EmployeeColumnMode) => {
        const select =
          m === 'cased'
            ? 'staff_id, name, "Agency", work_account'
            : 'staff_id, name, agency, work_account';
        return await supabase.from(EMPLOYEE_TABLE).select(select);
      };

      let res = await run(mode);
      if (res.error) {
        const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
        employeeColumnModeRef.current = flipped;
        res = await run(flipped);
      }
      if (res.error) return { error: res.error.message, suspicious: [] as string[] };

      const existing = ((res.data as any[]) ?? []) as any[];
      const existingByStaff = new Set<string>();
      const existingByAccount = new Map<string, string>();
      const existingByNameAgency = new Map<string, string>();
      for (const row of existing) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (!staff) continue;
        existingByStaff.add(staff);
        const account = String(row.work_account ?? '').trim().toLowerCase();
        if (account && !existingByAccount.has(account)) existingByAccount.set(account, staff);
        const name = String(row.name ?? '').trim().toLowerCase();
        const agency = String(row.agency ?? row.Agency ?? '').trim().toLowerCase();
        if (name && agency) {
          const key = `${name}__${agency}`;
          if (!existingByNameAgency.has(key)) existingByNameAgency.set(key, staff);
        }
      }

      const suspicious: string[] = [];
      for (const row of rows) {
        const incomingStaff = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (!incomingStaff || existingByStaff.has(incomingStaff)) continue;

        const account = String(row.work_account ?? '').trim().toLowerCase();
        const accountOwner = account ? existingByAccount.get(account) ?? '' : '';
        if (accountOwner && accountOwner !== incomingStaff) {
          suspicious.push(`${incomingStaff} -> ${accountOwner} (work_account)`);
          continue;
        }

        const name = String(row.name ?? '').trim().toLowerCase();
        const agency = String(row.agency ?? '').trim().toLowerCase();
        const key = name && agency ? `${name}__${agency}` : '';
        const matchedStaff = key ? existingByNameAgency.get(key) ?? '' : '';
        if (matchedStaff && matchedStaff !== incomingStaff) {
          suspicious.push(`${incomingStaff} -> ${matchedStaff} (${name}/${agency})`);
        }
      }

      return { error: null as string | null, suspicious };
    };

    const detectResult = await detectModifiedStaffIds();
    if (detectResult.error) {
      setUploadError(`导入前校验失败：${detectResult.error}`);
      return;
    }
    if (detectResult.suspicious.length > 0) {
      const sample = detectResult.suspicious.slice(0, 6).join('；');
      setUploadError(
        `检测到疑似修改USID，已拒绝导入。请不要修改导出模板中的 EMPLOYEE ID。命中：${sample}${
          detectResult.suspicious.length > 6 ? ` …（共 ${detectResult.suspicious.length} 条）` : ''
        }`
      );
      return;
    }

    const writeEmployeeBatch = async (batch: any[]) => {
      const auditItems: Array<{ action: string; staffId: string; payload: Record<string, unknown> }> = [];
      const batchStaffIds = batch.map((r) => String(r.staff_id ?? '').trim()).filter(Boolean);
      if (batchStaffIds.length === 0) {
        return { error: null as any, inserted: 0, skippedExisting: 0, updated: 0, auditItems };
      }

      const fetchExistingDetails = async () => {
        const mode = await resolveEmployeeColumnMode();
        const run = async (m: EmployeeColumnMode) => {
          const select =
            m === 'cased'
              ? 'staff_id, name, "Agency", "Position", employment_type, shift_time, label, work_account, work_password'
              : 'staff_id, name, agency, position, employment_type, shift_time, label, work_account, work_password';
          const res = await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', batchStaffIds);
          return { mode: m, res };
        };

        let attempt = await run(mode);
        if (attempt.res.error) {
          const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
          employeeColumnModeRef.current = flipped;
          attempt = await run(flipped);
        }

        if (attempt.res.error) {
          return { mode: mode, rows: [] as any[], error: attempt.res.error };
        }

        return { mode: attempt.mode, rows: ((attempt.res.data as any[]) ?? []) as any[], error: null as any };
      };

      const existingDetailsRes = await fetchExistingDetails();
      if (existingDetailsRes.error) {
        return { error: existingDetailsRes.error, inserted: 0, skippedExisting: 0, updated: 0, auditItems };
      }

      const existingSet = new Set<string>(existingDetailsRes.rows.map((r) => String(r.staff_id ?? '').trim()).filter(Boolean));

      const toInsert = batch.filter((r) => !existingSet.has(String(r.staff_id ?? '').trim()));
      const skippedExisting = batch.length - toInsert.length;

      const tryInsert = async (payload: any[]) => {
        const inserted = await supabase.from(EMPLOYEE_TABLE).insert(payload);
        return { error: inserted.error };
      };

      let insertedCount = 0;
      if (toInsert.length > 0) {
        const mode = await resolveEmployeeColumnMode();
        const buildPayload = (m: EmployeeColumnMode) =>
          m === 'cased'
            ? toInsert.map((row: any) => ({
                staff_id: row.staff_id,
                name: row.name ?? null,
                Agency: row.agency ?? null,
                Position: row.position ?? null,
                employment_type: normalizeEmploymentTypeValue(row.employment_type),
                shift_time: row.shift_time ?? null,
                label: row.label ?? null,
                work_account: row.work_account ?? null,
                work_password: row.work_password ?? null
              }))
            : toInsert.map((row: any) => ({
                staff_id: row.staff_id,
                name: row.name ?? null,
                agency: row.agency ?? null,
                position: row.position ?? null,
                employment_type: normalizeEmploymentTypeValue(row.employment_type),
                shift_time: row.shift_time ?? null,
                label: row.label ?? null,
                work_account: row.work_account ?? null,
                work_password: row.work_password ?? null
              }));

        let attempt = await tryInsert(buildPayload(mode));
        if (attempt.error) {
          const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
          employeeColumnModeRef.current = flipped;
          attempt = await tryInsert(buildPayload(flipped));
        }

        if (!attempt.error) {
          insertedCount = toInsert.length;
        } else {
          // Last resort: only staff_id + name
          const minimal = toInsert.map((row: any) => ({ staff_id: row.staff_id, name: row.name ?? null }));
          const attemptMinimal = await tryInsert(minimal as any[]);
          if (attemptMinimal.error) {
            return { error: attemptMinimal.error, inserted: 0, skippedExisting, updated: 0, auditItems };
          }
          insertedCount = toInsert.length;
        }
        for (const row of toInsert) {
          const staff = String(row.staff_id ?? '').trim();
          if (!staff) continue;
          auditItems.push({
            action: 'employee_upsert',
            staffId: staff,
            payload: {
              staff_id: staff,
              name: row.name ?? '',
              agency: row.agency ?? '',
              position: row.position ?? '',
              employment_type: normalizeEmploymentTypeValue(row.employment_type),
              shift_time: row.shift_time ?? '',
              label: row.label ?? '',
              work_account: row.work_account ?? '',
              work_password: row.work_password ?? '',
              source: 'import'
            }
          });
        }
      }

      const existingByStaff = new Map<
        string,
        {
          name: string;
          agency: string;
          position: string;
          employment_type: EmploymentType;
          shift_time: string;
          label: string;
          work_account: string;
          work_password: string;
        }
      >();
      for (const r of existingDetailsRes.rows) {
        const staff = String(r.staff_id ?? '').trim();
        if (!staff) continue;
        existingByStaff.set(staff, {
          name: String(r.name ?? '').trim(),
          agency: String(r.agency ?? r.Agency ?? '').trim(),
          position: String(r.position ?? r.Position ?? '').trim(),
          employment_type: normalizeEmploymentTypeValue(r.employment_type),
          shift_time: normalizeShiftTimeValue(r.shift_time),
          label: String(r.label ?? r.Label ?? '').trim(),
          work_account: String(r.work_account ?? r.WorkAccount ?? '').trim(),
          work_password: String(r.work_password ?? r.WorkPassword ?? '').trim()
        });
      }

      if (skippedExisting === 0) {
        return { error: null as any, inserted: insertedCount, skippedExisting, updated: 0, auditItems };
      }

      const toUpdate: Array<{
        staff_id: string;
        payload: Record<string, unknown>;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      }> = [];
      for (const row of batch) {
        const staff = String(row.staff_id ?? '').trim();
        if (!staff || !existingSet.has(staff)) continue;
        const existing = existingByStaff.get(staff) ?? {
          name: '',
          agency: '',
          position: '',
          employment_type: 'FT' as EmploymentType,
          shift_time: '',
          label: '',
          work_account: '',
          work_password: ''
        };

        const payload: Record<string, unknown> = {};
        if (row.name && String(row.name).trim() && String(row.name).trim() !== existing.name) payload.name = String(row.name).trim();
        if (row.agency && String(row.agency).trim() && String(row.agency).trim() !== existing.agency) {
          if (existingDetailsRes.mode === 'cased') payload.Agency = String(row.agency).trim();
          else payload.agency = String(row.agency).trim();
        }
        if (row.position && String(row.position).trim() && String(row.position).trim() !== existing.position) {
          if (existingDetailsRes.mode === 'cased') payload.Position = String(row.position).trim();
          else payload.position = String(row.position).trim();
        }
        const nextEmploymentType = normalizeEmploymentTypeValue(row.employment_type);
        if (nextEmploymentType !== existing.employment_type) {
          payload.employment_type = nextEmploymentType;
        }
        if (row.shift_time && normalizeShiftTimeValue(row.shift_time) && normalizeShiftTimeValue(row.shift_time) !== existing.shift_time) {
          payload.shift_time = normalizeShiftTimeValue(row.shift_time);
        }
        if (row.label && String(row.label).trim() && String(row.label).trim() !== existing.label) payload.label = String(row.label).trim();
        if (row.work_account && String(row.work_account).trim() && String(row.work_account).trim() !== existing.work_account) {
          payload.work_account = String(row.work_account).trim();
        }
        if (row.work_password && String(row.work_password).trim() && String(row.work_password).trim() !== existing.work_password) {
          payload.work_password = String(row.work_password).trim();
        }

        if (Object.keys(payload).length > 0) {
          const before = {
            staff_id: staff,
            name: existing.name,
            agency: existing.agency,
            position: existing.position,
            employment_type: existing.employment_type,
            shift_time: existing.shift_time,
            label: existing.label,
            work_account: existing.work_account,
            work_password: existing.work_password
          };
          const after = {
            staff_id: staff,
            name: payload.name ?? existing.name,
            agency: payload.agency ?? payload.Agency ?? existing.agency,
            position: payload.position ?? payload.Position ?? existing.position,
            employment_type: payload.employment_type ?? existing.employment_type,
            shift_time: payload.shift_time ?? existing.shift_time,
            label: payload.label ?? existing.label,
            work_account: payload.work_account ?? existing.work_account,
            work_password: payload.work_password ?? existing.work_password
          };
          toUpdate.push({ staff_id: staff, payload, before, after });
        }
      }

      if (toUpdate.length === 0) {
        return { error: null as any, inserted: insertedCount, skippedExisting, updated: 0, auditItems };
      }

      let updated = 0;
      for (const u of toUpdate) {
        const res = await supabase.from(EMPLOYEE_TABLE).update(u.payload).eq('staff_id', u.staff_id);
        if (res.error) {
          return { error: res.error, inserted: insertedCount, skippedExisting, updated, auditItems };
        }
        auditItems.push({
          action: 'employee_update',
          staffId: u.staff_id,
          payload: {
            old_staff_id: u.staff_id,
            staff_id: u.staff_id,
            name: u.after.name,
            agency: u.after.agency,
            position: u.after.position,
            employment_type: u.after.employment_type,
            shift_time: u.after.shift_time,
            label: u.after.label,
            work_account: u.after.work_account,
            work_password: u.after.work_password,
            before: u.before,
            after: u.after,
            source: 'import_update'
          }
        });
        updated += 1;
      }

      return { error: null as any, inserted: insertedCount, skippedExisting, updated, auditItems };
    };

    await runLocked('employee_upload', async () => {
      setUploadError(null);
      setStatus({ tone: 'pending', message: `上传中... (${rows.length} 条)` });
      const batches = chunk(rows, 200);
      let insertedTotal = 0;
      let skippedExistingTotal = 0;
      let updatedTotal = 0;
      for (const batch of batches) {
        const { error, inserted, skippedExisting, updated, auditItems } = await writeEmployeeBatch(batch as any[]);
        if (error) {
          setUploadError(error.message);
          setStatus({ tone: 'error', message: '上传失败' });
          return;
        }
        insertedTotal += inserted ?? 0;
        skippedExistingTotal += skippedExisting ?? 0;
        updatedTotal += updated ?? 0;
        for (const item of auditItems ?? []) {
          await writeAudit({
            action: item.action,
            staffId: item.staffId,
            target: EMPLOYEE_TABLE,
            payload: item.payload
          });
        }
      }
      const skippedTotal = duplicateInFileCount + skippedExistingTotal;
      setStatus({
        tone: 'success',
        message: `上传完成：插入 ${insertedTotal} 条，更新 ${updatedTotal} 条，跳过重复 ${skippedTotal} 条（文件内 ${duplicateInFileCount}，表内 ${skippedExistingTotal}）`
      });
      await writeAudit({
        action: 'employee_upload',
        target: EMPLOYEE_TABLE,
        payload: {
          file_name: file.name ?? null,
          total_rows: rows.length,
          inserted: insertedTotal,
          updated_fill: updatedTotal,
          skipped_total: skippedTotal,
          skipped_file_duplicates: duplicateInFileCount,
          skipped_existing: skippedExistingTotal
        }
      });
    });
  };

  const downloadEmployeeTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const headers = ['staff_id', 'name', 'agency', 'position', 'employment_type', 'shift_time', 'label', 'work_account', 'work_password'];
      const ws = XLSX.utils.aoa_to_sheet([headers]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'template');
      XLSX.writeFile(wb, 'ob_employees_template.xlsx');
    } catch {
      const headers = ['staff_id', 'name', 'agency', 'position', 'employment_type', 'shift_time', 'label', 'work_account', 'work_password'];
      const csv = `${headers.join(',')}\n`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ob_employees_template.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  };

  const downloadDeviceTemplate = async () => {
    try {
      const headers = ['device_name', 'device_sn', 'device_type', 'position', 'note', 'active'];
      const sample = ['PDA 01', 'PDA-0001', 'PDA', 'Pick', 'optional', 'true'];
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'template');
      XLSX.writeFile(wb, 'ob_devices_template.xlsx');
    } catch {
      const csv = 'device_name,device_sn,device_type,position,note,active\nPDA 01,PDA-0001,PDA,Pick,optional,true\n';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ob_devices_template.csv';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const downloadTempAccountTemplate = async () => {
    try {
      const headers = ['name', 'position', 'work_account', 'work_password'];
      const sample = ['Example Name', 'Pick', '60100001', 'Helloworld2!'];
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'template');
      XLSX.writeFile(wb, 'ob_temp_accounts_template.xlsx');
    } catch {
      const csv = 'name,position,work_account,work_password\nExample Name,Pick,60100001,Helloworld2!\n';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ob_temp_accounts_template.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  };

  const employeeAgencyOptions = useMemo(() => {
    const out = new Set<string>();
    for (const e of employees) {
      const agency = String(e.agency ?? e.Agency ?? '').trim();
      if (agency) out.add(agency);
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [employees]);

  const employeePositionOptions = useMemo(() => {
    const out = new Set<string>();
    for (const e of employees) {
      const position = String(e.position ?? e.Position ?? '').trim();
      if (position) out.add(position);
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [employees]);

  const collectEmployeeLabelOptionsByPosition = (positionRaw: string) => {
    const targetPosition = normalizePositionKey(positionRaw);
    const out = new Set<string>();
    for (const e of employees) {
      const label = String(e.label ?? e.Label ?? '').trim();
      if (!label) continue;
      if (targetPosition) {
        const rowPosition = normalizePositionKey(String(e.position ?? e.Position ?? '').trim());
        if (rowPosition !== targetPosition) continue;
      }
      out.add(label);
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  };

  const employeeFilterLabelOptions = useMemo(
    () => collectEmployeeLabelOptionsByPosition(employeePosition),
    [employees, employeePosition]
  );

  const employeeAddLabelOptions = useMemo(
    () => collectEmployeeLabelOptionsByPosition(employeeNewPosition),
    [employees, employeeNewPosition]
  );

  const employeeEditLabelOptions = useMemo(
    () => collectEmployeeLabelOptionsByPosition(employeeEditPosition),
    [employees, employeeEditPosition]
  );
  useEffect(() => {
    if (!employeeAddOpen) return;
    if (!shouldAutofillShiftTime(employeeNewShiftTime)) return;
    const position = normalizePositionKey(employeeNewPosition);
    const shift = employeeNewShift;
    if (!position || (shift !== 'early' && shift !== 'late')) return;
    setEmployeeNewShiftTime(getDefaultShiftStartTime(shift, position));
  }, [employeeAddOpen, employeeNewPosition, employeeNewShift]);
  useEffect(() => {
    if (!employeeEditOpen) return;
    if (!shouldAutofillShiftTime(employeeEditShiftTime)) return;
    const position = normalizePositionKey(employeeEditPosition);
    const shift = employeeEditShift;
    if (!position || (shift !== 'early' && shift !== 'late')) return;
    setEmployeeEditShiftTime(getDefaultShiftStartTime(shift, position));
  }, [employeeEditOpen, employeeEditPosition, employeeEditShift]);

  // Step 1: Prepare filter needles (only depends on filter strings)
  const employeeFilterNeedles = useMemo(() => {
    return {
      search: deferredEmployeeSearch.trim().toLowerCase(),
      agency: employeeAgency.trim().toLowerCase(),
      position: employeePosition.trim().toLowerCase(),
      shift: employeeShiftFilter,
      labels: employeeLabels.map((item) => item.trim().toLowerCase()).filter(Boolean)
    };
  }, [deferredEmployeeSearch, employeeAgency, employeePosition, employeeShiftFilter, employeeLabels]);

  // Step 2: Filter employees (depends on employee data + filter needles)
  const employeesAfterFilter = useMemo(() => {
    if (page !== 'employees') return [];
    const { search: searchNeedle, agency: agencyNeedle, position: positionNeedle, shift: shiftNeedle, labels: labelNeedles } = employeeFilterNeedles;
    return employees.filter((e) => {
      const staff = normalizeStaffId(String(e.staff_id ?? '').trim());
      const name = String(e.name ?? '').trim();
      const agency = String(e.agency ?? e.Agency ?? '').trim();
      const position = String(e.position ?? e.Position ?? '').trim();
      const employmentType = normalizeEmploymentTypeValue((e as any).employment_type ?? (e as any).EmploymentType ?? '');
      const label = String(e.label ?? e.Label ?? '').trim();
      const workAccount = String(e.work_account ?? e.WorkAccount ?? '').trim();
      const shiftInfo = employeeShiftByStaffId[staff];
      const shift = shiftInfo?.shift || '';
      if (agencyNeedle && !agency.toLowerCase().includes(agencyNeedle)) return false;
      if (positionNeedle && !position.toLowerCase().includes(positionNeedle)) return false;
      if (shiftNeedle && shift !== shiftNeedle) return false;
      if (labelNeedles.length > 0) {
        const normalizedLabel = label.toLowerCase();
        const hit = labelNeedles.some((needle) => normalizedLabel === needle);
        if (!hit) return false;
      }
      if (!searchNeedle) return true;
      return [staff, name, employmentType, label, workAccount].join(' ').toLowerCase().includes(searchNeedle);
    });
  }, [page, employees, employeeFilterNeedles, employeeShiftByStaffId]);

  // Step 3: Apply hire date sorting (optional, depends on filtered rows + sort flag)
  const employeesAfterHireDateSort = useMemo(() => {
    if (!employeeSortByHireDateDesc) return employeesAfterFilter;
    return [...employeesAfterFilter].sort((a, b) => {
      const atA = Date.parse(String(a.created_at ?? ''));
      const atB = Date.parse(String(b.created_at ?? ''));
      const valA = Number.isFinite(atA) ? atA : -1;
      const valB = Number.isFinite(atB) ? atB : -1;
      if (valA !== valB) return valB - valA;
      const staffA = normalizeStaffId(String(a.staff_id ?? '').trim());
      const staffB = normalizeStaffId(String(b.staff_id ?? '').trim());
      return staffA.localeCompare(staffB, 'en-US');
    });
  }, [employeesAfterFilter, employeeSortByHireDateDesc]);

  // Step 4: Apply punch time sorting (optional, depends on hire-date sorted rows + sort flag)
  const employeesFiltered = useMemo(() => {
    if (!employeeSortByLastPunchDesc) return employeesAfterHireDateSort;
    const dayMs = 24 * 60 * 60 * 1000;
    const nowMs = serverTime.getTime();
    const daysAgoForStaff = (staff: string) => {
      const at = String(employeeLastPunchAtByStaffId[staff] ?? '').trim();
      if (!at) return null;
      const dt = new Date(at);
      if (Number.isNaN(dt.getTime())) return null;
      return Math.max(0, Math.floor((nowMs - dt.getTime()) / dayMs));
    };
    return [...employeesAfterHireDateSort].sort((a, b) => {
      const staffA = normalizeStaffId(String(a.staff_id ?? '').trim());
      const staffB = normalizeStaffId(String(b.staff_id ?? '').trim());
      const daysA = daysAgoForStaff(staffA);
      const daysB = daysAgoForStaff(staffB);
      const valA = daysA === null ? -1 : daysA;
      const valB = daysB === null ? -1 : daysB;
      if (valA !== valB) return valB - valA;
      return staffA.localeCompare(staffB, 'en-US');
    });
  }, [employeesAfterHireDateSort, employeeSortByLastPunchDesc, employeeLastPunchAtByStaffId, serverTime]);
  const accountRowsAll = useMemo(() => {
    const tempRows = tempAccounts.map((row) => ({
      staff: normalizeStaffId(String(row.staff_id ?? '').trim()),
      name: String(row.name ?? '').trim(),
      agency: String(row.agency ?? '').trim(),
      position: String(row.position ?? '').trim(),
      workAccount: String(row.work_account ?? '').trim(),
      workPassword: resolveDefaultWorkPassword(
        String(row.work_account ?? '').trim(),
        String(row.work_password ?? '').trim()
      ),
      isTemp: true
    }));
    const tempDedup = new Map<string, { staff: string; name: string; agency: string; position: string; workAccount: string; workPassword: string; isTemp: boolean }>();
    for (const row of tempRows) {
      if (!row.staff || (!row.workAccount && !row.workPassword)) continue;
      const key = `${row.staff}__${row.workAccount}__${row.workPassword}`;
      if (!tempDedup.has(key)) tempDedup.set(key, row);
    }
    return Array.from(tempDedup.values()).sort((a, b) => a.staff.localeCompare(b.staff, 'en-US'));
  }, [tempAccounts]);

  const accountPositionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of accountRowsAll) {
      const positionRaw = String(row.position ?? '').trim();
      const position = normalizePositionKey(positionRaw) ?? positionRaw;
      if (position) set.add(position);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, 'en-US'));
  }, [accountRowsAll]);

  const accountRowsFiltered = useMemo(() => {
    if (page !== 'accounts') return [];
    const searchNeedle = deferredAccountSearch.trim().toLowerCase();
    const normalizedFilterPosition = normalizePositionKey(deferredAccountPositionFilter.trim());
    const positionNeedle = (normalizedFilterPosition ?? deferredAccountPositionFilter.trim()).toLowerCase();
    const rows = positionNeedle
      ? accountRowsAll.filter((row) => {
          const positionRaw = String(row.position ?? '').trim();
          const position = normalizePositionKey(positionRaw) ?? positionRaw;
          return position.toLowerCase() === positionNeedle;
        })
      : accountRowsAll;
    const filtered = searchNeedle
      ? rows.filter((row) => [row.staff, row.name, row.workAccount, row.workPassword].join(' ').toLowerCase().includes(searchNeedle))
      : rows;
    return filtered;
  }, [page, accountRowsAll, deferredAccountSearch, deferredAccountPositionFilter]);
  const accountRowsRendered = useMemo(
    () => accountRowsFiltered.slice(0, Math.max(0, accountRenderCount)),
    [accountRowsFiltered, accountRenderCount]
  );

  const parseSpreadsheetRows = async (file: File) => {
    const name = (file.name ?? '').toLowerCase();
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      return parseCsv(await file.text()).rows;
    }
    const XLSX = await import('xlsx');
    const ab = await file.arrayBuffer();
    const workbook = XLSX.read(ab, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]) || [];
    const headerRow = (rows[0] ?? []).map((h: any) => String(h ?? '').trim());
    return rows
      .slice(1)
      .map((r) => {
        const obj: Record<string, string> = {};
        for (let i = 0; i < headerRow.length; i += 1) {
          const key = headerRow[i] ?? '';
          obj[key] = String(r[i] ?? '').trim();
        }
        return obj;
      })
      .filter((r) => Object.values(r).some((v) => String(v).trim() !== ''));
  };

  const importTempAccounts = async (file: File | null) => {
    if (!accountsCanOperate) {
      setStatus({ tone: 'error', message: t('账号模块当前为只读。', 'Accounts is read-only.') });
      return;
    }
    if (!file) return;
    if (!supabase) {
      setStatus({ tone: 'error', message: '缺少 Supabase 配置。' });
      return;
    }
    const lower = String(file.name ?? '').toLowerCase();
    const fileType = String(file.type ?? '').toLowerCase();
    const isValid =
      lower.endsWith('.csv') ||
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      fileType === 'text/csv' ||
      fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      fileType === 'application/vnd.ms-excel';
    if (!isValid) {
      setStatus({ tone: 'error', message: t('不支持的文件类型，请上传 CSV 或 Excel。', 'Unsupported file type. Please upload CSV or Excel.') });
      return;
    }

    await runLocked('accounts_import', async () => {
      let parsedRows: Record<string, string>[] = [];
      try {
        parsedRows = await parseSpreadsheetRows(file);
      } catch (err: any) {
        setStatus({ tone: 'error', message: t(`解析文件失败：${String(err?.message ?? err)}`, `Failed to parse file: ${String(err?.message ?? err)}`) });
        return;
      }

      const toStaffToken = (value: string) =>
        String(value ?? '')
          .trim()
          .toUpperCase();

      const buildTempStaffId = (canonical: Record<string, string>, rowIndex: number) => {
        const explicitStaff = normalizeStaffId(String(canonical.staff_id ?? canonical.employee_id ?? '').trim());
        if (explicitStaff) return explicitStaff;
        const accountToken = toStaffToken(String(canonical.work_account ?? ''));
        if (accountToken) return `TMPACC-${accountToken}`;
        const nameToken = toStaffToken(String(canonical.name ?? '')).slice(0, 10);
        const posToken = toStaffToken(String(canonical.position ?? '')).slice(0, 8);
        const fallback = `${nameToken || 'NONAME'}${posToken ? `-${posToken}` : ''}-${String(rowIndex + 1).padStart(4, '0')}`;
        return `TMPACC-${fallback}`;
      };

      const uniqueByStaff = new Map<
        string,
        {
          staff_id: string;
          name?: string | null;
          agency?: string | null;
          position?: string | null;
          work_account?: string | null;
          work_password?: string | null;
          note?: string | null;
          updated_at?: string;
        }
      >();

      for (let rowIndex = 0; rowIndex < parsedRows.length; rowIndex += 1) {
        const row = parsedRows[rowIndex] ?? {};
        const canonical: Record<string, string> = {};
        for (const [rawKey, rawValue] of Object.entries(row)) {
          if (!rawKey) continue;
          const value = String(rawValue ?? '').trim();
          if (!value) continue;
          const normalized = normalizeHeaderKey(rawKey);
          const mapped = TEMP_ACCOUNT_KEY_ALIASES[normalized] ?? normalized;
          if (!canonical[mapped]) canonical[mapped] = value;
        }
        const staff = buildTempStaffId(canonical, rowIndex);
        if (!staff) continue;
        uniqueByStaff.set(staff, {
          staff_id: staff,
          name: canonical.name?.trim() || null,
          agency: canonical.agency?.trim() || null,
          position: canonical.position?.trim() || null,
          work_account: canonical.work_account?.trim() || null,
          work_password: canonical.work_password?.trim() || null,
          note: canonical.note?.trim() || null,
          updated_at: new Date(serverTime).toISOString()
        });
      }

      const rows = Array.from(uniqueByStaff.values());
      if (rows.length === 0) {
        setStatus({ tone: 'error', message: t('导入文件没有可用行。', 'No valid rows in file.') });
        return;
      }

      const upsertRes = await supabase.from(TEMP_ACCOUNT_TABLE).upsert(rows as any[], { onConflict: 'staff_id' });
      if (upsertRes.error) {
        setStatus({ tone: 'error', message: t(`导入账号失败：${upsertRes.error.message}`, `Import accounts failed: ${upsertRes.error.message}`) });
        return;
      }

      await writeAudit({
        action: 'temp_account_import',
        target: TEMP_ACCOUNT_TABLE,
        payload: {
          file_name: file.name ?? null,
          total_rows: rows.length
        }
      });
      setStatus({ tone: 'success', message: t(`账号导入成功：${rows.length} 条。`, `Accounts imported: ${rows.length}.`) });
      await fetchTempAccounts({ lockUi: false });
    });
  };

  const exportTempAccounts = async () => {
    await runLocked('accounts_export', async () => {
      const searchNeedle = deferredAccountSearch.trim().toLowerCase();
      const rows = tempAccounts
        .map((row) => ({
          staff_id: normalizeStaffId(String(row.staff_id ?? '').trim()),
          name: String(row.name ?? '').trim(),
          agency: String(row.agency ?? '').trim(),
          position: String(row.position ?? '').trim(),
          work_account: String(row.work_account ?? '').trim(),
          work_password: String(row.work_password ?? '').trim(),
          note: String(row.note ?? '').trim()
        }))
        .filter((row) => Boolean(row.staff_id && (row.work_account || row.work_password)))
        .filter((row) =>
          !searchNeedle
            ? true
            : [row.staff_id, row.name, row.agency, row.position, row.work_account, row.work_password, row.note]
                .join(' ')
                .toLowerCase()
                .includes(searchNeedle)
        );

      if (rows.length === 0) {
        setStatus({ tone: 'error', message: t('暂无可导出的账号数据。', 'No account data to export.') });
        return;
      }

      const headers = ['staff_id', 'name', 'agency', 'position', 'work_account', 'work_password', 'note'];
      const body = rows.map((row) => [
        row.staff_id,
        row.name || '-',
        row.agency || '-',
        row.position || '-',
        row.work_account || '-',
        row.work_password || '-',
        row.note || '-'
      ]);
      const filename = `ob_temp_accounts_${toDateOnly(serverTime)}.xlsx`;
      try {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'temp_accounts');
        XLSX.writeFile(wb, filename);
        setStatus({ tone: 'success', message: `已导出：${filename}` });
      } catch {
        const csvName = filename.replace(/\.xlsx$/i, '.csv');
        const csv = [headers, ...body]
          .map((row) =>
            row
              .map((cell) => {
                const v = String(cell ?? '');
                if (v.includes('"') || v.includes(',') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
                return v;
              })
              .join(',')
          )
          .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = csvName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus({ tone: 'success', message: `已导出：${csvName}` });
      }
      await writeAudit({
        action: 'temp_account_export',
        target: TEMP_ACCOUNT_TABLE,
        payload: { exported_rows: rows.length, search: deferredAccountSearch.trim() || null }
      });
    });
  };

  const editTempAccount = async (
    row: { staff: string; name: string; position: string; workAccount: string; workPassword: string },
    payload: { name: string; position: string; workAccount: string; workPassword: string }
  ) => {
    if (!accountsCanOperate) {
      setStatus({ tone: 'error', message: t('账号模块当前为只读。', 'Accounts is read-only.') });
      return;
    }
    if (!supabase) {
      setStatus({ tone: 'error', message: t('缺少 Supabase 配置。', 'Missing Supabase configuration.') });
      return;
    }
    const staff = normalizeStaffId(String(row.staff ?? '').trim());
    if (!staff) {
      setStatus({ tone: 'error', message: t('账号缺少 staff_id。', 'Account is missing staff_id.') });
      return;
    }
    await runLocked('accounts_edit', async () => {
      const nextName = payload.name.trim() || null;
      const nextPosition = payload.position.trim() || null;
      const nextWorkAccount = payload.workAccount.trim() || null;
      const nextWorkPassword = payload.workPassword.trim() || null;
      const updateRes = await supabase
        .from(TEMP_ACCOUNT_TABLE)
        .update({
          name: nextName,
          position: nextPosition,
          work_account: nextWorkAccount,
          work_password: nextWorkPassword,
          updated_at: new Date(serverTime).toISOString()
        })
        .eq('staff_id', staff);
      if (updateRes.error) {
        setStatus({ tone: 'error', message: t(`保存账号失败：${updateRes.error.message}`, `Failed to save account: ${updateRes.error.message}`) });
        return;
      }
      await writeAudit({
        action: 'temp_account_edit',
        staffId: staff,
        target: TEMP_ACCOUNT_TABLE,
        payload: {
          before: {
            name: row.name ?? null,
            position: row.position ?? null,
            work_account: row.workAccount ?? null,
            work_password: row.workPassword ?? null
          },
          after: {
            name: nextName,
            position: nextPosition,
            work_account: nextWorkAccount,
            work_password: nextWorkPassword
          }
        }
      });
      setStatus({ tone: 'success', message: t('账号已更新。', 'Account updated.') });
      await fetchTempAccounts({ lockUi: false });
    });
  };

  const exportEmployees = async () => {
    await runLocked('employees_export', async () => {
      const rows = employeesFiltered;
      if (rows.length === 0) {
        setStatus({ tone: 'error', message: t('暂无可导出的员工数据。', 'No employee data to export.') });
        return;
      }

      const headers = [
        'EMPLOYEE ID',
        'NAME',
        'AGENCY',
        'POSITION',
        'FT/PT',
        t('班次时间', 'Shift time'),
        t('标签', 'Label'),
        t('工作账号', 'Work account'),
        t('工作密码', 'Work password'),
        t('班次', 'Shift')
      ];

      const body = rows.map((e) => {
        const staff = String(e.staff_id ?? '').trim();
        const name = String(e.name ?? '').trim();
        const agency = String(e.agency ?? e.Agency ?? '').trim();
        const position = String(e.position ?? e.Position ?? '').trim();
        const employmentType = normalizeEmploymentTypeValue((e as any).employment_type ?? (e as any).EmploymentType ?? '');
        const label = String(e.label ?? e.Label ?? '').trim();
        const workAccount = String(e.work_account ?? e.WorkAccount ?? '').trim();
        const workPassword = resolveDefaultWorkPassword(
          workAccount,
          String(e.work_password ?? e.WorkPassword ?? '').trim()
        );
        const shiftInfo = employeeShiftByStaffId[staff];
        const shift = shiftInfo?.shift || '';
        const shiftTime = normalizeShiftTimeValue((e as any).shift_time ?? (e as any).ShiftTime ?? '');
        const shiftLabel = shift === 'early' ? t('白班', 'Day') : shift === 'late' ? t('晚班', 'Night') : '-';
        return [
          displayStaffId(staff),
          name || '-',
          agency || '-',
          position || '-',
          employmentType,
          shiftTime || '-',
          label || '-',
          workAccount || '-',
          workPassword || '-',
          shiftLabel
        ];
      });

      const filename = `ob_employees_${toDateOnly(serverTime)}.xlsx`;
      try {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'employees');
        XLSX.writeFile(wb, filename);
        setStatus({ tone: 'success', message: t(`已导出：${filename}`, `Exported: ${filename}`) });
      } catch {
        const csvName = filename.replace(/\.xlsx$/i, '.csv');
        const csv = [headers, ...body]
          .map((row) =>
            row
              .map((cell) => {
                const v = String(cell ?? '');
                if (v.includes('"') || v.includes(',') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
                return v;
              })
              .join(',')
          )
          .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = csvName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus({ tone: 'success', message: t(`已导出：${csvName}`, `Exported: ${csvName}`) });
      }
    });
  };

  const timecardAgencyOptions = useMemo(() => {
    const out = new Set<string>();
    for (const r of timecardRows) {
      const v = String(r.agency ?? '').trim();
      if (v) out.add(v);
    }
    if (timecardAgency.trim()) out.add(timecardAgency.trim());
    return Array.from(out).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [timecardRows, timecardAgency]);

  const timecardPositionOptions = ALLOWED_POSITIONS;

  const timecardRowsFiltered = useMemo(() => {
    if (page !== 'timecard') return [];
    const filtered = timecardRows.filter((r) => {
      const weeklyPunchCount = Array.isArray(r.punchCountByDay)
        ? r.punchCountByDay.reduce((sum, value) => sum + Number(value ?? 0), 0)
        : 0;
      const weeklyHours = Array.isArray(r.hoursByDay)
        ? r.hoursByDay.reduce((sum, value) => sum + Number(value ?? 0), 0)
        : 0;
      const hasWeeklyPunchActivity = weeklyPunchCount > 0 || weeklyHours > 0 || Boolean(r.inProgressWeek);
      if (!hasWeeklyPunchActivity) return false;
      if (timecardShift && r.shift !== timecardShift) return false;
      if (timecardInProgressOnly && !r.inProgressWeek) return false;
      if (timecardPresentDayFilter !== null && timecardPresentDayFilter >= 0 && timecardPresentDayFilter <= 6) {
        if (Number(r.punchCountByDay?.[timecardPresentDayFilter] ?? 0) <= 0) return false;
      }
      return true;
    });
    const getAnomalyScore = (row: TimecardRow) => {
      let score = 0;
      for (let idx = 0; idx < 7; idx += 1) {
        if (row.punchCountMismatchByDay[idx]) score += 100; // most severe
        const hours = Number(row.hoursByDay[idx] ?? 0);
        if (hours > 8.5) {
          score += 10;
          const extraHalfHours = Math.floor((hours - 8.5) / 0.5);
          if (extraHalfHours > 0) score += extraHalfHours * 5;
        }
        if (row.absentByDay[idx]) score += 1;
      }
      return score;
    };
    return [...filtered].sort((a, b) => {
      if (timecardAgencySort) {
        const agencyA = String(a.agency ?? '').trim();
        const agencyB = String(b.agency ?? '').trim();
        const agencyDiff = agencyA.localeCompare(agencyB, 'zh-CN', { sensitivity: 'base' });
        if (agencyDiff !== 0) return timecardAgencySort === 'asc' ? agencyDiff : -agencyDiff;
      }
      if (timecardTotalSort && b.totalHours !== a.totalHours) {
        return timecardTotalSort === 'asc' ? a.totalHours - b.totalHours : b.totalHours - a.totalHours;
      }
      const anomalyDiff = getAnomalyScore(b) - getAnomalyScore(a);
      if (anomalyDiff !== 0) return anomalyDiff;
      if (b.totalHours !== a.totalHours) return b.totalHours - a.totalHours;
      return String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''), 'en-US');
    });
  }, [page, timecardRows, timecardShift, timecardInProgressOnly, timecardPresentDayFilter, timecardAgencySort, timecardTotalSort]);
  const timecardRowsRendered = useMemo(
    () => timecardRowsFiltered.slice(0, Math.max(0, timecardRenderCount)),
    [timecardRowsFiltered, timecardRenderCount]
  );
  const timecardDayTotalHours = useMemo(() => {
    if (page !== 'timecard') return new Array(7).fill(0) as number[];
    const totals = new Array(7).fill(0) as number[];
    for (const row of timecardRowsFiltered) {
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        totals[dayIndex] += Number(row.hoursByDay?.[dayIndex] ?? 0);
      }
    }
    return totals;
  }, [page, timecardRowsFiltered]);
  const timecardDayAttendanceCount = useMemo(() => {
    if (page !== 'timecard') return new Array(7).fill(0) as number[];
    const totals = new Array(7).fill(0) as number[];
    for (const row of timecardRowsFiltered) {
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        if (Number(row.punchCountByDay?.[dayIndex] ?? 0) > 0) {
          totals[dayIndex] += 1;
        }
      }
    }
    return totals;
  }, [page, timecardRowsFiltered]);

  const timecardPunchRowsVisible = useMemo(() => {
    const rowsAll = [...timecardPunchRows, ...timecardPunchPendingAddRows];
    const rowsBase = rowsAll.filter((r) => !timecardPunchPendingDeleteIds.includes(String(r.id)));
    if (timecardPunchShowAll) return rowsBase;
    if (timecardPunchDayIndex === null) return rowsBase; // week view

    const idx = timecardPunchDayIndex;
    if (idx < 0 || idx > 6) return rowsBase;

    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);

    const { start: dayStart, end: dayEnd } = getDayRange(weekStart, idx);
    const includedIds = new Set<string>();

    const events = rowsBase
      .map((r) => {
        const at = r.created_at ? new Date(r.created_at) : null;
        if (!at || Number.isNaN(at.getTime())) return null;
        return { id: String(r.id), action: r.action, at };
      })
      .filter(Boolean) as Array<{ id: string; action: 'IN' | 'OUT'; at: Date }>;

    events.sort((a, b) => {
      const diff = a.at.getTime() - b.at.getTime();
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id, 'en-US');
    });

    const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
      Math.min(aEnd.getTime(), bEnd.getTime()) > Math.max(aStart.getTime(), bStart.getTime());

    let currentIn: { id: string; at: Date } | null = null;
    for (const ev of events) {
      if (ev.action === 'IN') {
        currentIn = { id: ev.id, at: ev.at };
        continue;
      }
      if (ev.action === 'OUT') {
        if (currentIn && ev.at.getTime() > currentIn.at.getTime()) {
          if (overlaps(dayStart, dayEnd, currentIn.at, ev.at)) {
            includedIds.add(currentIn.id);
            includedIds.add(ev.id);
          }
          currentIn = null;
        }
      }
    }

    for (const ev of events) {
      const bucketTimeMs = getOperationalBucketTimeMs(ev.at, ev.action);
      if (bucketTimeMs >= dayStart.getTime() && bucketTimeMs < dayEnd.getTime()) {
        includedIds.add(ev.id);
      }
    }

    if (currentIn) {
      const now = new Date(serverTime);
      const capEnd = new Date(clamp(now.getTime(), dayStart.getTime(), dayEnd.getTime()));
      if (overlaps(dayStart, dayEnd, currentIn.at, capEnd)) {
        includedIds.add(currentIn.id);
      }
    }

    return rowsBase.filter((r) => includedIds.has(String(r.id)));
  }, [
    timecardPunchRows,
    timecardPunchPendingAddRows,
    timecardPunchPendingDeleteIds,
    timecardPunchShowAll,
    timecardPunchDayIndex,
    timecardWeekOffset,
    serverTime
  ]);
  const timecardPunchCardsSorted = useMemo(() => {
    const rows = [...timecardPunchRowsVisible];
    rows.sort((a, b) => {
      const idA = String(a.id);
      const idB = String(b.id);
      const editA = timecardPunchEdits[idA];
      const editB = timecardPunchEdits[idB];
      const atA = editA?.atLocal ? parseLocalDateTimeInputValue(editA.atLocal) : a.created_at ?? '';
      const atB = editB?.atLocal ? parseLocalDateTimeInputValue(editB.atLocal) : b.created_at ?? '';
      const msA = atA ? new Date(atA).getTime() : 0;
      const msB = atB ? new Date(atB).getTime() : 0;
      if (msA !== msB) return msA - msB;
      return idA.localeCompare(idB, 'en-US');
    });
    return rows;
  }, [timecardPunchRowsVisible, timecardPunchEdits]);
  useEffect(() => {
    setTimecardPunchOrderIds((prev) => {
      const visibleIdSet = new Set(timecardPunchCardsSorted.map((r) => String(r.id)));
      const kept = prev.filter((id) => visibleIdSet.has(id));
      const keptSet = new Set(kept);
      const append = timecardPunchCardsSorted
        .map((r) => String(r.id))
        .filter((id) => !keptSet.has(id));
      return [...kept, ...append];
    });
  }, [timecardPunchCardsSorted]);
  const timecardPunchCardsVisible = useMemo(() => {
    if (timecardPunchOrderIds.length === 0) return timecardPunchCardsSorted;
    const byId = new Map(timecardPunchCardsSorted.map((r) => [String(r.id), r]));
    const ordered: PunchRow[] = [];
    for (const id of timecardPunchOrderIds) {
      const row = byId.get(id);
      if (row) ordered.push(row);
    }
    if (ordered.length >= byId.size) return ordered;
    for (const row of timecardPunchCardsSorted) {
      if (!timecardPunchOrderIds.includes(String(row.id))) ordered.push(row);
    }
    return ordered;
  }, [timecardPunchCardsSorted, timecardPunchOrderIds]);
  const timecardPunchCardsRendered = useMemo(() => {
    if (!timecardPunchDraggingId || !timecardPunchDragOverId || timecardPunchDraggingId === timecardPunchDragOverId) {
      return timecardPunchCardsVisible;
    }
    const rows = [...timecardPunchCardsVisible];
    const fromIdx = rows.findIndex((r) => String(r.id) === String(timecardPunchDraggingId));
    const toIdx = rows.findIndex((r) => String(r.id) === String(timecardPunchDragOverId));
    if (fromIdx < 0 || toIdx < 0) return timecardPunchCardsVisible;
    const tmp = rows[fromIdx];
    rows[fromIdx] = rows[toIdx]!;
    rows[toIdx] = tmp!;
    return rows;
  }, [timecardPunchCardsVisible, timecardPunchDraggingId, timecardPunchDragOverId]);
  const timecardPunchReadOnly = timecardPunchDayIndex === null || !timecardCanOperate;
  const timecardPunchHeaderMeta = useMemo(() => {
    const staff = normalizeStaffId(String(timecardPunchStaffId ?? '').trim());
    if (!staff) {
      return { name: '-', position: '-', label: '-', finalHoursText: '0' };
    }
    const row = timecardRows.find((r) => normalizeStaffId(String(r.staff_id ?? '').trim()) === staff);
    const employee = employees.find((e) => normalizeStaffId(String(e.staff_id ?? '').trim()) === staff);
    const name = String(row?.name ?? employee?.name ?? '').trim() || '-';
    const position = String(row?.position ?? employee?.position ?? employee?.Position ?? '').trim() || '-';
    const label = String(employee?.label ?? employee?.Label ?? '').trim() || '-';

    if (timecardPunchDayIndex === null || timecardPunchDayIndex < 0 || timecardPunchDayIndex > 6) {
      return {
        name,
        position,
        label,
        finalHoursText: formatHours(Number(row?.totalHours ?? 0)) || '0'
      };
    }

    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
    const { start: dayStart, end: dayEnd } = getDayRange(weekStart, timecardPunchDayIndex);
    const deletedIdSet = new Set(timecardPunchPendingDeleteIds.map((id) => String(id)));
    const rowsAll = [...timecardPunchRows, ...timecardPunchPendingAddRows].filter((r) => !deletedIdSet.has(String(r.id)));
    const events: Array<{ action: 'IN' | 'OUT'; at: Date }> = [];
    for (const rowItem of rowsAll) {
      const rowId = String(rowItem.id);
      const edit = timecardPunchEdits[rowId];
      const action = edit?.action ?? rowItem.action;
      const atRaw = edit?.atLocal ? parseLocalDateTimeInputValue(edit.atLocal) : rowItem.created_at;
      const at = atRaw ? new Date(atRaw) : null;
      if (!at || Number.isNaN(at.getTime())) continue;
      events.push({ action, at });
    }
    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    let openIn: Date | null = null;
    let totalMs = 0;
    for (const ev of events) {
      if (ev.action === 'IN') {
        openIn = ev.at;
        continue;
      }
      if (!openIn || ev.at.getTime() <= openIn.getTime()) continue;
      const overlapStart = Math.max(openIn.getTime(), dayStart.getTime());
      const overlapEnd = Math.min(ev.at.getTime(), dayEnd.getTime());
      if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
      openIn = null;
    }

    return {
      name,
      position,
      label,
      finalHoursText: formatHours(totalMs / 3600000) || '0'
    };
  }, [
    timecardPunchStaffId,
    timecardPunchDayIndex,
    timecardRows,
    employees,
    timecardPunchRows,
    timecardPunchPendingAddRows,
    timecardPunchPendingDeleteIds,
    timecardPunchEdits,
    serverTime,
    timecardWeekOffset
  ]);

  const scheduleWeekStart = useMemo(() => {
    const baseWeekStart = startOfWeekMonday(serverTime);
    return addDays(baseWeekStart, scheduleWeekOffset * 7);
  }, [serverTime, scheduleWeekOffset]);

  const scheduleDays = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => addDays(scheduleWeekStart, idx)),
    [scheduleWeekStart]
  );
  const timecardWeekStart = useMemo(() => {
    const baseWeekStart = startOfWeekMonday(serverTime);
    return addDays(baseWeekStart, timecardWeekOffset * 7);
  }, [serverTime, timecardWeekOffset]);

  const toOperationalDateFromAudit = (atRaw: string, actionRaw?: string) => {
    return toOperationalWorkDate(atRaw, actionRaw);
  };

  const scheduleAuditByStaffDate = useMemo(() => {
    const map = new Map<string, AuditRow[]>();
    const scheduleActions = new Set([
      'schedule_work',
      'schedule_fixed_work',
      'schedule_temp_work',
      'schedule_planned_temp_work',
      'schedule_leave',
      'schedule_planned_leave',
      'schedule_temp_rest',
      'schedule_planned_temp_rest',
      'schedule_rest',
      'schedule_clear',
      'agency_schedule_state_set',
      'agency_substitute_assign'
    ]);
    for (const row of cellAuditRows) {
      const action = String(row.action ?? '').trim();
      if (!scheduleActions.has(action)) continue;
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) continue;
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const date = String(payload.template_date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const key = `${staff}__${date}`;
      const list = map.get(key) ?? [];
      if (list.length < 5) list.push(row);
      map.set(key, list);
    }
    return map;
  }, [cellAuditRows]);

  const timecardAuditByStaffDate = useMemo(() => {
    const map = new Map<string, AuditRow[]>();
    const getSortTs = (value: string | null | undefined) => {
      const n = Date.parse(String(value ?? ''));
      return Number.isFinite(n) ? n : 0;
    };
    const getSortId = (value: unknown) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    };
    for (const row of cellAuditRows) {
      const action = String(row.action ?? '').trim();
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) continue;
      const payload = (row.payload ?? {}) as Record<string, any>;
      const dateKeys = new Set<string>();
      const workDate = String(payload.work_date ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
        dateKeys.add(workDate);
      }
      if (action === 'punch_manual_add' || action === 'punch_manual_edit' || action === 'punch_manual_delete') {
        for (const key of extractPunchAuditWorkDates(row)) {
          if (key) dateKeys.add(key);
        }
      } else if (action === 'punch_count_verified') {
        // use payload.work_date when available
      } else {
        continue;
      }
      if (dateKeys.size === 0) {
        const fallback = toOperationalDateFromAudit(String(row.created_at ?? ''));
        if (fallback) dateKeys.add(fallback);
      }
      for (const dateKey of dateKeys) {
        const key = `${staff}__${dateKey}`;
        const list = map.get(key) ?? [];
        list.push(row);
        map.set(key, list);
      }
    }
    for (const [key, list] of map.entries()) {
      const sorted = [...list].sort((a, b) => {
        const tsDelta = getSortTs(b.created_at) - getSortTs(a.created_at);
        if (tsDelta !== 0) return tsDelta;
        return getSortId(b.id) - getSortId(a.id);
      });
      map.set(key, sorted.slice(0, 5));
    }
    return map;
  }, [cellAuditRows]);

  const scheduleRowsByStaffDayIndex = useMemo(() => {
    const map = new Map<string, ScheduleRow>();
    for (const row of scheduleRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const dayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim(), scheduleRowsWeekOffset);
      if (!staff || dayIndex === null) continue;
      const key = `${staff}__${dayIndex}`;
      const existing = map.get(key);
      if (!existing || isScheduleRowNewer(row, existing)) {
        map.set(key, row);
      }
    }
    return map;
  }, [scheduleRows, scheduleRowsWeekOffset]);
  const flexCoverageByScheduleDayIndex = useMemo(() => {
    const entries: Array<{ dayIndex: number; targetPosition: 'Pick' | 'Pack' | 'Rebin'; shift: 'early' | 'late' }> = [];
    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      const position = normalizePositionKey(String(employee.position ?? employee.Position ?? '').trim());
      if (position !== 'FLEX TEAM') continue;
      const targetPosition = normalizeFlexCoverageTargetPosition(String(employee.label ?? employee.Label ?? '').trim());
      if (!targetPosition) continue;
      const assignedShift = normalizeShiftValue(String((employee as any).shift ?? (employee as any).Shift ?? '').trim());
      const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
      for (let dayIndex = 0; dayIndex < scheduleDays.length; dayIndex += 1) {
        const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
        if (!row || !isWorkingScheduleRow(row)) continue;
        const rowShift = normalizeShiftValue(String(row.shift ?? '').trim());
        const shift = rowShift || assignedShift || inferredShift;
        if (shift !== 'early' && shift !== 'late') continue;
        entries.push({ dayIndex, targetPosition, shift });
      }
    }
    return buildFlexCoverageByDayIndex(entries);
  }, [employees, employeeShiftByStaffId, scheduleDays, scheduleRowsByStaffDayIndex]);
  const scheduleRecommendedAdjustedByDate = useMemo(() => {
    const next: ScheduleRecommendedByDate = {};
    for (const [date, rows] of Object.entries(scheduleRecommendedByDate)) {
      const dayIndex = scheduleDays.findIndex((day) => toDateOnly(day) === date);
      next[date] = applyFlexCoverageToRecommendedRows(rows, dayIndex >= 0 ? flexCoverageByScheduleDayIndex[dayIndex] : null);
    }
    return next;
  }, [scheduleRecommendedByDate, scheduleDays, flexCoverageByScheduleDayIndex]);
  const scheduleRecommendedTotalsByDate = useMemo(() => {
    const next: Record<string, number | null> = {};
    for (const [date, rows] of Object.entries(scheduleRecommendedAdjustedByDate)) {
      let filteredRows = rows;
      if (deferredSchedulePosition === 'Pick') filteredRows = rows.filter((item) => item.key === 'Pick');
      else if (deferredSchedulePosition === 'Rebin') filteredRows = rows.filter((item) => item.key === 'Rebin');
      else if (deferredSchedulePosition === 'Pack') filteredRows = rows.filter((item) => item.key === 'Pack');
      else if (deferredSchedulePosition === 'Preship') filteredRows = rows.filter((item) => item.key === 'Preship');
      else if (deferredSchedulePosition === 'Water Spider') filteredRows = rows.filter((item) => item.key === 'Water Spider');
      else if (deferredSchedulePosition === 'Transfer') {
        next[date] = null;
        continue;
      }

      if (filteredRows.length === 0) {
        next[date] = null;
        continue;
      }

      next[date] = filteredRows.reduce((sum, item) => {
        if (deferredScheduleShift === 'early') return sum + item.ds;
        if (deferredScheduleShift === 'late') return sum + item.ns;
        return sum + item.total;
      }, 0);
    }
    return next;
  }, [scheduleRecommendedAdjustedByDate, deferredSchedulePosition, deferredScheduleShift]);
  const employeeProfileByStaffId = useMemo(() => {
    const map = new Map<string, { name: string; agency: string; position: string; shiftTime: string }>();
    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      map.set(staff, {
        name: String(employee.name ?? '').trim(),
        agency: String(employee.agency ?? employee.Agency ?? '').trim(),
        position: String(employee.position ?? employee.Position ?? '').trim(),
        shiftTime: normalizeShiftTimeValue((employee as any).shift_time ?? (employee as any).ShiftTime ?? '')
      });
    }
    return map;
  }, [employees]);
  const scheduleOnlyStaffIds = useMemo(() => {
    const next = new Set<string>();
    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      const agency = String(employee.agency ?? employee.Agency ?? '').trim();
      if (!staff || !isScheduleOnlyAgency(agency)) continue;
      next.add(staff);
    }
    return next;
  }, [employees]);
  const tomorrowDailyList = useMemo(() => {
    const parsedTarget =
      /^\d{4}-\d{2}-\d{2}$/.test(dailyListDateInput)
        ? new Date(`${dailyListDateInput}T00:00:00`)
        : addDays(new Date(serverTime), 1);
    const targetDay = Number.isNaN(parsedTarget.getTime()) ? addDays(new Date(serverTime), 1) : parsedTarget;
    const dayIndex = (targetDay.getDay() + 6) % 7; // Mon=0..Sun=6
    const earlyRows: DailyListRow[] = [];
    const lateRows: DailyListRow[] = [];
    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
      if (!row || !isWorkingScheduleRow(row)) continue;
      const profile = employeeProfileByStaffId.get(staff);
      if (!profile) continue;
      if (isScheduleOnlyAgency(profile.agency)) continue;
      const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
      const assignedShift = normalizeShiftValue(String((employee as any).shift ?? (employee as any).Shift ?? '').trim());
      // New-hire demand rows may not have punch logs yet, so prefer employee.shift first.
      const shift = assignedShift || inferredShift;
      if (shift !== 'early' && shift !== 'late') continue;
      const item: DailyListRow = {
        staff_id: staff,
        name: profile?.name || '',
        agency: profile?.agency || '',
        position: profile?.position || String(row.position ?? '').trim() || '',
        shift,
        start_time: resolveShiftStartTime(shift, profile?.position || String(row.position ?? '').trim() || '', profile?.shiftTime || '')
      };
      if (shift === 'late') lateRows.push(item);
      else earlyRows.push(item);
    }
    const positionRank = new Map(ALLOWED_POSITIONS.map((pos, idx) => [pos, idx] as const));
    const dailyListSort = (a: DailyListRow, b: DailyListRow) => {
      const aIsNew = isNewHirePlaceholderStaffId(String(a.staff_id ?? '').trim()) || isNewHirePlaceholderName(String(a.name ?? '').trim());
      const bIsNew = isNewHirePlaceholderStaffId(String(b.staff_id ?? '').trim()) || isNewHirePlaceholderName(String(b.name ?? '').trim());
      if (aIsNew !== bIsNew) return aIsNew ? -1 : 1;

      const posA = normalizePositionKey(String(a.position ?? '').trim());
      const posB = normalizePositionKey(String(b.position ?? '').trim());
      const rankA = posA ? (positionRank.get(posA) ?? 999) : 999;
      const rankB = posB ? (positionRank.get(posB) ?? 999) : 999;
      if (rankA !== rankB) return rankA - rankB;

      const agencyA = String(a.agency ?? '').trim().toLowerCase();
      const agencyB = String(b.agency ?? '').trim().toLowerCase();
      if (agencyA !== agencyB) return agencyA.localeCompare(agencyB, 'en-US');

      return String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''), 'en-US');
    };
    earlyRows.sort(dailyListSort);
    lateRows.sort(dailyListSort);

    return {
      targetDate: toDateOnly(targetDay),
      weekday: targetDay.toLocaleDateString('en-US', { weekday: 'short' }),
      earlyRows,
      lateRows
    };
  }, [serverTime, dailyListDateInput, employees, scheduleRowsByStaffDayIndex, employeeProfileByStaffId, employeeShiftByStaffId]);
  const dailyListCapacityByRowKey = useMemo(() => {
    const map = new Map<string, DailyListCapacityView>();
    const addRow = (row: DailyListRow) => {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) return;
      map.set(`${row.shift}__${staff}`, resolveDailyListCapacityForRow(row, dailyCapacityStaffStatsByStaffId, dailyCapacityTemplatePayload));
    };
    for (const row of tomorrowDailyList.earlyRows) addRow(row);
    for (const row of tomorrowDailyList.lateRows) addRow(row);
    return map;
  }, [tomorrowDailyList, dailyCapacityStaffStatsByStaffId, dailyCapacityTemplatePayload]);
  const sumDailyListCapacityRows = (rows: DailyListRow[]) => {
    let total = 0;
    let hasValue = false;
    for (const row of rows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) continue;
      const view = dailyListCapacityByRowKey.get(`${row.shift}__${staff}`);
      if (!view || view.capacity === null || view.capacity === undefined) continue;
      total += view.capacity;
      hasValue = true;
    }
    return hasValue ? total : null;
  };
  const tomorrowAttendanceCards = useMemo(() => {
    const countByKey: Record<string, number> = {};
    const addRows = (rows: DailyListRow[], shift: 'early' | 'late') => {
      for (const row of rows) {
        const normalizedPosition = normalizeDailyListPositionKey(String(row.position ?? '').trim());
        if (!normalizedPosition) continue;
        const key = `${shift}:${normalizedPosition}`;
        countByKey[key] = (countByKey[key] ?? 0) + 1;
      }
    };
    addRows(tomorrowDailyList.earlyRows, 'early');
    addRows(tomorrowDailyList.lateRows, 'late');
    return (['early', 'late'] as const).flatMap((shift) =>
      DAILY_LIST_LIGHT_POSITIONS.map((position) => ({
        key: `${shift}:${position}`,
        shift,
        position,
        count: countByKey[`${shift}:${position}`] ?? 0
      }))
    );
  }, [tomorrowDailyList]);
  const tomorrowPositionSummaryCards = useMemo(
    () =>
      DAILY_LIST_VISIBLE_POSITIONS.map((position) => {
        const early = tomorrowAttendanceCards.find((c) => c.shift === 'early' && c.position === position)?.count ?? 0;
        const late = tomorrowAttendanceCards.find((c) => c.shift === 'late' && c.position === position)?.count ?? 0;
        const recommendedRows = scheduleRecommendedAdjustedByDate[tomorrowDailyList.targetDate] ?? [];
        const recommended = recommendedRows.filter((item) => normalizeDailyListPositionKey(item.key) === position);
        const earlyRecommended = recommended.length > 0 ? recommended.reduce((sum, item) => sum + item.ds, 0) : null;
        const lateRecommended = recommended.length > 0 ? recommended.reduce((sum, item) => sum + item.ns, 0) : null;
        const earlyCapacity = sumDailyListCapacityRows(
          tomorrowDailyList.earlyRows.filter((row) => normalizeDailyListPositionKey(String(row.position ?? '').trim()) === position)
        );
        const lateCapacity = sumDailyListCapacityRows(
          tomorrowDailyList.lateRows.filter((row) => normalizeDailyListPositionKey(String(row.position ?? '').trim()) === position)
        );
        const totalCapacity =
          earlyCapacity === null && lateCapacity === null
            ? null
            : Number(earlyCapacity ?? 0) + Number(lateCapacity ?? 0);
        const totalRecommended =
          earlyRecommended === null && lateRecommended === null
            ? null
            : Number(earlyRecommended ?? 0) + Number(lateRecommended ?? 0);
        return {
          position,
          early,
          late,
          earlyRecommended,
          lateRecommended,
          earlyCapacity,
          lateCapacity,
          totalCapacity,
          totalRecommended,
          total: early + late
        };
    }),
    [tomorrowAttendanceCards, scheduleRecommendedAdjustedByDate, tomorrowDailyList, dailyListCapacityByRowKey]
  );
  const selectedDailyFilterPositions = useMemo(
    () => DAILY_LIST_VISIBLE_POSITIONS.filter((position) => Boolean(dailyListFilterPositions[position])),
    [dailyListFilterPositions]
  );
  const tomorrowDailyRowsDisplayed = useMemo(() => {
    if (selectedDailyFilterPositions.length === 0) {
      return { earlyRows: tomorrowDailyList.earlyRows, lateRows: tomorrowDailyList.lateRows };
    }
    const allowed = new Set<DailyListLightPosition>(selectedDailyFilterPositions);
    const match = (row: DailyListRow) => {
      const pos = normalizeDailyListPositionKey(String(row.position ?? '').trim());
      return Boolean(pos && allowed.has(pos));
    };
    return {
      earlyRows: tomorrowDailyList.earlyRows.filter(match),
      lateRows: tomorrowDailyList.lateRows.filter(match)
    };
  }, [tomorrowDailyList, selectedDailyFilterPositions]);
  const dailyListDisplayedCapacities = useMemo(
    () => ({
      early: sumDailyListCapacityRows(tomorrowDailyRowsDisplayed.earlyRows),
      late: sumDailyListCapacityRows(tomorrowDailyRowsDisplayed.lateRows)
    }),
    [tomorrowDailyRowsDisplayed, dailyListCapacityByRowKey]
  );
  const canCopyDailyListAll = tomorrowDailyList.earlyRows.length + tomorrowDailyList.lateRows.length > 0;
  const canCopyDailyListEarly = tomorrowDailyRowsDisplayed.earlyRows.length > 0;
  const canCopyDailyListLate = tomorrowDailyRowsDisplayed.lateRows.length > 0;
  const dailyListDateDisplay = useMemo(() => {
    const [yyyy, mm, dd] = String(tomorrowDailyList.targetDate ?? '').split('-');
    if (!yyyy || !mm || !dd) return String(tomorrowDailyList.targetDate ?? '');
    return `${mm}/${dd}/${yyyy}`;
  }, [tomorrowDailyList.targetDate]);
  const dailyListTotalDemandCount = useMemo(
    () => Number(tomorrowDailyList.earlyRows.length ?? 0) + Number(tomorrowDailyList.lateRows.length ?? 0),
    [tomorrowDailyList]
  );

  const scheduleEmployeesBase = useMemo(() => {
    if (page !== 'schedule') return [];
    return employees
      .filter((employee) => {
        const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
        const position = normalizeAllowedPosition(String(employee.position ?? employee.Position ?? '').trim());
        const employmentType = normalizeEmploymentTypeValue((employee as any).employment_type ?? (employee as any).EmploymentType ?? '');
        const label = String(employee.label ?? employee.Label ?? '').trim();
        if (!staff) return false;
        if (scheduleWorkDayFilter !== null) {
          const row = scheduleRowsByStaffDayIndex.get(`${staff}__${scheduleWorkDayFilter}`);
          const isWork = isWorkingScheduleRow(row);
          if (!isWork) return false;
        }
        if (deferredSchedulePosition && position !== deferredSchedulePosition) return false;
        if (deferredScheduleEmploymentType && employmentType !== deferredScheduleEmploymentType) return false;
        if (deferredScheduleLabels.length > 0) {
          const normalizedLabel = label.toLowerCase();
          const hit = deferredScheduleLabels.some((item) => normalizedLabel === item.toLowerCase());
          if (!hit) return false;
        }
        if (deferredScheduleShift) {
          const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
          if (inferredShift !== deferredScheduleShift) return false;
        }
        return true;
      })
      .sort((a, b) => String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''), 'en-US'));
  }, [
    page,
    employees,
    deferredSchedulePosition,
    deferredScheduleEmploymentType,
    deferredScheduleLabels,
    deferredScheduleShift,
    employeeShiftByStaffId,
    scheduleWorkDayFilter,
    scheduleRowsByStaffDayIndex
  ]);

  const scheduleLabelOptions = useMemo(() => {
    const out = new Set<string>();
    for (const employee of employees) {
      const position = normalizeAllowedPosition(String(employee.position ?? employee.Position ?? '').trim());
      if (deferredSchedulePosition && position !== deferredSchedulePosition) continue;
      const label = String(employee.label ?? employee.Label ?? '').trim();
      if (label) out.add(label);
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [employees, deferredSchedulePosition]);
  const dailyListNewHireLabelOptions = useMemo(() => {
    const targetPosition = normalizePositionKey(dailyListNewHirePosition);
    if (!targetPosition) return [];
    const out = new Set<string>();
    for (const employee of employees) {
      const position = normalizePositionKey(String(employee.position ?? employee.Position ?? '').trim());
      if (!position || position !== targetPosition) continue;
      const label = String(employee.label ?? employee.Label ?? '').trim();
      if (label) out.add(label);
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [employees, dailyListNewHirePosition]);
  useEffect(() => {
    if (!dailyListNewHireLabel) return;
    if (dailyListNewHireLabelOptions.includes(dailyListNewHireLabel)) return;
    setDailyListNewHireLabel('');
  }, [dailyListNewHireLabel, dailyListNewHireLabelOptions]);
  useEffect(() => {
    if (!dailyListNewHireOpen) return;
    const position = normalizePositionKey(dailyListNewHirePosition);
    const shift = dailyListNewHireShift;
    if (!position || !shift) {
      setDailyListNewHireEntryTime('');
      return;
    }
    setDailyListNewHireEntryTime(getPlannedStartTime(shift, position) || '');
  }, [dailyListNewHireOpen, dailyListNewHirePosition, dailyListNewHireShift]);
  const getSchedulePositionBadgeClass = (position: string) =>
    getPositionBadgeClass(position, schedulePositionToneByPosition);
  const getSchedulePositionBadgeClassLight = (position: string) =>
    getPositionBadgeClassLight(position, schedulePositionToneByPosition);
  const scheduleLabelDefaultToneByName = useMemo(() => {
    const positionCountByLabel: Record<string, Partial<Record<AllowedPosition, number>>> = {};
    for (const employee of employees) {
      const label = String(employee.label ?? employee.Label ?? '').trim();
      const position = normalizeAllowedPosition(String(employee.position ?? employee.Position ?? '').trim());
      if (!label || !position) continue;
      const key = label.toLowerCase();
      const next = positionCountByLabel[key] ?? {};
      next[position] = (next[position] ?? 0) + 1;
      positionCountByLabel[key] = next;
    }
    const toneByLabel: Record<string, LabelToneKey> = {};
    for (const [labelKey, counts] of Object.entries(positionCountByLabel)) {
      let topPosition: AllowedPosition | '' = '';
      let topCount = -1;
      for (const pos of ALLOWED_POSITIONS) {
        const count = Number(counts[pos] ?? 0);
        if (count > topCount) {
          topCount = count;
          topPosition = pos;
        }
      }
      if (!topPosition) continue;
      toneByLabel[labelKey] = schedulePositionToneByPosition[topPosition] ?? getDefaultPositionToneKey(topPosition);
    }
    return toneByLabel;
  }, [employees, schedulePositionToneByPosition]);
  const getScheduleLabelTone = (label: string): LabelToneKey => {
    const key = String(label ?? '').trim().toLowerCase();
    if (!key) return 'slate';
    return scheduleLabelToneByName[key] ?? scheduleLabelDefaultToneByName[key] ?? 'slate';
  };
  const cycleSchedulePositionTone = (position: AllowedPosition) => {
    setSchedulePositionToneByPosition((prev) => {
      const current = prev[position] ?? getDefaultPositionToneKey(position);
      const idx = LABEL_TONE_KEYS.indexOf(current);
      const next = LABEL_TONE_KEYS[(idx + 1) % LABEL_TONE_KEYS.length];
      return { ...prev, [position]: next };
    });
  };
  const getScheduleLabelToneClass = (label: string) => POSITION_TONE_CLASS_DARK[getScheduleLabelTone(label)] ?? POSITION_TONE_CLASS_DARK.slate;
  const cycleScheduleLabelTone = (label: string) => {
    const key = String(label ?? '').trim().toLowerCase();
    if (!key) return;
    setScheduleLabelToneByName((prev) => {
      const current = prev[key] ?? scheduleLabelDefaultToneByName[key] ?? 'slate';
      const idx = LABEL_TONE_KEYS.indexOf(current);
      const next = LABEL_TONE_KEYS[(idx + 1) % LABEL_TONE_KEYS.length];
      return { ...prev, [key]: next };
    });
  };

  const scheduleEmployeesFiltered = useMemo(() => {
    if (page !== 'schedule') return [];
    const search = deferredScheduleSearch.trim().toLowerCase();
    const filtered = !search
      ? scheduleEmployeesBase
      : scheduleEmployeesBase.filter((employee) => {
          const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
          const name = String(employee.name ?? '').trim();
          const position = String(employee.position ?? employee.Position ?? '').trim();
          return [staff, name, position].join(' ').toLowerCase().includes(search);
        });
    return [...filtered].sort((a, b) => {
      const staffA = normalizeStaffId(String(a.staff_id ?? '').trim());
      const staffB = normalizeStaffId(String(b.staff_id ?? '').trim());
      const pendingA = pendingTerminationRequestsByStaffId.has(staffA);
      const pendingB = pendingTerminationRequestsByStaffId.has(staffB);
      if (pendingA !== pendingB) return pendingA ? -1 : 1;
      if (!scheduleSortByUphDesc) return staffA.localeCompare(staffB, 'en-US');
      const rawA = Number(scheduleUphByStaffId[staffA]);
      const rawB = Number(scheduleUphByStaffId[staffB]);
      const hasA = Number.isFinite(rawA);
      const hasB = Number.isFinite(rawB);
      if (hasA && hasB && rawA !== rawB) return rawB - rawA;
      if (hasA && !hasB) return -1;
      if (!hasA && hasB) return 1;
      return staffA.localeCompare(staffB, 'en-US');
    });
  }, [page, scheduleEmployeesBase, deferredScheduleSearch, pendingTerminationRequestsByStaffId, scheduleSortByUphDesc, scheduleUphByStaffId]);
  const scheduleEmployeesRendered = useMemo(
    () => scheduleEmployeesFiltered.slice(0, Math.max(0, scheduleRenderCount)),
    [scheduleEmployeesFiltered, scheduleRenderCount]
  );

  useEffect(() => {
    if (page !== 'accounts') return;
    const total = accountRowsFiltered.length;
    setAccountRenderCount(Math.min(120, total));
  }, [page, accountRowsFiltered.length]);

  useEffect(() => {
    if (page !== 'timecard') return;
    const total = timecardRowsFiltered.length;
    setTimecardRenderCount(Math.min(120, total));
  }, [page, timecardRowsFiltered]);

  useEffect(() => {
    if (page !== 'timecard') return;
    if (timecardRenderCount >= timecardRowsFiltered.length) return;
    const onScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
      const fullHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
      if (scrollTop + viewport < fullHeight - 240) return;
      setTimecardRenderCount((prev) => {
        if (prev >= timecardRowsFiltered.length) return prev;
        return Math.min(prev + 120, timecardRowsFiltered.length);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [page, timecardRenderCount, timecardRowsFiltered]);

  useEffect(() => {
    if (page !== 'schedule') return;
    const total = scheduleEmployeesFiltered.length;
    setScheduleRenderCount(Math.min(24, total));
  }, [page]);

  useEffect(() => {
    if (page !== 'schedule') return;
    const total = scheduleEmployeesFiltered.length;
    const filterKey = JSON.stringify({
      search: deferredScheduleSearch.trim().toLowerCase(),
      position: deferredSchedulePosition || '',
      shift: deferredScheduleShift || '',
      labels: deferredScheduleLabels.map((item) => String(item ?? '').trim().toLowerCase()),
      day: scheduleWorkDayFilter ?? null
    });
    const filterChanged = scheduleRenderFilterKeyRef.current !== filterKey;
    scheduleRenderFilterKeyRef.current = filterKey;
    setScheduleRenderCount((prev) => {
      if (filterChanged || prev <= 0) return Math.min(24, total);
      if (prev > total) return total;
      return prev;
    });
  }, [
    page,
    scheduleEmployeesFiltered.length,
    deferredScheduleSearch,
    deferredSchedulePosition,
    deferredScheduleShift,
    deferredScheduleLabels,
    scheduleWorkDayFilter
  ]);

  useEffect(() => {
    if (page !== 'schedule') return;
    if (scheduleRenderCount >= scheduleEmployeesFiltered.length) return;
    const container = scheduleTableScrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const scrollTop = container.scrollTop;
      const viewport = container.clientHeight;
      const fullHeight = container.scrollHeight;
      if (scrollTop + viewport < fullHeight - 180) return;
      setScheduleRenderCount((prev) => {
        if (prev >= scheduleEmployeesFiltered.length) return prev;
        return Math.min(prev + 24, scheduleEmployeesFiltered.length);
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [page, scheduleRenderCount, scheduleEmployeesFiltered]);

  const scheduleWorkingCountByDayIndex = useMemo(() => {
    if (page !== 'schedule') return Array.from({ length: 7 }, () => 0);
    const counts = Array.from({ length: 7 }, () => 0);
    for (const employee of scheduleEmployeesFiltered) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
        if (!row) continue;
        if (isWorkingScheduleRow(row)) counts[dayIndex] += 1;
      }
    }
    return counts;
  }, [page, scheduleEmployeesFiltered, scheduleRowsByStaffDayIndex]);

  const homeOperationalDayIndex = useMemo(() => {
    const now = new Date(serverTime);
    const operationalStart = new Date(now);
    operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
    if (now.getTime() < operationalStart.getTime()) operationalStart.setDate(operationalStart.getDate() - 1);
    return (operationalStart.getDay() + 6) % 7;
  }, [serverTime]);
  const currentOperationalDate = useMemo(() => {
    const now = new Date(serverTime);
    const operationalStart = new Date(now);
    operationalStart.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
    if (now.getTime() < operationalStart.getTime()) operationalStart.setDate(operationalStart.getDate() - 1);
    return toDateOnly(operationalStart);
  }, [serverTime]);
  const scheduleMonthAnchor = useMemo(() => {
    if (scheduleWeekOffset !== 0) return scheduleWeekStart;
    const operationalDate = new Date(`${currentOperationalDate}T12:00:00`);
    if (Number.isNaN(operationalDate.getTime())) return scheduleWeekStart;
    const scheduleWeekEnd = addDays(scheduleWeekStart, 6);
    if (operationalDate >= scheduleWeekStart && operationalDate <= scheduleWeekEnd) {
      return operationalDate;
    }
    return serverTime;
  }, [currentOperationalDate, scheduleWeekOffset, scheduleWeekStart, serverTime]);
  const scheduleMonthRange = useMemo(() => getMonthDateRange(scheduleMonthAnchor), [scheduleMonthAnchor]);
  const scheduleMonthLabel = useMemo(() => formatYearMonthKey(scheduleMonthAnchor), [scheduleMonthAnchor]);
  const homeNowMinutes = useMemo(() => {
    const now = new Date(serverTime);
    return now.getHours() * 60 + now.getMinutes();
  }, [serverTime]);
  const homeExpectedCards = useMemo(() => {
    if (page !== 'home') {
      return (['early', 'late'] as const).flatMap((shift) =>
        ALLOWED_POSITIONS.map((position) => ({
          key: `${shift}:${position}`,
          shift,
          position,
          count: 0
        }))
      );
    }
    const countByKey: Record<string, number> = {};
    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      const row = scheduleRowsByStaffDayIndex.get(`${staff}__${homeOperationalDayIndex}`);
      if (!row || !isWorkingScheduleRow(row)) continue;
      const positionRaw =
        String(employeeProfileByStaffId.get(staff)?.position ?? '').trim() || String(row.position ?? '').trim();
      const normalizedPosition = normalizePositionKey(positionRaw);
      if (!normalizedPosition) continue;
      const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
      const shift = inferredShift;
      if (shift !== 'early' && shift !== 'late') continue;
      const key = `${shift}:${normalizedPosition}`;
      countByKey[key] = (countByKey[key] ?? 0) + 1;
    }
    return (['early', 'late'] as const).flatMap((shift) =>
      ALLOWED_POSITIONS.map((position) => ({
        key: `${shift}:${position}`,
        shift,
        position,
        count: countByKey[`${shift}:${position}`] ?? 0
      }))
    );
  }, [
    page,
    employees,
    scheduleRowsByStaffDayIndex,
    homeOperationalDayIndex,
    employeeProfileByStaffId,
    employeeShiftByStaffId,
  ]);
  const homeExpectedPositionSummaryCards = useMemo(
    () => {
      if (page !== 'home') return ALLOWED_POSITIONS.map((position) => ({ position, early: 0, late: 0, total: 0 }));
      return ALLOWED_POSITIONS.map((position) => {
        const early = homeExpectedCards.find((c) => c.shift === 'early' && c.position === position)?.count ?? 0;
        const late = homeExpectedCards.find((c) => c.shift === 'late' && c.position === position)?.count ?? 0;
        return { position, early, late, total: early + late };
      });
    },
    [page, homeExpectedCards]
  );
  const homeCardStats = useMemo(() => {
    if (page !== 'home') return {};
    const stats: Record<string, { early: number; late: number; active: number }> = {};
    const activeStaffSet = new Set(
      Object.keys(homeOnClockShiftByStaffId)
        .map((staff) => normalizeStaffId(String(staff ?? '').trim()))
        .filter(Boolean)
    );
    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      const row = scheduleRowsByStaffDayIndex.get(`${staff}__${homeOperationalDayIndex}`);
      const hasPunch = schedulePunchPresenceKeys.has(`${staff}__${homeOperationalDayIndex}`);
      // 跳过没有排班也没有打卡的人
      if (!row && !hasPunch && !activeStaffSet.has(staff)) continue;
      // 如果排班不是工作状态，但没有打卡记录，也跳过
      if (row && !isWorkingScheduleRow(row) && !hasPunch && !activeStaffSet.has(staff)) continue;
      const positionRaw =
        String(employeeProfileByStaffId.get(staff)?.position ?? '').trim() || (row ? String(row.position ?? '').trim() : '');
      const position = normalizePositionKey(positionRaw);
      if (!position) continue;
      const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
      const shift = inferredShift;
      if (shift !== 'early' && shift !== 'late') continue;
      const s = (stats[position] ??= { early: 0, late: 0, active: 0 });
      if (hasPunch) {
        s[shift] += 1;
      }
      if (activeStaffSet.has(staff)) {
        s.active += 1;
      }
    }
    return stats;
  }, [
    page,
    homeOnClockShiftByStaffId,
    employees,
    scheduleRowsByStaffDayIndex,
    homeOperationalDayIndex,
    employeeProfileByStaffId,
    employeeShiftByStaffId,
    schedulePunchPresenceKeys
  ]);

  const homeEmployeeByStaffId = useMemo(() => {
    const map = new Map<string, EmployeeRow>();
    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff || map.has(staff)) continue;
      map.set(staff, employee);
    }
    return map;
  }, [employees]);

  const homeBorrowedDeviceByStaffId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [sn, borrowed] of deviceCurrentBorrowBySn.entries()) {
      const staff = normalizeStaffId(String(borrowed.staff_id ?? '').trim());
      if (!staff) continue;
      const current = map.get(staff) ?? [];
      current.push(sn);
      map.set(staff, current);
    }
    return map;
  }, [deviceCurrentBorrowBySn]);

  const homeFirstInAtByStaffId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [key, createdAt] of Object.entries(scheduleFirstInByStaffDayKey)) {
      const [staffRaw, dayIndexRaw] = String(key ?? '').split('__');
      const staff = normalizeStaffId(String(staffRaw ?? '').trim());
      const dayIndex = Number(dayIndexRaw ?? NaN);
      if (!staff || !Number.isFinite(dayIndex) || dayIndex !== homeOperationalDayIndex) continue;
      const value = String(createdAt ?? '').trim();
      if (!value) continue;
      map.set(staff, value);
    }
    return map;
  }, [scheduleFirstInByStaffDayKey, homeOperationalDayIndex]);

  const homeRosterRows = useMemo(() => {
    type HomeRosterItem = {
      staff_id: string;
      name: string;
      agency: string;
      position: string;
      shift: string;
      attendance: 'Absent' | 'Off Worked' | 'Normal' | 'Completed';
      label: string;
      account: string;
      borrowed_device: string;
      mistake_count_7d: number;
      punches: Array<{ action: 'IN' | 'OUT'; created_at: string }>;
    };

    if (page !== 'home') {
      return {
        absent: [] as HomeRosterItem[],
        restWorked: [] as HomeRosterItem[],
        completed: [] as HomeRosterItem[],
        onClock: [] as HomeRosterItem[]
      };
    }
    const absent: HomeRosterItem[] = [];
    const restWorked: HomeRosterItem[] = [];
    const completed: HomeRosterItem[] = [];
    const onClock: HomeRosterItem[] = [];
    const seen = new Set<string>();
    const nowMinutes = homeNowMinutes;
    const lateAbsentVisibleMinutes = 16 * 60 + 30; // 16:30

    const buildHomeRosterItem = (options: {
      staff: string;
      profile?: { name: string; agency: string; position: string; shiftTime: string };
      employee?: EmployeeRow;
      positionRaw?: string;
      shift: '' | 'early' | 'late';
      isOnClock: boolean;
      attendanceOverride?: 'Absent' | 'Off Worked' | 'Normal' | 'Completed';
      extraMistakes?: number;
    }): HomeRosterItem => {
      const {
        staff,
        profile,
        employee,
        positionRaw,
        shift,
        isOnClock,
        attendanceOverride,
        extraMistakes = 0
      } = options;
      const account = String(employee?.work_account ?? employee?.WorkAccount ?? '').trim();
      const label = String(employee?.label ?? employee?.Label ?? '').trim();
      const borrowedDevice = (homeBorrowedDeviceByStaffId.get(staff) ?? []).join(', ');
      const firstInAt = String(homeFirstInAtByStaffId.get(staff) ?? '').trim();
      const rawPunches = Array.isArray(homePunchesByStaffId[staff])
        ? homePunchesByStaffId[staff].filter((item) => !isExactOperationalCutoffOut(item.created_at, item.action))
        : [];
      const manualMistakes = Number(scheduleMistakeByStaffId[staff] ?? 0);
      return {
        staff_id: staff,
        name: String(profile?.name ?? employee?.name ?? '').trim(),
        agency: String(profile?.agency ?? employee?.agency ?? employee?.Agency ?? '').trim(),
        position: String(positionRaw ?? profile?.position ?? employee?.position ?? employee?.Position ?? '').trim(),
        shift: shift === 'early' ? 'Morning' : shift === 'late' ? 'Night' : '-',
        attendance: attendanceOverride ?? (isOnClock ? 'Normal' : 'Absent'),
        label,
        account: account || '-',
        borrowed_device: borrowedDevice,
        mistake_count_7d: Math.max(0, manualMistakes + extraMistakes),
        punches:
          rawPunches.length > 0
            ? rawPunches
            : firstInAt
              ? [{ action: 'IN', created_at: firstInAt }]
              : []
      };
    };

    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff || seen.has(staff)) continue;
      seen.add(staff);

      const row = scheduleRowsByStaffDayIndex.get(`${staff}__${homeOperationalDayIndex}`);
      // 不再跳过没有排班记录的员工，让他们也能显示在打卡中列表

      const baseState = row ? getScheduleBaseStateFromNote(row.note) : 'rest';
      const hasPunch = schedulePunchPresenceKeys.has(`${staff}__${homeOperationalDayIndex}`);
      const currentOnClockShift = homeOnClockShiftByStaffId[staff];
      const isCurrentlyOnClock = currentOnClockShift === 'early' || currentOnClockShift === 'late';
      const shift = employeeShiftByStaffId[staff]?.shift ?? '';
      const profile = employeeProfileByStaffId.get(staff);
      const item = buildHomeRosterItem({
        staff,
        profile,
        employee,
        positionRaw: String(employee.position ?? employee.Position ?? '').trim(),
        shift,
        isOnClock: false
      });
      if (isScheduleOnlyAgency(item.agency)) continue;

      const hideLateAbsent = shift === 'late' && nowMinutes < lateAbsentVisibleMinutes;
      // 缺勤：仅在打卡存在性加载完成后再判断，避免初始加载闪烁全缺勤
      if (schedulePunchPresenceReady && row && isWorkingScheduleBaseState(baseState) && !hasPunch && !hideLateAbsent) {
        absent.push({ ...item, attendance: 'Absent', mistake_count_7d: item.mistake_count_7d + 1 });
      }
      // 排休出勤：休息类状态或无排班，但有打卡
      if (hasPunch && (!row || isRestLikeScheduleBaseState(baseState))) {
        restWorked.push({ ...item, attendance: 'Off Worked', mistake_count_7d: item.mistake_count_7d + 1 });
      }
      // 已完成打卡：有排班且有打卡，但当前不在 on clock 列表里
      if (hasPunch && row && isWorkingScheduleBaseState(baseState) && !isCurrentlyOnClock) {
        completed.push({ ...item, attendance: 'Completed' });
      }
    }

    absent.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));
    restWorked.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));
    completed.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));
    for (const [staffRaw, shiftRaw] of Object.entries(homeOnClockShiftByStaffId)) {
      const staff = normalizeStaffId(String(staffRaw ?? '').trim());
      if (!staff) continue;
      const profile = employeeProfileByStaffId.get(staff);
      const row = scheduleRowsByStaffDayIndex.get(`${staff}__${homeOperationalDayIndex}`);
      const fallbackEmp = homeEmployeeByStaffId.get(staff);
      const position = String(profile?.position ?? row?.position ?? fallbackEmp?.position ?? fallbackEmp?.Position ?? '').trim();
      const agency = String(profile?.agency ?? fallbackEmp?.agency ?? fallbackEmp?.Agency ?? '').trim();
      if (isScheduleOnlyAgency(agency)) continue;
      onClock.push(
        buildHomeRosterItem({
          staff,
          profile,
          employee: fallbackEmp,
          positionRaw: position,
          shift: shiftRaw,
          isOnClock: true
        })
      );
    }
    onClock.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));
    return { absent, restWorked, completed, onClock };
  }, [
    page,
    employees,
    scheduleRowsByStaffDayIndex,
    homeOperationalDayIndex,
    schedulePunchPresenceKeys,
    schedulePunchPresenceReady,
    homeNowMinutes,
    homeOnClockShiftByStaffId,
    homeEmployeeByStaffId,
    homeBorrowedDeviceByStaffId,
    homePunchesByStaffId,
    homeFirstInAtByStaffId,
    employeeShiftByStaffId,
    employeeProfileByStaffId,
    scheduleMistakeByStaffId
  ]);
  const homeRosterRowsFiltered = useMemo(() => {
    if (page !== 'home') {
      return {
        absent: [] as typeof homeRosterRows.absent,
        restWorked: [] as typeof homeRosterRows.restWorked,
        completed: [] as typeof homeRosterRows.completed,
        onClock: [] as typeof homeRosterRows.onClock
      };
    }
    const filterRows = (rows: typeof homeRosterRows.absent) =>
      rows.filter((row) => {
        if (homeRosterPositionFilter === 'ALL') return true;
        const pos = normalizePositionKey(String(row.position ?? '').trim());
        return pos === homeRosterPositionFilter;
      });
    return {
      absent: filterRows(homeRosterRows.absent),
      restWorked: filterRows(homeRosterRows.restWorked),
      completed: filterRows(homeRosterRows.completed),
      onClock: filterRows(homeRosterRows.onClock)
    };
  }, [page, homeRosterRows, homeRosterPositionFilter]);
  const homeRosterRowsCurrent = useMemo(() => {
    if (page !== 'home') return [];
    return [
      ...homeRosterRowsFiltered.absent,
      ...homeRosterRowsFiltered.restWorked,
      ...homeRosterRowsFiltered.completed,
      ...homeRosterRowsFiltered.onClock
    ];
  }, [page, homeRosterRowsFiltered]);
  const formatDailyListStaffId = (row: DailyListRow) => {
    const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!isNewHirePlaceholderStaffId(staff)) return displayStaffId(staff);
    const matchedNew = staff.match(/^(\d{2})(\d{2})([A-Z]+)(\d{3,})$/i);
    if (matchedNew) {
      const mm = matchedNew[1] ?? '';
      const dd = matchedNew[2] ?? '';
      const pos = String(matchedNew[3] ?? '').toUpperCase();
      const seq = String(Number(matchedNew[4] ?? '0'));
      return `${mm}/${dd}NEW ${pos}${seq}`.trim();
    }
    const matchedLegacy = staff.match(/^NEWREQ-(\d{4})(\d{2})(\d{2})(?:-([A-Z]+))?-(\d{3,})$/i);
    if (matchedLegacy) {
      const mm = matchedLegacy[2] ?? '';
      const dd = matchedLegacy[3] ?? '';
      const pos = String(matchedLegacy[4] ?? '').toUpperCase();
      const seq = String(Number(matchedLegacy[5] ?? '0'));
      return `${mm}/${dd}NEW ${pos}${seq}`.trim();
    }
    const fallbackName = String(row.name ?? '').trim();
    if (isNewHirePlaceholderName(fallbackName)) return fallbackName;
    return staff;
  };
const makeDailyListTsv = (rows: DailyListRow[]) =>
  rows
      .map((row, idx) =>
        [idx + 1, formatDailyListStaffId(row), row.name, row.agency, '', row.position, row.start_time]
          .map((c) => String(c ?? ''))
          .join('\t')
      )
      .join('\n');
  const copyDailyList = async (scope: 'early' | 'late' | 'all') => {
    const early = scope === 'all' ? tomorrowDailyList.earlyRows : tomorrowDailyRowsDisplayed.earlyRows;
    const late = scope === 'all' ? tomorrowDailyList.lateRows : tomorrowDailyRowsDisplayed.lateRows;
    const mmddyyyy = (() => {
      const [yyyy, mm, dd] = String(tomorrowDailyList.targetDate ?? '').split('-');
      if (!yyyy || !mm || !dd) return '';
      return `${mm}/${dd}/${yyyy}`;
    })();
    const nightDividerText = `${mmddyyyy}夜班`;
    const text =
      scope === 'early'
        ? makeDailyListTsv(early)
        : scope === 'late'
          ? makeDailyListTsv(late)
          : [makeDailyListTsv(early), '', nightDividerText, makeDailyListTsv(late)].filter(Boolean).join('\n');
    const escapeHtml = (value: string) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const rowsToHtml = (rows: DailyListRow[]) =>
      rows
        .map((row, idx) => {
          const cells = [
            idx + 1,
            formatDailyListStaffId(row),
            String(row.name ?? ''),
            String(row.agency ?? ''),
            '',
            String(row.position ?? ''),
            String(row.start_time ?? '')
          ];
          return `<tr>${cells.map((cell) => `<td style="border:1px solid #d1d5db;padding:4px 6px;white-space:pre-wrap;">${escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`;
        })
        .join('');
    const html =
      scope === 'all'
        ? `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
${rowsToHtml(early)}
<tr><td colspan="7" style="padding:6px;border:none;"></td></tr>
<tr><td colspan="7" style="background:#dc2626;color:#ffffff;font-weight:700;padding:6px 8px;border:1px solid #dc2626;">${escapeHtml(nightDividerText)}</td></tr>
${rowsToHtml(late)}
</table>`
        : `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${rowsToHtml(scope === 'early' ? early : late)}</table>`;
    if (!text.trim()) {
      setStatus({ tone: 'error', message: 'No rows to copy.' });
      return;
    }
    try {
      const ClipboardItemCtor = (globalThis as any).ClipboardItem;
      if (navigator?.clipboard?.write && ClipboardItemCtor) {
        const item = new ClipboardItemCtor({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        });
        await navigator.clipboard.write([item]);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setStatus({
        tone: 'success',
        message:
          scope === 'all'
            ? `Copied tomorrow list (${early.length + late.length} rows).`
            : `Copied ${scope === 'early' ? 'morning' : 'night'} tomorrow list (${scope === 'early' ? early.length : late.length} rows).`
      });
    } catch (err: any) {
      setStatus({ tone: 'error', message: `Copy failed: ${String(err?.message ?? err ?? 'Unknown error')}` });
    }
  };

  const addDailyListNewHireDemand = async () => {
    if (!scheduleCanOperate) {
      setStatus({ tone: 'error', message: t('排班模块当前为只读。', 'Schedule is read-only.') });
      return;
    }
    if (!supabase) {
      setStatus({ tone: 'error', message: 'Missing Supabase config.' });
      return;
    }
    const targetDate = isDateOnlyValue(dailyListDateInput) ? dailyListDateInput : toDateOnly(addDays(new Date(serverTime), 1));
    const target = new Date(`${targetDate}T00:00:00`);
    if (Number.isNaN(target.getTime())) {
      setStatus({ tone: 'error', message: 'Invalid target date.' });
      return;
    }
    const dayIndex = (target.getDay() + 6) % 7;
    const baseWeekStart = startOfWeekMonday(new Date(serverTime));
    const targetWeekStart = startOfWeekMonday(target);
    const weekOffsetRaw = Math.round(
      (targetWeekStart.getTime() - baseWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    const weekOffset = clamp(weekOffsetRaw, 0, 1);
    const templateDate = getTemplateDateByDayIndex(dayIndex, weekOffset);
    const position = normalizePositionKey(dailyListNewHirePosition);
    const shift = dailyListNewHireShift;
    const agency = dailyListNewHireAgency.trim();
    const label = dailyListNewHireLabel.trim();
    const note = dailyListNewHireNote.trim();
    const count = clamp(Number(dailyListNewHireCount) || 0, 1, 200);
    if (!position) {
      setStatus({ tone: 'error', message: 'Please choose position.' });
      return;
    }
    if (!shift) {
      setStatus({ tone: 'error', message: 'Please choose shift.' });
      return;
    }
    const entryTime = dailyListNewHireEntryTime.trim();
    if (!entryTime) {
      setStatus({ tone: 'error', message: 'Please set entry time.' });
      return;
    }

    const mmdd = (() => {
      const m = String(target.getMonth() + 1).padStart(2, '0');
      const d = String(target.getDate()).padStart(2, '0');
      return `${m}/${d}`;
    })();
    const mmddCompact = mmdd.replace('/', '');
    const positionUpper = String(position).toUpperCase();
    const existingSeqSet = new Set<number>();
    const escapedMmdd = mmdd.replace('/', '\\/');
    const nameSeqRegex = new RegExp(`^${escapedMmdd}NEW\\s+${positionUpper}(\\d+)$`, 'i');
    const staffSeqRegexNew = new RegExp(`^${mmddCompact}${positionUpper}(\\d{3,})$`, 'i');
    const staffSeqRegexLegacy = new RegExp(`^NEWREQ-${targetDate.replace(/-/g, '')}-${positionUpper}-(\\d{3,})$`, 'i');
    for (const e of employees) {
      const name = String(e.name ?? '').trim();
      const staff = String(e.staff_id ?? '').trim();
      const m1 = name.match(nameSeqRegex);
      if (m1?.[1]) existingSeqSet.add(Number(m1[1]));
      const m2 = staff.match(staffSeqRegexNew);
      if (m2?.[1]) existingSeqSet.add(Number(m2[1]));
      const m3 = staff.match(staffSeqRegexLegacy);
      if (m3?.[1]) existingSeqSet.add(Number(m3[1]));
    }
    try {
      const remoteRes = await supabase
        .from(EMPLOYEE_TABLE)
        .select('staff_id, name')
        .or(
          `staff_id.ilike.${mmddCompact}${positionUpper}%,staff_id.ilike.NEWREQ-${targetDate.replace(/-/g, '')}-${positionUpper}-%`
        )
        .limit(2000);
      if (!remoteRes.error) {
        const rows = ((remoteRes.data as any[]) ?? []) as Array<{ staff_id?: string | null; name?: string | null }>;
        for (const r of rows) {
          const name = String(r.name ?? '').trim();
          const staff = String(r.staff_id ?? '').trim();
          const m1 = name.match(nameSeqRegex);
          if (m1?.[1]) existingSeqSet.add(Number(m1[1]));
          const m2 = staff.match(staffSeqRegexNew);
          if (m2?.[1]) existingSeqSet.add(Number(m2[1]));
          const m3 = staff.match(staffSeqRegexLegacy);
          if (m3?.[1]) existingSeqSet.add(Number(m3[1]));
        }
      }
    } catch {
      // ignore remote scan failures; local set still protects most cases
    }
    const nextSeq = existingSeqSet.size > 0 ? Math.max(...Array.from(existingSeqSet)) + 1 : 1;

    await runLocked('daily_list_new_hire', async () => {
      const mode = await resolveEmployeeColumnMode();
      const nowIso = new Date(serverTime).toISOString();
      const employeeRows: Array<Record<string, unknown>> = [];
      const scheduleRowsToWrite: Array<Record<string, unknown>> = [];
      const localEmployeesToAdd: EmployeeRow[] = [];
      const localSchedulesToAdd: ScheduleRow[] = [];
      for (let i = 0; i < count; i += 1) {
        const seq = nextSeq + i;
        const internalStaffId = `${mmddCompact}${positionUpper}${String(seq).padStart(3, '0')}`;
        const employeeName = note || '-';
        const employeePayload =
          mode === 'cased'
            ? {
                staff_id: internalStaffId,
                name: employeeName,
                Agency: agency || null,
                Position: position,
                employment_type: 'FT',
                shift,
                label: label || null,
                created_at: nowIso
              }
            : {
                staff_id: internalStaffId,
                name: employeeName,
                agency: agency || null,
                position,
                employment_type: 'FT',
                shift,
                label: label || null,
                created_at: nowIso
              };
        employeeRows.push(employeePayload as Record<string, unknown>);
        scheduleRowsToWrite.push({
          staff_id: internalStaffId,
          date: templateDate,
          position,
          note: SCHEDULE_NEW_NOTE,
          operator: user?.email ?? null,
          updated_at: nowIso
        });
        localEmployeesToAdd.push({
          staff_id: internalStaffId,
          name: employeeName,
          agency: agency || null,
          position,
          employment_type: 'FT',
          shift,
          label: label || null,
          created_at: nowIso
        });
        localSchedulesToAdd.push({
          staff_id: internalStaffId,
          date: templateDate,
          position,
          note: SCHEDULE_NEW_NOTE,
          operator: user?.email ?? null,
          updated_at: nowIso
        });
      }

      const employeeUpsertRes = await supabase.from(EMPLOYEE_TABLE).upsert(employeeRows as any[], {
        onConflict: 'staff_id',
        ignoreDuplicates: false
      });
      if (employeeUpsertRes.error) {
        setStatus({ tone: 'error', message: `New hire create failed: ${employeeUpsertRes.error.message}` });
        return;
      }

      const scheduleUpsertRes = await supabase.from(SCHEDULE_TABLE).upsert(scheduleRowsToWrite as any[], {
        onConflict: 'staff_id,date'
      });
      if (scheduleUpsertRes.error) {
        setStatus({ tone: 'error', message: `New hire schedule failed: ${scheduleUpsertRes.error.message}` });
        return;
      }

      setStatus({ tone: 'success', message: `Created ${count} new hire demand row(s).` });
      setDailyListNewHireOpen(false);
      setDailyListNewHireCount(1);
      setDailyListNewHireAgency('');
      setDailyListNewHirePosition('');
      setDailyListNewHireShift('');
      setDailyListNewHireLabel('');
      setDailyListNewHireEntryTime('');
      setDailyListNewHireNote('');
      setEmployees((prev) => {
        const byStaff = new Map<string, EmployeeRow>();
        for (const row of prev) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          if (!staff) continue;
          byStaff.set(staff, row);
        }
        for (const row of localEmployeesToAdd) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          if (!staff) continue;
          byStaff.set(staff, row);
        }
        return Array.from(byStaff.values()).sort((a, b) =>
          String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''), 'en-US')
        );
      });
      setScheduleRows((prev) => {
        const byKey = new Map<string, ScheduleRow>();
        for (const row of prev) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const date = String(row.date ?? '').trim();
          if (!staff || !date) continue;
          byKey.set(`${staff}__${date}`, row);
        }
        for (const row of localSchedulesToAdd) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const date = String(row.date ?? '').trim();
          if (!staff || !date) continue;
          byKey.set(`${staff}__${date}`, row);
        }
        return Array.from(byKey.values());
      });
    });
  };

  const exportScheduleTemplate = async () => {
    await runLocked('schedule_export', async () => {
      const rows = scheduleEmployeesFiltered;
      if (rows.length === 0) {
        setStatus({ tone: 'error', message: '暂无可导出的排班数据。' });
        return;
      }
      if (scheduleShift !== 'early' && scheduleShift !== 'late') {
        setStatus({ tone: 'error', message: '请先在 Shift 里选择早班或晚班后再导出。' });
        return;
      }

      const dateHeaders = scheduleDays.map((day) => toDateOnly(day));
      const headers = ['用户ERP', '用户编码', '用户姓名', ...dateHeaders];

      const resolveEmployeeShift = (staff: string): '' | 'early' | 'late' => {
        const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
        if (inferredShift === 'early' || inferredShift === 'late') return inferredShift;
        return '';
      };

      const buildShiftRows = (shift: 'early' | 'late') =>
        rows
          .filter((employee) => {
            const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
            if (!staff) return false;
            return resolveEmployeeShift(staff) === shift;
          })
          .sort((a, b) => String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''), 'en-US'))
          .map((employee) => {
            const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
            const name = String(employee.name ?? '').trim();
            const dayCells = Array.from({ length: 7 }, (_, dayIndex) => {
              const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
              if (!row) return '休息';
              const state = getScheduleBaseStateFromNote(row.note);
              if (state === 'new') return '新人';
              if (state === 'work') return shift === 'late' ? '晚1' : '早1';
              if (state === 'fixed_work') return '固定排班';
              if (state === 'temp_work') return '临时工作';
              if (state === 'planned_temp_work') return '替补';
              if (state === 'leave') return '请假';
              if (state === 'planned_leave') return '计划请假';
              if (state === 'temp_rest') return '临时排休';
              if (state === 'planned_temp_rest') return '计划临时排休';
              return '休息';
            });
            return ['', staff, name, ...dayCells];
          });

      const infoTextByShift = (shift: 'early' | 'late') =>
        [
          '班次信息：',
          '休息 00:00:00--23:59:59 上班边界时长：0(分) 下班边界时长：0(分)',
          shift === 'late'
            ? '晚1 16:30:00--23:59:59 上班边界时长：30.0(分) 下班边界时长：30.0(分)'
            : '早1 08:00:00--16:30:00 上班边界时长：30.0(分) 下班边界时长：30.0(分)'
        ].join('\n');

      try {
        const XLSX = await import('xlsx');
        const buildSheet = (shift: 'early' | 'late') => {
          const infoText = infoTextByShift(shift);
          const aoa = [[infoText], headers, ...buildShiftRows(shift)];
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
          ws['!rows'] = [{ hpt: 78 }, { hpt: 28 }];
          ws['!cols'] = Array.from({ length: headers.length }, (_, idx) => {
            if (idx === 0) return { wch: 12 };
            if (idx === 1) return { wch: 14 };
            if (idx === 2) return { wch: 14 };
            return { wch: 13 };
          });
          if (!ws.A1) ws.A1 = { t: 's', v: infoText };
          (ws.A1 as any).s = {
            alignment: { wrapText: true, vertical: 'top', horizontal: 'left' },
            font: { bold: true }
          };
          return ws;
        };

        const wb = XLSX.utils.book_new();
        const shift = scheduleShift as 'early' | 'late';
        const sheetName = shift === 'late' ? '1' : '0';
        XLSX.utils.book_append_sheet(wb, buildSheet(shift), sheetName);
        const filename = `ob_schedule_${sheetName}_${toDateOnly(scheduleWeekStart)}.xlsx`;
        XLSX.writeFile(wb, filename);
        setStatus({ tone: 'success', message: `已导出：${filename}` });
      } catch (err: any) {
        setStatus({ tone: 'error', message: `导出失败：${String(err?.message ?? err ?? 'Unknown error')}` });
      }
    });
  };

  const printScheduleSignInSheet = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(schedulePrintDate)) {
      setStatus({ tone: 'error', message: 'Please select a valid print date.' });
      return;
    }
    const dt = new Date(`${schedulePrintDate}T00:00:00`);
    if (Number.isNaN(dt.getTime())) {
      setStatus({ tone: 'error', message: 'Invalid print date.' });
      return;
    }

    const dayIndex = (dt.getDay() + 6) % 7;
    const weekLabel = dt.toLocaleDateString('en-US', { weekday: 'short' });
    const roleLabel = schedulePosition ? schedulePosition.toUpperCase() : 'ALL POSITIONS';
    const escapeHtml = (value: string) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const PRINT_LABEL_TINT_BY_TONE: Record<LabelToneKey, string> = {
      sky: '#eaf5ff',
      emerald: '#ecfbf5',
      amber: '#fff6db',
      violet: '#f4efff',
      rose: '#ffeef4',
      slate: '#f1f5f9'
    };
    const getLabelTint = (label: string) => {
      const tone = getScheduleLabelTone(label);
      return PRINT_LABEL_TINT_BY_TONE[tone];
    };

    const rows = scheduleEmployeesFiltered
      .map((employee) => {
        const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
        if (!staff) return null;
        const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
        if (!isWorkingScheduleRow(row)) return null;
        const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
        const shift = inferredShift;
        if (shift !== 'early' && shift !== 'late') return null;
        return {
          staff_id: staff,
          name: String(employee.name ?? '').trim(),
          agency: String(employee.agency ?? employee.Agency ?? '').trim(),
          label: String(employee.label ?? employee.Label ?? '').trim(),
          shift
        };
      })
      .filter(Boolean) as Array<{ staff_id: string; name: string; agency: string; label: string; shift: 'early' | 'late' }>;

    const extractNewSeq = (row: { staff_id: string; name: string }) => {
      const nameMatch = String(row.name ?? '').trim().match(/NEW\s+[A-Z]+(\d+)$/i);
      if (nameMatch?.[1]) return Number(nameMatch[1]);
      const staffMatch = String(row.staff_id ?? '').trim().match(/(\d{3,})$/);
      if (staffMatch?.[1]) return Number(staffMatch[1]);
      return 999999;
    };
    const isPlaceholderNewHire = (row: { staff_id: string; name: string }) =>
      isNewHirePlaceholderStaffId(String(row.staff_id ?? '').trim()) || isNewHirePlaceholderName(String(row.name ?? '').trim());

    const byLabelThenName = (
      a: { label: string; name: string; staff_id: string },
      b: { label: string; name: string; staff_id: string }
    ) => {
      const aIsNew = isPlaceholderNewHire(a);
      const bIsNew = isPlaceholderNewHire(b);
      if (aIsNew !== bIsNew) return aIsNew ? 1 : -1;
      if (aIsNew && bIsNew) {
        const aSeq = extractNewSeq(a);
        const bSeq = extractNewSeq(b);
        if (aSeq !== bSeq) return aSeq - bSeq;
      }
      const la = a.label.trim().toLowerCase();
      const lb = b.label.trim().toLowerCase();
      if (la !== lb) return la.localeCompare(lb, 'en-US');
      const na = a.name.trim().toLowerCase();
      const nb = b.name.trim().toLowerCase();
      if (na !== nb) return na.localeCompare(nb, 'en-US');
      return a.staff_id.localeCompare(b.staff_id, 'en-US');
    };
    const earlyRows = rows.filter((r) => r.shift === 'early').sort(byLabelThenName);
    const lateRows = rows.filter((r) => r.shift === 'late').sort(byLabelThenName);

    const renderRows = (list: Array<{ staff_id: string; name: string; agency: string; label: string }>) =>
      list
        .map(
          (r, idx) => {
            const labelTint = getLabelTint(r.label);
            const isNew = isPlaceholderNewHire(r);
            const newSeq = extractNewSeq(r);
            const idText = isNew ? `NEW${newSeq}` : displayStaffId(r.staff_id);
            const nameText = isNew ? '' : r.name;
            return `<tr>
              <td class="num" style="background:${labelTint};">${idx + 1}</td>
              <td style="background:${labelTint};">${escapeHtml(idText)}</td>
              <td style="background:${labelTint};">${escapeHtml(nameText)}</td>
              <td style="background:${labelTint};">${escapeHtml(r.agency)}</td>
              <td style="background:${labelTint};">${escapeHtml(r.label || '-')}</td>
              <td style="background:${labelTint};"></td>
              <td style="background:${labelTint};"></td>
              <td style="background:${labelTint};"></td>
            </tr>`;
          }
        )
        .join('');

    const renderTable = (rowsHtml: string, klass: 'morning' | 'night') => `
      <section class="block ${klass}">
        <div class="shift-title">${klass === 'morning' ? 'MORNING SHIFT' : 'NIGHT SHIFT'}</div>
        <table>
          <thead>
            <tr>
              <th class="num">No.</th>
              <th>ID</th>
              <th>Name</th>
              <th>Agency</th>
              <th>Label</th>
              <th>Clockin</th>
              <th>Clockout</th>
              <th>Signature</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </section>
    `;

    const sections: string[] = [];
    if (earlyRows.length > 0) sections.push(renderTable(renderRows(earlyRows), 'morning'));
    if (lateRows.length > 0) sections.push(renderTable(renderRows(lateRows), 'night'));
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Sign-in Sheet ${schedulePrintDate}</title>
  <style>
    @page { size: Letter portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; }
    .sheet { width: 100%; margin: 0 auto; }
    h1 { margin: 0; text-align: center; font-size: 32px; letter-spacing: 0.04em; font-weight: 800; }
    .meta { margin: 6px 0 12px; text-align: center; font-size: 16px; font-weight: 700; color: #111827; }
    .block { margin-top: 8px; }
    .shift-title { margin: 0 0 6px; font-size: 13px; font-weight: 800; letter-spacing: 0.08em; color: #0f172a; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #111; }
    th, td { border: 1px solid #444; padding: 4px 6px; font-size: 12px; height: 28px; }
    th { background: #111 !important; color: #fff !important; text-align: left; }
    .num { width: 40px; text-align: center; }
    table th:nth-child(1), table td:nth-child(1) { width: 40px; }
    table th:nth-child(2), table td:nth-child(2) { width: 110px; }
    table th:nth-child(3), table td:nth-child(3) { width: 250px; }
    table th:nth-child(4), table td:nth-child(4) { width: 90px; }
    table th:nth-child(5), table td:nth-child(5) { width: 90px; }
    table th:nth-child(6), table td:nth-child(6),
    table th:nth-child(7), table td:nth-child(7),
    table th:nth-child(8), table td:nth-child(8) { width: 90px; }
  </style>
</head>
<body>
  <main class="sheet">
    <h1>${roleLabel}</h1>
    <div class="meta">Sign-in Sheet ${schedulePrintDate} ${weekLabel}</div>
    ${sections.join('')}
  </main>
</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      setStatus({ tone: 'error', message: 'Print failed: iframe not available.' });
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();

  const doPrint = () => {
      const win = iframe.contentWindow;
      if (!win) {
        iframe.remove();
        setStatus({ tone: 'error', message: 'Print failed.' });
        return;
      }
      win.focus();
      win.print();
      window.setTimeout(() => iframe.remove(), 1200);
    };
    if (iframe.contentWindow?.document.readyState === 'complete') doPrint();
    else iframe.onload = doPrint;
  };

  const scheduleNowMinutes = useMemo(() => {
    const now = new Date(serverTime);
    return now.getHours() * 60 + now.getMinutes();
  }, [serverTime]);
  const scheduleIsCurrentWeek = scheduleWeekOffset === 0;
  const schedulePunchPresenceMatchesWeek = schedulePunchPresenceWeekOffset === scheduleWeekOffset;
  const scheduleLateAbsentVisibleMinutes = 16 * 60 + 30;
  const scheduleMonthlyAbsentByStaffId = useMemo(() => {
    const nextMap: Record<string, number> = {};
    const liveDatesByStaff = new Map<string, Set<string>>();

    if (page === 'schedule' && scheduleIsCurrentWeek && schedulePunchPresenceReady && schedulePunchPresenceMatchesWeek) {
      for (const employee of employees) {
        const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
        if (!staff || scheduleOnlyStaffIds.has(staff)) continue;
        for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
          const day = scheduleDays[dayIndex];
          if (!day) continue;
          const operationalDate = toDateOnly(day);
          if (operationalDate < scheduleMonthRange.startKey || operationalDate > scheduleMonthRange.endKey) continue;

          const key = `${staff}__${dayIndex}`;
          const row = scheduleRowsByStaffDayIndex.get(key);
          if (!row || !isWorkingScheduleBaseState(getScheduleBaseStateFromNote(row.note))) continue;

          const hasPunch = schedulePunchPresenceKeys.has(key);
          const scheduledShiftForAbsent = employeeShiftByStaffId[staff]?.shift ?? '';
          const targetShift: 'early' | 'late' =
            scheduledShiftForAbsent === 'late'
              ? 'late'
              : (row?.shift as 'early' | 'late' | null) === 'late'
                ? 'late'
                : 'early';
          const isPastOperationalDay = dayIndex < homeOperationalDayIndex;
          const isCurrentOperationalDay = dayIndex === homeOperationalDayIndex;
          const hideLateAbsent = targetShift === 'late' && scheduleNowMinutes < scheduleLateAbsentVisibleMinutes;
          const showAbsent = !hasPunch && (isPastOperationalDay || (isCurrentOperationalDay && !hideLateAbsent));
          const state: ScheduleDisplayState = getScheduleDisplayState(row, hasPunch, { showAbsent: Boolean(showAbsent) });
          if (state !== 'absent') continue;

          const existing = liveDatesByStaff.get(staff) ?? new Set<string>();
          existing.add(operationalDate);
          liveDatesByStaff.set(staff, existing);
        }
      }
    }

    const staffIds = new Set<string>([
      ...Object.keys(scheduleMonthlyAbsentDatesByStaffId),
      ...Array.from(liveDatesByStaff.keys())
    ]);
    for (const staff of staffIds) {
      if (scheduleOnlyStaffIds.has(staff)) continue;
      const merged = new Set(scheduleMonthlyAbsentDatesByStaffId[staff] ?? []);
      const liveDates = liveDatesByStaff.get(staff);
      if (liveDates) {
        for (const workDate of liveDates) merged.add(workDate);
      }
      nextMap[staff] = merged.size;
    }
    return nextMap;
  }, [
    page,
    employees,
    scheduleDays,
    scheduleMonthRange.startKey,
    scheduleMonthRange.endKey,
    scheduleMonthlyAbsentDatesByStaffId,
    scheduleIsCurrentWeek,
    schedulePunchPresenceReady,
    schedulePunchPresenceMatchesWeek,
    scheduleRowsByStaffDayIndex,
    schedulePunchPresenceKeys,
    scheduleOnlyStaffIds,
    employeeShiftByStaffId,
    homeOperationalDayIndex,
    scheduleNowMinutes,
    scheduleLateAbsentVisibleMinutes
  ]);
  const scheduleAutoMistakeByStaffId = useMemo(() => {
    const nextMap: Record<string, number> = {};
    if (page !== 'schedule' || !scheduleIsCurrentWeek || !schedulePunchPresenceReady || !schedulePunchPresenceMatchesWeek) return nextMap;
    for (const employee of scheduleEmployeesBase) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff || scheduleOnlyStaffIds.has(staff)) continue;
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
        const hasPunch = schedulePunchPresenceKeys.has(`${staff}__${dayIndex}`);
        const scheduledShiftForAbsent = employeeShiftByStaffId[staff]?.shift ?? '';
        const targetShift: 'early' | 'late' =
          scheduledShiftForAbsent === 'late'
            ? 'late'
            : (row?.shift as 'early' | 'late' | null) === 'late'
              ? 'late'
              : 'early';
        const isPastOperationalDay = dayIndex < homeOperationalDayIndex;
        const isCurrentOperationalDay = dayIndex === homeOperationalDayIndex;
        const hideLateAbsent = targetShift === 'late' && scheduleNowMinutes < scheduleLateAbsentVisibleMinutes;
        const showAbsent =
          row &&
          isWorkingScheduleBaseState(getScheduleBaseStateFromNote(row.note)) &&
          !hasPunch &&
          (isPastOperationalDay || (isCurrentOperationalDay && !hideLateAbsent));
        const state: ScheduleDisplayState = getScheduleDisplayState(row, hasPunch, { showAbsent: Boolean(showAbsent) });
        if (state === 'absent' || state === 'rest_worked') {
          nextMap[staff] = (nextMap[staff] ?? 0) + 1;
        }
      }
    }
    return nextMap;
  }, [
    page,
    scheduleIsCurrentWeek,
    schedulePunchPresenceMatchesWeek,
    schedulePunchPresenceReady,
    homeOperationalDayIndex,
    scheduleDays,
    serverTime,
    scheduleEmployeesBase,
    scheduleOnlyStaffIds,
    scheduleRowsByStaffDayIndex,
    schedulePunchPresenceKeys,
    employeeShiftByStaffId,
    scheduleNowMinutes,
    scheduleLateAbsentVisibleMinutes
  ]);
  const scheduleLateDisplayByStaffDayKey = useMemo(() => {
    const nextMap: Record<string, LateMarkView> = {};
    for (const [key, value] of Object.entries(scheduleLateByStaffDayKey)) {
      const staff = normalizeStaffId(String(key.split('__')[0] ?? '').trim());
      if (!staff || scheduleOnlyStaffIds.has(staff)) continue;
      nextMap[key] = value;
    }
    if (page !== 'schedule' || !scheduleIsCurrentWeek || !schedulePunchPresenceReady || !schedulePunchPresenceMatchesWeek) return nextMap;
    for (const employee of scheduleEmployeesBase) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff || scheduleOnlyStaffIds.has(staff)) continue;
      const shift = normalizeShiftValue(String(employee.shift ?? '').trim()) || 'early';
      const position = String(employee.position ?? employee.Position ?? '').trim();
      const shiftTime = normalizeShiftTimeValue((employee as any).shift_time ?? (employee as any).ShiftTime ?? '');
      if (!position) continue;
      if (shift === 'early' && normalizePositionKey(position) === 'Pick') continue;
      const plannedStartMinutes = parseClockTextToMinutes(resolveShiftStartTime(shift, position, shiftTime));
      if (!Number.isFinite(plannedStartMinutes)) continue;
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const dateKey = toDateOnly(scheduleDays[dayIndex] as Date);
        if (dateKey !== currentOperationalDate) continue;
        const staffDayKey = `${staff}__${dateKey}`;
        if (nextMap[staffDayKey]) continue;
        const firstInIso = scheduleFirstInByStaffDayKey[`${staff}__${dayIndex}`];
        if (!firstInIso) continue;
        const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
        if (row) {
          const state = getScheduleBaseStateFromNote(row.note);
          if (!isWorkingScheduleBaseState(state)) continue;
        }
        const firstIn = new Date(firstInIso);
        if (Number.isNaN(firstIn.getTime())) continue;
        const firstInMinutes = getClockMinutesFromDate(firstIn);
        const minutesLate = Math.max(0, Math.round(firstInMinutes - (plannedStartMinutes as number)));
        if (minutesLate <= LATE_GRACE_MINUTES) continue;
        nextMap[staffDayKey] = {
          minutesLate,
          source: 'planned',
          roundingFamily: shift === 'late' ? 'late_shift_points' : 'early_hour',
          learnedExpectedStartRaw: formatClockMinutes(plannedStartMinutes as number),
          learnedExpectedStartRounded: formatClockMinutes(plannedStartMinutes as number),
          guardrailExpectedStart: formatClockMinutes((plannedStartMinutes as number) + LATE_GUARDRAIL_BUFFER_MINUTES),
          finalExpectedStart: formatClockMinutes(plannedStartMinutes as number),
          firstIn: formatClockMinutes(firstInMinutes),
          sampleCount: 0
        };
      }
    }
    return nextMap;
  }, [
    page,
    scheduleLateByStaffDayKey,
    schedulePunchPresenceReady,
    schedulePunchPresenceMatchesWeek,
    scheduleEmployeesBase,
    scheduleOnlyStaffIds,
    scheduleFirstInByStaffDayKey,
    scheduleRowsByStaffDayIndex,
    scheduleDays
  ]);
  const scheduleLateCountByStaffId = useMemo(() => {
    const nextMap: Record<string, number> = {};
    for (const [key] of Object.entries(scheduleLateDisplayByStaffDayKey)) {
      const staff = String(key.split('__')[0] ?? '').trim();
      if (!staff) continue;
      nextMap[staff] = (nextMap[staff] ?? 0) + 1;
    }
    return nextMap;
  }, [scheduleLateDisplayByStaffDayKey]);
  const scheduleAutoMistakeDetailsByStaffId = useMemo(() => {
    const nextMap: Record<string, ScheduleMistakeDetail[]> = {};
    if (page !== 'schedule' || !scheduleIsCurrentWeek || !schedulePunchPresenceReady || !schedulePunchPresenceMatchesWeek) return nextMap;
    for (const employee of scheduleEmployeesBase) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff || scheduleOnlyStaffIds.has(staff)) continue;
      const details: ScheduleMistakeDetail[] = [];
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
        const hasPunch = schedulePunchPresenceKeys.has(`${staff}__${dayIndex}`);
        const scheduledShiftForAbsent = employeeShiftByStaffId[staff]?.shift ?? '';
        const targetShift: 'early' | 'late' =
          scheduledShiftForAbsent === 'late'
            ? 'late'
            : (row?.shift as 'early' | 'late' | null) === 'late'
              ? 'late'
              : 'early';
        const isPastOperationalDay = dayIndex < homeOperationalDayIndex;
        const isCurrentOperationalDay = dayIndex === homeOperationalDayIndex;
        const hideLateAbsent = targetShift === 'late' && scheduleNowMinutes < scheduleLateAbsentVisibleMinutes;
        const showAbsent =
          row &&
          isWorkingScheduleBaseState(getScheduleBaseStateFromNote(row.note)) &&
          !hasPunch &&
          (isPastOperationalDay || (isCurrentOperationalDay && !hideLateAbsent));
        const state: ScheduleDisplayState = getScheduleDisplayState(row, hasPunch, { showAbsent: Boolean(showAbsent) });
        if (state !== 'absent' && state !== 'rest_worked') continue;
        const operationalDate = toDateOnly(scheduleDays[dayIndex] ?? new Date(serverTime));
        const createdAt = new Date(`${operationalDate}T00:00:00`).toISOString();
        details.push({
          operational_date: operationalDate,
          position: String(row?.position ?? employee.position ?? employee.Position ?? '').trim() || '-',
          reason: state === 'absent' ? 'Absent' : 'Off Worked',
          reporter_staff_id: 'SYSTEM',
          created_at: createdAt
        });
      }
      if (details.length > 0) {
        nextMap[staff] = details;
      }
    }
    return nextMap;
  }, [
    page,
    scheduleIsCurrentWeek,
    schedulePunchPresenceMatchesWeek,
    schedulePunchPresenceReady,
    homeOperationalDayIndex,
    scheduleDays,
    serverTime,
    scheduleEmployeesBase,
    scheduleOnlyStaffIds,
    scheduleRowsByStaffDayIndex,
    schedulePunchPresenceKeys,
    employeeShiftByStaffId,
    scheduleNowMinutes,
    scheduleLateAbsentVisibleMinutes
  ]);

  if (!supabase) {
    return (
      <div className={['min-h-screen px-5 py-8', themeMode === 'light' ? 'admin-theme-light' : 'admin-theme-dark'].join(' ')}>
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <header className="glass rounded-3xl px-6 py-6 shadow-glow">
            <h1 className="font-display text-4xl tracking-[0.08em]">OBP Admin</h1>
            <p className="mt-2 text-sm text-ember">缺少 Supabase 配置，请检查 .env</p>
          </header>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        user ? 'min-h-screen text-paper transition-colors' : 'min-h-screen px-5 py-8 text-paper transition-colors',
        themeMode === 'light' ? 'admin-theme-light' : 'admin-theme-dark'
      ].join(' ')}
    >
      <div className="flex w-full flex-col gap-6">
        {!user ? (
          <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
            <AdminLoginPanel
              isLocked={isLocked}
              email={email}
              password={password}
              setEmail={setEmail}
              setPassword={setPassword}
              doLogin={doLogin}
              themeMode={themeMode}
              t={t}
            />
          </main>
        ) : (
          <div className="grid h-screen grid-rows-[64px_minmax(0,1fr)] overflow-hidden">
            <AdminHeader
              t={t}
              isLocked={isLocked}
              themeMode={themeMode}
              setThemeMode={setThemeMode}
              lang={lang}
              setLang={setLang}
              user={user}
              userDisplayName={userDisplayName}
              userAvatarUrl={userAvatarUrlInput || userAvatarUrl}
              profileDraftName={userDisplayNameInput}
              setProfileDraftName={setUserDisplayNameInput}
              profileSaving={userDisplayNameSaving}
              onProfileSave={saveUserDisplayName}
              onProfileAvatarPick={onProfileAvatarPick}
              attendanceError={attendanceError}
              onBack={handleBack}
              onLogout={doLogout}
            />

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <AdminNav
                page={page}
                isLocked={isLocked}
                themeMode={themeMode}
                onSetPage={handleNavSetPage}
                t={t}
                visiblePages={visibleAdminPages}
                leaveApprovalPendingCount={leaveApprovalPendingCount}
                scheduleTerminationPendingCount={scheduleTerminationPendingCount}
                todoPendingCount={todoPendingCount}
              />

              <main
                className={[
                  'flex-1 min-w-0',
                  themeMode === 'light'
                    ? 'min-h-0 overflow-auto bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.12),transparent_28%),linear-gradient(180deg,rgba(245,247,255,0.95),rgba(242,245,255,0.98))] text-slate-900'
                    : 'min-h-0 overflow-auto bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(139,92,246,0.12),transparent_26%),linear-gradient(180deg,rgba(7,10,16,0.98),rgba(10,14,22,0.98))] text-slate-100',
                  'px-0 py-0'
                ].join(' ')}
              >
                <div className="flex w-full flex-col gap-6">

            {page === 'home' && (
              <HomeDashboardPage
                t={t}
                themeMode={themeMode}
                homeCardStats={homeCardStats}
                homeExpectedPositionSummaryCards={homeExpectedPositionSummaryCards}
                getHomeCardToneClass={getHomeCardToneClass}
                getHomeChipToneClass={getHomeChipToneClass}
                getScheduleLabelToneClass={getScheduleLabelToneClass}
                getScheduleTableLabelBadgeClass={getScheduleTableLabelBadgeClass}
                getHomePanelToneClass={getHomePanelToneClass}
                getSchedulePositionBadgeClass={getSchedulePositionBadgeClass}
                getScheduleTablePositionBadgeClass={getScheduleTablePositionBadgeClass}
                getScheduleTableShiftBadgeClass={getScheduleTableShiftBadgeClass}
                schedulePositionToneByPosition={schedulePositionToneByPosition}
                homeRosterPositionFilter={homeRosterPositionFilter}
                setHomeRosterPositionFilter={setHomeRosterPositionFilter}
                onOpenTimecardCalibration={openTimecardPunchModalForDate}
                homeRosterRowsCurrent={homeRosterRowsCurrent}
              />
            )}
            {page === 'package_metrics' && (
              <PackageMetricsPage
                t={t}
                isLocked={isLocked}
                isReadOnly={!packageMetricsCanOperate}
                canViewConsumables={hasModuleAccess(adminModuleMap, 'consumables', 'view')}
                canOperateConsumables={consumablesCanOperate}
                supabase={supabase}
                themeMode={themeMode}
                serverTime={serverTime}
              />
            )}
            {page === 'devices' && (
              <DevicesPage
                t={t}
                isLocked={isLocked}
                isReadOnly={!devicesCanOperate}
                deviceRowsFiltered={deviceRowsFiltered}
                isAllFilteredDevicesSelected={isAllFilteredDevicesSelected}
                setDeviceSelectedLabelSns={setDeviceSelectedLabelSns}
                normalizeDeviceSn={normalizeDeviceSn}
                refreshDevicePanel={refreshDevicePanel}
                deviceSelectedLabelRows={deviceSelectedLabelRows}
                deviceLabelBatchPrinting={deviceLabelBatchPrinting}
                printDeviceLabelBatch={printDeviceLabelBatch}
                deviceFileInputRef={deviceFileInputRef}
                onDeviceFileSelected={onDeviceFileSelected}
                uploadDevices={uploadDevices}
                onDownloadDeviceTemplate={downloadDeviceTemplate}
                deviceUploadError={deviceUploadError}
                deviceSearch={deviceSearch}
                setDeviceSearch={setDeviceSearch}
                deviceFilterType={deviceFilterType}
                setDeviceFilterType={setDeviceFilterType}
                deviceFilterPosition={deviceFilterPosition}
                setDeviceFilterPosition={setDeviceFilterPosition}
                deviceBorrowedOnly={deviceBorrowedOnly}
                setDeviceBorrowedOnly={setDeviceBorrowedOnly}
                devicesError={devicesError}
                DEVICE_TYPES={availableDeviceTypes}
                ALLOWED_POSITIONS={ALLOWED_POSITIONS}
                normalizeDeviceType={normalizeDeviceType}
                deviceCurrentBorrowBySn={deviceCurrentBorrowBySn}
                selectedDeviceLabelSnSet={selectedDeviceLabelSnSet}
                deviceLastUserBySn={deviceLastUserBySn}
                serverTime={serverTime}
                parseDeviceCountedAtFromNote={parseDeviceCountedAtFromNote}
                deviceLastLoanAtBySn={deviceLastLoanAtBySn}
                DEVICE_COUNTING_STALE_MS={DEVICE_COUNTING_STALE_MS}
                deviceLabelPrintingSn={deviceLabelPrintingSn}
                printDeviceLabel={printDeviceLabel}
                toggleDeviceActive={toggleDeviceActive}
              />
            )}
            {page === 'forecast' && (
              <ForecastPage t={t} isLocked={forecastReadOnly} serverTime={serverTime} supabase={supabase} themeMode={themeMode} />
            )}
            {page === 'prediction_model' && (
              <PredictionModelPage t={t} isLocked={predictionModelReadOnly} themeMode={themeMode} serverTime={serverTime} supabase={supabase} />
            )}
            {page === 'efficiency' && <EfficiencyPage t={t} isLocked={efficiencyReadOnly} supabase={supabase} themeMode={themeMode} serverTime={serverTime} />}
            {page === 'leave_approval' && (
              <LeaveApprovalPage
                t={t}
                isLocked={isLocked}
                isReadOnly={!leaveApprovalCanOperate}
                supabase={supabase}
                themeMode={themeMode}
                serverTime={serverTime}
                userEmail={String(user?.email ?? '')}
                userDisplayName={String(userDisplayName ?? '')}
                onPendingCountChange={setLeaveApprovalPendingCount}
              />
            )}
            {page === 'work_hour_comparison' && (
              <WorkHourComparisonPage
                t={t}
                isLocked={isLocked}
                isReadOnly={!efficiencyCanOperate}
                supabase={supabase}
                themeMode={themeMode}
                serverTime={serverTime}
                userEmail={String(user?.email ?? '')}
                userDisplayName={String(userDisplayName ?? '')}
                onOpenTimecardCalibration={openTimecardPunchModalForDate}
              />
            )}
            {page === 'todo' && (
              <TodoPage
                t={t}
                isLocked={isLocked}
                isReadOnly={!todoCanOperate}
                supabase={supabase}
                themeMode={themeMode}
                userId={String(user?.id ?? '')}
                userEmail={String(user?.email ?? '')}
                userDisplayName={String(userDisplayName ?? '')}
                onPendingCountChange={setTodoPendingCount}
              />
            )}
            {page === 'punches' && (
              <PunchesPage
                t={t}
                lang={lang}
                locale={locale}
                isLocked={isLocked}
                punchesSearch={punchesSearch}
                setPunchesSearch={setPunchesSearch}
                fetchRecentPunches={fetchRecentPunches}
                recentPunchesError={recentPunchesError}
                recentPunches={recentPunches}
                employeeByStaffId={employeeByStaffId}
              />
            )}

            {page === 'audit' && (
              <AuditPage
                t={t}
                isLocked={isLocked}
                isReadOnly={!auditCanOperate}
                auditSearch={auditSearch}
                setAuditSearch={setAuditSearch}
                fetchAudit={fetchAudit}
                auditError={auditError}
                auditRows={auditRows}
                AUDIT_TABLE={AUDIT_TABLE}
                formatAuditDetail={formatAuditDetail}
                renderAuditSummary={renderAuditSummary}
                formatAuditActionLabel={formatAuditActionLabel}
                resolveAuditStaffName={resolveAuditStaffName}
                formatAuditCreatedAt={formatAuditCreatedAt}
                resolveAuditBusinessDate={resolveAuditBusinessDate}
                resolveAdminUserIdentity={resolveAdminUserIdentity}
                canUndoAuditRow={isUndoableAuditRow}
                isAuditRowUndone={isAuditRowUndone}
                undoAuditRow={undoAuditRow}
              />
            )}

                        {page === 'schedule' && (
              <section className="glass reveal rounded-3xl px-6 py-8">
                <ScheduleToolbar
                  t={t}
                  isLocked={isLocked}
                  isReadOnly={!scheduleCanOperate}
                  scheduleWeekOffset={scheduleWeekOffset}
                  changeScheduleWeek={changeScheduleWeek}
                  openScheduleDailyList={openScheduleDailyList}
                  schedulePrintDate={schedulePrintDate}
                  setSchedulePrintDate={setSchedulePrintDate}
                  scheduleEmployeesFilteredLength={scheduleEmployeesFiltered.length}
                  printScheduleSignInSheet={printScheduleSignInSheet}
                  exportScheduleTemplate={exportScheduleTemplate}
                  refreshSchedulePanelWithAudit={refreshSchedulePanelWithAudit}
                />

                <div className="mt-5 grid gap-4 md:grid-cols-12">
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('周', 'Week')}</label>
                    <input
                      type="date"
                      value={scheduleWeekInput}
                      disabled={isLocked}
                      onChange={(e) => setScheduleWeekInput(e.target.value)}
                      onBlur={() => {
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleWeekInput)) return;
                        const parsed = new Date(`${scheduleWeekInput}T00:00:00`);
                        if (Number.isNaN(parsed.getTime())) return;
                        const weekStart = startOfWeekMonday(parsed);
                        const baseWeekStart = startOfWeekMonday(serverTime);
                        const offset = Math.round((weekStart.getTime() - baseWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
                        changeScheduleWeek(offset, 'date_input');
                      }}
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('搜索', 'Search')}</label>
                    <input
                      value={scheduleSearchInput}
                      onChange={(e) => setScheduleSearchInput(e.target.value)}
                      disabled={isLocked}
                      placeholder={t('按工号 / 姓名搜索', 'Search by staff id / name')}
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('岗位', 'Position')}</label>
                    <details ref={schedulePositionDetailsRef} className="relative mt-2">
                      <summary
                        className={[
                          'flex h-12 cursor-pointer list-none items-center justify-between rounded-2xl border px-4 text-sm outline-none transition',
                          themeMode === 'light'
                            ? 'border-slate-300 bg-white text-slate-800 shadow-sm hover:border-slate-400'
                            : 'border-white/10 bg-black/30 text-white hover:border-white/20',
                          isLocked ? 'pointer-events-none cursor-not-allowed opacity-60' : ''
                        ].join(' ')}
                      >
                        <span className="truncate">{schedulePosition || t('全部岗位', 'All positions')}</span>
                        <span className="ml-3 text-xs text-slate-400">{schedulePosition ? 1 : 0}</span>
                      </summary>
                      <div
                        className={[
                          'absolute z-30 mt-2 w-full rounded-2xl border p-3',
                          themeMode === 'light'
                            ? 'border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]'
                            : 'border-slate-700 bg-slate-900 shadow-[0_18px_40px_rgba(0,0,0,0.45)]'
                        ].join(' ')}
                      >
                        <div className={['mb-2 flex items-center justify-between text-[11px]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-300'].join(' ')}>
                          <span>{t('单选', 'Single-select')}</span>
                          <button
                            type="button"
                            disabled={isLocked || !schedulePosition}
                            onClick={(e) => {
                              e.preventDefault();
                              setScheduleWorkDayFilter(null);
                              setSchedulePosition('');
                            }}
                            className={[
                              'rounded-md border px-2 py-1 transition disabled:cursor-not-allowed disabled:opacity-50',
                              themeMode === 'light'
                                ? 'border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50'
                                : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
                            ].join(' ')}
                          >
                            {t('清空', 'Clear')}
                          </button>
                        </div>
                        <div className="max-h-56 space-y-1 overflow-auto pr-1">
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setScheduleWorkDayFilter(null);
                              setSchedulePosition('');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setScheduleWorkDayFilter(null);
                                setSchedulePosition('');
                              }
                            }}
                            className={[
                              'flex cursor-pointer items-center justify-between rounded-lg border px-2 py-1.5 text-sm transition',
                              schedulePosition === ''
                                ? themeMode === 'light'
                                  ? 'border-emerald-700/50 bg-emerald-100 text-emerald-900'
                                  : 'border-neon/50 bg-neon/10 text-neon'
                                : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                            ].join(' ')}
                          >
                            <span className="inline-flex items-center rounded-full border border-white/20 px-2 py-0.5 text-xs font-semibold">
                              {t('全部岗位', 'All positions')}
                            </span>
                          </div>
                          {ALLOWED_POSITIONS.map((p) => (
                            <div
                              key={`pos-tone-${p}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setScheduleWorkDayFilter(null);
                                setSchedulePosition(p);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setScheduleWorkDayFilter(null);
                                  setSchedulePosition(p);
                                }
                              }}
                              className={[
                                'flex cursor-pointer items-center justify-between rounded-lg border px-2 py-1.5 text-sm transition',
                                schedulePosition === p
                                  ? themeMode === 'light'
                                    ? 'border-emerald-700/50 bg-emerald-100 text-emerald-900'
                                    : 'border-neon/50 bg-neon/10 text-neon'
                                  : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                              ].join(' ')}
                            >
                              <span
                                className={[
                                  'inline-flex max-w-[65%] items-center truncate rounded-full border px-2 py-0.5 text-xs font-semibold',
                                  getSchedulePositionBadgeClass(p)
                                ].join(' ')}
                              >
                                {p}
                              </span>
                              <div className="ml-2 flex items-center">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    cycleSchedulePositionTone(p);
                                  }}
                                  title={t('点击切换岗位颜色', 'Click to cycle position color')}
                                  className={[
                                    'rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition',
                                    getSchedulePositionBadgeClass(p),
                                    isLocked ? 'cursor-not-allowed opacity-60' : 'hover:brightness-110'
                                  ].join(' ')}
                                >
                                  {t('颜色', 'Color')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </details>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">FT/PT</label>
                    <select
                      value={scheduleEmploymentType}
                      onChange={(e) => setScheduleEmploymentType(((e.target.value as '' | EmploymentType) ?? ''))}
                      disabled={isLocked}
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{t('全部类型', 'All types')}</option>
                      <option value="FT">FT</option>
                      <option value="PT">PT</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('班次', 'Shift')}</label>
                    <select
                      value={scheduleShift}
                      onChange={(e) => setScheduleShift((e.target.value as any) ?? '')}
                      disabled={isLocked}
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{t('全部班次', 'All shifts')}</option>
                      <option value="early">{t('早班', 'Morning')}</option>
                      <option value="late">{t('晚班', 'Night')}</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('标签', 'Label')}</label>
                    <details ref={scheduleLabelDetailsRef} className="relative mt-2">
                      <summary
                        className={[
                          'flex h-12 cursor-pointer list-none items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition',
                          'hover:border-white/20',
                          isLocked ? 'pointer-events-none cursor-not-allowed opacity-60' : ''
                        ].join(' ')}
                      >
                        <span className="truncate">
                          {scheduleLabels.length === 0
                            ? t('选择标签', 'Select labels')
                            : scheduleLabels.length <= 2
                              ? scheduleLabels.join(', ')
                              : `${scheduleLabels.slice(0, 2).join(', ')} +${scheduleLabels.length - 2}`}
                        </span>
                        <span className={['ml-3 text-xs', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{scheduleLabels.length}</span>
                      </summary>
                      <div
                        className={[
                          'absolute z-30 mt-2 w-full rounded-2xl border p-3',
                          themeMode === 'light'
                            ? 'border-slate-200 bg-[#fffdf8] shadow-[0_18px_40px_rgba(15,23,42,0.14)]'
                            : 'border-slate-700 bg-slate-900 shadow-[0_18px_40px_rgba(0,0,0,0.45)]'
                        ].join(' ')}
                      >
                        <div className={['mb-2 flex items-center justify-between text-[11px]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-300'].join(' ')}>
                          <span>{t('可多选', 'Multi-select')}</span>
                          <button
                            type="button"
                            disabled={isLocked || scheduleLabels.length === 0}
                            onClick={(e) => {
                              e.preventDefault();
                              setScheduleLabels([]);
                            }}
                            className={[
                              'min-w-[52px] rounded-md border px-2 py-1 text-[12px] font-medium leading-none transition disabled:cursor-not-allowed disabled:opacity-50',
                              themeMode === 'light'
                                ? 'border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50'
                                : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
                            ].join(' ')}
                          >
                            {t('清空', 'Clear')}
                          </button>
                        </div>
                        <div className="max-h-56 space-y-1 overflow-auto pr-1">
                          {scheduleLabelOptions.length === 0 ? (
                            <p
                              className={[
                                'rounded-lg border px-2 py-2 text-xs',
                                themeMode === 'light' ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-700 bg-slate-800 text-slate-300'
                              ].join(' ')}
                            >
                              {t('暂无标签', 'No labels')}
                            </p>
                          ) : (
                            scheduleLabelOptions.map((item) => {
                              const checked = scheduleLabels.includes(item);
                              return (
                                <div
                                  key={item}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() =>
                                    setScheduleLabels((prev) =>
                                      prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]
                                    )
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                    e.preventDefault();
                                    setScheduleLabels((prev) =>
                                      prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]
                                    );
                                  }}
                                  className={[
                                    'flex cursor-pointer items-center justify-between rounded-lg border px-2 py-1.5 text-sm transition',
                                    checked
                                      ? themeMode === 'light'
                                        ? 'border-lime-300 bg-lime-50 text-lime-900'
                                        : 'border-lime-400/60 bg-lime-400/12 text-lime-200'
                                      : themeMode === 'light'
                                        ? 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
                                        : 'border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700'
                                  ].join(' ')}
                                >
                                  <span
                                    className={[
                                      'inline-flex max-w-[65%] items-center truncate rounded-full border px-2 py-0.5 text-xs font-semibold',
                                      getScheduleLabelToneClass(item)
                                    ].join(' ')}
                                  >
                                    {item}
                                  </span>
                                  <div className="ml-2 flex items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={isLocked}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        cycleScheduleLabelTone(item);
                                      }}
                                      className={['rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', getScheduleLabelToneClass(item)].join(' ')}
                                      title={t('切换标签颜色', 'Cycle label color')}
                                    >
                                      {t('颜色', 'Color')}
                                    </button>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={() =>
                                        setScheduleLabels((prev) =>
                                          prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]
                                        )
                                      }
                                      className="sr-only"
                                    />
                                    <span
                                      aria-hidden="true"
                                      className={[
                                        'flex h-[18px] w-[18px] items-center justify-center rounded-md border transition',
                                        checked
                                          ? themeMode === 'light'
                                            ? 'border-lime-500 bg-lime-500 text-white shadow-[0_0_0_1px_rgba(132,204,22,0.18)]'
                                            : 'border-lime-400 bg-lime-400 text-slate-950 shadow-[0_0_0_1px_rgba(163,230,53,0.28)]'
                                          : themeMode === 'light'
                                            ? 'border-slate-300 bg-white text-transparent'
                                            : 'border-slate-500 bg-slate-900 text-transparent'
                                      ].join(' ')}
                                    >
                                      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                                      </svg>
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </details>
                  </div>
                </div>

                {scheduleWorkDayFilter !== null && (
                  <div className="mt-4 text-xs text-slate-400">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setScheduleWorkDayFilter(null)}
                      className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('日期筛选', 'Day filter')}: {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][scheduleWorkDayFilter]} ({t('清空', 'Clear')})
                    </button>
                  </div>
                )}

                {scheduleError && <p className="mt-3 text-sm text-ember">{t('加载失败', 'Load failed')}: {scheduleError}</p>}
                {!scheduleError && scheduleEmployeesFiltered.length === 0 && (
                  <p className="mt-3 text-sm text-slate-400">{t('未找到员工。', 'No employees found.')}</p>
                )}

                {!scheduleError && scheduleEmployeesFiltered.length > 0 && (
                  <div
                    ref={scheduleTableScrollRef}
                    className="mt-4 min-h-[320px] max-h-[68vh] overflow-x-hidden overflow-y-auto rounded-2xl border border-white/10 bg-black/30 pr-3 pb-2"
                  >
                    <table className="w-full table-fixed text-left text-xs leading-tight">
                      <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-[10px] uppercase tracking-[0.16em] text-slate-400 backdrop-blur">
                        <tr>
                          <th className="sticky top-0 z-20 w-[88px] bg-slate-950/95 pl-4 pr-1 py-2 backdrop-blur">{t('工号', 'ID')}</th>
                          <th className="sticky top-0 z-20 w-[124px] bg-slate-950/95 px-1 py-2 backdrop-blur">{t('姓名', 'Name')}</th>
                          <th className="sticky top-0 z-20 w-[74px] bg-slate-950/95 px-1.5 py-2 text-center backdrop-blur">{t('工作天数', 'Work Days')}</th>
                          <th className="sticky top-0 z-20 w-[82px] bg-slate-950/95 px-1 py-2 backdrop-blur">{t('中介', 'Agency')}</th>
                          <th className="sticky top-0 z-20 w-[74px] bg-slate-950/95 px-1 py-2 backdrop-blur">{t('岗位', 'Position')}</th>
                          <th className="sticky top-0 z-20 w-[88px] bg-slate-950/95 px-1 py-2 backdrop-blur">{t('标签', 'Label')}</th>
                          <th className="sticky top-0 z-20 w-[64px] bg-slate-950/95 px-1 py-2 text-center backdrop-blur">{t('班次', 'Shift')}</th>
                          <th className="sticky top-0 z-20 w-[56px] bg-slate-950/95 px-1 py-2 text-center backdrop-blur">
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={() => setScheduleSortByUphDesc((v) => !v)}
                              className={[
                                'rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition',
                                scheduleSortByUphDesc ? 'bg-neon/20 text-neon' : 'text-slate-300 hover:bg-white/10',
                                isLocked ? 'cursor-not-allowed opacity-60' : ''
                              ].join(' ')}
                              title={scheduleSortByUphDesc ? 'Sorted by UPH (high to low)' : 'Sort by UPH (high to low)'}
                            >
                              UPH{scheduleSortByUphDesc ? ' ↓' : ''}
                            </button>
                          </th>
                          <th
                            className="sticky top-0 z-20 w-[64px] bg-slate-950/95 px-1 py-2 text-center backdrop-blur"
                            title={t(`${scheduleMonthLabel} 累计缺勤`, `Absent in ${scheduleMonthLabel}`)}
                          >
                            {t('月缺勤', 'Abs MTD')}
                          </th>
                          <th className="sticky top-0 z-20 w-[58px] bg-slate-950/95 px-1 py-2 text-center backdrop-blur">
                            Late
                          </th>
                          <th className="sticky top-0 z-20 w-[58px] bg-slate-950/95 px-1 py-2 text-center backdrop-blur">
                            Mistake
                          </th>
                          {scheduleDays.map((day, idx) => (
                            <th key={toDateOnly(day)} className="sticky top-0 z-20 w-[72px] bg-slate-950/95 px-0.5 py-2 text-center backdrop-blur">
                              <div className="flex flex-col items-center leading-tight">
                                <span className="text-[10px] font-semibold text-emerald-300">
                                  {(() => {
                                    const recommended = scheduleRecommendedTotalsByDate[toDateOnly(day)];
                                    return recommended === null || recommended === undefined
                                      ? t('推 -', 'Rec -')
                                      : lang === 'en'
                                        ? `Rec ${recommended}`
                                        : `推 ${recommended}`;
                                  })()}
                                </span>
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={() => setScheduleWorkDayFilter((prev) => (prev === idx ? null : idx))}
                                  className={[
                                    'mt-1 rounded-md px-1 py-0.5 text-[10px] font-semibold transition',
                                    scheduleWorkDayFilter === idx
                                      ? 'bg-neon/20 text-neon'
                                      : 'text-neon hover:bg-white/10',
                                    isLocked ? 'cursor-not-allowed opacity-60' : ''
                                  ].join(' ')}
                                  title="Filter employees working this day"
                                >
                                  {lang === 'en' ? `Work ${scheduleWorkingCountByDayIndex[idx]}` : `工作 ${scheduleWorkingCountByDayIndex[idx]}人`}
                                </button>
                                <span className="mt-1">{`${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx]} ${toDateOnly(day).slice(5)}`}</span>
                              </div>
                            </th>
                          ))}
                          <th className="sticky top-0 z-20 w-[52px] bg-slate-950/95 px-0.5 py-2 text-center backdrop-blur">
                            {t('离职', 'Depart')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleEmployeesRendered.map((employee) => {
                          const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
                          const name = String(employee.name ?? '').trim();
                          const agency = String(employee.agency ?? employee.Agency ?? '').trim();
                          const attendanceTrackingDisabled = scheduleOnlyStaffIds.has(staff);
                          const position = String(employee.position ?? employee.Position ?? '').trim();
                          const label = String(employee.label ?? employee.Label ?? '').trim();
                          const pendingTerminationRequest = pendingTerminationRequestsByStaffId.get(staff) ?? null;
                          const hasPendingTermination = Boolean(pendingTerminationRequest);
                          if (!staff) return null;

                          let workDays = 0;
                          for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
                            const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
                            if (!row) continue;
                            if (isWorkingScheduleRow(row)) workDays += 1;
                          }
                          let restWorkedBonusDays = 0;
                          if (!attendanceTrackingDisabled) {
                            for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
                              const key = `${staff}__${dayIndex}`;
                              const row = scheduleRowsByStaffDayIndex.get(key);
                              const hasPunch = schedulePunchPresenceKeys.has(key);
                              if (!hasPunch) continue;
                              if (!row) {
                                // 无排班但有打卡，显示为“排休出勤”，计 +1
                                restWorkedBonusDays += 1;
                                continue;
                              }
                              const isRestLike = isRestLikeScheduleBaseState(getScheduleBaseStateFromNote(row.note));
                              if (isRestLike) restWorkedBonusDays += 1;
                            }
                          }
                          let absentPenaltyDays = 0;
                          if (!attendanceTrackingDisabled) {
                            for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
                              const key = `${staff}__${dayIndex}`;
                              const row = scheduleRowsByStaffDayIndex.get(key);
                              if (!row || !isWorkingScheduleRow(row)) continue;
                              const hasPunch = schedulePunchPresenceKeys.has(key);
                              const scheduledShiftForAbsent = employeeShiftByStaffId[staff]?.shift ?? '';
                              const targetShift: 'early' | 'late' =
                                scheduledShiftForAbsent === 'late'
                                  ? 'late'
                                  : (row?.shift as 'early' | 'late' | null) === 'late'
                                    ? 'late'
                                    : 'early';
                              const isPastOperationalDay = dayIndex < homeOperationalDayIndex;
                              const isCurrentOperationalDay = dayIndex === homeOperationalDayIndex;
                              const hideLateAbsent = targetShift === 'late' && scheduleNowMinutes < scheduleLateAbsentVisibleMinutes;
                              const showAbsent =
                                schedulePunchPresenceReady &&
                                schedulePunchPresenceMatchesWeek &&
                                scheduleIsCurrentWeek &&
                                !hasPunch &&
                                (isPastOperationalDay || (isCurrentOperationalDay && !hideLateAbsent));
                              if (showAbsent) absentPenaltyDays += 1;
                            }
                          }
                          const effectiveWorkDays = workDays + restWorkedBonusDays - absentPenaltyDays;
                          const scheduleRowClass = hasPendingTermination
                            ? themeMode === 'light'
                              ? 'border-b border-slate-300 bg-slate-200/85 text-slate-700 transition-colors hover:bg-slate-200 last:border-0'
                              : 'border-b border-white/5 bg-slate-800/70 text-slate-200 transition-colors hover:bg-slate-800 last:border-0'
                            : 'border-b border-white/5 transition-colors hover:bg-white/[0.04] last:border-0';
                          const scheduleBodyTextClass = hasPendingTermination
                            ? themeMode === 'light'
                              ? 'text-slate-700'
                              : 'text-slate-300'
                            : 'text-slate-200';

                          return (
                            <tr className={scheduleRowClass} key={staff}>
                              <td className={['pl-4 pr-1 py-2 font-mono', scheduleBodyTextClass].join(' ')}>{staff}</td>
                              <td className={['px-1 py-2 truncate', scheduleBodyTextClass].join(' ')}>
                                <div>{name || '-'}</div>
                                {hasPendingTermination && (
                                  <div
                                    className={[
                                      'mt-1 text-[10px]',
                                      themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'
                                    ].join(' ')}
                                    title={pendingTerminationRequest?.reason || undefined}
                                  >
                                    {t('待审批离职', 'Pending departure')}
                                  </div>
                                )}
                              </td>
                              <td className="px-1.5 py-2 text-center">
                                <span className={getScheduleWorkDaysBadgeClass(effectiveWorkDays)}>
                                  {effectiveWorkDays}
                                </span>
                              </td>
                              <td className={['px-1 py-2 truncate', scheduleBodyTextClass].join(' ')}>{agency || '-'}</td>
                              <td className={['px-1 py-2', scheduleBodyTextClass].join(' ')}>
                                <span className={getScheduleTablePositionBadgeClass(position)}>
                                  {position || '-'}
                                </span>
                              </td>
                              <td className={['px-1 py-2', scheduleBodyTextClass].join(' ')}>
                                {label ? (
                                  <span
                                    className={getScheduleTableLabelBadgeClass(label)}
                                  >
                                    <span className="truncate">{label}</span>
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td className={['px-1 py-2 text-center', scheduleBodyTextClass].join(' ')}>
                                {(() => {
                                  const dbShift = normalizeShiftValue(String(employee.shift ?? '').trim());
                                  const shift = dbShift || '';
                                  const shiftLabel = shift === 'early' ? t('早班', 'Morning') : shift === 'late' ? t('晚班', 'Night') : '-';
                                  return <span className={getScheduleTableShiftBadgeClass(shift)}>{shiftLabel}</span>;
                                })()}
                              </td>
                              <td className={['px-1 py-2 text-center font-mono', scheduleBodyTextClass].join(' ')}>{formatUph(scheduleUphByStaffId[staff])}</td>
                              <td className="px-1 py-2 text-center">
                                {(() => {
                                  const count = Number(scheduleMonthlyAbsentByStaffId[staff] ?? 0);
                                  const toneClass =
                                    count <= 0
                                      ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                                      : count <= 2
                                        ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                                        : 'border-rose-400/60 bg-rose-500/15 text-rose-200';
                                  return (
                                    <span
                                      className={[
                                        'inline-flex min-w-[38px] items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                                        toneClass
                                      ].join(' ')}
                                      title={t(`${scheduleMonthLabel} 累计缺勤`, `Absent in ${scheduleMonthLabel}`)}
                                    >
                                      {count}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-1 py-2 text-center">
                                {(() => {
                                  const count = Number(scheduleLateCountByStaffId[staff] ?? 0);
                                  const toneClass =
                                    count <= 0
                                      ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                                      : count <= 2
                                        ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                                        : 'border-rose-400/60 bg-rose-500/15 text-rose-200';
                                  return (
                                    <span
                                      className={[
                                        'inline-flex min-w-[38px] items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                                        toneClass
                                      ].join(' ')}
                                      title={t('本周迟到次数', 'Late count this week')}
                                    >
                                      {count}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-1 py-2 text-center">
                                {(() => {
                                  const manualCount = Number(scheduleMistakeByStaffId[staff] ?? 0);
                                  const autoCount = Number(scheduleAutoMistakeByStaffId[staff] ?? 0);
                                  const count = manualCount + autoCount;
                                  const details = [
                                    ...(scheduleAutoMistakeDetailsByStaffId[staff] ?? []),
                                    ...(scheduleMistakeDetailsByStaffId[staff] ?? [])
                                  ];
                                  const toneClass =
                                    count <= 0
                                      ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                                      : count <= 2
                                        ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                                        : 'border-rose-400/60 bg-rose-500/15 text-rose-200';
                                  return (
                                    <div className="group relative inline-flex">
                                      <button
                                        type="button"
                                        disabled={isLocked}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openScheduleMistakeCreate(employee);
                                        }}
                                        className={[
                                          'inline-flex min-w-[38px] items-center justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition hover:brightness-110 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.18)] disabled:cursor-not-allowed disabled:opacity-60',
                                          toneClass
                                        ].join(' ')}
                                        title="Add mistake for this employee"
                                      >
                                        {count}
                                      </button>
                                      <div className="pointer-events-none absolute left-1/2 top-full z-20 h-2 w-[420px] -translate-x-1/2" />
                                      <div className="pointer-events-auto invisible absolute left-1/2 top-full z-30 mt-1 w-[420px] -translate-x-1/2 overflow-hidden rounded-xl border border-white/15 bg-slate-950/95 text-left opacity-0 shadow-2xl backdrop-blur transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                                        <div className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold tracking-[0.12em] text-slate-300">
                                          Mistake details (last 7 days)
                                        </div>
                                        {details.length > 0 ? (
                                          <div className="max-h-72 overflow-y-auto overscroll-contain">
                                            {details.map((item, idx) => (
                                              <div key={`${item.created_at}_${idx}`} className="border-b border-white/5 px-3 py-2 last:border-b-0">
                                                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                                                  {(() => {
                                                    const reporterRaw = String(item.reporter_staff_id ?? '').trim();
                                                    const reporterStaff = normalizeStaffId(reporterRaw);
                                                    const reporterName = reporterStaff ? (employeeNameByStaffId.get(reporterStaff) ?? '') : '';
                                                    const reporterDisplay = reporterName
                                                      ? `${reporterName} (${reporterStaff || '-'})`
                                                      : reporterStaff || reporterRaw || '-';
                                                    return (
                                                      <>
                                                        <span>{item.operational_date || '-'}</span>
                                                        <span>{item.position || '-'}</span>
                                                        <span>Reporter: {reporterDisplay}</span>
                                                      </>
                                                    );
                                                  })()}
                                                </div>
                                                <div className="mt-1 whitespace-pre-wrap break-words text-[12px] text-slate-100">
                                                  {item.reason || '-'}
                                                </div>
                                                <div className="mt-1 text-[10px] text-slate-500">
                                                  {item.created_at ? formatTime(new Date(item.created_at), locale) : '-'}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="px-3 py-3 text-xs text-slate-400">No mistake reports in last 7 days.</div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </td>
                              {scheduleDays.map((_, dayIndex) => {
                                const key = `${staff}__${dayIndex}`;
                                const row = scheduleRowsByStaffDayIndex.get(key);
                                const hasPunch = attendanceTrackingDisabled ? false : schedulePunchPresenceKeys.has(key);
                                const scheduledShiftForAbsent = employeeShiftByStaffId[staff]?.shift ?? '';
                                const targetShift: 'early' | 'late' = scheduledShiftForAbsent === 'late' ? 'late' : 'early';
                                const isPastOperationalDay = dayIndex < homeOperationalDayIndex;
                                const isCurrentOperationalDay = dayIndex === homeOperationalDayIndex;
                                const hideLateAbsent =
                                  scheduledShiftForAbsent === 'late' && scheduleNowMinutes < scheduleLateAbsentVisibleMinutes;
                                const showAbsent =
                                  !attendanceTrackingDisabled &&
                                  schedulePunchPresenceReady &&
                                  schedulePunchPresenceMatchesWeek &&
                                  scheduleIsCurrentWeek &&
                                  row &&
                                  isWorkingScheduleBaseState(getScheduleBaseStateFromNote(row.note)) &&
                                  !hasPunch &&
                                  (isPastOperationalDay || (isCurrentOperationalDay && !hideLateAbsent));
                                const state: ScheduleDisplayState = getScheduleDisplayState(row, hasPunch, { showAbsent });
                                const isImplicitNew =
                                  state === 'work' &&
                                  row &&
                                  !String(row.note ?? '').trim() &&
                                  isNewHirePlaceholderStaffId(staff) &&
                                  isNewHirePlaceholderName(String(employee.name ?? '').trim()) &&
                                  isNewHireFirstWorkDate(staff, scheduleDays[dayIndex] as Date);
                                const displayState: ScheduleDisplayState = isImplicitNew ? 'new' : state;
                                const scheduleAuditKey = `${staff}__${getTemplateDateByDayIndex(dayIndex, scheduleWeekOffset)}`;
                                const scheduleCellAudit = scheduleAuditByStaffDate.get(scheduleAuditKey) ?? [];
                                const lateInfo = attendanceTrackingDisabled
                                  ? undefined
                                  : scheduleLateDisplayByStaffDayKey[`${staff}__${toDateOnly(scheduleDays[dayIndex] as Date)}`];
                                const lateTitle = lateInfo ? `${t('迟到', 'Late')} ${lateInfo.minutesLate}${t('分钟', 'm')}` : '';

                                return (
                                  <td key={key} className="px-0.5 py-1.5 align-middle">
                                    <div className="group relative flex items-center justify-center">
                                      <span className="relative inline-flex">
                                        <button
                                          type="button"
                                          data-schedule-trigger="true"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                            openScheduleStatePicker(
                                              key,
                                              employee,
                                              dayIndex,
                                              toDateOnly(scheduleDays[dayIndex] as Date),
                                              targetShift,
                                              displayState,
                                              rect
                                            );
                                          }}
                                          className={[
                                            getScheduleStateButtonClass(displayState)
                                          ].join(' ')}
                                          title={lateTitle || undefined}
                                        >
                                          {displayState === 'work'
                                            ? t('工作', 'Work')
                                            : displayState === 'new'
                                              ? t('新人', 'NEW')
                                            : displayState === 'fixed_work'
                                              ? t('固定排班', 'Fixed Shift')
                                            : displayState === 'temp_work'
                                              ? t('临时工作', 'Tem Work')
                                            : displayState === 'planned_temp_work'
                                              ? t('替补', 'Replacement')
                                            : displayState === 'leave'
                                              ? t('请假', 'Excuse')
                                            : displayState === 'planned_leave'
                                              ? t('计划请假', 'Planned Leave')
                                            : displayState === 'rest_worked'
                                              ? t('排休出勤', 'Off Worked')
                                            : displayState === 'absent'
                                              ? t('缺勤', 'Absent')
                                            : displayState === 'temp_rest'
                                                ? t('临时排休', 'Tem Off')
                                              : displayState === 'planned_temp_rest'
                                                ? t('计划临时排休', 'Planned Tem Off')
                                              : t('休息', 'Off')}
                                        </button>
                                        {lateInfo && (
                                          <span
                                            className={[
                                              'pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2',
                                              themeMode === 'light' ? 'border-white' : 'border-slate-950',
                                              scheduleLateDotClass
                                            ].join(' ')}
                                          />
                                        )}
                                        {scheduleCellAudit.length > 0 && (
                                          <span
                                            className={[
                                              'pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2',
                                              themeMode === 'light' ? 'border-white' : 'border-slate-950',
                                              getScheduleAuditDotClass(displayState)
                                            ].join(' ')}
                                          />
                                        )}
                                      </span>
                                      {scheduleCellAudit.length > 0 && (
                                        <div
                                          className={[
                                            'pointer-events-none invisible absolute right-0 top-full z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border p-2 text-[11px] opacity-0 transition group-hover:visible group-hover:opacity-100',
                                            themeMode === 'light'
                                              ? 'border-slate-200 bg-white text-slate-900 shadow-[0_18px_40px_rgba(55,65,81,0.16)]'
                                              : 'border-slate-700 bg-[#16181c] text-slate-100 shadow-[0_18px_40px_rgba(0,0,0,0.45)]'
                                          ].join(' ')}
                                        >
                                          <div className={['mb-1 text-[10px] uppercase tracking-[0.14em]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                                            {t('最近操作', 'Recent changes')}
                                          </div>
                                          <div className="space-y-1">
                                            {scheduleCellAudit.slice(0, 3).map((item) => {
                                              const detail = formatAuditDetail(item);
                                              const actorIdentity = resolveAdminUserIdentity({
                                                actor: (item as any).actor_raw ?? (item as any).actor,
                                                displayName: normalizeAuditActor((item as any).actor_raw ?? (item as any).actor)
                                              });
                                              return (
                                                <div
                                                  key={String(item.id ?? `${item.created_at ?? ''}_${item.action ?? ''}`)}
                                                  className={['rounded-md px-1.5 py-1', themeMode === 'light' ? 'bg-slate-100' : 'bg-slate-800'].join(' ')}
                                                >
                                                  <div className="flex items-center gap-2">
                                                    <AdminUserAvatar
                                                      name={actorIdentity.displayName}
                                                      avatarUrl={actorIdentity.avatarUrl}
                                                      fallbackInitial={actorIdentity.fallbackInitial}
                                                      size={20}
                                                      className={themeMode === 'light' ? 'border-slate-200 bg-slate-200 text-slate-700' : 'border-white/10 bg-slate-700 text-slate-100'}
                                                    />
                                                    <div className="min-w-0">
                                                      <div className={['truncate text-[10px] font-medium', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>
                                                        {actorIdentity.displayName || '-'}
                                                      </div>
                                                      <div className={['text-[10px]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                                                        {formatCellAuditTime(item.created_at)}
                                                      </div>
                                                    </div>
                                                  </div>
                                                  <div className={themeMode === 'light' ? 'text-slate-800' : 'text-slate-100'}>{renderAuditSummary(detail.summary)}</div>
                                                  {detail.details.slice(0, 2).map((d, idx2) => (
                                                    <div
                                                      key={`${String(item.id ?? 'row')}_${d.label}_${idx2}`}
                                                      className={['mt-0.5 text-[10px]', themeMode === 'light' ? 'text-slate-600' : 'text-slate-300'].join(' ')}
                                                    >
                                                      <span className={themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'}>{d.label}: </span>
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
                                  </td>
                                );
                              })}
                              <td className="px-0.5 py-1.5 text-center">
                                {hasPendingTermination ? (
                                  <div className="flex flex-col items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={isLocked || !scheduleCanReviewTermination}
                                      title={pendingTerminationRequest?.reason || undefined}
                                      onClick={() => {
                                        if (!pendingTerminationRequest) return;
                                        void reviewTerminationRequest(pendingTerminationRequest, 'approve');
                                      }}
                                      className="rounded-md bg-ember px-1.5 py-1 text-[9px] font-semibold leading-none text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {t('确认离职', 'Confirm')}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isLocked || !scheduleCanReviewTermination}
                                      onClick={() => {
                                        if (!pendingTerminationRequest) return;
                                        void reviewTerminationRequest(pendingTerminationRequest, 'reject');
                                      }}
                                      className="rounded-md bg-white/10 px-1.5 py-1 text-[9px] font-semibold leading-none text-slate-100 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {t('拒绝', 'Reject')}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isLocked}
                                    onClick={() => {
                                      void deleteEmployeeRow(staff);
                                    }}
                                    className="rounded-md bg-ember px-1.5 py-1 text-[9px] font-semibold leading-none text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {t('离职', 'Depart')}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {schedulePicker.open &&
                  schedulePicker.employee &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div
                      data-schedule-popover="true"
                      className={[
                        'fixed z-[80] w-44 -translate-x-1/2 rounded-xl p-1.5 shadow-2xl backdrop-blur',
                        themeMode === 'light'
                          ? 'border border-slate-300 bg-white/95 shadow-[0_18px_40px_rgba(15,23,42,0.18)]'
                          : 'border border-white/10 bg-slate-950/95'
                      ].join(' ')}
                      style={{ '--picker-left': `${schedulePicker.anchorLeft}px`, '--picker-top': `${schedulePicker.anchorTop}px`, left: 'var(--picker-left)', top: 'var(--picker-top)' } as React.CSSProperties}
                    >
                      {schedulePickerVisibleOptions.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            void setScheduleCellState(
                              schedulePicker.employee as EmployeeRow,
                              schedulePicker.dayIndex,
                              item.key,
                              schedulePicker.targetShift,
                              schedulePicker.workDate
                            );
                            setSchedulePicker((prev) => ({ ...prev, open: false, employee: null, cellKey: '' }));
                          }}
                          className={[
                            'mb-1 flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-[11px] font-semibold transition last:mb-0 hover:-translate-y-px',
                            getScheduleStateButtonClass(item.key),
                            item.mode !== 'all' && item.mode !== schedulePickerMode ? 'opacity-60' : '',
                            schedulePicker.currentState === item.key
                              ? themeMode === 'light'
                                ? 'ring-2 ring-slate-900/20'
                                : 'ring-2 ring-white/20'
                              : ''
                          ].join(' ')}
                        >
                          <span>{t(item.labelZh, item.labelEn)}</span>
                          {schedulePicker.currentState === item.key ? (
                            <span className={['rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em]', schedulePickerMetaClass].join(' ')}>
                              Now
                            </span>
                          ) : item.mode !== 'all' && item.mode === schedulePickerMode ? (
                            <span className={['rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em]', schedulePickerMetaClass].join(' ')}>
                              {t('推', 'Rec')}
                            </span>
                          ) : null}
                        </button>
                      ))}
                      {schedulePickerSecondaryOptions.length > 0 && !schedulePickerShowMore && (
                        <button
                          type="button"
                          onClick={() => setSchedulePickerShowMore(true)}
                          className={[
                            'mt-1 flex w-full items-center justify-center rounded-[10px] border px-2.5 py-2 text-[11px] font-semibold transition hover:-translate-y-px',
                            themeMode === 'light'
                              ? 'border-slate-200 bg-slate-50 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_4px_10px_rgba(148,163,184,0.08)]'
                              : 'border-white/10 bg-white/[0.04] text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_18px_rgba(15,23,42,0.12)]'
                          ].join(' ')}
                        >
                          {t('更多状态', 'More states')}
                        </button>
                      )}
                    </div>,
                    document.body
                  )}

                {dailyListOpen &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div
                      className={[
                        'fixed inset-0 z-50 flex items-center justify-center p-4',
                        themeMode === 'light' ? 'bg-slate-900/35' : 'bg-black/70'
                      ].join(' ')}
                      role="dialog"
                      aria-modal="true"
                    >
                      <div
                        className={[
                          'flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl shadow-2xl',
                          themeMode === 'light'
                            ? 'border border-slate-200 bg-white'
                            : 'border border-white/10 bg-slate-950/95 backdrop-blur'
                        ].join(' ')}
                      >
                        <div
                          className={[
                            'flex flex-wrap items-start justify-between gap-3 px-6 py-5',
                            themeMode === 'light' ? 'border-b border-slate-200' : 'border-b border-white/10'
                          ].join(' ')}
                        >
                          <div>
                            <h3 className={['font-display text-2xl tracking-[0.08em]', themeMode === 'light' ? 'text-slate-900' : 'text-white'].join(' ')}>
                              {t('明日名单', 'Tomorrow list')}
                            </h3>
                            <div className="mt-2 w-fit">
                              <input
                                type="date"
                                value={dailyListDateInput}
                                disabled={isLocked}
                                onChange={(e) => setDailyListDateInput(e.target.value)}
                                className="h-9 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
                              />
                            </div>
                          </div>
                          <div className="min-w-0 flex-1 overflow-x-auto">
                            <div className="grid min-w-[760px] grid-cols-5 gap-2">
                              {tomorrowPositionSummaryCards.map((card) => (
                                <button
                                  type="button"
                                  onClick={() => toggleDailyListSelectedPosition(card.position)}
                                  key={card.position}
                                  className={[
                                    'flex min-h-[104px] w-full flex-col justify-between rounded-md border px-2.5 py-2 text-left transition',
                                    dailyListSelectedPositions[card.position]
                                      ? themeMode === 'light'
                                        ? getHomeCardToneClass(card.position, schedulePositionToneByPosition)
                                        : getHomeCardToneClass(card.position, schedulePositionToneByPosition)
                                      : themeMode === 'light'
                                        ? 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                                        : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
                                  ].join(' ')}
                                >
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                                    {card.position}
                                  </div>
                                  <div className="mt-1 whitespace-nowrap text-[11px] leading-tight opacity-90 tabular-nums">
                                    <span className="inline-flex items-center gap-1">
                                      <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        className={[
                                          'h-3.5 w-3.5',
                                          themeMode === 'light' ? 'text-amber-600' : 'text-amber-300'
                                        ].join(' ')}
                                        aria-hidden="true"
                                      >
                                        <circle cx="12" cy="12" r="4" />
                                        <path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" strokeLinecap="round" />
                                      </svg>
                                      <span>{card.early}/{card.earlyRecommended ?? '-'}</span>
                                    </span>
                                    <span className="ml-3 inline-flex items-center gap-1">
                                      <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        className={[
                                          'h-3.5 w-3.5',
                                          themeMode === 'light' ? 'text-indigo-600' : 'text-indigo-300'
                                        ].join(' ')}
                                        aria-hidden="true"
                                      >
                                        <path d="M20 14.2A8.5 8.5 0 119.8 4a7.1 7.1 0 0010.2 10.2z" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                      <span>{card.late}/{card.lateRecommended ?? '-'}</span>
                                    </span>
                                  </div>
                                  <div className="mt-1 whitespace-nowrap text-[11px] font-semibold leading-tight opacity-95">
                                    {t('推荐', 'Rec')}: {card.totalRecommended ?? '-'}<span className="ml-3">{t('排班', 'Sch')}: {card.total}</span>
                                  </div>
                                  <div className="mt-1 whitespace-nowrap text-[10px] leading-tight opacity-90 tabular-nums">
                                    <span className="inline-flex items-center gap-1">
                                      <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        className={[
                                          'h-3.5 w-3.5',
                                          themeMode === 'light' ? 'text-amber-600' : 'text-amber-300'
                                        ].join(' ')}
                                        aria-hidden="true"
                                      >
                                        <circle cx="12" cy="12" r="4" />
                                        <path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" strokeLinecap="round" />
                                      </svg>
                                      <span>{dailyCapacityLoading ? '...' : formatCapacityValue(card.earlyCapacity)}</span>
                                    </span>
                                    <span className="ml-3 inline-flex items-center gap-1">
                                      <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        className={[
                                          'h-3.5 w-3.5',
                                          themeMode === 'light' ? 'text-indigo-600' : 'text-indigo-300'
                                        ].join(' ')}
                                        aria-hidden="true"
                                      >
                                        <path d="M20 14.2A8.5 8.5 0 119.8 4a7.1 7.1 0 0010.2 10.2z" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                      <span>{dailyCapacityLoading ? '...' : formatCapacityValue(card.lateCapacity)}</span>
                                    </span>
                                  </div>
                                  <div className="mt-1 whitespace-nowrap text-[11px] font-semibold leading-tight opacity-95">
                                    总产能: {dailyCapacityLoading ? '...' : formatCapacityValue(card.totalCapacity)}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={!canCopyDailyListAll}
                              onClick={() => void copyDailyList('all')}
                              className={[
                                'rounded-2xl bg-neon px-4 py-2 text-sm font-semibold shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50',
                                themeMode === 'light' ? 'text-black' : 'text-white'
                              ].join(' ')}
                            >
                              {t('复制全部', 'Copy all')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDailyListOpen(false)}
                              className={[
                                'rounded-2xl px-4 py-2 text-sm font-medium transition',
                                themeMode === 'light'
                                  ? 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                                  : 'bg-white/10 text-slate-200 hover:bg-white/15'
                              ].join(' ')}
                            >
                              {t('关闭', 'Close')}
                            </button>
                          </div>
                        </div>
                        <div className="grid flex-1 gap-4 overflow-y-auto px-6 py-5 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <div
                              className={[
                                'flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2',
                                themeMode === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-black/25'
                              ].join(' ')}
                            >
                              <span className={['text-xs uppercase tracking-[0.14em]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                                {t('筛选', 'Filter')}
                              </span>
                              {DAILY_LIST_VISIBLE_POSITIONS.map((position) => (
                                <button
                                  key={`filter-${position}`}
                                  type="button"
                                  onClick={() =>
                                    setDailyListFilterPositions((prev) => ({
                                      ...prev,
                                      [position]: !prev[position]
                                    }))
                                  }
                                  className={[
                                    'rounded-lg border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] transition',
                                    dailyListFilterPositions[position]
                                      ? themeMode === 'light'
                                        ? getSchedulePositionBadgeClassLight(position)
                                        : getSchedulePositionBadgeClass(position)
                                      : themeMode === 'light'
                                        ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                        : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                                  ].join(' ')}
                                >
                                  {position}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() =>
                                  setDailyListFilterPositions(createEmptyDailyListLightFlags())
                                }
                                className={[
                                  'ml-auto rounded-lg px-3 py-1 text-xs font-semibold transition',
                                  themeMode === 'light'
                                    ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                    : 'bg-white/10 text-slate-200 hover:bg-white/15'
                                ].join(' ')}
                              >
                                {t('清空筛选', 'Clear filters')}
                              </button>
                            </div>
                          </div>
                          <div className="md:col-span-2">
                            <div
                              className={[
                                'flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-medium',
                                themeMode === 'light'
                                  ? 'border-slate-200 bg-slate-50 text-slate-700'
                                  : 'border-white/10 bg-white/5 text-slate-200'
                              ].join(' ')}
                            >
                              <div>
                                {lang === 'en' ? `${dailyListDateDisplay} Outbound Request:` : `${dailyListDateDisplay} 出库需求:`}
                                {' '}
                                <span className={themeMode === 'light' ? 'text-slate-900' : 'text-white'}>{dailyListTotalDemandCount}</span>
                                {lang === 'en' ? ' people' : t('人', '')}
                              </div>
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => setDailyListNewHireOpen(true)}
                                className={[
                                  'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                                  themeMode === 'light'
                                    ? 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-100'
                                    : 'bg-white/10 text-slate-200 hover:bg-white/15'
                                ].join(' ')}
                              >
                                {t('新人需求', 'New Request')}
                              </button>
                            </div>
                            {dailyCapacityError ? (
                              <div className={['mt-2 text-xs', themeMode === 'light' ? 'text-amber-700' : 'text-amber-200'].join(' ')}>
                                {t('预计产能已回退到模板值。', 'Capacity has fallen back to template values.')}
                              </div>
                            ) : null}
                          </div>
                          <div className={['rounded-2xl border p-4', themeMode === 'light' ? 'border-emerald-200 bg-emerald-50/50' : 'border-emerald-400/30 bg-emerald-500/[0.04]'].join(' ')}>
                            <div className="mb-3 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <h4
                                  className={[
                                    'text-sm font-semibold uppercase tracking-[0.16em]',
                                    themeMode === 'light' ? 'text-emerald-700' : 'text-emerald-300'
                                  ].join(' ')}
                                >
                                  {t('早班', 'Morning')}
                                </h4>
                                <span
                                  className={[
                                    'rounded-full border px-2 py-0.5 text-xs font-semibold',
                                    themeMode === 'light'
                                      ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                      : 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                                  ].join(' ')}
                                >
                                  {lang === 'en' ? `Total ${tomorrowDailyRowsDisplayed.earlyRows.length}` : `共${tomorrowDailyRowsDisplayed.earlyRows.length}人`}
                                </span>
                                <span
                                  title={t('基于最近14个有数据日UPH，无历史时回退模板UPH。', 'Based on the last 14 data days of UPH, with template UPH as fallback.')}
                                  className={[
                                    'rounded-full border px-2 py-0.5 text-xs font-semibold',
                                    themeMode === 'light'
                                      ? 'border-emerald-200 bg-white text-emerald-700'
                                      : 'border-emerald-400/30 bg-black/20 text-emerald-200'
                                  ].join(' ')}
                                >
                                  {dailyCapacityLoading ? '...' : formatCapacityValue(dailyListDisplayedCapacities.early)}
                                </span>
                              </div>
                              <button
                                type="button"
                                disabled={!canCopyDailyListEarly}
                                onClick={() => void copyDailyList('early')}
                                className={[
                                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                                  themeMode === 'light'
                                    ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                    : 'bg-white/10 text-slate-200 hover:bg-white/15'
                                ].join(' ')}
                              >
                                {t('复制', 'Copy')}
                              </button>
                            </div>
                            <div className={['max-h-[55vh] overflow-auto rounded-xl border', themeMode === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-black/25'].join(' ')}>
                              <table className="min-w-full text-left text-xs">
                                <thead
                                  className={[
                                    'sticky top-0 text-[10px] uppercase tracking-[0.15em]',
                                    themeMode === 'light' ? 'bg-slate-50 text-slate-500' : 'bg-slate-950/95 text-slate-400'
                                  ].join(' ')}
                                >
                                  <tr>
                                    <th className="px-3 py-2">US ID</th>
                                    <th className="px-3 py-2">NAME</th>
                                    <th className="px-3 py-2">AGENCY</th>
                                    <th className="px-3 py-2">POSITION</th>
                                    <th className="px-3 py-2">START TIME</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tomorrowDailyRowsDisplayed.earlyRows.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} className={['px-3 py-3 text-center', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                                        {t('无数据', 'No data')}
                                      </td>
                                    </tr>
                                  ) : (
                                    tomorrowDailyRowsDisplayed.earlyRows.map((row) => (
                                      <tr key={`early-${row.staff_id}`} className={themeMode === 'light' ? 'border-t border-slate-100' : 'border-t border-white/5'}>
                                        <td className={['px-3 py-2 font-mono', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{formatDailyListStaffId(row)}</td>
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{row.name || '-'}</td>
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{row.agency || '-'}</td>
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{row.position || '-'}</td>
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{row.start_time}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          <div className={['rounded-2xl border p-4', themeMode === 'light' ? 'border-indigo-200 bg-indigo-50/50' : 'border-indigo-400/30 bg-indigo-500/[0.04]'].join(' ')}>
                            <div className="mb-3 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <h4
                                  className={[
                                    'text-sm font-semibold uppercase tracking-[0.16em]',
                                    themeMode === 'light' ? 'text-indigo-700' : 'text-indigo-300'
                                  ].join(' ')}
                                >
                                  {t('晚班', 'Night')}
                                </h4>
                                <span
                                  className={[
                                    'rounded-full border px-2 py-0.5 text-xs font-semibold',
                                    themeMode === 'light'
                                      ? 'border-indigo-300 bg-indigo-100 text-indigo-800'
                                      : 'border-indigo-400/50 bg-indigo-500/15 text-indigo-200'
                                  ].join(' ')}
                                >
                                  {lang === 'en' ? `Total ${tomorrowDailyRowsDisplayed.lateRows.length}` : `共${tomorrowDailyRowsDisplayed.lateRows.length}人`}
                                </span>
                                <span
                                  title={t('基于最近14个有数据日UPH，无历史时回退模板UPH。', 'Based on the last 14 data days of UPH, with template UPH as fallback.')}
                                  className={[
                                    'rounded-full border px-2 py-0.5 text-xs font-semibold',
                                    themeMode === 'light'
                                      ? 'border-indigo-200 bg-white text-indigo-700'
                                      : 'border-indigo-400/30 bg-black/20 text-indigo-200'
                                  ].join(' ')}
                                >
                                  {dailyCapacityLoading ? '...' : formatCapacityValue(dailyListDisplayedCapacities.late)}
                                </span>
                              </div>
                              <button
                                type="button"
                                disabled={!canCopyDailyListLate}
                                onClick={() => void copyDailyList('late')}
                                className={[
                                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                                  themeMode === 'light'
                                    ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                    : 'bg-white/10 text-slate-200 hover:bg-white/15'
                                ].join(' ')}
                              >
                                {t('复制', 'Copy')}
                              </button>
                            </div>
                            <div className={['max-h-[55vh] overflow-auto rounded-xl border', themeMode === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-black/25'].join(' ')}>
                              <table className="min-w-full text-left text-xs">
                                <thead
                                  className={[
                                    'sticky top-0 text-[10px] uppercase tracking-[0.15em]',
                                    themeMode === 'light' ? 'bg-slate-50 text-slate-500' : 'bg-slate-950/95 text-slate-400'
                                  ].join(' ')}
                                >
                                  <tr>
                                    <th className="px-3 py-2">US ID</th>
                                    <th className="px-3 py-2">NAME</th>
                                    <th className="px-3 py-2">AGENCY</th>
                                    <th className="px-3 py-2">POSITION</th>
                                    <th className="px-3 py-2">START TIME</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tomorrowDailyRowsDisplayed.lateRows.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} className={['px-3 py-3 text-center', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                                        {t('无数据', 'No data')}
                                      </td>
                                    </tr>
                                  ) : (
                                    tomorrowDailyRowsDisplayed.lateRows.map((row) => (
                                      <tr key={`late-${row.staff_id}`} className={themeMode === 'light' ? 'border-t border-slate-100' : 'border-t border-white/5'}>
                                        <td className={['px-3 py-2 font-mono', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{formatDailyListStaffId(row)}</td>
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{row.name || '-'}</td>
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{row.agency || '-'}</td>
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{row.position || '-'}</td>
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{row.start_time}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}

                <DailyListNewHireModal
                  open={dailyListNewHireOpen}
                  t={t}
                  themeMode={themeMode}
                  isLocked={scheduleReadOnly}
                  allowedPositions={ALLOWED_POSITIONS}
                  dailyListNewHirePosition={dailyListNewHirePosition}
                  setDailyListNewHirePosition={setDailyListNewHirePosition}
                  dailyListNewHireShift={dailyListNewHireShift}
                  setDailyListNewHireShift={setDailyListNewHireShift}
                  dailyListNewHireCount={dailyListNewHireCount}
                  setDailyListNewHireCount={setDailyListNewHireCount}
                  dailyListNewHireAgency={dailyListNewHireAgency}
                  setDailyListNewHireAgency={setDailyListNewHireAgency}
                  dailyListAgencyOptions={employeeAgencyOptions}
                  dailyListNewHireLabel={dailyListNewHireLabel}
                  setDailyListNewHireLabel={setDailyListNewHireLabel}
                  dailyListLabelOptions={dailyListNewHireLabelOptions}
                  dailyListNewHireEntryTime={dailyListNewHireEntryTime}
                  setDailyListNewHireEntryTime={setDailyListNewHireEntryTime}
                  dailyListNewHireNote={dailyListNewHireNote}
                  setDailyListNewHireNote={setDailyListNewHireNote}
                  clamp={clamp}
                  onClose={() => setDailyListNewHireOpen(false)}
                  addDailyListNewHireDemand={addDailyListNewHireDemand}
                />
              </section>
            )}

            {page === 'employees' && (
              <section className="glass reveal rounded-b-3xl rounded-t-none px-6 py-8">
                <EmployeesToolbar
                  t={t}
                  themeMode={themeMode}
                  isLocked={isLocked}
                  isReadOnly={!employeesCanOperate}
                  employeeBadgeBatchPrinting={employeeBadgeBatchPrinting}
                  employeeBadgeBatchSelectedStaffIds={employeeBadgeBatchSelectedStaffIds}
                  onPrintSelectedBadgeBatch={printSelectedEmployeeBadgeCards}
                  setEmployeeBadgeBatchSelectedStaffIds={setEmployeeBadgeBatchSelectedStaffIds}
                  fileInputRef={fileInputRef}
                  onFileSelected={onFileSelected}
                  uploadEmployees={uploadEmployees}
                  exportEmployees={exportEmployees}
                  setEmployeeAddOpen={setEmployeeAddOpen}
                  fetchEmployees={fetchEmployees}
                  setEmployeeSearch={setEmployeeSearch}
                  setEmployeeAgency={setEmployeeAgency}
                  setEmployeePosition={setEmployeePosition}
                  setEmployeeShiftFilter={setEmployeeShiftFilter}
                  setEmployeeLabels={setEmployeeLabels}
                  uploadError={uploadError}
                  employeeSearch={employeeSearch}
                  employeeAgency={employeeAgency}
                  employeeAgencyOptions={employeeAgencyOptions}
                  employeePosition={employeePosition}
                  employeePositionOptions={employeePositionOptions}
                  employeeShiftFilter={employeeShiftFilter}
                  employeeLabels={employeeLabels}
                  employeeFilterLabelOptions={employeeFilterLabelOptions}
                  getScheduleLabelToneClass={getScheduleLabelToneClass}
                  cycleScheduleLabelTone={cycleScheduleLabelTone}
                />

                <EmployeeAddModal
                  t={t}
                  themeMode={themeMode}
                  open={employeeAddOpen}
                  isLocked={employeesReadOnly}
                  employeeNewStaffId={employeeNewStaffId}
                  setEmployeeNewStaffId={setEmployeeNewStaffId}
                  employeeNewName={employeeNewName}
                  setEmployeeNewName={setEmployeeNewName}
                  employeeNewAgency={employeeNewAgency}
                  setEmployeeNewAgency={setEmployeeNewAgency}
                  employeeAgencyOptions={employeeAgencyOptions}
                  employeeNewPosition={employeeNewPosition}
                  setEmployeeNewPosition={setEmployeeNewPosition}
                  employeeNewEmploymentType={employeeNewEmploymentType}
                  setEmployeeNewEmploymentType={setEmployeeNewEmploymentType}
                  employeeNewShift={employeeNewShift}
                  setEmployeeNewShift={setEmployeeNewShift}
                  employeeNewShiftTime={employeeNewShiftTime}
                  setEmployeeNewShiftTime={setEmployeeNewShiftTime}
                  employeeNewLabel={employeeNewLabel}
                  setEmployeeNewLabel={setEmployeeNewLabel}
                  employeeNewWorkAccount={employeeNewWorkAccount}
                  setEmployeeNewWorkAccount={setEmployeeNewWorkAccount}
                  employeeNewWorkPassword={employeeNewWorkPassword}
                  setEmployeeNewWorkPassword={setEmployeeNewWorkPassword}
                  employeeAddLabelOptions={employeeAddLabelOptions}
                  allowedPositions={ALLOWED_POSITIONS}
                  closeEmployeeAdd={closeEmployeeAdd}
                  addEmployeeRow={addEmployeeRow}
                />

                <EmployeesTableSection
                  t={t}
                  isLocked={employeesReadOnly}
                  themeMode={themeMode}
                  employeesError={employeesError}
                  employeesFiltered={employeesFiltered}
                  employeeSortByLastPunchDesc={employeeSortByLastPunchDesc}
                  employeeSortByHireDateDesc={employeeSortByHireDateDesc}
                  onToggleSort={() => {
                    setEmployeeSortByLastPunchDesc((prev) => !prev);
                    setEmployeeSortByHireDateDesc(false);
                  }}
                  onToggleHireDateSort={() => {
                    setEmployeeSortByHireDateDesc((prev) => !prev);
                    setEmployeeSortByLastPunchDesc(false);
                  }}
                  displayStaffId={displayStaffId}
                  getSchedulePositionBadgeClass={getSchedulePositionBadgeClass}
                  getScheduleLabelToneClass={getScheduleLabelToneClass}
                  getShiftBadgeClass={getShiftBadgeClass}
                  employeeShiftByStaffId={employeeShiftByStaffId}
                  scheduleRowsByStaffDayIndex={scheduleRowsByStaffDayIndex}
                  normalizeStaffId={normalizeStaffId}
                  normalizeShiftValue={normalizeShiftValue}
                  homeOperationalDayIndex={homeOperationalDayIndex}
                  employeeLastPunchAtByStaffId={employeeLastPunchAtByStaffId}
                  serverTime={serverTime}
                  shiftAnalysisDays={SHIFT_ANALYSIS_DAYS}
                  toDateOnly={toDateOnly}
                  employeeBadgePrintingStaffId={employeeBadgePrintingStaffId}
                  employeeBadgeBatchSelectedStaffIds={employeeBadgeBatchSelectedStaffIds}
                  toggleEmployeeBadgeBatchSelectedStaffId={toggleEmployeeBadgeBatchSelectedStaffId}
                  openEmployeeAuditLog={openEmployeeAuditLog}
                  printEmployeeTempBadge={printEmployeeTempBadge}
                  openEmployeeEdit={openEmployeeEdit}
                  deleteEmployeeRow={deleteEmployeeRow}
                />

                <EmployeeAuditModal
                  open={employeeAuditOpen}
                  t={t}
                  employeeAuditName={employeeAuditName}
                  employeeAuditStaffId={employeeAuditStaffId}
                  employeeAuditLoading={employeeAuditLoading}
                  employeeAuditError={employeeAuditError}
                  employeeAuditRows={employeeAuditRows}
                  setEmployeeAuditOpen={setEmployeeAuditOpen}
                  formatCellAuditTime={formatCellAuditTime}
                  renderAuditSummary={renderAuditSummary}
                  formatAuditDetail={formatAuditDetail}
                  displayStaffId={displayStaffId}
                  resolveAdminUserIdentity={resolveAdminUserIdentity}
                />

                <EmployeeEditModal
                  open={employeeEditOpen}
                  t={t}
                  themeMode={themeMode}
                  isLocked={employeesReadOnly}
                  userEmail={String(user?.email ?? '')}
                  staffIdEditorEmail={STAFF_ID_EDITOR_EMAIL}
                  isNewHirePlaceholderStaffId={isNewHirePlaceholderStaffId}
                  displayStaffId={displayStaffId}
                  employeeEditOriginalStaffId={employeeEditOriginalStaffId}
                  employeeEditStaffId={employeeEditStaffId}
                  setEmployeeEditStaffId={setEmployeeEditStaffId}
                  employeeEditName={employeeEditName}
                  setEmployeeEditName={setEmployeeEditName}
                  employeeEditAgency={employeeEditAgency}
                  setEmployeeEditAgency={setEmployeeEditAgency}
                  employeeAgencyOptions={employeeAgencyOptions}
                  employeeEditPosition={employeeEditPosition}
                  setEmployeeEditPosition={setEmployeeEditPosition as unknown as (value: string) => void}
                  employeeEditEmploymentType={employeeEditEmploymentType}
                  setEmployeeEditEmploymentType={setEmployeeEditEmploymentType}
                  employeeEditShift={employeeEditShift}
                  setEmployeeEditShift={setEmployeeEditShift}
                  employeeEditShiftTime={employeeEditShiftTime}
                  setEmployeeEditShiftTime={setEmployeeEditShiftTime}
                  employeeEditLabel={employeeEditLabel}
                  setEmployeeEditLabel={setEmployeeEditLabel}
                  employeeEditWorkAccount={employeeEditWorkAccount}
                  setEmployeeEditWorkAccount={setEmployeeEditWorkAccount}
                  employeeEditWorkPassword={employeeEditWorkPassword}
                  setEmployeeEditWorkPassword={setEmployeeEditWorkPassword}
                  employeeEditLabelOptions={employeeEditLabelOptions}
                  allowedPositions={ALLOWED_POSITIONS}
                  closeEmployeeEdit={closeEmployeeEdit}
                  saveEmployeeEdit={saveEmployeeEdit}
                />

                <EmployeeBadgePreviewModal preview={employeeBadgePreview} t={t} close={() => setEmployeeBadgePreview(null)} />

              </section>
            )}

            {page === 'accounts' && (
              <AccountManagementPage
                t={t}
                themeMode={themeMode}
                isLocked={isLocked}
                isReadOnly={!accountsCanOperate}
                accountSearch={accountSearch}
                setAccountSearch={setAccountSearch}
                accountPositionFilter={accountPositionFilter}
                setAccountPositionFilter={setAccountPositionFilter}
                accountPositionOptions={accountPositionOptions}
                accountRowsFiltered={accountRowsFiltered}
                accountRowsRendered={accountRowsRendered}
                setAccountRenderCount={setAccountRenderCount}
                onRefreshEmployees={async () => {
                  await fetchTempAccounts({ lockUi: false });
                }}
                onDownloadTemplate={downloadTempAccountTemplate}
                onImportAccounts={importTempAccounts}
                onExportAccounts={exportTempAccounts}
                accountCardPrintingStaffId={accountCardPrintingStaffId}
                onPrintAccountCard={printAccountCard}
                onEditAccount={editTempAccount}
              />
            )}

            {page === 'permissions' && (
              <AdminPermissionsPage
                t={t}
                themeMode={themeMode}
                isLocked={isLocked}
                canManage={accountsCanManageAdminAccess}
                accessContext={adminAccessContext}
                accessRows={adminAccessAccounts}
                userOptions={adminAccessUserOptions}
                agencyOptions={employeeAgencyOptions}
                requestRows={adminAccessRequests}
                resolveAdminUserIdentity={resolveAdminUserIdentity}
                onRefreshAccess={async () => {
                  await fetchAdminAccessAccountsAndUsers({ lockUi: false });
                }}
                onSaveAccess={saveAdminAccessConfig}
                onRefreshRequests={async () => {
                  await fetchAdminAccessRequests({ lockUi: false, status: 'all' });
                }}
                onCreateRequest={submitAdminAccessRequest}
                onReviewRequest={reviewAdminAccessRequestAction}
              />
            )}

            {page === 'timecard' && (
              <section className="glass reveal rounded-none px-6 py-8">
                <TimecardControls
                  t={t}
                  themeMode={themeMode}
                  isLocked={isLocked}
                  serverTime={serverTime}
                  startOfWeekMonday={startOfWeekMonday}
                  addDays={addDays}
                  toDateOnly={toDateOnly}
                  timecardWeekOffset={timecardWeekOffset}
                  changeTimecardWeek={changeTimecardWeek}
                  timecardWeekInput={timecardWeekInput}
                  setTimecardWeekInput={setTimecardWeekInput}
                  fetchTimecard={fetchTimecard}
                  refreshTimecardWithAudit={refreshTimecardWithAudit}
                  timecardRowsFilteredCount={timecardRowsFiltered.length}
                  exportTimecard={exportTimecard}
                  exportDailyPunches={exportDailyPunches}
                  timecardMissingEmployeeOnly={timecardMissingEmployeeOnly}
                  setTimecardMissingEmployeeOnly={setTimecardMissingEmployeeOnly}
                  setTimecardAgency={setTimecardAgency}
                  setTimecardPosition={setTimecardPosition}
                  setTimecardSearch={setTimecardSearch}
                  setTimecardShift={setTimecardShift}
                  setTimecardInProgressOnly={setTimecardInProgressOnly}
                  setTimecardPresentDayFilter={setTimecardPresentDayFilter}
                  timecardSearch={timecardSearch}
                  timecardAgency={timecardAgency}
                  timecardAgencyOptions={timecardAgencyOptions}
                  timecardPosition={timecardPosition}
                  timecardPositionOptions={timecardPositionOptions}
                  timecardShift={timecardShift}
                  timecardInProgressOnly={timecardInProgressOnly}
                  timecardError={timecardError}
                />

                <TimecardTableSection
                  t={t}
                  themeMode={themeMode}
                  isLocked={timecardReadOnly}
                  timecardLoading={timecardLoading}
                  serverTime={serverTime}
                  timecardWeekOffset={timecardWeekOffset}
                  timecardWeekStart={timecardWeekStart}
                  startOfWeekMonday={startOfWeekMonday}
                  addDays={addDays}
                  toDateOnly={toDateOnly}
                  formatHours={formatHours}
                  getSchedulePositionBadgeClass={getSchedulePositionBadgeClass}
                  timecardDayTotalHours={timecardDayTotalHours}
                  timecardDayAttendanceCount={timecardDayAttendanceCount}
                  timecardPresentDayFilter={timecardPresentDayFilter}
                  setTimecardPresentDayFilter={setTimecardPresentDayFilter}
                  timecardAgencySort={timecardAgencySort}
                  timecardTotalSort={timecardTotalSort}
                  onToggleTimecardAgencySort={() =>
                    {
                      setTimecardTotalSort('');
                      setTimecardAgencySort((prev) => (prev === '' ? 'asc' : prev === 'asc' ? 'desc' : ''));
                    }
                  }
                  onToggleTimecardTotalSort={() =>
                    {
                      setTimecardAgencySort('');
                      setTimecardTotalSort((prev) => (prev === '' ? 'desc' : prev === 'desc' ? 'asc' : ''));
                    }
                  }
                  timecardRowsRendered={timecardRowsRendered}
                  timecardAuditByStaffDate={timecardAuditByStaffDate}
                  openTimecardPunchModal={openTimecardPunchModal}
                  formatAuditDetail={formatAuditDetail}
                  formatCellAuditTime={formatCellAuditTime}
                  normalizeAuditActor={normalizeAuditActor}
                  resolveAdminUserIdentity={resolveAdminUserIdentity}
                  renderAuditSummary={renderAuditSummary}
                />

                {timecardPunchOpen &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div
                      className={[
                        'fixed inset-0 z-50 flex items-center justify-center p-4',
                        themeMode === 'light' ? 'bg-slate-900/35' : 'bg-black/70'
                      ].join(' ')}
                      role="dialog"
                      aria-modal="true"
                    >
                      <div
                        className={[
                          'flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl shadow-2xl',
                          themeMode === 'light' ? 'border border-slate-200 bg-white' : 'border border-white/10 bg-slate-950/90 backdrop-blur'
                        ].join(' ')}
                      >
                        <div
                          className={[
                            'flex items-start justify-between gap-4 px-6 py-5',
                            themeMode === 'light' ? 'border-b border-slate-200' : 'border-b border-white/10'
                          ].join(' ')}
                        >
                          <div>
                            <div className={['text-base font-semibold tracking-[0.06em]', themeMode === 'light' ? 'text-slate-800' : 'text-slate-100'].join(' ')}>
                              工时校正
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className={['rounded-full px-2 py-0.5', themeMode === 'light' ? 'bg-slate-100 text-slate-700' : 'bg-white/10 text-slate-200'].join(' ')}>
                              {timecardPunchHeaderMeta.name}
                            </span>
                            <span className={['rounded-full px-2 py-0.5', themeMode === 'light' ? 'bg-slate-100 text-slate-700' : 'bg-white/10 text-slate-200'].join(' ')}>
                              {timecardPunchHeaderMeta.position}
                            </span>
                            <span className={['rounded-full px-2 py-0.5', themeMode === 'light' ? 'bg-slate-100 text-slate-700' : 'bg-white/10 text-slate-200'].join(' ')}>
                              {timecardPunchHeaderMeta.label}
                            </span>
                            <span className={['rounded-full px-2 py-0.5 font-semibold', themeMode === 'light' ? 'bg-emerald-50 text-emerald-700' : 'bg-emerald-500/15 text-emerald-200'].join(' ')}>
                              {timecardPunchHeaderMeta.finalHoursText}
                            </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!timecardPunchReadOnly && (
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => setTimecardPunchAddOpen((prev) => !prev)}
                                className={[
                                  'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                                  themeMode === 'light'
                                    ? 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                                    : 'bg-white/10 text-slate-200 hover:bg-white/15'
                                ].join(' ')}
                              >
                                {timecardPunchAddOpen ? t('隐藏新增', 'Hide add') : t('新增打卡', 'Add punch')}
                              </button>
                            )}
                            {!timecardPunchReadOnly && (
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => void saveAllTimecardPunchRows()}
                                className="rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {t('保存全部', 'Save all')}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={closeTimecardPunchModal}
                              className={[
                                'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                                themeMode === 'light'
                                  ? 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                                  : 'bg-white/10 text-slate-200 hover:bg-white/15'
                              ].join(' ')}
                            >
                              {t('关闭', 'Close')}
                            </button>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-6 py-5">
                          {!timecardPunchReadOnly && timecardPunchAddOpen && (
                            <div
                              className={[
                                'rounded-2xl px-4 py-4',
                                themeMode === 'light' ? 'border border-neon/50 bg-emerald-50' : 'border border-neon/40 bg-black/30 shadow-glow'
                              ].join(' ')}
                            >
                              <div className="grid gap-3 md:grid-cols-[1fr_1fr_7rem] md:items-end">
                                <div>
                                  <div className={['text-xs uppercase tracking-[0.25em]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>IN Time</div>
                                  <input
                                    value={timecardPunchNew.inAtLocal}
                                    disabled={isLocked}
                                    onChange={(e) => setTimecardPunchNew((prev) => ({ ...prev, inAtLocal: e.target.value }))}
                                    type="datetime-local"
                                    className={[
                                      'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                                      themeMode === 'light'
                                        ? 'border border-slate-300 bg-white text-slate-900'
                                        : 'border border-white/10 bg-black/30 text-white'
                                    ].join(' ')}
                                  />
                                </div>
                                <div>
                                  <div className={['text-xs uppercase tracking-[0.25em]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>OUT Time</div>
                                  <input
                                    value={timecardPunchNew.outAtLocal}
                                    disabled={isLocked}
                                    onChange={(e) => setTimecardPunchNew((prev) => ({ ...prev, outAtLocal: e.target.value }))}
                                    type="datetime-local"
                                    className={[
                                      'mt-2 h-11 w-full rounded-2xl px-4 text-sm outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                                      themeMode === 'light'
                                        ? 'border border-slate-300 bg-white text-slate-900'
                                        : 'border border-white/10 bg-black/30 text-white'
                                    ].join(' ')}
                                  />
                                </div>
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={() => void addTimecardPunchRow()}
                                  className="h-11 rounded-2xl bg-neon px-6 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {t('添加', 'Add')}
                                </button>
                              </div>
                              <p className={['mt-3 text-xs', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{t('手动一次添加一组 IN / OUT 打卡记录。', 'Add one IN/OUT pair manually.')}</p>
                            </div>
                          )}

                        {timecardPunchError && <p className="text-sm text-ember">{t('操作失败：', 'Failed: ')}{timecardPunchError}</p>}
                        {!timecardPunchError && timecardPunchRowsVisible.length === 0 && (
                          <p className={['text-sm', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{t('暂无记录', 'No records')}</p>
                        )}

                        {timecardPunchCardsVisible.length > 0 && (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {timecardPunchCardsRendered.map((row) => {
                              const pendingAddIdSet = new Set(timecardPunchPendingAddRows.map((r) => String(r.id)));
                              const rowId = String(row.id);
                              const edit = timecardPunchEdits[rowId] ?? {
                                action: row.action,
                                atLocal: row.created_at ? toLocalDateTimeInputValue(new Date(row.created_at)) : ''
                              };
                              const rowLocal = row.created_at ? toLocalDateTimeInputValue(new Date(row.created_at)) : '';
                              const isDirty = edit.action !== row.action || edit.atLocal !== rowLocal;
                              const isPendingAdd = pendingAddIdSet.has(rowId);
                              const showEditedTone = isDirty || isPendingAdd;
                              const isDragSource = timecardPunchDraggingId === rowId;
                              const isDragTarget = timecardPunchDragOverId === rowId && timecardPunchDraggingId !== rowId;
                              const isSwapPairHighlighted =
                                Boolean(timecardPunchDraggingId && timecardPunchDragOverId) && (isDragSource || isDragTarget);

                              return (
                                <div
                                  key={rowId}
                                  draggable={!isLocked && !timecardPunchReadOnly}
                                  onDragStart={(e) => {
                                    if (isLocked || timecardPunchReadOnly) return;
                                    setTimecardPunchDraggingId(rowId);
                                    setTimecardPunchDragOverId(null);
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', rowId);
                                  }}
                                  onDragOver={(e) => {
                                    if (isLocked || timecardPunchReadOnly || !timecardPunchDraggingId || timecardPunchDraggingId === rowId) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    if (timecardPunchDragOverId !== rowId) setTimecardPunchDragOverId(rowId);
                                  }}
                                  onDragEnter={(e) => {
                                    if (isLocked || timecardPunchReadOnly || !timecardPunchDraggingId || timecardPunchDraggingId === rowId) return;
                                    e.preventDefault();
                                    if (timecardPunchDragOverId !== rowId) setTimecardPunchDragOverId(rowId);
                                  }}
                                  onDrop={(e) => {
                                    if (isLocked || timecardPunchReadOnly) return;
                                    e.preventDefault();
                                    const dragId = String(timecardPunchDraggingId ?? '').trim();
                                    const dropId = String(timecardPunchDragOverId || rowId).trim();
                                    if (dragId && dropId && dragId !== dropId) {
                                      const targetRow = timecardPunchCardsVisible.find((r) => String(r.id) === dropId);
                                      if (targetRow) {
                                        const targetEdit = timecardPunchEdits[dropId] ?? {
                                          action: targetRow.action,
                                          atLocal: targetRow.created_at ? toLocalDateTimeInputValue(new Date(targetRow.created_at)) : ''
                                        };
                                        const targetAction: 'IN' | 'OUT' = targetEdit.action === 'OUT' ? 'OUT' : 'IN';
                                        setTimecardPunchEdits((prev) => {
                                          const sourceRow = timecardPunchCardsVisible.find((r) => String(r.id) === dragId);
                                          if (!sourceRow) return prev;
                                          const sourceEdit = prev[dragId] ?? {
                                            action: sourceRow.action,
                                            atLocal: sourceRow.created_at ? toLocalDateTimeInputValue(new Date(sourceRow.created_at)) : ''
                                          };
                                          if (sourceEdit.action === targetAction) return prev;
                                          return {
                                            ...prev,
                                            [dragId]: { ...sourceEdit, action: targetAction }
                                          };
                                        });
                                      }
                                    }
                                    swapTimecardPunchOrder(dragId, dropId);
                                    setTimecardPunchDraggingId(null);
                                    setTimecardPunchDragOverId(null);
                                  }}
                                  onDragEnd={() => {
                                    swapTimecardPunchOrder(timecardPunchDraggingId, timecardPunchDragOverId);
                                    setTimecardPunchDraggingId(null);
                                    setTimecardPunchDragOverId(null);
                                  }}
                                  className={[
                                    'relative rounded-2xl px-4 py-4 transition-[transform,box-shadow,opacity,background-color] duration-200 ease-out will-change-transform',
                                    themeMode === 'light' ? 'border border-slate-200 bg-slate-50' : 'bg-white/5',
                                    !isLocked && !timecardPunchReadOnly ? 'cursor-grab active:cursor-grabbing' : '',
                                    isDragSource ? 'opacity-70 scale-[0.985]' : '',
                                    isSwapPairHighlighted
                                      ? themeMode === 'light'
                                        ? 'ring-2 ring-neon/70 shadow-[0_0_24px_rgba(132,255,0,0.18)]'
                                        : 'ring-2 ring-neon/70 shadow-glow'
                                      : ''
                                  ].join(' ')}
                                >
                                  {!timecardPunchReadOnly && (
                                    <button
                                      type="button"
                                      disabled={isLocked}
                                      onClick={() => void deleteTimecardPunchRow(row)}
                                      className="absolute right-3 top-3 h-7 w-7 rounded-full bg-ember/85 text-sm font-bold text-white transition hover:bg-ember disabled:cursor-not-allowed disabled:opacity-60"
                                      title={t('删除此条', 'Delete this row')}
                                    >
                                      ×
                                    </button>
                                  )}
                                  <div className="grid gap-3 md:grid-cols-[7rem_1fr] md:items-end">
                                    <div>
                                      <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Action</div>
                                      <select
                                        value={edit.action}
                                        disabled={isLocked || timecardPunchReadOnly}
                                        onChange={(e) =>
                                          setTimecardPunchEdits((prev) => ({
                                            ...prev,
                                            [rowId]: { ...edit, action: e.target.value === 'OUT' ? 'OUT' : 'IN' }
                                          }))
                                        }
                                        className={[
                                          'mt-2 h-10 w-full rounded-xl px-3 font-display text-lg tracking-[0.08em] outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                                          showEditedTone
                                            ? themeMode === 'light'
                                              ? 'border border-amber-400 bg-amber-50 text-slate-900'
                                              : 'border border-amber-400/70 bg-amber-500/10'
                                            : themeMode === 'light'
                                              ? 'border border-slate-300 bg-white'
                                              : 'border border-white/10 bg-black/30',
                                          edit.action === 'IN' ? 'text-mint' : 'text-ember'
                                        ].join(' ')}
                                      >
                                        <option value="IN">IN</option>
                                        <option value="OUT">OUT</option>
                                      </select>
                                    </div>
                                    <div>
                                      <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Time</div>
                                      <input
                                        value={edit.atLocal}
                                        disabled={isLocked || timecardPunchReadOnly}
                                        onChange={(e) =>
                                          setTimecardPunchEdits((prev) => ({
                                            ...prev,
                                            [rowId]: { ...edit, atLocal: e.target.value }
                                          }))
                                        }
                                        type="datetime-local"
                                        className={[
                                          'mt-2 h-10 w-full rounded-xl px-3 text-sm outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                                          showEditedTone
                                            ? themeMode === 'light'
                                              ? 'border border-amber-400 bg-amber-50 text-slate-900'
                                              : 'border border-amber-400/70 bg-amber-500/10 text-white'
                                            : themeMode === 'light'
                                              ? 'border border-slate-300 bg-white text-slate-900'
                                              : 'border border-white/10 bg-black/30 text-white'
                                        ].join(' ')}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
              </section>
            )}

            {page === 'employee_upload' && (
              <EmployeeUploadPage
                t={t}
                isLocked={employeesReadOnly}
                uploadFillDuplicates={uploadFillDuplicates}
                setUploadFillDuplicates={setUploadFillDuplicates}
                fileInputRef={fileInputRef}
                onFileSelected={onFileSelected}
                uploadEmployees={uploadEmployees}
                onDownloadTemplate={downloadEmployeeTemplate}
                uploadError={uploadError}
              />
            )}
                </div>
              </main>
            </div>
          </div>
        )}

        {page !== 'timecard' && renderTimecardPunchModal()}

        {scheduleMistakeDraft.open &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              className={['fixed inset-0 z-[90] flex items-center justify-center p-4', themeMode === 'light' ? 'bg-slate-900/35' : 'bg-black/70'].join(' ')}
              onClick={() => {
                if (scheduleMistakeDraft.saving) return;
                closeScheduleMistakeCreate();
              }}
            >
              <div
                className={[
                  'w-full max-w-xl rounded-3xl border shadow-2xl',
                  themeMode === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/95 backdrop-blur'
                ].join(' ')}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={['flex items-center justify-between border-b px-5 py-4', themeMode === 'light' ? 'border-slate-200' : 'border-white/10'].join(' ')}>
                  <div>
                    <div className={['text-base font-semibold tracking-[0.06em]', themeMode === 'light' ? 'text-slate-800' : 'text-slate-100'].join(' ')}>
                      Add Mistake
                    </div>
                    <div className={['mt-1 text-xs', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                      {`${scheduleMistakeDraft.staff_id}${scheduleMistakeDraft.name ? ` - ${scheduleMistakeDraft.name}` : ''}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isLocked || scheduleMistakeDraft.saving}
                    onClick={closeScheduleMistakeCreate}
                    className={[
                      'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                      themeMode === 'light'
                        ? 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : 'bg-white/10 text-slate-200 hover:bg-white/15'
                    ].join(' ')}
                  >
                    {t('关闭', 'Close')}
                  </button>
                </div>
                <div className="space-y-4 px-5 py-5">
                  <div className={['text-xs', themeMode === 'light' ? 'text-slate-600' : 'text-slate-300'].join(' ')}>
                    {t('岗位', 'Position')}: {scheduleMistakeDraft.position || '-'}
                  </div>
                  <div>
                    <div className={['text-xs uppercase tracking-[0.2em]', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                      Reason
                    </div>
                    <textarea
                      value={scheduleMistakeDraft.reason}
                      disabled={isLocked || scheduleMistakeDraft.saving}
                      onChange={(e) => setScheduleMistakeDraft((prev) => ({ ...prev, reason: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.shiftKey) return;
                        e.preventDefault();
                        void saveScheduleMistakeCreate();
                      }}
                      placeholder="Describe the mistake"
                      rows={5}
                      className={[
                        'mt-2 w-full rounded-2xl px-4 py-3 text-sm outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                        themeMode === 'light'
                          ? 'border border-slate-300 bg-white text-slate-900'
                          : 'border border-white/10 bg-black/30 text-white'
                      ].join(' ')}
                    />
                  </div>
                </div>
                <div className={['flex items-center justify-end gap-2 border-t px-5 py-4', themeMode === 'light' ? 'border-slate-200' : 'border-white/10'].join(' ')}>
                  <button
                    type="button"
                    disabled={isLocked || scheduleMistakeDraft.saving}
                    onClick={closeScheduleMistakeCreate}
                    className={[
                      'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                      themeMode === 'light'
                        ? 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : 'bg-white/10 text-slate-200 hover:bg-white/15'
                    ].join(' ')}
                  >
                    {t('取消', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={isLocked || scheduleMistakeDraft.saving}
                    onClick={() => void saveScheduleMistakeCreate()}
                    className="rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {scheduleMistakeDraft.saving ? t('保存中...', 'Saving...') : t('保存', 'Save')}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

        <BusyOverlay visible={busyVisible} themeMode={themeMode} t={t} />

        {user && userDisplayNamePromptOpen && (
          <div className={['fixed inset-0 z-[80] flex items-center justify-center px-4', themeMode === 'light' ? 'bg-slate-900/30' : 'bg-black/70'].join(' ')}>
            <div className={['w-full max-w-md rounded-2xl border p-5 shadow-2xl', themeMode === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950'].join(' ')}>
              <h3 className={['font-display text-xl tracking-[0.08em]', themeMode === 'light' ? 'text-slate-900' : 'text-white'].join(' ')}>
                {t('Set Your Name', 'Set Your Name')}
              </h3>
              <p className={['mt-2 text-sm', themeMode === 'light' ? 'text-slate-600' : 'text-slate-300'].join(' ')}>
                {t('Please enter a name before continuing', 'Please enter a display name before continuing.')}
              </p>
              <input
                value={userDisplayNameInput}
                onChange={(e) => setUserDisplayNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveUserDisplayName();
                  }
                }}
                placeholder={t('Example:Linnan Chen', 'Example: Linnan Chen')}
                className={[
                  'mt-4 h-11 w-full rounded-xl border px-3 text-sm outline-none transition',
                  themeMode === 'light'
                    ? 'border-slate-300 bg-white text-slate-900 focus:border-neon'
                    : 'border-white/10 bg-black/30 text-white focus:border-neon'
                ].join(' ')}
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={userDisplayNameSaving}
                  onClick={() => void doLogout()}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('退出登录', 'Logout')}
                </button>
                <button
                  type="button"
                  disabled={userDisplayNameSaving || !userDisplayNameInput.trim()}
                  onClick={() => void saveUserDisplayName()}
                  className="rounded-xl bg-neon px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {userDisplayNameSaving ? t('保存中...', 'Saving...') : t('保存', 'Save')}
                </button>
              </div>
            </div>
          </div>
        )}

        {deviceLabelPreview && typeof document !== 'undefined' &&
          createPortal(
            <div className="device-label-print-host">
              <style>{`
                @media print {
                  @page {
                    size: 2in 0.7in;
                    margin: 0;
                  }
                  body {
                    background: #fff !important;
                  }
                  .device-label-print-host {
                    position: static !important;
                    inset: 0 !important;
                  }
                  .device-label-preview-overlay {
                    position: static !important;
                    background: #fff !important;
                    padding: 0 !important;
                    margin: 0 !important;
                  }
                  .device-label-preview-chrome { display: none !important; }
                  .device-label-preview-canvas {
                    overflow: visible !important;
                    border: none !important;
                    background: transparent !important;
                    padding: 0 !important;
                  }
                  .device-label-preview-scale {
                    transform: none !important;
                    margin: 0 !important;
                  }
                }
              `}</style>
              <div
                className={[
                  'device-label-preview-overlay fixed inset-0 z-50 flex justify-center overflow-y-auto px-4 py-6 md:py-10',
                  themeMode === 'light' ? 'bg-slate-900/35' : 'bg-black/65'
                ].join(' ')}
              >
                <div
                  className={[
                    'my-auto w-full max-w-5xl rounded-3xl border p-6 md:p-7 shadow-2xl backdrop-blur',
                    themeMode === 'light' ? 'border-slate-200 bg-white/95' : 'border-white/10 bg-slate-950/95'
                  ].join(' ')}
                >
                  <div className="mb-4 flex items-center justify-between device-label-preview-chrome">
                    <h3 className={['font-display text-xl tracking-[0.08em]', themeMode === 'light' ? 'text-slate-900' : 'text-white'].join(' ')}>
                      {t('打印设备标签', 'Print Device Label')}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => printDeviceLabelSheet(deviceLabelPreview)}
                        className={[
                          'rounded-xl px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5',
                          themeMode === 'light'
                            ? 'bg-neon text-white shadow-[0_8px_20px_rgba(132,255,0,0.35)] hover:shadow-[0_12px_24px_rgba(132,255,0,0.45)]'
                            : 'bg-neon text-white shadow-glow hover:shadow-xl'
                        ].join(' ')}
                      >
                        {t('打印', 'Print')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeviceLabelPreview(null)}
                        className={[
                          'rounded-xl px-4 py-2 text-sm font-semibold transition',
                          themeMode === 'light'
                            ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            : 'bg-white/10 text-slate-200 hover:bg-white/15'
                        ].join(' ')}
                      >
                        {t('关闭', 'Close')}
                      </button>
                    </div>
                  </div>
                  <p className={['mb-4 text-xs device-label-preview-chrome', themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'].join(' ')}>
                    {t('打印尺寸：0.7 x 2 inch 标签纸。', 'Print size: 0.7 x 2 inch label.')}
                  </p>
                  <div
                    className={[
                      'device-label-preview-canvas min-h-[220px] max-h-[calc(100vh-11rem)] overflow-auto rounded-2xl border p-5 flex items-center justify-center',
                      themeMode === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-black/20'
                    ].join(' ')}
                  >
                    <div className="device-label-preview-scale mx-auto w-fit origin-center scale-[1.7] sm:scale-[2] md:scale-[2.25] lg:scale-[2.4]" style={{ width: '2in' }}>
                      <div
                        style={{
                          width: '2in',
                          height: '0.7in',
                          background: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
                          color: '#0f172a',
                          fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
                          border: '1px solid #cbd5e1',
                          borderRadius: '8px',
                          boxSizing: 'border-box',
                          padding: '0.045in',
                          display: 'grid',
                          gridTemplateColumns: '0.58in 1fr',
                          gap: '0.045in',
                          overflow: 'hidden'
                        }}
                      >
                        <div
                          style={{
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            background: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0.012in'
                          }}
                        >
                          <img
                            src={deviceLabelPreview.qrDataUrl}
                            alt={`QR ${deviceLabelPreview.sn}`}
                            style={{ width: '100%', height: 'auto', maxWidth: '0.5in' }}
                          />
                        </div>
                        <div style={{ display: 'grid', gridTemplateRows: 'auto auto auto 1fr auto', gap: '0.008in', minWidth: 0 }}>
                          <div style={{ fontSize: '7pt', fontWeight: 800, letterSpacing: '0.08em', color: '#334155' }}>OUTBOUND DEVICE</div>
                          <div style={{ fontSize: '9pt', fontWeight: 800, lineHeight: 1.05, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {deviceLabelPreview.name}
                          </div>
                          <div style={{ fontSize: '7pt', color: '#475569', lineHeight: 1.1 }}>
                            {deviceLabelPreview.type} · {deviceLabelPreview.position}
                          </div>
                          <div />
                          <div style={{ fontSize: '7pt', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {deviceLabelPreview.sn}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        <AppDialog
          open={loginErrorDialog.open}
          title={loginErrorDialog.title}
          message={loginErrorDialog.message}
          themeMode={themeMode}
          confirmText={t('知道了', 'OK')}
          onConfirm={closeLoginErrorDialog}
          onCancel={closeLoginErrorDialog}
          tone="danger"
        />
        <AppDialog
          open={confirmDialog.open}
          title={confirmDialog.title}
          message={confirmDialog.message}
          themeMode={themeMode}
          confirmText={t('确定', 'Confirm')}
          cancelText={t('取消', 'Cancel')}
          onConfirm={() => closeConfirmDialog(true)}
          onCancel={() => closeConfirmDialog(false)}
          tone="danger"
        />
      </div>
    </div>
  );
}
