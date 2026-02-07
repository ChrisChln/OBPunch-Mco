import { useEffect, useMemo, useRef, useState } from 'react';
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
const AUDIT_TABLE = (import.meta.env.VITE_AUDIT_TABLE as string | undefined) ?? 'ob_audit_logs';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';

const supabase = createSupabaseClient({ persistSession: true });

type EmployeeRow = {
  id?: number | string;
  staff_id?: string | null;
  name?: string | null;
  agency?: string | null;
  position?: string | null;
  Agency?: string | null;
  Position?: string | null;
  created_at?: string | null;
};

type TimecardRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  hoursByDay: number[]; // 0..6 (Mon..Sun)
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW) ? clamp(DAY_CUTOFF_HOUR_RAW, 0, 23) : 5;
const DAY_CUTOFF_MS = DAY_CUTOFF_HOUR * 60 * 60 * 1000;
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
  '职位': 'position'
};

export default function AdminApp() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isLocked = Boolean(busy);
  const timecardFetchSeqRef = useRef(0);
  const punchesFetchSeqRef = useRef(0);
  const attendanceFetchSeqRef = useRef(0);
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
  const [, setEmployeesHasMore] = useState(false);
  const [employeeNewStaffId, setEmployeeNewStaffId] = useState('');
  const [employeeNewName, setEmployeeNewName] = useState('');
  const [employeeNewAgency, setEmployeeNewAgency] = useState('');
  const [employeeNewPosition, setEmployeeNewPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [employeeAddOpen, setEmployeeAddOpen] = useState(false);
  const [employeeEditOpen, setEmployeeEditOpen] = useState(false);
  const [employeeEditStaffId, setEmployeeEditStaffId] = useState<string | null>(null);
  const [employeeEditName, setEmployeeEditName] = useState('');
  const [employeeEditAgency, setEmployeeEditAgency] = useState('');
  const [employeeEditPosition, setEmployeeEditPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');

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
  const [scheduleWeekOffset, setScheduleWeekOffset] = useState(0);
  const [scheduleWeekInput, setScheduleWeekInput] = useState(() => toDateOnly(startOfWeekMonday(new Date())));
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [schedulePosition, setSchedulePosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');

  const [scheduleAddOpen, setScheduleAddOpen] = useState(false);
  const [scheduleAddStaffId, setScheduleAddStaffId] = useState('');
  const [scheduleAddDate, setScheduleAddDate] = useState(() => toDateOnly(new Date()));
  const [scheduleAddShift, setScheduleAddShift] = useState<'early' | 'late'>('early');
  const [scheduleAddPosition, setScheduleAddPosition] = useState<(typeof ALLOWED_POSITIONS)[number] | ''>('');
  const [scheduleAddNote, setScheduleAddNote] = useState('');

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
          setAttendanceError(res.error.message);
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
          setAttendanceError(res.error.message);
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
          setAttendanceError(res.error.message);
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
      setAttendanceError(String(err?.message ?? err));
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
    if (page !== 'employees') {
      return;
    }
    const handle = window.setTimeout(() => {
      void fetchEmployees({ reset: true });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [page, employeeSearch, employeeAgency, employeePosition]);

  useEffect(() => {
    if (page !== 'schedule') {
      return;
    }
    const handle = window.setTimeout(() => {
      void fetchSchedule();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [page, scheduleSearch, schedulePosition, scheduleWeekOffset]);

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

  const fetchSchedule = async (options?: { weekOffset?: number; search?: string; position?: string }) => {
    if (!supabase) {
      setScheduleError('缺少 Supabase 配置。');
      setScheduleRows([]);
      return;
    }

    const offset = options?.weekOffset ?? scheduleWeekOffset;
    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, offset * 7);
    const weekEnd = addDays(weekStart, 7);
    const startDate = toDateOnly(weekStart);
    const endDate = toDateOnly(weekEnd);

    const searchValue = (options?.search ?? scheduleSearch).trim();
    const positionValue = (options?.position ?? schedulePosition).trim();

    await runLocked('schedule', async () => {
      setScheduleError(null);

      let q = supabase
        .from(SCHEDULE_TABLE)
        .select('id, staff_id, date, shift, position, note, operator, updated_at, created_at')
        .gte('date', startDate)
        .lt('date', endDate)
        .order('date', { ascending: false })
        .order('staff_id', { ascending: true })
        .limit(2000);

      if (positionValue) {
        q = q.eq('position', positionValue as any);
      }
      if (searchValue) {
        const term = `%${searchValue}%`;
        q = q.or(`staff_id.ilike.${term},note.ilike.${term},operator.ilike.${term}`);
      }

      const res = await q;
      if (res.error) {
        setScheduleError(res.error.message);
        setScheduleRows([]);
        return;
      }

      setScheduleRows(((res.data as any[]) ?? []) as ScheduleRow[]);
    });
  };

  const openScheduleAdd = () => {
    const baseWeekStart = startOfWeekMonday(serverTime);
    const weekStart = addDays(baseWeekStart, scheduleWeekOffset * 7);
    setScheduleAddOpen(true);
    setScheduleAddStaffId('');
    setScheduleAddDate(toDateOnly(weekStart));
    setScheduleAddShift('early');
    setScheduleAddPosition('');
    setScheduleAddNote('');
  };

  const closeScheduleAdd = () => {
    setScheduleAddOpen(false);
  };

  const saveScheduleAdd = async () => {
    if (!supabase) {
      setScheduleError('缺少 Supabase 配置。');
      return;
    }
    const staff = normalizeStaffId(scheduleAddStaffId);
    if (!staff || !isValidStaffIdValue(staff)) {
      setScheduleError('员工ID格式不正确（例如：US010454）。');
      return;
    }
    const date = scheduleAddDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setScheduleError('日期格式不正确。');
      return;
    }
    if (!scheduleAddPosition) {
      setScheduleError(`请选择岗位：${ALLOWED_POSITIONS.join(', ')}`);
      return;
    }

    await runLocked('schedule_upsert', async () => {
      setScheduleError(null);
      const payload = {
        staff_id: staff,
        date,
        shift: scheduleAddShift,
        position: scheduleAddPosition,
        note: scheduleAddNote.trim() || null,
        operator: user?.email ?? null,
        updated_at: new Date(serverTime).toISOString()
      };
      const res = await supabase.from(SCHEDULE_TABLE).upsert([payload as any], { onConflict: 'staff_id,date' });
      if (res.error) {
        setScheduleError(res.error.message);
        return;
      }
      await writeAudit({
        action: 'schedule_upsert',
        staffId: staff,
        target: SCHEDULE_TABLE,
        payload
      });
      closeScheduleAdd();
      await fetchSchedule();
    });
  };

  const deleteScheduleRow = async (row: ScheduleRow) => {
    if (!supabase) {
      setScheduleError('缺少 Supabase 配置。');
      return;
    }
    const id = String(row.id ?? '').trim();
    if (!id) return;
    const ok = window.confirm('确定要删除这条排班吗？此操作不可撤销。');
    if (!ok) return;

    await runLocked('schedule_delete', async () => {
      setScheduleError(null);
      const res = await supabase.from(SCHEDULE_TABLE).delete().eq('id', id);
      if (res.error) {
        setScheduleError(res.error.message);
        return;
      }
      await writeAudit({
        action: 'schedule_delete',
        staffId: String(row.staff_id ?? '').trim() || null,
        target: SCHEDULE_TABLE,
        payload: { id, row }
      });
      await fetchSchedule();
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
        setRecentPunchesError(result.error);
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
        setRecentPunchesError(result.error);
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
    position
  }: {
    reset: boolean;
    search?: string;
    agency?: string;
    position?: string;
  }) => {
    if (!supabase) {
      setEmployeesError('缺少 Supabase 配置。');
      return;
    }

    const searchValue = (search ?? employeeSearch).trim().replace(/,/g, ' ');
    const agencyValue = (agency ?? employeeAgency).trim();
    const positionValue = (position ?? employeePosition).trim();

    await runLocked('employees', async () => {
      setEmployeesError(null);

      const pageSize = 200;
      const rangeEnd = new Date(serverTime);
      const rangeStart = addDays(rangeEnd, -SHIFT_ANALYSIS_DAYS);

      const build = (mode: EmployeeColumnMode, from: number, to: number) => {
        const agencyCol = mode === 'cased' ? 'Agency' : 'agency';
        const positionCol = mode === 'cased' ? 'Position' : 'position';
        const select =
          mode === 'cased'
            ? 'id, staff_id, name, "Agency", "Position", created_at'
            : 'id, staff_id, name, agency, position, created_at';

        let q = supabase.from(EMPLOYEE_TABLE).select(select).range(from, to);

        if (agencyValue) {
          q = q.ilike(agencyCol as any, `%${agencyValue}%`);
        }

        if (positionValue) {
          q = q.ilike(positionCol as any, `%${positionValue}%`);
        }

        if (searchValue) {
          const term = `%${searchValue}%`;
          q = q.or(`staff_id.ilike.${term},name.ilike.${term}`);
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
          setEmployeesError(attempt.error.message);
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
          ? { staff_id: staff, name, Agency: agency, Position: normalizedPos }
          : { staff_id: staff, name, agency, position: normalizedPos };

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
        payload: { staff_id: staff, name, agency, position: normalizedPos }
      });
      setEmployeeNewStaffId('');
      setEmployeeNewName('');
      setEmployeeNewAgency('');
      setEmployeeNewPosition('');
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

  const openEmployeeEdit = (payload: { staff: string; name: string; agency: string; position: string }) => {
    setEmployeesError(null);
    setEmployeeEditStaffId(payload.staff);
    setEmployeeEditName(payload.name);
    setEmployeeEditAgency(payload.agency);
    const normalized = normalizePositionKey(payload.position);
    setEmployeeEditPosition((normalized ?? '') as (typeof ALLOWED_POSITIONS)[number] | '');
    setEmployeeEditOpen(true);
  };

  const closeEmployeeEdit = () => {
    setEmployeeEditOpen(false);
    setEmployeeEditStaffId(null);
    setEmployeeEditName('');
    setEmployeeEditAgency('');
    setEmployeeEditPosition('');
  };

  const saveEmployeeEdit = async () => {
    if (!supabase) {
      setEmployeesError('缺少 Supabase 配置。');
      return;
    }
    const staff = String(employeeEditStaffId ?? '').trim();
    if (!staff) return;

    const name = employeeEditName.trim();
    const agency = employeeEditAgency.trim();
    const positionRaw = employeeEditPosition.trim();
    const normalizedPos = positionRaw ? normalizePositionKey(positionRaw) : null;
    if (positionRaw && !normalizedPos) {
      setEmployeesError(`Position 只能是：${ALLOWED_POSITIONS.join(', ')}`);
      return;
    }

    await runLocked('employee_edit', async () => {
      setEmployeesError(null);
      const mode = await resolveEmployeeColumnMode();
      const payload =
        mode === 'cased'
          ? { name, Agency: agency || null, Position: normalizedPos }
          : { name, agency: agency || null, position: normalizedPos };
      const { error } = await supabase.from(EMPLOYEE_TABLE).update(payload as any).eq('staff_id', staff);
      if (error) {
        setEmployeesError(error.message);
        return;
      }
      setStatus({ tone: 'success', message: `已更新员工：${staff}` });
      await writeAudit({
        action: 'employee_update',
        staffId: staff,
        target: EMPLOYEE_TABLE,
        payload: { staff_id: staff, name, agency, position: normalizedPos }
      });
      closeEmployeeEdit();
      await fetchEmployees({ reset: true });
    });
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
      capEnd
    }: {
      staff: string;
      name: string;
      agency: string;
      position: string;
      eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT'; manual: boolean }>>;
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

      return {
        staff_id: staff,
        name,
        agency,
        position,
        hoursByDay,
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

        const rows: TimecardRow[] = staffIds.map((staff) => {
          const profile = profilesRes.staffToProfile.get(staff) ?? { name: '', agency: '', position: '' };
          return buildTimecardRow({
            staff,
            name: profile.name,
            agency: profile.agency,
            position: profile.position,
            eventsByStaff,
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

      const rows: TimecardRow[] = employees.map((e) => {
        const staff = String(e.staff_id ?? '').trim();
        const name = String(e.name ?? '').trim();
        const agency = String(e.agency ?? e.Agency ?? '').trim();
        const position = String(e.position ?? e.Position ?? '').trim();
        return buildTimecardRow({ staff, name, agency, position, eventsByStaff, capEnd });
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
      setTimecardError(result.error);
      setTimecardRows(result.rows);
      setTimecardHasMore(false);
      return;
    }

    await runLocked('timecard', async () => {
      setTimecardError(null);
      const result = await fetchAll();
      if (result.error) {
        setTimecardError(result.error);
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
      void fetchSchedule();
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

    const uniqueByStaff = new Map<string, { staff_id: string; name?: string; agency?: string; position?: string }>();
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

      const record: { staff_id: string; name?: string; agency?: string; position?: string } = { staff_id: staff };
      if (name) record.name = name;
      if (agency) record.agency = agency;
      if (position) record.position = position;
      if (positionRaw && !position) record.position = positionRaw;
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
          const select = m === 'cased' ? 'staff_id, name, "Agency", "Position"' : 'staff_id, name, agency, position';
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
                Position: row.position ?? null
              }))
            : toInsert.map((row: any) => ({
                staff_id: row.staff_id,
                name: row.name ?? null,
                agency: row.agency ?? null,
                position: row.position ?? null
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

      const existingByStaff = new Map<string, { name: string; agency: string; position: string }>();
      for (const r of existingDetailsRes.rows) {
        const staff = String(r.staff_id ?? '').trim();
        if (!staff) continue;
        existingByStaff.set(staff, {
          name: String(r.name ?? '').trim(),
          agency: String(r.agency ?? r.Agency ?? '').trim(),
          position: String(r.position ?? r.Position ?? '').trim()
        });
      }

      if (!uploadFillDuplicates || skippedExisting === 0) {
        return { error: null as any, inserted: insertedCount, skippedExisting, updated: 0 };
      }

      const toUpdate: Array<{ staff_id: string; payload: Record<string, unknown> }> = [];
      for (const row of batch) {
        const staff = String(row.staff_id ?? '').trim();
        if (!staff || !existingSet.has(staff)) continue;
        const existing = existingByStaff.get(staff) ?? { name: '', agency: '', position: '' };

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
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6">
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
                    <h2 className="font-display text-2xl tracking-[0.08em]">{t('排班', 'Schedule')}</h2>
                    <p className="mt-2 text-xs text-slate-400">
                      {t('按周管理排班（示例版）。', 'Manage weekly schedules (MVP).')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                      {t('上一周', 'Prev')}
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
                      {t('本周', 'This week')}
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
                      {t('下一周', 'Next')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => void fetchSchedule()}
                      className="rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('刷新', 'Refresh')}
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={openScheduleAdd}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('新增排班', 'Add')}
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-6">
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
                        void fetchSchedule({ weekOffset: offset });
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
                      placeholder={t('按工号/备注/操作者搜索', 'Search staff id / note / operator')}
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
                      <option value="">{t('全部岗位', 'All positions')}</option>
                      {ALLOWED_POSITIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {scheduleError && <p className="mt-3 text-sm text-ember">{t('加载失败：', 'Load failed: ')}{scheduleError}</p>}
                {!scheduleError && scheduleRows.length === 0 && (
                  <p className="mt-3 text-sm text-slate-400">{t('暂无排班记录。', 'No schedules yet.')}</p>
                )}

                {!scheduleError && scheduleRows.length > 0 && (
                  <div className="no-scrollbar mt-5 overflow-x-auto overflow-y-hidden rounded-2xl border border-white/10 bg-black/30">
                    <table className="min-w-[1100px] w-max table-fixed text-left text-xs leading-tight">
                      <thead className="border-b border-white/10 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                        <tr>
                          <th className="w-[120px] px-3 py-2">Date</th>
                          <th className="w-[140px] px-3 py-2">Staff</th>
                          <th className="w-[110px] px-3 py-2">Shift</th>
                          <th className="w-[140px] px-3 py-2">Position</th>
                          <th className="w-[220px] px-3 py-2">Note</th>
                          <th className="w-[220px] px-3 py-2">Operator</th>
                          <th className="w-[180px] px-3 py-2">Updated</th>
                          <th className="w-[110px] px-3 py-2 text-right">{t('操作', 'Actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scheduleRows.map((r) => {
                          const date = String(r.date ?? '').trim();
                          const staff = String(r.staff_id ?? '').trim();
                          const shift = (r.shift ?? null) as 'early' | 'late' | null;
                          const position = String(r.position ?? '').trim();
                          const note = String(r.note ?? '').trim();
                          const operator = String(r.operator ?? '').trim();
                          const updated = r.updated_at ? new Date(r.updated_at).toLocaleString(locale, { hour12: false }) : '';

                          return (
                            <tr key={String(r.id ?? `${date}-${staff}`)} className="border-b border-white/5 last:border-0">
                              <td className="px-3 py-2 text-slate-200 font-mono">{date || '-'}</td>
                              <td className="px-3 py-2 text-slate-200 font-mono">{staff || '-'}</td>
                              <td className="px-3 py-2 text-slate-200">
                                <span
                                  className={[
                                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
                                    shift === 'early'
                                      ? 'border-indigo-400/60 text-indigo-200 bg-indigo-500/10'
                                      : 'border-fuchsia-400/60 text-fuchsia-200 bg-fuchsia-500/10'
                                  ].join(' ')}
                                >
                                  {shift === 'early' ? t('早班', 'Early') : t('晚班', 'Late')}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-slate-200">
                                <span
                                  className={[
                                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
                                    getPositionBadgeClass(position)
                                  ].join(' ')}
                                >
                                  {position || '-'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-slate-200 truncate">{note || '-'}</td>
                              <td className="px-3 py-2 text-slate-400 truncate">{operator || '-'}</td>
                              <td className="px-3 py-2 text-slate-400 truncate">{updated || '-'}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={() => void deleteScheduleRow(r)}
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
                )}

                {scheduleAddOpen &&
                  typeof document !== 'undefined' &&
                  createPortal(
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
                      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-slate-950/90 shadow-2xl backdrop-blur">
                        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
                          <div>
                            <h3 className="font-display text-2xl tracking-[0.08em]">{t('新增排班', 'Add schedule')}</h3>
                            <p className="mt-2 text-xs text-slate-400">
                              {t('将写入表：', 'Writes to table: ')}
                              <span className="font-mono text-slate-200">{SCHEDULE_TABLE}</span>
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={closeScheduleAdd}
                            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {t('关闭', 'Close')}
                          </button>
                        </div>

                        <div className="px-6 py-5">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Staff ID</label>
                              <input
                                value={scheduleAddStaffId}
                                onChange={(e) => setScheduleAddStaffId(e.target.value)}
                                disabled={isLocked}
                                placeholder="US010454"
                                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Date</label>
                              <input
                                type="date"
                                value={scheduleAddDate}
                                onChange={(e) => setScheduleAddDate(e.target.value)}
                                disabled={isLocked}
                                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Shift</label>
                              <select
                                value={scheduleAddShift}
                                onChange={(e) => setScheduleAddShift((e.target.value as any) === 'late' ? 'late' : 'early')}
                                disabled={isLocked}
                                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <option value="early">{t('早班', 'Early')}</option>
                                <option value="late">{t('晚班', 'Late')}</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Position</label>
                              <select
                                value={scheduleAddPosition}
                                onChange={(e) => setScheduleAddPosition((e.target.value as any) ?? '')}
                                disabled={isLocked}
                                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <option value="">{t('选择岗位', 'Select position')}</option>
                                {ALLOWED_POSITIONS.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="md:col-span-2">
                              <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Note</label>
                              <input
                                value={scheduleAddNote}
                                onChange={(e) => setScheduleAddNote(e.target.value)}
                                disabled={isLocked}
                                placeholder={t('可选：备注', 'Optional note')}
                                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                              />
                            </div>
                          </div>

                          {scheduleError && <p className="mt-3 text-sm text-ember">{scheduleError}</p>}

                          <div className="mt-5 flex items-center justify-end gap-3">
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={closeScheduleAdd}
                              className="h-11 rounded-2xl bg-white/10 px-6 text-sm font-semibold text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {t('取消', 'Cancel')}
                            </button>
                            <button
                              type="button"
                              disabled={isLocked}
                              onClick={() => void saveScheduleAdd()}
                              className="h-11 rounded-2xl bg-neon px-6 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t('保存', 'Save')}
                            </button>
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
                        void fetchEmployees({ reset: true, search: '', agency: '', position: '' });
                      }}
                      className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t('清空筛选', 'Clear filters')}
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
                    <input
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      disabled={isLocked}
                      placeholder={t('通过ID或者名字搜索', 'Search by id or name')}
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
                    {employees.length}
                    {t(' 条', '')}
                  </div>
                </div>

                {employeeAddOpen && (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('新增员工', 'Add Employee')}</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-5">
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
                {!employeesError && employees.length === 0 && (
                  <p className="mt-3 text-sm text-slate-400">{t('暂无数据，点击“刷新/搜索”。', 'No data. Click “Refresh/Search”.')}</p>
                )}

                <div className="mt-5 overflow-auto rounded-2xl border border-white/10 bg-black/30">
                  <table className="min-w-[900px] w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs uppercase tracking-[0.2em] text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Employee ID</th>
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Agency</th>
                        <th className="px-4 py-3">Position</th>
                        <th className="px-4 py-3">{t('班次', 'Shift')}</th>
                        <th className="px-4 py-3 text-right">{t('操作', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((e) => {
                        const staff = String(e.staff_id ?? '').trim();
                        const name = String(e.name ?? '').trim();
                        const agency = String(e.agency ?? e.Agency ?? '').trim();
                        const position = String(e.position ?? e.Position ?? '').trim();
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
                                    position
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
                            {t('工号：', 'Staff: ')}
                            <span className="text-slate-200">{employeeEditStaffId}</span>
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

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
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

                <div className="no-scrollbar mt-5 overflow-x-auto overflow-y-hidden rounded-2xl border border-white/10 bg-black/30">
                  <table className="min-w-[1500px] w-max table-fixed text-left text-xs leading-tight">
                    <thead className="border-b border-white/10 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                      {(() => {
                        const baseWeekStart = startOfWeekMonday(serverTime);
                        const weekStart = addDays(baseWeekStart, timecardWeekOffset * 7);
                        const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                        return (
                          <tr>
                            <th className="w-[108px] px-2 py-1.5">ID</th>
                            <th className="w-[200px] px-2 py-1.5">Name</th>
                            <th className="w-[140px] px-2 py-1.5">Agency</th>
                            <th className="w-[120px] px-2 py-1.5">岗位</th>
                            {days.map((label, idx) => (
                              <th key={label} className="w-[92px] px-2 py-1.5 whitespace-nowrap text-center">
                                {label} {toDateOnly(addDays(weekStart, idx)).slice(5)}
                              </th>
                            ))}
                            <th className="w-[92px] px-2 py-1.5 text-center">合计</th>
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
                                        const base =
                                          'rounded px-1.5 py-0.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
                                        if (manual) return [base, 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'].join(' ');
                                        if (over8) return [base, 'bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'].join(' ');
                                        if (inProgress) return [base, 'bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'].join(' ');
                                        return [base, 'bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'].join(' ');
                                      })()}
                                      title="查看/编辑打卡流水"
                                    >
                                      {formatHours(h)}
                                    </button>
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
                          {!timecardPunchReadOnly && (
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
                      '重复时补全信息（仅填充数据库里为空的 name/agency/position）',
                      'Fill missing fields on duplicates (only empty name/agency/position)'
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
                          const headers = ['staff_id', 'name', 'agency', 'position'];
                          const ws = XLSX.utils.aoa_to_sheet([headers]);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, 'template');
                          // writeFile triggers download in browser
                          XLSX.writeFile(wb, 'ob_employees_template.xlsx');
                        } catch (err: any) {
                          // fallback to CSV download
                          const headers = ['staff_id', 'name', 'agency', 'position'];
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
