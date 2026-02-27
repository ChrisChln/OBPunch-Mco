import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { createSupabaseClient } from './lib/supabase';
import { getLabelToneClass, loadLabelToneMap } from './lib/labelTone';

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

type TempAssignmentPayload = {
  work_account: string;
  work_password: string;
  account_name: string;
  source_temp_staff_id: string;
};

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const PUNCHES_TABLE = 'ob_punches';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';
const TEMP_ACCOUNT_TABLE = (import.meta.env.VITE_TEMP_ACCOUNT_TABLE as string | undefined) ?? 'ob_temp_accounts';
const TEMP_ACCOUNT_ASSIGNMENT_TABLE =
  (import.meta.env.VITE_TEMP_ACCOUNT_ASSIGNMENT_TABLE as string | undefined) ?? 'ob_temp_account_assignments';
const DEVICE_TABLE = (import.meta.env.VITE_DEVICE_TABLE as string | undefined) ?? 'ob_devices';
const DEVICE_LOANS_TABLE = (import.meta.env.VITE_DEVICE_LOANS_TABLE as string | undefined) ?? 'ob_device_loans';
const supabase = createSupabaseClient({ persistSession: false });
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
  if (raw === '-' || raw === '--' || raw === '—' || lower === 'n/a' || lower === 'na' || lower === 'null') return '';
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
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'early') return 'Morning';
  if (v === 'late') return 'Night';
  return value || '-';
};
const normalizePositionKey = (value: string): '' | 'Pick' | 'Pack' | 'Rebin' | 'Preship' | 'Transfer' => {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'pick' || v.includes('pick') || v.includes('拣货')) return 'Pick';
  if (v === 'pack' || v.includes('pack') || v.includes('打包')) return 'Pack';
  if (v === 'rebin' || v.includes('rebin') || v.includes('上架') || v.includes('回仓')) return 'Rebin';
  if (v === 'preship' || v.includes('preship') || v.includes('发货')) return 'Preship';
  if (v === 'transfer' || v.includes('transfer') || v.includes('转运')) return 'Transfer';
  return '';
};
const getPositionBadgeClass = (value: string) => {
  const pos = normalizePositionKey(value);
  if (pos === 'Pick') return 'border-sky-400/60 text-sky-200 bg-sky-500/10';
  if (pos === 'Pack') return 'border-emerald-400/60 text-emerald-200 bg-emerald-500/10';
  if (pos === 'Rebin') return 'border-amber-400/60 text-amber-200 bg-amber-500/10';
  if (pos === 'Preship') return 'border-rose-400/60 text-rose-200 bg-rose-500/10';
  if (pos === 'Transfer') return 'border-violet-400/60 text-violet-200 bg-violet-500/10';
  return 'border-white/20 text-slate-200 bg-white/5';
};
const getShiftBadgeClass = (value: string) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'early') return 'border-amber-400/60 text-amber-200 bg-amber-500/10';
  if (v === 'late') return 'border-indigo-400/60 text-indigo-200 bg-indigo-500/10';
  return 'border-white/20 text-slate-200 bg-white/5';
};
const CARD_POSITIONS: Array<'Pick' | 'Pack' | 'Rebin' | 'Preship' | 'Transfer'> = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer'];
const getAttendanceCardClass = (position: string) => {
  const pos = normalizePositionKey(position);
  if (pos === 'Pick') return 'border-sky-400/35 bg-sky-500/[0.04]';
  if (pos === 'Pack') return 'border-emerald-400/35 bg-emerald-500/[0.04]';
  if (pos === 'Rebin') return 'border-amber-400/35 bg-amber-500/[0.04]';
  if (pos === 'Preship') return 'border-rose-400/35 bg-rose-500/[0.04]';
  if (pos === 'Transfer') return 'border-violet-400/35 bg-violet-500/[0.04]';
  return 'border-white/15 bg-white/[0.03]';
};
const getAttendanceCardValueClass = (position: string) => {
  const pos = normalizePositionKey(position);
  if (pos === 'Pick') return 'text-sky-300';
  if (pos === 'Pack') return 'text-emerald-300';
  if (pos === 'Rebin') return 'text-amber-300';
  if (pos === 'Preship') return 'text-rose-300';
  if (pos === 'Transfer') return 'text-violet-300';
  return 'text-slate-200';
};

const chunkArray = <T,>(list: T[], size: number): T[][] => {
  if (size <= 0) return [list];
  const chunks: T[][] = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
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
    const staff = String(row.staff_id ?? '').trim();
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
  const value = raw.toLowerCase();
  if (value.includes('temp_work') || raw.includes('临时工作')) return 'temp_work';
  if (value.includes('temp_rest') || raw.includes('临时排休') || value.includes('temporary off')) return 'temp_rest';
  if (value.includes('leave') || value.includes('excuse') || raw.includes('请假')) return 'leave';
  if (value.includes('rest') || value === 'off' || raw.includes('休息')) return 'rest';
  return 'work';
};

const isWorkingScheduleState = (state: string) => state === 'work' || state === 'temp_work';
const isRestLikeScheduleState = (state: string) => state === 'rest' || state === 'temp_rest' || state === 'leave';

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

const isAutoSignOutPunch = (punch: PunchRow) => {
  if (punch.action !== 'OUT') return false;
  const dt = new Date(String(punch.created_at ?? '').trim());
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getHours() === DAY_CUTOFF_HOUR && dt.getMinutes() === 0 && dt.getSeconds() === 0;
};

export default function DashboardPage() {
  const [rows, setRows] = useState<DashboardRow[]>([]);
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
  const [accountUsageSearch, setAccountUsageSearch] = useState('');
  const [accountUsagePositionFilter, setAccountUsagePositionFilter] = useState('');
  const [accountUsageRows, setAccountUsageRows] = useState<TempAccountUsageRow[]>([]);
  const inFlightRef = useRef(false);
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
      const currentOperationalDate = range.operationalDate;
      const operationalDateObj = new Date(`${currentOperationalDate}T00:00:00`);
      const operationalDayIndex = Number.isNaN(operationalDateObj.getTime()) ? 0 : (operationalDateObj.getDay() + 6) % 7;
      const templateDate = getTemplateDateByDayIndex(operationalDayIndex);
      let scheduleRowsRaw: any[] = [];
      const scheduleByDateRes = await supabase
        .from(SCHEDULE_TABLE)
        .select('id, staff_id, position, shift, note, updated_at, created_at, date')
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
          .select('id, staff_id, position, shift, note, updated_at, created_at, date')
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
          .select('id, staff_id, position, shift, note, updated_at, created_at, work_date')
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
          .select('id, staff_id, position, shift, note, updated_at, created_at, date')
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
      const scheduledByStaff = new Map<
        string,
        {
          position: string;
          shift: string;
          scheduleState: string;
        }
      >();
      for (const row of latestScheduleRows) {
        const staffId = String((row as any).staff_id ?? '').trim();
        if (!staffId) continue;
        const scheduleState = getScheduleStateFromNote((row as any).note);
        scheduledByStaff.set(staffId, {
          position: String((row as any).position ?? (row as any).Position ?? '').trim(),
          shift: String((row as any).shift ?? '').trim(),
          scheduleState
        });
      }
      const scheduledStaffIds = Array.from(scheduledByStaff.keys());

      if (scheduledStaffIds.length === 0) {
        if (fetchSeqRef.current === currentSeq) {
          setRows([]);
          setOperationalDate(currentOperationalDate);
          setLastUpdatedAt(new Date().toLocaleString('en-CA', { hour12: false }));
        }
        return;
      }

      const punchesByStaff = new Map<string, PunchRow[]>();
      const staffBatchesForPunches = chunkArray(scheduledStaffIds, 120);
      for (const batch of staffBatchesForPunches) {
        const punchesRes = await supabase
          .from(PUNCHES_TABLE)
          .select('id, staff_id, action, created_at')
          .in('staff_id', batch)
          .gte('created_at', rangeStartIso)
          .lt('created_at', rangeEndIso)
          .order('created_at', { ascending: true })
          .limit(10000);

        if (punchesRes.error) {
          if (fetchSeqRef.current === currentSeq) {
            setError(punchesRes.error.message);
            setRows([]);
          }
          return;
        }

        for (const row of ((punchesRes.data as any[] | null) ?? [])) {
          const staffId = String(row.staff_id ?? '').trim();
          if (!staffId) continue;
          const normalizedPunch: PunchRow = {
            id: String(row.id ?? ''),
            staff_id: staffId,
            action: String(row.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
            created_at: String(row.created_at ?? '')
          };
          if (isAutoSignOutPunch(normalizedPunch)) continue;
          const list = punchesByStaff.get(staffId) ?? [];
          list.push(normalizedPunch);
          punchesByStaff.set(staffId, list);
        }
      }

      const missingStaffIds = scheduledStaffIds.filter((staffId) => !employeeCacheRef.current.has(staffId));
      for (const staffIds of chunkArray(missingStaffIds, 200)) {
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
          const staffId = String(row.staff_id ?? '').trim();
          if (!staffId || employeeCacheRef.current.has(staffId)) continue;
          employeeCacheRef.current.set(staffId, {
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
            shift: String(row.shift ?? '').trim()
          });
        }
      }

      const nextRows: DashboardRow[] = scheduledStaffIds
        .sort((a, b) => a.localeCompare(b, 'en-US'))
        .map((staffId) => {
          const employee = employeeCacheRef.current.get(staffId);
          const schedule = scheduledByStaff.get(staffId);
          const punches = punchesByStaff.get(staffId) ?? [];
          const state = String(schedule?.scheduleState ?? '');
          const attendance: DashboardRow['attendance'] =
            isWorkingScheduleState(state) && punches.length === 0
              ? 'Absent'
              : isRestLikeScheduleState(state) && punches.length > 0
                ? 'Off Worked'
                : 'Normal';
          return {
            staff_id: staffId,
            name: employee?.name ?? '',
            agency: employee?.agency ?? '',
            position: employee?.position ?? schedule?.position ?? '',
            label: employee?.label ?? '',
            borrowed_device: '',
            schedule_state: state,
            work_account: normalizeWorkAccountValue(employee?.work_account ?? ''),
            work_password: employee?.work_password ?? '',
            hire_date: employee?.hire_date ?? '',
            shift: employee?.shift ?? schedule?.shift ?? '',
            temp_account_name: '',
            temp_source_staff_id: '',
            punches,
            attendance
          };
        })
        .filter((row) => {
          const state = String(scheduledByStaff.get(row.staff_id)?.scheduleState ?? '');
          const isPlannedWork = isWorkingScheduleState(state);
          const isOffWorked = isRestLikeScheduleState(state) && row.punches.length > 0;
          const isNoProfile =
            !String(row.name ?? '').trim() &&
            !String(row.label ?? '').trim() &&
            !normalizeWorkAccountValue(row.work_account);
          if (isNoProfile) return false;
          return isPlannedWork || isOffWorked;
        });

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
      for (const staffBatch of chunkArray(scheduledStaffIds, 120)) {
        const loansRes = await supabase
          .from(DEVICE_LOANS_TABLE)
          .select('id, staff_id, device_sn, action, created_at')
          .in('staff_id', staffBatch)
          .order('created_at', { ascending: true })
          .limit(20000);
        if (loansRes.error) continue;
        const loanRows = ((loansRes.data as any[]) ?? [])
          .map((row) => ({
            id: String(row.id ?? ''),
            staff_id: String(row.staff_id ?? '').trim(),
            device_sn: normalizeDeviceSn(String(row.device_sn ?? '')),
            action: String(row.action ?? '').trim().toLowerCase() === 'return' ? 'return' : 'borrow',
            created_at: String(row.created_at ?? '')
          }))
          .filter((row) => row.staff_id && row.device_sn);
        loanRows.sort((a, b) => {
          const aMs = Date.parse(a.created_at) || 0;
          const bMs = Date.parse(b.created_at) || 0;
          if (aMs !== bMs) return aMs - bMs;
          return a.id.localeCompare(b.id, 'en-US');
        });
        const currentBorrowBySn = new Map<string, string>();
        for (const row of loanRows) {
          if (row.action === 'borrow') currentBorrowBySn.set(row.device_sn, row.staff_id);
          else currentBorrowBySn.delete(row.device_sn);
        }
        const activeSnList = Array.from(currentBorrowBySn.entries())
          .filter(([, staffId]) => staffBatch.includes(staffId))
          .map(([sn]) => sn);
        if (activeSnList.length === 0) continue;
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
          if (!staffBatch.includes(staffId)) continue;
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
            `${r.staff_id}:${r.attendance}:${r.punches.length}:${r.punches[r.punches.length - 1]?.id ?? ''}:${r.borrowed_device}:${r.schedule_state}:${r.work_account}:${r.temp_account_name}`
        )
        .join(';')}`;

      if (fetchSeqRef.current !== currentSeq) return;
      if (rowsDigestRef.current !== digest) {
        rowsDigestRef.current = digest;
        setRows(nextRows);
      }
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

  const positionOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => String(row.position ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );
  const shiftOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => String(row.shift ?? '').trim().toLowerCase()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );
  const labelToneMap = useMemo(() => loadLabelToneMap(), [rows.length]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (positionFilter && String(row.position ?? '').trim() !== positionFilter) return false;
      if (shiftFilter && String(row.shift ?? '').trim().toLowerCase() !== shiftFilter) return false;
      if (absentOnly && row.attendance !== 'Absent') return false;
      if (onClockOnly) {
        const last = row.punches[row.punches.length - 1];
        if (!last || last.action !== 'IN') return false;
      }
      if (offWorkOnly && row.attendance !== 'Off Worked') return false;
      if (!q) return true;
      const haystack = `${row.staff_id} ${row.name} ${row.agency} ${row.label} ${row.work_account} ${row.temp_account_name} ${row.borrowed_device}`.toLowerCase();
      return haystack.includes(q);
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
      ? accountUsageRows.filter((row) => String(row.position ?? '').trim() === accountUsagePositionFilter)
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
      Array.from(new Set(accountUsageRows.map((row) => String(row.position ?? '').trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [accountUsageRows]
  );
  const attendanceCards = useMemo(() => {
    const cards: Array<{
      position: 'Pick' | 'Pack' | 'Rebin' | 'Preship' | 'Transfer';
      shift: 'early' | 'late';
      expected: number;
      present: number;
      onClock: number;
    }> = [];
    for (const shift of ['early', 'late'] as const) {
      for (const position of CARD_POSITIONS) {
        const scope = rows.filter(
          (row) =>
            normalizePositionKey(row.position) === position &&
            String(row.shift ?? '').trim().toLowerCase() === shift &&
            isWorkingScheduleState(row.schedule_state)
        );
        const expected = scope.length;
        const present = scope.filter((row) => row.punches.length > 0).length;
        const onClock = scope.filter((row) => {
          const last = row.punches[row.punches.length - 1];
          return last?.action === 'IN';
        }).length;
        cards.push({ position, shift, expected, present, onClock });
      }
    }
    return cards;
  }, [rows]);

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
      window.alert(`Print failed: ${err instanceof Error ? err.message : String(err ?? 'unknown error')}`);
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
        window.alert(`Assign failed: ${poolRes.error.message}`);
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
        window.alert(`No available temp account for ${position}.`);
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
        window.alert(`Assign failed: ${insertRes.error.message}`);
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
      window.alert(`Print failed: ${err instanceof Error ? err.message : String(err ?? 'unknown error')}`);
    } finally {
      setAccountPrintingStaffId((current) => (current === staff ? null : current));
    }
  };

  return (
    <main className="min-h-screen px-6 py-6 text-paper">
      <section className="glass rounded-3xl px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl tracking-[0.08em]">Dashboard</h1>
            <p className="mt-1 text-xs text-slate-400">
              Schedule date: <span className="text-slate-200">{operationalDate || '-'}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAccountUsageOpen(true)}
              className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/15"
            >
              Account usage
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/15"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void fetchData()}
              className="rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-5">
          {attendanceCards.map((card) => {
            const ratio = card.expected > 0 ? (card.present / card.expected) * 100 : 0;
            return (
              <div key={`${card.position}:${card.shift}`} className={['rounded-xl border px-3 py-2', getAttendanceCardClass(card.position)].join(' ')}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      {card.shift === 'early' ? 'Morning shift' : 'Night shift'} {card.position}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {card.present}/{card.expected}
                      <span
                        className={[
                          'ml-2 font-bold',
                          ratio < 80 ? 'text-rose-400' : ratio >= 90 ? 'text-emerald-400' : 'text-slate-300'
                        ].join(' ')}
                      >
                        {card.expected > 0 ? `${ratio.toFixed(1)}%` : '0.0%'}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-[86px] rounded-lg border border-white/15 bg-black/20 px-3 py-1.5 text-center">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-300">On Clock</div>
                    <div className={['mt-0.5 text-3xl font-bold leading-none', getAttendanceCardValueClass(card.position)].join(' ')}>
                      {card.onClock}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_170px_170px_170px_auto_auto]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by staff id / name / account"
            className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-neon"
          />
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="h-11 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none transition focus:border-neon"
          >
            <option value="">All positions</option>
            {positionOptions.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
          <select
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
            className="h-11 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none transition focus:border-neon"
          >
            <option value="">All shifts</option>
            {shiftOptions.map((shift) => (
              <option key={shift} value={shift}>
                {formatShiftLabel(shift)}
              </option>
            ))}
          </select>
          <label className="flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={absentOnly}
              onChange={(e) => setAbsentOnly(e.target.checked)}
              className="h-4 w-4 rounded border-white/30 bg-transparent accent-rose-500"
            />
            Absent only
          </label>
          <label className="flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={onClockOnly}
              onChange={(e) => setOnClockOnly(e.target.checked)}
              className="h-4 w-4 rounded border-white/30 bg-transparent accent-emerald-500"
            />
            On Clock
          </label>
          <label className="flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={offWorkOnly}
              onChange={(e) => setOffWorkOnly(e.target.checked)}
              className="h-4 w-4 rounded border-white/30 bg-transparent accent-sky-500"
            />
            Off Work
          </label>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-xs text-slate-300">
            Rows: <span className="text-slate-100">{renderedRows.length}</span> / {filteredRows.length}
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-xs text-slate-300">
            Updated: <span className="text-slate-100">{lastUpdatedAt || '-'}</span>
          </div>
        </div>

        {loading && <p className="mt-3 text-sm text-slate-300">Loading...</p>}
        {error && <p className="mt-3 text-sm text-rose-300">Load failed: {error}</p>}

        {!error && (
          <div className="mt-4 overflow-auto rounded-2xl border border-white/10">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-950/95 text-xs uppercase tracking-[0.16em] text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">SN</th>
                  <th className="px-3 py-2 text-left">Staff ID</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Position</th>
                  <th className="px-3 py-2 text-left">Label</th>
                  <th className="px-3 py-2 text-left">Device</th>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-left">Shift</th>
                  <th className="px-3 py-2 text-left">Punch Logs</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row, idx) => {
                  const rowToneClass =
                    row.attendance === 'Absent'
                      ? 'bg-rose-500/10'
                      : row.attendance === 'Off Worked'
                        ? 'bg-sky-500/10'
                        : 'odd:bg-white/[0.03]';
                  const hasOverPunch = row.punches.length > 4;
                  const visiblePunches = row.punches.slice(0, 4);
                  const shortGapPunchIndices = getShortGapPunchIndices(visiblePunches, 10);

                  const displayStaffId = isNewHirePlaceholderStaffId(row.staff_id) ? '' : row.staff_id;
                  return (
                    <tr key={row.staff_id} className={['border-t border-white/5 transition-colors hover:bg-white/5', rowToneClass].join(' ')}>
                      <td
                        className={[
                          'whitespace-nowrap px-3 py-2 font-mono text-slate-400',
                          hasOverPunch ? 'border-y border-l border-rose-500/90' : ''
                        ].join(' ')}
                      >
                        {idx + 1}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-2 font-mono text-slate-200', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        {displayStaffId ? (
                          <button
                            type="button"
                            disabled={badgePrintingStaffId === row.staff_id}
                            onClick={() => void printTempBadge(row)}
                            className="underline decoration-dotted underline-offset-2 transition hover:text-neon disabled:cursor-not-allowed disabled:opacity-60"
                            title="Print temp badge"
                          >
                            {badgePrintingStaffId === row.staff_id ? 'Printing...' : displayStaffId}
                          </button>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-2 text-slate-200', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        {row.name || '-'}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-2 text-slate-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        <span
                          className={[
                            'inline-flex items-center rounded-md border px-2 py-0.5',
                            getPositionBadgeClass(row.position)
                          ].join(' ')}
                        >
                          {row.position || '-'}
                        </span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-2 text-slate-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        <span
                          className={[
                            'inline-flex items-center rounded-md border px-2 py-0.5',
                            getLabelToneClass(row.label || '', labelToneMap)
                          ].join(' ')}
                        >
                          {row.label || '-'}
                        </span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-2 text-slate-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        <span
                          className={[
                            'inline-flex items-center rounded-md border px-2 py-0.5',
                            row.borrowed_device
                              ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                              : 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200'
                          ].join(' ')}
                        >
                          {row.borrowed_device || 'No borrowed device'}
                        </span>
                      </td>
                      <td className={['whitespace-nowrap px-3 py-2 text-slate-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        {normalizeWorkAccountValue(row.work_account) ? (
                          <button
                            type="button"
                            disabled={!resolveDefaultPassword(normalizeWorkAccountValue(row.work_account), String(row.work_password ?? '').trim()) || accountPrintingStaffId === row.staff_id}
                            onClick={() => void printAccountCard(row)}
                            className="underline decoration-dotted underline-offset-2 transition hover:text-neon disabled:cursor-not-allowed disabled:opacity-60"
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
                            className="underline decoration-dotted underline-offset-2 transition hover:text-neon disabled:cursor-not-allowed disabled:opacity-60"
                            title="Assign temp account"
                          >
                            {accountAssigningStaffId === row.staff_id ? 'Assigning...' : 'Assign account'}
                          </button>
                        )}
                      </td>
                      <td className={['whitespace-nowrap px-3 py-2 text-slate-300', hasOverPunch ? 'border-y border-rose-500/90' : ''].join(' ')}>
                        <span
                          className={[
                            'inline-flex items-center rounded-md border px-2 py-0.5',
                            getShiftBadgeClass(row.shift)
                          ].join(' ')}
                        >
                          {formatShiftLabel(row.shift)}
                        </span>
                      </td>
                      <td
                        className={[
                          'whitespace-nowrap px-3 py-2',
                          hasOverPunch ? 'border-y border-r border-rose-500/90' : ''
                        ].join(' ')}
                      >
                        {row.punches.length === 0 ? (
                          <span className="font-semibold text-rose-300">Absent</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 4 }).map((_, idx) => {
                              const punch = visiblePunches[idx];
                              if (!punch) {
                                return (
                                  <span
                                    key={`${row.staff_id}-p-empty-${idx}`}
                                    className="inline-flex min-w-[86px] items-center justify-center rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-xs text-slate-500"
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
                                    'inline-flex min-w-[86px] items-center justify-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                                    isShortGapPunch
                                      ? 'border-rose-400 bg-rose-600/40 text-rose-100 shadow-[0_0_0_1px_rgba(251,113,133,0.45)]'
                                      : punch.action === 'IN'
                                        ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                                        : 'border-sky-400/60 bg-sky-500/15 text-sky-200'
                                  ].join(' ')}
                                  title={formatDateTime(punch.created_at)}
                                >
                                  {`${punch.action} ${formatTimeOnly(punch.created_at)}`}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && renderedRows.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={9}>
                      No scheduled work rows for this operational date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!error && !loading && renderedRows.length < filteredRows.length && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setRenderCount((prev) => Math.min(prev + 120, filteredRows.length))}
              className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/15"
            >
              Load more
            </button>
          </div>
        )}

        {accountUsageOpen && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-4 pt-12"
            onClick={() => setAccountUsageOpen(false)}
          >
            <div
              className="w-full max-w-6xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <div className="text-lg font-semibold text-slate-100">Account usage</div>
                  <div className="text-xs text-slate-400">Who is using which temporary account</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAccountUsageOpen(false)}
                  className="rounded-xl bg-white/10 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/15"
                >
                  Close
                </button>
              </div>
              <div className="border-b border-white/10 px-4 py-3">
                <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                  <input
                    value={accountUsageSearch}
                    onChange={(e) => setAccountUsageSearch(e.target.value)}
                    placeholder="Search by account name / account / user name"
                    className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-neon"
                  />
                  <select
                    value={accountUsagePositionFilter}
                    onChange={(e) => setAccountUsagePositionFilter(e.target.value)}
                    className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-100 outline-none transition focus:border-neon"
                  >
                    <option value="">All positions</option>
                    {accountUsagePositionOptions.map((position) => (
                      <option key={position} value={position}>
                        {position}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="max-h-[65vh] overflow-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-950/95 text-xs uppercase tracking-[0.16em] text-slate-400">
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
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-200">{item.staff_id || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-200">{item.name || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-300">{item.position || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-200">{item.account_name || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-100">{item.work_account || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span
                            className={[
                              'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                              item.status === 'Active'
                                ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                                : 'border-slate-400/50 bg-slate-500/10 text-slate-300'
                            ].join(' ')}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-300">{item.created_at ? formatDateTime(item.created_at) : '-'}</td>
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
      </section>
    </main>
  );
}
