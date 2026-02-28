import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createSupabaseClient, createSupabaseClientWithCredentials } from '../lib/supabase';
import { isValidStaffId as isValidStaffIdValue, normalizeStaffId } from '../lib/staffId';
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
import DevicesPage from './pages/DevicesPage';
import EmployeeUploadPage from './pages/EmployeeUploadPage';
import AccountManagementPage from './pages/AccountManagementPage';
import EmployeesToolbar from './pages/EmployeesToolbar';
import EmployeeAddModal from './pages/EmployeeAddModal';
import EmployeesTableSection from './pages/EmployeesTableSection';
import EmployeeAuditModal from './pages/EmployeeAuditModal';
import EmployeeEditModal from './pages/EmployeeEditModal';
import EmployeeBadgePreviewModal from './pages/EmployeeBadgePreviewModal';
import TimecardControls from './pages/TimecardControls';
import TimecardTableSection from './pages/TimecardTableSection';
import HomeDashboardPage from './pages/HomeDashboardPage';
import AuditPage from './pages/AuditPage';
import PunchesPage from './pages/PunchesPage';
import AppDialog from '../components/AppDialog';
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
  EmployeeRow,
  PunchRow,
  ScheduleBaseState,
  ScheduleDisplayState,
  SchedulePickerState,
  ScheduleRow,
  StatusTone,
  Status,
  TimecardRow
} from './types';

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const ALLOWED_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer'] as const;
const createEmptyPositionFlags = (): Record<AllowedPosition, boolean> => ({
  Pick: false,
  Pack: false,
  Rebin: false,
  Preship: false,
  Transfer: false
});
const AUDIT_TABLE = (import.meta.env.VITE_AUDIT_TABLE as string | undefined) ?? 'ob_audit_logs';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';
const APP_SETTINGS_TABLE = (import.meta.env.VITE_APP_SETTINGS_TABLE as string | undefined) ?? 'ob_app_settings';
const USER_PROFILE_TABLE = (import.meta.env.VITE_USER_PROFILE_TABLE as string | undefined) ?? 'ob_user_profiles';
const ATTENDANCE_MARKS_TABLE = (import.meta.env.VITE_ATTENDANCE_MARKS_TABLE as string | undefined) ?? 'ob_attendance_marks';
const DEVICE_TABLE = (import.meta.env.VITE_DEVICE_TABLE as string | undefined) ?? 'ob_devices';
const DEVICE_LOANS_TABLE = (import.meta.env.VITE_DEVICE_LOANS_TABLE as string | undefined) ?? 'ob_device_loans';
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
const SCHEDULE_UPH_DAYS = 30;
const STAFF_ID_EDITOR_EMAIL = 'lnchen4201@gmail.com';
const TOMORROW_LIST_PUBLISH_KEY = 'publish_tomorrow_list';
const SCHEDULE_WEEK_RESET_KEY = 'schedule_transient_reset_week';
const SCHEDULE_WEEK_ROLLOVER_KEY = 'schedule_week_rollover_marker';
const DAILY_LIST_LIGHTS_KEY = 'daily_list_position_lights';
const SCHEDULE_LABEL_TONES_KEY = 'schedule_label_tones_v1';
const SCHEDULE_POSITION_TONES_KEY = 'schedule_position_tones_v1';
const SCHEDULE_REST_NOTE = '__rest__';
const SCHEDULE_TEMP_WORK_NOTE = '__temp_work__';
const SCHEDULE_LEAVE_NOTE = '__leave__';
const SCHEDULE_TEMP_REST_NOTE = '__temp_rest__';
const STALE_TIMECARD_REQUEST = '__stale_timecard_request__';
const DEVICE_TYPES = ['PDA', 'CART'] as const;

const getScheduleBaseStateFromNote = (note: unknown): ScheduleBaseState => {
  const value = String(note ?? '').trim();
  if (value === SCHEDULE_TEMP_WORK_NOTE) return 'temp_work';
  if (value === SCHEDULE_LEAVE_NOTE) return 'leave';
  if (value === SCHEDULE_TEMP_REST_NOTE) return 'temp_rest';
  if (value === SCHEDULE_REST_NOTE) return 'rest';
  return 'work';
};

const getScheduleNoteFromBaseState = (state: ScheduleBaseState): string | null => {
  if (state === 'work') return null;
  if (state === 'temp_work') return SCHEDULE_TEMP_WORK_NOTE;
  if (state === 'leave') return SCHEDULE_LEAVE_NOTE;
  if (state === 'temp_rest') return SCHEDULE_TEMP_REST_NOTE;
  return SCHEDULE_REST_NOTE;
};

const isWorkingScheduleBaseState = (state: ScheduleBaseState) => state === 'work' || state === 'temp_work';
const isRestLikeScheduleBaseState = (state: ScheduleBaseState) =>
  state === 'rest' || state === 'temp_rest' || state === 'leave';

const isWorkingScheduleRow = (row: ScheduleRow | null | undefined) =>
  Boolean(row && isWorkingScheduleBaseState(getScheduleBaseStateFromNote(row.note)));

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

const formatUph = (value: number | null | undefined) => (value === null || value === undefined ? '-' : value.toFixed(1));
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
const normalizeAllowedPosition = (value: string): AllowedPosition | '' => {
  const hit = ALLOWED_POSITIONS.find((p) => p.toLowerCase() === String(value ?? '').trim().toLowerCase());
  return hit ?? '';
};
const isNewHirePlaceholderStaffId = (value: string) => /^NEWREQ-\d{8}(?:-[A-Z]+)?-\d{3,}$/i.test(String(value ?? '').trim());
const isNewHirePlaceholderName = (value: string) => /^\d{2}\/\d{2}NEW\s+[A-Z]+(\d+)$/i.test(String(value ?? '').trim());
const displayStaffId = (value: string) => String(value ?? '').trim();
const normalizeDeviceSn = (value: string) => String(value ?? '').trim().toUpperCase();
const normalizeDeviceType = (value: string): DeviceType => {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'CAR' || raw === 'CART' || raw === '车') return 'CART';
  return 'PDA';
};

const getDefaultPositionToneKey = (value: string): LabelToneKey => {
  const pos = normalizeAllowedPosition(value);
  if (pos === 'Pick') return 'sky';
  if (pos === 'Pack') return 'emerald';
  if (pos === 'Rebin') return 'amber';
  if (pos === 'Preship') return 'rose';
  if (pos === 'Transfer') return 'violet';
  return 'slate';
};

const POSITION_TONE_CLASS_DARK: Record<LabelToneKey, string> = {
  sky: 'border-sky-400/60 text-sky-200 bg-sky-500/10',
  emerald: 'border-emerald-400/60 text-emerald-200 bg-emerald-500/10',
  amber: 'border-amber-400/60 text-amber-200 bg-amber-500/10',
  violet: 'border-violet-400/60 text-violet-200 bg-violet-500/10',
  rose: 'border-rose-400/60 text-rose-200 bg-rose-500/10',
  slate: 'border-white/20 text-slate-200 bg-white/5'
};

const POSITION_TONE_CLASS_LIGHT: Record<LabelToneKey, string> = {
  sky: 'border-sky-300 bg-sky-50 text-sky-700',
  emerald: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-300 bg-amber-50 text-amber-700',
  violet: 'border-violet-300 bg-violet-50 text-violet-700',
  rose: 'border-rose-300 bg-rose-50 text-rose-700',
  slate: 'border-slate-300 bg-slate-100 text-slate-700'
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
  label: 'label',
  '标签': 'label',
  work_account: 'work_account',
  workaccount: 'work_account',
  '工作账号': 'work_account',
  '账号': 'work_account',
  work_password: 'work_password',
  workpassword: 'work_password',
  '工作密码': 'work_password',
  '密码': 'work_password'
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

export default function AdminApp() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isLocked = Boolean(busy);
  const [busyVisible, setBusyVisible] = useState(false);
  const timecardFetchSeqRef = useRef(0);
  const punchesFetchSeqRef = useRef(0);
  const attendanceFetchSeqRef = useRef(0);
  const timecardPunchFetchSeqRef = useRef(0);
  const timecardRecomputeLastRunByWeekRef = useRef<Record<string, number>>({});
  const scheduleLabelToneReadyRef = useRef(false);
  const scheduleLabelToneHydratingRef = useRef(false);
  const scheduleLabelToneLastSavedJsonRef = useRef('');
  const schedulePositionToneHydratingRef = useRef(false);
  const schedulePositionToneLastSavedJsonRef = useRef('');
  const schedulePositionToneReadyRef = useRef(false);
  const scheduleRenderFilterKeyRef = useRef('');
  type EmployeeColumnMode = 'lower' | 'cased';
  const employeeColumnModeRef = useRef<EmployeeColumnMode | null>(null);
  const scheduleUphRequestRef = useRef(0);

  const [page, setPage] = useState<AdminPage>('home');

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

  const [status, setStatus] = useState<Status>({ tone: 'idle', message: '请登录后台' });
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; message: string }>({
    open: false,
    title: '',
    message: ''
  });
  const confirmResolverRef = useRef<((ok: boolean) => void) | null>(null);
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

  const [user, setUser] = useState<User | null>(null);
  const [userDisplayName, setUserDisplayName] = useState('');
  const [userDisplayNameInput, setUserDisplayNameInput] = useState('');
  const [userDisplayNamePromptOpen, setUserDisplayNamePromptOpen] = useState(false);
  const [userDisplayNameSaving, setUserDisplayNameSaving] = useState(false);
  const auditActorDisplayByKeyRef = useRef<Map<string, string>>(new Map());
  const auditActorDisplayMapLoadedRef = useRef(false);
  const loadAuditActorDisplayNameMap = async () => {
    if (!supabase || auditActorDisplayMapLoadedRef.current) return;
    const res = await supabase.from(USER_PROFILE_TABLE).select('user_email, display_name').limit(5000);
    if (res.error) {
      return;
    }
    for (const row of ((res.data as any[]) ?? [])) {
      const email = String(row?.user_email ?? '').trim();
      const display = String(row?.display_name ?? '').trim();
      if (!email || !display) continue;
      auditActorDisplayByKeyRef.current.set(email.toLowerCase(), display);
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
      if (seen.has(key) || auditActorDisplayByKeyRef.current.has(key)) continue;
      seen.add(key);
      missingEmails.push(raw);
    }
    if (missingEmails.length === 0) return;

    const res = await supabase.from(USER_PROFILE_TABLE).select('user_email, display_name').in('user_email', missingEmails as any);
    if (res.error) {
      return;
    }
    for (const row of ((res.data as any[]) ?? [])) {
      const email = String(row?.user_email ?? '').trim();
      const display = String(row?.display_name ?? '').trim();
      if (!email || !display) continue;
      auditActorDisplayByKeyRef.current.set(email.toLowerCase(), display);
    }
  };
  const normalizeAuditActor = (value: unknown) => {
    const raw = String(value ?? '').trim();
    const resolved = auditActorDisplayByKeyRef.current.get(raw.toLowerCase());
    const emailValue = String(user?.email ?? '').trim();
    const displayValue = userDisplayName.trim();
    if (!raw) return raw;
    if (resolved) return resolved;
    if (displayValue && emailValue && raw.toLowerCase() === emailValue.toLowerCase()) {
      return displayValue;
    }
    return raw;
  };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [recentPunches, setRecentPunches] = useState<Record<string, unknown>[]>([]);
  const [recentPunchesError, setRecentPunchesError] = useState<string | null>(null);
  const [employeeByStaffId, setEmployeeByStaffId] = useState<Record<string, { name: string; agency: string }>>({});
  const [punchesSearch, setPunchesSearch] = useState('');

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
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
  const [employeeNewStaffId, setEmployeeNewStaffId] = useState('');
  const [employeeNewName, setEmployeeNewName] = useState('');
  const [employeeNewAgency, setEmployeeNewAgency] = useState('');
  const [employeeNewPosition, setEmployeeNewPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [employeeNewShift, setEmployeeNewShift] = useState<'' | 'early' | 'late'>('');
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
  const [employeeEditShift, setEmployeeEditShift] = useState<'' | 'early' | 'late'>('');
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
  const [timecardSearch, setTimecardSearch] = useState('');
  const [timecardAgency, setTimecardAgency] = useState('');
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
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceFilterPosition, setDeviceFilterPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [deviceFilterType, setDeviceFilterType] = useState<DeviceType | ''>('');
  const [deviceBorrowedOnly, setDeviceBorrowedOnly] = useState(false);

  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scheduleRowsWeekOffset, setScheduleRowsWeekOffset] = useState(0);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [schedulePunchPresenceKeys, setSchedulePunchPresenceKeys] = useState<Set<string>>(new Set());
  const [schedulePunchPresenceReady, setSchedulePunchPresenceReady] = useState(false);
  const [scheduleUphByStaffId, setScheduleUphByStaffId] = useState<Record<string, number | null>>({});
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);
  const [scheduleWeekInput, setScheduleWeekInput] = useState(() => toDateOnly(startOfWeekMonday(new Date())));
  const [schedulePrintDate, setSchedulePrintDate] = useState(() => toDateOnly(new Date()));
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [scheduleSearchInput, setScheduleSearchInput] = useState('');
  const [schedulePosition, setSchedulePosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [schedulePositionToneByPosition, setSchedulePositionToneByPosition] = useState<Record<AllowedPosition, LabelToneKey>>({
    Pick: 'sky',
    Pack: 'emerald',
    Rebin: 'amber',
    Preship: 'rose',
    Transfer: 'violet'
  });
  const [scheduleLabels, setScheduleLabels] = useState<string[]>([]);
  const [scheduleLabelToneByName, setScheduleLabelToneByName] = useState<Record<string, LabelToneKey>>(() =>
    loadLabelToneMap()
  );
  const [scheduleShift, setScheduleShift] = useState<'' | 'early' | 'late'>('');
  const [scheduleSortByUphDesc, setScheduleSortByUphDesc] = useState(false);
  const [scheduleWorkDayFilter, setScheduleWorkDayFilter] = useState<number | null>(null);
  const [scheduleRenderCount, setScheduleRenderCount] = useState(120);
  const [schedulePublishTomorrow, setSchedulePublishTomorrow] = useState(false);
  const [schedulePublishForDate, setSchedulePublishForDate] = useState<string>('');
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
  const [dailyListNewHireNote, setDailyListNewHireNote] = useState('');
  const [dailyListSelectedPositions, setDailyListSelectedPositions] = useState<Record<AllowedPosition, boolean>>(
    createEmptyPositionFlags
  );
  const [dailyListFilterPositions, setDailyListFilterPositions] = useState<Record<AllowedPosition, boolean>>(
    createEmptyPositionFlags
  );
  const deferredScheduleSearch = useDeferredValue(scheduleSearch);
  const deferredEmployeeSearch = useDeferredValue(employeeSearch);
  const deferredAccountSearch = useDeferredValue(accountSearch);
  const deferredAccountPositionFilter = useDeferredValue(accountPositionFilter);
  const deferredSchedulePosition = useDeferredValue(schedulePosition);
  const deferredScheduleShift = useDeferredValue(scheduleShift);
  const deferredScheduleLabels = useDeferredValue(scheduleLabels);
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
      Transfer: 'violet'
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
  const [homeRosterSide, setHomeRosterSide] = useState<'absent' | 'restWorked' | 'onClock'>('absent');
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
    return null;
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
  if (value === 'early') return 'border-amber-400/60 text-amber-200 bg-amber-500/10';
  if (value === 'late') return 'border-indigo-400/60 text-indigo-200 bg-indigo-500/10';
  return 'border-white/20 text-slate-200 bg-white/5';
};
const normalizeShiftValue = (value: string): '' | 'early' | 'late' => {
  const v = value.trim().toLowerCase();
  if (v === 'early' || v === 'day' || v === 'morning') return 'early';
  if (v === 'late' || v === 'night' || v === 'evening') return 'late';
  return '';
};
const getPlannedStartTime = (shift: 'early' | 'late', position: string) => {
  const pos = normalizePositionKey(position) ?? '';
  if (shift === 'early') return pos === 'Pick' ? '07:00' : '08:00';
  return pos === 'Pick' ? '15:30' : '16:30';
};

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
      const maxPages = 10;
      const latestByStaff = new Map<string, { action: 'IN' | 'OUT'; at: string }>();
      const firstInByStaff = new Map<string, { at: string }>();

      for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const res = await supabase
          .from('ob_punches')
          .select('staff_id, action, created_at, id')
          .gte('created_at', rangeStart.toISOString())
          .order('created_at', { ascending: false })
          .range(from, to);

        if (seq !== attendanceFetchSeqRef.current) return;

        if (res.error) {
          if (!isAbortLikeError(res.error.message)) setAttendanceError(res.error.message);
          return;
        }

        const rows = (res.data as any[] | null) ?? [];
        if (rows.length === 0) break;

        for (const r of rows) {
          const staff = String(r.staff_id ?? '').trim();
          if (!staff || latestByStaff.has(staff)) continue;
          const action = String(r.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
          const at = String(r.created_at ?? '').trim();
          if (!at) continue;
          latestByStaff.set(staff, { action, at });
        }

        if (rows.length < pageSize) break;
      }

      for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const res = await supabase
          .from('ob_punches')
          .select('staff_id, created_at, id')
          .eq('action', 'IN')
          .gte('created_at', rangeStart.toISOString())
          .order('created_at', { ascending: true })
          .range(from, to);

        if (seq !== attendanceFetchSeqRef.current) return;

        if (res.error) {
          if (!isAbortLikeError(res.error.message)) setAttendanceError(res.error.message);
          return;
        }

        const rows = (res.data as any[] | null) ?? [];
        if (rows.length === 0) break;

        for (const r of rows) {
          const staff = String(r.staff_id ?? '').trim();
          if (!staff || firstInByStaff.has(staff)) continue;
          const at = String(r.created_at ?? '').trim();
          if (!at) continue;
          firstInByStaff.set(staff, { at });
        }

        if (rows.length < pageSize) break;
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
          if (!isAbortLikeError(res.error.message)) setAttendanceError(res.error.message);
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
        setAttendanceError(String(err?.message ?? err));
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
        ? 5000
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
    next: Record<AllowedPosition, boolean>,
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
    const selectedByDateRaw = (currentValue.selected_by_date ?? null) as Record<string, unknown> | null;
    const selectedByDate: Record<string, Record<AllowedPosition, boolean>> = {};
    if (selectedByDateRaw && typeof selectedByDateRaw === 'object') {
      for (const [dateKey, flagsRaw] of Object.entries(selectedByDateRaw)) {
        if (!isDateOnlyValue(dateKey)) continue;
        const flagsObj = (flagsRaw ?? {}) as Record<string, unknown>;
        selectedByDate[dateKey] = {
          Pick: Boolean(flagsObj.Pick),
          Pack: Boolean(flagsObj.Pack),
          Rebin: Boolean(flagsObj.Rebin),
          Preship: Boolean(flagsObj.Preship),
          Transfer: Boolean(flagsObj.Transfer)
        };
      }
    }
    selectedByDate[targetDate] = next;
    const payload = {
      key: DAILY_LIST_LIGHTS_KEY,
      value: {
        selected_by_date: selectedByDate,
        updated_at: new Date(serverTime).toISOString(),
        operator: user?.email ?? null
      },
      updated_at: new Date(serverTime).toISOString()
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
    const empty = createEmptyPositionFlags();
    let next = empty;

    if (row) {
      const value = (row.value ?? {}) as Record<string, unknown>;
      const selectedByDateRaw = (value.selected_by_date ?? null) as Record<string, unknown> | null;
      if (selectedByDateRaw && typeof selectedByDateRaw === 'object') {
        const byDate = (selectedByDateRaw[targetDate] ?? null) as Record<string, unknown> | null;
        if (byDate && typeof byDate === 'object') {
          next = {
            Pick: Boolean(byDate.Pick),
            Pack: Boolean(byDate.Pack),
            Rebin: Boolean(byDate.Rebin),
            Preship: Boolean(byDate.Preship),
            Transfer: Boolean(byDate.Transfer)
          };
        }
      } else {
        // Backward compatibility for legacy single-day payload.
        const legacyDate = String(value.operational_date ?? '');
        if (legacyDate === targetDate) {
          const rawSelected = (value.selected_positions ?? null) as Record<string, unknown> | null;
          if (rawSelected && typeof rawSelected === 'object') {
            next = {
              Pick: Boolean(rawSelected.Pick),
              Pack: Boolean(rawSelected.Pack),
              Rebin: Boolean(rawSelected.Rebin),
              Preship: Boolean(rawSelected.Preship),
              Transfer: Boolean(rawSelected.Transfer)
            };
          }
        }
      }
    }

    setDailyListSelectedPositions(next);
  };

  const toggleDailyListSelectedPosition = (position: AllowedPosition) => {
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
        setUserDisplayNamePromptOpen(false);
        return;
      }
      const res = await supabase
        .from(USER_PROFILE_TABLE)
        .select('display_name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!active) {
        return;
      }
      if (res.error) {
        setStatus({ tone: 'error', message: t(`读取用户名称失败：${res.error.message}`, `Failed to load profile name: ${res.error.message}`) });
        setUserDisplayName('');
        setUserDisplayNameInput('');
        setUserDisplayNamePromptOpen(true);
        return;
      }
      const nextName = String((res.data as any)?.display_name ?? '').trim();
      setUserDisplayName(nextName);
      setUserDisplayNameInput(nextName);
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
      const upsertRes = await supabase.from(USER_PROFILE_TABLE).upsert(
        [
          {
            user_id: user.id,
            user_email: user.email ?? null,
            display_name: nextName
          }
        ] as any[],
        { onConflict: 'user_id' }
      );
      if (upsertRes.error) {
        setStatus({
          tone: 'error',
          message: t(`保存用户名失败：${upsertRes.error.message}`, `Failed to save profile name: ${upsertRes.error.message}`)
        });
        return;
      }
      setUserDisplayName(nextName);
      setUserDisplayNamePromptOpen(false);
      setStatus({ tone: 'success', message: t('用户名已保存。', 'Profile name saved.') });
    } finally {
      setUserDisplayNameSaving(false);
    }
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
        setStatus({ tone: 'idle', message: 'Signed out' });
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const doLogin = async () => {
    if (!supabase) {
      setStatus({ tone: 'error', message: '缺少 Supabase 配置，请检查环境变量。' });
      return;
    }
    await runLocked('login', async () => {
      setStatus({ tone: 'pending', message: '登录中...' });
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setStatus({ tone: 'error', message: `登录失败：${error.message}` });
        return;
      }
      setStatus({ tone: 'success', message: '登录成功' });
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

  const writeAudit = async ({
    action,
    staffId,
    target,
    payload
  }: {
    action: string;
    staffId?: string | null;
    target?: string | null;
    payload?: any;
  }) => {
    const actorForAudit = userDisplayName.trim() || user?.email || null;
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
      action === 'schedule_temp_work' ||
      action === 'schedule_leave' ||
      action === 'schedule_temp_rest' ||
      action === 'schedule_rest' ||
      action === 'schedule_clear' ||
      action === 'punch_manual_add' ||
      action === 'punch_manual_edit' ||
      action === 'punch_manual_delete'
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

  const fetchAudit = async (options?: { search?: string }) => {
    if (!supabase) {
      setAuditError('缺少 Supabase 配置。');
      setAuditRows([]);
      return;
    }
    const searchValue = (options?.search ?? auditSearch).trim();

    await runLocked('audit', async () => {
      setAuditError(null);
      let q = supabase
        .from(AUDIT_TABLE)
        .select('id, created_at, actor, action, staff_id, target, payload')
        .order('created_at', { ascending: false })
        .limit(200);
      if (searchValue) {
        const term = `%${searchValue}%`;
        q = q.or(`staff_id.ilike.${term},actor.ilike.${term},action.ilike.${term}`);
      }
      const res = await q;
      if (res.error) {
        setAuditError(res.error.message);
        return;
      }
      const rawRows = (((res.data as any[]) ?? []) as AuditRow[]);
      await rememberAuditActorDisplayNames(rawRows.map((row) => row.actor));
      const nextAuditRows = rawRows.map((row) => ({
        ...row,
        actor: normalizeAuditActor((row as any).actor)
      }));
      setAuditRows(nextAuditRows);
    });
  };

  const fetchCellAuditLogs = async () => {
    if (!supabase) {
      setCellAuditRows([]);
      return;
    }
    const actions = [
      'schedule_work',
      'schedule_temp_work',
      'schedule_leave',
      'schedule_temp_rest',
      'schedule_rest',
      'schedule_clear',
      'punch_manual_add',
      'punch_manual_edit',
      'punch_manual_delete'
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
      actor: normalizeAuditActor((row as any).actor)
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

  const fetchDeviceLoans = async ({ lockUi = true }: { lockUi?: boolean } = {}) => {
    if (!supabase) {
      setDeviceLoans([]);
      return;
    }
    const exec = async () => {
      const res = await supabase
        .from(DEVICE_LOANS_TABLE)
        .select('id, created_at, operator, staff_id, device_sn, action, note')
        .order('created_at', { ascending: false })
        .limit(5000);
      if (res.error) {
        setDeviceLoans([]);
        return;
      }
      setDeviceLoans(((res.data as any[]) ?? []) as DeviceLoanRow[]);
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
        await fetchDevices({ lockUi: false });
        await fetchDeviceLoans({ lockUi: false });
      });
      return;
    }
    await fetchDevices({ lockUi: false });
    await fetchDeviceLoans({ lockUi: false });
  };

  const onDeviceFileSelected = async (file: File | null) => {
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
      setDeviceUploadError(t('岗位仅支持 Pick/Pack/Rebin/Preship/Transfer。', 'Position must be Pick/Pack/Rebin/Preship/Transfer.'));
      return;
    }

    await runLocked('device_upload', async () => {
      const upsertRows = async (payloadRows: any[]) =>
        supabase.from(DEVICE_TABLE).upsert(payloadRows as any[], { onConflict: 'device_sn' });

      const isTypeConstraintError = (message: string) => {
        const text = String(message ?? '').toLowerCase();
        return text.includes('device_type_check') || (text.includes('device_type') && text.includes('check constraint'));
      };

      let usedFallbackTypeMapper: string | null = null;
      let res = await upsertRows(rows as any[]);
      if (res.error && isTypeConstraintError(res.error.message)) {
        const fallbackCandidates: Array<{
          name: string;
          mapType: (value: DeviceType) => string;
        }> = [
          { name: 'lowercase', mapType: (value) => value.toLowerCase() },
          { name: 'legacy_car_upper', mapType: (value) => (value === 'CART' ? 'CAR' : 'PDA') },
          { name: 'legacy_car_lower', mapType: (value) => (value === 'CART' ? 'car' : 'pda') }
        ];
        for (const candidate of fallbackCandidates) {
          const payloadRows = rows.map((row) => ({
            ...row,
            device_type: candidate.mapType(row.device_type)
          }));
          const attempt = await upsertRows(payloadRows);
          if (!attempt.error) {
            res = attempt;
            usedFallbackTypeMapper = candidate.name;
            break;
          }
        }
      }
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
          device_type_fallback: usedFallbackTypeMapper
        }
      });
      setDeviceUploadError(null);
      if (deviceFileInputRef.current) deviceFileInputRef.current.value = '';
      setStatus({
        tone: 'success',
        message: t(
          `设备导入成功：${rows.length} 条。${usedFallbackTypeMapper ? '（已自动兼容设备类型格式）' : ''}`,
          `Devices imported: ${rows.length}.${usedFallbackTypeMapper ? ' (device type format auto-adapted)' : ''}`
        )
      });
      await refreshDevicePanel({ lockUi: false });
    });
  };

  const toggleDeviceActive = async (row: DeviceRow) => {
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

  const fetchSchedule = async (options?: { weekOffsetOverride?: number }) => {
    if (!supabase) {
      setScheduleError('缺少 Supabase 配置。');
      setScheduleRows([]);
      return;
    }

    const weekOffset = options?.weekOffsetOverride ?? scheduleWeekOffset;
    const startDate = getTemplateDateByDayIndex(0, weekOffset);
    const endDate = getTemplateDateByDayIndex(6, weekOffset);

    await runLocked('schedule', async () => {
      setScheduleError(null);
      const pageSize = 1000;
      const maxPages = 20;
      const allRows: ScheduleRow[] = [];
      for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const res = await supabase
          .from(SCHEDULE_TABLE)
          .select('id, staff_id, date, position, note, operator, updated_at, created_at')
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false })
          .order('staff_id', { ascending: true })
          .range(from, to);
        if (res.error) {
          if (!isAbortLikeError(res.error.message)) setScheduleError(res.error.message);
          setScheduleRows([]);
          return;
        }
        const rows = (((res.data as any[]) ?? []) as ScheduleRow[]);
        allRows.push(...rows);
        if (rows.length < pageSize) break;
      }

      setScheduleRows(allRows);
      setScheduleRowsWeekOffset(weekOffset);
    });
  };

  const fetchSchedulePublishSetting = async () => {
    if (!supabase) return;
    const res = await supabase
      .from(APP_SETTINGS_TABLE)
      .select('id, key, value, updated_at')
      .eq('key', TOMORROW_LIST_PUBLISH_KEY)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (res.error) return;

    const row = (((res.data as any[]) ?? [])[0] ?? null) as AppSettingRow | null;
    if (!row) {
      setSchedulePublishTomorrow(false);
      setSchedulePublishForDate('');
      return;
    }

    const value = (row.value ?? {}) as Record<string, unknown>;
    setSchedulePublishTomorrow(Boolean(value.enabled));
    setSchedulePublishForDate(String(value.publish_for_date ?? ''));
  };

  const setSchedulePublishSetting = async (enabled: boolean) => {
    if (!supabase) {
      setScheduleError('Missing Supabase configuration.');
      return;
    }
    const tomorrow = addDays(new Date(serverTime), 1);
    const publishForDate = toDateOnly(tomorrow);
    const payload = {
      key: TOMORROW_LIST_PUBLISH_KEY,
      value: {
        enabled,
        publish_for_date: enabled ? publishForDate : '',
        updated_at: new Date(serverTime).toISOString(),
        operator: user?.email ?? null
      },
      updated_at: new Date(serverTime).toISOString()
    };

    await runLocked('schedule_publish_toggle', async () => {
      setScheduleError(null);
      const upsertRes = await supabase.from(APP_SETTINGS_TABLE).upsert([payload as any], { onConflict: 'key' });
      if (upsertRes.error) {
        const updateRes = await supabase.from(APP_SETTINGS_TABLE).update(payload as any).eq('key', TOMORROW_LIST_PUBLISH_KEY);
        if (updateRes.error) {
          const insertRes = await supabase.from(APP_SETTINGS_TABLE).insert([payload as any]);
          if (insertRes.error) {
            setScheduleError(insertRes.error.message);
            return;
          }
        }
      }
      setSchedulePublishTomorrow(enabled);
      setSchedulePublishForDate(enabled ? publishForDate : '');
    });
  };

  const setScheduleCellState = async (
    employee: EmployeeRow,
    dayIndex: number,
    nextState: 'empty' | ScheduleBaseState,
    _targetShift: 'early' | 'late',
    workDate?: string
  ) => {
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
        const clearRes = await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .delete()
          .eq('staff_id', staff)
          .eq('work_date', targetWorkDate)
          .in('mark_type', ['absent', 'excuse', 'temporary_leave'] as any);
        if (clearRes.error) {
          setScheduleError(clearRes.error.message);
          return false;
        }

        const marksToWrite: Array<'absent' | 'excuse' | 'temporary_leave'> = [];
        if (nextState === 'leave') {
          marksToWrite.push('excuse');
        } else if (nextState === 'temp_rest') {
          marksToWrite.push('temporary_leave');
        } else if (nextState === 'work' || nextState === 'temp_work') {
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
            payload: { state: nextState, template_date: templateDate, weekday: dayIndex + 1 },
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

      if (nextState === 'empty') {
        const delRes =
          existing?.id != null
            ? await supabase.from(SCHEDULE_TABLE).delete().eq('id', existing.id as any)
            : await supabase.from(SCHEDULE_TABLE).delete().eq('staff_id', staff).eq('date', templateDate);
        if (delRes.error) {
          setScheduleError(delRes.error.message);
          return;
        }
        setScheduleRows((prev) =>
          prev.filter((row) => {
            const rowStaff = normalizeStaffId(String(row.staff_id ?? '').trim());
            const rowDayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim(), scheduleWeekOffset);
            return !(rowStaff === staff && rowDayIndex === dayIndex);
          })
        );
        await syncAttendanceMark();
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
      await syncAttendanceMark();

      void writeAudit({
        action:
          nextState === 'work'
            ? 'schedule_work'
            : nextState === 'temp_work'
              ? 'schedule_temp_work'
              : nextState === 'leave'
                ? 'schedule_leave'
                : nextState === 'temp_rest'
                  ? 'schedule_temp_rest'
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

  const resetScheduleTransientStatesForWeek = async (options?: { lockUi?: boolean }) => {
    if (!supabase) return;
    const weekStart = toDateOnly(startOfWeekMonday(new Date(serverTime)));
    const lockUi = options?.lockUi ?? true;

    const settingRes = await supabase
      .from(APP_SETTINGS_TABLE)
      .select('key, value, updated_at')
      .eq('key', SCHEDULE_WEEK_RESET_KEY)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (settingRes.error) return;

    const existing = (((settingRes.data as any[]) ?? [])[0] ?? null) as { value?: Record<string, unknown> } | null;
    const existingWeek = String(existing?.value?.week_start ?? '');
    if (existingWeek === weekStart) return;

    const exec = async () => {
      setScheduleError(null);
      const resetRes = await supabase
        .from(SCHEDULE_TABLE)
        .update({
          note: null,
          operator: user?.email ?? null,
          updated_at: new Date(serverTime).toISOString()
        } as any)
        .in('note', [SCHEDULE_TEMP_WORK_NOTE, SCHEDULE_LEAVE_NOTE, SCHEDULE_TEMP_REST_NOTE] as any);

      if (resetRes.error) {
        setScheduleError(resetRes.error.message);
        return;
      }

      const payload = {
        key: SCHEDULE_WEEK_RESET_KEY,
        value: {
          week_start: weekStart,
          updated_at: new Date(serverTime).toISOString(),
          operator: user?.email ?? null
        },
        updated_at: new Date(serverTime).toISOString()
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
          const note = String(row.note ?? '').trim();
          if (note === SCHEDULE_TEMP_WORK_NOTE || note === SCHEDULE_LEAVE_NOTE || note === SCHEDULE_TEMP_REST_NOTE) {
            return { ...row, note: null };
          }
          return row;
        })
      );
    };

    if (!lockUi) {
      await exec();
      return;
    }
    await runLocked('schedule_week_reset', exec);
  };

  const refreshSchedulePanel = async (options?: { lockUi?: boolean }) => {
    const lockUi = options?.lockUi ?? true;
    await resetScheduleTransientStatesForWeek({ lockUi });
    await fetchSchedule();
    const latestEmployees = await fetchEmployees({ reset: true, search: '', agency: '', position: '', labels: [], lockUi });
    await fetchSchedulePublishSetting();
    await fetchSchedulePunchPresence({ employeesOverride: latestEmployees });
    await fetchScheduleUph({ employeesOverride: latestEmployees });
  };

  const refreshHomePanel = async (options?: { lockUi?: boolean }) => {
    const lockUi = options?.lockUi ?? true;
    await fetchSchedule({ weekOffsetOverride: 0 });
    const latestEmployees = await fetchEmployees({ reset: true, search: '', agency: '', position: '', labels: [], lockUi });
    // Home dashboard should use current week punch presence, independent of Schedule page week navigation.
    await fetchSchedulePunchPresence({ employeesOverride: latestEmployees, weekOffsetOverride: 0, mode: 'operational_day' });
  };

  const scheduleWeekRolloverInFlightRef = useRef(false);
  const scheduleWeekRolloverDoneKeyRef = useRef('');
  const maybeRolloverScheduleWeek = async () => {
    if (!supabase || scheduleWeekRolloverInFlightRef.current) return;
    const now = new Date(Date.now() + offsetMs);
    // Rollover should only run on Monday after 05:00 local time.
    // Without this guard, missing marker data could trigger rollover repeatedly on other days.
    if (now.getDay() !== 1) return;
    const thisMonday = startOfWeekMonday(now);
    const rolloverAt = new Date(thisMonday);
    rolloverAt.setHours(5, 0, 0, 0);
    if (now.getTime() < rolloverAt.getTime()) return;
    const weekKey = toDateOnly(rolloverAt);
    if (scheduleWeekRolloverDoneKeyRef.current === weekKey) return;

    scheduleWeekRolloverInFlightRef.current = true;
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
      if (doneWeek === weekKey) {
        scheduleWeekRolloverDoneKeyRef.current = weekKey;
        return;
      }

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
      const migrated = nextRows.map((row) => {
        const rawDate = String(row.date ?? '').trim();
        const dt = new Date(`${rawDate}T00:00:00`);
        const toDate = Number.isNaN(dt.getTime()) ? rawDate : toDateOnly(addDays(dt, -7));
        const rawNote = String(row.note ?? '').trim();
        const normalizedNote =
          rawNote === SCHEDULE_TEMP_REST_NOTE
            ? null // 临时排休 -> 工作
            : rawNote === SCHEDULE_TEMP_WORK_NOTE
              ? SCHEDULE_REST_NOTE // 临时工作 -> 休息
              : row.note ?? null;
        return {
          staff_id: normalizeStaffId(String(row.staff_id ?? '').trim()),
          date: toDate,
          position: String(row.position ?? '').trim() || null,
          note: normalizedNote,
          operator: (user?.email ?? String(row.operator ?? '').trim()) || null,
          updated_at: nowIso
        };
      });
      const upsertRes = await supabase.from(SCHEDULE_TABLE).upsert(migrated as any[], { onConflict: 'staff_id,date' });
      if (upsertRes.error) return;

      const deleteNextRes = await supabase.from(SCHEDULE_TABLE).delete().gte('date', nextStart).lte('date', nextEnd);
      if (deleteNextRes.error) return;

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
  };

  useEffect(() => {
    if (!schedulePicker.open) return;
    const onDocumentClickCapture = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-schedule-popover="true"]')) return;
      if (target.closest('[data-schedule-trigger="true"]')) return;
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

  const fetchSchedulePunchPresence = async (options?: {
    employeesOverride?: EmployeeRow[] | null;
    weekOffsetOverride?: number;
    mode?: 'week' | 'operational_day';
  }) => {
    if (!supabase) {
      setSchedulePunchPresenceKeys(new Set());
      setSchedulePunchPresenceReady(true);
      return;
    }
    setSchedulePunchPresenceReady(false);

    const sourceEmployees = options?.employeesOverride ?? employees;
    const staffSet = new Set(
      sourceEmployees
        .map((e) => normalizeStaffId(String(e.staff_id ?? '').trim()))
        .filter((staff): staff is string => Boolean(staff))
    );
    if (staffSet.size === 0) {
      setSchedulePunchPresenceKeys(new Set());
      setSchedulePunchPresenceReady(true);
      return;
    }

    const mode = options?.mode ?? 'week';
    const dayMs = 24 * 60 * 60 * 1000;
    const found = new Set<string>();
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
        const pageSize = 1000;
        const maxPages = 40;
        for (let page = 0; page < maxPages; page += 1) {
          const from = page * pageSize;
          const to = from + pageSize - 1;
          const res = await supabase
            .from('ob_punches')
            .select('staff_id')
            .in('staff_id', batch)
            .gte('created_at', operationalStart.toISOString())
            .lte('created_at', now.toISOString())
            .order('created_at', { ascending: true })
            .range(from, to);

          if (res.error) {
            setSchedulePunchPresenceKeys(new Set());
            setSchedulePunchPresenceReady(false);
            return;
          }

          const rows = (res.data as any[]) ?? [];
          for (const row of rows) {
            const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
            if (!staff || !staffSet.has(staff)) continue;
            found.add(`${staff}__${dayIndex}`);
          }
          if (rows.length < pageSize) break;
        }
      }

      setSchedulePunchPresenceKeys(found);
      setSchedulePunchPresenceReady(true);
      return;
    }

    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekOffset = options?.weekOffsetOverride ?? scheduleWeekOffset;
    const weekStart = addDays(baseWeekStart, weekOffset * 7);
    const { start, end } = getDayRange(weekStart, 0, 7);
    const day0StartMs = start.getTime();

    for (const batch of staffBatches) {
      const pageSize = 1000;
      const maxPages = 40;
      for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const res = await supabase
          .from('ob_punches')
          .select('staff_id, action, created_at')
          .in('staff_id', batch)
          .gte('created_at', start.toISOString())
          .lt('created_at', end.toISOString())
          .order('created_at', { ascending: true })
          .range(from, to);

        if (res.error) {
          setSchedulePunchPresenceKeys(new Set());
          setSchedulePunchPresenceReady(false);
          return;
        }

        const rows = (res.data as any[]) ?? [];
        for (const row of rows) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          if (!staff || !staffSet.has(staff)) continue;
          const at = new Date(String(row.created_at ?? ''));
          if (Number.isNaN(at.getTime())) continue;
          const action = String((row as any).action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
          const dayIndex = Math.floor((getOperationalBucketTimeMs(at, action) - day0StartMs) / dayMs);
          if (dayIndex < 0 || dayIndex > 6) continue;
          found.add(`${staff}__${dayIndex}`);
        }

        if (rows.length < pageSize) break;
      }
    }

    setSchedulePunchPresenceKeys(found);
    setSchedulePunchPresenceReady(true);
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
      const pageSize = 1000;
      const maxPages = 20;
      for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const detailsRes = await obupSupabase
          .from(OBUP_REPORT_DETAILS_TABLE)
          .select('report_id, operator, uph')
          .in('report_id', batch as any[])
          .range(from, to);
        if (detailsRes.error) {
          if (requestId === scheduleUphRequestRef.current) setScheduleUphByStaffId({});
          return;
        }

        const rows =
          (detailsRes.data as Array<{ report_id?: string | null; operator?: string | null; uph?: number | null }> | null) ?? [];
        for (const row of rows) {
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

        if (rows.length < pageSize) break;
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
    lockUi: lockUiOption
  }: {
    reset: boolean;
    search?: string;
    agency?: string;
    position?: string;
    labels?: string[];
    lockUi?: boolean;
  }): Promise<EmployeeRow[] | null> => {
    if (!supabase) {
      setEmployeesError('缺少 Supabase 配置。');
      return null;
    }

    const lockUi = lockUiOption ?? true;

    let fetchedEmployees: EmployeeRow[] | null = null;

    const exec = async () => {
      setEmployeesError(null);

      const pageSize = 200;
      const rangeEnd = new Date(serverTime);
      const rangeStart = addDays(rangeEnd, -SHIFT_ANALYSIS_DAYS);

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
      let from = 0;
      let done = false;
      while (!done) {
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
        all.push(...rows);
        if (rows.length < pageSize) {
          done = true;
        } else {
          from += pageSize;
        }
      }

      setEmployees(
        all.map((row) => {
          const workAccount = String((row as any)?.work_account ?? (row as any)?.WorkAccount ?? '').trim();
          const workPassword = String((row as any)?.work_password ?? (row as any)?.WorkPassword ?? '').trim();
          return {
            ...row,
            work_password: resolveDefaultWorkPassword(workAccount, workPassword)
          } as EmployeeRow;
        }).filter((row) => isEmployeeActive(row))
      );
      setEmployeesHasMore(false);
      fetchedEmployees = all.filter((row) => isEmployeeActive(row));

      const staffIdsRaw = all.map((e) => String(e.staff_id ?? '').trim()).filter(Boolean);
      const staffIds = Array.from(new Set(staffIdsRaw.map((id) => normalizeStaffId(id)).filter(Boolean)));
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
      if (staffIds.length === 0) {
        setEmployeeShiftByStaffId({});
        setEmployeeLastPunchAtByStaffId({});
        return;
      }

      const fetchLatestPunchAtByStaff = async (ids: string[]) => {
        const out: Record<string, string | null> = {};
        const batches = chunk(ids, 200);
        const pageSize = 1000;
        const maxPages = 60;

        for (const batch of batches) {
          const found = new Set<string>();
          const base = () => supabase.from('ob_punches').select('staff_id, created_at, id').in('staff_id', batch);

          for (let page = 0; page < maxPages; page += 1) {
            const from = page * pageSize;
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
            if (page === maxPages - 1) {
              return { map: {} as Record<string, string | null>, error: 'Punch data too large when reading latest punch time.' };
            }
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

      const fetchPunchesForStaff = async (ids: string[]) => {
        const batches = chunk(ids, 200);
        const allRows: Array<{ staff_id: string; action: string; created_at: string | null; id?: any }> = [];
        const punchPageSize = 1000;
        const maxPages = 80;

        for (const batch of batches) {
          const base = () =>
            supabase
              .from('ob_punches')
              .select('id, staff_id, action, created_at')
              .in('staff_id', batch)
              .gte('created_at', rangeStart.toISOString())
              .lt('created_at', rangeEnd.toISOString());

          for (let page = 0; page < maxPages; page += 1) {
            const from = page * punchPageSize;
            const to = from + punchPageSize - 1;
            const attemptCreatedAt = await base().order('created_at', { ascending: true }).range(from, to);
            const attempt = attemptCreatedAt.error
              ? await base().order('id', { ascending: true }).range(from, to)
              : attemptCreatedAt;
            if (attempt.error) {
              return { rows: null as any, error: attempt.error.message };
            }
            const rows = (attempt.data as any[] | null) ?? [];
            allRows.push(...rows);
            if (rows.length < punchPageSize) break;
            if (page === maxPages - 1) {
              return { rows: null as any, error: 'Punch data too large; please narrow shift analysis range.' };
            }
          }
        }

        return { rows: allRows, error: null as string | null };
      };

      const punchesRes = await fetchPunchesForStaff(staffIdsForQuery);
      if (punchesRes.error) {
        setEmployeeShiftByStaffId({});
        return;
      }

      const eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT' }>> = {};
      for (const p of punchesRes.rows ?? []) {
        const staff = normalizeStaffId(String(p.staff_id ?? '').trim());
        const action = String(p.action ?? '').toUpperCase();
        const atRaw = String(p.created_at ?? '').trim();
        if (!staff || (action !== 'IN' && action !== 'OUT') || !atRaw) continue;
        const at = new Date(atRaw);
        if (Number.isNaN(at.getTime())) continue;
        (eventsByStaff[staff] ??= []).push({ at, action: action === 'OUT' ? 'OUT' : 'IN' });
      }
      for (const staff of Object.keys(eventsByStaff)) {
        eventsByStaff[staff]!.sort((a, b) => a.at.getTime() - b.at.getTime());
      }

      const shiftMap: Record<string, { shift: '' | 'early' | 'late'; earlyHours: number; lateHours: number }> = {};
      for (const emp of fetchedEmployees ?? []) {
        const s = normalizeStaffId(String(emp.staff_id ?? '').trim());
        if (!s) continue;
        const dbShift = normalizeShiftValue(String(emp.shift ?? '').trim());
        shiftMap[s] = { shift: dbShift, earlyHours: 0, lateHours: 0 };
      }
      setEmployeeShiftByStaffId(shiftMap);
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
    const shift = employeeNewShift;
    const label = employeeNewLabel.trim();
    const workAccount = employeeNewWorkAccount.trim();
    const workPassword = resolveDefaultWorkPassword(workAccount, employeeNewWorkPassword.trim());
    const normalizedPos = normalizePositionKey(position);
    if (!normalizedPos) {
      setEmployeesError(`Position 只能是：${ALLOWED_POSITIONS.join(', ')}`);
      return;
    }

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
              shift: shift || null,
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
              shift: shift || null,
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
        payload: { staff_id: staff, name, agency, position: normalizedPos, shift, label, work_account: workAccount, work_password: workPassword }
      });
      setEmployeeNewStaffId('');
      setEmployeeNewName('');
      setEmployeeNewAgency('');
      setEmployeeNewPosition('');
      setEmployeeNewShift('');
      setEmployeeNewLabel('');
      setEmployeeNewWorkAccount('');
      setEmployeeNewWorkPassword('');
      setEmployeeAddOpen(false);
      await fetchEmployees({ reset: true });
    });
  };

  const deleteEmployeeRow = async (staffId: string) => {
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
          actor: normalizeAuditActor((row as any).actor)
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
        <div class="kicker">OUTBOUNT DEVICE</div>
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
    shift: '' | 'early' | 'late';
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
    setEmployeeEditShift(payload.shift);
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
    setEmployeeEditShift('');
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
    setEmployeeNewShift('');
    setEmployeeNewLabel('');
    setEmployeeNewWorkAccount('');
    setEmployeeNewWorkPassword('');
  };

  const saveEmployeeEdit = async () => {
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
    const label = employeeEditLabel.trim();
    const workAccount = employeeEditWorkAccount.trim();
    const workPassword = resolveDefaultWorkPassword(workAccount, employeeEditWorkPassword.trim());
    const normalizedPos = positionRaw ? normalizePositionKey(positionRaw) : null;
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
            ? 'staff_id,name,"Agency","Position",label,work_account,work_password'
            : 'staff_id,name,agency,position,label,work_account,work_password'
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
              shift: employeeEditShift || null,
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
              shift: employeeEditShift || null,
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
                  label: originalEmployeeRow.label ?? originalEmployeeRow.Label ?? null,
                  work_account: originalEmployeeRow.work_account ?? originalEmployeeRow.WorkAccount ?? null,
                  work_password: originalEmployeeRow.work_password ?? originalEmployeeRow.WorkPassword ?? null
                }
              : {
                  staff_id: String(originalEmployeeRow.staff_id ?? originalStaff),
                  name: originalEmployeeRow.name ?? null,
                  agency: originalEmployeeRow.agency ?? null,
                  position: originalEmployeeRow.position ?? null,
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
            label: String(originalEmployeeRow.label ?? originalEmployeeRow.Label ?? '').trim(),
            work_account: String(originalEmployeeRow.work_account ?? originalEmployeeRow.WorkAccount ?? '').trim(),
            work_password: String(originalEmployeeRow.work_password ?? originalEmployeeRow.WorkPassword ?? '').trim()
          },
          after: {
            staff_id: nextStaff,
            name,
            agency,
            position: normalizedPos ?? '',
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

  const formatHours = (value: number) => {
    const rounded = Math.round(value * 100) / 100;
    if (rounded <= 0) return '';
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  };

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
      if (state === 'work') return t('工作', 'Work');
      if (state === 'temp_work') return t('临时工作', 'Temporary Work');
      if (state === 'leave') return t('请假', 'Excuse');
      if (state === 'temp_rest') return t('临时排休', 'Temporary Off');
      if (state === 'rest') return t('休息', 'Off');
      if (state === 'rest_worked') return t('休息', 'Off');
      if (state === 'absent') return t('缺勤', 'Absent');
      if (state === 'empty') return t('休息', 'Off');
      if (state === '工作') return t('工作', 'Work');
      if (state === '临时工作') return t('临时工作', 'Temporary Work');
      if (state === '请假') return t('请假', 'Excuse');
      if (state === '临时排休') return t('临时排休', 'Temporary Off');
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
    } else if (action === 'schedule_temp_work') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('temp_work');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_leave') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('leave');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_temp_rest') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('temp_rest');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_rest') {
      const fromState = getScheduleFromState('empty');
      const toState = getScheduleToState('rest');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
    } else if (action === 'schedule_clear') {
      const fromState = getScheduleFromState('rest');
      const toState = getScheduleToState('empty');
      summary = `${fmtScheduleState(fromState)} -> ${fmtScheduleState(toState)}`;
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
      action === 'schedule_rest' ||
      action === 'schedule_temp_work' ||
      action === 'schedule_temp_rest' ||
      action === 'schedule_leave' ||
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
      value === 'empty' || value === 'work' || value === 'temp_work' || value === 'leave' || value === 'temp_rest' || value === 'rest';
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
      if (fromStateRaw === 'empty') {
        const delRes = await supabase.from(SCHEDULE_TABLE).delete().eq('staff_id', staff).eq('date', templateDate);
        if (delRes.error) {
          setStatus({ tone: 'error', message: `${t('撤销失败：', 'Undo failed: ')}${delRes.error.message}` });
          return;
        }
        setScheduleRows((prev) =>
          prev.filter((item) => {
            const itemStaff = normalizeStaffId(String(item.staff_id ?? '').trim());
            const itemDate = String(item.date ?? '').trim();
            return !(itemStaff === staff && itemDate === templateDate);
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

  const fetchTimecard = async ({
    reset,
    weekOffset,
    search,
    agency,
    position,
    missingEmployeeOnly,
    lockUi
  }: {
    reset: boolean;
    weekOffset?: number;
    search?: string;
    agency?: string;
    position?: string;
    missingEmployeeOnly?: boolean;
    lockUi?: boolean;
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
    const nowMs = serverTime.getTime();
    const closedDayByIndex = Array.from({ length: 7 }, (_, dayIndex) => {
      const { end } = getDayRange(weekStart, dayIndex);
      return end.getTime() <= nowMs;
    });

    const pageSize = 200;

    const fetchProfilesByStaffId = async (staffIds: string[]) => {
      if (isStale()) {
        return {
          staffToProfile: new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late' }>(),
          error: STALE_TIMECARD_REQUEST
        };
      }
      const staffToProfile = new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late' }>();
      if (!supabase) {
        return { staffToProfile, error: 'Missing Supabase config.' };
      }
      if (staffIds.length === 0) {
        return { staffToProfile, error: null as string | null };
      }

      const mode = await resolveEmployeeColumnMode();
      if (isStale()) {
        return {
          staffToProfile: new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late' }>(),
          error: STALE_TIMECARD_REQUEST
        };
      }
      const batches = chunk(staffIds, 200);
      for (const batch of batches) {
        const run = async (m: EmployeeColumnMode) => {
          const select = m === 'cased' ? 'staff_id, name, "Agency", "Position", shift' : 'staff_id, name, agency, position, shift';
          return await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', batch);
        };

        let res = await run(mode);
        if (isStale()) {
          return {
            staffToProfile: new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late' }>(),
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
            staffToProfile: new Map<string, { name: string; agency: string; position: string; shift: '' | 'early' | 'late' }>(),
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
            shift: normalizeShiftValue(String(r.shift ?? '').trim())
          });
        }
      }

      return { staffToProfile, error: null as string | null };
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
      if (!supabase || staffIds.length === 0) {
        return { scheduledByStaff, scheduleStateByStaff, error: null as string | null };
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
            error: STALE_TIMECARD_REQUEST
          };
        }
        if (error) {
          return {
            scheduledByStaff: {} as Record<string, boolean[]>,
            scheduleStateByStaff: {} as Record<string, ScheduleBaseState[]>,
            error: error.message
          };
        }
        for (const row of (data as any[] | null) ?? []) {
          const staff = String(row.staff_id ?? '').trim();
          const dayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim(), offset);
          if (!staff || dayIndex === null) continue;
          const arr = (scheduledByStaff[staff] ??= new Array(7).fill(false) as boolean[]);
          const stateArr = (scheduleStateByStaff[staff] ??= new Array(7).fill('work') as ScheduleBaseState[]);
          const state = getScheduleBaseStateFromNote((row as ScheduleRow).note);
          stateArr[dayIndex] = state;
          arr[dayIndex] = isWorkingScheduleBaseState(state);
        }
      }
      return { scheduledByStaff, scheduleStateByStaff, error: null as string | null };
    };

    const fetchAttendanceMarksByStaff = async (staffIds: string[]) => {
      if (isStale()) {
        return {
          marksByStaff: {} as Record<string, { absentByDay: boolean[]; leaveByDay: boolean[]; tempRestByDay: boolean[] }>,
          error: STALE_TIMECARD_REQUEST
        };
      }
      const marksByStaff: Record<string, { absentByDay: boolean[]; leaveByDay: boolean[]; tempRestByDay: boolean[] }> = {};
      if (!supabase || staffIds.length === 0) {
        return { marksByStaff, error: null as string | null };
      }

      const weekStartDate = toDateOnly(weekStart);
      const weekEndDate = toDateOnly(addDays(weekStart, 6));
      const batches = chunk(staffIds, 200);
      for (const batch of batches) {
        const { data, error } = await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .select('staff_id, work_date, mark_type')
          .in('staff_id', batch)
          .gte('work_date', weekStartDate)
          .lte('work_date', weekEndDate)
          .in('mark_type', ['absent', 'excuse', 'temporary_leave'] as any);
        if (isStale()) {
          return {
            marksByStaff: {} as Record<string, { absentByDay: boolean[]; leaveByDay: boolean[]; tempRestByDay: boolean[] }>,
            error: STALE_TIMECARD_REQUEST
          };
        }
        if (error) {
          return {
            marksByStaff: {} as Record<string, { absentByDay: boolean[]; leaveByDay: boolean[]; tempRestByDay: boolean[] }>,
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
            tempRestByDay: new Array(7).fill(false) as boolean[]
          });
          if (markType === 'absent') rec.absentByDay[dayIndex] = true;
          if (markType === 'excuse') rec.leaveByDay[dayIndex] = true;
          if (markType === 'temporary_leave') rec.tempRestByDay[dayIndex] = true;
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

      const punchPageSize = 1000;
      const maxPages = 80;
      const all: any[] = [];

      const base = () =>
        supabase
          .from('ob_punches')
          .select('id, staff_id, action, created_at')
          .gte('created_at', rangeStart.toISOString())
          .lt('created_at', rangeEnd.toISOString());

      for (let page = 0; page < maxPages; page += 1) {
        if (isStale()) {
          return { rows: [] as any[], error: STALE_TIMECARD_REQUEST };
        }
        const from = page * punchPageSize;
        const to = from + punchPageSize - 1;
        const attemptCreatedAt = await base().order('created_at', { ascending: true }).range(from, to);
        const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: true }).range(from, to) : attemptCreatedAt;
        if (attempt.error) {
          return { rows: [] as any[], error: attempt.error.message };
        }
        const rows = (attempt.data as any[] | null) ?? [];
        if (rows.length === 0) break;
        all.push(...rows);
        if (rows.length < punchPageSize) break;
      }

      if (all.length >= punchPageSize * maxPages) {
        return { rows: [] as any[], error: 'Too many punch rows; please narrow the date range.' };
      }

      return { rows: all, error: null as string | null };
    };

    const buildTimecardRow = ({
      staff,
      name,
      agency,
      position,
      profileShift,
      eventsByStaff,
      scheduledByStaff,
      scheduleStateByStaff,
      marksByStaff,
      capEnd
    }: {
      staff: string;
      name: string;
      agency: string;
      position: string;
      profileShift: '' | 'early' | 'late';
      eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT'; manual: boolean }>>;
      scheduledByStaff: Record<string, boolean[]>;
      scheduleStateByStaff: Record<string, ScheduleBaseState[]>;
      marksByStaff: Record<string, { absentByDay: boolean[]; leaveByDay: boolean[]; tempRestByDay: boolean[] }>;
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
        tempRestByDay: new Array(7).fill(false) as boolean[]
      };
      const absentByDay = [...markRec.absentByDay];
      const leaveByDay = [...markRec.leaveByDay];
      const tempRestByDay = [...markRec.tempRestByDay];
      const scheduleStates = scheduleStateByStaff[staff] ?? (new Array(7).fill('work') as ScheduleBaseState[]);
      const restByDay = scheduleStates.map((state) => state === 'rest');
      const absentVisibleByNoon = Array.from({ length: 7 }, (_, idx) => {
        const workDate = toDateOnly(addDays(weekStart, idx));
        const noon = new Date(`${workDate}T00:00:00`);
        if (Number.isNaN(noon.getTime())) return false;
        noon.setHours(TIMECARD_ABSENT_VISIBLE_HOUR, 0, 0, 0);
        return capEnd.getTime() >= noon.getTime();
      });
      for (let idx = 0; idx < 7; idx += 1) {
        const isWorking = isWorkingScheduleBaseState(scheduleStates[idx] ?? 'work');
        if (!isWorking) continue;
        if (!scheduledByDay[idx]) continue;
        if (hasPunchByDay[idx]) continue;
        if (leaveByDay[idx] || tempRestByDay[idx]) continue;
        if (!absentVisibleByNoon[idx]) continue;
        absentByDay[idx] = true;
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
        restByDay,
        inProgressByDay,
        inProgressWeek,
        manualByDay,
        manualWeek,
        totalHours,
        shift
      };
    };

    const exec = async (from: number) => {
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
            eventsByStaff,
            scheduledByStaff: scheduledRes.scheduledByStaff,
            scheduleStateByStaff: scheduledRes.scheduleStateByStaff,
            marksByStaff: marksRes.marksByStaff,
            capEnd
          });
        });

        return { rows, hasMore: false, error: null as string | null };
      }

      const to = from + pageSize - 1;

      const mode = await resolveEmployeeColumnMode();
      const buildEmployees = (m: EmployeeColumnMode) => {
        const agencyCol = m === 'cased' ? 'Agency' : 'agency';
        const positionCol = m === 'cased' ? 'Position' : 'position';
        const select = m === 'cased' ? 'staff_id, name, "Agency", "Position", shift' : 'staff_id, name, agency, position, shift';

        let q = supabase.from(EMPLOYEE_TABLE).select(select).order('staff_id', { ascending: true }).range(from, to);
        q = q.eq('active', true);
        if (agencyValue) q = q.ilike(agencyCol as any, agencyValue);
        if (positionValue) {
          const normalized = normalizePositionKey(positionValue);
          q = normalized ? q.ilike(positionCol as any, normalized) : q.ilike(positionCol as any, `%${positionValue}%`);
        }
        if (searchValue) {
          const term = `%${searchValue}%`;
          q = q.or(`staff_id.ilike.${term},name.ilike.${term}`);
        }
        return q;
      };

      let employeesAttempt = await buildEmployees(mode);
      if (employeesAttempt.error && /active/i.test(String(employeesAttempt.error.message ?? ''))) {
        const buildEmployeesNoActive = (m: EmployeeColumnMode) => {
          const agencyCol = m === 'cased' ? 'Agency' : 'agency';
          const positionCol = m === 'cased' ? 'Position' : 'position';
          const select = m === 'cased' ? 'staff_id, name, "Agency", "Position", shift' : 'staff_id, name, agency, position, shift';
          let q = supabase.from(EMPLOYEE_TABLE).select(select).order('staff_id', { ascending: true }).range(from, to);
          if (agencyValue) q = q.ilike(agencyCol as any, agencyValue);
          if (positionValue) {
            const normalized = normalizePositionKey(positionValue);
            q = normalized ? q.ilike(positionCol as any, normalized) : q.ilike(positionCol as any, `%${positionValue}%`);
          }
          if (searchValue) {
            const term = `%${searchValue}%`;
            q = q.or(`staff_id.ilike.${term},name.ilike.${term}`);
          }
          return q;
        };
        employeesAttempt = await buildEmployeesNoActive(mode);
      }
      if (isStale()) {
        return { rows: [] as TimecardRow[], hasMore: false, error: STALE_TIMECARD_REQUEST };
      }
      let employeeRows: EmployeeRow[] | null = null;
      if (employeesAttempt.error) {
        const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
        employeeColumnModeRef.current = flipped;
        const retry = await buildEmployees(flipped);
        if (retry.error) {
          return { rows: [] as TimecardRow[], hasMore: false, error: retry.error.message };
        }
        employeeRows = (retry.data as EmployeeRow[] | null) ?? [];
      } else {
        employeeRows = (employeesAttempt.data as EmployeeRow[] | null) ?? [];
      }

      const employees = employeeRows ?? [];
      const employeeByStaffId = new Map<string, { staff_id: string; name: string; agency: string; position: string; shift: '' | 'early' | 'late' }>();
      for (const e of employees) {
        const staff = String(e.staff_id ?? '').trim();
        if (!staff) continue;
        const name = String(e.name ?? '').trim();
        const agency = String(e.agency ?? e.Agency ?? '').trim();
        const position = String(e.position ?? e.Position ?? '').trim();
        const shift = normalizeShiftValue(String(e.shift ?? '').trim());
        const existing = employeeByStaffId.get(staff);
        if (!existing) {
          employeeByStaffId.set(staff, { staff_id: staff, name, agency, position, shift });
          continue;
        }
        // Keep first row order, but fill missing fields from duplicate rows.
        if (!existing.name && name) existing.name = name;
        if (!existing.agency && agency) existing.agency = agency;
        if (!existing.position && position) existing.position = position;
        if (!existing.shift && shift) existing.shift = shift;
      }
      const uniqueEmployees = Array.from(employeeByStaffId.values());
      const staffIds = uniqueEmployees.map((e) => e.staff_id);
      if (staffIds.length === 0) {
        return { rows: [] as TimecardRow[], hasMore: false, error: null as string | null };
      }

      const fetchPunchesForStaff = async (ids: string[]) => {
        // chunk + paginate to avoid PostgREST row truncation when viewing all staff
        const batches = chunk(ids, 200);
        const all: Array<{ staff_id: string; action: string; created_at: string | null; id?: any }> = [];
        for (const batch of batches) {
          const pageSize = 1000;
          const maxPages = 80;
          const base = () =>
            supabase
              .from('ob_punches')
              .select('id, staff_id, action, created_at')
              .in('staff_id', batch)
              .gte('created_at', rangeStart.toISOString())
              .lt('created_at', rangeEnd.toISOString());

          for (let page = 0; page < maxPages; page += 1) {
            if (isStale()) {
              return { rows: [] as any[], error: STALE_TIMECARD_REQUEST };
            }
            const from = page * pageSize;
            const to = from + pageSize - 1;
            const attemptCreatedAt = await base().order('created_at', { ascending: true }).range(from, to);
            const attempt = attemptCreatedAt.error
              ? await base().order('id', { ascending: true }).range(from, to)
              : attemptCreatedAt;
            if (attempt.error) {
              return { rows: null as any, error: attempt.error.message };
            }
            const rows = (((attempt.data as any[]) ?? []) as any[]) as Array<{
              staff_id: string;
              action: string;
              created_at: string | null;
              id?: any;
            }>;
            if (rows.length === 0) break;
            all.push(...rows);
            if (rows.length < pageSize) break;
          }
        }
        return { rows: all, error: null as string | null };
      };

      const [punchesRes, scheduledRes, marksRes] = await Promise.all([
        fetchPunchesForStaff(staffIds),
        fetchScheduledByStaff(staffIds),
        fetchAttendanceMarksByStaff(staffIds)
      ]);
      if (isStale()) {
        return { rows: [] as TimecardRow[], hasMore: false, error: STALE_TIMECARD_REQUEST };
      }
      if (punchesRes.error) {
        return { rows: [] as TimecardRow[], hasMore: false, error: punchesRes.error };
      }

      const eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT'; manual: boolean }>> = {};
      for (const p of punchesRes.rows ?? []) {
        const staff = String(p.staff_id ?? '').trim();
        const action = String(p.action ?? '').toUpperCase();
        const atRaw = String(p.created_at ?? '').trim();
        if (!staff || (action !== 'IN' && action !== 'OUT') || !atRaw) continue;
        const at = new Date(atRaw);
        if (Number.isNaN(at.getTime())) continue;
        const manual = false;
        (eventsByStaff[staff] ??= []).push({ at, action, manual });
      }
      for (const staff of Object.keys(eventsByStaff)) {
        eventsByStaff[staff]!.sort((a, b) => a.at.getTime() - b.at.getTime());
      }

      const now = new Date(serverTime);
      const capEnd = new Date(clamp(now.getTime(), rangeStart.getTime(), rangeEnd.getTime()));
      if (scheduledRes.error) {
        return { rows: [] as TimecardRow[], hasMore: false, error: scheduledRes.error };
      }
      if (marksRes.error) {
        return { rows: [] as TimecardRow[], hasMore: false, error: marksRes.error };
      }

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
          eventsByStaff,
          scheduledByStaff: scheduledRes.scheduledByStaff,
          scheduleStateByStaff: scheduledRes.scheduleStateByStaff,
          marksByStaff: marksRes.marksByStaff,
          capEnd
        });
      });

      return { rows, hasMore: employees.length === pageSize, error: null as string | null };
    };

    const fetchAll = async () => {
      const all: TimecardRow[] = [];
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        if (isStale()) {
          return { rows: [] as TimecardRow[], hasMore: false, error: STALE_TIMECARD_REQUEST };
        }
        const result = await exec(from);
        if (result.error) {
          return { rows: [] as TimecardRow[], hasMore: false, error: result.error };
        }
        all.push(...result.rows);
        hasMore = result.hasMore;
        from += pageSize;
        if (result.rows.length === 0) {
          hasMore = false;
        }
      }
      return { rows: all, hasMore: false, error: null as string | null };
    };

    const shouldLockUi = lockUi ?? true;
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
    });
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

      const weekRange = getDayRange(weekStart, 0, 7);
      const dayIndexByDate = new Map<string, number>();
      weekDateByIndex.forEach((d, idx) => dayIndexByDate.set(d, idx));
      const hasPunchByStaffDay = new Set<string>();

      const pageSize = 1000;
      const maxPages = 80;
      for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const res = await supabase
          .from('ob_punches')
          .select('staff_id, action, created_at, id')
          .gte('created_at', weekRange.start.toISOString())
          .lt('created_at', weekRange.end.toISOString())
          .order('created_at', { ascending: true })
          .range(from, to);
        if (res.error) {
          setStatus({ tone: 'error', message: `重算失败：${res.error.message}` });
          return;
        }
        const rows = (res.data as any[] | null) ?? [];
        if (rows.length === 0) break;
        for (const row of rows) {
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
        if (rows.length < pageSize) break;
      }

      const now = new Date(serverTime);
      const marksToInsert: Array<{
        staff_id: string;
        work_date: string;
        mark_type: 'absent' | 'excuse' | 'temporary_leave';
        source: string;
        operator: string | null;
        payload: Record<string, unknown>;
        updated_at: string;
      }> = [];

      for (const [key, state] of stateByStaffDay.entries()) {
        const [staff, dayIndexRaw] = key.split('__');
        const dayIndex = Number(dayIndexRaw);
        if (!staff || !Number.isFinite(dayIndex) || dayIndex < 0 || dayIndex > 6) continue;
        const workDate = weekDateByIndex[dayIndex];
        if (!workDate) continue;

        if (state === 'leave') {
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
        if (state === 'temp_rest') {
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

      const clearRes = await supabase
        .from(ATTENDANCE_MARKS_TABLE)
        .delete()
        .gte('work_date', weekDateByIndex[0] ?? '')
        .lte('work_date', weekDateByIndex[6] ?? '')
        .in('mark_type', ['absent', 'excuse', 'temporary_leave'] as any);
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

      setStatus({
        tone: 'success',
        message: `已重算本周标记：${weekDateByIndex[0]} ~ ${weekDateByIndex[6]}（${marksToInsert.length} 条）`
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

      const pageSize = 1000;
      const maxPages = 20;
      const punches: Array<{ staff_id: string; action: 'IN' | 'OUT'; created_at: string }> = [];

      for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const res = await supabase
          .from('ob_punches')
          .select('staff_id, action, created_at, id')
          .gte('created_at', dayStart.toISOString())
          .lt('created_at', dayEnd.toISOString())
          .order('created_at', { ascending: true })
          .range(from, to);

        if (res.error) {
          setStatus({ tone: 'error', message: `导出失败：${res.error.message}` });
          return;
        }

        const rows = (res.data as any[] | null) ?? [];
        if (rows.length === 0) break;

        for (const r of rows) {
          const staff = String(r.staff_id ?? '').trim();
          const action = String(r.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN';
          const at = String(r.created_at ?? '').trim();
          if (!staff || !at) continue;
          punches.push({ staff_id: staff, action, created_at: at });
        }

        if (rows.length < pageSize) break;
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

  const addTimecardPunchRow = async () => {
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
    const dayDateForAudit = dayRangeForAudit ? toDateOnly(dayRangeForAudit.start) : '';

    if (changed.length === 0 && deleteIds.length === 0 && pendingAdds.length === 0) {
      setTimecardPunchError(null);
      setStatus({ tone: 'idle', message: t('没有可保存的改动。', 'No changes to save.') });
      closeTimecardPunchModal();
      void fetchTimecard({ reset: true, lockUi: false });
      void refreshHomePanel();
      void refreshSchedulePanel();
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

        const updateJobs = changed.map(async (item) => {
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
                  edited_at: new Date(serverTime).toISOString()
                }
              : {
                  device: 'admin_console',
                  kind: 'manual_edit',
                  manual: true,
                  operator: user?.email ?? null,
                  edited_at: new Date(serverTime).toISOString()
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
      }
    });
    if (saveFailed) return;
    setStatus({ tone: 'success', message: t('打卡流水已保存。', 'Punch records saved.') });
    closeTimecardPunchModal();
    void fetchCellAuditLogs();
    void fetchTimecard({ reset: true, lockUi: false });
  };
  const deleteTimecardPunchRow = async (row: PunchRow) => {
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
      if (employees.length > 0) {
        await fetchSchedulePunchPresence({ employeesOverride: employees, weekOffsetOverride: 0, mode: 'operational_day' });
      }
    };
    void sync();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void sync();
    }, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user, offsetMs, page, employees]);

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
  }, [page, employees]);

  useEffect(() => {
    if (page !== 'schedule') return;
    void maybeRolloverScheduleWeek();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void maybeRolloverScheduleWeek();
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
    const allowedPositions = ['Pack', 'Pick', 'Rebin', 'Preship', 'Transfer'] as const;
    const normalizePosition = (positionRaw: string) => {
      const v = positionRaw.trim().toLowerCase();
      const map: Record<string, (typeof allowedPositions)[number]> = {
        pack: 'Pack',
        pick: 'Pick',
        rebin: 'Rebin',
        preship: 'Preship',
        transfer: 'Transfer'
      };
      return map[v] ?? null;
    };

    const uniqueByStaff = new Map<
      string,
      { staff_id: string; name?: string; agency?: string; position?: string; label?: string; work_account?: string; work_password?: string }
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
      const label = canonical.label?.trim();
      const workAccount = canonical.work_account?.trim();
      const workPassword = canonical.work_password?.trim();

      const record: {
        staff_id: string;
        name?: string;
        agency?: string;
        position?: string;
        label?: string;
        work_account?: string;
        work_password?: string;
      } = { staff_id: staff };
      if (name) record.name = name;
      if (agency) record.agency = agency;
      if (position) record.position = position;
      if (positionRaw && !position) record.position = positionRaw;
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
        `Position 只允许 Pack / Pick / Rebin / Preship / Transfer。发现不合法值：${sample}${
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
              ? 'staff_id, name, "Agency", "Position", label, work_account, work_password'
              : 'staff_id, name, agency, position, label, work_account, work_password';
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
                label: row.label ?? null,
                work_account: row.work_account ?? null,
                work_password: row.work_password ?? null
              }))
            : toInsert.map((row: any) => ({
                staff_id: row.staff_id,
                name: row.name ?? null,
                agency: row.agency ?? null,
                position: row.position ?? null,
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
        { name: string; agency: string; position: string; label: string; work_account: string; work_password: string }
      >();
      for (const r of existingDetailsRes.rows) {
        const staff = String(r.staff_id ?? '').trim();
        if (!staff) continue;
        existingByStaff.set(staff, {
          name: String(r.name ?? '').trim(),
          agency: String(r.agency ?? r.Agency ?? '').trim(),
          position: String(r.position ?? r.Position ?? '').trim(),
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
            label: existing.label,
            work_account: existing.work_account,
            work_password: existing.work_password
          };
          const after = {
            staff_id: staff,
            name: payload.name ?? existing.name,
            agency: payload.agency ?? payload.Agency ?? existing.agency,
            position: payload.position ?? payload.Position ?? existing.position,
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

  const toneColor: Record<StatusTone, string> = {
    idle: 'text-slate-300',
    pending: 'text-neon',
    success: 'text-mint',
    error: 'text-ember'
  };

  const tabClass = (active: boolean) =>
    [
      'rounded-2xl px-4 py-2 text-sm font-medium transition',
      active ? 'bg-neon text-white shadow-glow' : 'bg-white/5 text-slate-200 hover:bg-white/10',
      isLocked ? 'cursor-not-allowed opacity-60' : ''
    ].join(' ');

  const downloadEmployeeTemplate = async () => {
    try {
      const XLSX = await import('xlsx');
      const headers = ['staff_id', 'name', 'agency', 'position', 'label', 'work_account', 'work_password'];
      const ws = XLSX.utils.aoa_to_sheet([headers]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'template');
      XLSX.writeFile(wb, 'ob_employees_template.xlsx');
    } catch {
      const headers = ['staff_id', 'name', 'agency', 'position', 'label', 'work_account', 'work_password'];
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

  const employeesFiltered = useMemo(() => {
    if (page !== 'employees') return [];
    const searchNeedle = deferredEmployeeSearch.trim().toLowerCase();
    const agencyNeedle = employeeAgency.trim().toLowerCase();
    const positionNeedle = employeePosition.trim().toLowerCase();
    const shiftNeedle = employeeShiftFilter;
    const labelNeedles = employeeLabels.map((item) => item.trim().toLowerCase()).filter(Boolean);
    const rows = employees.filter((e) => {
      const staff = normalizeStaffId(String(e.staff_id ?? '').trim());
      const name = String(e.name ?? '').trim();
      const agency = String(e.agency ?? e.Agency ?? '').trim();
      const position = String(e.position ?? e.Position ?? '').trim();
      const label = String(e.label ?? e.Label ?? '').trim();
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
      return [staff, name, label].join(' ').toLowerCase().includes(searchNeedle);
    });
    if (employeeSortByHireDateDesc) {
      return [...rows].sort((a, b) => {
        const atA = Date.parse(String(a.created_at ?? ''));
        const atB = Date.parse(String(b.created_at ?? ''));
        const valA = Number.isFinite(atA) ? atA : -1;
        const valB = Number.isFinite(atB) ? atB : -1;
        if (valA !== valB) return valB - valA;
        const staffA = normalizeStaffId(String(a.staff_id ?? '').trim());
        const staffB = normalizeStaffId(String(b.staff_id ?? '').trim());
        return staffA.localeCompare(staffB, 'en-US');
      });
    }
    if (!employeeSortByLastPunchDesc) return rows;

    const dayMs = 24 * 60 * 60 * 1000;
    const nowMs = serverTime.getTime();
    const daysAgoForStaff = (staff: string) => {
      const at = String(employeeLastPunchAtByStaffId[staff] ?? '').trim();
      if (!at) return null;
      const dt = new Date(at);
      if (Number.isNaN(dt.getTime())) return null;
      return Math.max(0, Math.floor((nowMs - dt.getTime()) / dayMs));
    };

    return [...rows].sort((a, b) => {
      const staffA = normalizeStaffId(String(a.staff_id ?? '').trim());
      const staffB = normalizeStaffId(String(b.staff_id ?? '').trim());
      const daysA = daysAgoForStaff(staffA);
      const daysB = daysAgoForStaff(staffB);
      const valA = daysA === null ? -1 : daysA;
      const valB = daysB === null ? -1 : daysB;
      if (valA !== valB) return valB - valA;
      return staffA.localeCompare(staffB, 'en-US');
    });
  }, [
    page,
    employees,
    deferredEmployeeSearch,
    employeeAgency,
    employeePosition,
    employeeShiftFilter,
    employeeLabels,
    employeeSortByHireDateDesc,
    employeeSortByLastPunchDesc,
    employeeLastPunchAtByStaffId,
    serverTime,
    employeeShiftByStaffId
  ]);
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
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '');
      const buildTempStaffId = (canonical: Record<string, string>, rowIndex: number) => {
        const staffRaw = normalizeStaffId(String(canonical.staff_id ?? '').trim());
        if (staffRaw) return staffRaw;
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
        const label = String(e.label ?? e.Label ?? '').trim();
        const workAccount = String(e.work_account ?? e.WorkAccount ?? '').trim();
        const workPassword = resolveDefaultWorkPassword(
          workAccount,
          String(e.work_password ?? e.WorkPassword ?? '').trim()
        );
        const shiftInfo = employeeShiftByStaffId[staff];
        const shift = shiftInfo?.shift || '';
        const shiftLabel = shift === 'early' ? t('白班', 'Day') : shift === 'late' ? t('晚班', 'Night') : '-';
        return [
          displayStaffId(staff),
          name || '-',
          agency || '-',
          position || '-',
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
      const anomalyDiff = getAnomalyScore(b) - getAnomalyScore(a);
      if (anomalyDiff !== 0) return anomalyDiff;
      if (b.totalHours !== a.totalHours) return b.totalHours - a.totalHours;
      return String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''), 'en-US');
    });
  }, [page, timecardRows, timecardShift, timecardInProgressOnly, timecardPresentDayFilter]);
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
  const timecardPunchReadOnly = timecardPunchDayIndex === null;
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
    const at = new Date(atRaw);
    if (Number.isNaN(at.getTime())) return '';
    const action = String(actionRaw ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
    const bucketMs = getOperationalBucketTimeMs(at, action);
    const shifted = new Date(bucketMs - DAY_CUTOFF_MS);
    return toDateOnly(shifted);
  };

  const scheduleAuditByStaffDate = useMemo(() => {
    const map = new Map<string, AuditRow[]>();
    const scheduleActions = new Set([
      'schedule_work',
      'schedule_temp_work',
      'schedule_leave',
      'schedule_temp_rest',
      'schedule_rest',
      'schedule_clear'
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
      if (action === 'punch_manual_add') {
        const key = toOperationalDateFromAudit(String(payload.created_at ?? ''), String(payload.action ?? ''));
        if (key) dateKeys.add(key);
      } else if (action === 'punch_manual_edit') {
        const before = (payload.before ?? null) as Record<string, any> | null;
        const after = (payload.after ?? null) as Record<string, any> | null;
        const keyBefore = before
          ? toOperationalDateFromAudit(String(before.created_at ?? ''), String(before.action ?? ''))
          : '';
        const keyAfter = after ? toOperationalDateFromAudit(String(after.created_at ?? ''), String(after.action ?? '')) : '';
        if (keyBefore) dateKeys.add(keyBefore);
        if (keyAfter) dateKeys.add(keyAfter);
      } else if (action === 'punch_manual_delete') {
        const before = (payload.before ?? null) as Record<string, any> | null;
        const key = before
          ? toOperationalDateFromAudit(String(before.created_at ?? ''), String(before.action ?? ''))
          : '';
        if (key) dateKeys.add(key);
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
      map.set(`${staff}__${dayIndex}`, row);
    }
    return map;
  }, [scheduleRows, scheduleRowsWeekOffset]);
  const employeeProfileByStaffId = useMemo(() => {
    const map = new Map<string, { name: string; agency: string; position: string }>();
    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      map.set(staff, {
        name: String(employee.name ?? '').trim(),
        agency: String(employee.agency ?? employee.Agency ?? '').trim(),
        position: String(employee.position ?? employee.Position ?? '').trim()
      });
    }
    return map;
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
        shift
      };
      if (shift === 'late') lateRows.push(item);
      else earlyRows.push(item);
    }
    earlyRows.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));
    lateRows.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));

    return {
      targetDate: toDateOnly(targetDay),
      weekday: targetDay.toLocaleDateString('en-US', { weekday: 'short' }),
      earlyRows,
      lateRows
    };
  }, [serverTime, dailyListDateInput, employees, scheduleRowsByStaffDayIndex, employeeProfileByStaffId, employeeShiftByStaffId]);
  const tomorrowAttendanceCards = useMemo(() => {
    const countByKey: Record<string, number> = {};
    const addRows = (rows: DailyListRow[], shift: 'early' | 'late') => {
      for (const row of rows) {
        const normalizedPosition = normalizePositionKey(String(row.position ?? '').trim());
        if (!normalizedPosition) continue;
        const key = `${shift}:${normalizedPosition}`;
        countByKey[key] = (countByKey[key] ?? 0) + 1;
      }
    };
    addRows(tomorrowDailyList.earlyRows, 'early');
    addRows(tomorrowDailyList.lateRows, 'late');
    return (['early', 'late'] as const).flatMap((shift) =>
      ALLOWED_POSITIONS.map((position) => ({
        key: `${shift}:${position}`,
        shift,
        position,
        count: countByKey[`${shift}:${position}`] ?? 0
      }))
    );
  }, [tomorrowDailyList]);
  const tomorrowPositionSummaryCards = useMemo(
    () =>
      ALLOWED_POSITIONS.map((position) => {
        const early = tomorrowAttendanceCards.find((c) => c.shift === 'early' && c.position === position)?.count ?? 0;
        const late = tomorrowAttendanceCards.find((c) => c.shift === 'late' && c.position === position)?.count ?? 0;
        return { position, early, late, total: early + late };
    }),
    [tomorrowAttendanceCards]
  );
  const selectedDailyFilterPositions = useMemo(
    () => ALLOWED_POSITIONS.filter((position) => Boolean(dailyListFilterPositions[position])),
    [dailyListFilterPositions]
  );
  const tomorrowDailyRowsDisplayed = useMemo(() => {
    if (selectedDailyFilterPositions.length === 0) {
      return { earlyRows: tomorrowDailyList.earlyRows, lateRows: tomorrowDailyList.lateRows };
    }
    const allowed = new Set(selectedDailyFilterPositions);
    const match = (row: DailyListRow) => {
      const pos = normalizePositionKey(String(row.position ?? '').trim());
      return Boolean(pos && allowed.has(pos as AllowedPosition));
    };
    return {
      earlyRows: tomorrowDailyList.earlyRows.filter(match),
      lateRows: tomorrowDailyList.lateRows.filter(match)
    };
  }, [tomorrowDailyList, selectedDailyFilterPositions]);
  const canCopyDailyListAll = tomorrowDailyList.earlyRows.length + tomorrowDailyList.lateRows.length > 0;
  const canCopyDailyListEarly = tomorrowDailyRowsDisplayed.earlyRows.length > 0;
  const canCopyDailyListLate = tomorrowDailyRowsDisplayed.lateRows.length > 0;

  const scheduleEmployeesBase = useMemo(() => {
    if (page !== 'schedule') return [];
    return employees
      .filter((employee) => {
        const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
        const position = String(employee.position ?? employee.Position ?? '').trim();
        const label = String(employee.label ?? employee.Label ?? '').trim();
        if (!staff) return false;
        if (scheduleWorkDayFilter !== null) {
          const row = scheduleRowsByStaffDayIndex.get(`${staff}__${scheduleWorkDayFilter}`);
          const isWork = isWorkingScheduleRow(row);
          if (!isWork) return false;
        }
        if (deferredSchedulePosition && position.toLowerCase() !== deferredSchedulePosition.toLowerCase()) return false;
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
    deferredScheduleLabels,
    deferredScheduleShift,
    employeeShiftByStaffId,
    scheduleWorkDayFilter,
    scheduleRowsByStaffDayIndex
  ]);

  const scheduleLabelOptions = useMemo(() => {
    const out = new Set<string>();
    for (const employee of employees) {
      const position = String(employee.position ?? employee.Position ?? '').trim();
      if (deferredSchedulePosition && position.toLowerCase() !== deferredSchedulePosition.toLowerCase()) continue;
      const label = String(employee.label ?? employee.Label ?? '').trim();
      if (label) out.add(label);
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [employees, deferredSchedulePosition]);
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
    if (!scheduleSortByUphDesc) return filtered;
    return [...filtered].sort((a, b) => {
      const staffA = normalizeStaffId(String(a.staff_id ?? '').trim());
      const staffB = normalizeStaffId(String(b.staff_id ?? '').trim());
      const rawA = Number(scheduleUphByStaffId[staffA]);
      const rawB = Number(scheduleUphByStaffId[staffB]);
      const hasA = Number.isFinite(rawA);
      const hasB = Number.isFinite(rawB);
      if (hasA && hasB && rawA !== rawB) return rawB - rawA;
      if (hasA && !hasB) return -1;
      if (!hasA && hasB) return 1;
      return staffA.localeCompare(staffB, 'en-US');
    });
  }, [page, scheduleEmployeesBase, deferredScheduleSearch, scheduleSortByUphDesc, scheduleUphByStaffId]);
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
    setScheduleRenderCount(Math.min(60, total));
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
      if (filterChanged || prev <= 0) return Math.min(60, total);
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
    const onScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
      const fullHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
      if (scrollTop + viewport < fullHeight - 240) return;
      setScheduleRenderCount((prev) => {
        if (prev >= scheduleEmployeesFiltered.length) return prev;
        return Math.min(prev + 60, scheduleEmployeesFiltered.length);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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

  const homeRosterRows = useMemo(() => {
    if (page !== 'home') {
      return {
        absent: [] as Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }>,
        restWorked: [] as Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }>,
        onClock: [] as Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }>
      };
    }
    const absent: Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }> = [];
    const restWorked: Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }> = [];
    const onClock: Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }> = [];
    const seen = new Set<string>();
    const nowMinutes = homeNowMinutes;
    const lateAbsentVisibleMinutes = 16 * 60 + 30; // 16:30

    for (const employee of employees) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff || seen.has(staff)) continue;
      seen.add(staff);

      const row = scheduleRowsByStaffDayIndex.get(`${staff}__${homeOperationalDayIndex}`);
      // 不再跳过没有排班记录的员工，让他们也能显示在打卡中列表

      const baseState = row ? getScheduleBaseStateFromNote(row.note) : 'rest';
      const hasPunch = schedulePunchPresenceKeys.has(`${staff}__${homeOperationalDayIndex}`);
      const position = String(employee.position ?? employee.Position ?? '').trim();
      const shift = employeeShiftByStaffId[staff]?.shift ?? '';
      const profile = employeeProfileByStaffId.get(staff);
      const item = {
        staff_id: staff,
        name: String(profile?.name ?? employee.name ?? '').trim(),
        agency: String(profile?.agency ?? employee.agency ?? employee.Agency ?? '').trim(),
        position,
        shift: shift === 'early' ? 'Morning' : shift === 'late' ? 'Night' : '-'
      };

      const hideLateAbsent = shift === 'late' && nowMinutes < lateAbsentVisibleMinutes;
      // 缺勤：仅在打卡存在性加载完成后再判断，避免初始加载闪烁全缺勤
      if (schedulePunchPresenceReady && row && isWorkingScheduleBaseState(baseState) && !hasPunch && !hideLateAbsent) {
        absent.push(item);
      }
      // 排休出勤：休息类状态或无排班，但有打卡
      if (hasPunch && (!row || isRestLikeScheduleBaseState(baseState))) restWorked.push(item);
    }

    absent.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));
    restWorked.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));
    for (const [staffRaw, shiftRaw] of Object.entries(homeOnClockShiftByStaffId)) {
      const staff = normalizeStaffId(String(staffRaw ?? '').trim());
      if (!staff) continue;
      const profile = employeeProfileByStaffId.get(staff);
      const row = scheduleRowsByStaffDayIndex.get(`${staff}__${homeOperationalDayIndex}`);
      const fallbackEmp = employees.find((e) => normalizeStaffId(String(e.staff_id ?? '').trim()) === staff);
      const position = String(profile?.position ?? row?.position ?? fallbackEmp?.position ?? fallbackEmp?.Position ?? '').trim();
      const shift = shiftRaw === 'early' ? 'Morning' : shiftRaw === 'late' ? 'Night' : '-';
      onClock.push({
        staff_id: staff,
        name: String(profile?.name ?? fallbackEmp?.name ?? '').trim(),
        agency: String(profile?.agency ?? fallbackEmp?.agency ?? fallbackEmp?.Agency ?? '').trim(),
        position,
        shift
      });
    }
    onClock.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));
    return { absent, restWorked, onClock };
  }, [
    page,
    employees,
    scheduleRowsByStaffDayIndex,
    homeOperationalDayIndex,
    schedulePunchPresenceKeys,
    schedulePunchPresenceReady,
    homeNowMinutes,
    homeOnClockShiftByStaffId,
    employeeShiftByStaffId,
    employeeProfileByStaffId
  ]);
  const homeRosterRowsFiltered = useMemo(() => {
    if (page !== 'home') {
      return {
        absent: [] as Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }>,
        restWorked: [] as Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }>,
        onClock: [] as Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }>
      };
    }
    const filterRows = (rows: Array<{ staff_id: string; name: string; agency: string; position: string; shift: string }>) =>
      rows.filter((row) => {
        if (homeRosterPositionFilter === 'ALL') return true;
        const pos = normalizePositionKey(String(row.position ?? '').trim());
        return pos === homeRosterPositionFilter;
      });
    return {
      absent: filterRows(homeRosterRows.absent),
      restWorked: filterRows(homeRosterRows.restWorked),
      onClock: filterRows(homeRosterRows.onClock)
    };
  }, [page, homeRosterRows, homeRosterPositionFilter]);
  const homeRosterRowsCurrent = useMemo(() => {
    if (page !== 'home') return [];
    if (homeRosterSide === 'restWorked') return homeRosterRowsFiltered.restWorked;
    if (homeRosterSide === 'onClock') return homeRosterRowsFiltered.onClock;
    return homeRosterRowsFiltered.absent;
  }, [page, homeRosterSide, homeRosterRowsFiltered]);
  const formatDailyListStaffId = (row: DailyListRow) => {
    const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!isNewHirePlaceholderStaffId(staff)) return displayStaffId(staff);
    const matched = staff.match(/^NEWREQ-(\d{4})(\d{2})(\d{2})(?:-([A-Z]+))?-(\d{3,})$/i);
    if (matched) {
      const mm = matched[2] ?? '';
      const dd = matched[3] ?? '';
      const pos = String(matched[4] ?? '').toUpperCase();
      const seq = String(Number(matched[5] ?? '0'));
      return `${mm}/${dd}NEW ${pos}${seq}`.trim();
    }
    const fallbackName = String(row.name ?? '').trim();
    if (isNewHirePlaceholderName(fallbackName)) return fallbackName;
    return staff;
  };
  const makeDailyListTsv = (rows: DailyListRow[]) =>
    rows
      .map((row) => [formatDailyListStaffId(row), row.name, row.agency, row.position, getPlannedStartTime(row.shift, row.position)].map((c) => String(c ?? '')).join('\t'))
      .join('\n');
  const copyDailyList = async (scope: 'early' | 'late' | 'all') => {
    const early = scope === 'all' ? tomorrowDailyList.earlyRows : tomorrowDailyRowsDisplayed.earlyRows;
    const late = scope === 'all' ? tomorrowDailyList.lateRows : tomorrowDailyRowsDisplayed.lateRows;
    const title = `Daily List ${tomorrowDailyList.targetDate} ${tomorrowDailyList.weekday}`;
    const text =
      scope === 'early'
        ? makeDailyListTsv(early)
        : scope === 'late'
          ? makeDailyListTsv(late)
          : [
              `${title} - Morning Shift`,
              makeDailyListTsv(early),
              '',
              `${title} - Night Shift`,
              makeDailyListTsv(late)
            ].join('\n');
    if (!text.trim()) {
      setStatus({ tone: 'error', message: 'No rows to copy.' });
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
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
            ? `Copied daily list (${early.length + late.length} rows).`
            : `Copied ${scope === 'early' ? 'early' : 'night'} list (${scope === 'early' ? early.length : late.length} rows).`
      });
    } catch (err: any) {
      setStatus({ tone: 'error', message: `Copy failed: ${String(err?.message ?? err ?? 'Unknown error')}` });
    }
  };

  const addDailyListNewHireDemand = async () => {
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
    const templateDate = getTemplateDateByDayIndex(dayIndex, scheduleWeekOffset);
    const position = normalizePositionKey(dailyListNewHirePosition);
    const shift = dailyListNewHireShift;
    const agency = dailyListNewHireAgency.trim();
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

    const mmdd = (() => {
      const m = String(target.getMonth() + 1).padStart(2, '0');
      const d = String(target.getDate()).padStart(2, '0');
      return `${m}/${d}`;
    })();
    const positionUpper = String(position).toUpperCase();
    const existingSeqSet = new Set<number>();
    const escapedMmdd = mmdd.replace('/', '\\/');
    const nameSeqRegex = new RegExp(`^${escapedMmdd}NEW\\s+${positionUpper}(\\d+)$`, 'i');
    const staffSeqRegex = new RegExp(`^NEWREQ-${targetDate.replace(/-/g, '')}-${positionUpper}-(\\d{3,})$`, 'i');
    for (const e of employees) {
      const name = String(e.name ?? '').trim();
      const staff = String(e.staff_id ?? '').trim();
      const m1 = name.match(nameSeqRegex);
      if (m1?.[1]) existingSeqSet.add(Number(m1[1]));
      const m2 = staff.match(staffSeqRegex);
      if (m2?.[1]) existingSeqSet.add(Number(m2[1]));
    }
    try {
      const remoteRes = await supabase
        .from(EMPLOYEE_TABLE)
        .select('staff_id, name')
        .ilike('staff_id', `NEWREQ-${targetDate.replace(/-/g, '')}-${positionUpper}-%`)
        .limit(2000);
      if (!remoteRes.error) {
        const rows = ((remoteRes.data as any[]) ?? []) as Array<{ staff_id?: string | null; name?: string | null }>;
        for (const r of rows) {
          const name = String(r.name ?? '').trim();
          const staff = String(r.staff_id ?? '').trim();
          const m1 = name.match(nameSeqRegex);
          if (m1?.[1]) existingSeqSet.add(Number(m1[1]));
          const m2 = staff.match(staffSeqRegex);
          if (m2?.[1]) existingSeqSet.add(Number(m2[1]));
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
        const internalStaffId = `NEWREQ-${targetDate.replace(/-/g, '')}-${positionUpper}-${String(seq).padStart(3, '0')}`;
        const employeeName = note || '-';
        const employeePayload =
          mode === 'cased'
            ? {
                staff_id: internalStaffId,
                name: employeeName,
                Agency: agency || null,
                Position: position,
                shift,
                label: null,
                created_at: nowIso
              }
            : {
                staff_id: internalStaffId,
                name: employeeName,
                agency: agency || null,
                position,
                shift,
                label: null,
                created_at: nowIso
              };
        employeeRows.push(employeePayload as Record<string, unknown>);
        scheduleRowsToWrite.push({
          staff_id: internalStaffId,
          date: templateDate,
          position,
          note: null,
          operator: user?.email ?? null,
          updated_at: nowIso
        });
        localEmployeesToAdd.push({
          staff_id: internalStaffId,
          name: employeeName,
          agency: agency || null,
          position,
          shift,
          label: null,
          created_at: nowIso
        });
        localSchedulesToAdd.push({
          staff_id: internalStaffId,
          date: templateDate,
          position,
          note: null,
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
              if (state === 'work') return shift === 'late' ? '晚1' : '早1';
              if (state === 'temp_work') return '临时工作';
              if (state === 'leave') return '请假';
              if (state === 'temp_rest') return '临时排休';
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
      const staffMatch = String(row.staff_id ?? '').trim().match(/-(\d{3,})$/);
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
  const scheduleLateAbsentVisibleMinutes = 16 * 60 + 30;

  if (!supabase) {
    return (
      <div className={['min-h-screen px-5 py-8', themeMode === 'light' ? 'admin-theme-light' : 'admin-theme-dark'].join(' ')}>
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <header className="glass rounded-3xl px-6 py-6 shadow-glow">
            <h1 className="font-display text-4xl tracking-[0.08em]">ObPunch Admin</h1>
            <p className="mt-2 text-sm text-ember">缺少 Supabase 配置，请检查 .env</p>
          </header>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        'min-h-screen px-5 py-8 text-paper transition-colors',
        themeMode === 'light' ? 'admin-theme-light' : 'admin-theme-dark'
      ].join(' ')}
    >
      <div className="mx-auto flex w-full max-w-none flex-col gap-6">
        <AdminHeader
          t={t}
          isLocked={isLocked}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          lang={lang}
          setLang={setLang}
          status={status}
          toneColor={toneColor}
          serverTimeText={formatTime(serverTime, locale)}
          user={user}
          userDisplayName={userDisplayName}
          attendanceError={attendanceError}
          onBack={() => {
            window.location.href = '/';
          }}
          onLogout={doLogout}
        />

        {!user ? (
          <AdminLoginPanel
            isLocked={isLocked}
            email={email}
            password={password}
            setEmail={setEmail}
            setPassword={setPassword}
            doLogin={doLogin}
            t={t}
          />
        ) : (
          <>
            <AdminNav page={page} isLocked={isLocked} onSetPage={setPage} tabClass={tabClass} t={t} />

            {page === 'home' && (
              <HomeDashboardPage
                t={t}
                allowedPositions={ALLOWED_POSITIONS}
                homeCardStats={homeCardStats}
                homeExpectedPositionSummaryCards={homeExpectedPositionSummaryCards}
                getHomeCardToneClass={getHomeCardToneClass}
                getHomeChipToneClass={getHomeChipToneClass}
                getHomePanelToneClass={getHomePanelToneClass}
                getSchedulePositionBadgeClass={getSchedulePositionBadgeClass}
                schedulePositionToneByPosition={schedulePositionToneByPosition}
                homeRosterSide={homeRosterSide}
                setHomeRosterSide={setHomeRosterSide}
                homeRosterPositionFilter={homeRosterPositionFilter}
                setHomeRosterPositionFilter={setHomeRosterPositionFilter}
                homeRosterRowsCurrent={homeRosterRowsCurrent}
              />
            )}
            {page === 'devices' && (
              <DevicesPage
                t={t}
                isLocked={isLocked}
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
                DEVICE_TYPES={DEVICE_TYPES}
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
                locale={locale}
                isLocked={isLocked}
                auditSearch={auditSearch}
                setAuditSearch={setAuditSearch}
                fetchAudit={fetchAudit}
                auditError={auditError}
                auditRows={auditRows}
                AUDIT_TABLE={AUDIT_TABLE}
                formatAuditDetail={formatAuditDetail}
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
                  schedulePublishTomorrow={schedulePublishTomorrow}
                  schedulePublishForDate={schedulePublishForDate}
                  setSchedulePublishSetting={setSchedulePublishSetting}
                  scheduleWeekOffset={scheduleWeekOffset}
                  setScheduleWeekOffset={setScheduleWeekOffset}
                  setScheduleWeekInput={setScheduleWeekInput}
                  serverTime={serverTime}
                  startOfWeekMonday={startOfWeekMonday}
                  toDateOnly={toDateOnly}
                  addDays={addDays}
                  setDailyListDateInput={setDailyListDateInput}
                  setDailyListFilterPositions={setDailyListFilterPositions}
                  createEmptyPositionFlags={createEmptyPositionFlags}
                  loadDailyListSelectedPositionsGlobal={loadDailyListSelectedPositionsGlobal}
                  setDailyListOpen={setDailyListOpen}
                  schedulePrintDate={schedulePrintDate}
                  setSchedulePrintDate={setSchedulePrintDate}
                  scheduleEmployeesFilteredLength={scheduleEmployeesFiltered.length}
                  printScheduleSignInSheet={printScheduleSignInSheet}
                  exportScheduleTemplate={exportScheduleTemplate}
                  refreshSchedulePanel={refreshSchedulePanel}
                />

                <div className="mt-5 grid gap-4 md:grid-cols-10">
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
                        setScheduleWeekOffset(offset);
                        setScheduleWeekInput(toDateOnly(weekStart));
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
                    <details className="relative mt-2">
                      <summary
                        className={[
                          'flex h-12 cursor-pointer list-none items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition',
                          'hover:border-white/20',
                          isLocked ? 'pointer-events-none cursor-not-allowed opacity-60' : ''
                        ].join(' ')}
                      >
                        <span className="truncate">{schedulePosition || t('全部岗位', 'All positions')}</span>
                        <span className="ml-3 text-xs text-slate-400">{schedulePosition ? 1 : 0}</span>
                      </summary>
                      <div className="absolute z-30 mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
                        <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
                          <span>{t('单选', 'Single-select')}</span>
                          <button
                            type="button"
                            disabled={isLocked || !schedulePosition}
                            onClick={(e) => {
                              e.preventDefault();
                              setSchedulePosition('');
                            }}
                            className="rounded-md bg-white/10 px-2 py-1 text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t('清空', 'Clear')}
                          </button>
                        </div>
                        <div className="max-h-56 space-y-1 overflow-auto pr-1">
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setSchedulePosition('')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
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
                              onClick={() => setSchedulePosition(p)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
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
                    <details className="relative mt-2">
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
                        <span className="ml-3 text-xs text-slate-400">{scheduleLabels.length}</span>
                      </summary>
                      <div className="absolute z-30 mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
                        <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
                          <span>{t('可多选', 'Multi-select')}</span>
                          <button
                            type="button"
                            disabled={isLocked || scheduleLabels.length === 0}
                            onClick={(e) => {
                              e.preventDefault();
                              setScheduleLabels([]);
                            }}
                            className="rounded-md bg-white/10 px-2 py-1 text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t('清空', 'Clear')}
                          </button>
                        </div>
                        <div className="max-h-56 space-y-1 overflow-auto pr-1">
                          {scheduleLabelOptions.length === 0 ? (
                            <p className="rounded-lg bg-white/5 px-2 py-2 text-xs text-slate-400">{t('暂无标签', 'No labels')}</p>
                          ) : (
                            scheduleLabelOptions.map((item) => {
                              const checked = scheduleLabels.includes(item);
                              return (
                                <label
                                  key={item}
                                  className={[
                                    'flex cursor-pointer items-center justify-between rounded-lg border px-2 py-1.5 text-sm transition',
                                    checked
                                      ? 'border-neon/50 bg-neon/10 text-neon'
                                      : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
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
                                      onChange={() =>
                                        setScheduleLabels((prev) =>
                                          prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]
                                        )
                                      }
                                      className="h-3.5 w-3.5 accent-lime-400"
                                    />
                                  </div>
                                </label>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </details>
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-400">
                  {t('已加载', 'Loaded')}: {scheduleEmployeesFiltered.length} / {employees.length}
                  {scheduleWorkDayFilter !== null && (
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setScheduleWorkDayFilter(null)}
                      className="ml-3 rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('日期筛选', 'Day filter')}: {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][scheduleWorkDayFilter]} ({t('清空', 'Clear')})
                    </button>
                  )}
                </div>

                {scheduleError && <p className="mt-3 text-sm text-ember">{t('加载失败', 'Load failed')}: {scheduleError}</p>}
                {!scheduleError && scheduleEmployeesFiltered.length === 0 && (
                  <p className="mt-3 text-sm text-slate-400">{t('未找到员工。', 'No employees found.')}</p>
                )}

                {!scheduleError && scheduleEmployeesFiltered.length > 0 && (
                  <div className="no-scrollbar mt-4 min-h-[320px] max-h-[68vh] overflow-auto rounded-2xl border border-white/10 bg-black/30">
                    <table className="min-w-[1710px] w-full table-fixed text-left text-xs leading-tight">
                      <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-[10px] uppercase tracking-[0.16em] text-slate-400 backdrop-blur">
                        <tr>
                          <th className="sticky top-0 z-20 w-[100px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">{t('工号', 'ID')}</th>
                          <th className="sticky top-0 z-20 w-[155px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">{t('姓名', 'Name')}</th>
                          <th className="sticky top-0 z-20 w-[96px] bg-slate-950/95 px-2 py-2 text-center backdrop-blur">{t('工作天数', 'Work Days')}</th>
                          <th className="sticky top-0 z-20 w-[108px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">{t('中介', 'Agency')}</th>
                          <th className="sticky top-0 z-20 w-[86px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">{t('岗位', 'Position')}</th>
                          <th className="sticky top-0 z-20 w-[110px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">{t('标签', 'Label')}</th>
                          <th className="sticky top-0 z-20 w-[76px] bg-slate-950/95 px-1.5 py-2 text-center backdrop-blur">{t('班次', 'Shift')}</th>
                          <th className="sticky top-0 z-20 w-[72px] bg-slate-950/95 px-1.5 py-2 text-center backdrop-blur">
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
                          {scheduleDays.map((day, idx) => (
                            <th key={toDateOnly(day)} className="sticky top-0 z-20 w-[92px] bg-slate-950/95 px-1 py-2 text-center backdrop-blur">
                              <div className="flex flex-col items-center leading-tight">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={() => setScheduleWorkDayFilter((prev) => (prev === idx ? null : idx))}
                                  className={[
                                    'rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition',
                                    scheduleWorkDayFilter === idx
                                      ? 'bg-neon/20 text-neon'
                                      : 'text-neon hover:bg-white/10',
                                    isLocked ? 'cursor-not-allowed opacity-60' : ''
                                  ].join(' ')}
                                  title="Filter employees working this day"
                                >
                                  {lang === 'en' ? `Work ${scheduleWorkingCountByDayIndex[idx]}` : `工作 ${scheduleWorkingCountByDayIndex[idx]}人`}
                                </button>
                                <span>{`${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx]} ${toDateOnly(day).slice(5)}`}</span>
                              </div>
                            </th>
                          ))}
                          <th className="sticky top-0 z-20 w-[82px] bg-slate-950/95 px-1 py-2 text-center backdrop-blur">
                            {t('离职', 'Depart')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleEmployeesRendered.map((employee) => {
                          const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
                          const name = String(employee.name ?? '').trim();
                          const agency = String(employee.agency ?? employee.Agency ?? '').trim();
                          const position = String(employee.position ?? employee.Position ?? '').trim();
                          const label = String(employee.label ?? employee.Label ?? '').trim();
                          if (!staff) return null;

                          let workDays = 0;
                          for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
                            const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
                            if (!row) continue;
                            if (isWorkingScheduleRow(row)) workDays += 1;
                          }
                          let restWorkedBonusDays = 0;
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
                          let absentPenaltyDays = 0;
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
                              scheduleIsCurrentWeek &&
                              !hasPunch &&
                              (isPastOperationalDay || (isCurrentOperationalDay && !hideLateAbsent));
                            if (showAbsent) absentPenaltyDays += 1;
                          }
                          const effectiveWorkDays = workDays + restWorkedBonusDays - absentPenaltyDays;
                          const workDaysClass =
                            effectiveWorkDays >= 5
                              ? 'border-emerald-400/60 text-emerald-200 bg-emerald-500/10'
                              : effectiveWorkDays >= 1 && effectiveWorkDays <= 4
                                ? 'border-amber-400/60 text-amber-200 bg-amber-500/10'
                                : 'border-rose-400/60 text-rose-200 bg-rose-500/10';

                          return (
                            <tr className="border-b border-white/5 transition-colors hover:bg-white/[0.04] last:border-0" key={staff}>
                              <td className="px-1.5 py-2 font-mono text-slate-200">{staff}</td>
                              <td className="px-1.5 py-2 text-slate-200 truncate">{name || '-'}</td>
                              <td className="px-2 py-2 text-center">
                                <span className={['inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', workDaysClass].join(' ')}>
                                  {effectiveWorkDays}
                                </span>
                              </td>
                              <td className="px-1.5 py-2 text-slate-200 truncate">{agency || '-'}</td>
                              <td className="px-1.5 py-2 text-slate-200">
                                <span className={['inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]', getSchedulePositionBadgeClass(position)].join(' ')}>
                                  {position || '-'}
                                </span>
                              </td>
                              <td className="px-1.5 py-2 text-slate-200">
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
                              <td className="px-2 py-2 text-center text-slate-200">
                                {(() => {
                                  const dbShift = normalizeShiftValue(String(employee.shift ?? '').trim());
                                  const shift = dbShift || '';
                                  const shiftLabel = shift === 'early' ? t('早班', 'Morning') : shift === 'late' ? t('晚班', 'Night') : '-';
                                  const shiftClass = getShiftBadgeClass(shift);
                                  return <span className={['inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em]', shiftClass].join(' ')}>{shiftLabel}</span>;
                                })()}
                              </td>
                              <td className="px-1.5 py-2 text-center font-mono text-slate-200">{formatUph(scheduleUphByStaffId[staff])}</td>
                              {scheduleDays.map((_, dayIndex) => {
                                const key = `${staff}__${dayIndex}`;
                                const row = scheduleRowsByStaffDayIndex.get(key);
                                const hasPunch = schedulePunchPresenceKeys.has(key);
                                const scheduledShiftForAbsent = employeeShiftByStaffId[staff]?.shift ?? '';
                                const targetShift: 'early' | 'late' = scheduledShiftForAbsent === 'late' ? 'late' : 'early';
                                const isPastOperationalDay = dayIndex < homeOperationalDayIndex;
                                const isCurrentOperationalDay = dayIndex === homeOperationalDayIndex;
                                const hideLateAbsent =
                                  scheduledShiftForAbsent === 'late' && scheduleNowMinutes < scheduleLateAbsentVisibleMinutes;
                                const showAbsent =
                                  schedulePunchPresenceReady &&
                                  scheduleIsCurrentWeek &&
                                  row &&
                                  isWorkingScheduleBaseState(getScheduleBaseStateFromNote(row.note)) &&
                                  !hasPunch &&
                                  (isPastOperationalDay || (isCurrentOperationalDay && !hideLateAbsent));
                                const state: ScheduleDisplayState = getScheduleDisplayState(row, hasPunch, { showAbsent });
                                const scheduleAuditKey = `${staff}__${getTemplateDateByDayIndex(dayIndex, scheduleWeekOffset)}`;
                                const scheduleCellAudit = scheduleAuditByStaffDate.get(scheduleAuditKey) ?? [];

                                return (
                                  <td key={key} className="px-1 py-1.5 align-middle">
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
                                              state,
                                              rect
                                            );
                                          }}
                                          className={[
                                            'h-7 min-w-[42px] rounded-md px-1 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55',
                                            state === 'work'
                                              ? 'bg-neon text-white shadow-glow'
                                              : state === 'temp_work'
                                                ? 'bg-emerald-700 text-white'
                                              : state === 'leave'
                                                ? 'bg-violet-500 text-white'
                                              : state === 'rest_worked'
                                                ? 'bg-sky-500 text-white'
                                              : state === 'absent'
                                                ? themeMode === 'light'
                                                  ? 'bg-white text-slate-900 border border-slate-900/70'
                                                  : 'bg-white text-slate-900'
                                              : state === 'temp_rest'
                                                ? 'bg-red-800 text-red-100'
                                              : 'bg-ember text-white'
                                          ].join(' ')}
                                        >
                                          {state === 'work'
                                            ? t('工作', 'Work')
                                            : state === 'temp_work'
                                              ? t('临时工作', 'Temporary Work')
                                            : state === 'leave'
                                              ? t('请假', 'Excuse')
                                            : state === 'rest_worked'
                                              ? t('排休出勤', 'Off Worked')
                                            : state === 'absent'
                                              ? t('缺勤', 'Absent')
                                            : state === 'temp_rest'
                                                ? t('临时排休', 'Temporary Off')
                                              : t('休息', 'Off')}
                                        </button>
                                        {scheduleCellAudit.length > 0 && (
                                          <span
                                            className={[
                                              'pointer-events-none absolute -right-1 -top-1 h-2 w-2 rounded-full',
                                              state === 'rest' || state === 'temp_rest'
                                                ? 'bg-neon shadow-glow'
                                                : 'bg-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.55)]'
                                            ].join(' ')}
                                          />
                                        )}
                                      </span>
                                      {scheduleCellAudit.length > 0 && (
                                        <div className="pointer-events-none invisible absolute right-0 top-full z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-white/15 bg-slate-950/95 p-2 text-[11px] text-slate-200 opacity-0 shadow-2xl transition group-hover:visible group-hover:opacity-100">
                                          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-neon">
                                            {t('最近操作', 'Recent changes')}
                                          </div>
                                          <div className="space-y-1">
                                            {scheduleCellAudit.slice(0, 3).map((item) => {
                                              const detail = formatAuditDetail(item);
                                              return (
                                                <div key={String(item.id ?? `${item.created_at ?? ''}_${item.action ?? ''}`)} className="rounded-md bg-white/5 px-1.5 py-1">
                                                  <div className="text-[10px] text-slate-400">
                                                    {formatCellAuditTime(item.created_at)} · {normalizeAuditActor((item as any).actor) || '-'}
                                                  </div>
                                                  <div>{renderAuditSummary(detail.summary)}</div>
                                                  {detail.details.slice(0, 2).map((d, idx2) => (
                                                    <div key={`${String(item.id ?? 'row')}_${d.label}_${idx2}`} className="mt-0.5 text-[10px] text-slate-300">
                                                      <span className="text-slate-400">{d.label}: </span>
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
                              <td className="px-1 py-1.5 text-center">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={() => {
                                    void deleteEmployeeRow(staff);
                                  }}
                                  className="rounded-md bg-ember px-2 py-1 text-[10px] font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {t('离职', 'Depart')}
                                </button>
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
                      className="fixed z-[80] w-44 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur"
                      style={{ left: `${schedulePicker.anchorLeft}px`, top: `${schedulePicker.anchorTop}px` }}
                    >
                      {(
                        [
                          { key: 'work', labelZh: '工作', labelEn: 'Work', cls: 'bg-neon text-white' },
                          { key: 'temp_work', labelZh: '临时工作', labelEn: 'Temporary Work', cls: 'bg-emerald-700 text-white' },
                          { key: 'leave', labelZh: '请假', labelEn: 'Excuse', cls: 'bg-violet-500 text-white' },
                          { key: 'temp_rest', labelZh: '临时排休', labelEn: 'Temporary Off', cls: 'bg-red-800 text-red-100' },
                          { key: 'rest', labelZh: '休息', labelEn: 'Off', cls: 'bg-ember text-white' }
                        ] as Array<{ key: ScheduleBaseState; labelZh: string; labelEn: string; cls: string }>
                      ).map((item) => (
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
                            'mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold transition hover:brightness-110 last:mb-0',
                            item.cls
                          ].join(' ')}
                        >
                          {t(item.labelZh, item.labelEn)}
                        </button>
                      ))}
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
                              {t('每日名单', 'Daily list')}
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
                          <div className="min-w-[520px] flex-1">
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                              {tomorrowPositionSummaryCards.map((card) => (
                                <button
                                  type="button"
                                  onClick={() => toggleDailyListSelectedPosition(card.position)}
                                  key={card.position}
                                  className={[
                                    'rounded-xl border px-2.5 py-2 text-left transition',
                                    dailyListSelectedPositions[card.position]
                                      ? themeMode === 'light'
                                        ? getSchedulePositionBadgeClassLight(card.position)
                                        : getSchedulePositionBadgeClass(card.position)
                                      : themeMode === 'light'
                                        ? 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                                        : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
                                  ].join(' ')}
                                >
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                                    {card.position}
                                  </div>
                                  <div className="mt-1 text-[11px] leading-tight opacity-90">早 {card.early} · 晚 {card.late}</div>
                                  <div className="mt-1 text-xl font-bold leading-none">{card.total}</div>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={() => setDailyListNewHireOpen(true)}
                              className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t('新人需求', 'New Hire Demand')}
                            </button>
                            <button
                              type="button"
                              disabled={!canCopyDailyListAll}
                              onClick={() => void copyDailyList('all')}
                              className="rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
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
                              关闭
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
                              {ALLOWED_POSITIONS.map((position) => (
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
                                  setDailyListFilterPositions({
                                    Pick: false,
                                    Pack: false,
                                    Rebin: false,
                                    Preship: false,
                                    Transfer: false
                                  })
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
                          <div className={['rounded-2xl border p-4', themeMode === 'light' ? 'border-emerald-200 bg-emerald-50/50' : 'border-emerald-400/30 bg-emerald-500/[0.04]'].join(' ')}>
                            <div className="mb-3 flex items-center justify-between">
                              <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-200">{t('早班', 'Morning')}</h4>
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
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{getPlannedStartTime('early', row.position)}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          <div className={['rounded-2xl border p-4', themeMode === 'light' ? 'border-indigo-200 bg-indigo-50/50' : 'border-indigo-400/30 bg-indigo-500/[0.04]'].join(' ')}>
                            <div className="mb-3 flex items-center justify-between">
                              <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-200">{t('晚班', 'Night')}</h4>
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
                                        <td className={['px-3 py-2', themeMode === 'light' ? 'text-slate-700' : 'text-slate-200'].join(' ')}>{getPlannedStartTime('late', row.position)}</td>
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
                  isLocked={isLocked}
                  allowedPositions={ALLOWED_POSITIONS}
                  dailyListNewHirePosition={dailyListNewHirePosition}
                  setDailyListNewHirePosition={setDailyListNewHirePosition}
                  dailyListNewHireShift={dailyListNewHireShift}
                  setDailyListNewHireShift={setDailyListNewHireShift}
                  dailyListNewHireCount={dailyListNewHireCount}
                  setDailyListNewHireCount={setDailyListNewHireCount}
                  dailyListNewHireAgency={dailyListNewHireAgency}
                  setDailyListNewHireAgency={setDailyListNewHireAgency}
                  dailyListNewHireNote={dailyListNewHireNote}
                  setDailyListNewHireNote={setDailyListNewHireNote}
                  clamp={clamp}
                  onClose={() => setDailyListNewHireOpen(false)}
                  addDailyListNewHireDemand={addDailyListNewHireDemand}
                />
              </section>
            )}

            {page === 'employees' && (
              <section className="glass reveal rounded-3xl px-6 py-8">
                <EmployeesToolbar
                  t={t}
                  isLocked={isLocked}
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
                  open={employeeAddOpen}
                  isLocked={isLocked}
                  employeeNewStaffId={employeeNewStaffId}
                  setEmployeeNewStaffId={setEmployeeNewStaffId}
                  employeeNewName={employeeNewName}
                  setEmployeeNewName={setEmployeeNewName}
                  employeeNewAgency={employeeNewAgency}
                  setEmployeeNewAgency={setEmployeeNewAgency}
                  employeeAgencyOptions={employeeAgencyOptions}
                  employeeNewPosition={employeeNewPosition}
                  setEmployeeNewPosition={setEmployeeNewPosition}
                  employeeNewShift={employeeNewShift}
                  setEmployeeNewShift={setEmployeeNewShift}
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
                  isLocked={isLocked}
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
                />

                <EmployeeEditModal
                  open={employeeEditOpen}
                  t={t}
                  isLocked={isLocked}
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
                  employeeEditShift={employeeEditShift}
                  setEmployeeEditShift={setEmployeeEditShift}
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
                isLocked={isLocked}
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
              />
            )}

            {page === 'timecard' && (
              <section className="glass reveal rounded-3xl px-6 py-8">
                <TimecardControls
                  t={t}
                  isLocked={isLocked}
                  serverTime={serverTime}
                  startOfWeekMonday={startOfWeekMonday}
                  addDays={addDays}
                  toDateOnly={toDateOnly}
                  timecardWeekOffset={timecardWeekOffset}
                  setTimecardWeekOffset={setTimecardWeekOffset}
                  timecardWeekInput={timecardWeekInput}
                  setTimecardWeekInput={setTimecardWeekInput}
                  fetchTimecard={fetchTimecard}
                  recomputeTimecardAttendanceMarks={recomputeTimecardAttendanceMarks}
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
                  isLocked={isLocked}
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
                  timecardRowsRendered={timecardRowsRendered}
                  timecardAuditByStaffDate={timecardAuditByStaffDate}
                  openTimecardPunchModal={openTimecardPunchModal}
                  formatAuditDetail={formatAuditDetail}
                  formatCellAuditTime={formatCellAuditTime}
                  normalizeAuditActor={normalizeAuditActor}
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
                isLocked={isLocked}
                uploadFillDuplicates={uploadFillDuplicates}
                setUploadFillDuplicates={setUploadFillDuplicates}
                fileInputRef={fileInputRef}
                onFileSelected={onFileSelected}
                uploadEmployees={uploadEmployees}
                onDownloadTemplate={downloadEmployeeTemplate}
                uploadError={uploadError}
              />
            )}
          </>
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
              <div className="device-label-preview-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-10">
                <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-2xl backdrop-blur">
                  <div className="mb-4 flex items-center justify-between device-label-preview-chrome">
                    <h3 className="font-display text-xl tracking-[0.08em] text-white">{t('打印设备标签', 'Print Device Label')}</h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => printDeviceLabelSheet(deviceLabelPreview)}
                        className="rounded-xl bg-neon px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-xl"
                      >
                        {t('打印', 'Print')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeviceLabelPreview(null)}
                        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/15"
                      >
                        {t('关闭', 'Close')}
                      </button>
                    </div>
                  </div>
                  <p className="mb-4 text-xs text-slate-400 device-label-preview-chrome">{t('打印尺寸：0.7 x 2 inch 标签纸。', 'Print size: 0.7 x 2 inch label.')}</p>
                  <div className="overflow-auto rounded-2xl border border-white/10 bg-black/20 p-4 device-label-preview-canvas">
                    <div className="mx-auto origin-top scale-[2.15] md:scale-[2.45] device-label-preview-scale" style={{ width: '2in' }}>
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
                          <div style={{ fontSize: '7pt', fontWeight: 800, letterSpacing: '0.08em', color: '#334155' }}>OUTBOUNT DEVICE</div>
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

        <footer className="text-center text-xs text-slate-500">
          {isLocked ? t('请求处理中，已锁定交互', 'Request in progress (locked)') : 'Ready'}
        </footer>
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
