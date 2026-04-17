import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { createSupabaseClient } from './lib/supabase';
import { normalizeStaffId } from './lib/staffId';
import { getLabelToneClass, loadLabelToneMap } from './lib/labelTone';
import AppDialog from './components/AppDialog';

type EmployeeRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  label: string;
  work_account: string;
  work_password: string;
  hire_date: string;
  shift: string;
  active?: boolean | null;
  terminated_at?: string | null;
};

type PunchRow = {
  id: string;
  staff_id: string;
  action: 'IN' | 'OUT';
  created_at: string;
};

type DashboardRow = EmployeeRow & {
  punches: PunchRow[];
  attendance: 'Absent' | 'Off Worked' | 'Normal';
  work_hours_today: number;
  mistake_count_7d: number;
  display_shift: '' | 'early' | 'late';
  borrowed_device: string;
  schedule_state: string;
  temp_account_name: string;
  temp_source_staff_id: string;
};

type TempAccountUsageRow = {
  id: string;
  staff_id: string;
  name: string;
  position: string;
  work_account: string;
  account_name: string;
  source_temp_staff_id: string;
  created_at: string;
  status: 'Active' | 'Expired';
};

type MistakeDetailRow = {
  id: string;
  employee_staff_id: string;
  position: string;
  reason: string;
  reporter_staff_id: string;
  reporter_name?: string;
  operational_date: string;
  created_at: string;
};

type IconProps = {
  className?: string;
};

const iconStrokeClass = 'h-4 w-4 shrink-0';

const SearchIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l5 5" strokeLinecap="round" />
  </svg>
);

const RefreshIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M20 6v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 11a8 8 0 10-2.34 5.66L20 14" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ArrowLeftIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M19 12H5" strokeLinecap="round" />
    <path d="M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DocumentIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M7 3.5h7l4.5 4.5V20a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 015.5 20V5A1.5 1.5 0 017 3.5z" />
    <path d="M14 3.5V8h4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const GridIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <rect x="4" y="4" width="6" height="6" rx="1.25" />
    <rect x="14" y="4" width="6" height="6" rx="1.25" />
    <rect x="4" y="14" width="6" height="6" rx="1.25" />
    <rect x="14" y="14" width="6" height="6" rx="1.25" />
  </svg>
);

const ChevronDownIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const WarningIcon = ({ className = iconStrokeClass }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
    <path d="M12 4l8 14H4l8-14z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 9v4.5" strokeLinecap="round" />
    <circle cx="12" cy="16.75" r=".75" fill="currentColor" stroke="none" />
  </svg>
);

const getAutoMistakeReasonText = (attendance: DashboardRow['attendance']) => {
  if (attendance === 'Absent') return 'Absent';
  if (attendance === 'Off Worked') return 'Off Worked';
  return null;
};

const buildAutoMistakeDetailRow = (row: DashboardRow, date: string): MistakeDetailRow | null => {
  const reason = getAutoMistakeReasonText(row.attendance);
  if (!reason) return null;
  const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
  if (!staffId) return null;
  const createdAt = new Date(`${date}T00:00:00`).toISOString();
  return {
    id: `auto:${staffId}:${date}`,
    employee_staff_id: staffId,
    position: String(row.position ?? '').trim(),
    reason,
    reporter_staff_id: 'SYSTEM',
    reporter_name: 'System',
    operational_date: date,
    created_at: createdAt
  };
};

type TempAssignmentPayload = {
  work_account: string;
  work_password: string;
  account_name: string;
  source_temp_staff_id: string;
};

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const PUNCHES_TABLE = 'ob_punches';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';

const isEmployeeActive = (employee: { active?: unknown; terminated_at?: unknown } | null | undefined) => {
  if (!employee) return false;
  const terminatedAt = String(employee.terminated_at ?? '').trim();
  if (terminatedAt) return false;
  const raw = employee.active;
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  if (!text) return true;
  return text !== 'false' && text !== '0' && text !== 'f' && text !== 'no';
};
const TEMP_ACCOUNT_TABLE = (import.meta.env.VITE_TEMP_ACCOUNT_TABLE as string | undefined) ?? 'ob_temp_accounts';
const TEMP_ACCOUNT_ASSIGNMENT_TABLE =
  (import.meta.env.VITE_TEMP_ACCOUNT_ASSIGNMENT_TABLE as string | undefined) ?? 'ob_temp_account_assignments';
const DEVICE_TABLE = (import.meta.env.VITE_DEVICE_TABLE as string | undefined) ?? 'ob_devices';
const DEVICE_LOANS_TABLE = (import.meta.env.VITE_DEVICE_LOANS_TABLE as string | undefined) ?? 'ob_device_loans';
const DEVICE_LOANS_FETCH_LIMIT = 50000;
const MISTAKE_REPORT_TABLE = (import.meta.env.VITE_MISTAKE_REPORT_TABLE as string | undefined) ?? 'ob_mistake_reports';
const DASHBOARD_REFRESH_INTERVAL_MS = 15000;
const supabase = createSupabaseClient({ persistSession: true });
const QR_PRINT_SIZE = 320;
const SCHEDULE_TEMPLATE_WEEK_START = new Date('2000-01-03T00:00:00');
const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW)
  ? Math.min(23, Math.max(0, DAY_CUTOFF_HOUR_RAW))
  : 5;
const DEFAULT_TEMP_ACCOUNT_PASSWORD = 'Helloworld2!';
const normalizeWorkAccountValue = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (raw === '-' || raw === '--' || lower === 'n/a' || lower === 'na' || lower === 'null') return '';
  return raw;
};
const resolveDefaultPassword = (workAccount: string, workPassword: string) =>
  normalizeWorkAccountValue(workAccount) && !workPassword ? DEFAULT_TEMP_ACCOUNT_PASSWORD : workPassword;

const toDateOnly = (d: Date) => {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getOperationalRange = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(DAY_CUTOFF_HOUR, 0, 0, 0);
  if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    start,
    end,
    operationalDate: toDateOnly(start)
  };
};

const normalizeDateOnly = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const isoPrefix = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[tT\s].*)?$/);
  if (isoPrefix) return `${isoPrefix[1]}-${isoPrefix[2]}-${isoPrefix[3]}`;
  const slash = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  const slashPrefix = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s.*)?$/);
  if (slashPrefix) return `${slashPrefix[1]}-${slashPrefix[2]}-${slashPrefix[3]}`;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return dateOnly[0];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return toDateOnly(parsed);
};

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-CA', { hour12: false });
};
const formatTimeOnly = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-CA', { hour12: false });
};
const formatShiftLabel = (value: string) => {
  const v = normalizeShiftValue(value);
  if (v === 'early') return 'Morning';
  if (v === 'late') return 'Night';
  return value || '-';
};
const normalizeShiftValue = (value: unknown): '' | 'early' | 'late' => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'early' || v === 'morning' || v === 'day' || v === 'am') return 'early';
  if (v === 'late' || v === 'night' || v === 'pm') return 'late';
  return '';
};
const normalizePositionKey = (value: string): '' | 'Pick' | 'Pack' | 'Rebin' | 'Preship' | 'Transfer' | 'FLEX TEAM' => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'pick' || v.includes('pick')) return 'Pick';
  if (v === 'pack' || v.includes('pack')) return 'Pack';
  if (v === 'rebin' || v.includes('rebin')) return 'Rebin';
  if (v === 'preship' || v.includes('preship')) return 'Preship';
  if (v === 'transfer' || v.includes('transfer')) return 'Transfer';
  if (
    v === '兜底组' ||
    v === '兜底' ||
    v === 'flex team（机动组）' ||
    v === 'flex team' ||
    v === 'flexteam' ||
    v.includes('wrap-up') ||
    v.includes('wrap up') ||
    v.includes('wrapup') ||
    v.includes('fallback') ||
    v.includes('backup')
  ) {
    return 'FLEX TEAM';
  }
  return '';
};
const getPositionBadgeClass = (value: string) => {
  const pos = normalizePositionKey(value);
  if (pos === 'Pick') return 'badge-elevated-dark border-sky-300/30 text-sky-100 bg-sky-400/[0.13]';
  if (pos === 'Pack') return 'badge-elevated-dark border-rose-300/30 text-rose-100 bg-rose-400/[0.13]';
  if (pos === 'Rebin') return 'badge-elevated-dark border-emerald-300/30 text-emerald-100 bg-emerald-400/[0.13]';
  if (pos === 'Preship') return 'badge-elevated-dark border-amber-300/30 text-amber-100 bg-amber-400/[0.13]';
  if (pos === 'Transfer') return 'badge-elevated-dark border-violet-300/30 text-violet-100 bg-violet-400/[0.13]';
  if (pos === 'FLEX TEAM') return 'badge-elevated-dark border-slate-300/30 text-slate-100 bg-slate-400/[0.13]';
  return 'badge-elevated-dark border-white/12 text-stone-100 bg-white/[0.05]';
};
const getShiftBadgeClass = (value: string) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'early') return 'badge-elevated-dark border-amber-300/24 text-amber-100 bg-amber-400/[0.10]';
  if (v === 'late') return 'badge-elevated-dark border-indigo-300/24 text-indigo-100 bg-indigo-400/[0.10]';
  return 'badge-elevated-dark border-white/12 text-stone-100 bg-white/[0.05]';
};
const DEFAULT_CARD_POSITIONS: string[] = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer'];
const getAttendanceCardClass = (position: string) => {
  const pos = normalizePositionKey(position);
  if (pos === 'Pick') return 'border-sky-300/20 bg-gradient-to-br from-sky-400/[0.14] via-sky-300/[0.06] to-transparent';
  if (pos === 'Pack') return 'border-emerald-300/20 bg-gradient-to-br from-emerald-400/[0.14] via-emerald-300/[0.06] to-transparent';
  if (pos === 'Rebin') return 'border-amber-300/20 bg-gradient-to-br from-amber-400/[0.16] via-amber-300/[0.07] to-transparent';
  if (pos === 'Preship') return 'border-rose-300/20 bg-gradient-to-br from-rose-400/[0.14] via-rose-300/[0.06] to-transparent';
  if (pos === 'Transfer') return 'border-violet-300/20 bg-gradient-to-br from-violet-400/[0.14] via-violet-300/[0.06] to-transparent';
  if (pos === 'FLEX TEAM') return 'border-slate-300/20 bg-gradient-to-br from-slate-400/[0.14] via-slate-300/[0.06] to-transparent';
  return 'border-white/12 bg-white/[0.03]';
};
const getAttendanceCardValueClass = (position: string) => {
  const pos = normalizePositionKey(position);
  if (pos === 'Pick') return 'text-sky-100';
  if (pos === 'Pack') return 'text-emerald-100';
  if (pos === 'Rebin') return 'text-amber-100';
  if (pos === 'Preship') return 'text-rose-100';
  if (pos === 'Transfer') return 'text-violet-100';
  if (pos === 'FLEX TEAM') return 'text-slate-100';
  return 'text-stone-100';
};

const chunkArray = <T,>(list: T[], size: number): T[][] => {
  if (size <= 0) return [list];
  const chunks: T[][] = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
};

const computeWorkHoursFromPunches = (punches: PunchRow[], capEnd: Date) => {
  if (!punches.length) return 0;
  const capEndMs = capEnd.getTime();
  if (!Number.isFinite(capEndMs)) return 0;
  let totalMs = 0;
  let currentInMs: number | null = null;
  for (const p of punches) {
    const atMs = Date.parse(String(p.created_at ?? ''));
    if (!Number.isFinite(atMs)) continue;
    if (p.action === 'IN') {
      currentInMs = atMs;
      continue;
    }
    if (p.action === 'OUT') {
      if (currentInMs !== null && atMs > currentInMs) totalMs += atMs - currentInMs;
      currentInMs = null;
    }
  }
  if (currentInMs !== null && capEndMs > currentInMs) totalMs += capEndMs - currentInMs;
  return totalMs / 3600000;
};

const addDays = (value: Date, days: number) => {
  const d = new Date(value);
  d.setDate(d.getDate() + days);
  return d;
};

const getTemplateDateByDayIndex = (dayIndex: number) => toDateOnly(addDays(SCHEDULE_TEMPLATE_WEEK_START, dayIndex));
const normalizeDeviceSn = (value: string) => String(value ?? '').trim().toUpperCase();
const isNewHirePlaceholderStaffId = (value: string) => {
  const id = String(value ?? '').trim();
  if (!id) return false;
  if (/^newreq[-_]/i.test(id)) return true;
  return /^newreq[-_]\d{8}(?:[-_][a-z]+)?[-_]\d+$/i.test(id);
};

const toEpochMs = (value: unknown) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
};

const pickLatestByStaff = <T extends { staff_id?: unknown; updated_at?: unknown; created_at?: unknown; id?: unknown }>(rows: T[]) => {
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
    if (Number.isFinite(curId) && Number.isFinite(prevId) && curId > prevId) byStaff.set(staff, row);
  }
  return Array.from(byStaff.values());
};

const getScheduleStateFromNote = (note: unknown) => {
  const raw = String(note ?? '').trim();
  if (raw === '__new__') return 'new';
  if (raw === '__temp_work__') return 'temp_work';
  if (raw === '__replacement__') return 'planned_temp_work';
  if (raw === '__planned_temp_work__') return 'planned_temp_work';
  if (raw === '__leave__') return 'leave';
  if (raw === '__planned_leave__') return 'planned_leave';
  if (raw === '__temp_rest__') return 'temp_rest';
  if (raw === '__planned_temp_rest__') return 'planned_temp_rest';
  if (raw === '__rest__') return 'rest';
  return 'work';
};

const isWorkingScheduleState = (state: string) =>
  state === 'new' || state === 'work' || state === 'temp_work' || state === 'planned_temp_work';

const isMissingColumnError = (message: unknown, column: string) =>
  (() => {
    const text = String(message ?? '').toLowerCase();
    const col = String(column ?? '').toLowerCase();
    return (
      (text.includes('does not exist') || text.includes('not exist') || text.includes('undefined column')) &&
      (text.includes(`.${col}`) || text.includes(`'${col}'`) || text.includes(`"${col}"`) || text.includes(col))
    );
  })();

const isMissingTableError = (message: unknown, table: string) => {
  const text = String(message ?? '').toLowerCase();
  const target = String(table ?? '').toLowerCase();
  return (
    text.includes(`could not find the table`) ||
    text.includes('relation') ||
    text.includes('does not exist')
  )
    && text.includes(target);
};

const normalizeSearchToken = (value: string) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const staffIdSearchMatches = (query: string, staffId: string) => {
  const q = normalizeSearchToken(query);
  const s = normalizeSearchToken(staffId);
  if (!q || !s) return false;
  if (s.includes(q) || q.includes(s)) return true;

  const qNoPrefix = q.startsWith('us') ? q.slice(2) : q;
  const sNoPrefix = s.startsWith('us') ? s.slice(2) : s;
  if ((qNoPrefix && s.includes(qNoPrefix)) || (sNoPrefix && q.includes(sNoPrefix))) return true;

  const qDigits = qNoPrefix.replace(/\D/g, '');
  const sDigits = sNoPrefix.replace(/\D/g, '');
  if (!qDigits || !sDigits) return false;
  return sDigits.includes(qDigits) || qDigits.includes(sDigits);
};

const escapeHtml = (value: string) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const printHtmlDocument = async (html: string, removeDelayMs = 1500) => {
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
    throw new Error('Cannot create print document.');
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
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  window.setTimeout(() => iframe.remove(), removeDelayMs);
};

const getShortGapPunchIndices = (punches: PunchRow[], thresholdMinutes = 10) => {
  const flagged = new Set<number>();
  const thresholdMs = Math.max(1, thresholdMinutes) * 60 * 1000;
  for (let i = 0; i < punches.length - 1; i += 1) {
    const currentMs = Date.parse(String(punches[i]?.created_at ?? ''));
    const nextMs = Date.parse(String(punches[i + 1]?.created_at ?? ''));
    if (!Number.isFinite(currentMs) || !Number.isFinite(nextMs)) continue;
    if (nextMs >= currentMs && nextMs - currentMs < thresholdMs) {
      flagged.add(i);
      flagged.add(i + 1);
    }
  }
  return flagged;
};

export default function DashboardPage() {
  // --- Session restoration logic for Punch Screen auto-login ---
  const [user, setUser] = useState<User | null>(null);
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
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [cardStatsByKey, setCardStatsByKey] = useState<Record<string, { expected: number; present: number; onClock: number; offWorked: number }>>({});
  const [cardPositions, setCardPositions] = useState<string[]>(DEFAULT_CARD_POSITIONS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');
  const [absentOnly, setAbsentOnly] = useState(false);
  const [onClockOnly, setOnClockOnly] = useState(false);
  const [offWorkOnly, setOffWorkOnly] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [operationalDate, setOperationalDate] = useState('');
  const [renderCount, setRenderCount] = useState(120);
  const [badgePrintingStaffId, setBadgePrintingStaffId] = useState<string | null>(null);
  const [accountPrintingStaffId, setAccountPrintingStaffId] = useState<string | null>(null);
  const [accountAssigningStaffId, setAccountAssigningStaffId] = useState<string | null>(null);
  const [accountUsageOpen, setAccountUsageOpen] = useState(false);
  const [mistakeReportOpen, setMistakeReportOpen] = useState(false);
  const [mistakeReportPosition, setMistakeReportPosition] = useState('');
  const [mistakeReportEmployeeStaffId, setMistakeReportEmployeeStaffId] = useState('');
  const [mistakeReportEmployeeQuery, setMistakeReportEmployeeQuery] = useState('');
  const [mistakeReportEmployeeDropdownOpen, setMistakeReportEmployeeDropdownOpen] = useState(false);
  const [mistakeReportReason, setMistakeReportReason] = useState('');
  const [mistakeReportReporterStaffId, setMistakeReportReporterStaffId] = useState('');
  const [mistakeReportSubmitting, setMistakeReportSubmitting] = useState(false);
  const [mistakeDetailOpen, setMistakeDetailOpen] = useState(false);
  const [mistakeDetailLoading, setMistakeDetailLoading] = useState(false);
  const [mistakeDetailRows, setMistakeDetailRows] = useState<MistakeDetailRow[]>([]);
  const [mistakeDetailStaffId, setMistakeDetailStaffId] = useState('');
  const [mistakeDetailStaffName, setMistakeDetailStaffName] = useState('');
  const [mistakeDetailError, setMistakeDetailError] = useState<string | null>(null);
  const [punchDetailOpen, setPunchDetailOpen] = useState(false);
  const [punchDetailStaffId, setPunchDetailStaffId] = useState('');
  const [punchDetailStaffName, setPunchDetailStaffName] = useState('');
  const [punchDetailRows, setPunchDetailRows] = useState<PunchRow[]>([]);
  const [accountUsageSearch, setAccountUsageSearch] = useState('');
  const [accountUsagePositionFilter, setAccountUsagePositionFilter] = useState('');
  const [noticeDialog, setNoticeDialog] = useState<{ open: boolean; title: string; message: string }>({
    open: false,
    title: '',
    message: ''
  });
  const openNoticeDialog = (message: string, title = 'Notice') => {
    setNoticeDialog({ open: true, title, message });
  };
  const [accountUsageRows, setAccountUsageRows] = useState<TempAccountUsageRow[]>([]);
  const inFlightRef = useRef(false);
  const mistakeEmployeePickerRef = useRef<HTMLDivElement | null>(null);
  const fetchSeqRef = useRef(0);
  const employeeCacheRef = useRef<Map<string, EmployeeRow>>(new Map());
  const qrDataUrlCacheRef = useRef<Map<string, string>>(new Map());
  const rowsDigestRef = useRef('');

  const fetchData = async (force = false) => {
    if (!supabase) {
      setError('Missing Supabase configuration.');
      setRows([]);
      return;
    }
    if (inFlightRef.current && !force) return;

    inFlightRef.current = true;
    const currentSeq = fetchSeqRef.current + 1;
    fetchSeqRef.current = currentSeq;
    setLoading(true);
    setError(null);

    try {
      const range = getOperationalRange();
      const rangeStartIso = range.start.toISOString();
      const rangeEndIso = range.end.toISOString();
      const capEnd = new Date(Math.min(Date.now(), range.end.getTime()));
      const currentOperationalDate = range.operationalDate;
      const operationalDateObj = new Date(`${currentOperationalDate}T00:00:00`);
      const operationalDayIndex = Number.isNaN(operationalDateObj.getTime()) ? 0 : (operationalDateObj.getDay() + 6) % 7;
      const templateDate = getTemplateDateByDayIndex(operationalDayIndex);
      let scheduleRowsRaw: any[] = [];
      const scheduleByDateRes = await supabase
        .from(SCHEDULE_TABLE)
        .select('id, staff_id, note, updated_at, created_at, date')
        .eq('date', templateDate)
        .order('created_at', { ascending: false })
        .limit(20000);

      if (scheduleByDateRes.error) {
        if (fetchSeqRef.current === currentSeq) {
          setError(scheduleByDateRes.error.message);
          setRows([]);
        }
        return;
      }
      scheduleRowsRaw = ((scheduleByDateRes.data as any[]) ?? []);

      if (scheduleRowsRaw.length === 0) {
        const scheduleByDateRangeRes = await supabase
          .from(SCHEDULE_TABLE)
          .select('id, staff_id, note, updated_at, created_at, date')
          .gte('date', `${templateDate}T00:00:00`)
          .lt('date', `${templateDate}T23:59:59.999`)
          .order('created_at', { ascending: false })
          .limit(20000);

        if (!scheduleByDateRangeRes.error) {
          scheduleRowsRaw = ((scheduleByDateRangeRes.data as any[]) ?? []);
        } else if (!isMissingColumnError(scheduleByDateRangeRes.error.message, 'date')) {
          if (fetchSeqRef.current === currentSeq) {
            setError(scheduleByDateRangeRes.error.message);
            setRows([]);
          }
          return;
        }
      }

      if (scheduleRowsRaw.length === 0) {
        const scheduleByWorkDateRes = await supabase
          .from(SCHEDULE_TABLE)
          .select('id, staff_id, note, updated_at, created_at, work_date')
          .eq('work_date', currentOperationalDate)
          .order('created_at', { ascending: false })
          .limit(20000);

        if (!scheduleByWorkDateRes.error) {
          scheduleRowsRaw = ((scheduleByWorkDateRes.data as any[]) ?? []);
        } else if (!isMissingColumnError(scheduleByWorkDateRes.error.message, 'work_date')) {
          if (fetchSeqRef.current === currentSeq) {
            setError(scheduleByWorkDateRes.error.message);
            setRows([]);
          }
          return;
        }
      }

      if (scheduleRowsRaw.length === 0) {
        const recentScheduleRes = await supabase
          .from(SCHEDULE_TABLE)
          .select('id, staff_id, note, updated_at, created_at, date')
          .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(30000);

        if (!recentScheduleRes.error) {
          scheduleRowsRaw = (((recentScheduleRes.data as any[]) ?? []) as any[]).filter(
            (row) => normalizeDateOnly((row as any).date) === templateDate
          );
        } else if (fetchSeqRef.current === currentSeq) {
          setError(recentScheduleRes.error.message);
          setRows([]);
          return;
        }
      }

      const latestScheduleRows = pickLatestByStaff(scheduleRowsRaw);
      const scheduledByStaff = new Map<string, { scheduleState: string }>();
      for (const row of latestScheduleRows) {
        const staffId = normalizeStaffId(String((row as any).staff_id ?? '').trim());
        if (!staffId) continue;
        const scheduleState = getScheduleStateFromNote((row as any).note);
        scheduledByStaff.set(staffId, { scheduleState });
      }
      const scheduledStaffIds = Array.from(scheduledByStaff.keys());

      const punchesByStaff = new Map<string, PunchRow[]>();
      const punchesRes = await supabase
        .from(PUNCHES_TABLE)
        .select('id, staff_id, action, created_at')
        .gte('created_at', rangeStartIso)
        .lt('created_at', rangeEndIso)
        .order('created_at', { ascending: true })
        .limit(20000);
      if (punchesRes.error) {
        if (fetchSeqRef.current === currentSeq) {
          setError(punchesRes.error.message);
          setRows([]);
        }
        return;
      }
      for (const row of ((punchesRes.data as any[] | null) ?? [])) {
        const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (!staffId) continue;
        const normalizedPunch: PunchRow = {
          id: String(row.id ?? ''),
          staff_id: staffId,
          action: String(row.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
          created_at: String(row.created_at ?? '')
        };
        const list = punchesByStaff.get(staffId) ?? [];
        list.push(normalizedPunch);
        punchesByStaff.set(staffId, list);
      }
      const punchedStaffIds = Array.from(punchesByStaff.keys());
      const displayStaffIds = Array.from(new Set([...scheduledStaffIds, ...punchedStaffIds]));

      if (displayStaffIds.length === 0) {
        if (fetchSeqRef.current === currentSeq) {
          setRows([]);
          setOperationalDate(currentOperationalDate);
          setLastUpdatedAt(new Date().toLocaleString('en-CA', { hour12: false }));
        }
        return;
      }

      const fetchedEmployeesByStaff = new Map<string, EmployeeRow>();
      const activeEmployeeStaffIds = new Set<string>();
      for (const staffIds of chunkArray(displayStaffIds, 200)) {
        const employeeRes = await supabase
          .from(EMPLOYEE_TABLE)
          .select('*')
          .in('staff_id', staffIds)
          .order('created_at', { ascending: false })
          .limit(5000);

        if (employeeRes.error) {
          if (fetchSeqRef.current === currentSeq) {
            setError(employeeRes.error.message);
            setRows([]);
          }
          return;
        }

        for (const row of ((employeeRes.data as any[] | null) ?? [])) {
          const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
          if (!staffId || fetchedEmployeesByStaff.has(staffId) || !isEmployeeActive(row)) continue;
          activeEmployeeStaffIds.add(staffId);
          fetchedEmployeesByStaff.set(staffId, {
            staff_id: staffId,
            name: String(row.name ?? '').trim(),
            agency: String(row.agency ?? '').trim(),
            position: String(row.position ?? row.Position ?? '').trim(),
            label: String(row.label ?? row.Label ?? '').trim(),
            work_account: normalizeWorkAccountValue(row.work_account),
            work_password: resolveDefaultPassword(
              normalizeWorkAccountValue(row.work_account),
              String(row.work_password ?? '').trim()
            ),
            hire_date: String(row.hire_date ?? '').trim(),
            shift: String(row.shift ?? '').trim(),
            active: row.active ?? null,
            terminated_at: row.terminated_at ?? null
          });
        }
      }
      const activeDisplayStaffIds = displayStaffIds.filter((staffId) => activeEmployeeStaffIds.has(staffId));
      const activeScheduledStaffIds = scheduledStaffIds.filter((staffId) => activeEmployeeStaffIds.has(staffId));
      const activePunchedStaffIds = punchedStaffIds.filter((staffId) => activeEmployeeStaffIds.has(staffId));

      for (const staffId of displayStaffIds) {
        const employee = fetchedEmployeesByStaff.get(staffId);
        if (employee) employeeCacheRef.current.set(staffId, employee);
        else employeeCacheRef.current.delete(staffId);
      }

      const staffByKey = new Map<string, Set<string>>();
      const restByKey = new Map<string, Set<string>>();
      const keysByStaff = new Map<string, string[]>();
      const hasWorkScheduleStaff = new Set<string>();
      const hasRestScheduleStaff = new Set<string>();
      for (const staffId of activeScheduledStaffIds) {
        const schedule = scheduledByStaff.get(staffId);
        if (!schedule) continue;
        const employeePosition = normalizePositionKey(String(employeeCacheRef.current.get(staffId)?.position ?? ''));
        const position = employeePosition;
        const shift = normalizeShiftValue(String(employeeCacheRef.current.get(staffId)?.shift ?? ''));
        if (!position || !shift) continue;
        const key = `${shift}:${position}`;
        const isWork = isWorkingScheduleState(String(schedule.scheduleState ?? ''));
        if (isWork) {
          hasWorkScheduleStaff.add(staffId);
          if (!staffByKey.has(key)) staffByKey.set(key, new Set());
          staffByKey.get(key)?.add(staffId);
          const keys = keysByStaff.get(staffId) ?? [];
          if (!keys.includes(key)) keys.push(key);
          keysByStaff.set(staffId, keys);
        } else {
          hasRestScheduleStaff.add(staffId);
          if (!restByKey.has(key)) restByKey.set(key, new Set());
          restByKey.get(key)?.add(staffId);
          const keys = keysByStaff.get(staffId) ?? [];
          if (!keys.includes(key)) keys.push(key);
          keysByStaff.set(staffId, keys);
        }
      }
      for (const staffId of activePunchedStaffIds) {
        if (keysByStaff.has(staffId) || hasWorkScheduleStaff.has(staffId) || hasRestScheduleStaff.has(staffId)) continue;
        const employee = employeeCacheRef.current.get(staffId);
        const position = normalizePositionKey(String(employee?.position ?? ''));
        const shift = normalizeShiftValue(String(employee?.shift ?? ''));
        if (!position || !shift) continue;
        keysByStaff.set(staffId, [`${shift}:${position}`]);
      }
      const arrivedByKey = new Map<string, Set<string>>();
      for (const staffId of punchedStaffIds) {
        const keys = keysByStaff.get(staffId) ?? [];
        for (const key of keys) {
          if (!arrivedByKey.has(key)) arrivedByKey.set(key, new Set());
          arrivedByKey.get(key)?.add(staffId);
        }
      }
      const onClockByKey = new Map<string, Set<string>>();
      for (const [staffId, punches] of punchesByStaff.entries()) {
        if (!activeEmployeeStaffIds.has(staffId)) continue;
        const last = punches[punches.length - 1];
        if (!last || last.action !== 'IN') continue;
        const keys = keysByStaff.get(staffId) ?? [];
        for (const key of keys) {
          if (!onClockByKey.has(key)) onClockByKey.set(key, new Set());
          onClockByKey.get(key)?.add(staffId);
        }
      }
      const restWorkedByKey = new Map<string, Set<string>>();
      for (const [key, restSet] of restByKey.entries()) {
        for (const staffId of restSet) {
          if (!activeEmployeeStaffIds.has(staffId) || !activePunchedStaffIds.includes(staffId)) continue;
          if (!restWorkedByKey.has(key)) restWorkedByKey.set(key, new Set());
          restWorkedByKey.get(key)?.add(staffId);
        }
      }
      for (const staffId of activePunchedStaffIds) {
        if (hasWorkScheduleStaff.has(staffId) || hasRestScheduleStaff.has(staffId)) continue;
        const keys = keysByStaff.get(staffId) ?? [];
        for (const key of keys) {
          if (!restWorkedByKey.has(key)) restWorkedByKey.set(key, new Set());
          restWorkedByKey.get(key)?.add(staffId);
        }
      }
      const nextCardStatsByKey: Record<string, { expected: number; present: number; onClock: number; offWorked: number }> = {};
      const positionOrder = new Map(DEFAULT_CARD_POSITIONS.map((position, index) => [position, index] as const));
      const positionUniverse = new Set<string>(DEFAULT_CARD_POSITIONS);
      for (const key of [...staffByKey.keys(), ...restByKey.keys(), ...arrivedByKey.keys(), ...onClockByKey.keys(), ...restWorkedByKey.keys()]) {
        const position = String(key.split(':')[1] ?? '').trim();
        if (position) positionUniverse.add(position);
      }
      // Remove FLEX TEAM if present
      positionUniverse.delete('FLEX TEAM');
      const orderedCardPositions = Array.from(positionUniverse).sort((a, b) => {
        const rankA = positionOrder.get(a);
        const rankB = positionOrder.get(b);
        if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
        if (rankA !== undefined) return -1;
        if (rankB !== undefined) return 1;
        return a.localeCompare(b);
      });
      for (const shift of ['early', 'late'] as const) {
        for (const position of orderedCardPositions) {
          const key = `${shift}:${position}`;
          const expected = staffByKey.get(key)?.size ?? 0;
          const presentIds = new Set<string>([
            ...Array.from(arrivedByKey.get(key) ?? []),
            ...Array.from(restWorkedByKey.get(key) ?? [])
          ]);
          nextCardStatsByKey[key] = {
            expected,
            present: presentIds.size,
            onClock: onClockByKey.get(key)?.size ?? 0,
            offWorked: restWorkedByKey.get(key)?.size ?? 0
          };
        }
      }

      const nextRows: DashboardRow[] = activeDisplayStaffIds
        .sort((a, b) => a.localeCompare(b, 'en-US'))
        .map((staffId) => {
          const employee = employeeCacheRef.current.get(staffId);
          const schedule = scheduledByStaff.get(staffId);
          const punches = punchesByStaff.get(staffId) ?? [];
          const state = String(schedule?.scheduleState ?? '');
          const isPlannedWork = isWorkingScheduleState(state);
          const employeeShift = normalizeShiftValue(employee?.shift ?? '');
          const normalizedShift = employeeShift;
          const displayShift = normalizedShift;
          const workHoursToday = computeWorkHoursFromPunches(punches, capEnd);
          const attendance: DashboardRow['attendance'] =
            isPlannedWork && workHoursToday <= 0
              ? 'Absent'
              : !isPlannedWork && workHoursToday > 0
                ? 'Off Worked'
                : 'Normal';
          const currentPosition = normalizePositionKey(String(employee?.position ?? '').trim()) || String(employee?.position ?? '').trim();
          return {
            staff_id: staffId,
            name: employee?.name ?? '',
            agency: employee?.agency ?? '',
            position: currentPosition,
            label: employee?.label ?? '',
            borrowed_device: '',
            schedule_state: state,
            work_account: normalizeWorkAccountValue(employee?.work_account ?? ''),
            work_password: employee?.work_password ?? '',
            hire_date: employee?.hire_date ?? '',
            shift: normalizedShift,
            display_shift: displayShift,
            work_hours_today: workHoursToday,
            mistake_count_7d: 0,
            temp_account_name: '',
            temp_source_staff_id: '',
            punches,
            attendance
          };
        })
        .filter((row) => {
          if (!String(row.staff_id ?? '').trim()) return false;
          if (isNewHirePlaceholderStaffId(row.staff_id)) return false;
          const state = String(scheduledByStaff.get(row.staff_id)?.scheduleState ?? '');
          const isPlannedWork = isWorkingScheduleState(state);
          const isOffWorked = !isPlannedWork && row.work_hours_today > 0;
          const hasProfile = Boolean(String(row.name ?? '').trim() || String(row.label ?? '').trim());
          if (isPlannedWork && !hasProfile && row.work_hours_today <= 0) return false;
          return isPlannedWork || isOffWorked;
        });

      // Attach recent 7-day mistake counts by employee_staff_id.
      const manualMistakeCountByStaff = new Map<string, number>();
      if (nextRows.length > 0) {
        const endDate = currentOperationalDate;
        const end = new Date(`${endDate}T00:00:00`);
        const start = Number.isNaN(end.getTime()) ? new Date() : end;
        start.setDate(start.getDate() - 6);
        const startDate = toDateOnly(start);
        const targetStaffIds = Array.from(new Set(nextRows.map((row) => normalizeStaffId(String(row.staff_id ?? '').trim())).filter(Boolean)));
        for (const batch of chunkArray(targetStaffIds, 200)) {
          const reportRes = await supabase
            .from(MISTAKE_REPORT_TABLE)
            .select('employee_staff_id, operational_date')
            .in('employee_staff_id', batch)
            .gte('operational_date', startDate)
            .lte('operational_date', endDate)
            .limit(10000);
          if (reportRes.error) {
            if (!isMissingTableError(reportRes.error.message, MISTAKE_REPORT_TABLE)) {
              console.warn('[dashboard] load mistake reports failed:', reportRes.error.message);
            }
            break;
          }
          for (const rec of ((reportRes.data as any[] | null) ?? [])) {
            const staff = normalizeStaffId(String(rec.employee_staff_id ?? '').trim());
            if (!staff) continue;
            manualMistakeCountByStaff.set(staff, (manualMistakeCountByStaff.get(staff) ?? 0) + 1);
          }
        }
        for (const row of nextRows) {
          const manualCount = manualMistakeCountByStaff.get(normalizeStaffId(String(row.staff_id ?? '').trim())) ?? 0;
          const autoCount = row.attendance === 'Absent' || row.attendance === 'Off Worked' ? 1 : 0;
          row.mistake_count_7d = manualCount + autoCount;
        }
      }

      // Rehydrate temporary account assignments created in current operational window.
      const needsAccountRows = nextRows.filter(
        (row) => !normalizeWorkAccountValue(row.work_account) && Boolean(normalizePositionKey(String(row.position ?? '')))
      );
      if (needsAccountRows.length > 0) {
        const needStaffIds = needsAccountRows.map((row) => row.staff_id);
        const assignedByStaff = new Map<string, TempAssignmentPayload>();
        for (const batch of chunkArray(needStaffIds, 150)) {
          const activeRes = await supabase
            .from(TEMP_ACCOUNT_ASSIGNMENT_TABLE)
            .select('staff_id, work_account, source_temp_staff_id, created_at')
            .in('staff_id', batch)
            .gte('created_at', rangeStartIso)
            .lt('created_at', rangeEndIso)
            .order('created_at', { ascending: false })
            .limit(5000);
          if (activeRes.error) {
            if (!isMissingTableError(activeRes.error.message, TEMP_ACCOUNT_ASSIGNMENT_TABLE)) {
              console.warn('[dashboard] load active temp assignments failed:', activeRes.error.message);
            }
            continue;
          }
          const sourceIds = Array.from(
            new Set(
              (((activeRes.data as any[]) ?? []) as any[])
                .map((item) => String(item.source_temp_staff_id ?? '').trim())
                .filter(Boolean)
            )
          );
          const accountBySourceStaff = new Map<string, { name: string; work_password: string; work_account: string }>();
          for (const sourceBatch of chunkArray(sourceIds, 150)) {
            const sourceRes = await supabase
              .from(TEMP_ACCOUNT_TABLE)
              .select('staff_id, name, work_account, work_password')
              .in('staff_id', sourceBatch)
              .limit(5000);
            if (sourceRes.error) continue;
            for (const src of ((sourceRes.data as any[]) ?? [])) {
              const sid = String(src.staff_id ?? '').trim();
              if (!sid) continue;
              accountBySourceStaff.set(sid, {
                name: String(src.name ?? '').trim(),
                work_account: normalizeWorkAccountValue(src.work_account),
                work_password: String(src.work_password ?? '').trim()
              });
            }
          }

          for (const item of ((activeRes.data as any[]) ?? [])) {
            const staff = String(item.staff_id ?? '').trim();
            const acc = normalizeWorkAccountValue(item.work_account);
            const sourceTempStaffId = String(item.source_temp_staff_id ?? '').trim();
            const sourceInfo = accountBySourceStaff.get(sourceTempStaffId);
            const pwd = String(sourceInfo?.work_password ?? '').trim() || DEFAULT_TEMP_ACCOUNT_PASSWORD;
            const accountName = String(sourceInfo?.name ?? '').trim();
            if (!staff || !acc || assignedByStaff.has(staff)) continue;
            assignedByStaff.set(staff, {
              work_account: acc,
              work_password: pwd,
              account_name: accountName,
              source_temp_staff_id: sourceTempStaffId
            });
          }
        }

        for (const row of nextRows) {
          const assigned = assignedByStaff.get(row.staff_id);
          if (!assigned) continue;
          row.work_account = assigned.work_account;
          row.work_password = assigned.work_password;
          row.temp_account_name = assigned.account_name;
          row.temp_source_staff_id = assigned.source_temp_staff_id;
        }

        // New assignments are created by explicit click on "Assign account".
      }

      const borrowedDeviceByStaff = new Map<string, string[]>();
      const targetStaffSet = new Set(displayStaffIds.map((staffId) => normalizeStaffId(staffId)).filter(Boolean));
      const baseLoans = () =>
        supabase
          .from(DEVICE_LOANS_TABLE)
          .select('id, staff_id, device_sn, action, created_at')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(DEVICE_LOANS_FETCH_LIMIT);
      const loansRes = await baseLoans();
      if (!loansRes.error) {
        const currentBorrowBySn = new Map<string, string>();
        const resolvedSn = new Set<string>();
        for (const row of ((loansRes.data as any[]) ?? [])) {
          const sn = normalizeDeviceSn(String(row.device_sn ?? ''));
          if (!sn || resolvedSn.has(sn)) continue;
          const action = String(row.action ?? '').trim().toLowerCase();
          if (action !== 'borrow' && action !== 'return') continue;
          if (action === 'return') {
            resolvedSn.add(sn);
            continue;
          }
          const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
          resolvedSn.add(sn);
          if (!staffId || !targetStaffSet.has(staffId)) continue;
          currentBorrowBySn.set(sn, staffId);
        }
        const activeSnList = Array.from(currentBorrowBySn.keys());
        const nameBySn = new Map<string, string>();
        for (const snBatch of chunkArray(activeSnList, 150)) {
          const deviceRes = await supabase
            .from(DEVICE_TABLE)
            .select('device_sn, device_name')
            .in('device_sn', snBatch);
          if (deviceRes.error) continue;
          for (const row of ((deviceRes.data as any[]) ?? [])) {
            const sn = normalizeDeviceSn(String(row.device_sn ?? ''));
            if (!sn) continue;
            const name = String(row.device_name ?? '').trim();
            nameBySn.set(sn, name || sn);
          }
        }
        for (const [sn, staffId] of currentBorrowBySn.entries()) {
          const list = borrowedDeviceByStaff.get(staffId) ?? [];
          list.push(nameBySn.get(sn) || sn);
          borrowedDeviceByStaff.set(staffId, list);
        }
      }
      for (const row of nextRows) {
        const deviceList = borrowedDeviceByStaff.get(row.staff_id) ?? [];
        row.borrowed_device = deviceList.join(', ');
      }

      const rowNameByStaff = new Map<string, string>();
      for (const row of nextRows) rowNameByStaff.set(row.staff_id, String(row.name ?? '').trim());
      const nowMs = Date.now();
      const rangeStartMs = range.start.getTime();
      const rangeEndMs = range.end.getTime();
      const usageRes = await supabase
        .from(TEMP_ACCOUNT_ASSIGNMENT_TABLE)
        .select('id, staff_id, position, work_account, source_temp_staff_id, created_at')
        .order('created_at', { ascending: false })
        .limit(400);
      const nextUsageRows: TempAccountUsageRow[] = [];
      if (!usageRes.error) {
        const sourceStaffIds = Array.from(
          new Set(
            (((usageRes.data as any[]) ?? []) as any[])
              .map((item) => String(item.source_temp_staff_id ?? '').trim())
              .filter(Boolean)
          )
        );
        const sourceInfoBySourceStaff = new Map<string, { name: string; work_password: string }>();
        for (const batch of chunkArray(sourceStaffIds, 150)) {
          const sourceRes = await supabase
            .from(TEMP_ACCOUNT_TABLE)
            .select('staff_id, name, work_password')
            .in('staff_id', batch)
            .limit(5000);
          if (sourceRes.error) continue;
          for (const src of ((sourceRes.data as any[]) ?? [])) {
            const sid = String(src.staff_id ?? '').trim();
            if (!sid) continue;
            sourceInfoBySourceStaff.set(sid, {
              name: String(src.name ?? '').trim(),
              work_password: String(src.work_password ?? '').trim()
            });
          }
        }

        for (const item of ((usageRes.data as any[]) ?? [])) {
          const staff = String(item.staff_id ?? '').trim();
          if (!staff) continue;
          const sourceTempStaffId = String(item.source_temp_staff_id ?? '').trim();
          const sourceInfo = sourceInfoBySourceStaff.get(sourceTempStaffId);
          nextUsageRows.push({
            id: String(item.id ?? ''),
            staff_id: staff,
            name: rowNameByStaff.get(staff) || employeeCacheRef.current.get(staff)?.name || '',
            position: String(item.position ?? '').trim(),
            work_account: normalizeWorkAccountValue(item.work_account),
            account_name: sourceInfo?.name || '',
            source_temp_staff_id: sourceTempStaffId,
            created_at: String(item.created_at ?? ''),
            status:
              (() => {
                const createdMs = Date.parse(String(item.created_at ?? ''));
                if (!Number.isFinite(createdMs)) return 'Expired' as const;
                if (createdMs >= rangeStartMs && createdMs < rangeEndMs && nowMs < rangeEndMs) return 'Active' as const;
                return 'Expired' as const;
              })()
          });
        }
        const activeUsageByStaff = new Map<string, TempAccountUsageRow>();
        for (const item of nextUsageRows) {
          if (item.status !== 'Active') continue;
          if (activeUsageByStaff.has(item.staff_id)) continue;
          activeUsageByStaff.set(item.staff_id, item);
        }
        for (const row of nextRows) {
          const active = activeUsageByStaff.get(row.staff_id);
          if (!active) continue;
          row.temp_account_name = active.account_name || '';
          row.temp_source_staff_id = active.source_temp_staff_id || '';
          if (!normalizeWorkAccountValue(row.work_account)) row.work_account = normalizeWorkAccountValue(active.work_account) || '';
          if (!String(row.work_password ?? '').trim()) {
            const sourceInfo = sourceInfoBySourceStaff.get(active.source_temp_staff_id || '');
            row.work_password = String(sourceInfo?.work_password ?? '').trim() || DEFAULT_TEMP_ACCOUNT_PASSWORD;
          }
        }
      } else if (!isMissingTableError(usageRes.error.message, TEMP_ACCOUNT_ASSIGNMENT_TABLE)) {
        console.warn('[dashboard] load account usage failed:', usageRes.error.message);
      }

      const digest = `${nextRows.length}|${nextRows
        .map(
          (r) =>
            `${r.staff_id}:${r.attendance}:${r.punches.length}:${r.punches[r.punches.length - 1]?.id ?? ''}:${r.borrowed_device}:${r.schedule_state}:${r.work_account}:${r.temp_account_name}:${r.mistake_count_7d ?? 0}`
        )
        .join(';')}`;

      if (fetchSeqRef.current !== currentSeq) return;
      if (rowsDigestRef.current !== digest) {
        rowsDigestRef.current = digest;
        setRows(nextRows);
      }
      setCardPositions(orderedCardPositions);
      setCardStatsByKey(nextCardStatsByKey);
      setAccountUsageRows(nextUsageRows);
      setOperationalDate(currentOperationalDate);
      setLastUpdatedAt(new Date().toLocaleString('en-CA', { hour12: false }));
    } finally {
      if (fetchSeqRef.current === currentSeq) setLoading(false);
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    void fetchData(true);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const tick = () => {
      void fetchData(true);
    };
    const timer = window.setInterval(tick, DASHBOARD_REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const schema = String(import.meta.env.VITE_SUPABASE_SCHEMA || 'public').trim() || 'public';
    const channel = supabase
      .channel('dashboard-live-refresh')
      .on('postgres_changes', { event: '*', schema, table: PUNCHES_TABLE }, tick)
      .on('postgres_changes', { event: '*', schema, table: SCHEDULE_TABLE }, tick)
      .on('postgres_changes', { event: '*', schema, table: TEMP_ACCOUNT_ASSIGNMENT_TABLE }, tick)
      .on('postgres_changes', { event: '*', schema, table: DEVICE_LOANS_TABLE }, tick)
      .subscribe();

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, []);

  const positionOptions = useMemo(
    () =>
      Array.from(
        new Set(rows.map((row) => normalizePositionKey(String(row.position ?? '').trim()) || String(row.position ?? '').trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [rows]
  );
  const shiftOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => String(row.display_shift ?? row.shift ?? '').trim().toLowerCase()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [rows]
  );
  const labelToneMap = useMemo(() => loadLabelToneMap(), [rows.length]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (positionFilter && (normalizePositionKey(String(row.position ?? '').trim()) || String(row.position ?? '').trim()) !== positionFilter) return false;
      if (shiftFilter && String(row.display_shift ?? row.shift ?? '').trim().toLowerCase() !== shiftFilter) return false;
      if (absentOnly && row.attendance !== 'Absent') return false;
      if (onClockOnly) {
        const last = row.punches[row.punches.length - 1];
        if (!last || last.action !== 'IN') return false;
      }
      if (offWorkOnly && row.attendance !== 'Off Worked') return false;
      if (!q) return true;
      const haystack = `${row.staff_id} ${row.name} ${row.agency} ${row.label} ${row.work_account} ${row.temp_account_name} ${row.borrowed_device}`.toLowerCase();
      if (haystack.includes(q)) return true;
      return staffIdSearchMatches(q, String(row.staff_id ?? ''));
    });
  }, [rows, search, positionFilter, shiftFilter, absentOnly, onClockOnly, offWorkOnly]);

  useEffect(() => {
    setRenderCount(120);
  }, [search, positionFilter, shiftFilter, absentOnly, onClockOnly, offWorkOnly, rows.length]);

  const renderedRows = useMemo(
    () => filteredRows.slice(0, Math.max(0, renderCount)),
    [filteredRows, renderCount]
  );
  const filteredAccountUsageRows = useMemo(() => {
    const q = accountUsageSearch.trim().toLowerCase();
    const rowsByPosition = accountUsagePositionFilter
      ? accountUsageRows.filter(
          (row) => (normalizePositionKey(String(row.position ?? '').trim()) || String(row.position ?? '').trim()) === accountUsagePositionFilter
        )
      : accountUsageRows;
    if (!q) return rowsByPosition;
    return rowsByPosition.filter((row) => {
      const haystack = [
        row.staff_id,
        row.name,
        row.work_account,
        row.account_name,
        row.source_temp_staff_id
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [accountUsageRows, accountUsageSearch, accountUsagePositionFilter]);
  const accountUsagePositionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          accountUsageRows.map((row) => normalizePositionKey(String(row.position ?? '').trim()) || String(row.position ?? '').trim()).filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [accountUsageRows]
  );
  const attendanceCards = useMemo(() => {
    const cards: Array<{
      position: string;
      shift: 'early' | 'late';
      expected: number;
      present: number;
      onClock: number;
      offWorked: number;
    }> = [];
    for (const shift of ['early', 'late'] as const) {
      for (const position of cardPositions) {
        const positionShiftScope = rows.filter(
          (row) =>
            normalizePositionKey(row.position) === position &&
            String(row.shift ?? '').trim().toLowerCase() === shift
        );
        const offWorkedScope = positionShiftScope.filter((row) => row.attendance === 'Off Worked');
        const stat = cardStatsByKey[`${shift}:${position}`] ?? { expected: 0, present: 0, onClock: 0, offWorked: 0 };
        cards.push({ position, shift, expected: stat.expected, present: stat.present, onClock: stat.onClock, offWorked: stat.offWorked || offWorkedScope.length });
      }
    }
    return cards;
  }, [rows, cardPositions, cardStatsByKey]);
  const attendanceCardGroups = useMemo(
    () =>
      (['early', 'late'] as const).map((shift) => ({
        shift,
        cards: attendanceCards.filter((card) => card.shift === shift)
      })),
    [attendanceCards]
  );
  const outboundShiftCards = useMemo(() => {
    const shifts: Array<'early' | 'late'> = ['early', 'late'];
    const summaryPositions = cardPositions.filter((position) => normalizePositionKey(position) !== 'Transfer');
    return shifts.map((shift) => {
      let expected = 0;
      let present = 0;
      for (const position of summaryPositions) {
        const stat = cardStatsByKey[`${shift}:${position}`] ?? { expected: 0, present: 0, onClock: 0, offWorked: 0 };
        expected += Number(stat.expected || 0);
        present += Number(stat.present || 0);
      }
      return { shift, expected, present };
    });
  }, [cardPositions, cardStatsByKey]);
  const summaryStats = useMemo(() => {
    const onClock = rows.filter((row) => row.punches[row.punches.length - 1]?.action === 'IN').length;
    const absent = rows.filter((row) => row.attendance === 'Absent').length;
    const offWorked = rows.filter((row) => row.attendance === 'Off Worked').length;
    return [
      {
        label: 'Scheduled',
        value: rows.length,
        detail: `${filteredRows.length} in view`,
        cardClass: 'border-sky-300/18 bg-gradient-to-br from-sky-400/[0.14] via-sky-300/[0.05] to-transparent',
        valueClass: 'text-sky-50'
      },
      {
        label: 'On Clock',
        value: onClock,
        detail: 'Active right now',
        cardClass: 'border-emerald-300/18 bg-gradient-to-br from-emerald-400/[0.14] via-emerald-300/[0.05] to-transparent',
        valueClass: 'text-emerald-50'
      },
      {
        label: 'Absent',
        value: absent,
        detail: 'Needs attention',
        cardClass: 'border-rose-300/18 bg-gradient-to-br from-rose-400/[0.14] via-rose-300/[0.05] to-transparent',
        valueClass: 'text-rose-50'
      },
      {
        label: 'Off Worked',
        value: offWorked,
        detail: 'Worked on rest day',
        cardClass: 'border-amber-300/18 bg-gradient-to-br from-amber-400/[0.14] via-amber-300/[0.05] to-transparent',
        valueClass: 'text-amber-50'
      }
    ];
  }, [rows, filteredRows.length]);

  const presentRows = useMemo(
    () => rows.filter((row) => row.attendance !== 'Absent' && !isNewHirePlaceholderStaffId(String(row.staff_id ?? '').trim())),
    [rows]
  );
  const mistakeReportPositionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          presentRows
            .map((row) => normalizePositionKey(String(row.position ?? '').trim()) || String(row.position ?? '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, 'en-US')),
    [presentRows]
  );
  const mistakeReportEmployeeOptions = useMemo(() => {
    const byStaff = new Map<string, DashboardRow>();
    for (const row of presentRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (!staff) continue;
      const position = normalizePositionKey(String(row.position ?? '').trim()) || String(row.position ?? '').trim();
      if (mistakeReportPosition && position !== mistakeReportPosition) continue;
      if (!byStaff.has(staff)) byStaff.set(staff, row);
    }
    return Array.from(byStaff.values()).sort((a, b) =>
      String(a.staff_id ?? '').localeCompare(String(b.staff_id ?? ''), 'en-US')
    );
  }, [presentRows, mistakeReportPosition]);
  const mistakeReportEmployeeFilteredOptions = useMemo(() => {
    const q = String(mistakeReportEmployeeQuery ?? '').trim().toLowerCase();
    if (!q) return mistakeReportEmployeeOptions;
    return mistakeReportEmployeeOptions.filter((row) => {
      const staff = String(row.staff_id ?? '').toLowerCase();
      const name = String(row.name ?? '').toLowerCase();
      return staff.includes(q) || name.includes(q);
    });
  }, [mistakeReportEmployeeOptions, mistakeReportEmployeeQuery]);
  const selectedMistakeReportEmployeeLabel = useMemo(() => {
    const selected = mistakeReportEmployeeOptions.find((row) => String(row.staff_id ?? '') === mistakeReportEmployeeStaffId);
    if (!selected) return '';
    return `${selected.staff_id} - ${selected.name || '-'}`;
  }, [mistakeReportEmployeeOptions, mistakeReportEmployeeStaffId]);
  const presentStaffIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const row of presentRows) {
      const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
      if (staff) set.add(staff);
    }
    return set;
  }, [presentRows]);
  useEffect(() => {
    if (!mistakeReportEmployeeDropdownOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const root = mistakeEmployeePickerRef.current;
      if (!root || !target || root.contains(target)) return;
      setMistakeReportEmployeeDropdownOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [mistakeReportEmployeeDropdownOpen]);

  const getQrDataUrlCached = async (rawValue: string) => {
    const value = String(rawValue ?? '').trim();
    if (!value) return '';
    const cache = qrDataUrlCacheRef.current;
    const cached = cache.get(value);
    if (cached) return cached;
    const dataUrl = await QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: QR_PRINT_SIZE,
      color: { dark: '#0b1220', light: '#ffffff' }
    });
    cache.set(value, dataUrl);
    return dataUrl;
  };

  const openPunchDetails = (row: DashboardRow) => {
    setPunchDetailStaffId(String(row.staff_id ?? '').trim());
    setPunchDetailStaffName(String(row.name ?? '').trim());
    setPunchDetailRows([...(row.punches ?? [])]);
    setPunchDetailOpen(true);
  };

  const printTempBadge = async (row: DashboardRow) => {
    const staff = String(row.staff_id ?? '').trim();
    if (!staff || isNewHirePlaceholderStaffId(staff)) return;
    setBadgePrintingStaffId(staff);
    try {
      const name = String(row.name ?? '').trim() || '-';
      const position = String(row.position ?? '').trim() || '-';
      const workAccount = normalizeWorkAccountValue(row.work_account);
      const workPassword = resolveDefaultPassword(workAccount, String(row.work_password ?? '').trim());
      const accountName = String(row.temp_account_name ?? '').trim() || name;
      const [qrDataUrl, qrAcc, qrPwd] = await Promise.all([
        getQrDataUrlCached(staff),
        workAccount ? getQrDataUrlCached(workAccount) : Promise.resolve(''),
        workAccount && workPassword ? getQrDataUrlCached(workPassword) : Promise.resolve('')
      ]);
      const accountPageHtml =
        workAccount && workPassword
          ? `
    <div class="page-break"></div>
    <div class="sheet">
      <div>
        <div class="name">${escapeHtml(accountName)}</div>
        <div class="sub">User: ${escapeHtml(name)}</div>
      </div>
      <div class="pair">
        <div class="box">
          <div class="qrsq"><img src="${escapeHtml(qrAcc)}" alt="QR account ${escapeHtml(staff)}" /></div>
          <div class="meta">
            <div class="k">Account</div>
            <div class="v">${escapeHtml(workAccount)}</div>
          </div>
        </div>
        <div class="box">
          <div class="qrsq"><img src="${escapeHtml(qrPwd)}" alt="QR password ${escapeHtml(staff)}" /></div>
          <div class="meta">
            <div class="k">Password</div>
            <div class="v">${escapeHtml(workPassword)}</div>
          </div>
        </div>
      </div>
    </div>`
          : '';
      const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      @page { size: 4in 2in; margin: 0; }
      html, body { margin: 0; padding: 0; width: 4in; min-height: 2in; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
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
      .page-break { break-before: page; page-break-before: always; }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div>
        <div class="name">${escapeHtml(name)}</div>
        <div class="sub">${escapeHtml(position)}</div>
      </div>
      <div class="pair">
        <div class="box">
          <div class="qrsq"><img src="${escapeHtml(qrDataUrl)}" alt="QR ${escapeHtml(staff)}" /></div>
          <div class="meta">
            <div class="k">USID</div>
            <div class="v">${escapeHtml(staff)}</div>
          </div>
        </div>
        <div></div>
      </div>
    </div>
    ${accountPageHtml}
  </body>
</html>`;
      await printHtmlDocument(html, 1500);
    } catch (err) {
      openNoticeDialog(`Print failed: ${err instanceof Error ? err.message : String(err ?? 'unknown error')}`, 'Print failed');
    } finally {
      setBadgePrintingStaffId((current) => (current === staff ? null : current));
    }
  };

  const assignTempAccountToRow = async (row: DashboardRow) => {
    if (!supabase) return false;
    const staff = String(row.staff_id ?? '').trim();
    const position = normalizePositionKey(String(row.position ?? '').trim());
    if (!staff || !position) return false;
    const nowIso = new Date().toISOString();
    const range = getOperationalRange();
    const rangeStartIso = range.start.toISOString();
    const rangeEndIso = range.end.toISOString();
    setAccountAssigningStaffId(staff);
    try {
      const activeSelfRes = await supabase
        .from(TEMP_ACCOUNT_ASSIGNMENT_TABLE)
        .select('staff_id, work_account, source_temp_staff_id, created_at')
        .eq('staff_id', staff)
        .gte('created_at', rangeStartIso)
        .lt('created_at', rangeEndIso)
        .order('created_at', { ascending: false })
        .limit(1);
      if (!activeSelfRes.error && ((activeSelfRes.data as any[]) ?? []).length > 0) {
        const current = ((activeSelfRes.data as any[]) ?? [])[0] as any;
        const sourceStaffId = String(current.source_temp_staff_id ?? '').trim();
        let accountName = '';
        let workPassword = DEFAULT_TEMP_ACCOUNT_PASSWORD;
        if (sourceStaffId) {
          const sourceRes = await supabase
            .from(TEMP_ACCOUNT_TABLE)
            .select('name, work_password')
            .eq('staff_id', sourceStaffId)
            .limit(1);
          if (!sourceRes.error) {
            accountName = String(((sourceRes.data as any[]) ?? [])[0]?.name ?? '').trim();
            workPassword = String(((sourceRes.data as any[]) ?? [])[0]?.work_password ?? '').trim() || DEFAULT_TEMP_ACCOUNT_PASSWORD;
          }
        }
        if (!workPassword) {
          const pwdRes = await supabase
            .from(TEMP_ACCOUNT_TABLE)
            .select('work_password')
            .eq('work_account', normalizeWorkAccountValue(current.work_account))
            .limit(1);
          if (!pwdRes.error) workPassword = String(((pwdRes.data as any[]) ?? [])[0]?.work_password ?? '').trim() || DEFAULT_TEMP_ACCOUNT_PASSWORD;
        }
        setRows((prev) =>
          prev.map((item) =>
            item.staff_id === staff
              ? {
                  ...item,
                  work_account: normalizeWorkAccountValue(current.work_account),
                  work_password: workPassword,
                  temp_account_name: accountName,
                  temp_source_staff_id: sourceStaffId
                }
              : item
          )
        );
        return true;
      }

      const occupiedRes = await supabase
        .from(TEMP_ACCOUNT_ASSIGNMENT_TABLE)
        .select('work_account')
        .gte('created_at', rangeStartIso)
        .lt('created_at', rangeEndIso)
        .limit(20000);
      const occupied = new Set(
        ((occupiedRes.data as any[]) ?? [])
          .map((item) => normalizeWorkAccountValue(item.work_account))
          .filter(Boolean)
      );

      const poolRes = await supabase
        .from(TEMP_ACCOUNT_TABLE)
        .select('staff_id, name, position, work_account, work_password, updated_at')
        .not('work_account', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(2000);
      if (poolRes.error) {
        openNoticeDialog(`Assign failed: ${poolRes.error.message}`, 'Assign failed');
        return false;
      }
      const allPoolCandidates = (((poolRes.data as any[]) ?? []) as any[])
        .map((item) => ({
          staff_id: String(item.staff_id ?? '').trim(),
          name: String(item.name ?? '').trim(),
          position: String(item.position ?? '').trim(),
          work_account: normalizeWorkAccountValue(item.work_account),
          work_password: String(item.work_password ?? '').trim() || DEFAULT_TEMP_ACCOUNT_PASSWORD
        }))
        .filter((item) => item.work_account && !occupied.has(item.work_account));

      const positionCandidates = allPoolCandidates.filter((item) => normalizePositionKey(item.position) === position);
      const picked = positionCandidates[0];
      if (!picked) {
        openNoticeDialog(`No available temp account for ${position}.`, 'No account available');
        return false;
      }

      const insertRes = await supabase.from(TEMP_ACCOUNT_ASSIGNMENT_TABLE).insert({
        staff_id: staff,
        position,
        work_account: picked.work_account,
        source_temp_staff_id: picked.staff_id || null,
        created_at: nowIso
      });
      if (insertRes.error) {
        openNoticeDialog(`Assign failed: ${insertRes.error.message}`, 'Assign failed');
        return false;
      }

      setRows((prev) =>
        prev.map((item) =>
          item.staff_id === staff
            ? {
                ...item,
                work_account: picked.work_account,
                work_password: picked.work_password,
                temp_account_name: picked.name || '',
                temp_source_staff_id: picked.staff_id || ''
              }
            : item
        )
      );
      setAccountUsageRows((prev) => [
        {
          id: `local-${staff}-${picked.work_account}-${Date.now()}`,
          staff_id: staff,
          name: row.name || '',
          position,
          work_account: picked.work_account,
          account_name: picked.name || '',
          source_temp_staff_id: picked.staff_id || '',
          created_at: nowIso,
          status: 'Active'
        },
        ...prev
      ]);
      return true;
    } finally {
      setAccountAssigningStaffId((current) => (current === staff ? null : current));
    }
  };

  const printAccountCard = async (row: DashboardRow) => {
    const staff = String(row.staff_id ?? '').trim();
    const name = String(row.name ?? '').trim() || '-';
    const workAccount = normalizeWorkAccountValue(row.work_account);
    const workPassword = resolveDefaultPassword(workAccount, String(row.work_password ?? '').trim());
    const accountName = String(row.temp_account_name ?? '').trim();
    if (!staff || !workAccount || !workPassword) return;
    setAccountPrintingStaffId(staff);
    try {
      const [qrAcc, qrPwd] = await Promise.all([getQrDataUrlCached(workAccount), getQrDataUrlCached(workPassword)]);
      const cardTitle = accountName || name;
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
      .sub { margin-top: 0.02in; font-size: 8.5pt; letter-spacing: 0.06em; font-weight: 700; color: #334155; }
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
        <div class="name">${escapeHtml(cardTitle)}</div>
        <div class="sub">User: ${escapeHtml(name)}</div>
      </div>
      <div class="pair">
        <div class="box">
          <div class="qrsq"><img src="${escapeHtml(qrAcc)}" alt="QR account ${escapeHtml(staff)}" /></div>
          <div class="meta">
            <div class="k">Account</div>
            <div class="v">${escapeHtml(workAccount)}</div>
          </div>
        </div>
        <div class="box">
          <div class="qrsq"><img src="${escapeHtml(qrPwd)}" alt="QR password ${escapeHtml(staff)}" /></div>
          <div class="meta">
            <div class="k">Password</div>
            <div class="v">${escapeHtml(workPassword)}</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
      await printHtmlDocument(html, 1500);
    } catch (err) {
      openNoticeDialog(`Print failed: ${err instanceof Error ? err.message : String(err ?? 'unknown error')}`, 'Print failed');
    } finally {
      setAccountPrintingStaffId((current) => (current === staff ? null : current));
    }
  };

  const submitMistakeReport = async () => {
    if (!supabase) {
      openNoticeDialog('Missing Supabase configuration.', 'Save failed');
      return;
    }
    const position = String(mistakeReportPosition ?? '').trim();
    const employeeStaffId = normalizeStaffId(String(mistakeReportEmployeeStaffId ?? '').trim());
    const reason = String(mistakeReportReason ?? '').trim();
    const reporterStaffId = normalizeStaffId(String(mistakeReportReporterStaffId ?? '').trim());
    if (!position) {
      openNoticeDialog('Please select a position.', 'Validation');
      return;
    }
    if (!employeeStaffId) {
      openNoticeDialog('Please select an employee USID.', 'Validation');
      return;
    }
    if (!reason) {
      openNoticeDialog('Please enter a mistake reason.', 'Validation');
      return;
    }
    if (!reporterStaffId) {
      openNoticeDialog('Please select a reporter USID.', 'Validation');
      return;
    }
    if (!presentStaffIdSet.has(reporterStaffId)) {
      openNoticeDialog('Reporter USID must be a present employee for today.', 'Validation');
      return;
    }
    setMistakeReportSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const { error: insertError } = await supabase.from(MISTAKE_REPORT_TABLE).insert([
        {
          position,
          employee_staff_id: employeeStaffId,
          reason,
          reporter_staff_id: reporterStaffId,
          operational_date: operationalDate || getOperationalRange().operationalDate,
          created_at: nowIso
        }
      ]);
      if (insertError) {
        openNoticeDialog(`Failed to save report: ${insertError.message}`, 'Save failed');
        return;
      }
      setMistakeReportOpen(false);
      setMistakeReportPosition('');
      setMistakeReportEmployeeStaffId('');
      setMistakeReportEmployeeQuery('');
      setMistakeReportEmployeeDropdownOpen(false);
      setMistakeReportReason('');
      setMistakeReportReporterStaffId('');
      openNoticeDialog('Mistake report submitted.', 'Saved');
    } finally {
      setMistakeReportSubmitting(false);
    }
  };
  const closeMistakeReportDialog = () => {
    setMistakeReportOpen(false);
    setMistakeReportEmployeeDropdownOpen(false);
    if (!mistakeReportEmployeeStaffId) setMistakeReportEmployeeQuery('');
  };

  const openMistakeDetails = async (row: DashboardRow) => {
    if (!supabase) {
      openNoticeDialog('Missing Supabase configuration.', 'Load failed');
      return;
    }
    const staffId = normalizeStaffId(String(row.staff_id ?? '').trim());
    if (!staffId) return;
    const endDate = operationalDate || getOperationalRange().operationalDate;
    const end = new Date(`${endDate}T00:00:00`);
    const start = Number.isNaN(end.getTime()) ? new Date() : end;
    start.setDate(start.getDate() - 6);
    const startDate = toDateOnly(start);

    setMistakeDetailOpen(true);
    setMistakeDetailLoading(true);
    setMistakeDetailError(null);
    setMistakeDetailRows([]);
    setMistakeDetailStaffId(staffId);
    setMistakeDetailStaffName(String(row.name ?? '').trim());
    try {
      const res = await supabase
        .from(MISTAKE_REPORT_TABLE)
        .select('id, employee_staff_id, position, reason, reporter_staff_id, operational_date, created_at')
        .eq('employee_staff_id', staffId)
        .gte('operational_date', startDate)
        .lte('operational_date', endDate)
        .order('created_at', { ascending: false })
        .limit(200);
      if (res.error) {
        setMistakeDetailError(res.error.message);
        return;
      }
      const nextRows: MistakeDetailRow[] = (((res.data as any[]) ?? []) as any[]).map((item) => ({
        id: String(item.id ?? ''),
        employee_staff_id: normalizeStaffId(String(item.employee_staff_id ?? '').trim()),
        position: String(item.position ?? '').trim(),
        reason: String(item.reason ?? '').trim(),
        reporter_staff_id: normalizeStaffId(String(item.reporter_staff_id ?? '').trim()),
        operational_date: String(item.operational_date ?? '').trim(),
        created_at: String(item.created_at ?? '').trim()
      }));
      const reporterNameByStaff = new Map<string, string>();
      for (const item of nextRows) {
        const reporterStaffId = normalizeStaffId(String(item.reporter_staff_id ?? '').trim());
        if (!reporterStaffId || reporterStaffId === 'SYSTEM') continue;
        const cachedName = String(employeeCacheRef.current.get(reporterStaffId)?.name ?? '').trim();
        if (cachedName) reporterNameByStaff.set(reporterStaffId, cachedName);
      }
      const missingReporterIds = Array.from(
        new Set(
          nextRows
            .map((item) => normalizeStaffId(String(item.reporter_staff_id ?? '').trim()))
            .filter((staffId) => Boolean(staffId && staffId !== 'SYSTEM' && !reporterNameByStaff.has(staffId)))
        )
      );
      for (const batch of chunkArray(missingReporterIds, 200)) {
        const reporterRes = await supabase
          .from(EMPLOYEE_TABLE)
          .select('staff_id, name')
          .in('staff_id', batch)
          .limit(1000);
        if (reporterRes.error) continue;
        for (const employee of ((reporterRes.data as any[] | null) ?? [])) {
          const reporterStaffId = normalizeStaffId(String(employee.staff_id ?? '').trim());
          const reporterName = String(employee.name ?? '').trim();
          if (reporterStaffId && reporterName) reporterNameByStaff.set(reporterStaffId, reporterName);
        }
      }
      const resolvedRows = nextRows.map((item) => {
        const reporterStaffId = normalizeStaffId(String(item.reporter_staff_id ?? '').trim());
        const reporterName =
          reporterStaffId === 'SYSTEM'
            ? 'System'
            : String(reporterNameByStaff.get(reporterStaffId) ?? '').trim();
        return {
          ...item,
          reporter_name: reporterName || item.reporter_staff_id || ''
        };
      });
      const autoRows: MistakeDetailRow[] = [];
      const attendanceAuto = buildAutoMistakeDetailRow(row, endDate);
      if (attendanceAuto) autoRows.push(attendanceAuto);
      setMistakeDetailRows([...autoRows, ...resolvedRows]);
    } finally {
      setMistakeDetailLoading(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-4 text-paper sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <section className="glass mx-auto w-full max-w-[1580px] rounded-[32px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)]">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-300">
              Operational Dashboard
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-4xl leading-none tracking-[0.03em] text-stone-50 sm:text-5xl">
                Dashboard
              </h1>
              {user?.email && <p className="text-sm text-stone-400">Logged in as: {user.email}</p>}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryStats.map((item) => (
              <div
                key={item.label}
                className={[
                  'rounded-[24px] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
                  item.cardClass
                ].join(' ')}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">{item.label}</div>
                <div className={['mt-3 text-3xl font-semibold tracking-[-0.03em]', item.valueClass].join(' ')}>{item.value}</div>
                <div className="mt-1 text-xs text-stone-400">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 rounded-[28px] border border-white/10 bg-black/20 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Schedule Date</div>
              <div className="text-xl font-semibold tracking-[-0.02em] text-stone-50">{operationalDate || '-'}</div>
              <div className="text-sm text-stone-400">Updated {lastUpdatedAt || '-'}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMistakeReportOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-stone-100 transition hover:bg-white/[0.08]"
              >
                <DocumentIcon />
                Mistake Report
              </button>
              <button
                type="button"
                onClick={() => setAccountUsageOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-stone-100 transition hover:bg-white/[0.08]"
              >
                <GridIcon />
                Account Usage
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.href = '/';
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-stone-100 transition hover:bg-white/[0.08]"
              >
                <ArrowLeftIcon />
                Back
              </button>
              <button
                type="button"
                onClick={() => void fetchData()}
                className="inline-flex items-center gap-2 rounded-full border border-[#d9cfbf]/40 bg-[#e8dfcf] px-4 py-2.5 text-sm font-semibold text-[#181614] transition hover:bg-[#f0e9dc]"
              >
                <RefreshIcon />
                Refresh
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {outboundShiftCards.map((card) => {
              const ratio = card.expected > 0 ? (card.present / card.expected) * 100 : 0;
              const isMorning = card.shift === 'early';
              return (
                <div
                  key={`outbound:${card.shift}`}
                  className={[
                    'rounded-[24px] border px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
                    getAttendanceCardClass(isMorning ? 'Pick' : 'Transfer')
                  ].join(' ')}
                >
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
                        {isMorning ? 'Outbound Morning' : 'Outbound Night'}
                      </div>
                      <div className="mt-3 flex items-end gap-3">
                        <span className="text-3xl font-semibold tracking-[-0.03em] text-stone-50">{card.present}/{card.expected}</span>
                        <span
                          className={[
                            'pb-1 text-sm font-semibold',
                            ratio < 80
                              ? 'text-rose-300'
                              : ratio >= 90
                                ? getAttendanceCardValueClass(isMorning ? 'Pick' : 'Transfer')
                                : 'text-stone-300'
                          ].join(' ')}
                        >
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
              <div key={`attendance:${group.shift}`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {group.cards.map((card) => {
                  const ratio = card.expected > 0 ? (card.present / card.expected) * 100 : 0;
                  return (
                    <div key={`${card.position}:${card.shift}`} className={['rounded-[24px] border px-4 py-4', getAttendanceCardClass(card.position)].join(' ')}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-stone-100">
                            {card.shift === 'early' ? 'Morning' : 'Night'} {card.position}
                          </div>
                          <div className="mt-2 text-xs text-stone-400">
                            {card.present}/{card.expected}
                            <span
                              className={[
                                'ml-2 font-semibold',
                                ratio < 80 ? 'text-rose-300' : ratio >= 90 ? 'text-stone-100' : 'text-stone-300'
                              ].join(' ')}
                            >
                              {card.expected > 0 ? `${ratio.toFixed(1)}%` : '0.0%'}
                            </span>
                          </div>
                          {card.offWorked > 0 && <div className="mt-2 text-xs font-medium text-stone-300">+{card.offWorked} off worked</div>}
                        </div>
                        <div
                          className={[
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
                          ].join(' ')}
                        >
                          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">On Clock</div>
                          <div className={['mt-1 text-3xl font-semibold leading-none', getAttendanceCardValueClass(card.position)].join(' ')}>
                            {card.onClock}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_220px_220px_repeat(3,minmax(0,160px))]">
            <label className="flex h-12 items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4">
              <SearchIcon className="h-4 w-4 text-stone-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by staff ID, name, or account"
                className="h-full w-full bg-transparent text-sm text-stone-100 outline-none placeholder:text-stone-500"
              />
            </label>
            <div className="relative">
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
                className="h-12 w-full appearance-none rounded-[20px] border border-white/10 bg-white/[0.04] px-4 pr-10 text-sm text-stone-100 outline-none transition focus:border-white/20"
              >
                <option value="">All positions</option>
                {positionOptions.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
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
                  <option key={shift} value={shift}>
                    {formatShiftLabel(shift)}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            </div>
            <label className="flex h-12 items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-200">
              <input
                type="checkbox"
                checked={absentOnly}
                onChange={(e) => setAbsentOnly(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#e8dfcf]"
              />
              Absent
            </label>
            <label className="flex h-12 items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-200">
              <input
                type="checkbox"
                checked={onClockOnly}
                onChange={(e) => setOnClockOnly(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#e8dfcf]"
              />
              On Clock
            </label>
            <label className="flex h-12 items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-200">
              <input
                type="checkbox"
                checked={offWorkOnly}
                onChange={(e) => setOffWorkOnly(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#e8dfcf]"
              />
              Off Work
            </label>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-rose-300">Load failed: {error}</p>}

        {!error && (
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
                    <th className="px-3 py-3 text-left">Device</th>
                    <th className="px-3 py-3 text-left">Account</th>
                    <th className="px-3 py-3 text-left">Shift</th>
                    <th className="px-3 py-3 text-left">Mistake</th>
                    <th className="px-3 py-3 text-left">Punch Logs</th>
                  </tr>
                </thead>
              <tbody>
                {renderedRows.map((row, idx) => {
                  const rowToneClass =
                    row.attendance === 'Absent'
                      ? 'bg-rose-950/30'
                      : row.attendance === 'Off Worked'
                        ? 'bg-stone-200/[0.03]'
                        : 'odd:bg-white/[0.02]';
                  const hasOverPunch = row.punches.length > 4;
                  const visiblePunches = row.punches.slice(0, 4);
                  const shortGapPunchIndices = getShortGapPunchIndices(visiblePunches, 10);

                  const displayStaffId = isNewHirePlaceholderStaffId(row.staff_id) ? '' : row.staff_id;
                  return (
                    <tr key={row.staff_id} className={['border-t border-white/5 transition-colors hover:bg-white/[0.05]', rowToneClass].join(' ')}>
                      <td
                        className={[
                          'whitespace-nowrap px-3 py-3 font-mono text-stone-500',
                          hasOverPunch ? 'border-y border-l border-rose-500/90' : ''
                        ].join(' ')}
                      >
                        {idx + 1}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3 font-mono text-stone-100', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        {displayStaffId ? (
                          <button
                            type="button"
                            disabled={badgePrintingStaffId === row.staff_id}
                            onClick={() => void printTempBadge(row)}
                            className="underline decoration-dotted underline-offset-4 transition hover:text-[#e8dfcf] disabled:cursor-not-allowed disabled:opacity-60"
                            title="Print temp badge"
                          >
                            {badgePrintingStaffId === row.staff_id ? 'Printing...' : displayStaffId}
                          </button>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3 text-stone-100', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        {row.name || '-'}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3 text-stone-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        <span
                          className={[
                            'inline-flex items-center rounded-full border px-2.5 py-1',
                            getPositionBadgeClass(row.position)
                          ].join(' ')}
                        >
                          {row.position || '-'}
                        </span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3 text-stone-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        <span
                          className={[
                            'inline-flex items-center rounded-full border px-2.5 py-1',
                            getLabelToneClass(row.label || '', labelToneMap)
                          ].join(' ')}
                        >
                          {row.label || '-'}
                        </span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3 text-stone-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        <span
                          className={[
                            'inline-flex items-center rounded-full border px-2.5 py-1',
                            row.borrowed_device
                              ? 'border-stone-200/25 bg-stone-100/[0.08] text-stone-100'
                              : 'border-white/12 bg-white/[0.04] text-stone-300'
                          ].join(' ')}
                        >
                          {row.borrowed_device || 'No borrowed device'}
                        </span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3 text-stone-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        {normalizeWorkAccountValue(row.work_account) ? (
                          <button
                            type="button"
                            disabled={!resolveDefaultPassword(normalizeWorkAccountValue(row.work_account), String(row.work_password ?? '').trim()) || accountPrintingStaffId === row.staff_id}
                            onClick={() => void printAccountCard(row)}
                            className="underline decoration-dotted underline-offset-4 transition hover:text-[#e8dfcf] disabled:cursor-not-allowed disabled:opacity-60"
                            title={resolveDefaultPassword(normalizeWorkAccountValue(row.work_account), String(row.work_password ?? '').trim()) ? 'Print account card' : 'Missing password'}
                          >
                            {accountPrintingStaffId === row.staff_id
                              ? 'Printing...'
                              : String(row.temp_account_name ?? '').trim() || normalizeWorkAccountValue(row.work_account)}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={accountAssigningStaffId === row.staff_id || !normalizePositionKey(String(row.position ?? '').trim())}
                            onClick={async () => {
                              const ok = await assignTempAccountToRow(row);
                              if (!ok) return;
                            }}
                            className="underline decoration-dotted underline-offset-4 transition hover:text-[#e8dfcf] disabled:cursor-not-allowed disabled:opacity-60"
                            title="Assign temp account"
                          >
                            {accountAssigningStaffId === row.staff_id ? 'Assigning...' : 'Assign account'}
                          </button>
                        )}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3 text-stone-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        <span
                          className={[
                            'inline-flex items-center rounded-full border px-2.5 py-1',
                            getShiftBadgeClass(row.shift)
                          ].join(' ')}
                        >
                          {formatShiftLabel(row.display_shift || row.shift)}
                        </span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-3', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        {(() => {
                          const count = Number(row.mistake_count_7d ?? 0);
                          const toneClass =
                            count <= 0
                              ? 'border-white/12 bg-white/[0.04] text-stone-200'
                              : count <= 2
                                ? 'border-stone-300/25 bg-stone-200/[0.08] text-stone-50'
                                : 'border-rose-400/50 bg-rose-500/15 text-rose-100';
                          return (
                            <button
                              type="button"
                              onClick={() => void openMistakeDetails(row)}
                              className={[
                                'inline-flex min-w-[48px] items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold transition hover:brightness-110',
                                toneClass
                              ].join(' ')}
                              title="View mistake report details"
                            >
                              {count}
                            </button>
                          );
                        })()}
                      </td>
                      <td
                        className={[
                          'whitespace-nowrap px-3 py-3',
                          hasOverPunch ? 'border-y border-r border-rose-500/90' : ''
                        ].join(' ')}
                      >
                        {row.punches.length === 0 ? (
                          <span className="font-semibold text-rose-300">Absent</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            {Array.from({ length: 4 }).map((_, idx) => {
                              const punch = visiblePunches[idx];
                              if (!punch) {
                                return (
                                  <span
                                    key={`${row.staff_id}-p-empty-${idx}`}
                                    className="inline-flex min-w-[72px] items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-stone-500"
                                  >
                                    -
                                  </span>
                                );
                              }
                              const isShortGapPunch = shortGapPunchIndices.has(idx);
                              return (
                                <span
                                  key={punch.id || `${row.staff_id}-p-${idx}`}
                                  className={[
                                    'inline-flex min-w-[72px] items-center justify-center rounded-full border px-2 py-1 text-[11px] font-semibold',
                                    isShortGapPunch
                                      ? 'border-rose-400 bg-rose-600/40 text-rose-100 shadow-[0_0_0_1px_rgba(251,113,133,0.45)]'
                                      : punch.action === 'IN'
                                        ? 'border-stone-200/20 bg-stone-100/[0.08] text-stone-50'
                                        : 'border-white/12 bg-white/[0.04] text-stone-300'
                                  ].join(' ')}
                                  title={formatDateTime(punch.created_at)}
                                >
                                  {`${punch.action} ${formatTimeOnly(punch.created_at)}`}
                                </span>
                              );
                            })}
                            {hasOverPunch && (
                              <button
                                type="button"
                                onClick={() => openPunchDetails(row)}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-200/25 bg-stone-100/[0.08] text-stone-100 transition hover:bg-stone-100/[0.12]"
                                title="View all punches for today"
                                aria-label="View all punches for today"
                              >
                                <WarningIcon className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && renderedRows.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-stone-500" colSpan={10}>
                      No scheduled work rows for this operational date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </div>
        )}
        {!error && !loading && renderedRows.length < filteredRows.length && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setRenderCount((prev) => Math.min(prev + 120, filteredRows.length))}
              className="rounded-full border border-white/10 bg-white/[0.05] px-5 py-2.5 text-sm text-stone-100 transition hover:bg-white/[0.08]"
            >
              Load more
            </button>
          </div>
        )}

        {mistakeReportOpen && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-[#0b0c0e]/70 p-4 pt-8 sm:pt-12"
            onClick={() => {
              if (mistakeReportSubmitting) return;
              closeMistakeReportDialog();
            }}
          >
            <div
              className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-[#17191c] shadow-[0_28px_80px_rgba(0,0,0,0.45)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <div className="text-lg font-semibold text-stone-100">Mistake Report</div>
                  <div className="text-xs text-stone-400">Create a daily mistake report</div>
                </div>
                <button
                  type="button"
                  disabled={mistakeReportSubmitting}
                  onClick={closeMistakeReportDialog}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-xs text-stone-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Close
                </button>
              </div>
              <div className="grid gap-4 px-5 py-5">
                <div>
                  <label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-stone-400">Position</label>
                  <select
                    value={mistakeReportPosition}
                    onChange={(e) => {
                      setMistakeReportPosition(e.target.value);
                      setMistakeReportEmployeeStaffId('');
                      setMistakeReportEmployeeQuery('');
                      setMistakeReportEmployeeDropdownOpen(false);
                    }}
                    disabled={mistakeReportSubmitting}
                    className="h-11 w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-100 outline-none transition focus:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Select position</option>
                    {mistakeReportPositionOptions.map((position) => (
                      <option key={position} value={position}>
                        {position}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-stone-400">Employee (USID)</label>
                  <div ref={mistakeEmployeePickerRef} className="relative">
                    <div
                      className={[
                        'flex h-11 w-full items-center rounded-[18px] border bg-white/[0.04] px-4 text-sm text-stone-100 transition',
                        mistakeReportSubmitting || !mistakeReportPosition ? 'border-white/10 opacity-60' : 'border-white/10 focus-within:border-white/20'
                      ].join(' ')}
                    >
                      <input
                        value={mistakeReportEmployeeQuery}
                        onChange={(e) => {
                          setMistakeReportEmployeeQuery(e.target.value);
                          if (!mistakeReportEmployeeDropdownOpen) setMistakeReportEmployeeDropdownOpen(true);
                          if (mistakeReportEmployeeStaffId) setMistakeReportEmployeeStaffId('');
                        }}
                        onFocus={() => {
                          if (!mistakeReportSubmitting && mistakeReportPosition) {
                            setMistakeReportEmployeeDropdownOpen(true);
                            if (!mistakeReportEmployeeQuery && selectedMistakeReportEmployeeLabel) {
                              setMistakeReportEmployeeQuery(selectedMistakeReportEmployeeLabel);
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setMistakeReportEmployeeDropdownOpen(false);
                            return;
                          }
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const first = mistakeReportEmployeeFilteredOptions[0];
                            if (!first) return;
                            setMistakeReportEmployeeStaffId(String(first.staff_id ?? ''));
                            setMistakeReportEmployeeQuery(`${first.staff_id} - ${first.name || '-'}`);
                            setMistakeReportEmployeeDropdownOpen(false);
                          }
                        }}
                        disabled={mistakeReportSubmitting || !mistakeReportPosition}
                        placeholder={mistakeReportPosition ? 'Type to search employee USID / name' : 'Select position first'}
                        className="h-full flex-1 bg-transparent text-stone-100 outline-none placeholder:text-stone-500 disabled:cursor-not-allowed"
                      />
                      <button
                        type="button"
                        disabled={mistakeReportSubmitting || !mistakeReportPosition}
                        onClick={() => setMistakeReportEmployeeDropdownOpen((prev) => !prev)}
                        className="ml-2 text-stone-400 transition hover:text-stone-200 disabled:cursor-not-allowed"
                      >
                        <ChevronDownIcon />
                      </button>
                    </div>
                    {mistakeReportEmployeeDropdownOpen && mistakeReportPosition && (
                      <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-[20px] border border-white/10 bg-[#17191c] shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
                        <div className="max-h-56 overflow-auto py-1">
                          {mistakeReportEmployeeFilteredOptions.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-stone-500">No matched employee</div>
                          ) : (
                            mistakeReportEmployeeFilteredOptions.map((row) => {
                              const staff = String(row.staff_id ?? '');
                              const label = `${staff} - ${row.name || '-'}`;
                              const selected = staff === mistakeReportEmployeeStaffId;
                              return (
                                <button
                                  key={staff}
                                  type="button"
                                  onClick={() => {
                                    setMistakeReportEmployeeStaffId(staff);
                                    setMistakeReportEmployeeQuery(label);
                                    setMistakeReportEmployeeDropdownOpen(false);
                                  }}
                                  className={[
                                    'flex w-full items-center px-4 py-3 text-left text-sm transition',
                                    selected ? 'bg-white/[0.08] text-stone-50' : 'text-stone-200 hover:bg-white/[0.05]'
                                  ].join(' ')}
                                >
                                  {label}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-stone-400">Mistake Reason</label>
                  <textarea
                    value={mistakeReportReason}
                    onChange={(e) => setMistakeReportReason(e.target.value)}
                    disabled={mistakeReportSubmitting}
                    rows={4}
                    placeholder="Describe the mistake"
                    className="w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-stone-400">Reporter (USID)</label>
                  <input
                    value={mistakeReportReporterStaffId}
                    onChange={(e) => setMistakeReportReporterStaffId(normalizeStaffId(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      setMistakeReportReporterStaffId((prev) => normalizeStaffId(prev));
                    }}
                    disabled={mistakeReportSubmitting}
                    placeholder="Scan or enter reporter USID"
                    className="h-11 w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-100 outline-none transition focus:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
                <button
                  type="button"
                  disabled={mistakeReportSubmitting}
                  onClick={closeMistakeReportDialog}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-medium text-stone-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={mistakeReportSubmitting}
                  onClick={() => void submitMistakeReport()}
                  className="rounded-full border border-[#d9cfbf]/40 bg-[#e8dfcf] px-4 py-2 text-xs font-semibold text-[#181614] transition hover:bg-[#f0e9dc] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {mistakeReportSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        )}

        {mistakeDetailOpen &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0c0e]/70 p-4"
              onClick={() => {
                if (mistakeDetailLoading) return;
                setMistakeDetailOpen(false);
              }}
            >
              <div
                className="flex h-[78vh] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#17191c] shadow-[0_28px_80px_rgba(0,0,0,0.45)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <div>
                    <div className="text-lg font-semibold text-stone-100">Mistake Details</div>
                    <div className="text-xs text-stone-400">
                      {mistakeDetailStaffId
                        ? `Employee: ${mistakeDetailStaffId}${mistakeDetailStaffName ? ` - ${mistakeDetailStaffName}` : ''}`
                        : 'Employee details'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMistakeDetailOpen(false)}
                    disabled={mistakeDetailLoading}
                    className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-xs text-stone-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Close
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full table-fixed border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-[#17191c]/95 text-xs uppercase tracking-[0.16em] text-stone-400">
                      <tr>
                        <th className="w-[120px] px-3 py-2 text-left">Date</th>
                        <th className="w-[140px] px-3 py-2 text-left">Position</th>
                        <th className="px-3 py-2 text-left">Reason</th>
                        <th className="w-[180px] px-3 py-2 text-left">Reporter</th>
                        <th className="w-[190px] px-3 py-2 text-left">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mistakeDetailLoading && (
                        <tr>
                          <td className="px-3 py-8 text-center text-slate-500" colSpan={5}>
                            Loading...
                          </td>
                        </tr>
                      )}
                      {!mistakeDetailLoading && mistakeDetailError && (
                        <tr>
                          <td className="px-3 py-8 text-center text-rose-300" colSpan={5}>
                            Load failed: {mistakeDetailError}
                          </td>
                        </tr>
                      )}
                      {!mistakeDetailLoading && !mistakeDetailError && mistakeDetailRows.map((item) => (
                        <tr key={item.id || `${item.employee_staff_id}-${item.created_at}-${item.reason}`} className="border-t border-white/5 odd:bg-white/[0.03]">
                          <td className="whitespace-nowrap px-3 py-2 align-top text-stone-300">{item.operational_date || '-'}</td>
                          <td className="whitespace-nowrap px-3 py-2 align-top text-stone-100">{item.position || '-'}</td>
                          <td className="px-3 py-2 align-top text-stone-100 whitespace-pre-wrap break-words">{item.reason || '-'}</td>
                          <td className="px-3 py-2 align-top text-stone-100">{item.reporter_name || item.reporter_staff_id || '-'}</td>
                          <td className="whitespace-nowrap px-3 py-2 align-top text-stone-300">{item.created_at ? formatDateTime(item.created_at) : '-'}</td>
                        </tr>
                      ))}
                      {!mistakeDetailLoading && !mistakeDetailError && mistakeDetailRows.length === 0 && (
                        <tr>
                          <td className="px-3 py-8 text-center text-slate-500" colSpan={5}>
                            No mistake reports in the last 7 days.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>,
            document.body
          )}

        {punchDetailOpen &&
          typeof document !== 'undefined' &&
          createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0c0e]/70 p-4" onClick={() => setPunchDetailOpen(false)}>
              <div
                className="flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#17191c] shadow-[0_28px_80px_rgba(0,0,0,0.45)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <div>
                    <div className="text-lg font-semibold text-stone-100">Punch Details</div>
                    <div className="text-xs text-stone-400">
                      {punchDetailStaffId
                        ? `Employee: ${punchDetailStaffId}${punchDetailStaffName ? ` - ${punchDetailStaffName}` : ''}`
                        : 'Today punch details'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPunchDetailOpen(false)}
                    className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-xs text-stone-200 transition hover:bg-white/[0.08]"
                  >
                    Close
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full table-fixed border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-[#17191c]/95 text-xs uppercase tracking-[0.16em] text-stone-400">
                      <tr>
                        <th className="w-[120px] px-3 py-2 text-left">Action</th>
                        <th className="w-[120px] px-3 py-2 text-left">Time</th>
                        <th className="px-3 py-2 text-left">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {punchDetailRows.map((punch, idx) => (
                        <tr key={punch.id || `${punch.staff_id}-${punch.created_at}-${idx}`} className="border-t border-white/5 odd:bg-white/[0.03]">
                          <td className="px-3 py-2 align-top">
                            <span
                              className={[
                                'inline-flex min-w-[72px] items-center justify-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                                punch.action === 'IN'
                                  ? 'border-stone-200/20 bg-stone-100/[0.08] text-stone-50'
                                  : 'border-white/12 bg-white/[0.04] text-stone-300'
                              ].join(' ')}
                            >
                              {punch.action}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 align-top text-stone-100">{formatTimeOnly(punch.created_at)}</td>
                          <td className="whitespace-nowrap px-3 py-2 align-top text-stone-300">{formatDateTime(punch.created_at)}</td>
                        </tr>
                      ))}
                      {punchDetailRows.length === 0 && (
                        <tr>
                          <td className="px-3 py-8 text-center text-slate-500" colSpan={3}>
                            No punches for today.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>,
            document.body
          )}

        {accountUsageOpen && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-[#0b0c0e]/70 p-4 pt-8 sm:pt-12"
            onClick={() => setAccountUsageOpen(false)}
          >
            <div
              className="w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/10 bg-[#17191c] shadow-[0_28px_80px_rgba(0,0,0,0.45)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <div className="text-lg font-semibold text-stone-100">Account usage</div>
                  <div className="text-xs text-stone-400">Who is using which temporary account</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAccountUsageOpen(false)}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-xs text-stone-200 transition hover:bg-white/[0.08]"
                >
                  Close
                </button>
              </div>
              <div className="border-b border-white/10 px-5 py-4">
                <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                  <label className="flex h-11 items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.04] px-4">
                    <SearchIcon className="h-4 w-4 text-stone-400" />
                    <input
                      value={accountUsageSearch}
                      onChange={(e) => setAccountUsageSearch(e.target.value)}
                      placeholder="Search by account, alias, or user"
                      className="h-full w-full bg-transparent text-sm text-stone-100 outline-none placeholder:text-stone-500"
                    />
                  </label>
                  <div className="relative">
                    <select
                      value={accountUsagePositionFilter}
                      onChange={(e) => setAccountUsagePositionFilter(e.target.value)}
                      className="h-11 w-full appearance-none rounded-[18px] border border-white/10 bg-white/[0.04] px-4 pr-10 text-sm text-stone-100 outline-none transition focus:border-white/20"
                    >
                      <option value="">All positions</option>
                      {accountUsagePositionOptions.map((position) => (
                        <option key={position} value={position}>
                          {position}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  </div>
                </div>
              </div>
              <div className="max-h-[65vh] overflow-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-[#17191c]/95 text-xs uppercase tracking-[0.16em] text-stone-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Staff ID</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Position</th>
                      <th className="px-3 py-2 text-left">Account Name</th>
                      <th className="px-3 py-2 text-left">Account</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccountUsageRows.map((item) => (
                      <tr key={item.id || `${item.staff_id}-${item.work_account}-${item.created_at}`} className="border-t border-white/5 odd:bg-white/[0.03]">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-stone-100">{item.staff_id || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-stone-100">{item.name || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-stone-300">{item.position || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-stone-100">{item.account_name || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-stone-100">{item.work_account || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span
                            className={[
                              'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                              item.status === 'Active'
                                ? 'border-stone-200/25 bg-stone-100/[0.08] text-stone-50'
                                : 'border-white/12 bg-white/[0.04] text-stone-300'
                            ].join(' ')}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-stone-300">{item.created_at ? formatDateTime(item.created_at) : '-'}</td>
                      </tr>
                    ))}
                    {filteredAccountUsageRows.length === 0 && (
                      <tr>
                        <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                          No assignment records yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        <AppDialog
          open={noticeDialog.open}
          title={noticeDialog.title}
          message={noticeDialog.message}
          confirmText="OK"
          onConfirm={() => setNoticeDialog((prev) => ({ ...prev, open: false }))}
        />
      </section>
    </main>
  );
}
