import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createSupabaseClient } from '../lib/supabase';
import { isValidStaffId as isValidStaffIdValue, normalizeStaffId } from '../lib/staffId';
import { createPortal } from 'react-dom';

type AdminPage = 'employee_upload' | 'punches' | 'employees' | 'timecard' | 'audit' | 'schedule';

type StatusTone = 'idle' | 'pending' | 'success' | 'error';

type Status = {
  tone: StatusTone;
  message: string;
};

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const ALLOWED_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer'] as const;
type AllowedPosition = (typeof ALLOWED_POSITIONS)[number];
const AUDIT_TABLE = (import.meta.env.VITE_AUDIT_TABLE as string | undefined) ?? 'ob_audit_logs';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';
const APP_SETTINGS_TABLE = (import.meta.env.VITE_APP_SETTINGS_TABLE as string | undefined) ?? 'ob_app_settings';
const STAFF_ID_EDITOR_EMAIL = 'lnchen4201@gmail.com';
const TOMORROW_LIST_PUBLISH_KEY = 'publish_tomorrow_list';
const SCHEDULE_REST_NOTE = '__rest__';

const supabase = createSupabaseClient({ persistSession: true });

type EmployeeRow = {
  id?: number | string;
  staff_id?: string | null;
  name?: string | null;
  agency?: string | null;
  position?: string | null;
  label?: string | null;
  Agency?: string | null;
  Position?: string | null;
  Label?: string | null;
  created_at?: string | null;
};

type TimecardRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  hoursByDay: number[]; // 0..6 (Mon..Sun)
  punchCountByDay: number[]; // 0..6 (Mon..Sun)
  punchCountMismatchByDay: boolean[]; // 0..6 (Mon..Sun)
  scheduledByDay: boolean[]; // 0..6 (Mon..Sun)
  absentByDay: boolean[]; // 0..6 (Mon..Sun)
  inProgressByDay: boolean[]; // 0..6 (Mon..Sun)
  inProgressWeek: boolean;
  manualByDay: boolean[]; // 0..6 (Mon..Sun)
  manualWeek: boolean;
  totalHours: number;
  shift: '' | 'early' | 'late';
};

type PunchRow = {
  id: number | string;
  staff_id: string;
  action: 'IN' | 'OUT';
  created_at: string | null;
};

type AuditRow = {
  id?: number | string;
  created_at?: string | null;
  actor?: string | null;
  action?: string | null;
  staff_id?: string | null;
  target?: string | null;
  payload?: any;
};

type ScheduleRow = {
  id?: number | string;
  staff_id?: string | null;
  date?: string | null; // YYYY-MM-DD
  shift?: 'early' | 'late' | null;
  position?: string | null;
  note?: string | null;
  operator?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type DailyListRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: 'early' | 'late';
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

type AppSettingRow = {
  id?: number | string;
  key?: string | null;
  value?: any;
  updated_at?: string | null;
};

const SCHEDULE_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');
const getTemplateDateByDayIndex = (dayIndex: number) => toDateOnly(addDays(SCHEDULE_TEMPLATE_WEEK_START, dayIndex));
const getDayIndexFromTemplateDate = (dateOnly: string) => {
  const dt = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  const diffDays = Math.round((dt.getTime() - SCHEDULE_TEMPLATE_WEEK_START.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0 || diffDays > 6) return null;
  return diffDays;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
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
const ATTENDANCE_RESET_HOUR_RAW = Number(import.meta.env.VITE_ATTENDANCE_RESET_HOUR ?? 5);
const ATTENDANCE_RESET_HOUR = Number.isFinite(ATTENDANCE_RESET_HOUR_RAW)
  ? clamp(ATTENDANCE_RESET_HOUR_RAW, 0, 23)
  : 5;
const SHIFT_ANALYSIS_DAYS_RAW = Number(import.meta.env.VITE_SHIFT_ANALYSIS_DAYS ?? 30);
const SHIFT_ANALYSIS_DAYS = Number.isFinite(SHIFT_ANALYSIS_DAYS_RAW) ? clamp(SHIFT_ANALYSIS_DAYS_RAW, 1, 90) : 30;
const DAILY_LIST_RESET_HOUR = 5;

const getDayRange = (weekStart: Date, dayIndex: number, dayCount = 1) => {
  const startBase = addDays(weekStart, dayIndex);
  const endBase = addDays(weekStart, dayIndex + dayCount);
  return {
    start: new Date(startBase.getTime() + DAY_CUTOFF_MS),
    end: new Date(endBase.getTime() + DAY_CUTOFF_MS)
  };
};
const getOperationalDateKey = (now: Date, cutoffHour: number) => {
  const operationalStart = new Date(now);
  operationalStart.setHours(cutoffHour, 0, 0, 0);
  if (now.getTime() < operationalStart.getTime()) {
    operationalStart.setDate(operationalStart.getDate() - 1);
  }
  return toDateOnly(operationalStart);
};

const getPositionBadgeClass = (value: string) => {
  const v = value.trim().toLowerCase();
  if (v === 'pick') return 'border-sky-400/60 text-sky-200 bg-sky-500/10';
  if (v === 'pack') return 'border-emerald-400/60 text-emerald-200 bg-emerald-500/10';
  if (v === 'rebin') return 'border-amber-400/60 text-amber-200 bg-amber-500/10';
  if (v === 'preship') return 'border-rose-400/60 text-rose-200 bg-rose-500/10';
  if (v === 'transfer') return 'border-violet-400/60 text-violet-200 bg-violet-500/10';
  return 'border-white/20 text-slate-200 bg-white/5';
};

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
  uid: 'staff_id',
  staffid: 'staff_id',
  staff_id: 'staff_id',
  '工号': 'staff_id',
  '员工号': 'staff_id',
  name: 'name',
  '姓名': 'name',
  agency: 'agency',
  'agency ': 'agency',
  '机构': 'agency',
  '区域': 'agency',
  position: 'position',
  '岗位': 'position',
  '职位': 'position',
  label: 'label',
  '标签': 'label'
};

export default function AdminApp() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isLocked = Boolean(busy);
  const timecardFetchSeqRef = useRef(0);
  const punchesFetchSeqRef = useRef(0);
  const attendanceFetchSeqRef = useRef(0);
  const dailyListResetKeyRef = useRef(getOperationalDateKey(new Date(), DAILY_LIST_RESET_HOUR));
  type EmployeeColumnMode = 'lower' | 'cased';
  const employeeColumnModeRef = useRef<EmployeeColumnMode | null>(null);

  const [page, setPage] = useState<AdminPage>('punches');

  type Lang = 'zh' | 'en';
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const v = localStorage.getItem('obpunch_lang');
      return v === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('obpunch_lang', lang);
    } catch {
      // ignore
    }
  }, [lang]);
  const locale = lang === 'en' ? 'en-US' : 'zh-CN';
  const t = (zh: string, en: string) => (lang === 'en' ? en : zh);

  const [status, setStatus] = useState<Status>({ tone: 'idle', message: '请登录后台' });

  const [offsetMs, setOffsetMs] = useState(0);
  const [serverTime, setServerTime] = useState(() => new Date());

  const [user, setUser] = useState<User | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [recentPunches, setRecentPunches] = useState<Record<string, unknown>[]>([]);
  const [recentPunchesError, setRecentPunchesError] = useState<string | null>(null);
  const [employeeByStaffId, setEmployeeByStaffId] = useState<Record<string, { name: string; agency: string }>>({});
  const [punchesSearch, setPunchesSearch] = useState('');

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [employeeShiftByStaffId, setEmployeeShiftByStaffId] = useState<
    Record<string, { shift: '' | 'early' | 'late'; earlyHours: number; lateHours: number }>
  >({});
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeAgency, setEmployeeAgency] = useState('');
  const [employeePosition, setEmployeePosition] = useState('');
  const [employeeLabel, setEmployeeLabel] = useState('');
  const [, setEmployeesHasMore] = useState(false);
  const [employeeNewStaffId, setEmployeeNewStaffId] = useState('');
  const [employeeNewName, setEmployeeNewName] = useState('');
  const [employeeNewAgency, setEmployeeNewAgency] = useState('');
  const [employeeNewPosition, setEmployeeNewPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [employeeNewLabel, setEmployeeNewLabel] = useState('');
  const [employeeAddOpen, setEmployeeAddOpen] = useState(false);
  const [employeeEditOpen, setEmployeeEditOpen] = useState(false);
  const [employeeEditOriginalStaffId, setEmployeeEditOriginalStaffId] = useState<string | null>(null);
  const [employeeEditStaffId, setEmployeeEditStaffId] = useState<string | null>(null);
  const [employeeEditName, setEmployeeEditName] = useState('');
  const [employeeEditAgency, setEmployeeEditAgency] = useState('');
  const [employeeEditPosition, setEmployeeEditPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [employeeEditLabel, setEmployeeEditLabel] = useState('');

  const [timecardRows, setTimecardRows] = useState<TimecardRow[]>([]);
  const [timecardError, setTimecardError] = useState<string | null>(null);
  const [timecardSearch, setTimecardSearch] = useState('');
  const [timecardAgency, setTimecardAgency] = useState('');
  const [timecardPosition, setTimecardPosition] = useState('');
  const [timecardShift, setTimecardShift] = useState<'' | 'early' | 'late'>('');
  const [timecardInProgressOnly, setTimecardInProgressOnly] = useState(false);
  const [timecardMissingEmployeeOnly, setTimecardMissingEmployeeOnly] = useState(false);
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
  const [timecardPunchAddOpen, setTimecardPunchAddOpen] = useState(false);
  const [timecardPunchEdits, setTimecardPunchEdits] = useState<Record<string, { action: 'IN' | 'OUT'; atLocal: string }>>({});
  const [timecardPunchNew, setTimecardPunchNew] = useState<{ action: 'IN' | 'OUT'; atLocal: string }>({
    action: 'IN',
    atLocal: ''
  });

  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditSearch, setAuditSearch] = useState('');

  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [schedulePunchPresenceKeys, setSchedulePunchPresenceKeys] = useState<Set<string>>(new Set());
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);
  const [scheduleWeekInput, setScheduleWeekInput] = useState(() => toDateOnly(startOfWeekMonday(new Date())));
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [schedulePosition, setSchedulePosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [scheduleLabel, setScheduleLabel] = useState('');
  const [scheduleShift, setScheduleShift] = useState<'' | 'early' | 'late'>('');
  const [scheduleWorkDayFilter, setScheduleWorkDayFilter] = useState<number | null>(null);
  const [schedulePublishTomorrow, setSchedulePublishTomorrow] = useState(false);
  const [schedulePublishForDate, setSchedulePublishForDate] = useState<string>('');
  const [dailyListOpen, setDailyListOpen] = useState(false);
  const [dailyListSelectedPositions, setDailyListSelectedPositions] = useState<Record<AllowedPosition, boolean>>({
    Pick: false,
    Pack: false,
    Rebin: false,
    Preship: false,
    Transfer: false
  });
  const [dailyListFilterPositions, setDailyListFilterPositions] = useState<Record<AllowedPosition, boolean>>({
    Pick: false,
    Pack: false,
    Rebin: false,
    Preship: false,
    Transfer: false
  });
  const deferredScheduleSearch = useDeferredValue(scheduleSearch);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFillDuplicates, setUploadFillDuplicates] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [attendanceStats, setAttendanceStats] = useState<
    Record<string, { early: number; late: number; active: number }>
  >({});
  const [attendanceError, setAttendanceError] = useState<string | null>(null);

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

    employeeColumnModeRef.current = 'lower';
    return 'lower';
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

const getShiftBucketFromDate = (dt: Date) => {
  if (Number.isNaN(dt.getTime())) return null;
  const h = dt.getHours();
  const m = dt.getMinutes();
  const minutes = h * 60 + m;
  const earlyStart = 5 * 60;
  const earlyEnd = 15 * 60; // 3pm
  return minutes >= earlyStart && minutes < earlyEnd ? 'early' : 'late';
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
  if (value === 'early') return 'border-emerald-400/60 text-emerald-200 bg-emerald-500/10';
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

const overlapMs = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

const computeShiftHours = (intervals: Array<{ start: Date; end: Date }>) => {
  let earlyMs = 0;
  let lateMs = 0;
  for (const interval of intervals) {
    const start = interval.start.getTime();
    const end = interval.end.getTime();
    if (end <= start) continue;
    const cursor = new Date(interval.start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() < end) {
      const dayStart = new Date(cursor);
      const earlyStart = new Date(dayStart);
      earlyStart.setHours(5, 0, 0, 0);
      const earlyEnd = new Date(dayStart);
      earlyEnd.setHours(15, 0, 0, 0);
      const lateStart = new Date(earlyEnd);
      const lateEnd = new Date(dayStart);
      lateEnd.setDate(lateEnd.getDate() + 1);
      lateEnd.setHours(5, 0, 0, 0);

      const dayStartMs = dayStart.getTime();
      const dayEndMs = lateEnd.getTime();
      const segmentStart = Math.max(start, dayStartMs);
      const segmentEnd = Math.min(end, dayEndMs);
      if (segmentEnd > segmentStart) {
        earlyMs += overlapMs(segmentStart, segmentEnd, earlyStart.getTime(), earlyEnd.getTime());
        lateMs += overlapMs(segmentStart, segmentEnd, lateStart.getTime(), lateEnd.getTime());
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return { earlyHours: earlyMs / 3600000, lateHours: lateMs / 3600000 };
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
      for (const staff of attendanceStaff) {
        const firstIn = firstInByStaff.get(staff);
        if (!firstIn) continue;
        const pos = staffToPosition.get(staff);
        if (!pos) continue;
        const shift = getShiftBucket(firstIn.at);
        if (!shift) continue;
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
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [offsetMs]);
  useEffect(() => {
    const key = getOperationalDateKey(serverTime, DAILY_LIST_RESET_HOUR);
    if (dailyListResetKeyRef.current === key) return;
    dailyListResetKeyRef.current = key;
    setDailyListSelectedPositions({
      Pick: false,
      Pack: false,
      Rebin: false,
      Preship: false,
      Transfer: false
    });
  }, [serverTime]);

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
    if (!supabase) {
      return;
    }

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }
      setUser(data.session?.user ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
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
    const row: AuditRow = {
      id: `local_${Date.now()}`,
      created_at: new Date(serverTime).toISOString(),
      actor: user?.email ?? null,
      action,
      staff_id: staffId ?? null,
      target: target ?? null,
      payload: payload ?? null
    };
    setAuditRows((prev) => [row, ...prev].slice(0, 200));

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
      setAuditRows(((res.data as any[]) ?? []) as AuditRow[]);
    });
  };

  const fetchSchedule = async () => {
    if (!supabase) {
      setScheduleError('缺少 Supabase 配置。');
      setScheduleRows([]);
      return;
    }

    const startDate = getTemplateDateByDayIndex(0);
    const endDate = getTemplateDateByDayIndex(6);

    await runLocked('schedule', async () => {
      setScheduleError(null);

      let q = supabase
        .from(SCHEDULE_TABLE)
        .select('id, staff_id, date, shift, position, note, operator, updated_at, created_at')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false })
        .order('staff_id', { ascending: true })
        .limit(2000);

      const res = await q;
      if (res.error) {
        if (!isAbortLikeError(res.error.message)) setScheduleError(res.error.message);
        setScheduleRows([]);
        return;
      }

      setScheduleRows(((res.data as any[]) ?? []) as ScheduleRow[]);
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
    nextState: 'empty' | 'work' | 'rest',
    targetShift: 'early' | 'late'
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
    const templateDate = getTemplateDateByDayIndex(dayIndex);
    const existing = scheduleRows.find((row) => {
      const rowStaff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const rowDayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim());
      return rowStaff === staff && rowDayIndex === dayIndex;
    });
    const existingState: 'empty' | 'work' | 'rest' = !existing
      ? 'empty'
      : String(existing.note ?? '').trim() === SCHEDULE_REST_NOTE
        ? 'rest'
        : 'work';
    if (nextState === existingState && (nextState !== 'work' || (existing?.shift ?? 'early') === targetShift)) return;
    if (nextState === 'empty' && !existing) return;

    await runLocked('schedule_toggle', async () => {
      setScheduleError(null);

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
            const rowDayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim());
            return !(rowStaff === staff && rowDayIndex === dayIndex);
          })
        );
        void writeAudit({
          action: 'schedule_clear',
          staffId: staff,
          target: SCHEDULE_TABLE,
          payload: { weekday: dayIndex + 1, template_date: templateDate, removed_id: existing?.id ?? null }
        });
        return;
      }

      const employeePosition = String(employee.position ?? employee.Position ?? '').trim();
      const normalizedPosition =
        ALLOWED_POSITIONS.find((p) => p.toLowerCase() === employeePosition.toLowerCase()) ?? ALLOWED_POSITIONS[0];
      const payload = {
        staff_id: staff,
        date: templateDate,
        shift: targetShift,
        position: normalizedPosition,
        note: nextState === 'rest' ? SCHEDULE_REST_NOTE : null,
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
        shift: targetShift,
        position: normalizedPosition,
        note: nextState === 'rest' ? SCHEDULE_REST_NOTE : null,
        operator: user?.email ?? null,
        updated_at: new Date(serverTime).toISOString()
      };
      setScheduleRows((prev) => {
        let replaced = false;
        const next = prev.map((row) => {
          const rowStaff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const rowDayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim());
          if (rowStaff === staff && rowDayIndex === dayIndex) {
            replaced = true;
            return { ...row, ...localRow };
          }
          return row;
        });
        if (!replaced) next.push(localRow);
        return next;
      });

      void writeAudit({
        action: nextState === 'rest' ? 'schedule_rest' : 'schedule_work',
        staffId: staff,
        target: SCHEDULE_TABLE,
        payload: {
          weekday: dayIndex + 1,
          template_date: templateDate,
          position: normalizedPosition,
          shift: targetShift,
          state: nextState
        }
      });
    });
  };

  const refreshSchedulePanel = async () => {
    await fetchSchedule();
    await fetchEmployees({ reset: true, search: '', agency: '', position: '', label: '' });
    await fetchSchedulePublishSetting();
    await fetchSchedulePunchPresence();
  };

  const fetchSchedulePunchPresence = async () => {
    if (!supabase) {
      setSchedulePunchPresenceKeys(new Set());
      return;
    }

    const staffSet = new Set(
      employees
        .map((e) => normalizeStaffId(String(e.staff_id ?? '').trim()))
        .filter((staff): staff is string => Boolean(staff))
    );
    if (staffSet.size === 0) {
      setSchedulePunchPresenceKeys(new Set());
      return;
    }

    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, scheduleWeekOffset * 7);
    const { start, end } = getDayRange(weekStart, 0, 7);
    const day0StartMs = start.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const found = new Set<string>();

    const pageSize = 2000;
    let page = 0;
    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const res = await supabase
        .from('ob_punches')
        .select('staff_id, created_at')
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .order('created_at', { ascending: true })
        .range(from, to);

      if (res.error) {
        setSchedulePunchPresenceKeys(new Set());
        return;
      }

      const rows = (res.data as any[]) ?? [];
      for (const row of rows) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (!staff || !staffSet.has(staff)) continue;
        const at = new Date(String(row.created_at ?? ''));
        if (Number.isNaN(at.getTime())) continue;
        const dayIndex = Math.floor((at.getTime() - day0StartMs) / dayMs);
        if (dayIndex < 0 || dayIndex > 6) continue;
        found.add(`${staff}__${dayIndex}`);
      }

      if (rows.length < pageSize) break;
      page += 1;
      if (page >= 20) break;
    }

    setSchedulePunchPresenceKeys(found);
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
    search,
    agency,
    position,
    label
  }: {
    reset: boolean;
    search?: string;
    agency?: string;
    position?: string;
    label?: string;
  }) => {
    if (!supabase) {
      setEmployeesError('缺少 Supabase 配置。');
      return;
    }

    const searchValue = (search ?? employeeSearch).trim().replace(/,/g, ' ');
    const agencyValue = (agency ?? employeeAgency).trim();
    const positionValue = (position ?? employeePosition).trim();
    const labelValue = (label ?? employeeLabel).trim();

    await runLocked('employees', async () => {
      setEmployeesError(null);

      const pageSize = 200;
      const rangeEnd = new Date(serverTime);
      const rangeStart = addDays(rangeEnd, -SHIFT_ANALYSIS_DAYS);

      const build = (mode: EmployeeColumnMode, from: number, to: number) => {
        const agencyCol = mode === 'cased' ? 'Agency' : 'agency';
        const positionCol = mode === 'cased' ? 'Position' : 'position';
        const labelCol = 'label';
        const select =
          mode === 'cased'
            ? 'id, staff_id, name, "Agency", "Position", label, created_at'
            : 'id, staff_id, name, agency, position, label, created_at';

        let q = supabase.from(EMPLOYEE_TABLE).select(select).range(from, to);

        if (agencyValue) {
          q = q.ilike(agencyCol as any, `%${agencyValue}%`);
        }

        if (positionValue) {
          q = q.ilike(positionCol as any, `%${positionValue}%`);
        }

        if (labelValue) {
          q = q.ilike(labelCol as any, `%${labelValue}%`);
        }

        if (searchValue) {
          const term = `%${searchValue}%`;
          q = q.or(`staff_id.ilike.${term},name.ilike.${term},${labelCol}.ilike.${term}`);
        }

        return q;
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

      setEmployees(all);
      setEmployeesHasMore(false);

      const staffIds = all.map((e) => String(e.staff_id ?? '').trim()).filter(Boolean);
      if (staffIds.length === 0) {
        setEmployeeShiftByStaffId({});
        return;
      }

      const fetchPunchesForStaff = async (ids: string[]) => {
        const batches = chunk(ids, 200);
        const allRows: Array<{ staff_id: string; action: string; created_at: string | null; id?: any }> = [];
        const punchPageSize = 2000;
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

      const punchesRes = await fetchPunchesForStaff(staffIds);
      if (punchesRes.error) {
        setEmployeeShiftByStaffId({});
        return;
      }

      const eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT' }>> = {};
      for (const p of punchesRes.rows ?? []) {
        const staff = String(p.staff_id ?? '').trim();
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
      for (const staff of staffIds) {
        const events = eventsByStaff[staff] ?? [];
        const intervals: Array<{ start: Date; end: Date }> = [];
        let currentIn: Date | null = null;
        for (const ev of events) {
          if (ev.action === 'IN') {
            currentIn = ev.at;
            continue;
          }
          if (ev.action === 'OUT' && currentIn && ev.at.getTime() > currentIn.getTime()) {
            intervals.push({ start: currentIn, end: ev.at });
            currentIn = null;
          }
        }
        if (currentIn && rangeEnd.getTime() > currentIn.getTime()) {
          intervals.push({ start: currentIn, end: rangeEnd });
        }
        const { earlyHours, lateHours } = computeShiftHours(intervals);
        let shift: '' | 'early' | 'late' = '';
        if (earlyHours > lateHours) shift = 'early';
        else if (lateHours > earlyHours) shift = 'late';
        shiftMap[staff] = { shift, earlyHours, lateHours };
      }
      setEmployeeShiftByStaffId(shiftMap);
    });
  };

  const addEmployeeRow = async () => {
    if (!supabase) {
      setEmployeesError('缺少 Supabase 配置。');
      return;
    }

    const staffRaw = employeeNewStaffId.trim();
    const staff = normalizeStaffId(staffRaw);
    if (!staff || !isValidStaffIdValue(staff)) {
      setEmployeesError('员工ID格式不正确（例如：US010454）。');
      return;
    }

    const name = employeeNewName.trim();
    const agency = employeeNewAgency.trim();
    const position = employeeNewPosition.trim();
    const label = employeeNewLabel.trim();
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
          ? { staff_id: staff, name, Agency: agency, Position: normalizedPos, label: label || null }
          : { staff_id: staff, name, agency, position: normalizedPos, label: label || null };

      const attemptUpsert = await supabase
        .from(EMPLOYEE_TABLE)
        .upsert([payload as any], { onConflict: 'staff_id', ignoreDuplicates: false });

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
        payload: { staff_id: staff, name, agency, position: normalizedPos, label }
      });
      setEmployeeNewStaffId('');
      setEmployeeNewName('');
      setEmployeeNewAgency('');
      setEmployeeNewPosition('');
      setEmployeeNewLabel('');
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

    const ok = window.confirm(`确定要删除员工 ${staff} 吗？此操作不可撤销。`);
    if (!ok) return;

    await runLocked('employee_delete', async () => {
      setEmployeesError(null);
      const { error } = await supabase.from(EMPLOYEE_TABLE).delete().eq('staff_id', staff);
      if (error) {
        setEmployeesError(error.message);
        return;
      }
      setStatus({ tone: 'success', message: `已删除员工：${staff}` });
      await writeAudit({ action: 'employee_delete', staffId: staff, target: EMPLOYEE_TABLE });
      await fetchEmployees({ reset: true });
    });
  };

  const openEmployeeEdit = (payload: { staff: string; name: string; agency: string; position: string; label: string }) => {
    setEmployeesError(null);
    setEmployeeEditOriginalStaffId(payload.staff);
    setEmployeeEditStaffId(payload.staff);
    setEmployeeEditName(payload.name);
    setEmployeeEditAgency(payload.agency);
    const normalized = normalizePositionKey(payload.position);
    setEmployeeEditPosition((normalized ?? '') as (typeof ALLOWED_POSITIONS)[number] | '');
    setEmployeeEditLabel(payload.label);
    setEmployeeEditOpen(true);
  };

  const closeEmployeeEdit = () => {
    setEmployeeEditOpen(false);
    setEmployeeEditOriginalStaffId(null);
    setEmployeeEditStaffId(null);
    setEmployeeEditName('');
    setEmployeeEditAgency('');
    setEmployeeEditPosition('');
    setEmployeeEditLabel('');
  };

  const saveEmployeeEdit = async () => {
    if (!supabase) {
      setEmployeesError('Missing Supabase config.');
      return;
    }
    const canEditStaffId = String(user?.email ?? '').trim().toLowerCase() === STAFF_ID_EDITOR_EMAIL;
    const originalStaff = normalizeStaffId(String(employeeEditOriginalStaffId ?? '').trim());
    const nextStaff = normalizeStaffId(String(employeeEditStaffId ?? '').trim());
    if (!originalStaff || !nextStaff) return;
    if (!canEditStaffId && nextStaff !== originalStaff) {
      setEmployeesError(`Only ${STAFF_ID_EDITOR_EMAIL} can change staff ID.`);
      return;
    }
    if (!isValidStaffIdValue(nextStaff)) {
      setEmployeesError('Invalid staff ID format (e.g. US010454).');
      return;
    }

    const name = employeeEditName.trim();
    const agency = employeeEditAgency.trim();
    const positionRaw = employeeEditPosition.trim();
    const label = employeeEditLabel.trim();
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
        .select(mode === 'cased' ? 'staff_id,name,"Agency","Position",label' : 'staff_id,name,agency,position,label')
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
          ? { staff_id: nextStaff, name, Agency: agency || null, Position: normalizedPos, label: label || null }
          : { staff_id: nextStaff, name, agency: agency || null, position: normalizedPos, label: label || null };
      const { error } = await supabase.from(EMPLOYEE_TABLE).update(payload as any).eq('staff_id', originalStaff);
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
                  label: originalEmployeeRow.label ?? originalEmployeeRow.Label ?? null
                }
              : {
                  staff_id: String(originalEmployeeRow.staff_id ?? originalStaff),
                  name: originalEmployeeRow.name ?? null,
                  agency: originalEmployeeRow.agency ?? null,
                  position: originalEmployeeRow.position ?? null,
                  label: originalEmployeeRow.label ?? originalEmployeeRow.Label ?? null
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
          migrated_punch_rows: migratedPunchCount,
          migrated_schedule_rows: migratedScheduleCount
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
        label: employeeLabel
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
    const fmtTime = (value: any) => {
      const raw = String(value ?? '').trim();
      if (!raw) return '';
      const dt = new Date(raw);
      return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleString(locale, { hour12: false });
    };
    const fmtAction = (value: any) => (String(value ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN');

    let summary = action || '-';
    if (action === 'employee_upsert') {
      summary = t('新增/更新员工', 'Employee upsert');
      push(t('姓名', 'Name'), payload?.name);
      push('Agency', payload?.agency);
      push(t('岗位', 'Position'), payload?.position);
    } else if (action === 'employee_update') {
      summary = t('更新员工信息', 'Employee updated');
      push(t('姓名', 'Name'), payload?.name);
      push('Agency', payload?.agency);
      push(t('岗位', 'Position'), payload?.position);
    } else if (action === 'employee_delete') {
      summary = t('删除员工', 'Employee deleted');
    } else if (action === 'employee_upload') {
      summary = t('批量上传员工', 'Employee upload');
      push(t('文件', 'File'), payload?.file_name);
      push(t('总行数', 'Total rows'), payload?.total_rows);
      push(t('插入', 'Inserted'), payload?.inserted);
      push(t('补全更新', 'Updated'), payload?.updated_fill);
      push(t('跳过', 'Skipped'), payload?.skipped_total);
    } else if (action === 'punch_manual_add') {
      summary = t('手动新增打卡', 'Manual punch add');
      push(t('动作', 'Action'), fmtAction(payload?.action));
      push(t('时间', 'Time'), fmtTime(payload?.created_at));
      push(t('记录ID', 'Punch ID'), payload?.punch_id);
    } else if (action === 'punch_manual_edit') {
      summary = t('手动修改打卡', 'Manual punch edit');
      const before = payload?.before ?? null;
      const after = payload?.after ?? null;
      const beforeText = before ? `${fmtAction(before.action)} @ ${fmtTime(before.created_at)}` : '';
      const afterText = after ? `${fmtAction(after.action)} @ ${fmtTime(after.created_at)}` : '';
      push(t('修改前', 'Before'), beforeText);
      push(t('修改后', 'After'), afterText);
      push(t('记录ID', 'Punch ID'), payload?.punch_id);
    } else if (action === 'punch_manual_delete') {
      summary = t('手动删除打卡', 'Manual punch delete');
      const before = payload?.before ?? null;
      const beforeText = before ? `${fmtAction(before.action)} @ ${fmtTime(before.created_at)}` : '';
      push(t('删除记录', 'Deleted'), beforeText);
      push(t('记录ID', 'Punch ID'), payload?.punch_id);
    }

    if (action === 'schedule_work') {
      summary = t('排班改为工作', 'Schedule set to Work');
      push(t('班次', 'Shift'), payload?.shift);
      push(t('岗位', 'Position'), payload?.position);
      push(t('星期', 'Weekday'), payload?.weekday);
      push(t('模板日期', 'Template date'), payload?.template_date);
    } else if (action === 'schedule_rest') {
      summary = t('排班改为休息', 'Schedule set to Rest');
      push(t('班次', 'Shift'), payload?.shift);
      push(t('岗位', 'Position'), payload?.position);
      push(t('星期', 'Weekday'), payload?.weekday);
      push(t('模板日期', 'Template date'), payload?.template_date);
    } else if (action === 'schedule_clear') {
      summary = t('清空排班', 'Schedule cleared');
      push(t('星期', 'Weekday'), payload?.weekday);
      push(t('模板日期', 'Template date'), payload?.template_date);
      push(t('删除ID', 'Removed ID'), payload?.removed_id);
    }

    if (details.length === 0 && payload) {
      let payloadText = '';
      try {
        payloadText = JSON.stringify(payload, null, 0);
      } catch {
        payloadText = String(payload ?? '');
      }
      if (payloadText.length > 260) payloadText = `${payloadText.slice(0, 260)}…`;
      if (payloadText) details.push({ label: 'Payload', value: payloadText });
    }

    return { summary, details };
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
    const nowMs = Date.now();
    const startedDayByIndex = Array.from({ length: 7 }, (_, dayIndex) => {
      const { start } = getDayRange(weekStart, dayIndex);
      return start.getTime() <= nowMs;
    });
    const closedDayByIndex = Array.from({ length: 7 }, (_, dayIndex) => {
      const { end } = getDayRange(weekStart, dayIndex);
      return end.getTime() <= nowMs;
    });

    const pageSize = 50;

    const fetchProfilesByStaffId = async (staffIds: string[]) => {
      const staffToProfile = new Map<string, { name: string; agency: string; position: string }>();
      if (!supabase) {
        return { staffToProfile, error: 'Missing Supabase config.' };
      }
      if (staffIds.length === 0) {
        return { staffToProfile, error: null as string | null };
      }

      const mode = await resolveEmployeeColumnMode();
      const batches = chunk(staffIds, 200);
      for (const batch of batches) {
        const run = async (m: EmployeeColumnMode) => {
          const select = m === 'cased' ? 'staff_id, name, "Agency", "Position"' : 'staff_id, name, agency, position';
          return await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', batch);
        };

        let res = await run(mode);
        if (res.error) {
          const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
          employeeColumnModeRef.current = flipped;
          res = await run(flipped);
        }
        if (res.error) {
          return {
            staffToProfile: new Map<string, { name: string; agency: string; position: string }>(),
            error: res.error.message
          };
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

      return { staffToProfile, error: null as string | null };
    };

    const fetchScheduledByStaff = async (staffIds: string[]) => {
      const scheduledByStaff: Record<string, boolean[]> = {};
      if (!supabase || staffIds.length === 0) {
        return { scheduledByStaff, error: null as string | null };
      }
      const batches = chunk(staffIds, 200);
      const startDate = getTemplateDateByDayIndex(0);
      const endDate = getTemplateDateByDayIndex(6);
      for (const batch of batches) {
        const { data, error } = await supabase
          .from(SCHEDULE_TABLE)
          .select('staff_id, date, note')
          .in('staff_id', batch)
          .gte('date', startDate)
          .lte('date', endDate);
        if (error) {
          return { scheduledByStaff: {} as Record<string, boolean[]>, error: error.message };
        }
        for (const row of (data as any[] | null) ?? []) {
          const staff = String(row.staff_id ?? '').trim();
          const dayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim());
          if (!staff || dayIndex === null) continue;
          const isRest = String(row.note ?? '').trim() === SCHEDULE_REST_NOTE;
          const arr = (scheduledByStaff[staff] ??= new Array(7).fill(false) as boolean[]);
          arr[dayIndex] = !isRest;
        }
      }
      return { scheduledByStaff, error: null as string | null };
    };

    const fetchPunchesInRange = async () => {
      if (!supabase) {
        return { rows: [] as any[], error: 'Missing Supabase config.' };
      }

      const punchPageSize = 2000;
      const maxPages = 80;
      const all: any[] = [];

      const base = () =>
        supabase
          .from('ob_punches')
          .select('id, staff_id, action, created_at, metadata')
          .gte('created_at', rangeStart.toISOString())
          .lt('created_at', rangeEnd.toISOString());

      for (let page = 0; page < maxPages; page += 1) {
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
      eventsByStaff,
      scheduledByStaff,
      capEnd
    }: {
      staff: string;
      name: string;
      agency: string;
      position: string;
      eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT'; manual: boolean }>>;
      scheduledByStaff: Record<string, boolean[]>;
      capEnd: Date;
    }): TimecardRow => {
      const events = eventsByStaff[staff] ?? [];
      const intervals: Array<{ start: Date; end: Date }> = [];
      let currentIn: Date | null = null;
      let firstInInWeek: Date | null = null;
      for (const ev of events) {
        if (ev.action === 'IN') {
          currentIn = ev.at;
          if (!firstInInWeek && ev.at.getTime() >= weekStart.getTime() && ev.at.getTime() < weekEnd.getTime()) {
            firstInInWeek = ev.at;
          }
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
        for (let idx = 0; idx < 7; idx += 1) {
          const { start: dayStart, end: dayEnd } = getDayRange(weekStart, idx);
          if (ev.at.getTime() >= dayStart.getTime() && ev.at.getTime() < dayEnd.getTime()) {
            punchCountByDay[idx] += 1;
            hasPunchByDay[idx] = true;
            break;
          }
        }
      }
      const manualByDay = new Array(7).fill(false) as boolean[];
      for (const ev of events) {
        if (!ev.manual) continue;
        for (let idx = 0; idx < 7; idx++) {
          const { start: dayStart, end: dayEnd } = getDayRange(weekStart, idx);
          if (ev.at.getTime() >= dayStart.getTime() && ev.at.getTime() < dayEnd.getTime()) {
            manualByDay[idx] = true;
            break;
          }
        }
      }
      const manualWeek = manualByDay.some(Boolean);
      const totalHours = hoursByDay.reduce((sum, v) => sum + v, 0);
      const shift = firstInInWeek ? (getShiftBucketFromDate(firstInInWeek) ?? '') : '';
      const scheduledByDay = scheduledByStaff[staff] ?? (new Array(7).fill(false) as boolean[]);
      const absentByDay = scheduledByDay.map(
        (scheduled, idx) => Boolean(scheduled && startedDayByIndex[idx] && !hasPunchByDay[idx] && !inProgressByDay[idx])
      );
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
        inProgressByDay,
        inProgressWeek,
        manualByDay,
        manualWeek,
        totalHours,
        shift
      };
    };

    const exec = async (from: number) => {
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
          const meta = (p as any).metadata;
          const kind = typeof meta?.kind === 'string' ? String(meta.kind) : '';
          const manual = Boolean(meta && (meta.manual === true || kind.startsWith('manual_')));
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

        const now = new Date();
        const capEnd = new Date(clamp(now.getTime(), rangeStart.getTime(), rangeEnd.getTime()));

        const profilesRes = await fetchProfilesByStaffId(allStaffIds);
        if (profilesRes.error) {
          return { rows: [] as TimecardRow[], hasMore: false, error: profilesRes.error };
        }

        const isMissingProfile = (profile: { name: string; agency: string; position: string } | undefined) => {
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

        const scheduledRes = await fetchScheduledByStaff(staffIds);
        if (scheduledRes.error) {
          return { rows: [] as TimecardRow[], hasMore: false, error: scheduledRes.error };
        }

        const rows: TimecardRow[] = staffIds.map((staff) => {
          const profile = profilesRes.staffToProfile.get(staff) ?? { name: '', agency: '', position: '' };
          return buildTimecardRow({
            staff,
            name: profile.name,
            agency: profile.agency,
            position: profile.position,
            eventsByStaff,
            scheduledByStaff: scheduledRes.scheduledByStaff,
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
        const select = m === 'cased' ? 'staff_id, name, "Agency", "Position"' : 'staff_id, name, agency, position';

        let q = supabase.from(EMPLOYEE_TABLE).select(select).range(from, to);
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
      const staffIds = employees.map((e) => String(e.staff_id ?? '').trim()).filter(Boolean);
      if (staffIds.length === 0) {
        return { rows: [] as TimecardRow[], hasMore: false, error: null as string | null };
      }

      const fetchPunchesForStaff = async (ids: string[]) => {
        // chunk to avoid huge IN lists
        const batches = chunk(ids, 200);
        const all: Array<{ staff_id: string; action: string; created_at: string | null; id?: any }> = [];
        for (const batch of batches) {
          const base = () =>
            supabase
              .from('ob_punches')
              .select('id, staff_id, action, created_at, metadata')
              .in('staff_id', batch)
              .gte('created_at', rangeStart.toISOString())
              .lt('created_at', rangeEnd.toISOString());

          const attemptCreatedAt = await base().order('created_at', { ascending: true });
          const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: true }) : attemptCreatedAt;
          if (attempt.error) {
            return { rows: null as any, error: attempt.error.message };
          }
          all.push(...(((attempt.data as any[]) ?? []) as any[]));
        }
        return { rows: all, error: null as string | null };
      };

      const punchesRes = await fetchPunchesForStaff(staffIds);
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
        const meta = (p as any).metadata;
        const kind = typeof meta?.kind === 'string' ? String(meta.kind) : '';
        const manual = Boolean(meta && (meta.manual === true || kind.startsWith('manual_')));
        (eventsByStaff[staff] ??= []).push({ at, action, manual });
      }
      for (const staff of Object.keys(eventsByStaff)) {
        eventsByStaff[staff]!.sort((a, b) => a.at.getTime() - b.at.getTime());
      }

      const now = new Date();
      const capEnd = new Date(clamp(now.getTime(), rangeStart.getTime(), rangeEnd.getTime()));
      const scheduledRes = await fetchScheduledByStaff(staffIds);
      if (scheduledRes.error) {
        return { rows: [] as TimecardRow[], hasMore: false, error: scheduledRes.error };
      }

      const rows: TimecardRow[] = employees.map((e) => {
        const staff = String(e.staff_id ?? '').trim();
        const name = String(e.name ?? '').trim();
        const agency = String(e.agency ?? e.Agency ?? '').trim();
        const position = String(e.position ?? e.Position ?? '').trim();
        return buildTimecardRow({
          staff,
          name,
          agency,
          position,
          eventsByStaff,
          scheduledByStaff: scheduledRes.scheduledByStaff,
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
      const seq = ++timecardFetchSeqRef.current;
      const result = await fetchAll();
      if (seq !== timecardFetchSeqRef.current) {
        return;
      }
      setTimecardError(isAbortLikeError(result.error) ? null : result.error);
      setTimecardRows(result.rows);
      setTimecardHasMore(false);
      return;
    }

    await runLocked('timecard', async () => {
      setTimecardError(null);
      const result = await fetchAll();
      if (result.error) {
        if (!isAbortLikeError(result.error)) setTimecardError(result.error);
        setTimecardRows([]);
        setTimecardHasMore(false);
        return;
      }
      setTimecardRows(result.rows);
      setTimecardHasMore(false);
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

      if (punches.length === 0) {
        setStatus({ tone: 'error', message: '该日期暂无打卡记录。' });
        return;
      }

      const staffIds = Array.from(new Set(punches.map((p) => p.staff_id)));
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
      for (const p of punches) {
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
    setTimecardPunchAddOpen(false);
    setTimecardPunchEdits({});
    setTimecardPunchNew({ action: 'IN', atLocal: toLocalDateTimeInputValue(new Date(serverTime)) });

    await runLocked('timecard_punches', async () => {
      const res = await fetchPunchRowsForTimecard(staff, dayIndex);
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
    });
  };

  const closeTimecardPunchModal = () => {
    setTimecardPunchOpen(false);
    setTimecardPunchStaffId(null);
    setTimecardPunchDayIndex(null);
    setTimecardPunchRows([]);
    setTimecardPunchError(null);
    setTimecardPunchShowAll(false);
    setTimecardPunchAddOpen(false);
    setTimecardPunchEdits({});
    setTimecardPunchNew({ action: 'IN', atLocal: '' });
  };

  const addTimecardPunchRow = async () => {
    if (!supabase) {
      setTimecardPunchError('缺少 Supabase 配置。');
      return;
    }
    const staff = timecardPunchStaffId;
    if (!staff) {
      return;
    }

    const createdAt = parseLocalDateTimeInputValue(timecardPunchNew.atLocal);
    if (!createdAt) {
      setTimecardPunchError('时间格式不正确。');
      return;
    }

      await runLocked('timecard_add', async () => {
        setTimecardPunchError(null);
        const insertRes = await supabase.from('ob_punches').insert([
          {
            staff_id: staff,
            action: timecardPunchNew.action,
            created_at: createdAt,
            metadata: {
              device: 'admin_console',
              kind: 'manual_add',
              manual: true,
              operator: user?.email ?? null
            }
          }
        ]).select('id');
        if (insertRes.error) {
          setTimecardPunchError(insertRes.error.message);
          return;
        }
        const insertedId = String(((insertRes.data as any[] | null) ?? [])[0]?.id ?? '').trim() || null;
        await writeAudit({
          action: 'punch_manual_add',
          staffId: staff,
          target: 'ob_punches',
          payload: {
            punch_id: insertedId,
            day_index: timecardPunchDayIndex,
            action: timecardPunchNew.action,
            created_at: createdAt
          }
        });

      const res = await fetchPunchRowsForTimecard(staff, timecardPunchDayIndex);
      if (res.error) {
        setTimecardPunchError(res.error);
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
      setTimecardPunchNew((prev) => ({ ...prev, atLocal: toLocalDateTimeInputValue(new Date(serverTime)) }));

      await fetchTimecard({ reset: true });
    });
  };

  const saveTimecardPunchRow = async (rowId: string) => {
    if (!supabase) {
      setTimecardPunchError('缺少 Supabase 配置。');
      return;
    }
    const staff = timecardPunchStaffId;
    if (!staff) {
      return;
    }

    const edit = timecardPunchEdits[rowId];
    if (!edit) {
      return;
    }
    const createdAt = parseLocalDateTimeInputValue(edit.atLocal);
    if (!createdAt) {
      setTimecardPunchError('时间格式不正确。');
      return;
    }

    await runLocked('timecard_edit', async () => {
      setTimecardPunchError(null);
      const prevRowRes = await supabase.from('ob_punches').select('action, created_at, staff_id, metadata').eq('id', rowId).maybeSingle();
      const prevRow = (prevRowRes.data as any) ?? null;
      const prevMeta = prevRow?.metadata;
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
        .update({ action: edit.action, created_at: createdAt, metadata: nextMeta })
        .eq('id', rowId);
      if (error) {
        setTimecardPunchError(error.message);
        return;
      }
      await writeAudit({
        action: 'punch_manual_edit',
        staffId: staff,
        target: 'ob_punches',
        payload: {
          punch_id: rowId,
          before: prevRow
            ? { action: String(prevRow.action ?? ''), created_at: String(prevRow.created_at ?? ''), metadata: prevRow.metadata ?? null }
            : null,
          after: { action: edit.action, created_at: createdAt, metadata: nextMeta }
        }
      });

      const res = await fetchPunchRowsForTimecard(staff, timecardPunchDayIndex);
      if (res.error) {
        setTimecardPunchError(res.error);
        return;
      }
      setTimecardPunchRows(res.rows);

      // refresh timecard numbers
      await fetchTimecard({ reset: true });
    });
  };

  const deleteTimecardPunchRow = async (rowId: string) => {
    if (!supabase) {
      setTimecardPunchError('缺少 Supabase 配置。');
      return;
    }
    const staff = timecardPunchStaffId;
    if (!staff) {
      return;
    }

    const ok = window.confirm('确定要删除这条打卡记录吗？此操作不可撤销。');
    if (!ok) {
      return;
    }

    await runLocked('timecard_delete', async () => {
      setTimecardPunchError(null);
      const prevRowRes = await supabase.from('ob_punches').select('action, created_at, staff_id, metadata').eq('id', rowId).maybeSingle();
      const prevRow = (prevRowRes.data as any) ?? null;
      const { error } = await supabase.from('ob_punches').delete().eq('id', rowId);
      if (error) {
        setTimecardPunchError(error.message);
        return;
      }
      await writeAudit({
        action: 'punch_manual_delete',
        staffId: staff,
        target: 'ob_punches',
        payload: {
          punch_id: rowId,
          before: prevRow
            ? { action: String(prevRow.action ?? ''), created_at: String(prevRow.created_at ?? ''), metadata: prevRow.metadata ?? null }
            : null
        }
      });

      const res = await fetchPunchRowsForTimecard(staff, timecardPunchDayIndex);
      if (res.error) {
        setTimecardPunchError(res.error);
        return;
      }
      setTimecardPunchRows(res.rows);

      // refresh timecard numbers
      await fetchTimecard({ reset: true });
    });
  };

  useEffect(() => {
    // 当切换到页面时自动加载
    if (page === 'punches') {
      void fetchRecentPunches({ search: punchesSearch });
    }
    if (page === 'employees') {
      void fetchEmployees({ reset: true });
    }
    if (page === 'timecard') {
      void fetchTimecard({ reset: true });
    }
    if (page === 'audit') {
      void fetchAudit({ search: auditSearch });
    }
    if (page === 'schedule') {
      void refreshSchedulePanel();
    }
  }, [page]);

  useEffect(() => {
    if (!user) {
      setAttendanceStats({});
      setAttendanceError(null);
      return;
    }
    let active = true;
    void (async () => {
      if (!active) return;
      await fetchRealtimeAttendance();
    })();
    const timer = window.setInterval(() => {
      void fetchRealtimeAttendance();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user, offsetMs]);

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
    void fetchSchedulePunchPresence();
  }, [page, scheduleWeekOffset, employees, serverTime]);

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

    const uniqueByStaff = new Map<string, { staff_id: string; name?: string; agency?: string; position?: string; label?: string }>();
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

      const record: { staff_id: string; name?: string; agency?: string; position?: string; label?: string } = { staff_id: staff };
      if (name) record.name = name;
      if (agency) record.agency = agency;
      if (position) record.position = position;
      if (positionRaw && !position) record.position = positionRaw;
      if (label) record.label = label;
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

    const writeEmployeeBatch = async (batch: any[]) => {
      const batchStaffIds = batch.map((r) => String(r.staff_id ?? '').trim()).filter(Boolean);
      if (batchStaffIds.length === 0) {
        return { error: null as any, inserted: 0, skippedExisting: 0, updated: 0 };
      }

      const fetchExistingDetails = async () => {
        const mode = await resolveEmployeeColumnMode();
        const run = async (m: EmployeeColumnMode) => {
          const select = m === 'cased' ? 'staff_id, name, "Agency", "Position", label' : 'staff_id, name, agency, position, label';
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
        return { error: existingDetailsRes.error, inserted: 0, skippedExisting: 0, updated: 0 };
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
                label: row.label ?? null
              }))
            : toInsert.map((row: any) => ({
                staff_id: row.staff_id,
                name: row.name ?? null,
                agency: row.agency ?? null,
                position: row.position ?? null,
                label: row.label ?? null
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
            return { error: attemptMinimal.error, inserted: 0, skippedExisting, updated: 0 };
          }
          insertedCount = toInsert.length;
        }
      }

      const existingByStaff = new Map<string, { name: string; agency: string; position: string; label: string }>();
      for (const r of existingDetailsRes.rows) {
        const staff = String(r.staff_id ?? '').trim();
        if (!staff) continue;
        existingByStaff.set(staff, {
          name: String(r.name ?? '').trim(),
          agency: String(r.agency ?? r.Agency ?? '').trim(),
          position: String(r.position ?? r.Position ?? '').trim(),
          label: String(r.label ?? r.Label ?? '').trim()
        });
      }

      if (!uploadFillDuplicates || skippedExisting === 0) {
        return { error: null as any, inserted: insertedCount, skippedExisting, updated: 0 };
      }

      const toUpdate: Array<{ staff_id: string; payload: Record<string, unknown> }> = [];
      for (const row of batch) {
        const staff = String(row.staff_id ?? '').trim();
        if (!staff || !existingSet.has(staff)) continue;
        const existing = existingByStaff.get(staff) ?? { name: '', agency: '', position: '', label: '' };

        const payload: Record<string, unknown> = {};
        if (!existing.name && row.name) payload.name = row.name;
        if (!existing.agency && row.agency) {
          if (existingDetailsRes.mode === 'cased') payload.Agency = row.agency;
          else payload.agency = row.agency;
        }
        if (!existing.position && row.position) {
          if (existingDetailsRes.mode === 'cased') payload.Position = row.position;
          else payload.position = row.position;
        }
        if (!existing.label && row.label) payload.label = row.label;

        if (Object.keys(payload).length > 0) {
          toUpdate.push({ staff_id: staff, payload });
        }
      }

      if (toUpdate.length === 0) {
        return { error: null as any, inserted: insertedCount, skippedExisting, updated: 0 };
      }

      let updated = 0;
      for (const u of toUpdate) {
        const res = await supabase.from(EMPLOYEE_TABLE).update(u.payload).eq('staff_id', u.staff_id);
        if (res.error) {
          return { error: res.error, inserted: insertedCount, skippedExisting, updated };
        }
        updated += 1;
      }

      return { error: null as any, inserted: insertedCount, skippedExisting, updated };
    };

    await runLocked('employee_upload', async () => {
      setUploadError(null);
      setStatus({ tone: 'pending', message: `上传中... (${rows.length} 条)` });
      const batches = chunk(rows, 200);
      let insertedTotal = 0;
      let skippedExistingTotal = 0;
      let updatedTotal = 0;
      for (const batch of batches) {
        const { error, inserted, skippedExisting, updated } = await writeEmployeeBatch(batch as any[]);
        if (error) {
          setUploadError(error.message);
          setStatus({ tone: 'error', message: '上传失败' });
          return;
        }
        insertedTotal += inserted ?? 0;
        skippedExistingTotal += skippedExisting ?? 0;
        updatedTotal += updated ?? 0;
      }
      const skippedTotal = duplicateInFileCount + skippedExistingTotal;
      setStatus({
        tone: 'success',
        message: `上传完成：插入 ${insertedTotal} 条，补全更新 ${updatedTotal} 条，跳过重复 ${skippedTotal} 条（文件内 ${duplicateInFileCount}，表内 ${skippedExistingTotal}）`
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
      active ? 'bg-neon text-ink shadow-glow' : 'bg-white/5 text-slate-200 hover:bg-white/10',
      isLocked ? 'cursor-not-allowed opacity-60' : ''
    ].join(' ');

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
    const searchNeedle = employeeSearch.trim().toLowerCase();
    const agencyNeedle = employeeAgency.trim().toLowerCase();
    const positionNeedle = employeePosition.trim().toLowerCase();
    const labelNeedle = employeeLabel.trim().toLowerCase();
    return employees.filter((e) => {
      const staff = normalizeStaffId(String(e.staff_id ?? '').trim());
      const name = String(e.name ?? '').trim();
      const agency = String(e.agency ?? e.Agency ?? '').trim();
      const position = String(e.position ?? e.Position ?? '').trim();
      const label = String(e.label ?? e.Label ?? '').trim();
      if (agencyNeedle && !agency.toLowerCase().includes(agencyNeedle)) return false;
      if (positionNeedle && !position.toLowerCase().includes(positionNeedle)) return false;
      if (labelNeedle && !label.toLowerCase().includes(labelNeedle)) return false;
      if (!searchNeedle) return true;
      return [staff, name, label].join(' ').toLowerCase().includes(searchNeedle);
    });
  }, [employees, employeeSearch, employeeAgency, employeePosition, employeeLabel]);

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
    return timecardRows.filter((r) => {
      if (timecardShift && r.shift !== timecardShift) return false;
      if (timecardInProgressOnly && !r.inProgressWeek) return false;
      return true;
    });
  }, [timecardRows, timecardShift, timecardInProgressOnly]);
  const timecardDayTotalHours = useMemo(() => {
    const totals = new Array(7).fill(0) as number[];
    for (const row of timecardRowsFiltered) {
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        totals[dayIndex] += Number(row.hoursByDay?.[dayIndex] ?? 0);
      }
    }
    return totals;
  }, [timecardRowsFiltered]);

  const timecardPunchRowsVisible = useMemo(() => {
    if (timecardPunchShowAll) return timecardPunchRows;
    if (timecardPunchDayIndex === null) return timecardPunchRows; // week view

    const idx = timecardPunchDayIndex;
    if (idx < 0 || idx > 6) return timecardPunchRows;

    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);

    const { start: dayStart, end: dayEnd } = getDayRange(weekStart, idx);
    const includedIds = new Set<string>();

    const events = timecardPunchRows
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
      if (ev.at.getTime() >= dayStart.getTime() && ev.at.getTime() < dayEnd.getTime()) {
        includedIds.add(ev.id);
      }
    }

    if (currentIn) {
      const now = new Date();
      const capEnd = new Date(clamp(now.getTime(), dayStart.getTime(), dayEnd.getTime()));
      if (overlaps(dayStart, dayEnd, currentIn.at, capEnd)) {
        includedIds.add(currentIn.id);
      }
    }

    return timecardPunchRows.filter((r) => includedIds.has(String(r.id)));
  }, [timecardPunchRows, timecardPunchShowAll, timecardPunchDayIndex, timecardWeekOffset, serverTime]);

  const timecardPunchReadOnly = timecardPunchDayIndex === null;

  const scheduleWeekStart = useMemo(() => {
    const baseWeekStart = startOfWeekMonday(serverTime);
    return addDays(baseWeekStart, scheduleWeekOffset * 7);
  }, [serverTime, scheduleWeekOffset]);

  const scheduleDays = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => addDays(scheduleWeekStart, idx)),
    [scheduleWeekStart]
  );

  const scheduleRowsByStaffDayIndex = useMemo(() => {
    const map = new Map<string, ScheduleRow>();
    for (const row of scheduleRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const dayIndex = getDayIndexFromTemplateDate(String(row.date ?? '').trim());
      if (!staff || dayIndex === null) continue;
      map.set(`${staff}__${dayIndex}`, row);
    }
    return map;
  }, [scheduleRows]);
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
    const tomorrow = addDays(new Date(serverTime), 1);
    const dayIndex = (tomorrow.getDay() + 6) % 7; // Mon=0..Sun=6
    const templateDate = getTemplateDateByDayIndex(dayIndex);
    const byStaff = new Map<string, ScheduleRow>();
    for (const row of scheduleRows) {
      const rowTemplateDate = String(row.date ?? '').trim();
      if (rowTemplateDate !== templateDate) continue;
      if (String(row.note ?? '').trim() === SCHEDULE_REST_NOTE) continue;
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff || byStaff.has(staff)) continue;
      byStaff.set(staff, row);
    }

    const earlyRows: DailyListRow[] = [];
    const lateRows: DailyListRow[] = [];
    for (const [staff, row] of byStaff.entries()) {
      const profile = employeeProfileByStaffId.get(staff);
      const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
      const scheduledShift = normalizeShiftValue(String(row.shift ?? '').trim());
      const shift: 'early' | 'late' = (inferredShift || scheduledShift || 'early') as 'early' | 'late';
      const item: DailyListRow = {
        staff_id: staff,
        name: profile?.name || '',
        agency: profile?.agency || '',
        position: String(row.position ?? '').trim() || profile?.position || '',
        shift
      };
      if (shift === 'late') lateRows.push(item);
      else earlyRows.push(item);
    }
    earlyRows.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));
    lateRows.sort((a, b) => a.staff_id.localeCompare(b.staff_id, 'en-US'));

    return {
      targetDate: toDateOnly(tomorrow),
      weekday: tomorrow.toLocaleDateString('en-US', { weekday: 'short' }),
      earlyRows,
      lateRows
    };
  }, [serverTime, scheduleRows, employeeProfileByStaffId, employeeShiftByStaffId]);
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
  const selectedDailyPositions = useMemo(
    () => ALLOWED_POSITIONS.filter((position) => Boolean(dailyListSelectedPositions[position])),
    [dailyListSelectedPositions]
  );
  const selectedDailyFilterPositions = useMemo(
    () => ALLOWED_POSITIONS.filter((position) => Boolean(dailyListFilterPositions[position])),
    [dailyListFilterPositions]
  );
  const canCopyDailyList = selectedDailyPositions.length > 0;
  const tomorrowDailyRowsForCopy = useMemo(() => {
    if (!canCopyDailyList) {
      return { earlyRows: [] as DailyListRow[], lateRows: [] as DailyListRow[] };
    }
    const allowed = new Set(selectedDailyPositions);
    const match = (row: DailyListRow) => {
      const pos = normalizePositionKey(String(row.position ?? '').trim());
      return Boolean(pos && allowed.has(pos as AllowedPosition));
    };
    return {
      earlyRows: tomorrowDailyList.earlyRows.filter(match),
      lateRows: tomorrowDailyList.lateRows.filter(match)
    };
  }, [tomorrowDailyList, selectedDailyPositions, canCopyDailyList]);
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

  const scheduleEmployeesBase = useMemo(() => {
    return employees
      .filter((employee) => {
        const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
        const position = String(employee.position ?? employee.Position ?? '').trim();
        const label = String(employee.label ?? employee.Label ?? '').trim();
        if (!staff) return false;
        if (scheduleWorkDayFilter !== null) {
          const row = scheduleRowsByStaffDayIndex.get(`${staff}__${scheduleWorkDayFilter}`);
          const isWork = Boolean(row) && String(row?.note ?? '').trim() !== SCHEDULE_REST_NOTE;
          if (!isWork) return false;
        }
        if (schedulePosition && position.toLowerCase() !== schedulePosition.toLowerCase()) return false;
        if (scheduleLabel && !label.toLowerCase().includes(scheduleLabel.toLowerCase())) return false;
        if (scheduleShift) {
          const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
          if (inferredShift !== scheduleShift) return false;
        }
        return true;
      })
      .sort((a, b) => String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''), 'en-US'));
  }, [employees, schedulePosition, scheduleLabel, scheduleShift, employeeShiftByStaffId, scheduleWorkDayFilter, scheduleRowsByStaffDayIndex]);

  const scheduleLabelOptions = useMemo(() => {
    const out = new Set<string>();
    for (const employee of employees) {
      const position = String(employee.position ?? employee.Position ?? '').trim();
      if (schedulePosition && position.toLowerCase() !== schedulePosition.toLowerCase()) continue;
      const label = String(employee.label ?? employee.Label ?? '').trim();
      if (label) out.add(label);
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [employees, schedulePosition]);

  const scheduleEmployeesFiltered = useMemo(() => {
    const search = deferredScheduleSearch.trim().toLowerCase();
    if (!search) return scheduleEmployeesBase;
    return scheduleEmployeesBase.filter((employee) => {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      const name = String(employee.name ?? '').trim();
      const position = String(employee.position ?? employee.Position ?? '').trim();
      return [staff, name, position].join(' ').toLowerCase().includes(search);
    });
  }, [scheduleEmployeesBase, deferredScheduleSearch]);

  const scheduleWorkingCountByDayIndex = useMemo(() => {
    const counts = Array.from({ length: 7 }, () => 0);
    for (const employee of scheduleEmployeesFiltered) {
      const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
      if (!staff) continue;
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
        if (!row) continue;
        const isRest = String(row.note ?? '').trim() === SCHEDULE_REST_NOTE;
        if (!isRest) counts[dayIndex] += 1;
      }
    }
    return counts;
  }, [scheduleEmployeesFiltered, scheduleRowsByStaffDayIndex]);
  const makeDailyListTsv = (rows: DailyListRow[]) =>
    rows
      .map((row) => [row.staff_id, row.name, row.agency, row.position, getPlannedStartTime(row.shift, row.position)].map((c) => String(c ?? '')).join('\t'))
      .join('\n');
  const copyDailyList = async (scope: 'early' | 'late' | 'all') => {
    if (!canCopyDailyList) {
      setStatus({ tone: 'error', message: '请先点亮至少一个岗位卡片。' });
      return;
    }
    const early = tomorrowDailyRowsForCopy.earlyRows;
    const late = tomorrowDailyRowsForCopy.lateRows;
    const title = `Daily List ${tomorrowDailyList.targetDate} ${tomorrowDailyList.weekday}`;
    const text =
      scope === 'early'
        ? makeDailyListTsv(early)
        : scope === 'late'
          ? makeDailyListTsv(late)
          : [
              `${title} - Early Shift`,
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

      const resolveEmployeeShift = (staff: string): 'early' | 'late' => {
        const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
        let scheduledShift: '' | 'early' | 'late' = '';
        for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
          const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
          if (!row) continue;
          if (String(row.note ?? '').trim() === SCHEDULE_REST_NOTE) continue;
          const s = normalizeShiftValue(String(row.shift ?? '').trim());
          if (s) {
            scheduledShift = s;
            break;
          }
        }
        return (inferredShift || scheduledShift || 'early') as 'early' | 'late';
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
              const isWork = Boolean(row) && String(row?.note ?? '').trim() !== SCHEDULE_REST_NOTE;
              if (!isWork) return '休息';
              return shift === 'late' ? '晚1' : '早1';
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

  if (!supabase) {
    return (
      <div className="min-h-screen px-5 py-8">
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
    <div className="min-h-screen px-5 py-8 text-paper">
      <div className="mx-auto flex w-full max-w-none flex-col gap-6">
        <header className="glass reveal rounded-3xl px-6 py-6 shadow-glow">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-[220px]">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">ObPunch</p>
              <h1 className="font-display text-4xl tracking-[0.08em]">{t('后台系统', 'Admin Console')}</h1>
            </div>

            {user && (
              <div className="grid w-full max-w-[980px] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {(
                  [
                    { key: 'Pick', label: '拣货', hint: 'Pick' },
                    { key: 'Pack', label: '打包', hint: 'Pack' },
                    { key: 'Rebin', label: '二分', hint: 'Rebin' },
                    { key: 'Preship', label: '尾程', hint: 'Preship' },
                    { key: 'Transfer', label: '调拨', hint: 'Transfer' }
                  ] as const
                ).map((p) => {
                  const s = attendanceStats[p.key] ?? { early: 0, late: 0, active: 0 };
                  return (
                    <div key={p.key} className="rounded-2xl bg-black/30 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{p.hint}</div>
                          <div className="mt-1 text-base font-semibold text-slate-200">{p.label}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-400">打卡中</div>
                          <div className="mt-1 font-display text-2xl tracking-[0.08em] text-neon">{s.active}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                        <span>早班：{s.early}</span>
                        <span>晚班：{s.late}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="min-w-[260px] text-right">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setLang('zh')}
                  className={[
                    'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                    lang === 'zh' ? 'bg-neon text-ink shadow-glow' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  ].join(' ')}
                  title="中文"
                >
                  中文
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setLang('en')}
                  className={[
                    'rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                    lang === 'en' ? 'bg-neon text-ink shadow-glow' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  ].join(' ')}
                  title="English"
                >
                  EN
                </button>
              </div>

              <div className="mt-3 text-xs uppercase tracking-[0.25em] text-slate-400">
                {t('服务器时间', 'Server Time')}
              </div>
              <div className="mt-2 font-display text-2xl tracking-[0.08em] text-neon">{formatTime(serverTime, locale)}</div>
              <div className="mt-2 text-xs text-slate-400">{user ? user.email : t('未登录', 'Signed out')}</div>
              {attendanceError && <div className="mt-2 text-xs text-ember">考勤卡片加载失败：{attendanceError}</div>}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className={['text-sm', toneColor[status.tone]].join(' ')}>{status.message}</div>
            {user && (
              <button
                type="button"
                disabled={isLocked}
                onClick={doLogout}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('退出登录', 'Logout')}
              </button>
            )}
          </div>
        </header>

        {!user ? (
          <section className="glass reveal rounded-3xl px-6 py-8">
            <h2 className="font-display text-2xl tracking-[0.08em]">管理员登录</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLocked}
                placeholder="Email"
                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLocked}
                placeholder="Password"
                type="password"
                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <button
              type="button"
              disabled={isLocked || email.trim() === '' || password === ''}
              onClick={doLogin}
              className="mt-5 h-12 w-full rounded-2xl bg-neon text-base font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
            >
              登录
            </button>
          </section>
        ) : (
          <>
            <nav className="glass reveal flex flex-wrap gap-2 rounded-3xl p-3">
              <button
                type="button"
                disabled={isLocked}
                onClick={() => setPage('employee_upload')}
                className={tabClass(page === 'employee_upload')}
              >
                {t('员工上传', 'Upload')}
              </button>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => setPage('employees')}
                className={tabClass(page === 'employees')}
              >
                {t('员工信息', 'Employees')}
              </button>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => setPage('timecard')}
                className={tabClass(page === 'timecard')}
              >
                {t('时间卡', 'Timecard')}
              </button>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => setPage('punches')}
                className={tabClass(page === 'punches')}
              >
                {t('打卡流水', 'Punches')}
              </button>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => setPage('audit')}
                className={tabClass(page === 'audit')}
              >
                {t('操作日志', 'Audit')}
              </button>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => setPage('schedule')}
                className={tabClass(page === 'schedule')}
              >
                {t('排班', 'Schedule')}
              </button>
            </nav>

            {page === 'punches' && (
              <section className="glass reveal rounded-3xl px-6 py-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-2xl tracking-[0.08em]">
                    {t('打卡流水（只读）', 'Punch Log (Read-only)')}
                  </h2>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => void fetchRecentPunches({ search: punchesSearch })}
                    className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('刷新流水', 'Refresh')}
                  </button>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
                    <input
                      value={punchesSearch}
                      onChange={(e) => setPunchesSearch(e.target.value)}
                      disabled={isLocked}
                      placeholder={t('通过姓名或工号搜索', 'Search by name or staff id')}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      disabled={isLocked || punchesSearch.trim().length === 0}
                      onClick={() => setPunchesSearch('')}
                      className="h-12 w-full rounded-2xl bg-white/10 px-6 text-base font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('清空', 'Clear')}
                    </button>
                  </div>
                </div>

                <p className="mt-3 text-xs text-slate-400">
                  {punchesSearch.trim()
                    ? lang === 'en'
                      ? `Search: ${punchesSearch.trim()}`
                      : `搜索：${punchesSearch.trim()}`
                    : t('未搜索（展示最近 30 条）', 'No search (latest 30)')}
                </p>
                {recentPunchesError && (
                  <p className="mt-3 text-sm text-ember">
                    {t('加载失败：', 'Load failed: ')}
                    {recentPunchesError}
                  </p>
                )}
                {!recentPunchesError && recentPunches.length === 0 && (
                  <p className="mt-3 text-sm text-slate-400">{t('暂无数据，点击“刷新流水”。', 'No data. Click “Refresh”.')}</p>
                )}
                 <div className="mt-4 space-y-2">
                    {recentPunches.map((p) => {
                      const staff = String(p.staff_id ?? '');
                     const employee = employeeByStaffId[staff];
                     const action = String(p.action ?? '');
                     const createdAt = (p.created_at ?? p.inserted_at ?? p.punch_at ?? '') as string;
                     const time = createdAt ? new Date(createdAt).toLocaleString(locale, { hour12: false }) : '';
                     const isIn = action.toUpperCase() === 'IN';
                     return (
                       <div
                          key={String(p.id ?? `${staff}-${action}-${time}`)}
                         className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3"
                       >
                         <div className="flex items-center gap-3">
                           <span className={['font-display text-xl', isIn ? 'text-mint' : 'text-ember'].join(' ')}>
                             {action}
                           </span>
                           <span className="text-sm text-slate-200">{staff}</span>
                           {employee && (
                             <span className="text-xs text-slate-400">
                               {employee.name || '-'} {employee.agency ? `(${employee.agency})` : ''}
                             </span>
                           )}
                         </div>
                         <div className="text-xs text-slate-400">{time}</div>
                       </div>
                     );
                   })}
                 </div>
                </section>
              )}

            {page === 'audit' && (
              <section className="glass reveal rounded-3xl px-6 py-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-2xl tracking-[0.08em]">{t('操作日志', 'Audit Log')}</h2>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => void fetchAudit({ search: auditSearch })}
                    className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('刷新', 'Refresh')}
                  </button>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
                    <input
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      disabled={isLocked}
                      placeholder={t('通过工号/操作者/动作搜索', 'Search by staff id / actor / action')}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void fetchAudit({ search: auditSearch })}
                      className="h-12 flex-1 rounded-2xl bg-neon px-6 text-base font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('查询', 'Search')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked || auditSearch.trim().length === 0}
                      onClick={() => {
                        setAuditSearch('');
                        void fetchAudit({ search: '' });
                      }}
                      className="h-12 flex-1 rounded-2xl bg-white/10 px-6 text-base font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('清空', 'Clear')}
                    </button>
                  </div>
                </div>

                {auditError && (
                  <p className="mt-3 text-sm text-ember">
                    {t('加载失败：', 'Load failed: ')}
                    {auditError}
                    <span className="ml-2 text-xs text-slate-400">
                      {t('（需要创建表：', '(Need table: ')}
                      {AUDIT_TABLE}
                      {t('）', ')')}
                    </span>
                  </p>
                )}

                {!auditError && auditRows.length === 0 && (
                  <p className="mt-3 text-sm text-slate-400">
                    {t('暂无日志。', 'No audit records.')}
                  </p>
                )}

                {!auditError && auditRows.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {auditRows.map((r, idx) => {
                      const id = String(r.id ?? idx);
                      const at = r.created_at ? new Date(r.created_at).toLocaleString(locale, { hour12: false }) : '';
                      const actor = String(r.actor ?? '').trim() || '-';
                      const action = String(r.action ?? '').trim() || '-';
                      const staff = String(r.staff_id ?? '').trim() || '-';
                      const target = String(r.target ?? '').trim() || '-';
                      const auditDetail = formatAuditDetail(r);

                      return (
                        <div key={id} className="rounded-2xl bg-white/5 px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-200">
                                {action}
                              </span>
                              <span className="text-sm text-slate-200">{auditDetail.summary}</span>
                              <span className="text-sm text-slate-200">
                                {t('工号：', 'Staff: ')}
                                <span className="font-mono">{staff}</span>
                              </span>
                              <span className="text-xs text-slate-400">
                                {t('操作者：', 'Actor: ')}
                                {actor}
                              </span>
                              <span className="text-xs text-slate-500">
                              {t('目标：', 'Target: ')}
                              {target}
                            </span>
                          </div>
                          <div className="text-right text-xs text-slate-400">{at}</div>
                        </div>
                          {auditDetail.details.length > 0 && (
                            <div className="mt-2 grid gap-1 text-xs text-slate-400">
                              {auditDetail.details.map((item, detailIdx) => (
                                <div key={`${id}-detail-${detailIdx}`} className="flex flex-wrap items-center gap-2">
                                  <span className="text-slate-500">{item.label}</span>
                                  <span className="text-slate-200">{item.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                      </div>
                    );
                  })}
                  </div>
                )}
              </section>
            )}

                        {page === 'schedule' && (
              <section className="glass reveal rounded-3xl px-6 py-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl tracking-[0.08em]">Schedule</h2>
                    <p className="mt-2 text-xs text-slate-400">Weekly matrix: Empty / Work / Rest.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void setSchedulePublishSetting(!schedulePublishTomorrow)}
                      className={[
                        'rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
                        schedulePublishTomorrow
                          ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/60'
                          : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      ].join(' ')}
                      title="Manual publish tomorrow roster"
                    >
                      {schedulePublishTomorrow
                        ? `Tomorrow list ON (${schedulePublishForDate || '-'})`
                        : 'Tomorrow list OFF'}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        const next = scheduleWeekOffset - 1;
                        setScheduleWeekOffset(next);
                        const baseWeekStart = startOfWeekMonday(serverTime);
                        setScheduleWeekInput(toDateOnly(addDays(baseWeekStart, next * 7)));
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        setScheduleWeekOffset(0);
                        const baseWeekStart = startOfWeekMonday(serverTime);
                        setScheduleWeekInput(toDateOnly(baseWeekStart));
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      This week
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        const next = scheduleWeekOffset + 1;
                        setScheduleWeekOffset(next);
                        const baseWeekStart = startOfWeekMonday(serverTime);
                        setScheduleWeekInput(toDateOnly(addDays(baseWeekStart, next * 7)));
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        setDailyListSelectedPositions({
                          Pick: false,
                          Pack: false,
                          Rebin: false,
                          Preship: false,
                          Transfer: false
                        });
                        setDailyListFilterPositions({
                          Pick: false,
                          Pack: false,
                          Rebin: false,
                          Preship: false,
                          Transfer: false
                        });
                        setDailyListOpen(true);
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('每日名单', 'Daily list')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked || scheduleEmployeesFiltered.length === 0}
                      onClick={() => void exportScheduleTemplate()}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('导出排班', 'Export schedule')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void refreshSchedulePanel()}
                      className="rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-10">
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Week</label>
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
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
                    <input
                      value={scheduleSearch}
                      onChange={(e) => setScheduleSearch(e.target.value)}
                      disabled={isLocked}
                      placeholder="Search by staff id / name / position"
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Position</label>
                    <select
                      value={schedulePosition}
                      onChange={(e) => setSchedulePosition((e.target.value as any) ?? '')}
                      disabled={isLocked}
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">All positions</option>
                      {ALLOWED_POSITIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Shift</label>
                    <select
                      value={scheduleShift}
                      onChange={(e) => setScheduleShift((e.target.value as any) ?? '')}
                      disabled={isLocked}
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">All shifts</option>
                      <option value="early">Early</option>
                      <option value="late">Late</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('标签', 'Label')}</label>
                    <input
                      value={scheduleLabel}
                      onChange={(e) => setScheduleLabel(e.target.value)}
                      disabled={isLocked}
                      list="schedule-label-options"
                      placeholder={t('标签', 'Label')}
                      className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <datalist id="schedule-label-options">
                      {scheduleLabelOptions.map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-400">
                  Loaded: {scheduleEmployeesFiltered.length} / {employees.length}
                  {scheduleWorkDayFilter !== null && (
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setScheduleWorkDayFilter(null)}
                      className="ml-3 rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Day filter: {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][scheduleWorkDayFilter]} (Clear)
                    </button>
                  )}
                </div>

                {scheduleError && <p className="mt-3 text-sm text-ember">Load failed: {scheduleError}</p>}
                {!scheduleError && scheduleEmployeesFiltered.length === 0 && (
                  <p className="mt-3 text-sm text-slate-400">No employees found.</p>
                )}

                {!scheduleError && scheduleEmployeesFiltered.length > 0 && (
                  <div className="no-scrollbar mt-4 max-h-[68vh] overflow-auto rounded-2xl border border-white/10 bg-black/30">
                    <table className="min-w-[1540px] w-full table-fixed text-left text-xs leading-tight">
                      <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-[10px] uppercase tracking-[0.16em] text-slate-400 backdrop-blur">
                        <tr>
                          <th className="sticky top-0 z-20 w-[100px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">ID</th>
                          <th className="sticky top-0 z-20 w-[155px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">Name</th>
                          <th className="sticky top-0 z-20 w-[96px] bg-slate-950/95 px-2 py-2 text-center backdrop-blur">Work Days</th>
                          <th className="sticky top-0 z-20 w-[108px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">Agency</th>
                          <th className="sticky top-0 z-20 w-[86px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">Position</th>
                          <th className="sticky top-0 z-20 w-[110px] bg-slate-950/95 px-1.5 py-2 backdrop-blur">{t('标签', 'Label')}</th>
                          <th className="sticky top-0 z-20 w-[76px] bg-slate-950/95 px-1.5 py-2 text-center backdrop-blur">Shift</th>
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
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleEmployeesFiltered.map((employee) => {
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
                            const isRest = String(row.note ?? '').trim() === SCHEDULE_REST_NOTE;
                            if (!isRest) workDays += 1;
                          }
                          const workDaysClass =
                            workDays === 5
                              ? 'border-emerald-400/60 text-emerald-200 bg-emerald-500/10'
                              : workDays >= 1 && workDays <= 4
                                ? 'border-amber-400/60 text-amber-200 bg-amber-500/10'
                                : 'border-rose-400/60 text-rose-200 bg-rose-500/10';

                          return (
                            <tr className="group border-b border-white/5 transition-colors hover:bg-white/[0.04] last:border-0" key={staff}>
                              <td className="px-1.5 py-2 font-mono text-slate-200">{staff}</td>
                              <td className="px-1.5 py-2 text-slate-200 truncate">{name || '-'}</td>
                              <td className="px-2 py-2 text-center">
                                <span className={['inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold', workDaysClass].join(' ')}>
                                  {workDays}
                                </span>
                              </td>
                              <td className="px-1.5 py-2 text-slate-200 truncate">{agency || '-'}</td>
                              <td className="px-1.5 py-2 text-slate-200">
                                <span className={['inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]', getPositionBadgeClass(position)].join(' ')}>
                                  {position || '-'}
                                </span>
                              </td>
                              <td className="px-1.5 py-2 text-slate-200 truncate">{label || '-'}</td>
                              <td className="px-2 py-2 text-center text-slate-200">
                                {(() => {
                                  const inferredShift = employeeShiftByStaffId[staff]?.shift ?? '';
                                  const shiftLabel = inferredShift === 'early' ? t('早班', 'Morning') : inferredShift === 'late' ? t('晚班', 'Night') : '-';
                                  const shiftClass = getShiftBadgeClass(inferredShift);
                                  return <span className={['inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em]', shiftClass].join(' ')}>{shiftLabel}</span>;
                                })()}
                              </td>
                              {scheduleDays.map((_, dayIndex) => {
                                const key = `${staff}__${dayIndex}`;
                                const row = scheduleRowsByStaffDayIndex.get(key);
                                const hasPunch = schedulePunchPresenceKeys.has(key);
                                const state: 'empty' | 'work' | 'rest' | 'rest_worked' = !row
                                  ? 'empty'
                                  : String(row.note ?? '').trim() === SCHEDULE_REST_NOTE
                                    ? hasPunch
                                      ? 'rest_worked'
                                      : 'rest'
                                    : 'work';
                                const targetShift = scheduleShift || ((row?.shift as 'early' | 'late' | null) ?? 'early');
                                const nextState: 'empty' | 'work' | 'rest' =
                                  state === 'empty' ? 'work' : state === 'work' ? 'rest' : 'work';

                                return (
                                  <td key={key} className="px-1 py-1.5 align-middle">
                                    <div className="flex items-center justify-center">
                                      <button
                                        type="button"
                                        disabled={isLocked}
                                        onClick={() => void setScheduleCellState(employee, dayIndex, nextState, targetShift)}
                                        className={[
                                          'h-7 min-w-[42px] rounded-md px-1 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55',
                                          state === 'work'
                                            ? 'bg-neon text-ink shadow-glow'
                                            : state === 'rest_worked'
                                              ? 'bg-sky-500 text-white'
                                            : state === 'rest'
                                              ? 'bg-ember text-white'
                                              : 'border border-white/20 bg-white/5 text-slate-200 hover:bg-white/10'
                                        ].join(' ')}
                                      >
                                        {state === 'work'
                                          ? t('工作', 'Work')
                                          : state === 'rest_worked'
                                            ? t('排休出勤', 'Rest Worked')
                                            : state === 'rest'
                                              ? t('休息', 'Rest')
                                              : t('空', 'Empty')}
                                      </button>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {dailyListOpen &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
                      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/95 shadow-2xl backdrop-blur">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-6 py-5">
                          <div>
                            <h3 className="font-display text-2xl tracking-[0.08em]">{t('每日名单', 'Daily list')}</h3>
                            <p className="mt-2 text-xs text-slate-400">
                              日期：<span className="text-slate-200">{tomorrowDailyList.targetDate}</span> {tomorrowDailyList.weekday}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">班次按最近工时推断（无推断时回退排班班次）。</p>
                          </div>
                          <div className="min-w-[520px] flex-1">
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                              {tomorrowPositionSummaryCards.map((card) => (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDailyListSelectedPositions((prev) => ({
                                      ...prev,
                                      [card.position]: !prev[card.position]
                                    }))
                                  }
                                  key={card.position}
                                  className={[
                                    'rounded-xl border px-2.5 py-2 text-left transition',
                                    dailyListSelectedPositions[card.position]
                                      ? getPositionBadgeClass(card.position)
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
                              disabled={!canCopyDailyList}
                              onClick={() => void copyDailyList('all')}
                              className="rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t('复制全部', 'Copy all')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDailyListOpen(false)}
                              className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15"
                            >
                              关闭
                            </button>
                          </div>
                        </div>
                        <div className="grid flex-1 gap-4 overflow-y-auto px-6 py-5 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
                              <span className="text-xs uppercase tracking-[0.14em] text-slate-400">{t('筛选', 'Filter')}</span>
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
                                      ? getPositionBadgeClass(position)
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
                                className="ml-auto rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
                              >
                                {t('清空筛选', 'Clear filters')}
                              </button>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.04] p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-200">{t('早班', 'Morning')}</h4>
                              <button
                                type="button"
                                disabled={!canCopyDailyList}
                                onClick={() => void copyDailyList('early')}
                                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {t('复制', 'Copy')}
                              </button>
                            </div>
                            <div className="max-h-[55vh] overflow-auto rounded-xl border border-white/10 bg-black/25">
                              <table className="min-w-full text-left text-xs">
                                <thead className="sticky top-0 bg-slate-950/95 text-[10px] uppercase tracking-[0.15em] text-slate-400">
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
                                      <td colSpan={5} className="px-3 py-3 text-center text-slate-400">
                                        {t('无数据', 'No data')}
                                      </td>
                                    </tr>
                                  ) : (
                                    tomorrowDailyRowsDisplayed.earlyRows.map((row) => (
                                      <tr key={`early-${row.staff_id}`} className="border-t border-white/5">
                                        <td className="px-3 py-2 font-mono text-slate-200">{row.staff_id}</td>
                                        <td className="px-3 py-2 text-slate-200">{row.name || '-'}</td>
                                        <td className="px-3 py-2 text-slate-200">{row.agency || '-'}</td>
                                        <td className="px-3 py-2 text-slate-200">{row.position || '-'}</td>
                                        <td className="px-3 py-2 text-slate-200">{getPlannedStartTime('early', row.position)}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-indigo-400/30 bg-indigo-500/[0.04] p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-200">{t('晚班', 'Night')}</h4>
                              <button
                                type="button"
                                disabled={!canCopyDailyList}
                                onClick={() => void copyDailyList('late')}
                                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {t('复制', 'Copy')}
                              </button>
                            </div>
                            <div className="max-h-[55vh] overflow-auto rounded-xl border border-white/10 bg-black/25">
                              <table className="min-w-full text-left text-xs">
                                <thead className="sticky top-0 bg-slate-950/95 text-[10px] uppercase tracking-[0.15em] text-slate-400">
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
                                      <td colSpan={5} className="px-3 py-3 text-center text-slate-400">
                                        {t('无数据', 'No data')}
                                      </td>
                                    </tr>
                                  ) : (
                                    tomorrowDailyRowsDisplayed.lateRows.map((row) => (
                                      <tr key={`late-${row.staff_id}`} className="border-t border-white/5">
                                        <td className="px-3 py-2 font-mono text-slate-200">{row.staff_id}</td>
                                        <td className="px-3 py-2 text-slate-200">{row.name || '-'}</td>
                                        <td className="px-3 py-2 text-slate-200">{row.agency || '-'}</td>
                                        <td className="px-3 py-2 text-slate-200">{row.position || '-'}</td>
                                        <td className="px-3 py-2 text-slate-200">{getPlannedStartTime('late', row.position)}</td>
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
              </section>
            )}

            {page === 'employees' && (
              <section className="glass reveal rounded-3xl px-6 py-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-2xl tracking-[0.08em]">{t('员工信息', 'Employees')}</h2>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setEmployeeAddOpen((prev) => !prev)}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {employeeAddOpen ? t('隐藏新增', 'Hide add') : t('新增员工', 'Add employee')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void fetchEmployees({ reset: true })}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('刷新', 'Refresh')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        setEmployeeSearch('');
                        setEmployeeAgency('');
                        setEmployeePosition('');
                        setEmployeeLabel('');
                        void fetchEmployees({ reset: true, search: '', agency: '', position: '', label: '' });
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('清空筛选', 'Clear filters')}
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-5">
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
                    <input
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      disabled={isLocked}
                      placeholder={t('通过ID/名字/标签搜索', 'Search by id / name / label')}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Agency</label>
                    <input
                      value={employeeAgency}
                      onChange={(e) => setEmployeeAgency(e.target.value)}
                      disabled={isLocked}
                      list="employee-agency-options"
                      placeholder="Agency"
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <datalist id="employee-agency-options">
                      {employeeAgencyOptions.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Position</label>
                    <input
                      value={employeePosition}
                      onChange={(e) => setEmployeePosition(e.target.value)}
                      disabled={isLocked}
                      list="employee-position-options"
                      placeholder="Position"
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <datalist id="employee-position-options">
                      {employeePositionOptions.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('标签', 'Label')}</label>
                    <input
                      value={employeeLabel}
                      onChange={(e) => setEmployeeLabel(e.target.value)}
                      disabled={isLocked}
                      list="employee-label-filter-options"
                      placeholder={t('标签', 'Label')}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <datalist id="employee-label-filter-options">
                      {employeeFilterLabelOptions.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => void fetchEmployees({ reset: true })}
                    className="rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('搜索', 'Search')}
                  </button>
                  <div className="text-xs text-slate-400">
                    {t('已加载：', 'Loaded: ')}
                    {employeesFiltered.length}
                    {t(' 条', '')}
                  </div>
                </div>

                {employeeAddOpen && (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('新增员工', 'Add Employee')}</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-6">
                      <input
                        value={employeeNewStaffId}
                        onChange={(e) => setEmployeeNewStaffId(e.target.value)}
                        disabled={isLocked}
                        placeholder={t('员工ID（例如：US010454）', 'Staff ID (e.g. US010454)')}
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <input
                        value={employeeNewName}
                        onChange={(e) => setEmployeeNewName(e.target.value)}
                        disabled={isLocked}
                        placeholder={t('姓名', 'Name')}
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <input
                        value={employeeNewAgency}
                        onChange={(e) => setEmployeeNewAgency(e.target.value)}
                        disabled={isLocked}
                        placeholder="Agency"
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <select
                        value={employeeNewPosition}
                        onChange={(e) => setEmployeeNewPosition((e.target.value as any) ?? '')}
                        disabled={isLocked}
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">{t('选择岗位', 'Position')}</option>
                        {ALLOWED_POSITIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <input
                        value={employeeNewLabel}
                        onChange={(e) => setEmployeeNewLabel(e.target.value)}
                        disabled={isLocked}
                        list="employee-label-add-options"
                        placeholder={t('标签', 'Label')}
                        className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <datalist id="employee-label-add-options">
                        {employeeAddLabelOptions.map((d) => (
                          <option key={d} value={d} />
                        ))}
                      </datalist>
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => void addEmployeeRow()}
                        className="h-11 rounded-2xl bg-neon px-6 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t('添加', 'Add')}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {t('Position 仅允许 5 个岗位，添加时会自动统一大小写。', 'Position only allows 5 roles; case will be normalized.')}
                    </p>
                  </div>
                )}

                {employeesError && (
                  <p className="mt-3 text-sm text-ember">
                    {t('加载失败：', 'Load failed: ')}
                    {employeesError}
                  </p>
                )}
                {!employeesError && employeesFiltered.length === 0 && (
                  <p className="mt-3 text-sm text-slate-400">{t('暂无数据，点击“刷新/搜索”。', 'No data. Click “Refresh/Search”.')}</p>
                )}

                <div className="mt-5 max-h-[68vh] overflow-auto rounded-2xl border border-white/10 bg-black/30">
                  <table className="min-w-[1040px] w-full text-left text-sm">
                    <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-[0.2em] text-slate-400 backdrop-blur">
                      <tr>
                        <th className="px-4 py-3">Employee ID</th>
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Agency</th>
                        <th className="px-4 py-3">Position</th>
                        <th className="px-4 py-3">{t('标签', 'Label')}</th>
                        <th className="px-4 py-3">{t('班次', 'Shift')}</th>
                        <th className="px-4 py-3 text-right">{t('操作', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeesFiltered.map((e) => {
                        const staff = String(e.staff_id ?? '').trim();
                        const name = String(e.name ?? '').trim();
                        const agency = String(e.agency ?? e.Agency ?? '').trim();
                        const position = String(e.position ?? e.Position ?? '').trim();
                        const label = String(e.label ?? e.Label ?? '').trim();
                        const shiftInfo = employeeShiftByStaffId[staff];
                        const shift = shiftInfo?.shift ?? '';
                        const shiftLabel =
                          shift === 'early' ? t('白班', 'Day') : shift === 'late' ? t('晚班', 'Night') : '-';
                        const shiftTitle = shiftInfo
                          ? t(
                              `近${SHIFT_ANALYSIS_DAYS}天：白班 ${shiftInfo.earlyHours.toFixed(1)}h / 晚班 ${shiftInfo.lateHours.toFixed(1)}h`,
                              `Last ${SHIFT_ANALYSIS_DAYS}d: Day ${shiftInfo.earlyHours.toFixed(1)}h / Night ${shiftInfo.lateHours.toFixed(1)}h`
                            )
                          : '';

                        return (
                          <tr key={String(e.id ?? staff)} className="border-b border-white/5 last:border-0">
                            <td className="px-4 py-3 font-mono text-slate-200">{staff}</td>
                            <td className="px-4 py-3 text-slate-200">{name}</td>
                            <td className="px-4 py-3 text-slate-200">{agency}</td>
                            <td className="px-4 py-3 text-slate-200">
                              <span
                                className={[
                                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
                                  getPositionBadgeClass(position)
                                ].join(' ')}
                              >
                                {position || '-'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-200">{label || '-'}</td>
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
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() =>
                                  openEmployeeEdit({
                                    staff,
                                    name,
                                    agency,
                                    position,
                                    label
                                  })
                                }
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

                {employeeEditOpen && typeof document !== 'undefined' &&
                  createPortal(
                  <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-10">
                    <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl backdrop-blur">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('编辑员工', 'Edit Employee')}</div>
                          <div className="mt-2 text-sm text-slate-400">
                            {t('当前工号：', 'Current staff: ')}
                            <span className="text-slate-200">{employeeEditOriginalStaffId || '-'}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={closeEmployeeEdit}
                          className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
                        >
                          {t('关闭', 'Close')}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-5">
                        <div className="md:col-span-1">
                          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('工号', 'Staff ID')}</label>
                          <input
                            value={employeeEditStaffId ?? ''}
                            onChange={(e) => setEmployeeEditStaffId(e.target.value)}
                            disabled={isLocked || String(user?.email ?? '').trim().toLowerCase() !== STAFF_ID_EDITOR_EMAIL}
                            placeholder={t('例如：US012345', 'e.g. US12345')}
                            className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-mono text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          {String(user?.email ?? '').trim().toLowerCase() !== STAFF_ID_EDITOR_EMAIL && (
                            <p className="mt-1 text-[11px] text-slate-500">Only {STAFF_ID_EDITOR_EMAIL} can edit staff ID.</p>
                          )}
                        </div>
                        <div className="md:col-span-1">
                          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('姓名', 'Name')}</label>
                          <input
                            value={employeeEditName}
                            onChange={(e) => setEmployeeEditName(e.target.value)}
                            disabled={isLocked}
                            className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </div>
                        <div className="md:col-span-1">
                          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Agency</label>
                          <input
                            value={employeeEditAgency}
                            onChange={(e) => setEmployeeEditAgency(e.target.value)}
                            disabled={isLocked}
                            className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </div>
                        <div className="md:col-span-1">
                          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Position</label>
                          <select
                            value={employeeEditPosition}
                            onChange={(e) => setEmployeeEditPosition((e.target.value as any) ?? '')}
                            disabled={isLocked}
                            className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="">{t('选择岗位', 'Position')}</option>
                            {ALLOWED_POSITIONS.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-1">
                          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('标签', 'Label')}</label>
                          <input
                            value={employeeEditLabel}
                            onChange={(e) => setEmployeeEditLabel(e.target.value)}
                            disabled={isLocked}
                            list="employee-label-edit-options"
                            className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          <datalist id="employee-label-edit-options">
                            {employeeEditLabelOptions.map((d) => (
                              <option key={d} value={d} />
                            ))}
                          </datalist>
                        </div>
                      </div>

                      <div className="mt-5 flex items-center justify-end gap-3">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={closeEmployeeEdit}
                          className="rounded-2xl bg-white/10 px-5 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t('取消', 'Cancel')}
                        </button>
                        <button
                          type="button"
                          disabled={isLocked || !employeeEditStaffId}
                          onClick={() => void saveEmployeeEdit()}
                          className="rounded-2xl bg-neon px-6 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t('保存', 'Save')}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

              </section>
            )}

            {page === 'timecard' && (
              <section className="glass reveal rounded-3xl px-6 py-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl tracking-[0.08em]">{t('时间卡', 'Timecard')}</h2>
                    {(() => {
                      const baseWeekStart = startOfWeekMonday(serverTime);
                      const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
                      const weekEnd = addDays(weekStart, 6);
                      return (
                        <p className="mt-2 text-xs text-slate-400">
                          {t('周期：', 'Week: ')}
                          <span className="text-slate-200">{toDateOnly(weekStart)}</span> ～{' '}
                          <span className="text-slate-200">{toDateOnly(weekEnd)}</span>
                        </p>
                      );
                    })()}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {(() => {
                      const baseWeekStart = startOfWeekMonday(serverTime);
                      return (
                        <div className="flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-2">
                          <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Week</span>
                          <input
                            type="date"
                            disabled={isLocked}
                            value={timecardWeekInput}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setTimecardWeekInput(raw);
                              if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
                                return;
                              }
                              const dt = new Date(`${raw}T00:00:00`);
                              if (Number.isNaN(dt.getTime())) {
                                return;
                              }
                              const targetWeekStart = startOfWeekMonday(dt);
                              const nextOffset = Math.round(
                                (targetWeekStart.getTime() - baseWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
                              );
                              setTimecardWeekOffset(nextOffset);
                              void fetchTimecard({ reset: true, weekOffset: nextOffset });
                            }}
                            className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-neon disabled:cursor-not-allowed disabled:opacity-60"
                            title={t('选择任意日期', 'Pick any date')}
                          />
                        </div>
                      );
                    })()}
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        const next = timecardWeekOffset - 1;
                        setTimecardWeekOffset(next);
                        const baseWeekStart = startOfWeekMonday(serverTime);
                        setTimecardWeekInput(toDateOnly(addDays(baseWeekStart, next * 7)));
                        void fetchTimecard({ reset: true, weekOffset: next });
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('上一周', 'Prev')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked || timecardWeekOffset === 0}
                      onClick={() => {
                        setTimecardWeekOffset(0);
                        const baseWeekStart = startOfWeekMonday(serverTime);
                        setTimecardWeekInput(toDateOnly(baseWeekStart));
                        void fetchTimecard({ reset: true, weekOffset: 0 });
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('本周', 'This week')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        const next = timecardWeekOffset + 1;
                        setTimecardWeekOffset(next);
                        const baseWeekStart = startOfWeekMonday(serverTime);
                        setTimecardWeekInput(toDateOnly(addDays(baseWeekStart, next * 7)));
                        void fetchTimecard({ reset: true, weekOffset: next });
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('下一周', 'Next')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void fetchTimecard({ reset: true })}
                      className="rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('刷新', 'Refresh')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked || timecardRowsFiltered.length === 0}
                      onClick={() => void exportTimecard()}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('导出', 'Export')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void exportDailyPunches()}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('导出流水', 'Export punches')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        setTimecardMissingEmployeeOnly((prev) => {
                          const next = !prev;
                          if (next) {
                            setTimecardAgency('');
                            setTimecardPosition('');
                          }
                          return next;
                        });
                      }}
                      className={[
                        'rounded-2xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                        timecardMissingEmployeeOnly
                          ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/25'
                          : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      ].join(' ')}
                    >
                      {timecardMissingEmployeeOnly
                        ? t('显示全部时间卡', 'Show all timecards')
                        : t('三无员工', 'Missing employee info')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        setTimecardSearch('');
                        setTimecardAgency('');
                        setTimecardPosition('');
                        setTimecardShift('');
                        setTimecardInProgressOnly(false);
                        setTimecardMissingEmployeeOnly(false);
                        void fetchTimecard({ reset: true, search: '', agency: '', position: '' });
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('清空筛选', 'Clear filters')}
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-6">
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
                    <input
                      value={timecardSearch}
                      onChange={(e) => setTimecardSearch(e.target.value)}
                      disabled={isLocked}
                      placeholder={t('通过名字和USid搜索', 'Search by name or staff id')}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Agency</label>
                    <select
                      value={timecardAgency}
                      onChange={(e) => setTimecardAgency(e.target.value)}
                      disabled={isLocked || timecardMissingEmployeeOnly}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{t('全部Agency', 'All agencies')}</option>
                      {timecardAgencyOptions.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Position</label>
                    <select
                      value={timecardPosition}
                      onChange={(e) => setTimecardPosition(e.target.value)}
                      disabled={isLocked || timecardMissingEmployeeOnly}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{t('全部岗位', 'All positions')}</option>
                      {timecardPositionOptions.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Shift</label>
                    <select
                      value={timecardShift}
                      onChange={(e) => setTimecardShift((e.target.value as '' | 'early' | 'late') ?? '')}
                      disabled={isLocked}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{t('全部班次', 'All shifts')}</option>
                      <option value="early">{t('早班（05:00–14:59）', 'Early (05:00–14:59)')}</option>
                      <option value="late">{t('晚班（15:00+）', 'Late (15:00+)')}</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex w-full cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-slate-200 transition hover:border-white/20">
                      <input
                        type="checkbox"
                        checked={timecardInProgressOnly}
                        onChange={(e) => setTimecardInProgressOnly(e.target.checked)}
                        disabled={isLocked}
                        className="h-4 w-4 accent-neon"
                      />
                      {t('只看打卡中', 'In progress only')}
                    </label>
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-400">
                  {t('已加载：', 'Loaded: ')}
                  {timecardRowsFiltered.length} / {timecardRows.length}
                  {t(' 人', '')}
                </div>

                {timecardError && <p className="mt-3 text-sm text-ember">加载失败：{timecardError}</p>}
                {!timecardError && timecardRowsFiltered.length === 0 && (
                  <p className="mt-3 text-sm text-slate-400">
                    {t('暂无数据，可输入搜索/筛选或点击“刷新”。', 'No data. Use filters or click “Refresh”.')}
                  </p>
                )}

                <div className="no-scrollbar mt-5 max-h-[68vh] overflow-auto rounded-2xl border border-white/10 bg-black/30">
                  <table className="min-w-[1500px] w-full table-fixed text-left text-xs leading-tight">
                    <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-[10px] uppercase tracking-[0.16em] text-slate-400 backdrop-blur">
                      {(() => {
                        const baseWeekStart = startOfWeekMonday(serverTime);
                        const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
                        const days = [
                          t('周一', 'Mon'),
                          t('周二', 'Tue'),
                          t('周三', 'Wed'),
                          t('周四', 'Thu'),
                          t('周五', 'Fri'),
                          t('周六', 'Sat'),
                          t('周日', 'Sun')
                        ];
                        return (
                          <tr>
                            <th className="w-[108px] px-2 py-1.5">ID</th>
                            <th className="w-[200px] px-2 py-1.5">Name</th>
                            <th className="w-[140px] px-2 py-1.5">Agency</th>
                            <th className="w-[120px] px-2 py-1.5">{t('岗位', 'Position')}</th>
                            {days.map((label, idx) => (
                              <th key={label} className="w-[92px] px-2 py-1.5 whitespace-nowrap text-center">
                                <div className="text-neon">{`${t('总工时', 'Total')} ${formatHours(timecardDayTotalHours[idx]) || '0'}`}</div>
                                <div>{label} {toDateOnly(addDays(weekStart, idx)).slice(5)}</div>
                              </th>
                            ))}
                            <th className="w-[92px] px-2 py-1.5 text-center">{t('合计', 'Total')}</th>
                          </tr>
                        );
                      })()}
                    </thead>
                    <tbody>
                          {timecardRowsFiltered.map((r) => (
                            <tr
                              key={r.staff_id}
                              className="border-b border-white/5 transition hover:bg-white/5 last:border-0"
                            >
                              <td className="px-2 py-1.5 font-mono text-slate-200">{r.staff_id}</td>
                              <td className="px-2 py-1.5 text-slate-200 truncate">{r.name || '-'}</td>
                              <td className="px-2 py-1.5 text-slate-200 truncate">{r.agency || '-'}</td>
                              <td className="px-2 py-1.5 text-slate-200 truncate">
                                <span
                                  className={[
                                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
                                    getPositionBadgeClass(r.position)
                                  ].join(' ')}
                                >
                                  {r.position || '-'}
                                </span>
                              </td>
                              {r.hoursByDay.map((h, idx) => (
                                <td key={idx} className="w-[92px] px-2 py-1.5 text-center align-middle text-slate-200">
                                  {formatHours(h) ? (
                                    <button
                                      type="button"
                                      disabled={isLocked}
                                      onClick={() => void openTimecardPunchModal(r.staff_id, idx)}
                                      className={(() => {
                                        const over8 = h > 8.5;
                                        const inProgress = r.inProgressByDay[idx];
                                        const manual = r.manualByDay[idx];
                                        const punchCountMismatch = r.punchCountMismatchByDay[idx];
                                        const base =
                                          'rounded px-1.5 py-0.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
                                        if (punchCountMismatch) {
                                          return [
                                            base,
                                            'border-2 border-rose-500 bg-rose-500/20 text-rose-100 shadow-[0_0_0_1px_rgba(244,63,94,0.55)] hover:bg-rose-500/30'
                                          ].join(' ');
                                        }
                                        if (manual) return [base, 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'].join(' ');
                                        if (over8) return [base, 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'].join(' ');
                                        if (inProgress) return [base, 'bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'].join(' ');
                                        return [base, 'bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'].join(' ');
                                      })()}
                                      title="查看/编辑打卡流水"
                                    >
                                      {formatHours(h)}
                                    </button>
                                  ) : r.absentByDay[idx] ? (
                                    <span
                                      className="inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold text-rose-200"
                                      title="Scheduled but no punch"
                                    >
                                      {t('缺勤', 'Absent')}
                                    </span>
                                  ) : (
                                    ''
                                  )}
                                </td>
                              ))}
                              <td className="w-[92px] px-2 py-1.5 text-center align-middle font-semibold text-slate-200">
                                {formatHours(r.totalHours) ? (
                                  <button
                                    type="button"
                                    disabled={isLocked}
                                    onClick={() => void openTimecardPunchModal(r.staff_id, null)}
                                    className={(() => {
                                      const hasOver8 = r.hoursByDay.some((v) => v > 8.5);
                                      const inProgress = r.inProgressWeek;
                                      const manual = r.manualWeek;
                                      const base =
                                        'rounded px-1.5 py-0.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
                                      if (manual) return [base, 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'].join(' ');
                                      if (hasOver8) return [base, 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'].join(' ');
                                      if (inProgress) return [base, 'bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'].join(' ');
                                      return [base, 'bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'].join(' ');
                                    })()}
                                    title="查看本周打卡流水（只读）"
                                  >
                                    {formatHours(r.totalHours)}
                                  </button>
                                ) : (
                                  ''
                                )}
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>

                {timecardPunchOpen &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                      role="dialog"
                      aria-modal="true"
                    >
                      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950/90 shadow-2xl backdrop-blur">
                        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
                          <div>
                            <h3 className="font-display text-2xl tracking-[0.08em]">打卡流水</h3>
                            <p className="mt-2 text-xs text-slate-400">
                              工号：<span className="text-slate-200">{timecardPunchStaffId}</span>
                              {timecardPunchDayIndex === null ? (
                                <span className="ml-2">（本周范围，仅查看）</span>
                              ) : (
                                <span className="ml-2">
                                  {timecardPunchShowAll
                                    ? t('（显示全部记录）', '(All punches)')
                                    : t('（只显示参与工时计算的记录）', '(Only punches used for hour calc)')}
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {timecardPunchDayIndex !== null && (
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => setTimecardPunchShowAll((v) => !v)}
                                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {timecardPunchShowAll ? t('只看相关', 'Relevant only') : t('显示全部', 'Show all')}
                              </button>
                            )}
                            {!timecardPunchReadOnly && (
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => setTimecardPunchAddOpen((prev) => !prev)}
                                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {timecardPunchAddOpen ? t('隐藏新增', 'Hide add') : t('新增打卡', 'Add punch')}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={closeTimecardPunchModal}
                              className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              关闭
                            </button>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto px-6 py-5">
                          {!timecardPunchReadOnly && timecardPunchAddOpen && (
                            <div className="rounded-2xl border border-neon/40 bg-black/30 px-4 py-4 shadow-glow">
                              <div className="grid gap-3 md:grid-cols-[8rem_1fr_7rem] md:items-end">
                                <div>
                                  <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Action</div>
                                  <select
                                    value={timecardPunchNew.action}
                                    disabled={isLocked}
                                    onChange={(e) =>
                                      setTimecardPunchNew((prev) => ({
                                        ...prev,
                                        action: e.target.value === 'OUT' ? 'OUT' : 'IN'
                                      }))
                                    }
                                    className={[
                                      'mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-display text-xl tracking-[0.08em] outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
                                      timecardPunchNew.action === 'IN' ? 'text-mint' : 'text-ember'
                                    ].join(' ')}
                                  >
                                    <option value="IN">IN</option>
                                    <option value="OUT">OUT</option>
                                  </select>
                                </div>
                                <div>
                                  <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Time</div>
                                  <input
                                    value={timecardPunchNew.atLocal}
                                    disabled={isLocked}
                                    onChange={(e) => setTimecardPunchNew((prev) => ({ ...prev, atLocal: e.target.value }))}
                                    type="datetime-local"
                                    className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                                  />
                                </div>
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={() => void addTimecardPunchRow()}
                                  className="h-11 rounded-2xl bg-neon px-6 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  添加
                                </button>
                              </div>
                              <p className="mt-3 text-xs text-slate-400">手动添加一条打卡记录。</p>
                            </div>
                          )}

                        {timecardPunchError && <p className="text-sm text-ember">操作失败：{timecardPunchError}</p>}
                        {!timecardPunchError && timecardPunchRowsVisible.length === 0 && (
                          <p className="text-sm text-slate-400">暂无记录</p>
                        )}

                        {timecardPunchRowsVisible.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {timecardPunchRowsVisible.map((r) => {
                              const edit = timecardPunchEdits[String(r.id)] ?? {
                                action: r.action,
                                atLocal: r.created_at ? toLocalDateTimeInputValue(new Date(r.created_at)) : ''
                              };
                              return (
                                <div
                                  key={String(r.id)}
                                  className="rounded-2xl bg-white/5 px-4 py-4"
                                >
                                  <div className="grid gap-3 md:grid-cols-[8rem_1fr_7rem_7rem] md:items-end">
                                    <div>
                                      <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Action</div>
                                    <select
                                      value={edit.action}
                                      disabled={isLocked || timecardPunchReadOnly}
                                      onChange={(e) =>
                                        setTimecardPunchEdits((prev) => ({
                                          ...prev,
                                          [String(r.id)]: { ...edit, action: e.target.value === 'OUT' ? 'OUT' : 'IN' }
                                        }))
                                      }
                                      className={[
                                        'mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-display text-xl tracking-[0.08em] outline-none transition focus:border-neon disabled:cursor-not-allowed disabled:opacity-60',
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
                                          [String(r.id)]: { ...edit, atLocal: e.target.value }
                                        }))
                                      }
                                      type="datetime-local"
                                      className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                                    />
                                    </div>

                                    {!timecardPunchReadOnly && (
                                      <>
                                        <button
                                          type="button"
                                          disabled={isLocked}
                                          onClick={() => void saveTimecardPunchRow(String(r.id))}
                                          className="h-11 rounded-2xl bg-neon px-6 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          保存
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isLocked}
                                          onClick={() => void deleteTimecardPunchRow(String(r.id))}
                                          className="h-11 rounded-2xl bg-ember px-6 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                          删除
                                        </button>
                                      </>
                                    )}
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
              <section className="glass reveal rounded-3xl px-6 py-8">
                <h2 className="font-display text-2xl tracking-[0.08em]">{t('员工信息上传', 'Employee Upload')}</h2>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={uploadFillDuplicates}
                      onChange={(e) => setUploadFillDuplicates(e.target.checked)}
                      disabled={isLocked}
                      className="h-4 w-4 accent-neon disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    {t(
                      '重复时补全信息（仅填充数据库里为空的 name/agency/position/label）',
                      'Fill missing fields on duplicates (only empty name/agency/position/label)'
                    )}
                  </label>
                </div>

                <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    disabled={isLocked}
                    onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
                    className="block w-full cursor-pointer rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={uploadEmployees}
                      className="h-12 rounded-2xl bg-neon px-6 text-base font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('上传', 'Upload')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={async () => {
                        try {
                          const XLSX = await import('xlsx');
                          const headers = ['staff_id', 'name', 'agency', 'position', 'label'];
                          const ws = XLSX.utils.aoa_to_sheet([headers]);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, 'template');
                          // writeFile triggers download in browser
                          XLSX.writeFile(wb, 'ob_employees_template.xlsx');
                        } catch (err: any) {
                          // fallback to CSV download
                          const headers = ['staff_id', 'name', 'agency', 'position', 'label'];
                          const csv = headers.join(',') + '\n';
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
                      }}
                      className="h-12 rounded-2xl bg-white/10 px-6 text-base font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('下载模版', 'Download template')}
                    </button>
                  </div>
                </div>
                {uploadError && <p className="mt-3 text-sm text-ember">{uploadError}</p>}
              </section>
            )}
          </>
        )}

        <footer className="text-center text-xs text-slate-500">
          {isLocked ? t('请求处理中，已锁定交互', 'Request in progress (locked)') : 'Ready'}
        </footer>
      </div>
    </div>
  );
}
