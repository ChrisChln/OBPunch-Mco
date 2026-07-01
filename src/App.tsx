import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronDown, Clock3, LayoutDashboard, LogIn, LogOut, PackagePlus, Shield, UserRound, Waypoints } from 'lucide-react';
import { createSupabaseClient, createSupabaseClientWithCredentials } from './lib/supabase';
import { isValidPunchStaffId, normalizeStaffId } from './lib/staffId';
import { submitPunchToApi } from './lib/punchApi';
import { formatPunchFailureSummary } from './lib/punchDisplay';
import { getBarcodePromptGroupKey, getBarcodePrompts, getRandomBarcodePromptIndex } from './lib/barcodePrompt';
import { appSound, type AppSoundKind } from './lib/sound';
import { isScheduleOnlyAgency } from './shared/agencyRules';
import { canUnlockPunchScreen, normalizeAdminAccessContext } from './shared/adminAccess';
import { isEmployeeTerminated } from './shared/employeeStatus';
import { TimeOfDayLottie, type AmbientPeriod } from './components/TimeOfDayLottie';

type PunchAction = 'IN' | 'OUT';

type Page = 'punch' | 'log' | 'employee' | 'edit';

type StatusTone = 'idle' | 'pending' | 'success' | 'error';

type Status = {
  tone: StatusTone;
  message: string;
};

type UnlockStatus = {
  tone: StatusTone;
  message: string;
};

type PunchBoardRow = {
  id: number | string;
  staff_id: string;
  action: PunchAction;
  created_at: string | null;
};

type LastPunchSummary = {
  staffId: string;
  staffName: string;
  action: PunchAction;
  at: string | null;
};

type PunchDisplaySummary =
  | (LastPunchSummary & { status: 'success' })
  | {
      status: 'error';
      message: string;
      at: string | null;
    };

type PunchSuccessAnimation = LastPunchSummary & {
  key: number;
};

type BlurRevealTextProps = {
  label: string;
  lines: string[][];
  className: string;
  delayStepMs?: number;
};

function BlurRevealText({ label, lines, className, delayStepMs = 240 }: BlurRevealTextProps) {
  let wordIndex = 0;

  return (
    <span className={className} aria-label={label}>
      {lines.map((line, lineIndex) => (
        <span key={`${label}-${lineIndex}`} className="blur-reveal-line" aria-hidden="true">
          {line.map((word) => {
            const delay = wordIndex * delayStepMs;
            wordIndex += 1;
            return (
              <span key={`${label}-${word}-${delay}`} className="blur-reveal-word" style={{ animationDelay: `${delay}ms` }}>
                {word}
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}

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
  restWorked: number;
  restWorkedStaff: string[];
  scheduledNotClockInStaff: string[];
};
type DeviceLoanEventRow = {
  id?: number | string | null;
  created_at?: string | null;
  action?: string | null;
  device_sn?: string | null;
};
type DeviceCatalogRow = {
  device_sn?: string | null;
  device_name?: string | null;
  device_type?: string | null;
  position?: string | null;
};
type DeviceOutstandingItem = {
  deviceSn: string;
  deviceName: string;
  deviceType: string;
  position: string;
  borrowedAt: string;
};
type DeviceQuickLogRow = {
  id: string | number;
  created_at: string | null;
  staff_id: string;
  action: 'borrow' | 'return';
  device_sn: string;
};
type DeviceActionFeedback = {
  id: number;
  at: string;
  mode: 'borrow' | 'return';
  status: 'success' | 'error';
  title: string;
  detail: string;
};
type DeviceLookupResult =
  | {
      exists: true;
      active: boolean;
      deviceName: string;
    }
  | {
      exists: false;
      active: false;
      deviceName: string;
    };
type PunchBoardDeviceStatus = {
  text: string;
  tone: 'none' | 'borrowed' | 'overdue';
};

const ALLOWED_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'FLEX TEAM'] as const;
type AllowedPosition = (typeof ALLOWED_POSITIONS)[number];

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const DEVICE_TABLE = (import.meta.env.VITE_DEVICE_TABLE as string | undefined) ?? 'ob_devices';
const DEVICE_LOANS_TABLE = (import.meta.env.VITE_DEVICE_LOANS_TABLE as string | undefined) ?? 'ob_device_loans';
const EMPLOYEE_REQUESTS_TABLE = (import.meta.env.VITE_EMPLOYEE_REQUESTS_TABLE as string | undefined) ?? 'ob_employee_requests';
const USER_PROFILE_TABLE = (import.meta.env.VITE_USER_PROFILE_TABLE as string | undefined) ?? 'ob_user_profiles';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';
const TEMP_ACCOUNT_ASSIGNMENT_TABLE =
  (import.meta.env.VITE_TEMP_ACCOUNT_ASSIGNMENT_TABLE as string | undefined) ?? 'ob_temp_account_assignments';
const OBUP_REPORTS_TABLE = (import.meta.env.VITE_OBUP_REPORTS_TABLE as string | undefined) ?? 'reports';
const OBUP_REPORT_DETAILS_TABLE =
  (import.meta.env.VITE_OBUP_REPORT_DETAILS_TABLE as string | undefined) ?? 'report_details';
const OBUP_ACCOUNT_LINKS_TABLE = (import.meta.env.VITE_OBUP_ACCOUNT_LINKS_TABLE as string | undefined) ?? 'account_links';
const SCHEDULE_REST_NOTE = '__rest__';
const SCHEDULE_LEAVE_NOTE = '__leave__';
const SCHEDULE_TEMP_REST_NOTE = '__temp_rest__';
const SCHEDULE_PLANNED_LEAVE_NOTE = '__planned_leave__';
const SCHEDULE_PLANNED_TEMP_REST_NOTE = '__planned_temp_rest__';
const SCHEDULE_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');
const ROSTER_RESET_HOUR_RAW = Number(import.meta.env.VITE_ROSTER_RESET_HOUR ?? 0);
const ROSTER_RESET_HOUR = Number.isFinite(ROSTER_RESET_HOUR_RAW) ? Math.max(0, Math.min(23, ROSTER_RESET_HOUR_RAW)) : 5;
const ABSENT_RESET_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const ABSENT_RESET_HOUR = Number.isFinite(ABSENT_RESET_HOUR_RAW) ? Math.max(0, Math.min(23, ABSENT_RESET_HOUR_RAW)) : 5;
const ABSENT_ROSTER_CACHE_TTL_MS = 60 * 1000;
const ARRIVAL_METRICS_CACHE_TTL_MS = 60 * 1000;
const ARRIVAL_METRICS_STORAGE_KEY = 'obpunch_arrival_metrics_cache_v1';

const fetchAllPagedRows = async <T,>(
  fetchPage: (from: number, to: number) => Promise<{ data?: T[] | null; error?: { message?: string } | null }>,
  pageSize = 1000
) => {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const res = await fetchPage(from, to);
    if (res.error?.message) return { rows: [] as T[], error: res.error.message };
    const pageRows = Array.isArray(res.data) ? res.data : [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return { rows, error: null as string | null };
};

const supabase = createSupabaseClient({ persistSession: true });
const obupSupabase = createSupabaseClientWithCredentials({
  persistSession: false,
  url: import.meta.env.VITE_OBUP_SUPABASE_URL as string | undefined,
  anonKey: import.meta.env.VITE_OBUP_SUPABASE_ANON_KEY as string | undefined
});

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

const formatPunchDate = (value: Date) =>
  value.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

const formatPunchClock = (value: Date) =>
  value.toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

const formatPunchSummaryTime = (value: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getAmbientPeriod = (value: Date): AmbientPeriod => {
  const hour = value.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRestLikeScheduleNote = (note: unknown) => {
  const value = String(note ?? '').trim();
  return (
    value === SCHEDULE_REST_NOTE ||
    value === SCHEDULE_LEAVE_NOTE ||
    value === SCHEDULE_TEMP_REST_NOTE ||
    value === SCHEDULE_PLANNED_LEAVE_NOTE ||
    value === SCHEDULE_PLANNED_TEMP_REST_NOTE
  );
};

const toEpochMs = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
};
const normalizeDeviceSn = (value: unknown) => String(value ?? '').trim().toUpperCase();

// Deduplicate same-day schedule rows by staff, keeping the latest row.
const pickLatestScheduleRowsByStaff = <T extends { staff_id?: unknown; updated_at?: unknown; created_at?: unknown; id?: unknown }>(
  rows: T[]
) => {
  const byStaff = new Map<string, T>();
  for (const row of rows) {
    const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!staff) continue;
    const prev = byStaff.get(staff);
    if (!prev) {
      byStaff.set(staff, row);
      continue;
    }
    const prevMs = Math.max(toEpochMs(prev.updated_at), toEpochMs(prev.created_at));
    const curMs = Math.max(toEpochMs(row.updated_at), toEpochMs(row.created_at));
    if (curMs > prevMs) {
      byStaff.set(staff, row);
      continue;
    }
    if (curMs < prevMs) continue;
    const prevId = Number(prev.id ?? 0);
    const curId = Number(row.id ?? 0);
    if (Number.isFinite(curId) && Number.isFinite(prevId) && curId > prevId) {
      byStaff.set(staff, row);
    }
  }
  return Array.from(byStaff.values());
};

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

const createEmptyArrivalMetrics = (): ArrivalMetric[] =>
  ['early', 'late'].flatMap((shift) =>
    ALLOWED_POSITIONS.map((position) => ({
      shift: shift as 'early' | 'late',
      position,
      expected: 0,
      present: 0,
      onClock: 0,
      onClockStaff: [],
      restWorked: 0,
      restWorkedStaff: [],
      scheduledNotClockInStaff: []
    }))
  );

const cloneArrivalMetricsRows = (rows: ArrivalMetric[]): ArrivalMetric[] =>
  rows.map((row) => ({
    ...row,
    onClockStaff: [...row.onClockStaff],
    restWorkedStaff: [...row.restWorkedStaff],
    scheduledNotClockInStaff: [...row.scheduledNotClockInStaff]
  }));

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
  return '';
};

const hydrateArrivalMetricsRows = (value: unknown): ArrivalMetric[] => {
  const base = createEmptyArrivalMetrics();
  const rows = Array.isArray(value) ? value : [];
  const byKey = new Map<string, ArrivalMetric>();
  for (const raw of rows) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const shift = normalizeShiftValue(String(row.shift ?? ''));
    const position = normalizeAllowedPosition(String(row.position ?? ''));
    if (!shift || !position) continue;
    const toNum = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const toStrArray = (v: unknown) =>
      Array.isArray(v)
        ? v.map((item) => String(item ?? '').trim()).filter(Boolean)
        : [];
    byKey.set(`${shift}:${position}`, {
      shift,
      position,
      expected: toNum(row.expected),
      present: toNum(row.present),
      onClock: toNum(row.onClock),
      onClockStaff: toStrArray(row.onClockStaff),
      restWorked: toNum(row.restWorked),
      restWorkedStaff: toStrArray(row.restWorkedStaff),
      scheduledNotClockInStaff: toStrArray(row.scheduledNotClockInStaff)
    });
  }
  return base.map((item) => byKey.get(`${item.shift}:${item.position}`) ?? item);
};
const positionToUphStage = (value: string): 'picking' | 'packing' | 'sorting' | null => {
  const pos = normalizeAllowedPosition(value);
  if (pos === 'Pick') return 'picking';
  if (pos === 'Pack') return 'packing';
  if (pos === 'Rebin') return 'sorting';
  return null;
};
const normalizeWorkOperatorKey = (value: string) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  if (/^ob[a-z]*#?\d+/i.test(compact)) return compact.toLowerCase();
  const withoutParen = raw.replace(/\s*\([^)]*\)\s*$/g, '');
  const lowered = withoutParen.toLowerCase();
  const lettersOnly = lowered.replace(/[^a-z\u00c0-\u024f\u4e00-\u9fff]+/g, ' ');
  const noDigits = lettersOnly.replace(/\b\d+\b/g, ' ');
  return noDigits.replace(/\s+/g, ' ').trim();
};
const parseUph = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};
const splitNameTokens = (value: string) => normalizeWorkOperatorKey(value).split(' ').filter(Boolean);
const diceSimilarity = (aRaw: string, bRaw: string) => {
  const a = aRaw.replace(/\s+/g, '');
  const b = bRaw.replace(/\s+/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const bg = a.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const bg = b.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      overlap += 1;
      bigrams.set(bg, count - 1);
    }
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1);
};
const tokenSimilarity = (aRaw: string, bRaw: string) => {
  const aTokens = splitNameTokens(aRaw);
  const bTokens = splitNameTokens(bRaw);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let intersect = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersect += 1;
  }
  return (2 * intersect) / (aSet.size + bSet.size);
};
const fuzzyNameSimilarity = (aRaw: string, bRaw: string) => {
  const a = normalizeWorkOperatorKey(aRaw);
  const b = normalizeWorkOperatorKey(bRaw);
  if (!a || !b) return 0;
  return Math.max(diceSimilarity(a, b), tokenSimilarity(a, b));
};
const PUNCH_LOG_UPH_DAYS = 30;
const PUNCH_LOG_UPH_FUZZY_THRESHOLD = 0.7;
const PUNCH_LOG_UPH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const getShiftBucketByInAt = (inAtIso: string): '' | 'early' | 'late' => {
  const dt = new Date(inAtIso);
  if (Number.isNaN(dt.getTime())) return '';
  const minutes = dt.getHours() * 60 + dt.getMinutes();
  return minutes >= 5 * 60 && minutes < 15 * 60 ? 'early' : 'late';
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
  const [busyVisible, setBusyVisible] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const punchMenuRef = useRef<HTMLDivElement | null>(null);
  const deviceBorrowStaffRef = useRef<HTMLInputElement | null>(null);
  const deviceBorrowSnRef = useRef<HTMLInputElement | null>(null);
  const punchDeviceBorrowStaffRef = useRef<HTMLInputElement | null>(null);
  const deviceReturnSnRef = useRef<HTMLInputElement | null>(null);
  const statusToastTimerRef = useRef<number | null>(null);
  const punchBoardUphFetchSeqRef = useRef(0);
  const punchBoardUphCacheRef = useRef<{ at: number; key: string; map: Record<string, number | null> }>({
    at: 0,
    key: '',
    map: {}
  });
  const absentRosterCacheRef = useRef<{ at: number; key: string; rows: AbsentRosterItem[] }>({
    at: 0,
    key: '',
    rows: []
  });
  const arrivalMetricsCacheRef = useRef<{ at: number; key: string; rows: ArrivalMetric[] }>({
    at: 0,
    key: '',
    rows: []
  });

  type EmployeeColumnMode = 'lower' | 'cased';
  const employeeColumnModeRef = useRef<EmployeeColumnMode | null>(null);

  const [page, setPage] = useState<Page>('punch');
  const PUNCH_UNLOCKED_KEY = 'punch_screen_unlocked';
  const [punchUnlocked, setPunchUnlocked] = useState(() => {
    try {
      return localStorage.getItem(PUNCH_UNLOCKED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [unlockEmail, setUnlockEmail] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const PUNCH_UNLOCKED_LABEL_KEY = 'punch_screen_unlocked_by';
  const PUNCH_UNLOCKED_AVATAR_KEY = 'punch_screen_unlocked_avatar';
  const [unlockByLabel, setUnlockByLabel] = useState(() => {
    try {
      return localStorage.getItem(PUNCH_UNLOCKED_LABEL_KEY) || '';
    } catch {
      return '';
    }
  });
  const [punchUserAvatarUrl, setPunchUserAvatarUrl] = useState(() => {
    try {
      return localStorage.getItem(PUNCH_UNLOCKED_AVATAR_KEY) || '';
    } catch {
      return '';
    }
  });
  const [unlockStatus, setUnlockStatus] = useState<UnlockStatus>({
    tone: 'idle',
    message: ''
  });
  const [punchMenuOpen, setPunchMenuOpen] = useState(false);

  const [staffId, setStaffId] = useState('');
  const normalizedId = useMemo(() => normalizeStaffId(staffId), [staffId]);
  const isValidId = useMemo(() => isValidPunchStaffId(normalizedId), [normalizedId]);

  const defaultUiStatusMessage = 'Enter US ID to start punch';
  const [uiStatus, setUiStatus] = useState<Status>({ tone: 'idle', message: defaultUiStatusMessage });
  const [statusToast, setStatusToast] = useState<Status | null>(null);
  const unlockEmailRef = useRef<HTMLInputElement | null>(null);
  const unlockPasswordRef = useRef<HTMLInputElement | null>(null);
  const preservePunchUnlockOnNextSignOutRef = useRef(false);

  useEffect(() => {
    appSound.preload();
    return () => appSound.reset();
  }, []);

  const unlockAudio = () => appSound.unlock();

  useEffect(() => {
    return appSound.attachUserGestureUnlock(window);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      appSound.refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const playSound = (kind: AppSoundKind) => {
    void appSound.play(kind);
  };

  const playSuccess = (action: PunchAction) =>
    playSound(action === 'OUT' ? 'successOut' : 'successIn');
  const playError = () => playSound('error');

  const [offsetMs, setOffsetMs] = useState(0);
  const [serverTime, setServerTime] = useState(() => new Date());
  const barcodePromptGroupKey = getBarcodePromptGroupKey(serverTime);
  const barcodePrompts = useMemo(() => getBarcodePrompts(barcodePromptGroupKey), [barcodePromptGroupKey]);
  const [barcodePromptIndex, setBarcodePromptIndex] = useState(() =>
    getRandomBarcodePromptIndex(getBarcodePromptGroupKey(new Date()))
  );
  const barcodePrompt = barcodePrompts[barcodePromptIndex % barcodePrompts.length] ?? 'Scan your barcode';

  const [punches, setPunches] = useState<Record<string, unknown>[]>([]);
  const [punchesError, setPunchesError] = useState<string | null>(null);

  const [employee, setEmployee] = useState<Record<string, unknown> | null>(null);
  const [employeeError, setEmployeeError] = useState<string | null>(null);

  const [punchBoard, setPunchBoard] = useState<PunchBoardRow[]>([]);
  const [, setPunchBoardError] = useState<string | null>(null);
  const [punchBoardEmployeeMap, setPunchBoardEmployeeMap] = useState<
    Record<string, { name: string; agency: string; position: string; label: string }>
  >({});
  const [, setPunchBoardDeviceStatusByStaffId] = useState<Record<string, PunchBoardDeviceStatus>>({});
  const [, setPunchBoardUphByStaffId] = useState<Record<string, number | null>>({});
  const [dailyRoster, setDailyRoster] = useState<DailyRosterItem[]>([]);
  const [, setDailyRosterError] = useState<string | null>(null);
  const [, setRosterShiftByStaffId] = useState<Record<string, '' | 'early' | 'late'>>({});
  const [, setAbsentRoster] = useState<AbsentRosterItem[]>([]);
  const [, setArrivalMetrics] = useState<ArrivalMetric[]>(() => {
    const fallback = createEmptyArrivalMetrics();
    try {
      const raw = localStorage.getItem(ARRIVAL_METRICS_STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as { key?: unknown; rows?: unknown } | null;
      const key = String(parsed?.key ?? '').trim();
      const now = new Date();
      const todayDayIndex = getDayIndexByCutoff(now, ABSENT_RESET_HOUR);
      const templateDate = getTemplateDateByDayIndex(todayDayIndex);
      if (!key || key !== templateDate) return fallback;
      return hydrateArrivalMetricsRows(parsed?.rows);
    } catch {
      return fallback;
    }
  });
  const [lastPunchAction, setLastPunchAction] = useState<PunchAction | null>(null);
  const [lastPunchActionError, setLastPunchActionError] = useState<string | null>(null);
  const [lastPunchSummary, setLastPunchSummary] = useState<PunchDisplaySummary | null>(null);
  const [punchSuccessAnimation, setPunchSuccessAnimation] = useState<PunchSuccessAnimation | null>(null);
  const [deviceReturnReminder, setDeviceReturnReminder] = useState<{
    staffId: string;
    staffName: string;
    items: DeviceOutstandingItem[];
  } | null>(null);
  const [deviceBorrowStaffId, setDeviceBorrowStaffId] = useState('');
  const [deviceBorrowSn, setDeviceBorrowSn] = useState('');
  const [deviceBorrowPrompt, setDeviceBorrowPrompt] = useState<{ sn: string; name: string } | null>(null);
  const [deviceReturnSn, setDeviceReturnSn] = useState('');
  const [deviceQuickBusy, setDeviceQuickBusy] = useState<'' | 'borrow' | 'return'>('');
  const [, setDeviceQuickError] = useState<string | null>(null);
  const [, setDeviceQuickLogs] = useState<DeviceQuickLogRow[]>([]);
  const [, setDeviceQuickNameByStaffId] = useState<Record<string, string>>({});
  const [, setDeviceQuickNameBySn] = useState<Record<string, string>>({});
  const [deviceActionFeedback, setDeviceActionFeedback] = useState<DeviceActionFeedback | null>(null);
  useEffect(() => {
    if (!deviceReturnReminder) return;
    const timer = window.setTimeout(() => {
      setDeviceReturnReminder(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [deviceReturnReminder]);

  useEffect(() => {
    if (!punchSuccessAnimation) return;
    const timer = window.setTimeout(() => {
      setPunchSuccessAnimation(null);
    }, 1700);
    return () => window.clearTimeout(timer);
  }, [punchSuccessAnimation]);

  useEffect(() => {
    if (lastPunchSummary?.status !== 'error') return;
    const errorMessage = lastPunchSummary.message;
    const timer = window.setTimeout(() => {
      setLastPunchSummary((current) =>
        current?.status === 'error' && current.message === errorMessage ? null : current
      );
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [lastPunchSummary]);

  const rosterStaffIds = useMemo(
    () => Array.from(new Set(dailyRoster.map((row) => normalizeStaffId(row.staff_id)).filter(Boolean))),
    [dailyRoster]
  );
  const [lastPunchActionLoading, setLastPunchActionLoading] = useState(false);

  const [editName, setEditName] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNote, setEditNote] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ARRIVAL_METRICS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { at?: unknown; key?: unknown; rows?: unknown } | null;
      const key = String(parsed?.key ?? '').trim();
      const now = new Date();
      const todayDayIndex = getDayIndexByCutoff(now, ABSENT_RESET_HOUR);
      const templateDate = getTemplateDateByDayIndex(todayDayIndex);
      if (!key || key !== templateDate) return;
      const rows = hydrateArrivalMetricsRows(parsed?.rows);
      arrivalMetricsCacheRef.current = {
        at: Number(parsed?.at) || Date.now(),
        key: templateDate,
        rows: cloneArrivalMetricsRows(rows)
      };
    } catch {
      // ignore local cache read failures
    }
  }, []);

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

  const clearPunchInputAfterError = () => {
    setStaffId('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const loadPunchAvatarByEmail = async (emailRaw: string) => {
    if (!supabase) return '';
    const email = String(emailRaw ?? '').trim();
    if (!email) return '';

    const res = await supabase
      .from(USER_PROFILE_TABLE)
      .select('avatar_url')
      .eq('user_email', email)
      .maybeSingle();

    if (res.error) return '';
    return String((res.data as { avatar_url?: unknown } | null)?.avatar_url ?? '').trim();
  };

  useEffect(() => {
    if (!supabase || !unlockByLabel) {
      try {
        setPunchUserAvatarUrl(localStorage.getItem(PUNCH_UNLOCKED_AVATAR_KEY) || '');
      } catch {
        setPunchUserAvatarUrl('');
      }
      return;
    }

    let active = true;
    const loadPunchUserAvatar = async () => {
      const email = String(unlockByLabel).trim();
      if (!email) {
        if (active) setPunchUserAvatarUrl('');
        return;
      }

      const avatarUrl = await loadPunchAvatarByEmail(email);
      if (!active) return;
      if (avatarUrl) {
        setPunchUserAvatarUrl(avatarUrl);
        try { localStorage.setItem(PUNCH_UNLOCKED_AVATAR_KEY, avatarUrl); } catch {}
      }
    };

    void loadPunchUserAvatar();
    return () => {
      active = false;
    };
  }, [unlockByLabel]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (punchUnlocked) {
      inputRef.current?.focus();
      return;
    }
    unlockEmailRef.current?.focus();
  }, [punchUnlocked]);

  useEffect(() => {
    if (!isLocked) {
      inputRef.current?.focus();
    }
  }, [isLocked, page]);

  useEffect(() => {
    if (!punchMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (punchMenuRef.current?.contains(target)) return;
      setPunchMenuOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPunchMenuOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [punchMenuOpen]);

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

  useEffect(() => {
    const tick = () => {
      setServerTime(new Date(Date.now() + offsetMs));
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [offsetMs]);

  useEffect(() => {
    setBarcodePromptIndex(getRandomBarcodePromptIndex(barcodePromptGroupKey));
  }, [barcodePromptGroupKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBarcodePromptIndex(getRandomBarcodePromptIndex(barcodePromptGroupKey));
    }, 90 * 1000);
    return () => window.clearInterval(timer);
  }, [barcodePromptGroupKey]);

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

  const isMissingTempAssignmentSchemaError = (message: string) => {
    const text = String(message ?? '').toLowerCase();
    return (
      (text.includes(TEMP_ACCOUNT_ASSIGNMENT_TABLE.toLowerCase()) || text.includes('source_temp_staff_id')) &&
      (text.includes('schema cache') || text.includes('does not exist'))
    );
  };

  const resolvePunchStaffId = async (staff: string) => {
    if (!supabase) {
      return { staffId: staff, error: 'Missing Supabase configuration.' };
    }

    let current = normalizeStaffId(String(staff ?? '').trim());
    const visited = new Set<string>();
    for (let depth = 0; depth < 6; depth += 1) {
      if (!current || visited.has(current)) break;
      visited.add(current);

      const res = await supabase
        .from(TEMP_ACCOUNT_ASSIGNMENT_TABLE)
        .select('staff_id, source_temp_staff_id, created_at')
        .eq('source_temp_staff_id', current)
        .order('created_at', { ascending: false })
        .limit(1);
      if (res.error) {
        if (isMissingTempAssignmentSchemaError(res.error.message)) break;
        return { staffId: current, error: res.error.message };
      }

      const next = normalizeStaffId(String(((res.data as any[] | null) ?? [])[0]?.staff_id ?? '').trim());
      if (!next || next === current) break;
      current = next;
    }

    return { staffId: current || staff, error: null as string | null };
  };

  const checkEmployeeRegistered = async (staff: string) => {
    if (!supabase) {
      return { staffId: staff, registered: false, scheduleOnly: false, terminated: false, error: 'Missing Supabase configuration.' };
    }

    const resolved = await resolvePunchStaffId(staff);
    if (resolved.error) {
      return { staffId: resolved.staffId, registered: false, scheduleOnly: false, terminated: false, error: resolved.error };
    }

    const mapRes = await fetchEmployeeMap([resolved.staffId]);
    if (mapRes.error) {
      return { staffId: resolved.staffId, registered: false, scheduleOnly: false, terminated: false, error: mapRes.error };
    }

    const employee = mapRes.map[resolved.staffId];
    return {
      staffId: resolved.staffId,
      registered: Boolean(employee),
      scheduleOnly: isScheduleOnlyAgency(String(employee?.agency ?? '').trim()),
      terminated: isEmployeeTerminated({ terminatedAt: employee?.terminatedAt }, { referenceAt: new Date(), allowTerminationDate: true }),
      error: null as string | null
    };
  };

  const fetchOutstandingDevicesByStaff = async (staff: string) => {
    if (!supabase) {
      return { items: [] as DeviceOutstandingItem[], error: 'Missing Supabase configuration.' };
    }

    const loanRes = await supabase
      .from(DEVICE_LOANS_TABLE)
      .select('id, created_at, action, device_sn')
      .eq('staff_id', staff)
      .order('created_at', { ascending: true })
      .limit(5000);
    if (loanRes.error) {
      return { items: [] as DeviceOutstandingItem[], error: loanRes.error.message };
    }

    const rows = ((loanRes.data as any[]) ?? []) as DeviceLoanEventRow[];
    const borrowedBySn = new Map<string, { borrowedAt: string }>();
    for (const row of rows) {
      const sn = String(row.device_sn ?? '').trim().toUpperCase();
      if (!sn) continue;
      const action = String(row.action ?? '').trim().toLowerCase();
      if (action === 'borrow') {
        borrowedBySn.set(sn, { borrowedAt: String(row.created_at ?? '') });
      } else if (action === 'return') {
        borrowedBySn.delete(sn);
      }
    }
    if (borrowedBySn.size === 0) {
      return { items: [] as DeviceOutstandingItem[], error: null as string | null };
    }

    const sns = Array.from(borrowedBySn.keys());
    const deviceRes = await supabase
      .from(DEVICE_TABLE)
      .select('device_sn, device_name, device_type, position')
      .in('device_sn', sns);
    if (deviceRes.error) {
      return {
        items: sns.map((sn) => ({
          deviceSn: sn,
          deviceName: sn,
          deviceType: '',
          position: '',
          borrowedAt: borrowedBySn.get(sn)?.borrowedAt ?? ''
        })),
        error: null as string | null
      };
    }

    const catalog = new Map<string, DeviceCatalogRow>();
    for (const row of (((deviceRes.data as any[]) ?? []) as DeviceCatalogRow[])) {
      const sn = String(row.device_sn ?? '').trim().toUpperCase();
      if (!sn) continue;
      catalog.set(sn, row);
    }
    const items = sns
      .map((sn) => {
        const detail = catalog.get(sn);
        const deviceName = String(detail?.device_name ?? '').trim() || sn;
        return {
          deviceSn: sn,
          deviceName,
          deviceType: String(detail?.device_type ?? '').trim(),
          position: String(detail?.position ?? '').trim(),
          borrowedAt: borrowedBySn.get(sn)?.borrowedAt ?? ''
        };
      })
      .sort((a, b) => a.deviceName.localeCompare(b.deviceName, 'en-US', { numeric: true, sensitivity: 'base' }));
    return { items, error: null as string | null };
  };

  const fetchTodayOutCount = async (staff: string) => {
    if (!supabase) {
      return { count: 0, error: 'Missing Supabase configuration.' };
    }
    const dayStartDate = getOperationalDayStart(new Date(), ABSENT_RESET_HOUR);
    const dayStart = dayStartDate.toISOString();
    const dayEnd = addDays(dayStartDate, 1).toISOString();
    const countRes = await supabase
      .from('ob_punches')
      .select('id', { count: 'exact', head: true })
      .eq('staff_id', staff)
      .eq('action', 'OUT')
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd);
    if (countRes.error) {
      return { count: 0, error: countRes.error.message };
    }
    return { count: countRes.count ?? 0, error: null as string | null };
  };

  const fetchPunchBoardDeviceStatus = async (staffIds: string[]) => {
    if (!supabase) {
      setPunchBoardDeviceStatusByStaffId({});
      return;
    }

    const normalizedStaffIds = Array.from(new Set(staffIds.map((id) => normalizeStaffId(id)).filter(Boolean)));
    if (normalizedStaffIds.length === 0) {
      setPunchBoardDeviceStatusByStaffId({});
      return;
    }

    const baseLoans = () =>
      supabase
        .from(DEVICE_LOANS_TABLE)
        .select('id, staff_id, action, device_sn, created_at')
        .limit(20000);
    const loansOrdered = await baseLoans().order('created_at', { ascending: false });
    const loansRes = loansOrdered.error ? await baseLoans().order('id', { ascending: false }) : loansOrdered;
    if (loansRes.error) {
      setPunchBoardDeviceStatusByStaffId({});
      return;
    }

    const borrowedBySn = new Map<string, { staffId: string; borrowedAt: string }>();
    const resolvedSn = new Set<string>();
    for (const row of ((loansRes.data as any[] | null) ?? [])) {
      const sn = normalizeDeviceSn(row.device_sn);
      if (!sn) continue;
      if (resolvedSn.has(sn)) continue;
      const action = String(row.action ?? '').trim().toLowerCase();
      if (action === 'borrow') {
        const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (!staffId) {
          resolvedSn.add(sn);
          continue;
        }
        borrowedBySn.set(sn, { staffId, borrowedAt: String(row.created_at ?? '') });
        resolvedSn.add(sn);
      } else if (action === 'return') {
        resolvedSn.add(sn);
      }
    }

    const sns = Array.from(borrowedBySn.keys());
    const nameBySn: Record<string, string> = {};
    if (sns.length > 0) {
      for (const batch of chunk(sns, 200)) {
        const deviceRes = await supabase.from(DEVICE_TABLE).select('device_sn, device_name').in('device_sn', batch);
        if (deviceRes.error) continue;
        for (const row of ((deviceRes.data as any[] | null) ?? [])) {
          const sn = normalizeDeviceSn(row.device_sn);
          if (!sn) continue;
          nameBySn[sn] = String(row.device_name ?? '').trim() || sn;
        }
      }
    }

    const byStaff = new Map<string, Array<{ name: string; borrowedAt: string }>>();
    for (const [sn, info] of borrowedBySn.entries()) {
      const list = byStaff.get(info.staffId) ?? [];
      list.push({ name: nameBySn[sn] || sn, borrowedAt: info.borrowedAt });
      byStaff.set(info.staffId, list);
    }

    const nowMs = Date.now();
    const overdueMs = 8 * 60 * 60 * 1000;
    const next: Record<string, PunchBoardDeviceStatus> = {};
    for (const staffId of normalizedStaffIds) {
      const items = byStaff.get(staffId) ?? [];
      if (items.length === 0) {
        next[staffId] = { text: 'No borrowed device', tone: 'none' };
        continue;
      }
      const hasOverdue = items.some((item) => {
        const borrowedAtMs = Date.parse(String(item.borrowedAt ?? ''));
        if (!Number.isFinite(borrowedAtMs) || borrowedAtMs <= 0) return false;
        return nowMs - borrowedAtMs >= overdueMs;
      });
      const names = items
        .map((item) => item.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base', numeric: true }));
      const text = names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0] || 'Borrowed';
      next[staffId] = { text, tone: hasOverdue ? 'overdue' : 'borrowed' };
    }
    setPunchBoardDeviceStatusByStaffId(next);
  };

  const fetchDeviceQuickLogs = async () => {
    if (!supabase) {
      setDeviceQuickError('Missing Supabase configuration.');
      setDeviceQuickLogs([]);
      return;
    }

    setDeviceQuickError(null);
    const base = () => supabase.from(DEVICE_LOANS_TABLE).select('id, created_at, staff_id, action, device_sn').limit(80);
    const ordered = await base().order('created_at', { ascending: false });
    const attempt = ordered.error ? await base().order('id', { ascending: false }) : ordered;
    if (attempt.error) {
      setDeviceQuickError(attempt.error.message);
      setDeviceQuickLogs([]);
      return;
    }

    const rows = ((attempt.data as any[] | null) ?? [])
      .map((row) => {
        const actionRaw = String(row.action ?? '').trim().toLowerCase();
        if (actionRaw !== 'borrow' && actionRaw !== 'return') return null;
        return {
          id: (row.id as number | string | null | undefined) ?? `${String(row.staff_id ?? '')}-${String(row.created_at ?? '')}`,
          created_at: String(row.created_at ?? '').trim() || null,
          staff_id: normalizeStaffId(String(row.staff_id ?? '').trim()),
          action: actionRaw as 'borrow' | 'return',
          device_sn: normalizeDeviceSn(row.device_sn)
        } as DeviceQuickLogRow;
      })
      .filter(Boolean) as DeviceQuickLogRow[];
    setDeviceQuickLogs(rows);

    const staffIds = Array.from(new Set(rows.map((row) => normalizeStaffId(row.staff_id)).filter(Boolean)));
    if (staffIds.length > 0) {
      const mapRes = await fetchEmployeeMap(staffIds);
      if (!mapRes.error) {
        setDeviceQuickNameByStaffId((prev) => {
          const next = { ...prev };
          for (const id of staffIds) {
            const name = String(mapRes.map[id]?.name ?? '').trim();
            if (name) next[id] = name;
          }
          return next;
        });
      }
    }

    const sns = Array.from(new Set(rows.map((row) => normalizeDeviceSn(row.device_sn)).filter(Boolean)));
    if (sns.length > 0) {
      for (const batch of chunk(sns, 200)) {
        const deviceRes = await supabase.from(DEVICE_TABLE).select('device_sn, device_name').in('device_sn', batch);
        if (deviceRes.error) continue;
        setDeviceQuickNameBySn((prev) => {
          const next = { ...prev };
          for (const row of ((deviceRes.data as any[] | null) ?? [])) {
            const sn = normalizeDeviceSn(row.device_sn);
            if (!sn) continue;
            next[sn] = String(row.device_name ?? '').trim() || sn;
          }
          return next;
        });
      }
    }
  };

  const resolveBorrowerBySn = async (snRaw: string) => {
    if (!supabase) return { staffId: '', error: 'Missing Supabase configuration.' };
    const sn = normalizeDeviceSn(snRaw);
    if (!sn) return { staffId: '', error: 'Device SN is required.' };
    const base = () =>
      supabase
        .from(DEVICE_LOANS_TABLE)
        .select('staff_id, action, created_at')
        .eq('device_sn', sn)
        .limit(5000);
    const ordered = await base().order('created_at', { ascending: true });
    const attempt = ordered.error ? await base().order('id', { ascending: true }) : ordered;
    if (attempt.error) return { staffId: '', error: attempt.error.message };
    let currentStaff = '';
    for (const row of ((attempt.data as any[] | null) ?? [])) {
      const action = String(row.action ?? '').trim().toLowerCase();
      if (action === 'borrow') {
        currentStaff = normalizeStaffId(String(row.staff_id ?? '').trim());
      } else if (action === 'return') {
        currentStaff = '';
      }
    }
    if (!currentStaff) return { staffId: '', error: 'No active borrowed record for this SN.' };
    return { staffId: currentStaff, error: null as string | null };
  };

  const resolveDeviceDisplayName = async (snRaw: string) => {
    if (!supabase) return normalizeDeviceSn(snRaw) || String(snRaw ?? '').trim();
    const sn = normalizeDeviceSn(snRaw);
    if (!sn) return String(snRaw ?? '').trim();
    const deviceRes = await supabase
      .from(DEVICE_TABLE)
      .select('device_name')
      .eq('device_sn', sn)
      .maybeSingle();
    if (deviceRes.error) return sn;
    const name = String((deviceRes.data as { device_name?: unknown } | null)?.device_name ?? '').trim();
    return name || sn;
  };

  const lookupDeviceBySn = async (snRaw: string): Promise<{ device: DeviceLookupResult; error: string | null }> => {
    if (!supabase) {
      return { device: { exists: false, active: false, deviceName: '' }, error: 'Missing Supabase configuration.' };
    }
    const sn = normalizeDeviceSn(snRaw);
    if (!sn) {
      return { device: { exists: false, active: false, deviceName: '' }, error: null };
    }
    const deviceRes = await supabase
      .from(DEVICE_TABLE)
      .select('device_name, active')
      .eq('device_sn', sn)
      .maybeSingle();
    if (deviceRes.error) {
      return { device: { exists: false, active: false, deviceName: '' }, error: deviceRes.error.message };
    }
    if (!deviceRes.data) {
      return { device: { exists: false, active: false, deviceName: '' }, error: null };
    }
    const row = deviceRes.data as { device_name?: unknown; active?: unknown };
    return {
      device: {
        exists: true,
        active: row.active !== false,
        deviceName: String(row.device_name ?? '').trim() || sn
      },
      error: null
    };
  };

  const submitDeviceQuickAction = async (mode: 'borrow' | 'return') => {
    const actionName = mode === 'borrow' ? 'Borrow' : 'Return';
    const reportDeviceFailure = (message: string) => {
      setDeviceQuickError(message);
      setDeviceActionFeedback({
        id: Date.now(),
        at: new Date().toISOString(),
        mode,
        status: 'error',
        title: `${actionName} failed`,
        detail: message
      });
      setUiStatus({ tone: 'error', message });
      if (mode === 'borrow') {
        setDeviceBorrowStaffId('');
        if (!deviceBorrowPrompt) setDeviceBorrowSn('');
        window.setTimeout(() => {
          const target = deviceBorrowPrompt ? punchDeviceBorrowStaffRef.current : deviceBorrowStaffRef.current;
          target?.focus();
          target?.select();
        }, 0);
      } else {
        setDeviceReturnSn('');
        window.setTimeout(() => deviceReturnSnRef.current?.focus(), 0);
      }
      playError();
    };

    if (!supabase) {
      reportDeviceFailure('Missing Supabase configuration.');
      return;
    }
    if (deviceQuickBusy) return;

    await unlockAudio();
    setDeviceQuickError(null);
    let staffId = '';
    const sn = normalizeDeviceSn(mode === 'borrow' ? deviceBorrowSn : deviceReturnSn);
    if (!sn) {
      reportDeviceFailure('Device SN is required.');
      return;
    }
    const deviceLookup = await lookupDeviceBySn(sn);
    if (deviceLookup.error) {
      reportDeviceFailure(deviceLookup.error);
      return;
    }
    if (!deviceLookup.device.exists) {
      reportDeviceFailure(`Device not found: ${sn}`);
      return;
    }
    if (!deviceLookup.device.active) {
      reportDeviceFailure(`Device disabled: ${sn}`);
      return;
    }
    if (mode === 'borrow') {
      const currentHolder = await resolveBorrowerBySn(sn);
      if (!currentHolder.error) {
        const holderName = await resolveStaffDisplayName(currentHolder.staffId);
        reportDeviceFailure(`Already borrowed: ${sn} (${holderName || currentHolder.staffId})`);
        return;
      }
      if (!/no active borrowed record/i.test(currentHolder.error)) {
        reportDeviceFailure(currentHolder.error);
        return;
      }
      staffId = normalizeStaffId(deviceBorrowStaffId);
      if (!isValidPunchStaffId(staffId)) {
        reportDeviceFailure('Invalid staff ID.');
        return;
      }
      const lastPunch = await fetchLastPunch(staffId);
      if (lastPunch.error) {
        reportDeviceFailure(lastPunch.error);
        return;
      }
      if (lastPunch.action !== 'IN') {
        reportDeviceFailure('Employee must be signed in before borrowing a device.');
        return;
      }
    } else {
      const holder = await resolveBorrowerBySn(sn);
      if (holder.error) {
        reportDeviceFailure(holder.error);
        return;
      }
      staffId = holder.staffId;
    }

    setDeviceQuickBusy(mode);
    const insertRes = await supabase.from(DEVICE_LOANS_TABLE).insert([
      {
        staff_id: staffId,
        action: mode,
        device_sn: sn
      }
    ]);
    setDeviceQuickBusy('');
    if (insertRes.error) {
      reportDeviceFailure(insertRes.error.message);
      return;
    }

    if (mode === 'borrow') {
      setDeviceBorrowStaffId('');
      setDeviceBorrowSn('');
      setDeviceBorrowPrompt(null);
      if (deviceBorrowPrompt) {
        inputRef.current?.focus();
      } else {
        deviceBorrowStaffRef.current?.focus();
      }
      playSound('successIn');
    } else {
      setDeviceReturnSn('');
      deviceReturnSnRef.current?.focus();
      playSound('successOut');
    }
    setUiStatus({
      tone: 'success',
      message: mode === 'borrow' ? `Borrowed · ${staffId} · ${sn}` : `Returned · ${sn}`
    });
    const [staffName, deviceName] = await Promise.all([
      resolveStaffDisplayName(staffId),
      resolveDeviceDisplayName(sn)
    ]);
    setDeviceActionFeedback({
      id: Date.now(),
      at: new Date().toISOString(),
      mode,
      status: 'success',
      title: `${actionName} success`,
      detail: `${staffName} · ${deviceName}`
    });
    void fetchDeviceQuickLogs();
    void fetchPunchBoardDeviceStatus(punchBoard.map((row) => row.staff_id));
  };

  const submitDeviceReturnFromPunchInput = async (snRaw: string) => {
    if (isLocked || deviceQuickBusy) {
      return true;
    }
    const sn = normalizeDeviceSn(snRaw);
    if (!sn || !supabase) {
      return false;
    }
    const client = supabase;

    const holder = await resolveBorrowerBySn(sn);
    if (holder.error) {
      if (/no active borrowed record/i.test(holder.error)) {
        const deviceLookup = await lookupDeviceBySn(sn);
        if (deviceLookup.error) {
          setUiStatus({ tone: 'error', message: deviceLookup.error });
          setLastPunchSummary({ status: 'error', message: deviceLookup.error, at: new Date().toISOString() });
          playError();
          clearPunchInputAfterError();
          return true;
        }
        if (!deviceLookup.device.exists) {
          return false;
        }
        if (!deviceLookup.device.active) {
          const message = `Device disabled: ${sn}`;
          setUiStatus({ tone: 'error', message });
          setLastPunchSummary({ status: 'error', message, at: new Date().toISOString() });
          playError();
          clearPunchInputAfterError();
          return true;
        }
        setDeviceQuickError(null);
        setDeviceBorrowSn(sn);
        setDeviceBorrowStaffId('');
        setDeviceBorrowPrompt({ sn, name: deviceLookup.device.deviceName });
        setStaffId('');
        setUiStatus({ tone: 'pending', message: `Borrow device · ${sn}` });
        window.setTimeout(() => {
          punchDeviceBorrowStaffRef.current?.focus();
          punchDeviceBorrowStaffRef.current?.select();
        }, 0);
        return true;
      }
      setUiStatus({ tone: 'error', message: holder.error });
      setLastPunchSummary({ status: 'error', message: holder.error, at: new Date().toISOString() });
      playError();
      clearPunchInputAfterError();
      return true;
    }

    await unlockAudio();
    setDeviceQuickError(null);
    setDeviceQuickBusy('return');
    try {
      await runLocked('device_return', async () => {
        const insertRes = await client.from(DEVICE_LOANS_TABLE).insert([
          {
            staff_id: holder.staffId,
            action: 'return',
            device_sn: sn
          }
        ]);

        if (insertRes.error) {
          const message = insertRes.error.message;
          setDeviceQuickError(message);
          setDeviceActionFeedback({
            id: Date.now(),
            at: new Date().toISOString(),
            mode: 'return',
            status: 'error',
            title: 'Return failed',
            detail: message
          });
          setUiStatus({ tone: 'error', message });
          setLastPunchSummary({ status: 'error', message, at: new Date().toISOString() });
          playError();
          clearPunchInputAfterError();
          return;
        }

        setStaffId('');
        window.setTimeout(() => inputRef.current?.focus(), 0);
        playSound('successOut');
        setUiStatus({ tone: 'success', message: `Returned · ${sn}` });
        const [staffName, deviceName] = await Promise.all([
          resolveStaffDisplayName(holder.staffId),
          resolveDeviceDisplayName(sn)
        ]);
        setDeviceActionFeedback({
          id: Date.now(),
          at: new Date().toISOString(),
          mode: 'return',
          status: 'success',
          title: 'Return success',
          detail: `${staffName} · ${deviceName}`
        });
        void fetchDeviceQuickLogs();
        void fetchPunchBoardDeviceStatus(punchBoard.map((row) => row.staff_id));
      });
    } finally {
      setDeviceQuickBusy('');
    }
    return true;
  };

  const doUnlockPunchScreen = async () => {
    if (!supabase) {
      setUnlockStatus({ tone: 'error', message: '缺少 Supabase 配置，请检查环境变量。' });
      return;
    }
    const email = String(unlockEmail ?? '').trim();
    if (!email || !unlockPassword) {
      setUnlockStatus({ tone: 'error', message: 'Please enter admin email and password.' });
      return;
    }

    setUnlockBusy(true);
    setUnlockStatus({ tone: 'pending', message: 'Verifying admin permissions...' });
    try {
      const signInRes = await supabase.auth.signInWithPassword({ email, password: unlockPassword });
      if (signInRes.error) {
        setUnlockStatus({ tone: 'error', message: `登录失败：${signInRes.error.message}` });
        return;
      }

      const rejectAndSignOut = async (message: string) => {
        setUnlockStatus({ tone: 'error', message });
        await supabase.auth.signOut();
      };

      const accessRes = await supabase.rpc('get_admin_access_context');
      if (accessRes.error) {
        await rejectAndSignOut(`权限读取失败：${accessRes.error.message}`);
        return;
      }

      const context = normalizeAdminAccessContext(accessRes.data, email);
      if (!context.is_active) {
        await rejectAndSignOut('Account was locked');
        return;
      }
      if (!canUnlockPunchScreen(context)) {
        await rejectAndSignOut('Access denied');
        return;
      }

      const display = String(signInRes.data.user?.email ?? email).trim();
      const userMetadata = (signInRes.data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const metadataAvatarUrl = String(userMetadata.avatar_url ?? userMetadata.picture ?? '').trim();
      const avatarUrl = (await loadPunchAvatarByEmail(display)) || metadataAvatarUrl;
      setPunchUnlocked(true);
      try { localStorage.setItem(PUNCH_UNLOCKED_KEY, '1'); } catch {}
      setUnlockByLabel(display);
      try { localStorage.setItem(PUNCH_UNLOCKED_LABEL_KEY, display); } catch {}
      setPunchUserAvatarUrl(avatarUrl);
      try {
        if (avatarUrl) {
          localStorage.setItem(PUNCH_UNLOCKED_AVATAR_KEY, avatarUrl);
        } else {
          localStorage.removeItem(PUNCH_UNLOCKED_AVATAR_KEY);
        }
      } catch {}
      setUnlockPassword('');
      preservePunchUnlockOnNextSignOutRef.current = true;
      const signOutRes = await supabase.auth.signOut();
      if (signOutRes.error) {
        preservePunchUnlockOnNextSignOutRef.current = false;
        setPunchUnlocked(false);
        try { localStorage.removeItem(PUNCH_UNLOCKED_KEY); } catch {}
        setUnlockByLabel('');
        setPunchUserAvatarUrl('');
        try { localStorage.removeItem(PUNCH_UNLOCKED_LABEL_KEY); } catch {}
        try { localStorage.removeItem(PUNCH_UNLOCKED_AVATAR_KEY); } catch {}
        setUnlockStatus({ tone: 'error', message: `解锁成功但退出管理员会话失败：${signOutRes.error.message}` });
        return;
      }
      setUnlockStatus({ tone: 'success', message: `Unlocked by admin: ${display}. Admin login is required to enter admin page.` });
      setUiStatus({ tone: 'idle', message: defaultUiStatusMessage });
    } catch (error) {
      setUnlockStatus({
        tone: 'error',
        message: error instanceof Error ? `登录失败：${error.message}` : '登录失败，请重试。'
      });
      await supabase.auth.signOut();
    } finally {
      setUnlockBusy(false);
    }
  };

  const logoutPunchScreen = async () => {
    preservePunchUnlockOnNextSignOutRef.current = false;
    if (supabase) {
      await supabase.auth.signOut();
    }
    setPunchUnlocked(false);
    try { localStorage.removeItem(PUNCH_UNLOCKED_KEY); } catch {}
    setUnlockEmail('');
    setUnlockPassword('');
    setUnlockByLabel('');
    setPunchUserAvatarUrl('');
    try { localStorage.removeItem(PUNCH_UNLOCKED_LABEL_KEY); } catch {}
    try { localStorage.removeItem(PUNCH_UNLOCKED_AVATAR_KEY); } catch {}
    setUnlockStatus({ tone: 'idle', message: '' });
    setStaffId('');
    setPage('punch');
    setUiStatus({ tone: 'idle', message: defaultUiStatusMessage });
  };

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const restoreUnlockSession = async () => {
      const sessionRes = await supabase.auth.getSession();
      const sessionUser = sessionRes.data.session?.user;
      const sessionEmail = String(sessionUser?.email ?? '').trim();
      if (!active || !sessionEmail) return;

      setUnlockBusy(true);
      setUnlockStatus({ tone: 'pending', message: 'Restoring previous admin session...' });
      try {
        const accessRes = await supabase.rpc('get_admin_access_context');
        if (accessRes.error) {
          setUnlockStatus({ tone: 'error', message: `权限读取失败：${accessRes.error.message}` });
          await supabase.auth.signOut();
          return;
        }

        const context = normalizeAdminAccessContext(accessRes.data, sessionEmail);
        if (!context.is_active) {
          setUnlockStatus({ tone: 'error', message: 'Account was locked' });
          await supabase.auth.signOut();
          return;
        }

        if (!canUnlockPunchScreen(context)) {
          setUnlockStatus({ tone: 'error', message: 'Access denied' });
          await supabase.auth.signOut();
          return;
        }

        setPunchUnlocked(true);
        try { localStorage.setItem(PUNCH_UNLOCKED_KEY, '1'); } catch {}
        const userMetadata = (sessionUser?.user_metadata ?? {}) as Record<string, unknown>;
        const metadataAvatarUrl = String(userMetadata.avatar_url ?? userMetadata.picture ?? '').trim();
        const avatarUrl = (await loadPunchAvatarByEmail(sessionEmail)) || metadataAvatarUrl;
        setUnlockByLabel(sessionEmail);
        try { localStorage.setItem(PUNCH_UNLOCKED_LABEL_KEY, sessionEmail); } catch {}
        setPunchUserAvatarUrl(avatarUrl);
        try {
          if (avatarUrl) {
            localStorage.setItem(PUNCH_UNLOCKED_AVATAR_KEY, avatarUrl);
          } else {
            localStorage.removeItem(PUNCH_UNLOCKED_AVATAR_KEY);
          }
        } catch {}
        setUnlockStatus({ tone: 'success', message: `Unlocked by admin: ${sessionEmail}` });
        setUiStatus({ tone: 'idle', message: defaultUiStatusMessage });
      } finally {
        if (active) {
          setUnlockBusy(false);
        }
      }
    };

    void restoreUnlockSession();

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event !== 'SIGNED_OUT') return;
      if (preservePunchUnlockOnNextSignOutRef.current) {
        preservePunchUnlockOnNextSignOutRef.current = false;
        return;
      }
      try {
        if (localStorage.getItem(PUNCH_UNLOCKED_KEY) === '1') {
          return;
        }
      } catch {
        // If storage cannot be read, fall through to the locked state.
      }
      setPunchUnlocked(false);
      try { localStorage.removeItem(PUNCH_UNLOCKED_KEY); } catch {}
      setUnlockByLabel('');
      setPunchUserAvatarUrl('');
      try { localStorage.removeItem(PUNCH_UNLOCKED_LABEL_KEY); } catch {}
      try { localStorage.removeItem(PUNCH_UNLOCKED_AVATAR_KEY); } catch {}
      setUnlockPassword('');
      setUnlockStatus({ tone: 'idle', message: '' });
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !isValidId) {
      setLastPunchAction(null);
      setLastPunchActionError(null);
      setLastPunchActionLoading(false);
      return;
    }

    let active = true;
    const staff = normalizedId;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLastPunchActionLoading(true);
        const resolved = await resolvePunchStaffId(staff);
        const { action, error } = resolved.error
          ? { action: null as PunchAction | null, error: resolved.error }
          : await fetchLastPunch(resolved.staffId);
        if (!active) return;
        setLastPunchAction(action);
        setLastPunchActionError(error);
        setLastPunchActionLoading(false);
      })();
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
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

    employeeColumnModeRef.current = 'cased';
    return 'cased';
  };

  const fetchStaffIdsForPosition = async (position: AllowedPosition) => {
    if (!supabase) {
      return { staffIds: [] as string[], error: 'Missing Supabase configuration.' };
    }

    const fetchAll = async (mode: EmployeeColumnMode) => {
      const positionCol = mode === 'cased' ? 'Position' : 'position';
      const res = await fetchAllPagedRows<{ staff_id?: string | null }>(
        async (from, to) =>
          await supabase
            .from(EMPLOYEE_TABLE)
            .select('staff_id')
            .ilike(positionCol as any, position)
            .range(from, to),
        1000
      );
      if (res.error) {
        return { staffIds: [] as string[], error: res.error };
      }
      const all = res.rows
        .map((row) => String(row.staff_id ?? '').trim())
        .filter(Boolean);
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
      return {
        map: {} as Record<string, { name: string; agency: string; position: string; label: string; shift: string; terminatedAt: string | null }>,
        error: null as string | null
      };
    }

    const ids = Array.from(
      new Set(
        staffIds.flatMap((s) => {
          const raw = String(s ?? '').trim();
          const normalized = normalizeStaffId(raw);
          return [raw, normalized].filter(Boolean);
        })
      )
    );
    if (ids.length === 0) {
      return {
        map: {} as Record<string, { name: string; agency: string; position: string; label: string; shift: string; terminatedAt: string | null }>,
        error: null as string | null
      };
    }

    const runQuery = async (mode: EmployeeColumnMode) => {
      // Try queries in order, ensuring we get label if it exists.
      // Strategy: Try all permutations, label-first (both uppercase Label and lowercase label).
      const queries =
        mode === 'cased'
          ? [
              'staff_id, name, "Agency", "Position", label, shift, terminated_at',
              'staff_id, name, "Agency", "Position", "Label", shift, terminated_at',
              'staff_id, name, "Agency", "Position", label, terminated_at',
              'staff_id, name, "Agency", "Position", "Label", terminated_at',
              'staff_id, name, "Agency", "Position", shift, terminated_at',
              'staff_id, name, "Agency", "Position", terminated_at',
              'staff_id, name, "Agency", "Position", label, shift',
              'staff_id, name, "Agency", "Position", "Label", shift',
              'staff_id, name, "Agency", "Position", label',
              'staff_id, name, "Agency", "Position", "Label"',
              'staff_id, name, "Agency", "Position", shift',
              'staff_id, name, "Agency", "Position"'
            ]
          : [
              'staff_id, name, agency, position, label, shift, terminated_at',
              'staff_id, name, agency, position, label, terminated_at',
              'staff_id, name, agency, position, shift, terminated_at',
              'staff_id, name, agency, position, terminated_at',
              'staff_id, name, agency, position, label, shift',
              'staff_id, name, agency, position, label',
              'staff_id, name, agency, position, shift',
              'staff_id, name, agency, position'
            ];

      for (const select of queries) {
        const res = await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', ids);
        if (!res.error) {
          return res;
        }
      }
      
      // All queries failed, return last error
      const lastAttempt = await supabase.from(EMPLOYEE_TABLE).select(queries[queries.length - 1]).in('staff_id', ids);
      return lastAttempt;
    };

    const mode = await resolveEmployeeColumnMode();
    let rows = await runQuery(mode);
    if (rows.error) {
      const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
      employeeColumnModeRef.current = flipped;
      rows = await runQuery(flipped);
    }
    if (rows.error) {
      return {
        map: {} as Record<string, { name: string; agency: string; position: string; label: string; shift: string; terminatedAt: string | null }>,
        error: rows.error.message
      };
    }

    const map: Record<string, { name: string; agency: string; position: string; label: string; shift: string; terminatedAt: string | null }> = {};
    for (const r of (rows.data as any[] | null) ?? []) {
      const staffRaw = String(r.staff_id ?? '').trim();
      const staff = normalizeStaffId(staffRaw);
      if (!staff) continue;
      const profile = {
        name: String(r.name ?? '').trim(),
        agency: String(r.agency ?? r.Agency ?? '').trim(),
        position: String(r.position ?? r.Position ?? '').trim(),
        label: String(r.label ?? r.Label ?? '').trim(),
        shift: String(r.shift ?? '').trim(),
        terminatedAt: String(r.terminated_at ?? '').trim() || null
      };
      map[staff] = profile;
      if (staffRaw && staffRaw !== staff) {
        map[staffRaw] = profile;
      }
    }
    return { map, error: null as string | null };
  };

  const resolveStaffDisplayName = async (staffIdValue: string) => {
    const staff = normalizeStaffId(String(staffIdValue ?? '').trim());
    if (!staff) return String(staffIdValue ?? '').trim();
    const cachedName = String((punchBoardEmployeeMap[staff] ?? punchBoardEmployeeMap[staffIdValue])?.name ?? '').trim();
    if (cachedName) return cachedName;
    const mapRes = await fetchEmployeeMap([staff]);
    if (mapRes.error) return staff;
    const profile = mapRes.map[staff] ?? mapRes.map[staffIdValue];
    if (profile) {
      setPunchBoardEmployeeMap((prev) => ({ ...prev, [staff]: profile }));
    }
    const name = String(profile?.name ?? '').trim();
    return name || staff;
  };

const fetchPunchBoardUph = async (
    staffIds: string[],
    employeeMap: Record<string, { name: string; agency: string; position: string; label: string }>
  ) => {
    const seq = punchBoardUphFetchSeqRef.current + 1;
    punchBoardUphFetchSeqRef.current = seq;
    if (!obupSupabase || staffIds.length === 0) {
      if (seq === punchBoardUphFetchSeqRef.current) setPunchBoardUphByStaffId({});
      return {} as Record<string, number | null>;
    }

    const stageEmployees = new Map<'picking' | 'sorting' | 'packing', Map<string, string[]>>();
    const uniqueStaffIds = Array.from(new Set(staffIds.map((s) => normalizeStaffId(s)).filter(Boolean)));
    for (const staff of uniqueStaffIds) {
      const profile = employeeMap[staff];
      const name = String(profile?.name ?? '').trim();
      const stage = positionToUphStage(String(profile?.position ?? '').trim());
      if (!name || !stage) continue;
      const key = normalizeWorkOperatorKey(name);
      if (!key) continue;
      if (!stageEmployees.has(stage)) stageEmployees.set(stage, new Map());
      const byOperator = stageEmployees.get(stage)!;
      const list = byOperator.get(key) ?? [];
      list.push(staff);
      byOperator.set(key, list);
    }
    if (stageEmployees.size === 0) {
      if (seq === punchBoardUphFetchSeqRef.current) setPunchBoardUphByStaffId({});
      return {} as Record<string, number | null>;
    }

    const now = new Date();
    const startKey = toDateOnly(addDays(now, -(PUNCH_LOG_UPH_DAYS - 1)));
    const endKey = toDateOnly(now);
    const stages = Array.from(stageEmployees.keys());
    const reportIdToStage = new Map<string, 'picking' | 'sorting' | 'packing'>();
    const reportPageSize = 1000;
    const reportMaxPages = 50;
    for (let page = 0; page < reportMaxPages; page += 1) {
      const from = page * reportPageSize;
      const to = from + reportPageSize - 1;
      const reportsRes = await obupSupabase
        .from(OBUP_REPORTS_TABLE)
        .select('id, stage')
        .gte('work_date', startKey)
        .lte('work_date', endKey)
        .in('stage', stages as any[])
        .range(from, to);
      if (reportsRes.error) {
        if (seq === punchBoardUphFetchSeqRef.current) setPunchBoardUphByStaffId({});
        return {} as Record<string, number | null>;
      }
      const rows = (reportsRes.data as Array<{ id?: string | null; stage?: string | null }> | null) ?? [];
      for (const row of rows) {
        const reportId = String(row.id ?? '').trim();
        const stageRaw = String(row.stage ?? '').trim().toLowerCase();
        const stage = stageRaw === 'picking' || stageRaw === 'packing' || stageRaw === 'sorting' ? stageRaw : null;
        if (!reportId || !stage) continue;
        reportIdToStage.set(reportId, stage);
      }
      if (rows.length < reportPageSize) break;
    }
    const reportIds = Array.from(reportIdToStage.keys());
    if (reportIds.length === 0) {
      if (seq === punchBoardUphFetchSeqRef.current) setPunchBoardUphByStaffId({});
      return {} as Record<string, number | null>;
    }

    const avgByStageOperator = new Map<'picking' | 'sorting' | 'packing', Map<string, { sum: number; count: number }>>();
    for (const batch of chunk(reportIds, 100)) {
      const detailsRes = await fetchAllPagedRows<{ report_id?: string | null; operator?: string | null; uph?: number | null }>(
        async (from, to) =>
          await obupSupabase
            .from(OBUP_REPORT_DETAILS_TABLE)
            .select('report_id, operator, uph')
            .in('report_id', batch)
            .range(from, to),
        1000
      );
      if (detailsRes.error) break;
      for (const row of detailsRes.rows) {
        const reportId = String(row.report_id ?? '').trim();
        const stage = reportIdToStage.get(reportId);
        if (!stage) continue;
        const operatorKey = normalizeWorkOperatorKey(String(row.operator ?? '').trim());
        const uph = parseUph(row.uph);
        if (!operatorKey || uph === null) continue;
        if (!avgByStageOperator.has(stage)) avgByStageOperator.set(stage, new Map());
        const byOperator = avgByStageOperator.get(stage)!;
        const prev = byOperator.get(operatorKey) ?? { sum: 0, count: 0 };
        prev.sum += uph;
        prev.count += 1;
        byOperator.set(operatorKey, prev);
      }
    }

    const accountLinkMap = new Map<string, string>();
    const accountLinkReverseMap = new Map<string, string>();
    const linksRes = await obupSupabase
      .from(OBUP_ACCOUNT_LINKS_TABLE)
      .select('source_name, target_name, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1000);
    if (!linksRes.error) {
      for (const row of (linksRes.data as Array<{ source_name?: string | null; target_name?: string | null }> | null) ?? []) {
        const sourceKey = normalizeWorkOperatorKey(String(row.source_name ?? '').trim());
        const targetKey = normalizeWorkOperatorKey(String(row.target_name ?? '').trim());
        if (!sourceKey || !targetKey || accountLinkMap.has(sourceKey)) continue;
        accountLinkMap.set(sourceKey, targetKey);
        if (!accountLinkReverseMap.has(targetKey)) accountLinkReverseMap.set(targetKey, sourceKey);
      }
    }

    const nextMap: Record<string, number | null> = {};
    for (const [stage, employeesByKey] of stageEmployees.entries()) {
      const operatorAvgByKey = avgByStageOperator.get(stage) ?? new Map<string, { sum: number; count: number }>();
      const operatorKeys = Array.from(operatorAvgByKey.keys());
      for (const [employeeKey, employees] of employeesByKey.entries()) {
        let matchedKey: string | null = null;
        const mappedTarget = accountLinkMap.get(employeeKey);
        if (mappedTarget && operatorAvgByKey.has(mappedTarget)) matchedKey = mappedTarget;
        if (!matchedKey) {
          const mappedSource = accountLinkReverseMap.get(employeeKey);
          if (mappedSource && operatorAvgByKey.has(mappedSource)) matchedKey = mappedSource;
        }
        if (!matchedKey && operatorAvgByKey.has(employeeKey)) matchedKey = employeeKey;
        if (!matchedKey) {
          let bestKey = '';
          let bestScore = 0;
          for (const operatorKey of operatorKeys) {
            const score = fuzzyNameSimilarity(employeeKey, operatorKey);
            if (score > bestScore) {
              bestScore = score;
              bestKey = operatorKey;
            }
          }
          if (bestKey && bestScore >= PUNCH_LOG_UPH_FUZZY_THRESHOLD) matchedKey = bestKey;
        }
        const rec = matchedKey ? operatorAvgByKey.get(matchedKey) : null;
        const avgUph = rec && rec.count > 0 ? rec.sum / rec.count : null;
        for (const staff of employees) nextMap[staff] = avgUph;
      }
    }

    if (seq === punchBoardUphFetchSeqRef.current) {
      setPunchBoardUphByStaffId(nextMap);
    }
    return nextMap;
  };
  const fetchDailyRoster = async () => {
    if (!supabase) {
      setDailyRosterError('Missing Supabase configuration.');
      setDailyRoster([]);
      return;
    }

    const targetDate = getTomorrowListTargetDate(new Date());
    const dayIndex = getRosterDayIndex(targetDate);
    const templateDate = getTemplateDateByDayIndex(dayIndex);

    setDailyRosterError(null);
    const res = await supabase
      .from(SCHEDULE_TABLE)
      .select('id, staff_id, note, updated_at, created_at')
      .eq('date', templateDate)
      .order('staff_id', { ascending: true })
      .limit(2000);

    if (res.error) {
      setDailyRosterError(res.error.message);
      setDailyRoster([]);
      return;
    }

    const rawRows = pickLatestScheduleRowsByStaff((((res.data as any[]) ?? []) as any[]));
    const rows = rawRows.filter((row) => !isRestLikeScheduleNote(row.note));
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
    const list: DailyRosterItem[] = rows
      .map((row) => {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        const employeeInfo = staff ? employeeMap[staff] : undefined;
        if (!staff || !employeeInfo || isScheduleOnlyAgency(String(employeeInfo.agency ?? '').trim())) return null;
        const position = String(employeeInfo?.position ?? '').trim();
        return {
          staff_id: staff,
          name: employeeInfo?.name || staff,
          agency: employeeInfo?.agency || '-',
          position,
          shift: String(employeeInfo?.shift ?? '').trim()
        };
      })
      .filter(Boolean) as DailyRosterItem[];
    setDailyRoster(list);
  };

  const fetchAbsentRoster = async (options?: { force?: boolean }) => {
    if (!supabase) {
      setAbsentRoster([]);
      return;
    }

    const now = new Date();
    const todayDayIndex = getDayIndexByCutoff(now, ABSENT_RESET_HOUR);
    const templateDate = getTemplateDateByDayIndex(todayDayIndex);
    const force = Boolean(options?.force);
    const cache = absentRosterCacheRef.current;
    const cacheFresh = Date.now() - cache.at < ABSENT_ROSTER_CACHE_TTL_MS;
    if (!force && cacheFresh && cache.key === templateDate) {
      setAbsentRoster([...cache.rows]);
      return;
    }

    const scheduleRes = await supabase
      .from(SCHEDULE_TABLE)
      .select('id, staff_id, note, updated_at, created_at')
      .eq('date', templateDate)
      .order('staff_id', { ascending: true })
      .limit(3000);

    if (scheduleRes.error) {
      setAbsentRoster([]);
      return;
    }

    const scheduledRows = pickLatestScheduleRowsByStaff((((scheduleRes.data as any[]) ?? []) as any[])).filter(
      (row) => !isRestLikeScheduleNote(row.note)
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
      absentRosterCacheRef.current = { at: Date.now(), key: templateDate, rows: [] };
      return;
    }

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
    const list: AbsentRosterItem[] = scheduledStaff
      .filter((staff) => !isScheduleOnlyAgency(String(employeeMap[staff]?.agency ?? '').trim()))
      .filter((staff) => !punchedStaff.has(staff))
      .filter((staff) => Boolean(employeeMap[staff]))
      .map((staff) => {
        const employeeInfo = employeeMap[staff];
        return {
          staff_id: staff,
          name: employeeInfo?.name || '',
          agency: employeeInfo?.agency || '-',
          position: employeeInfo?.position || '',
          shift: normalizeShiftValue(String(employeeInfo?.shift ?? '').trim())
        };
      });

    setAbsentRoster(list);
    absentRosterCacheRef.current = { at: Date.now(), key: templateDate, rows: [...list] };
  };
  const fetchArrivalMetrics = async (options?: { force?: boolean }) => {
    const empty = createEmptyArrivalMetrics();
    if (!supabase) {
      setArrivalMetrics(empty);
      return;
    }

    const now = new Date();
    const todayDayIndex = getDayIndexByCutoff(now, ABSENT_RESET_HOUR);
    const templateDate = getTemplateDateByDayIndex(todayDayIndex);
    const force = Boolean(options?.force);
    const cache = arrivalMetricsCacheRef.current;
    const cacheFresh = Date.now() - cache.at < ARRIVAL_METRICS_CACHE_TTL_MS;
    if (!force && cacheFresh && cache.key === templateDate) {
      setArrivalMetrics(cloneArrivalMetricsRows(cache.rows));
      return;
    }
    const scheduleRes = await supabase
      .from(SCHEDULE_TABLE)
      .select('id, staff_id, note, updated_at, created_at')
      .eq('date', templateDate)
      .limit(5000);
    if (scheduleRes.error) {
      setArrivalMetrics(empty);
      return;
    }

    const allScheduleRows = pickLatestScheduleRowsByStaff((((scheduleRes.data as any[]) ?? []) as any[]));
    const workScheduleRows = allScheduleRows.filter((row) => !isRestLikeScheduleNote(row.note));
    const restScheduleRows = allScheduleRows.filter((row) => isRestLikeScheduleNote(row.note));
    const allScheduleStaff = Array.from(
      new Set(
        allScheduleRows
          .map((row) => normalizeStaffId(String(row.staff_id ?? '').trim()))
          .filter(Boolean)
      )
    );
    const positionMapRes = await fetchEmployeeMap(allScheduleStaff);
    const employeePositionMap = positionMapRes.error ? {} : positionMapRes.map;

    const staffByKey = new Map<string, Set<string>>();
    const keysByStaff = new Map<string, string[]>();
    for (const row of workScheduleRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) continue;
      if (isScheduleOnlyAgency(String(employeePositionMap[staff]?.agency ?? '').trim())) continue;
      const latestPosition = normalizeAllowedPosition(String(employeePositionMap[staff]?.position ?? '').trim());
      const position = latestPosition;
      if (!position) continue;
      const dbShift = normalizeShiftValue(String(employeePositionMap[staff]?.shift ?? '').trim());
      const shift = dbShift;
      if (!shift) continue;
      const key = `${shift}:${position}`;
      if (!staffByKey.has(key)) staffByKey.set(key, new Set());
      staffByKey.get(key)?.add(staff);
      const keys = keysByStaff.get(staff) ?? [];
      if (!keys.includes(key)) keys.push(key);
      keysByStaff.set(staff, keys);
    }
    const restByKey = new Map<string, Set<string>>();
    for (const row of restScheduleRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) continue;
      if (isScheduleOnlyAgency(String(employeePositionMap[staff]?.agency ?? '').trim())) continue;
      const latestPosition = normalizeAllowedPosition(String(employeePositionMap[staff]?.position ?? '').trim());
      const position = latestPosition;
      if (!position) continue;
      const dbShift = normalizeShiftValue(String(employeePositionMap[staff]?.shift ?? '').trim());
      const shift = dbShift;
      if (!shift) continue;
      const key = `${shift}:${position}`;
      if (!restByKey.has(key)) restByKey.set(key, new Set());
      restByKey.get(key)?.add(staff);
      const keys = keysByStaff.get(staff) ?? [];
      if (!keys.includes(key)) keys.push(key);
      keysByStaff.set(staff, keys);
    }

    const trackedStaff = Array.from(new Set([...Array.from(keysByStaff.keys()), ...allScheduleStaff]));

    // 获取当天所有打卡员工（包含没有排班但有打卡记录的）
    const dayStartDate = getOperationalDayStart(now, ABSENT_RESET_HOUR);
    const dayStart = dayStartDate.toISOString();
    const dayEnd = addDays(dayStartDate, 1).toISOString();

    // 查询当天的所有打卡记录
    const allPunchRes = await supabase
      .from('ob_punches')
      .select('staff_id, action, created_at')
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd)
      .limit(5000);

    const punchedStaff = new Set<string>();
    const latestPunchByStaff = new Map<string, { at: number; action: PunchAction }>();

    // 直接使用已获取的打卡数据
    if (!allPunchRes.error && allPunchRes.data) {
      for (const r of allPunchRes.data) {
        const staff = normalizeStaffId(String(r.staff_id ?? '').trim());
        const actionRaw = String(r.action ?? '').toUpperCase();
        const action = actionRaw === 'OUT' ? 'OUT' : actionRaw === 'IN' ? 'IN' : null;
        const atRaw = String(r.created_at ?? '').trim();
        const atMs = atRaw ? new Date(atRaw).getTime() : Number.NaN;
        if (!staff) continue;
        if (isScheduleOnlyAgency(String(employeePositionMap[staff]?.agency ?? '').trim())) continue;
        punchedStaff.add(staff);
        if (action) {
          const previous = latestPunchByStaff.get(staff);
          if (!Number.isNaN(atMs)) {
            if (!previous || atMs > previous.at) {
              latestPunchByStaff.set(staff, { at: atMs, action });
            }
          } else if (!previous) {
            latestPunchByStaff.set(staff, { at: Number.NEGATIVE_INFINITY, action });
          }
        }

        // 把没有排班但有打卡记录的员工也加入到 trackedStaff
        if (!trackedStaff.includes(staff)) {
          trackedStaff.push(staff);
        }
      }
    }

    const latestActionByStaff = new Map<string, PunchAction>();
    for (const [staff, row] of latestPunchByStaff.entries()) {
      latestActionByStaff.set(staff, row.action);
    }

    // 获取所有有打卡记录但没有排班的员工的职位信息
    const punchedStaffWithoutSchedule = Array.from(punchedStaff).filter((staff) => !keysByStaff.has(staff));
    let punchedStaffPositionMap: Record<string, { position: string; shift: string }> = {};
    if (punchedStaffWithoutSchedule.length > 0) {
      const positionMapRes = await fetchEmployeeMap(punchedStaffWithoutSchedule);
      const employeePositionMap = positionMapRes.error ? {} : positionMapRes.map;
      for (const staff of punchedStaffWithoutSchedule) {
        if (isScheduleOnlyAgency(String(employeePositionMap[staff]?.agency ?? '').trim())) continue;
        const positionRaw = String(employeePositionMap[staff]?.position ?? '').trim();
        const position = normalizeAllowedPosition(positionRaw);
        if (!position) continue;
        const shift = normalizeShiftValue(String(employeePositionMap[staff]?.shift ?? '').trim());
        if (!shift) continue;
        const key = `${shift}:${position}`;
        if (!keysByStaff.has(staff)) keysByStaff.set(staff, []);
        if (!keysByStaff.get(staff)!.includes(key)) keysByStaff.get(staff)!.push(key);
        punchedStaffPositionMap[staff] = { position, shift };
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
    const restWorkedByKey = new Map<string, Set<string>>();
    // 情况1：有休息排班但有打卡的员工
    for (const [key, restStaffSet] of restByKey.entries()) {
      for (const staff of restStaffSet) {
        if (!punchedStaff.has(staff)) continue;
        if (!restWorkedByKey.has(key)) restWorkedByKey.set(key, new Set());
        restWorkedByKey.get(key)?.add(staff);
      }
    }
    // 情况2：没有排班但有打卡的员工
    for (const staff of punchedStaff) {
      // 检查是否在任何班次的工作排班或休息排班中
      const hasWorkSchedule = Array.from(staffByKey.values()).some((set) => set.has(staff));
      const hasRestSchedule = Array.from(restByKey.values()).some((set) => set.has(staff));
      if (!hasWorkSchedule && !hasRestSchedule) {
        // 没有排班但有打卡，加入到 restWorked
        const keys = keysByStaff.get(staff) ?? [];
        for (const key of keys) {
          if (!restWorkedByKey.has(key)) restWorkedByKey.set(key, new Set());
          restWorkedByKey.get(key)?.add(staff);
        }
      }
    }
    const onClockStaffIds = Array.from(new Set(Array.from(onClockByKey.values()).flatMap((set) => Array.from(set))));
    const restWorkedStaffIds = Array.from(
      new Set(Array.from(restWorkedByKey.values()).flatMap((set) => Array.from(set)))
    );
    const scheduledNotClockInByKey = new Map<string, Set<string>>();
    for (const [key, scheduledSet] of staffByKey.entries()) {
      for (const staff of scheduledSet) {
        if (punchedStaff.has(staff)) continue;
        if (!scheduledNotClockInByKey.has(key)) scheduledNotClockInByKey.set(key, new Set());
        scheduledNotClockInByKey.get(key)?.add(staff);
      }
    }
    const scheduledNotClockInStaffIds = Array.from(
      new Set(Array.from(scheduledNotClockInByKey.values()).flatMap((set) => Array.from(set)))
    );
    const displayStaffIds = Array.from(new Set([...onClockStaffIds, ...restWorkedStaffIds, ...scheduledNotClockInStaffIds]));
    const displayMapRes = await fetchEmployeeMap(displayStaffIds);
    const displayEmployeeMap = displayMapRes.error ? {} : displayMapRes.map;

    const out: ArrivalMetric[] = ['early', 'late'].flatMap((shift) =>
      ALLOWED_POSITIONS.map((position) => {
        const key = `${shift}:${position}`;
        const onClockIds = Array.from(onClockByKey.get(key) ?? []).sort((a, b) => a.localeCompare(b, 'en-US'));
        const onClockStaff = onClockIds.map((staff) => {
          const name = String(displayEmployeeMap[staff]?.name ?? '').trim();
          return name ? `${name} (${staff})` : staff;
        });
        const restWorkedIds = Array.from(restWorkedByKey.get(key) ?? []).sort((a, b) => a.localeCompare(b, 'en-US'));
        const restWorkedStaff = restWorkedIds.map((staff) => {
          const name = String(displayEmployeeMap[staff]?.name ?? '').trim();
          return name ? `${name} (${staff})` : staff;
        });
        const scheduledNotClockInIds = Array.from(scheduledNotClockInByKey.get(key) ?? []).sort((a, b) =>
          a.localeCompare(b, 'en-US')
        );
        const scheduledNotClockInStaff = scheduledNotClockInIds.map((staff) => {
          const name = String(displayEmployeeMap[staff]?.name ?? '').trim();
          return name ? `${name} (${staff})` : staff;
        });
        const presentIds = new Set<string>([
          ...Array.from(arrivedByKey.get(key) ?? []),
          ...Array.from(restWorkedByKey.get(key) ?? [])
        ]);
        return {
          shift: shift as 'early' | 'late',
          position,
          expected: staffByKey.get(key)?.size ?? 0,
          present: presentIds.size,
          onClock: onClockByKey.get(key)?.size ?? 0,
          onClockStaff,
          restWorked: restWorkedByKey.get(key)?.size ?? 0,
          restWorkedStaff,
          scheduledNotClockInStaff
        };
      })
    );
    setArrivalMetrics(out);
    arrivalMetricsCacheRef.current = {
      at: Date.now(),
      key: templateDate,
      rows: cloneArrivalMetricsRows(out)
    };
    try {
      localStorage.setItem(
        ARRIVAL_METRICS_STORAGE_KEY,
        JSON.stringify({
          at: arrivalMetricsCacheRef.current.at,
          key: templateDate,
          rows: arrivalMetricsCacheRef.current.rows
        })
      );
    } catch {
      // ignore local persistence failures
    }
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
      // 先获取所有打卡记录的员工（不限制职位），然后再按职位过滤
      // 这样可以包含那些当天没有排班但有打卡记录的员工
      const allStaffRes = await fetchStaffIdsForPosition(pos);
      if (allStaffRes.error) {
        return { rows: [] as PunchBoardRow[], error: allStaffRes.error };
      }

      // 获取所有员工的打卡记录（不限制员工数量）
      const allPunches: PunchBoardRow[] = [];
      const maxPunchesPerStaff = 30;

      // 直接从 ob_punches 表获取所有记录，不限制员工
      const punchBase = () =>
        supabase
          .from('ob_punches')
          .select('id, staff_id, action, created_at')
          .order('created_at', { ascending: false })
          .limit(3000);

      const punchAttempt = await punchBase();
      if (punchAttempt.error) {
        return { rows: [] as PunchBoardRow[], error: punchAttempt.error.message };
      }

      // 按员工分组，每位员工最多保留 maxPunchesPerStaff 条记录
      const staffPunches: Record<string, PunchBoardRow[]> = {};
      for (const r of (punchAttempt.data as any[] | null) ?? []) {
        const staffId = String(r.staff_id ?? '').trim();
        if (!staffId) continue;

        if (!staffPunches[staffId]) {
          staffPunches[staffId] = [];
        }
        if (staffPunches[staffId].length < maxPunchesPerStaff) {
          staffPunches[staffId].push({
            id: r.id,
            staff_id: staffId,
            action: String(r.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
            created_at: (r.created_at ?? null) as string | null
          });
        }
      }

      // 获取所有打卡员工的 employee map
      const allStaffIds = Object.keys(staffPunches);
      const mapRes = await fetchEmployeeMap(allStaffIds);
      const employeeMap = mapRes.map || {};

      // 按职位过滤：只保留目标职位的员工
      const needle = pos.trim().toLowerCase();
      for (const staffId of Object.keys(staffPunches)) {
        const employee = employeeMap[staffId];
        if (isScheduleOnlyAgency(String(employee?.agency ?? '').trim())) {
          delete staffPunches[staffId];
          continue;
        }
        const staffPos = String(employee?.position ?? '').trim().toLowerCase();
        if (staffPos !== needle) {
          delete staffPunches[staffId];
        }
      }

      // 合并所有符合条件的打卡记录
      for (const punches of Object.values(staffPunches)) {
        allPunches.push(...punches);
      }

      // 按时间排序
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
      setPunchBoardDeviceStatusByStaffId({});
      setPunchBoardUphByStaffId({});
      return;
    }

    const rows = loaded.rows;
    const staffIds = rows.map((r) => r.staff_id).filter(Boolean);
    const mapRes = await fetchEmployeeMap(staffIds);
    if (mapRes.error) {
      setPunchBoard([]);
      setPunchBoardEmployeeMap({});
      setPunchBoardDeviceStatusByStaffId({});
      setPunchBoardUphByStaffId({});
      return;
    }

    const filteredRows = rows.filter((row) => !isScheduleOnlyAgency(String(mapRes.map[row.staff_id]?.agency ?? '').trim()));
    const filteredStaffIds = filteredRows.map((row) => row.staff_id).filter(Boolean);
    const filteredEmployeeMap = Object.fromEntries(
      Object.entries(mapRes.map).filter(([, employee]) => !isScheduleOnlyAgency(String(employee?.agency ?? '').trim()))
    );

    setPunchBoard(filteredRows);
    setPunchBoardEmployeeMap(filteredEmployeeMap);
    const latestPunch = filteredRows[0];
    if (latestPunch) {
      const latestStaffId = normalizeStaffId(latestPunch.staff_id) || latestPunch.staff_id;
      const employee = filteredEmployeeMap[latestStaffId] ?? filteredEmployeeMap[latestPunch.staff_id];
      setLastPunchSummary({
        status: 'success',
        staffId: latestStaffId,
        staffName: String(employee?.name ?? '').trim() || latestStaffId,
        action: latestPunch.action,
        at: latestPunch.created_at
      });
    } else {
      setLastPunchSummary(null);
    }
    await fetchPunchBoardDeviceStatus(filteredStaffIds);
    const normalizedStaffIds = Array.from(new Set(filteredStaffIds.map((v) => normalizeStaffId(v)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'en-US')
    );
    const uphCacheKey = normalizedStaffIds
      .map((staff) => {
        const profile = filteredEmployeeMap[staff];
        return `${staff}:${String(profile?.position ?? '').trim()}:${String(profile?.name ?? '').trim()}`;
      })
      .join('|');
    const uphCache = punchBoardUphCacheRef.current;
    const cacheFresh = Date.now() - uphCache.at < PUNCH_LOG_UPH_CACHE_TTL_MS;
    if (cacheFresh && uphCache.key === uphCacheKey) {
      setPunchBoardUphByStaffId(uphCache.map);
      return;
    }

    const nextUphMap = await fetchPunchBoardUph(filteredStaffIds, filteredEmployeeMap);
    punchBoardUphCacheRef.current = {
      at: Date.now(),
      key: uphCacheKey,
      map: { ...nextUphMap }
    };
  };

  useEffect(() => {
    if (!supabase) return;
    if (page !== 'punch') return;

    const refreshPunchPage = () => {
      // Trigger in parallel so Attendance/Absent panels are not blocked by punch log fetch.
      void fetchArrivalMetrics();
      void fetchAbsentRoster();
      void fetchPunchBoard();
      void fetchDeviceQuickLogs();
      void fetchDailyRoster();
    };

    refreshPunchPage();

    const timer = window.setInterval(() => {
      refreshPunchPage();
    }, 60000);
    return () => {
      window.clearInterval(timer);
    };
  }, [page]);

  useEffect(() => {
    if (page !== 'punch') return;
    const timer = window.setInterval(() => {
      void fetchDeviceQuickLogs();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [page]);

  useEffect(() => {
    if (!supabase) return;
    if (page !== 'punch') return;

    let disposed = false;
    let refreshTimer: number | null = null;

    const refreshPunchPageRealtime = () => {
      if (disposed) return;
      void fetchArrivalMetrics();
      void fetchAbsentRoster();
      void fetchPunchBoard();
    };

    const scheduleRefresh = () => {
      if (disposed) return;
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        refreshPunchPageRealtime();
      }, 250);
    };

    const channel = supabase
      .channel(`obpunch-punch-live-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ob_punches' },
        () => {
          scheduleRefresh();
        }
      )
      .subscribe();

    return () => {
      disposed = true;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [page]);

  useEffect(() => {
    if (page !== 'punch') return;
    void fetchRosterShiftByPunches(rosterStaffIds);
  }, [page, rosterStaffIds]);

  useEffect(() => {
    if (!uiStatus.message || uiStatus.message === defaultUiStatusMessage) return;
    if (statusToastTimerRef.current) {
      window.clearTimeout(statusToastTimerRef.current);
      statusToastTimerRef.current = null;
    }
    setStatusToast(uiStatus);
    statusToastTimerRef.current = window.setTimeout(() => {
      setStatusToast((current) =>
        current?.message === uiStatus.message && current.tone === uiStatus.tone ? null : current
      );
      statusToastTimerRef.current = null;
    }, 2000);
    return () => {
      if (statusToastTimerRef.current) {
        window.clearTimeout(statusToastTimerRef.current);
        statusToastTimerRef.current = null;
      }
    };
  }, [defaultUiStatusMessage, uiStatus]);

  const submitPunch = async (
    action: PunchAction,
    options?: { latestAction?: PunchAction | null; skipLatestFetch?: boolean; clearInput?: boolean; retryOutWhenAlreadyIn?: boolean }
  ) => {
    if (isLocked) {
      return;
    }
    if (!isValidId) {
      setUiStatus({ tone: 'error', message: 'Invalid staff ID format.' });
      playError();
      clearPunchInputAfterError();
      return;
    }
    if (!supabase) {
      setUiStatus({ tone: 'error', message: 'Missing Supabase configuration. Please check environment variables.' });
      playError();
      clearPunchInputAfterError();
      return;
    }

    setUiStatus({ tone: 'pending', message: `Punching... (${action})` });

    await runLocked('punch', async () => {
      const registered = await checkEmployeeRegistered(normalizedId);
      if (registered.error) {
        setUiStatus({ tone: 'error', message: `Failed to verify employee: ${registered.error}` });
        playError();
        clearPunchInputAfterError();
        return;
      }
      if (!registered.registered) {
        setUiStatus({ tone: 'pending', message: `Verifying... (${action})` });
      }
      if (registered.registered && registered.scheduleOnly) {
        setUiStatus({ tone: 'error', message: `Employee does not use punch: ${normalizedId}` });
        playError();
        clearPunchInputAfterError();
        return;
      }
      if (registered.registered && registered.terminated) {
        setUiStatus({ tone: 'error', message: `Employee is terminated and cannot punch: ${normalizedId}` });
        playError();
        clearPunchInputAfterError();
        return;
      }

      const canUseLocalPunchState = registered.registered;
      const latest = canUseLocalPunchState
        ? options?.skipLatestFetch
          ? { action: options?.latestAction ?? null, error: null as string | null }
          : await fetchLastPunch(registered.staffId)
        : { action: null as PunchAction | null, error: null as string | null };
      if (latest.error) {
        setUiStatus({ tone: 'error', message: `Failed to load last punch: ${latest.error}` });
        setLastPunchSummary({ status: 'error', message: `Failed to load last punch`, at: new Date().toISOString() });
        playError();
        clearPunchInputAfterError();
        return;
      }

      const allowed =
        (action === 'IN' && (latest.action === null || latest.action === 'OUT')) ||
        (action === 'OUT' && latest.action === 'IN');
      if (canUseLocalPunchState && !allowed) {
        const msg =
          latest.action === null
            ? 'No previous record found. First action must be IN.'
            : latest.action === 'IN'
              ? 'Last action is IN. Please punch OUT next.'
              : 'Last action is OUT. Please punch IN next.';
        setUiStatus({ tone: 'error', message: msg });
        setLastPunchSummary({ status: 'error', message: msg, at: new Date().toISOString() });
        playError();
        clearPunchInputAfterError();
        setLastPunchAction(latest.action);
        setLastPunchActionError(null);
        return;
      }

      const punchRes = await submitPunchToApi({ staffId: normalizedId, action });

      if (!punchRes.ok) {
        if (options?.retryOutWhenAlreadyIn && action === 'IN' && /last action is in/i.test(punchRes.error)) {
          await submitPunch('OUT', { skipLatestFetch: true, clearInput: options.clearInput });
          return;
        }
        setUiStatus({ tone: 'error', message: `Punch failed: ${punchRes.error}` });
        setLastPunchSummary({ status: 'error', message: formatPunchFailureSummary(punchRes.error), at: new Date().toISOString() });
        playError();
        clearPunchInputAfterError();
        return;
      }

      const punchedStaffId = normalizeStaffId(punchRes.staffId || registered.staffId || normalizedId);
      const staffName = await resolveStaffDisplayName(punchedStaffId);
      setUiStatus({
        tone: 'success',
        message: `${punchRes.action} · ${staffName || punchedStaffId}`
      });
      playSuccess(punchRes.action);
      setLastPunchAction(punchRes.action);
      setLastPunchActionError(null);
      const punchedAt = new Date().toISOString();
      setLastPunchSummary({
        status: 'success',
        staffId: punchedStaffId,
        staffName: staffName || punchedStaffId,
        action: punchRes.action,
        at: punchedAt
      });
      setPunchSuccessAnimation({
        key: Date.now(),
        staffId: punchedStaffId,
        staffName: staffName || punchedStaffId,
        action: punchRes.action,
        at: punchedAt
      });
      if (options?.clearInput ?? true) {
        setStaffId('');
      }
      if (punchRes.action === 'OUT') {
        const [outCountRes, outstanding] = await Promise.all([
          fetchTodayOutCount(punchedStaffId),
          fetchOutstandingDevicesByStaff(punchedStaffId)
        ]);
        if (!outCountRes.error && outCountRes.count >= 2 && !outstanding.error && outstanding.items.length > 0) {
          const reminderName = staffName || (await resolveStaffDisplayName(punchedStaffId));
          setDeviceReturnReminder({ staffId: punchedStaffId, staffName: reminderName, items: outstanding.items });
        }
      }
      void fetchPunchBoard();
      void fetchAbsentRoster();
      void fetchArrivalMetrics();
    });
  };

  const submitAutoPunch = async () => {
    if (isLocked) {
      return;
    }
    if (!isValidId) {
      setUiStatus({ tone: 'error', message: 'Invalid staff ID format.' });
      setLastPunchSummary({ status: 'error', message: 'Invalid staff ID', at: new Date().toISOString() });
      playError();
      clearPunchInputAfterError();
      return;
    }
    if (!supabase) {
      setUiStatus({ tone: 'error', message: 'Missing Supabase configuration. Please check environment variables.' });
      setLastPunchSummary({ status: 'error', message: 'Missing system configuration', at: new Date().toISOString() });
      playError();
      clearPunchInputAfterError();
      return;
    }

    setUiStatus({ tone: 'pending', message: 'Punching...' });

    await runLocked('punch', async () => {
      const punchRes = await submitPunchToApi({ staffId: normalizedId, action: 'AUTO' });
      if (!punchRes.ok) {
        setUiStatus({ tone: 'error', message: `Punch failed: ${punchRes.error}` });
        setLastPunchSummary({
          status: 'error',
          message: formatPunchFailureSummary(punchRes.error),
          at: new Date().toISOString()
        });
        playError();
        clearPunchInputAfterError();
        return;
      }

      const punchedStaffId = normalizeStaffId(punchRes.staffId || normalizedId);
      const staffName = await resolveStaffDisplayName(punchedStaffId);
      setUiStatus({
        tone: 'success',
        message: `${punchRes.action} · ${staffName || punchedStaffId}`
      });
      playSuccess(punchRes.action);
      setLastPunchAction(punchRes.action);
      setLastPunchActionError(null);
      const punchedAt = new Date().toISOString();
      setLastPunchSummary({
        status: 'success',
        staffId: punchedStaffId,
        staffName: staffName || punchedStaffId,
        action: punchRes.action,
        at: punchedAt
      });
      setPunchSuccessAnimation({
        key: Date.now(),
        staffId: punchedStaffId,
        staffName: staffName || punchedStaffId,
        action: punchRes.action,
        at: punchedAt
      });
      setStaffId('');
      if (punchRes.action === 'OUT') {
        const [outCountRes, outstanding] = await Promise.all([
          fetchTodayOutCount(punchedStaffId),
          fetchOutstandingDevicesByStaff(punchedStaffId)
        ]);
        if (!outCountRes.error && outCountRes.count >= 2 && !outstanding.error && outstanding.items.length > 0) {
          const reminderName = staffName || (await resolveStaffDisplayName(punchedStaffId));
          setDeviceReturnReminder({ staffId: punchedStaffId, staffName: reminderName, items: outstanding.items });
        }
      }
      void fetchPunchBoard();
      void fetchAbsentRoster();
      void fetchArrivalMetrics();
    });
  };

  const onStaffIdKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void (async () => {
        const handledAsDeviceReturn = await submitDeviceReturnFromPunchInput(staffId);
        if (!handledAsDeviceReturn) {
          await unlockAudio();
          await submitAutoPunch();
        }
      })();
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
        placeholder={barcodePrompt}
        className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-2xl text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
      />
      {isValidId && (
        <div className="mt-3 text-xs text-slate-400">
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
      setUiStatus({ tone: 'error', message: 'Invalid staff ID format.' });
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

  const statusToastClass: Record<StatusTone, string> = {
    idle: 'border-slate-200 bg-white text-slate-700 shadow-[0_18px_40px_rgba(148,163,184,0.18)]',
    pending: 'border-sky-200 bg-sky-50 text-sky-700 shadow-[0_18px_40px_rgba(186,230,253,0.35)]',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_18px_40px_rgba(187,247,208,0.4)]',
    error: 'border-rose-200 bg-rose-50 text-rose-700 shadow-[0_18px_40px_rgba(254,205,211,0.42)]'
  };

  const tabClass = (active: boolean) =>
    [
      'rounded-2xl px-4 py-2 text-sm font-medium transition',
      active ? 'bg-neon text-ink shadow-glow' : 'bg-white/5 text-slate-200 hover:bg-white/10',
      isLocked ? 'cursor-not-allowed opacity-60' : ''
    ].join(' ');

  const unlockToneClass: Record<StatusTone, string> = {
    idle: 'text-slate-300',
    pending: 'text-sky-300',
    success: 'text-emerald-300',
    error: 'text-rose-300'
  };

  const ambientPeriod = getAmbientPeriod(serverTime);
  const punchUserInitial = (String(unlockByLabel || 'User').trim().charAt(0) || 'U').toUpperCase();

  if (!punchUnlocked) {
    return (
      <div className="min-h-screen px-5 py-8 text-paper">
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1480px] items-center justify-center">
          <section className="relative mx-auto w-full max-w-[1120px] overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(135deg,rgba(5,7,10,0.92),rgba(11,13,16,0.84))] shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -left-20 top-[-72px] h-64 w-64 rounded-full bg-[#9eff00]/10 blur-3xl" />
              <div className="absolute bottom-[-96px] right-[-56px] h-72 w-72 rounded-full bg-[#9eff00]/8 blur-3xl" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_32%)]" />
            </div>

            <div className="relative grid min-h-[520px] gap-8 px-6 py-6 md:grid-cols-[minmax(0,1.3fr)_minmax(380px,0.9fr)] md:px-8 md:py-8 xl:px-10 xl:py-10">
              <div className="flex min-h-[240px] flex-col justify-between rounded-[28px] border border-white/8 bg-white/[0.03] p-6 md:p-8">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.32em] text-slate-300/80">OBP Security</div>
                  <BlurRevealText
                    label="Punch Screen Unlock"
                    lines={[['Punch', 'Screen'], ['Unlock']]}
                    className="mt-6 block max-w-[10ch] font-display text-5xl leading-[0.92] tracking-[0.03em] text-white md:text-6xl xl:text-7xl"
                  />
                </div>
                <div />
              </div>

              <div className="flex items-center">
                <div className="w-full rounded-[30px] border border-white/10 bg-[linear-gradient(145deg,rgba(18,23,19,0.78),rgba(6,9,10,0.88))] p-6 shadow-[0_28px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl md:p-8">
                  <div className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Sign In</div>
                  <BlurRevealText
                    label="Administrator Unlock"
                    lines={[['Administrator'], ['Unlock']]}
                    className="mt-4 block font-display text-4xl leading-[1.05] tracking-[0.03em] text-white md:text-[2.75rem] xl:text-5xl"
                  />

                  <div className="mt-8 grid gap-5">
                    <label className="grid gap-2">
                      <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Email</span>
                      <input
                        ref={unlockEmailRef}
                        type="email"
                        value={unlockEmail}
                        onChange={(event) => setUnlockEmail(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            unlockPasswordRef.current?.focus();
                          }
                        }}
                        autoComplete="email"
                        disabled={unlockBusy}
                        placeholder="Admin email"
                        className="h-14 w-full rounded-[20px] border border-white/12 bg-black/30 px-5 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Password</span>
                      <input
                        ref={unlockPasswordRef}
                        type="password"
                        value={unlockPassword}
                        onChange={(event) => setUnlockPassword(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void doUnlockPunchScreen();
                          }
                        }}
                        autoComplete="current-password"
                        disabled={unlockBusy}
                        placeholder="Password"
                        className="h-14 w-full rounded-[20px] border border-white/12 bg-black/30 px-5 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void doUnlockPunchScreen()}
                      disabled={unlockBusy || unlockEmail.trim() === '' || unlockPassword === ''}
                      className="obp-primary-button mt-2 h-14 w-full rounded-[20px] border border-[#9eff00]/70 bg-[#9eff00] text-base font-semibold text-slate-950 shadow-[0_0_0_1px_rgba(158,255,0,0.18),0_18px_42px_rgba(158,255,0,0.28)] transition hover:-translate-y-0.5 hover:bg-[#b6ff33] hover:shadow-[0_24px_52px_rgba(158,255,0,0.34)] focus:outline-none focus:ring-2 focus:ring-[#9eff00]/45 focus:ring-offset-2 focus:ring-offset-[#06090a] disabled:translate-y-0 disabled:cursor-not-allowed disabled:border-white/14 disabled:bg-white/[0.09] disabled:text-slate-300 disabled:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    >
                      {unlockBusy ? 'Verifying...' : 'Unlock Punch Screen'}
                    </button>
                  </div>

                  {unlockStatus.message ? (
                    <p className={['mt-5 min-h-[1.25rem] text-sm', unlockToneClass[unlockStatus.tone]].join(' ')}>{unlockStatus.message}</p>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div
      className={[
        'min-h-screen',
        page === 'punch'
          ? 'h-screen overflow-hidden bg-[#fbfbfa] px-0 py-0 text-slate-950'
          : 'px-2 py-2 text-paper md:px-4 md:py-4'
      ].join(' ')}
    >
      {statusToast && (
        <div className="pointer-events-none fixed right-4 top-4 z-[110] flex max-w-[min(92vw,420px)] justify-end md:right-6 md:top-6">
          <div
            key={`${statusToast.tone}:${statusToast.message}`}
            className={[
              'w-full rounded-[20px] border px-4 py-3 text-sm font-semibold backdrop-blur-xl',
              statusToastClass[statusToast.tone]
            ].join(' ')}
          >
            {statusToast.message}
          </div>
        </div>
      )}
      {page === 'punch' && punchSuccessAnimation ? (
        <div className="punch-success-overlay" aria-live="polite">
          <div
            key={punchSuccessAnimation.key}
            className={[
              'punch-success-card',
              punchSuccessAnimation.action === 'IN' ? 'punch-success-card-in' : 'punch-success-card-out'
            ].join(' ')}
          >
            <div className="punch-success-orb">
              {punchSuccessAnimation.action === 'IN' ? <LogIn className="h-12 w-12" /> : <LogOut className="h-12 w-12" />}
            </div>
            <div className="min-w-0">
              <div className="punch-success-eyebrow">
                <CheckCircle2 className="h-4 w-4" />
                Punch saved
              </div>
              <div className="punch-success-name">{punchSuccessAnimation.staffName}</div>
            </div>
            <div className="punch-success-action">{punchSuccessAnimation.action}</div>
          </div>
        </div>
      ) : null}
      <div className="flex w-full flex-col gap-4">
        {page === 'punch' ? (
          <section className="reveal h-screen w-full overflow-hidden">
            <div className="punch-screen relative flex h-screen flex-col overflow-hidden bg-[#fbfbfa]">
              <header className="relative z-50 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-3 backdrop-blur md:px-8">
                <div className="flex items-center gap-3">
                  <img src="/img/Logo.png" alt="OBP logo" className="h-10 w-10 rounded-full object-cover shadow-[0_10px_24px_rgba(15,23,42,0.10)]" />
                  <div className="text-2xl font-semibold tracking-[0.02em] text-slate-950">OBPUNCH</div>
                </div>

                <div ref={punchMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setPunchMenuOpen((prev) => !prev)}
                    className="flex cursor-pointer items-center gap-2 rounded-full bg-transparent px-1 py-1 text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    aria-label="Open menu"
                  >
                    <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-950 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]" aria-label="User avatar">
                      {punchUserAvatarUrl ? (
                        <img src={punchUserAvatarUrl} alt="User avatar" className="h-full w-full object-cover" />
                      ) : unlockByLabel ? (
                        punchUserInitial
                      ) : (
                        <UserRound className="h-5 w-5" />
                      )}
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  {punchMenuOpen ? (
                    <>
                      <div className="absolute right-0 top-[calc(100%+0.5rem)] z-[999] min-w-[220px] rounded-[20px] border border-slate-200 bg-white p-2 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
                        <button
                          type="button"
                          onClick={() => {
                            setPunchMenuOpen(false);
                            window.location.href = '/admin.html';
                          }}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-slate-800 transition hover:bg-slate-100"
                        >
                          <Shield className="h-4 w-4 text-sky-600" />
                          <span>Admin</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPunchMenuOpen(false);
                            window.location.href = '/Dashboard';
                          }}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-slate-800 transition hover:bg-slate-100"
                        >
                          <LayoutDashboard className="h-4 w-4 text-emerald-600" />
                          <span>Dashboard</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPunchMenuOpen(false);
                            window.location.href = '/exception';
                          }}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-slate-800 transition hover:bg-slate-100"
                        >
                          <PackagePlus className="h-4 w-4 text-violet-600" />
                          <span>Outbound Exception</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPunchMenuOpen(false);
                            window.location.href = '/device.html';
                          }}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-slate-800 transition hover:bg-slate-100"
                        >
                          <Waypoints className="h-4 w-4 text-amber-600" />
                          <span>Device</span>
                        </button>
                        <div className="my-1 h-px bg-slate-200" />
                        <button
                          type="button"
                          onClick={() => {
                            setPunchMenuOpen(false);
                            void logoutPunchScreen();
                          }}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-rose-700 transition hover:bg-rose-50"
                        >
                          <LogOut className="h-4 w-4 text-rose-600" />
                          <span>Logout</span>
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </header>

              <div className="relative z-10 grid min-h-0 flex-1 items-start gap-4 overflow-hidden p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-[rgb(255,255,255)] px-4 pt-4 pb-0 shadow-[0_18px_50px_rgba(15,23,42,0.06)] md:px-5 md:pt-5">
                  <div
                    className={[
                      'punch-clock-card',
                      `punch-clock-card-${ambientPeriod}`,
                      'relative isolate grid min-h-[180px] overflow-hidden rounded-[24px] p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.18)] md:min-h-[200px] md:grid-cols-[minmax(0,1fr)_minmax(280px,38%)] md:p-8'
                    ].join(' ')}
                  >
                    <div className="relative z-10 flex min-w-0 flex-col justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
                        <Clock3 className="h-4 w-4" />
                        Live
                      </div>
                      <div className="text-[clamp(4rem,7.5vw,8rem)] font-semibold leading-none tracking-normal text-white">
                        {formatPunchClock(serverTime)}
                      </div>
                    </div>
                    <div className="absolute right-8 top-8 z-20 text-base font-semibold tracking-[0.14em] text-white/80">
                      {formatPunchDate(serverTime)}
                    </div>
                    <div className="pointer-events-none absolute inset-y-4 right-28 z-10 hidden w-[30%] min-w-[280px] max-w-[460px] md:block">
                      <TimeOfDayLottie period={ambientPeriod} />
                    </div>
                  </div>

                  <div
                    className={[
                      'mt-4 rounded-[24px] border p-4 transition-colors md:p-5',
                      lastPunchSummary?.status === 'error'
                        ? 'border-red-300 bg-red-50'
                        : lastPunchSummary?.status === 'success' && lastPunchSummary.action === 'IN'
                        ? 'border-emerald-300 bg-emerald-50/80'
                        : lastPunchSummary?.status === 'success' && lastPunchSummary.action === 'OUT'
                          ? 'border-rose-300 bg-white'
                          : 'border-slate-200 bg-[#f6f7f8]'
                    ].join(' ')}
                  >
                    <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div
                          className={[
                            'text-xs font-semibold uppercase tracking-[0.18em]',
                            lastPunchSummary?.status === 'error'
                              ? 'text-red-700'
                              : lastPunchSummary?.status === 'success' && lastPunchSummary.action === 'IN'
                              ? 'text-emerald-700'
                              : lastPunchSummary?.status === 'success' && lastPunchSummary.action === 'OUT'
                                ? 'text-rose-700'
                                : 'text-slate-500'
                          ].join(' ')}
                        >
                          Last Punch
                        </div>
                        <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                          <div className="min-w-0 text-4xl font-semibold tracking-normal text-slate-950 md:text-5xl">
                            {lastPunchSummary?.status === 'error'
                              ? lastPunchSummary.message
                              : lastPunchSummary?.staffName ?? 'Waiting'}
                          </div>
                          <div className="text-xl font-semibold text-slate-600 md:text-2xl">
                            {lastPunchSummary ? formatPunchSummaryTime(lastPunchSummary.at) : 'No punch yet'}
                          </div>
                        </div>
                      </div>
                      <div
                        className={[
                          'inline-flex h-20 min-w-40 items-center justify-center rounded-[20px] px-7 text-5xl font-semibold leading-none tracking-normal shadow-[0_16px_36px_rgba(15,23,42,0.12)] md:h-24 md:min-w-52 md:text-6xl',
                          lastPunchSummary?.status === 'error'
                            ? 'bg-red-600 text-white ring-1 ring-red-700'
                            : lastPunchSummary?.status === 'success' && lastPunchSummary.action === 'IN'
                            ? 'bg-emerald-600 text-white ring-1 ring-emerald-700'
                            : lastPunchSummary?.status === 'success' && lastPunchSummary.action === 'OUT'
                              ? 'bg-rose-600 text-white ring-1 ring-rose-700'
                              : 'bg-white text-slate-400 ring-1 ring-slate-200'
                        ].join(' ')}
                      >
                        {lastPunchSummary?.status === 'error'
                          ? 'ERROR'
                          : lastPunchSummary?.status === 'success'
                            ? lastPunchSummary.action
                            : '-'}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-1 items-start justify-center pt-8 md:pt-10">
                    <div className="punch-scan-area w-full max-w-[1280px]">
                      <div className="punch-scan-shell">
                        <input
                          id="punch-staff-id"
                          ref={inputRef}
                          value={staffId}
                          onChange={(event) => setStaffId(event.target.value)}
                          onKeyDown={onStaffIdKeyDown}
                          disabled={isLocked}
                          inputMode="text"
                          autoCapitalize="characters"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={barcodePrompt}
                          className="punch-scan-input"
                        />
                      </div>
                      <div className="punch-scan-mascot" aria-hidden="true">
                        <img src="/img/SCAN%20HERE.png" alt="" className="punch-scan-mascot-image punch-scan-mascot-scan" />
                        <img src="/img/GOOG.png" alt="" className="punch-scan-mascot-image punch-scan-mascot-good" />
                      </div>
                      {!lastPunchActionLoading && lastPunchActionError ? (
                        <div className="mt-4 flex justify-center">
                          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">
                            {lastPunchActionError}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>

                <aside className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_46px_rgba(15,23,42,0.06)]">
                  <section className="mb-4 rounded-[20px] bg-[#f8fafc] p-4 ring-1 ring-slate-200/80">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Device Log</div>
                        <div className="mt-1 text-sm font-semibold text-slate-950">Latest action</div>
                      </div>
                      <span
                        className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ${
                          deviceActionFeedback?.status === 'success'
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                            : deviceActionFeedback?.status === 'error'
                              ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                              : 'bg-white text-slate-500 ring-1 ring-slate-200'
                        }`}
                      >
                        {deviceActionFeedback?.status === 'success' ? 'Success' : deviceActionFeedback?.status === 'error' ? 'Failed' : 'Idle'}
                      </span>
                    </div>

                    {deviceActionFeedback ? (
                      <div className="mt-3 rounded-[16px] border border-slate-200 bg-white p-3">
                        <div className="flex items-start gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                              deviceActionFeedback.status === 'success' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                            }`}
                          >
                            {deviceActionFeedback.status === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="truncate text-sm font-semibold text-slate-950">{deviceActionFeedback.title}</p>
                              <span className="shrink-0 text-xs font-medium text-slate-400">{formatPunchSummaryTime(deviceActionFeedback.at)}</span>
                            </div>
                            <p className="mt-1 truncate text-xs font-medium text-slate-500">{deviceActionFeedback.detail}</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[16px] border border-dashed border-slate-200 bg-white px-3 py-4 text-sm font-medium text-slate-400">
                        No device action yet
                      </div>
                    )}
                  </section>

                  <section className="rounded-[20px] bg-[#f8fafc] p-4 ring-1 ring-slate-200/80">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                        <ArrowUpRight className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Device</div>
                        <div className="text-xl font-semibold tracking-normal text-slate-950">Borrow Device</div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3">
                      <label className="grid gap-2">
                        <span className="text-xs font-medium text-slate-500">USID</span>
                        <input
                          ref={deviceBorrowStaffRef}
                          value={deviceBorrowStaffId}
                          onChange={(event) => setDeviceBorrowStaffId(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              deviceBorrowSnRef.current?.focus();
                            }
                          }}
                          placeholder="USID"
                          className="h-11 rounded-[14px] border border-slate-200 bg-white px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-xs font-medium text-slate-500">Device SN</span>
                        <input
                          ref={deviceBorrowSnRef}
                          value={deviceBorrowSn}
                          onChange={(event) => setDeviceBorrowSn(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void submitDeviceQuickAction('borrow');
                            }
                          }}
                          placeholder="Device SN"
                          className="h-11 rounded-[14px] border border-slate-200 bg-white px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={isLocked || deviceQuickBusy !== ''}
                        onClick={() => void submitDeviceQuickAction('borrow')}
                        className="mt-1 inline-flex h-11 cursor-pointer items-center justify-center rounded-[14px] bg-slate-950 text-sm font-semibold text-white shadow-[0_12px_26px_rgba(15,23,42,0.14)] transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deviceQuickBusy === 'borrow' ? 'Submitting...' : 'Borrow'}
                      </button>
                    </div>
                  </section>

                  <div className="my-4 h-px bg-slate-200" />

                  <section className="rounded-[20px] bg-white p-4 ring-1 ring-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#f6f7f8] text-slate-950 ring-1 ring-slate-200">
                        <ArrowDownLeft className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Device</div>
                        <div className="text-xl font-semibold tracking-normal text-slate-950">Return Device</div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3">
                      <label className="grid gap-2">
                        <span className="text-xs font-medium text-slate-500">Device SN</span>
                        <input
                          ref={deviceReturnSnRef}
                          value={deviceReturnSn}
                          onChange={(event) => setDeviceReturnSn(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void submitDeviceQuickAction('return');
                            }
                          }}
                          placeholder="Scan Device SN"
                          className="h-11 rounded-[14px] border border-slate-200 bg-white px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={isLocked || deviceQuickBusy !== ''}
                        onClick={() => void submitDeviceQuickAction('return')}
                        className="mt-1 inline-flex h-11 cursor-pointer items-center justify-center rounded-[14px] bg-white text-sm font-semibold text-slate-950 ring-1 ring-slate-200 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deviceQuickBusy === 'return' ? 'Submitting...' : 'Return'}
                      </button>
                    </div>
                  </section>
                </aside>
              </div>
            </div>
          </section>
        ) : (
          <>
            <header className="glass reveal rounded-3xl px-6 py-6 shadow-glow">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">OBP</p>
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
                  1 Punch Board
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('log')}
                  className={tabClass(page === 'log')}
                >
                  2 Punch Logs
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('employee')}
                  className={tabClass(page === 'employee')}
                >
                  3 Employee Info
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('edit')}
                  className={tabClass(page === 'edit')}
                >
                  4 Edit Request
                </button>
              </nav>
            </header>

            {staffIdPanel}
          </>
        )}

        {page === 'log' && (
          <section className="glass reveal rounded-3xl px-6 py-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl tracking-[0.08em]">打卡记录</h2>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => void fetchPunches()}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                刷新
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Read-only list. No update/delete. {isValidId ? `Current filter: ${normalizedId}` : 'No filter (latest 50)'}
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
              <h2 className="font-display text-2xl tracking-[0.08em]">员工信息</h2>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => void fetchEmployee()}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                查询
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              默认表：<span className="text-slate-200">{EMPLOYEE_TABLE}</span>（按 created_at 取最新一条）
            </p>
            {employeeError && <p className="mt-4 text-sm text-ember">Query failed: {employeeError}</p>}
            {!employeeError && !employee && <p className="mt-4 text-sm text-slate-400">请输入工号后查询</p>}
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
              <h2 className="font-display text-2xl tracking-[0.08em]">修改信息（提交申请）</h2>
              <button
                type="button"
                disabled={isLocked || !isValidId}
                onClick={() => void submitEmployeeChange()}
                className="rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                提交申请
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              No update/upsert. Writes to: <span className="text-slate-200">{EMPLOYEE_REQUESTS_TABLE}</span>
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">姓名</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={isLocked}
                  placeholder="Optional"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">部门</label>
                <input
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  disabled={isLocked}
                  placeholder="Optional"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">电话</label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  disabled={isLocked}
                  placeholder="Optional"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">备注</label>
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

        {deviceBorrowPrompt && (
          <div className="fixed inset-0 z-[118] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.26)]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Device</div>
                  <div className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Borrow Device</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeviceBorrowPrompt(null);
                    setDeviceBorrowStaffId('');
                    setDeviceBorrowSn('');
                    setStaffId('');
                    window.setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                  className="inline-flex h-9 items-center rounded-[14px] bg-white px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                  Close
                </button>
              </div>
              <div className="mt-5 rounded-[18px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="truncate text-sm font-semibold text-slate-950">{deviceBorrowPrompt.name}</div>
                <div className="mt-1 text-xs font-medium text-slate-500">SN {deviceBorrowPrompt.sn}</div>
              </div>
              <label className="mt-5 grid gap-2">
                <span className="text-xs font-medium text-slate-500">USID</span>
                <input
                  ref={punchDeviceBorrowStaffRef}
                  value={deviceBorrowStaffId}
                  onChange={(event) => setDeviceBorrowStaffId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitDeviceQuickAction('borrow');
                    }
                  }}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Scan USID"
                  className="h-14 rounded-[16px] border border-slate-200 bg-white px-4 text-xl font-semibold tracking-normal text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-4 focus:ring-slate-200"
                />
              </label>
              <button
                type="button"
                disabled={isLocked || deviceQuickBusy !== ''}
                onClick={() => void submitDeviceQuickAction('borrow')}
                className="mt-4 inline-flex h-12 w-full cursor-pointer items-center justify-center rounded-[16px] bg-slate-950 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deviceQuickBusy === 'borrow' ? 'Submitting...' : 'Borrow'}
              </button>
            </div>
          </div>
        )}

        {busyVisible && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 backdrop-blur-sm">
            <div className="glass flex items-center gap-3 rounded-2xl px-5 py-4 shadow-2xl">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-neon/25 border-t-neon" />
              <span className="text-sm font-semibold text-slate-100">Processing request...</span>
            </div>
          </div>
        )}

        {deviceReturnReminder && (
          <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/45 px-4">
            <div className="glass w-full max-w-xl rounded-2xl border border-amber-300/40 p-5 shadow-2xl">
              <div className="text-lg font-semibold text-amber-200">Device Return Reminder</div>
              <div className="mt-2 text-sm text-slate-200">
                {deviceReturnReminder.staffName} punched OUT but still has {deviceReturnReminder.items.length} borrowed device(s).
              </div>
              <div className="mt-1 text-sm text-slate-300">
                {deviceReturnReminder.staffName} marcó SALIDA pero todavía tiene {deviceReturnReminder.items.length} dispositivo(s) prestado(s).
              </div>
              <div className="mt-3 max-h-60 space-y-2 overflow-auto pr-1">
                {deviceReturnReminder.items.map((item) => (
                  <div key={item.deviceSn} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <div className="text-sm font-semibold text-slate-100">
                      {item.deviceName} · {item.deviceType || 'Device'}{item.position ? ` · ${item.position}` : ''}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = '/device.html';
                  }}
                  className="rounded-xl bg-neon px-3 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5"
                >
                  Go Device
                </button>
                <button
                  type="button"
                  onClick={() => setDeviceReturnReminder(null)}
                  className="rounded-xl bg-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/15"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="text-center text-xs text-slate-500">
          {isLocked && "Request in progress; input locked."}
        </footer>
      </div>
    </div>
  );
}
