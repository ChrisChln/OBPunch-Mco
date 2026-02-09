import { useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseClient } from './lib/supabase';
import { isValidStaffId, normalizeStaffId } from './lib/staffId';

type PunchAction = 'IN' | 'OUT';

type Page = 'punch' | 'log' | 'employee' | 'edit';

type StatusTone = 'idle' | 'pending' | 'success' | 'error';

type Status = {
  tone: StatusTone;
  message: string;
};

type PunchBoardRow = {
  id: number | string;
  staff_id: string;
  action: PunchAction;
  created_at: string | null;
};

type DailyRosterItem = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: string;
};

type AbsentRosterItem = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: string;
};
type ArrivalMetric = {
  shift: 'early' | 'late';
  position: AllowedPosition;
  expected: number;
  present: number;
  onClock: number;
  onClockStaff: string[];
};

type TomorrowListSetting = {
  enabled: boolean;
  publishForDate: string;
};

const ALLOWED_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer'] as const;
type AllowedPosition = (typeof ALLOWED_POSITIONS)[number];

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const EMPLOYEE_REQUESTS_TABLE = (import.meta.env.VITE_EMPLOYEE_REQUESTS_TABLE as string | undefined) ?? 'ob_employee_requests';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';
const APP_SETTINGS_TABLE = (import.meta.env.VITE_APP_SETTINGS_TABLE as string | undefined) ?? 'ob_app_settings';
const TOMORROW_LIST_PUBLISH_KEY = 'publish_tomorrow_list';
const SCHEDULE_REST_NOTE = '__rest__';
const SCHEDULE_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');
const ROSTER_RESET_HOUR_RAW = Number(import.meta.env.VITE_ROSTER_RESET_HOUR ?? 0);
const ROSTER_RESET_HOUR = Number.isFinite(ROSTER_RESET_HOUR_RAW) ? Math.max(0, Math.min(23, ROSTER_RESET_HOUR_RAW)) : 5;
const ABSENT_RESET_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const ABSENT_RESET_HOUR = Number.isFinite(ABSENT_RESET_HOUR_RAW) ? Math.max(0, Math.min(23, ABSENT_RESET_HOUR_RAW)) : 5;
const LATE_ABSENT_VISIBLE_MINUTES = 16 * 60 + 30; // 16:30

const supabase = createSupabaseClient({ persistSession: false });

const formatTime = (value: Date) =>
  value.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const addDays = (value: Date, days: number) => {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d;
};

const toDateOnly = (value: Date) => {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getTemplateDateByDayIndex = (dayIndex: number) => toDateOnly(addDays(SCHEDULE_TEMPLATE_WEEK_START, dayIndex));
const getRosterDayIndex = (now: Date) => {
  const operational = new Date(now);
  operational.setHours(operational.getHours() - ROSTER_RESET_HOUR, operational.getMinutes(), operational.getSeconds(), operational.getMilliseconds());
  return (operational.getDay() + 6) % 7; // Monday=0 ... Sunday=6
};
const getOperationalDayStart = (now: Date, cutoffHour: number) => {
  const start = new Date(now);
  start.setHours(cutoffHour, 0, 0, 0);
  if (now.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  return start;
};
const getDayIndexByCutoff = (now: Date, cutoffHour: number) => {
  const operationalStart = getOperationalDayStart(now, cutoffHour);
  return (operationalStart.getDay() + 6) % 7; // Monday=0 ... Sunday=6
};
const getTomorrowListTargetDate = (now: Date) => (now.getHours() >= 15 ? addDays(now, 1) : now);
const getManualTomorrowListVisible = (setting: TomorrowListSetting, now: Date) => {
  if (!setting.enabled || !setting.publishForDate) return false;
  const cutoff = new Date(`${setting.publishForDate}T05:00:00`);
  if (Number.isNaN(cutoff.getTime())) return false;
  return now.getTime() < cutoff.getTime();
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
const getPositionFrameClass = (value: AllowedPosition) => {
  const v = value.trim().toLowerCase();
  if (v === 'pick') return 'border-sky-400/35 bg-sky-500/[0.04]';
  if (v === 'pack') return 'border-emerald-400/35 bg-emerald-500/[0.04]';
  if (v === 'rebin') return 'border-amber-400/35 bg-amber-500/[0.04]';
  if (v === 'preship') return 'border-rose-400/35 bg-rose-500/[0.04]';
  if (v === 'transfer') return 'border-violet-400/35 bg-violet-500/[0.04]';
  return 'border-white/10 bg-white/5';
};

const getShiftBadgeClass = (value: string) => {
  const v = value.trim().toLowerCase();
  if (v === 'early') return 'border-emerald-400/60 text-emerald-200 bg-emerald-500/10';
  if (v === 'late') return 'border-violet-400/60 text-violet-200 bg-violet-500/10';
  return 'border-white/20 text-slate-300 bg-white/5';
};

const formatShiftLabel = (value: string) => {
  const v = value.trim().toLowerCase();
  if (v === 'early') return 'Morning shift';
  if (v === 'late') return 'Night shift';
  return '-';
};
const normalizeShiftValue = (value: string): '' | 'early' | 'late' => {
  const v = value.trim().toLowerCase();
  if (v === 'early' || v === 'morning' || v === 'day') return 'early';
  if (v === 'late' || v === 'night' || v === 'evening') return 'late';
  return '';
};
const normalizeAllowedPosition = (value: string): AllowedPosition | '' => {
  const v = value.trim().toLowerCase();
  if (v === 'pick') return 'Pick';
  if (v === 'pack') return 'Pack';
  if (v === 'rebin') return 'Rebin';
  if (v === 'preship') return 'Preship';
  if (v === 'transfer') return 'Transfer';
  return '';
};
const getShiftBucketByInAt = (inAtIso: string): '' | 'early' | 'late' => {
  const dt = new Date(inAtIso);
  if (Number.isNaN(dt.getTime())) return '';
  const minutes = dt.getHours() * 60 + dt.getMinutes();
  return minutes >= 5 * 60 && minutes < 15 * 60 ? 'early' : 'late';
};
const overlapMs = (aStart: number, aEnd: number, bStart: number, bEnd: number) => {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start);
};
const computeShiftHoursFromIntervals = (intervals: Array<{ start: Date; end: Date }>) => {
  let earlyMs = 0;
  let lateMs = 0;
  for (const it of intervals) {
    let cursor = new Date(it.start);
    while (cursor.getTime() < it.end.getTime()) {
      const dayStart = new Date(cursor);
      dayStart.setHours(0, 0, 0, 0);
      const earlyStart = new Date(dayStart);
      earlyStart.setHours(5, 0, 0, 0);
      const earlyEnd = new Date(dayStart);
      earlyEnd.setHours(15, 0, 0, 0);
      const lateStart = new Date(earlyEnd);
      const lateEnd = new Date(dayStart);
      lateEnd.setDate(lateEnd.getDate() + 1);
      lateEnd.setHours(5, 0, 0, 0);

      const segmentStart = Math.max(cursor.getTime(), it.start.getTime());
      const segmentEnd = Math.min(it.end.getTime(), lateEnd.getTime());
      if (segmentEnd > segmentStart) {
        earlyMs += overlapMs(segmentStart, segmentEnd, earlyStart.getTime(), earlyEnd.getTime());
        lateMs += overlapMs(segmentStart, segmentEnd, lateStart.getTime(), lateEnd.getTime());
      }
      cursor = new Date(lateEnd);
    }
  }
  return { earlyHours: earlyMs / 3600000, lateHours: lateMs / 3600000 };
};

function getBestTimeField(row: Record<string, unknown>) {
  const candidates = ['created_at', 'inserted_at', 'punch_at', 'time', 'timestamp', 'ts'];
  for (const c of candidates) {
    const v = row[c];
    if (typeof v === 'string' && v.trim() !== '') {
      return v;
    }
  }
  return null;
}

export default function App() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isLocked = Boolean(busy);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const successInAudioRef = useRef<HTMLAudioElement | null>(null);
  const successOutAudioRef = useRef<HTMLAudioElement | null>(null);
  const errorAudioRef = useRef<HTMLAudioElement | null>(null);
  const arrivalShiftCacheRef = useRef<{ at: number; map: Record<string, '' | 'early' | 'late'> }>({ at: 0, map: {} });

  type EmployeeColumnMode = 'lower' | 'cased';
  const employeeColumnModeRef = useRef<EmployeeColumnMode | null>(null);

  const [page, setPage] = useState<Page>('punch');

  const [staffId, setStaffId] = useState('');
  const normalizedId = useMemo(() => normalizeStaffId(staffId), [staffId]);
  const isValidId = useMemo(() => isValidStaffId(normalizedId), [normalizedId]);

  const [uiStatus, setUiStatus] = useState<Status>({ tone: 'idle', message: 'Enter US ID to start punch' });

  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const successIn = new Audio(encodeURI('/sound/success in.mp3'));
    successIn.preload = 'auto';
    successIn.volume = 1;
    successInAudioRef.current = successIn;

    const successOut = new Audio(encodeURI('/sound/success out.mp3'));
    successOut.preload = 'auto';
    successOut.volume = 1;
    successOutAudioRef.current = successOut;

    const error = new Audio('/sound/error.mp3');
    error.preload = 'auto';
    error.volume = 1;
    errorAudioRef.current = error;

    return () => {
      successInAudioRef.current = null;
      successOutAudioRef.current = null;
      errorAudioRef.current = null;
    };
  }, []);

  const playSound = (audio: HTMLAudioElement | null) => {
    if (!audio) return;
    try {
      audio.currentTime = 0;
      void audio.play();
    } catch {
      // ignore autoplay/permission issues
    }
  };

  const playSuccess = (action: PunchAction) =>
    playSound(action === 'OUT' ? successOutAudioRef.current : successInAudioRef.current);
  const playError = () => playSound(errorAudioRef.current);

  const [offsetMs, setOffsetMs] = useState(0);
  const [serverTime, setServerTime] = useState(() => new Date());

  const [punches, setPunches] = useState<Record<string, unknown>[]>([]);
  const [punchesError, setPunchesError] = useState<string | null>(null);

  const [employee, setEmployee] = useState<Record<string, unknown> | null>(null);
  const [employeeError, setEmployeeError] = useState<string | null>(null);

  const [punchBoard, setPunchBoard] = useState<PunchBoardRow[]>([]);
  const [punchBoardError, setPunchBoardError] = useState<string | null>(null);
  const [punchBoardEmployeeMap, setPunchBoardEmployeeMap] = useState<
    Record<string, { name: string; agency: string; position: string }>
  >({});
  const [punchLogPositionFilter, setPunchLogPositionFilter] = useState<AllowedPosition | ''>('');
  const [dailyRoster, setDailyRoster] = useState<DailyRosterItem[]>([]);
  const [dailyRosterError, setDailyRosterError] = useState<string | null>(null);
  const [dailyRosterPositionFilter, setDailyRosterPositionFilter] = useState<AllowedPosition | ''>('');
  const [rosterShiftByStaffId, setRosterShiftByStaffId] = useState<Record<string, '' | 'early' | 'late'>>({});
  const [absentRoster, setAbsentRoster] = useState<AbsentRosterItem[]>([]);
  const [arrivalMetrics, setArrivalMetrics] = useState<ArrivalMetric[]>(() =>
    ['early', 'late'].flatMap((shift) =>
      ALLOWED_POSITIONS.map((position) => ({
        shift: shift as 'early' | 'late',
        position,
        expected: 0,
        present: 0,
        onClock: 0,
        onClockStaff: []
      }))
    )
  );
  const [rosterFlipped, setRosterFlipped] = useState(false);
  const [rosterFlipSeed, setRosterFlipSeed] = useState(0);
  const [tomorrowListSetting, setTomorrowListSetting] = useState<TomorrowListSetting>({
    enabled: false,
    publishForDate: ''
  });

  const [lastPunchAction, setLastPunchAction] = useState<PunchAction | null>(null);
  const [lastPunchActionError, setLastPunchActionError] = useState<string | null>(null);

  const punchBoardFiltered = useMemo(() => {
    if (!punchLogPositionFilter) return punchBoard;
    const needle = punchLogPositionFilter.trim().toLowerCase();
    return punchBoard.filter((p) => {
      const employee = punchBoardEmployeeMap[p.staff_id];
      const pos = String(employee?.position ?? '').trim();
      if (!pos) return true;
      return pos.toLowerCase() === needle;
    });
  }, [punchBoard, punchBoardEmployeeMap, punchLogPositionFilter]);

  const dailyRosterFiltered = useMemo(() => {
    if (!dailyRosterPositionFilter) return dailyRoster;
    const needle = dailyRosterPositionFilter.trim().toLowerCase();
    return dailyRoster.filter((row) => row.position.toLowerCase() === needle);
  }, [dailyRoster, dailyRosterPositionFilter]);
  const absentRosterFiltered = useMemo(() => {
    const nowMinutes = serverTime.getHours() * 60 + serverTime.getMinutes();
    const hideLateAbsent = nowMinutes < LATE_ABSENT_VISIBLE_MINUTES;
    const base = hideLateAbsent ? absentRoster.filter((row) => normalizeShiftValue(row.shift) !== 'late') : absentRoster;
    if (!dailyRosterPositionFilter) return base;
    const needle = dailyRosterPositionFilter.trim().toLowerCase();
    return base.filter((row) => row.position.toLowerCase() === needle);
  }, [absentRoster, dailyRosterPositionFilter, serverTime]);
  const arrivalMetricByKey = useMemo(() => {
    const map: Record<string, ArrivalMetric> = {};
    for (const metric of arrivalMetrics) {
      map[`${metric.position}:${metric.shift}`] = metric;
    }
    return map;
  }, [arrivalMetrics]);
  const rosterStaffIds = useMemo(
    () => Array.from(new Set(dailyRoster.map((row) => row.staff_id).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'en-US')),
    [dailyRoster]
  );
  const showTomorrowListData = useMemo(() => {
    const now = new Date();
    return getManualTomorrowListVisible(tomorrowListSetting, now);
  }, [serverTime, tomorrowListSetting]);
  const rosterDateText = useMemo(() => {
    const now = new Date();
    const manualVisible = getManualTomorrowListVisible(tomorrowListSetting, now);
    const target = manualVisible && tomorrowListSetting.publishForDate
      ? new Date(`${tomorrowListSetting.publishForDate}T00:00:00`)
      : getTomorrowListTargetDate(now);
    const datePart = toDateOnly(target).replace(/-/g, '/');
    const weekday = target.toLocaleDateString('en-US', { weekday: 'short' });
    return `${datePart} ${weekday}`;
  }, [serverTime, tomorrowListSetting]);
  const absentDateText = useMemo(() => {
    const now = new Date();
    const operationalStart = getOperationalDayStart(now, ABSENT_RESET_HOUR);
    const datePart = toDateOnly(operationalStart).replace(/-/g, '/');
    const weekday = operationalStart.toLocaleDateString('en-US', { weekday: 'short' });
    return `${datePart} ${weekday}`;
  }, [serverTime]);
  const flipRosterPanel = (source: 'auto' | 'manual' = 'manual') => {
    setRosterFlipped((prev) => !prev);
    if (source === 'manual') {
      setRosterFlipSeed((prev) => prev + 1);
    }
  };
  const [lastPunchActionLoading, setLastPunchActionLoading] = useState(false);

  const [editName, setEditName] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNote, setEditNote] = useState('');

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
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isLocked) {
      inputRef.current?.focus();
    }
  }, [isLocked, page]);

  useEffect(() => {
    const tick = () => {
      setServerTime(new Date(Date.now() + offsetMs));
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [offsetMs]);

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

  const fetchLastPunch = async (staff: string) => {
    if (!supabase) {
      return { action: null as PunchAction | null, error: 'Missing Supabase configuration.' };
    }

    const base = () => supabase.from('ob_punches').select('id, action, created_at').eq('staff_id', staff).limit(1);

    const attemptCreatedAt = await base().order('created_at', { ascending: false });
    const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: false }) : attemptCreatedAt;
    if (attempt.error) {
      return { action: null as PunchAction | null, error: attempt.error.message };
    }

    const rows = (attempt.data as any[] | null) ?? [];
    const action = (rows[0]?.action as PunchAction | undefined) ?? null;
    return { action, error: null as string | null };
  };

  useEffect(() => {
    if (!supabase || !isValidId) {
      setLastPunchAction(null);
      setLastPunchActionError(null);
      setLastPunchActionLoading(false);
      return;
    }

    let active = true;
    const staff = normalizedId;
    void (async () => {
      setLastPunchActionLoading(true);
      const { action, error } = await fetchLastPunch(staff);
      if (!active) return;
      setLastPunchAction(action);
      setLastPunchActionError(error);
      setLastPunchActionLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [normalizedId, isValidId]);

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

  const fetchStaffIdsForPosition = async (position: AllowedPosition) => {
    if (!supabase) {
      return { staffIds: [] as string[], error: 'Missing Supabase configuration.' };
    }

    const pageSize = 1000;
    const maxPages = 20;

    const fetchAll = async (mode: EmployeeColumnMode) => {
      const positionCol = mode === 'cased' ? 'Position' : 'position';
      const all: string[] = [];

      for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const res = await supabase
          .from(EMPLOYEE_TABLE)
          .select('staff_id')
          .ilike(positionCol as any, position)
          .range(from, to);

        if (res.error) {
          return { staffIds: [] as string[], error: res.error.message };
        }

        const rows = (res.data as any[] | null) ?? [];
        for (const r of rows) {
          const staff = String(r.staff_id ?? '').trim();
          if (staff) all.push(staff);
        }

        if (rows.length < pageSize) {
          break;
        }
      }

      return { staffIds: Array.from(new Set(all)), error: null as string | null };
    };

    const mode = await resolveEmployeeColumnMode();
    let res = await fetchAll(mode);
    if (res.error) {
      const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
      employeeColumnModeRef.current = flipped;
      res = await fetchAll(flipped);
    }
    return res;
  };

  const fetchEmployeeMap = async (staffIds: string[]) => {
    if (!supabase || staffIds.length === 0) {
      return { map: {} as Record<string, { name: string; agency: string; position: string }>, error: null as string | null };
    }

    const ids = Array.from(new Set(staffIds.map((s) => s.trim()).filter(Boolean)));
    if (ids.length === 0) {
      return { map: {} as Record<string, { name: string; agency: string; position: string }>, error: null as string | null };
    }

    const runQuery = async (mode: EmployeeColumnMode) => {
      const select = mode === 'cased' ? 'staff_id, name, "Agency", "Position"' : 'staff_id, name, agency, position';
      return await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', ids);
    };

    const mode = await resolveEmployeeColumnMode();
    let rows = await runQuery(mode);
    if (rows.error) {
      const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
      employeeColumnModeRef.current = flipped;
      rows = await runQuery(flipped);
    }
    if (rows.error) {
      return { map: {} as Record<string, { name: string; agency: string; position: string }>, error: rows.error.message };
    }

    const map: Record<string, { name: string; agency: string; position: string }> = {};
    for (const r of (rows.data as any[] | null) ?? []) {
      const staff = String(r.staff_id ?? '').trim();
      if (!staff) continue;
      map[staff] = {
        name: String(r.name ?? '').trim(),
        agency: String(r.agency ?? r.Agency ?? '').trim(),
        position: String(r.position ?? r.Position ?? '').trim()
      };
    }
    return { map, error: null as string | null };
  };
  const inferShiftByWorkHoursForStaff = async (staffIds: string[]) => {
    if (!supabase || staffIds.length === 0) {
      return {} as Record<string, '' | 'early' | 'late'>;
    }

    const ids = Array.from(new Set(staffIds.map((s) => normalizeStaffId(s)).filter(Boolean)));
    if (ids.length === 0) {
      return {} as Record<string, '' | 'early' | 'late'>;
    }

    const nowMs = Date.now();
    const cacheTtlMs = 10 * 60 * 1000;
    const cache = arrivalShiftCacheRef.current;
    const missing = ids.filter((staff) => !cache.map[staff]);
    const needRefresh = nowMs - cache.at > cacheTtlMs;
    if (!needRefresh && missing.length === 0) {
      return cache.map;
    }

    const targetStaff = needRefresh ? ids : missing;
    const inferredMap = needRefresh ? ({} as Record<string, '' | 'early' | 'late'>) : { ...cache.map };
    const rangeEnd = new Date();
    const rangeStart = new Date(rangeEnd);
    rangeStart.setDate(rangeStart.getDate() - 30);
    const eventsByStaff: Record<string, Array<{ at: Date; action: 'IN' | 'OUT' }>> = {};
    const punchPageSize = 1000;
    const maxPages = 6;

    for (const batch of chunk(targetStaff, 80)) {
      const base = () =>
        supabase
          .from('ob_punches')
          .select('staff_id, action, created_at')
          .in('staff_id', batch)
          .gte('created_at', rangeStart.toISOString())
          .lt('created_at', rangeEnd.toISOString());

      for (let page = 0; page < maxPages; page += 1) {
        const from = page * punchPageSize;
        const to = from + punchPageSize - 1;
        const attemptCreatedAt = await base().order('created_at', { ascending: true }).range(from, to);
        const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: true }).range(from, to) : attemptCreatedAt;
        if (attempt.error) break;
        const rows = (attempt.data as any[] | null) ?? [];
        for (const row of rows) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const actionRaw = String(row.action ?? '').toUpperCase();
          const atRaw = String(row.created_at ?? '').trim();
          if (!staff || (actionRaw !== 'IN' && actionRaw !== 'OUT') || !atRaw) continue;
          const at = new Date(atRaw);
          if (Number.isNaN(at.getTime())) continue;
          (eventsByStaff[staff] ??= []).push({ at, action: actionRaw === 'OUT' ? 'OUT' : 'IN' });
        }
        if (rows.length < punchPageSize) break;
      }
    }

    for (const staff of targetStaff) {
      const events = eventsByStaff[staff] ?? [];
      events.sort((a, b) => a.at.getTime() - b.at.getTime());
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
      const { earlyHours, lateHours } = computeShiftHoursFromIntervals(intervals);
      let shift: '' | 'early' | 'late' = '';
      if (earlyHours > lateHours) shift = 'early';
      else if (lateHours > earlyHours) shift = 'late';
      inferredMap[staff] = shift;
    }

    arrivalShiftCacheRef.current = { at: nowMs, map: inferredMap };
    return inferredMap;
  };

  const fetchDailyRoster = async (publishForDate?: string) => {
    if (!supabase) {
      setDailyRosterError('Missing Supabase configuration.');
      setDailyRoster([]);
      return;
    }

    const targetDate = publishForDate ? new Date(`${publishForDate}T00:00:00`) : getTomorrowListTargetDate(new Date());
    const dayIndex = getRosterDayIndex(targetDate);
    const templateDate = getTemplateDateByDayIndex(dayIndex);

    setDailyRosterError(null);
    const res = await supabase
      .from(SCHEDULE_TABLE)
      .select('staff_id, position, shift, note')
      .eq('date', templateDate)
      .order('staff_id', { ascending: true })
      .limit(2000);

    if (res.error) {
      setDailyRosterError(res.error.message);
      setDailyRoster([]);
      return;
    }

    const rawRows = (res.data as any[] | null) ?? [];
    const rows = rawRows.filter((row) => String(row.note ?? '').trim() !== SCHEDULE_REST_NOTE);
    const staffIds = Array.from(
      new Set(
        rows
          .map((row) => String(row.staff_id ?? '').trim())
          .filter(Boolean)
          .map((staff) => normalizeStaffId(staff))
          .filter(Boolean)
      )
    );

    const mapRes = await fetchEmployeeMap(staffIds);
    const employeeMap = mapRes.error ? {} : mapRes.map;
    const list: DailyRosterItem[] = rows.map((row) => {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const employeeInfo = staff ? employeeMap[staff] : undefined;
      const position = String(row.position ?? '').trim();
      return {
        staff_id: staff,
        name: employeeInfo?.name || staff,
        agency: employeeInfo?.agency || '-',
        position,
        shift: String(row.shift ?? '').trim()
      };
    });
    setDailyRoster(list);
  };

  const fetchAbsentRoster = async () => {
    if (!supabase) {
      setAbsentRoster([]);
      return;
    }

    const now = new Date();
    const todayDayIndex = getDayIndexByCutoff(now, ABSENT_RESET_HOUR);
    const templateDate = getTemplateDateByDayIndex(todayDayIndex);

    const scheduleRes = await supabase
      .from(SCHEDULE_TABLE)
      .select('staff_id, position, shift, note')
      .eq('date', templateDate)
      .order('staff_id', { ascending: true })
      .limit(3000);

    if (scheduleRes.error) {
      setAbsentRoster([]);
      return;
    }

    const scheduledRows = ((scheduleRes.data as any[] | null) ?? []).filter(
      (row) => String(row.note ?? '').trim() !== SCHEDULE_REST_NOTE
    );
    const scheduledStaff = Array.from(
      new Set(
        scheduledRows
          .map((row) => normalizeStaffId(String(row.staff_id ?? '').trim()))
          .filter(Boolean)
      )
    );
    if (scheduledStaff.length === 0) {
      setAbsentRoster([]);
      return;
    }
    const inferredShiftByStaff = await inferShiftByWorkHoursForStaff(scheduledStaff);

    const dayStart = getOperationalDayStart(now, ABSENT_RESET_HOUR);
    const punchRes = await supabase
      .from('ob_punches')
      .select('staff_id, created_at')
      .gte('created_at', dayStart.toISOString())
      .lte('created_at', now.toISOString())
      .order('created_at', { ascending: false })
      .limit(10000);

    const punchedStaff = new Set<string>();
    if (!punchRes.error) {
      for (const row of (punchRes.data as any[] | null) ?? []) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (staff && scheduledStaff.includes(staff)) punchedStaff.add(staff);
      }
    }

    const mapRes = await fetchEmployeeMap(scheduledStaff);
    const employeeMap = mapRes.error ? {} : mapRes.map;
    const byStaffSchedule = new Map<string, { position: string; shift: string }>();
    for (const row of scheduledRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff || byStaffSchedule.has(staff)) continue;
      byStaffSchedule.set(staff, {
        position: String(row.position ?? '').trim(),
        shift: String(row.shift ?? '').trim()
      });
    }

    const list: AbsentRosterItem[] = scheduledStaff
      .filter((staff) => !punchedStaff.has(staff))
      .filter((staff) => Boolean(employeeMap[staff]))
      .map((staff) => {
        const employeeInfo = employeeMap[staff];
        const scheduleInfo = byStaffSchedule.get(staff);
        return {
          staff_id: staff,
          name: employeeInfo?.name || '',
          agency: employeeInfo?.agency || '-',
          position: scheduleInfo?.position || employeeInfo?.position || '',
          shift: inferredShiftByStaff[staff] || normalizeShiftValue(scheduleInfo?.shift || '')
        };
      });

    setAbsentRoster(list);
  };
  const fetchArrivalMetrics = async () => {
    const empty: ArrivalMetric[] = ['early', 'late'].flatMap((shift) =>
      ALLOWED_POSITIONS.map((position) => ({
        shift: shift as 'early' | 'late',
        position,
        expected: 0,
        present: 0,
        onClock: 0,
        onClockStaff: []
      }))
    );
    if (!supabase) {
      setArrivalMetrics(empty);
      return;
    }

    const now = new Date();
    const todayDayIndex = getDayIndexByCutoff(now, ABSENT_RESET_HOUR);
    const templateDate = getTemplateDateByDayIndex(todayDayIndex);
    const scheduleRes = await supabase
      .from(SCHEDULE_TABLE)
      .select('staff_id, position, shift, note')
      .eq('date', templateDate)
      .limit(5000);
    if (scheduleRes.error) {
      setArrivalMetrics(empty);
      return;
    }

    const scheduleRows = ((scheduleRes.data as any[] | null) ?? []).filter(
      (row) => String(row.note ?? '').trim() !== SCHEDULE_REST_NOTE
    );
    const staffPositionMap = new Map<string, AllowedPosition>();
    for (const row of scheduleRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      const position = normalizeAllowedPosition(String(row.position ?? '').trim());
      if (!staff || !position) continue;
      if (!staffPositionMap.has(staff)) staffPositionMap.set(staff, position);
    }
    const scheduledStaff = Array.from(staffPositionMap.keys());
    const inferredShiftByStaff = await inferShiftByWorkHoursForStaff(scheduledStaff);

    const staffByKey = new Map<string, Set<string>>();
    const keysByStaff = new Map<string, string[]>();
    for (const row of scheduleRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) continue;
      const position = normalizeAllowedPosition(String(row.position ?? '').trim());
      if (!position) continue;
      const scheduledShift = normalizeShiftValue(String(row.shift ?? '').trim());
      const inferredShift = inferredShiftByStaff[staff] ?? '';
      const shift = inferredShift || scheduledShift || 'early';
      const key = `${shift}:${position}`;
      if (!staffByKey.has(key)) staffByKey.set(key, new Set());
      staffByKey.get(key)?.add(staff);
      const keys = keysByStaff.get(staff) ?? [];
      if (!keys.includes(key)) keys.push(key);
      keysByStaff.set(staff, keys);
    }

    const scheduledByKeyStaff = Array.from(keysByStaff.keys());
    const punchedStaff = new Set<string>();
    const latestActionByStaff = new Map<string, PunchAction>();
    if (scheduledByKeyStaff.length > 0) {
      const dayStartDate = getOperationalDayStart(now, ABSENT_RESET_HOUR);
      const dayStart = dayStartDate.toISOString();
      const dayEnd = addDays(dayStartDate, 1).toISOString();
      for (const batch of chunk(scheduledByKeyStaff, 120)) {
        const batchSet = new Set(batch);
        const pageSize = 1000;
        const maxPages = 30;
        for (let page = 0; page < maxPages; page += 1) {
          const from = page * pageSize;
          const to = from + pageSize - 1;
          const attemptCreatedAt = await supabase
            .from('ob_punches')
            .select('staff_id, action, created_at')
            .in('staff_id', batch)
            .gte('created_at', dayStart)
            .lt('created_at', dayEnd)
            .order('created_at', { ascending: true })
            .range(from, to);
          const punchRes = attemptCreatedAt.error
            ? await supabase
                .from('ob_punches')
                .select('staff_id, action, created_at')
                .in('staff_id', batch)
                .gte('created_at', dayStart)
                .lt('created_at', dayEnd)
                .order('id', { ascending: true })
                .range(from, to)
            : attemptCreatedAt;
          if (punchRes.error) break;
          const rows = (punchRes.data as any[] | null) ?? [];
          for (const row of rows) {
            const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
            const actionRaw = String(row.action ?? '').toUpperCase();
            const action = actionRaw === 'OUT' ? 'OUT' : actionRaw === 'IN' ? 'IN' : null;
            if (!staff) continue;
            punchedStaff.add(staff);
            if (action) latestActionByStaff.set(staff, action);
          }
          const allCovered = Array.from(batchSet).every((staff) => punchedStaff.has(staff));
          if (allCovered || rows.length < pageSize) break;
        }
      }
    }

    const arrivedByKey = new Map<string, Set<string>>();
    for (const staff of punchedStaff) {
      const keys = keysByStaff.get(staff) ?? [];
      for (const key of keys) {
        if (!arrivedByKey.has(key)) arrivedByKey.set(key, new Set());
        arrivedByKey.get(key)?.add(staff);
      }
    }
    const onClockByKey = new Map<string, Set<string>>();
    for (const [staff, action] of latestActionByStaff.entries()) {
      if (action !== 'IN') continue;
      const keys = keysByStaff.get(staff) ?? [];
      for (const key of keys) {
        if (!onClockByKey.has(key)) onClockByKey.set(key, new Set());
        onClockByKey.get(key)?.add(staff);
      }
    }
    const onClockStaffIds = Array.from(
      new Set(
        Array.from(onClockByKey.values()).flatMap((set) => Array.from(set))
      )
    );
    const onClockMapRes = await fetchEmployeeMap(onClockStaffIds);
    const onClockEmployeeMap = onClockMapRes.error ? {} : onClockMapRes.map;

    const out: ArrivalMetric[] = ['early', 'late'].flatMap((shift) =>
      ALLOWED_POSITIONS.map((position) => {
        const key = `${shift}:${position}`;
        const onClockIds = Array.from(onClockByKey.get(key) ?? []).sort((a, b) => a.localeCompare(b, 'en-US'));
        const onClockStaff = onClockIds.map((staff) => {
          const name = String(onClockEmployeeMap[staff]?.name ?? '').trim();
          return name ? `${name} (${staff})` : staff;
        });
        return {
          shift: shift as 'early' | 'late',
          position,
          expected: staffByKey.get(key)?.size ?? 0,
          present: arrivedByKey.get(key)?.size ?? 0,
          onClock: onClockByKey.get(key)?.size ?? 0,
          onClockStaff
        };
      })
    );
    setArrivalMetrics(out);
  };
  const fetchTomorrowListSetting = async () => {
    if (!supabase) {
      setTomorrowListSetting({ enabled: false, publishForDate: '' });
      return;
    }
    const res = await supabase
      .from(APP_SETTINGS_TABLE)
      .select('key, value, updated_at')
      .eq('key', TOMORROW_LIST_PUBLISH_KEY)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (res.error) {
      setTomorrowListSetting({ enabled: false, publishForDate: '' });
      return;
    }
    const row = (((res.data as any[]) ?? [])[0] ?? null) as { value?: Record<string, unknown> } | null;
    const value = (row?.value ?? {}) as Record<string, unknown>;
    setTomorrowListSetting({
      enabled: Boolean(value.enabled),
      publishForDate: String(value.publish_for_date ?? '')
    });
  };

  const fetchRosterShiftByPunches = async (staffIds: string[]) => {
    if (!supabase || staffIds.length === 0) {
      setRosterShiftByStaffId({});
      return;
    }

    const since = new Date();
    since.setDate(since.getDate() - 30);
    const ids = Array.from(new Set(staffIds.map((s) => normalizeStaffId(s)).filter(Boolean)));
    if (ids.length === 0) {
      setRosterShiftByStaffId({});
      return;
    }

    const counts: Record<string, { early: number; late: number }> = {};
    for (const batch of chunk(ids, 120)) {
      const res = await supabase
        .from('ob_punches')
        .select('staff_id, action, created_at')
        .in('staff_id', batch)
        .eq('action', 'IN')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(6000);

      if (res.error) {
        continue;
      }

      for (const row of (res.data as any[] | null) ?? []) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        const at = String(row.created_at ?? '').trim();
        if (!staff || !at) continue;
        const bucket = getShiftBucketByInAt(at);
        if (!bucket) continue;
        const current = (counts[staff] ??= { early: 0, late: 0 });
        if (bucket === 'early') current.early += 1;
        else current.late += 1;
      }
    }

    const out: Record<string, '' | 'early' | 'late'> = {};
    for (const staff of ids) {
      const c = counts[staff];
      if (!c) {
        out[staff] = '';
        continue;
      }
      out[staff] = c.late > c.early ? 'late' : c.early > 0 ? 'early' : '';
    }
    setRosterShiftByStaffId(out);
  };

  const fetchPunchBoard = async (options?: { position?: AllowedPosition | '' }) => {
    if (!supabase) {
      setPunchBoardError('Missing Supabase configuration.');
      return;
    }

    setPunchBoardError(null);

    const position = options?.position ?? '';

    const loadLatestAll = async () => {
      const base = () => supabase.from('ob_punches').select('id, staff_id, action, created_at').limit(30);
      const attemptCreatedAt = await base().order('created_at', { ascending: false });
      const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: false }) : attemptCreatedAt;
      if (attempt.error) {
        return { rows: [] as PunchBoardRow[], error: attempt.error.message };
      }
      const rows = ((attempt.data as any[] | null) ?? []).map((r) => ({
        id: r.id,
        staff_id: String(r.staff_id ?? '').trim(),
        action: String(r.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
        created_at: (r.created_at ?? null) as string | null
      })) as PunchBoardRow[];
      return { rows, error: null as string | null };
    };

    const loadLatestByPosition = async (pos: AllowedPosition) => {
      const staffRes = await fetchStaffIdsForPosition(pos);
      if (staffRes.error) {
        return { rows: [] as PunchBoardRow[], error: staffRes.error };
      }
      const staffIds = staffRes.staffIds;
      if (staffIds.length === 0) {
        return { rows: [] as PunchBoardRow[], error: null as string | null };
      }

      const batches = chunk(staffIds, 200);
      const allPunches: PunchBoardRow[] = [];
      for (const batch of batches) {
        const base = () =>
          supabase
            .from('ob_punches')
            .select('id, staff_id, action, created_at')
            .in('staff_id', batch)
            .limit(30);
        const attemptCreatedAt = await base().order('created_at', { ascending: false });
        const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: false }) : attemptCreatedAt;
        if (attempt.error) {
          return { rows: [] as PunchBoardRow[], error: attempt.error.message };
        }
        for (const r of (attempt.data as any[] | null) ?? []) {
          allPunches.push({
            id: r.id,
            staff_id: String(r.staff_id ?? '').trim(),
            action: String(r.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
            created_at: (r.created_at ?? null) as string | null
          });
        }
      }

      allPunches.sort((a, b) => {
        const atA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const atB = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (atA !== atB) return atB - atA;
        return String(b.id).localeCompare(String(a.id), 'en-US');
      });

      return { rows: allPunches.slice(0, 30), error: null as string | null };
    };

    const loaded = position ? await loadLatestByPosition(position) : await loadLatestAll();
    if (loaded.error) {
      setPunchBoardError(loaded.error);
      setPunchBoard([]);
      setPunchBoardEmployeeMap({});
      return;
    }

    const rows = loaded.rows;

    setPunchBoard(rows);

    const staffIds = rows.map((r) => r.staff_id).filter(Boolean);
    const mapRes = await fetchEmployeeMap(staffIds);
    if (mapRes.error) {
      setPunchBoardEmployeeMap({});
      return;
    }
    setPunchBoardEmployeeMap(mapRes.map);
  };

  useEffect(() => {
    if (!supabase) return;
    if (page !== 'punch') return;

    let active = true;
    void (async () => {
      if (!active) return;
      await fetchPunchBoard({ position: punchLogPositionFilter });
      await fetchTomorrowListSetting();
      await fetchAbsentRoster();
      await fetchArrivalMetrics();
    })();

    const timer = window.setInterval(() => {
      void fetchPunchBoard({ position: punchLogPositionFilter });
      void fetchTomorrowListSetting();
      void fetchAbsentRoster();
      void fetchArrivalMetrics();
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [page, punchLogPositionFilter]);

  useEffect(() => {
    if (page !== 'punch') return;
    if (!showTomorrowListData) {
      setDailyRoster([]);
      setDailyRosterError(null);
      setRosterShiftByStaffId({});
      return;
    }
    const now = new Date();
    const manualVisible = getManualTomorrowListVisible(tomorrowListSetting, now);
    void fetchDailyRoster(manualVisible ? tomorrowListSetting.publishForDate : undefined);
  }, [page, showTomorrowListData, tomorrowListSetting.publishForDate]);

  useEffect(() => {
    if (page !== 'punch') return;
    const timer = window.setInterval(() => {
      flipRosterPanel('auto');
    }, 25000);
    return () => window.clearInterval(timer);
  }, [page, rosterFlipSeed]);

  useEffect(() => {
    if (page !== 'punch') return;
    void fetchRosterShiftByPunches(rosterStaffIds);
  }, [page, rosterStaffIds]);

  const submitPunch = async (
    action: PunchAction,
    options?: { latestAction?: PunchAction | null; skipLatestFetch?: boolean; clearInput?: boolean }
  ) => {
    if (isLocked) {
      return;
    }
    if (!isValidId) {
      setUiStatus({ tone: 'error', message: 'Invalid staff ID format (example: US010454).' });
      playError();
      return;
    }
    if (!supabase) {
      setUiStatus({ tone: 'error', message: 'Missing Supabase configuration. Please check environment variables.' });
      playError();
      return;
    }

    setUiStatus({ tone: 'pending', message: `Punching... (${action})` });

    await runLocked('punch', async () => {
      const latest = options?.skipLatestFetch
        ? { action: options?.latestAction ?? null, error: null as string | null }
        : await fetchLastPunch(normalizedId);
      if (latest.error) {
        setUiStatus({ tone: 'error', message: `Failed to load last punch: ${latest.error}` });
        playError();
        return;
      }

      const allowed =
        (action === 'IN' && (latest.action === null || latest.action === 'OUT')) ||
        (action === 'OUT' && latest.action === 'IN');
      if (!allowed) {
        const msg =
          latest.action === null
            ? 'No previous record found. First action must be IN.'
            : latest.action === 'IN'
              ? 'Last action is IN. Please punch OUT next.'
              : 'Last action is OUT. Please punch IN next.';
        setUiStatus({ tone: 'error', message: msg });
        playError();
        setLastPunchAction(latest.action);
        setLastPunchActionError(null);
        return;
      }

      const { error } = await supabase.from('ob_punches').insert([
        {
          staff_id: normalizedId,
          action,
          metadata: {
            device: 'web_browser',
            user_agent: navigator.userAgent
          }
        }
      ]);

      if (error) {
        setUiStatus({ tone: 'error', message: `Punch failed: ${error.message}` });
        playError();
        return;
      }

      setUiStatus({ tone: 'success', message: `Punch success: ${action}` });
      playSuccess(action);
      setLastPunchAction(action);
      setLastPunchActionError(null);
      if (options?.clearInput ?? true) {
        setStaffId('');
      }
      void fetchPunchBoard({ position: punchLogPositionFilter });
      void fetchAbsentRoster();
      void fetchArrivalMetrics();
    });
  };

  const submitAutoPunch = async () => {
    if (isLocked) {
      return;
    }
    if (!isValidId) {
      setUiStatus({ tone: 'error', message: 'Invalid staff ID format (example: US010454).' });
      playError();
      return;
    }
    if (!supabase) {
      setUiStatus({ tone: 'error', message: 'Missing Supabase configuration. Please check environment variables.' });
      playError();
      return;
    }

    const latest = await fetchLastPunch(normalizedId);
    if (latest.error) {
      setUiStatus({ tone: 'error', message: `Failed to load last punch: ${latest.error}` });
      playError();
      return;
    }

    const nextAction: PunchAction = latest.action === 'IN' ? 'OUT' : 'IN';
    await submitPunch(nextAction, { latestAction: latest.action, skipLatestFetch: true, clearInput: true });
  };

  const onStaffIdKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitAutoPunch();
    }
  };

  const staffIdPanel = (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm uppercase tracking-[0.25em] text-slate-400">Employee ID</label>
      </div>
      <input
        ref={inputRef}
        value={staffId}
        onChange={(event) => setStaffId(event.target.value)}
        onKeyDown={onStaffIdKeyDown}
        disabled={isLocked}
        inputMode="text"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="Scan your barcode"
        className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-2xl text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="mt-3 text-xs text-slate-400">
        {!isValidId && 'Waiting for USID'}
        {isValidId && (
          <>
            Current: {normalizedId}
            {lastPunchActionLoading && <span className="ml-2 text-slate-500">(Checking...)</span>}
            {!lastPunchActionLoading && lastPunchActionError && (
              <span className="ml-2 text-ember">(Failed: {lastPunchActionError})</span>
            )}
            {!lastPunchActionLoading && !lastPunchActionError && (
              <span className="ml-2 text-slate-500">
                {lastPunchAction === null
                  ? '(No record: auto IN)'
                  : lastPunchAction === 'IN'
                    ? '(Last is IN: auto OUT)'
                    : '(Last is OUT: auto IN)'}
              </span>
            )}
          </>
        )}
      </div>
    </section>
  );

  const dailyRosterPanel = (
    <section className="glass reveal flex h-full flex-col rounded-3xl px-4 py-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-xl tracking-[0.08em]">{rosterFlipped ? 'Absent List' : 'List for Tomorrow'}</h3>
        <span className="font-display text-sm tracking-[0.06em] text-slate-300">
          {rosterFlipped ? absentDateText : rosterDateText}
        </span>
        <button
          type="button"
          disabled={isLocked}
          onClick={() => flipRosterPanel('manual')}
          className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-300 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          title="Flip panel"
        >
          Flip
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isLocked}
          onClick={() => setDailyRosterPositionFilter('')}
          className={[
            'rounded-xl px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] transition disabled:cursor-not-allowed disabled:opacity-60',
            dailyRosterPositionFilter === '' ? 'bg-neon text-ink shadow-glow' : 'bg-white/10 text-slate-200 hover:bg-white/15'
          ].join(' ')}
        >
          All
        </button>
        {ALLOWED_POSITIONS.map((pos) => (
          <button
            key={`roster-${pos}`}
            type="button"
            disabled={isLocked}
            onClick={() => setDailyRosterPositionFilter((prev) => (prev === pos ? '' : pos))}
            className={[
              'rounded-xl px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] transition disabled:cursor-not-allowed disabled:opacity-60',
              dailyRosterPositionFilter === pos ? 'bg-neon text-ink shadow-glow' : 'bg-white/10 text-slate-200 hover:bg-white/15'
            ].join(' ')}
          >
            {pos}
          </button>
        ))}
      </div>
      {dailyRosterError && <p className="mt-3 text-sm text-ember">{dailyRosterError}</p>}
      {!dailyRosterError && (
        <div className="mt-3 flex-1" style={{ perspective: '1200px' }}>
          <div
            className="relative h-full w-full transition-transform duration-700"
            style={{ transformStyle: 'preserve-3d', transform: rosterFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
          >
            <div className="absolute inset-0 overflow-auto pr-1" style={{ backfaceVisibility: 'hidden' }}>
              {!showTomorrowListData ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-slate-500">Tomorrow schedule not published yet.</p>
                </div>
              ) : dailyRosterFiltered.length === 0 ? (
                <p className="text-sm text-slate-400">No roster data.</p>
              ) : (
                <div className="space-y-2">
                  {dailyRosterFiltered.map((row, idx) => (
                    <div key={`${row.staff_id}-${row.position}-${idx}`} className="rounded-xl bg-white/5 px-3 py-2">
                      {(() => {
                        const inferredShift = rosterShiftByStaffId[row.staff_id] ?? '';
                        const displayShift = inferredShift || ((row.shift as '' | 'early' | 'late') ?? '');
                        return (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="truncate text-sm font-semibold text-slate-100">{row.name || row.staff_id}</div>
                              <div className="truncate text-xs text-slate-400">{row.agency}</div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={[
                                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
                                  getShiftBadgeClass(displayShift || '-')
                                ].join(' ')}
                              >
                                {formatShiftLabel(displayShift || '-')}
                              </span>
                              <span
                                className={[
                                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
                                  getPositionBadgeClass(row.position || '-')
                                ].join(' ')}
                              >
                                {row.position || '-'}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div
              className="absolute inset-0 overflow-auto pr-1"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              {absentRosterFiltered.length === 0 ? (
                <p className="text-sm text-slate-400">No absent staff.</p>
              ) : (
                <div className="space-y-2">
                  {absentRosterFiltered.map((row, idx) => (
                    <div key={`${row.staff_id}-${row.position}-absent-${idx}`} className="rounded-xl bg-white/5 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-semibold text-slate-100">{row.name || row.staff_id}</div>
                          <div className="truncate text-xs text-slate-400">{row.agency}</div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={[
                              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
                              getShiftBadgeClass(row.shift || '-')
                            ].join(' ')}
                          >
                            {formatShiftLabel(row.shift || '-')}
                          </span>
                          <span
                            className={[
                              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
                              getPositionBadgeClass(row.position || '-')
                            ].join(' ')}
                          >
                            {row.position || '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );

  const fetchPunches = async () => {
    if (!supabase) {
      setPunchesError('Missing Supabase configuration.');
      return;
    }

    await runLocked('punches', async () => {
      setPunchesError(null);

      const base = () => {
        let q = supabase.from('ob_punches').select('*').limit(50);
        if (isValidId) {
          q = q.eq('staff_id', normalizedId);
        }
        return q;
      };

      const attemptCreatedAt = await base().order('created_at', { ascending: false });
      const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: false }) : attemptCreatedAt;
      if (attempt.error) {
        const fallback = await base();
        if (fallback.error) {
          setPunchesError(fallback.error.message);
          setPunches([]);
          setUiStatus({ tone: 'error', message: 'Failed to load punches: ' + fallback.error.message });
          return;
        }
        const rows = (fallback.data as Record<string, unknown>[] | null) ?? [];
        setPunches(rows);
        setUiStatus({ tone: 'success', message: 'Loaded punches: ' + rows.length });
        return;
      }

      const rows = (attempt.data as Record<string, unknown>[] | null) ?? [];
      setPunches(rows);
      setUiStatus({ tone: 'success', message: 'Loaded punches: ' + rows.length });
    });
  };

  const fetchEmployee = async () => {
    if (!supabase) {
      setEmployeeError('Missing Supabase configuration.');
      return;
    }
    if (!isValidId) {
      setEmployeeError('Please enter a valid staff ID.');
      setEmployee(null);
      return;
    }

    await runLocked('employee', async () => {
      setEmployeeError(null);
      setEmployee(null);

      const base = () => supabase.from(EMPLOYEE_TABLE).select('*').eq('staff_id', normalizedId).limit(1);

      const attempt = await base().order('created_at', { ascending: false });
      if (attempt.error) {
        const fallback = await base();
        if (fallback.error) {
          setEmployeeError(fallback.error.message);
          setUiStatus({ tone: 'error', message: 'Failed to query employee: ' + fallback.error.message });
          return;
        }
        const rows = (fallback.data as Record<string, unknown>[] | null) ?? [];
        const found = rows[0] ?? null;
        if (!found) {
          setEmployeeError(null);
          setEmployee(null);
          setUiStatus({ tone: 'idle', message: 'Employee not found.' });
          return;
        }
        setEmployee(found);
        setUiStatus({ tone: 'success', message: 'Employee loaded.' });
        return;
      }

      const rows = (attempt.data as Record<string, unknown>[] | null) ?? [];
      const found = rows[0] ?? null;
      if (!found) {
        setEmployeeError(null);
        setEmployee(null);
        setUiStatus({ tone: 'idle', message: 'Employee not found.' });
        return;
      }

      setEmployee(found);
      setUiStatus({ tone: 'success', message: 'Employee loaded.' });
    });
  };

  const submitEmployeeChange = async () => {
    if (isLocked) {
      return;
    }
    if (!supabase) {
      setUiStatus({ tone: 'error', message: 'Missing Supabase configuration. Please check environment variables.' });
      return;
    }
    if (!isValidId) {
      setUiStatus({ tone: 'error', message: 'Invalid staff ID format (example: US010454).' });
      return;
    }

    const payload: Record<string, string> = {};
    if (editName.trim()) payload.name = editName.trim();
    if (editDept.trim()) payload.department = editDept.trim();
    if (editPhone.trim()) payload.phone = editPhone.trim();
    if (editNote.trim()) payload.note = editNote.trim();

    if (Object.keys(payload).length === 0) {
      setUiStatus({ tone: 'error', message: 'Please fill at least one field.' });
      return;
    }

    await runLocked('employee_request', async () => {
      setUiStatus({ tone: 'pending', message: 'Submitting change request...' });
      const { error } = await supabase.from(EMPLOYEE_REQUESTS_TABLE).insert([
        {
          staff_id: normalizedId,
          payload,
          metadata: {
            device: 'web_browser',
            user_agent: navigator.userAgent
          }
        }
      ]);

      if (error) {
        setUiStatus({ tone: 'error', message: 'Submit failed: ' + error.message });
        return;
      }

      setUiStatus({ tone: 'success', message: 'Change request submitted.' });
      setEditName('');
      setEditDept('');
      setEditPhone('');
      setEditNote('');
    });
  };

  useEffect(() => {
    if (page === 'log') {
      void fetchPunches();
    }
    if (page === 'employee') {
      void fetchEmployee();
    }
  }, [page]);

  const toneColor: Record<StatusTone, string> = {
    idle: 'text-slate-200',
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

  return (
    <div className="min-h-screen px-5 py-8 text-paper">
      <div className="flex w-full flex-col gap-6">
        {page === 'punch' ? (
          <section
            className="reveal grid gap-6 lg:grid-cols-[minmax(460px,1.15fr)_minmax(0,2fr)_minmax(0,3fr)] lg:items-start"
          >
            <div className="lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)]">{dailyRosterPanel}</div>

            <div className="space-y-6">
              <header className="glass reveal rounded-3xl px-6 py-6 shadow-glow">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h1 className="font-display text-4xl tracking-[0.08em]">ObPunch</h1>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-2 text-sm text-slate-300">
                      <span className="pulse-dot h-2 w-2 rounded-full bg-neon"></span>
                      <span>Time</span>
                    </div>
                    <div className="mt-2 font-display text-3xl tracking-[0.08em] text-neon">{formatTime(serverTime)}</div>
                  </div>
                </div>

                <div className={['mt-4 text-sm', toneColor[uiStatus.tone]].join(' ')}>{uiStatus.message}</div>
              </header>

              {staffIdPanel}

              <div className="glass reveal rounded-3xl px-4 py-4">
                <div className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-400">Attendance</div>
                <div className="space-y-2">
                  {ALLOWED_POSITIONS.map((position) => {
                    const positionFrameClass = getPositionFrameClass(position);
                    const early = arrivalMetricByKey[`${position}:early`] ?? {
                      shift: 'early' as const,
                      position,
                      expected: 0,
                      present: 0,
                      onClock: 0,
                      onClockStaff: []
                    };
                    const late = arrivalMetricByKey[`${position}:late`] ?? {
                      shift: 'late' as const,
                      position,
                      expected: 0,
                      present: 0,
                      onClock: 0,
                      onClockStaff: []
                    };
                    return (
                      <div key={position} className="grid gap-2 md:grid-cols-2">
                        <div className={['rounded-xl border px-3 py-2', positionFrameClass].join(' ')}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-slate-100">
                                {formatShiftLabel(early.shift)} {position}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-400">
                                Expected {early.expected} · Present {early.present}
                              </div>
                            </div>
                            <div className="group relative rounded-md bg-slate-950/70 px-3 py-1.5 text-center">
                              <div className="text-[10px] font-semibold tracking-[0.08em] text-slate-300">On Clock</div>
                              <div className="mt-0.5 text-2xl font-bold leading-none text-lime-400">{early.onClock}</div>
                              <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-64 rounded-lg border border-white/15 bg-slate-950/95 p-2 text-left shadow-2xl group-hover:block">
                                <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">On Clock Staff</div>
                                {early.onClockStaff.length === 0 ? (
                                  <div className="text-xs text-slate-300">No one on clock</div>
                                ) : (
                                  <div className="max-h-44 overflow-auto pr-1 text-xs text-slate-200">
                                    {early.onClockStaff.map((staffName) => (
                                      <div key={`early-${position}-${staffName}`} className="truncate py-0.5">
                                        {staffName}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className={['rounded-xl border px-3 py-2', positionFrameClass].join(' ')}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-slate-100">
                                {formatShiftLabel(late.shift)} {position}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-400">
                                Expected {late.expected} · Present {late.present}
                              </div>
                            </div>
                            <div className="group relative rounded-md bg-slate-950/70 px-3 py-1.5 text-center">
                              <div className="text-[10px] font-semibold tracking-[0.08em] text-slate-300">On Clock</div>
                              <div className="mt-0.5 text-2xl font-bold leading-none text-lime-400">{late.onClock}</div>
                              <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-64 rounded-lg border border-white/15 bg-slate-950/95 p-2 text-left shadow-2xl group-hover:block">
                                <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">On Clock Staff</div>
                                {late.onClockStaff.length === 0 ? (
                                  <div className="text-xs text-slate-300">No one on clock</div>
                                ) : (
                                  <div className="max-h-44 overflow-auto pr-1 text-xs text-slate-200">
                                    {late.onClockStaff.map((staffName) => (
                                      <div key={`late-${position}-${staffName}`} className="truncate py-0.5">
                                        {staffName}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)]">
              <section className="glass reveal flex h-full flex-col rounded-3xl px-6 py-6 shadow-glow">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-2xl tracking-[0.08em]">Punch Log</h2>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => void fetchPunchBoard({ position: punchLogPositionFilter })}
                    className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Refresh
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {ALLOWED_POSITIONS.map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      disabled={isLocked}
                      onClick={() => setPunchLogPositionFilter((prev) => (prev === pos ? '' : pos))}
                      className={[
                        'rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-60',
                        punchLogPositionFilter === pos
                          ? 'bg-neon text-ink shadow-glow'
                          : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      ].join(' ')}
                      title={`Filter: ${pos}`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>

                {punchBoardError && <p className="mt-3 text-sm text-ember">Load failed: {punchBoardError}</p>}
                {!punchBoardError && punchBoardFiltered.length === 0 && <p className="mt-3 text-sm text-slate-400">No data</p>}

                {!punchBoardError && punchBoardFiltered.length > 0 && (
                  <div className="mt-4 flex-1 overflow-auto pr-1">
                    <div className="space-y-2">
                      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 px-4 text-xs uppercase tracking-[0.25em] text-slate-500 sm:grid-cols-[3.5rem_minmax(0,1fr)_7rem_7rem_9.5rem]">
                        <div>Action</div>
                        <div className="sm:hidden">Info</div>
                        <div className="hidden sm:block">Name</div>
                        <div className="hidden sm:block">Agency</div>
                        <div className="hidden sm:block">Position</div>
                        <div className="text-right">Time</div>
                      </div>
                      {punchBoardFiltered.map((p) => {
                        const employee = punchBoardEmployeeMap[p.staff_id];
                        const time = p.created_at
                          ? new Date(p.created_at).toLocaleString('zh-CN', { hour12: false })
                          : '';
                        const isIn = p.action === 'IN';
                        const name = employee?.name || p.staff_id || '-';
                        const agency = employee?.agency || '-';
                        const position = employee?.position || '-';
                        return (
                          <div key={String(p.id)} className="rounded-2xl bg-white/5 px-4 py-3">
                            <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_7rem_7rem_9.5rem]">
                              <span className={['font-display text-xl', isIn ? 'text-mint' : 'text-ember'].join(' ')}>
                                {p.action}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-slate-200 sm:hidden">{name}</span>
                                <span className="mt-0.5 block truncate text-xs text-slate-400 sm:hidden">
                                  {agency} 路 {position}
                                </span>
                                <span className="hidden truncate text-sm text-slate-200 sm:block">{name}</span>
                              </span>
                              <span className="hidden min-w-0 truncate text-sm text-slate-200 sm:block">{agency}</span>
                              <span className="hidden min-w-0 truncate text-sm text-slate-200 sm:block">
                                <span
                                  className={[
                                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
                                    getPositionBadgeClass(position)
                                  ].join(' ')}
                                >
                                  {position || '-'}
                                </span>
                              </span>
                              <span className="text-right text-xs text-slate-400">{time}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </section>
        ) : (
          <>
            <header className="glass reveal rounded-3xl px-6 py-6 shadow-glow">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">ObPunch</p>
                  <h1 className="font-display text-4xl tracking-[0.08em]">浠撳簱鎵撳崱</h1>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 text-sm text-slate-300">
                    <span className="pulse-dot h-2 w-2 rounded-full bg-neon"></span>
                    <span>Time</span>
                  </div>
                  <div className="mt-2 font-display text-3xl tracking-[0.08em] text-neon">{formatTime(serverTime)}</div>
                  <p className="mt-2 text-xs text-slate-400">Auto sync every 60 seconds (with local offset).</p>
                </div>
              </div>

              <nav className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('punch')}
                  className={tabClass(false)}
                >
                  1 鎵撳崱鐣岄潰
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('log')}
                  className={tabClass(page === 'log')}
                >
                  2 鎵撳崱娴佹按
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('employee')}
                  className={tabClass(page === 'employee')}
                >
                  3 鍛樺伐淇℃伅
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('edit')}
                  className={tabClass(page === 'edit')}
                >
                  4 淇敼淇℃伅
                </button>
              </nav>

              <div className={['mt-4 text-sm', toneColor[uiStatus.tone]].join(' ')}>{uiStatus.message}</div>
            </header>

            {staffIdPanel}
          </>
        )}

        {page === 'log' && (
          <section className="glass reveal rounded-3xl px-6 py-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl tracking-[0.08em]">鎵撳崱娴佹按</h2>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => void fetchPunches()}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                鍒锋柊
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Read-only list. No update/delete. {isValidId ? `Current filter: ${normalizedId}` : "No filter (latest 50)"}
            </p>
            {punchesError && <p className="mt-4 text-sm text-ember">Load failed: {punchesError}</p>}
            {!punchesError && punches.length === 0 && <p className="mt-4 text-sm text-slate-400">No data</p>}
            <div className="mt-5 space-y-2">
              {punches.map((p) => {
                const staff = String(p.staff_id ?? '');
                const action = String(p.action ?? '');
                const timeStr = getBestTimeField(p);
                const time = timeStr ? new Date(timeStr).toLocaleString('zh-CN', { hour12: false }) : '';
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
                    </div>
                    <div className="text-xs text-slate-400">{time}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {page === 'employee' && (
          <section className="glass reveal rounded-3xl px-6 py-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl tracking-[0.08em]">鍛樺伐淇℃伅</h2>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => void fetchEmployee()}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                鏌ヨ
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              榛樿琛細<span className="text-slate-200">{EMPLOYEE_TABLE}</span>锛堟寜 created_at 鍙栨渶鏂颁竴鏉★級
            </p>
            {employeeError && <p className="mt-4 text-sm text-ember">Query failed: {employeeError}</p>}
            {!employeeError && !employee && <p className="mt-4 text-sm text-slate-400">璇疯緭鍏ュ伐鍙峰悗鏌ヨ</p>}
            {employee && (
              <div className="mt-5 space-y-3">
                <div className="rounded-2xl bg-black/30 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Raw</div>
                  <pre className="mt-2 overflow-auto text-xs text-slate-200">{JSON.stringify(employee, null, 2)}</pre>
                </div>
                {isRecord(employee.profile) && (
                  <div className="rounded-2xl bg-black/30 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Profile</div>
                    <pre className="mt-2 overflow-auto text-xs text-slate-200">
                      {JSON.stringify(employee.profile, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {page === 'edit' && (
          <section className="glass reveal rounded-3xl px-6 py-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl tracking-[0.08em]">淇敼淇℃伅锛堟彁浜ょ敵璇凤級</h2>
              <button
                type="button"
                disabled={isLocked || !isValidId}
                onClick={() => void submitEmployeeChange()}
                className="rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                鎻愪氦
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              No update/upsert. Writes to: <span className="text-slate-200">{EMPLOYEE_REQUESTS_TABLE}</span>
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">濮撳悕</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={isLocked}
                  placeholder="Optional"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">閮ㄩ棬</label>
                <input
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  disabled={isLocked}
                  placeholder="Optional"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">鐢佃瘽</label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  disabled={isLocked}
                  placeholder="Optional"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">璇存槑</label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  disabled={isLocked}
                  placeholder="Optional (e.g. reason for phone number change)"
                  rows={3}
                  className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          </section>
        )}

        <footer className="text-center text-xs text-slate-500">
          {isLocked && "Request in progress; input locked."}
          {!isLocked && 'Ready'}
        </footer>
      </div>
    </div>
  );
}


