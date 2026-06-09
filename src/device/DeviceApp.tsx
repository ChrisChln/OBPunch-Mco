import { useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseClient } from '../lib/supabase';
import { isValidPunchStaffId, normalizeStaffId } from '../lib/staffId';

type DeviceType = string; // 现在支持任意自定义设备类型值
type LoanAction = 'borrow' | 'return';
type StatusTone = 'idle' | 'pending' | 'success' | 'error';
type DeviceOpLog = {
  id: string;
  at: string;
  tone: Exclude<StatusTone, 'idle' | 'pending'>;
  text: string;
};

type DeviceRow = {
  id?: number | string;
  device_name?: string | null;
  device_sn?: string | null;
  device_type?: string | null;
  position?: string | null;
  active?: boolean | null;
  note?: string | null;
  created_at?: string | null;
};

type DeviceLoanRow = {
  id?: number | string;
  created_at?: string | null;
  staff_id?: string | null;
  device_sn?: string | null;
  action?: string | null;
};

type EmployeeRow = {
  staff_id?: string | null;
  name?: string | null;
};

const ALLOWED_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'FLEX TEAM'] as const;
type AllowedPosition = (typeof ALLOWED_POSITIONS)[number];

const DEVICE_TABLE = (import.meta.env.VITE_DEVICE_TABLE as string | undefined) ?? 'ob_devices';
const DEVICE_LOANS_TABLE = (import.meta.env.VITE_DEVICE_LOANS_TABLE as string | undefined) ?? 'ob_device_loans';
const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const BORROW_OVERDUE_MS = 8 * 60 * 60 * 1000;
const COUNTING_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const DEVICE_FILTERS_STORAGE_KEY = 'ob_device_filters_v1';
const COUNTING_NOTE_PATTERN = /\[COUNTED_AT=([^\]]+)\]/i;

const supabase = createSupabaseClient({ persistSession: false });

const normalizeDeviceSn = (value: string) => String(value ?? '').trim().toUpperCase();
const normalizeDeviceType = (value: unknown): DeviceType => {
  const raw = String(value ?? '').trim();
  if (!raw) return 'PDA'; // 空值默认为 PDA
  
  // 兼容旧别名
  const upper = raw.toUpperCase();
  if (upper === 'CAR' || raw === '车') return 'CART';
  
  // 返回规范化后的值
  return raw;
};
const parseCountedAtFromNote = (note: unknown) => {
  const text = String(note ?? '');
  const m = text.match(COUNTING_NOTE_PATTERN);
  return m?.[1] ? String(m[1]).trim() : '';
};
const upsertCountedAtNote = (note: unknown, iso: string) => {
  const marker = `[COUNTED_AT=${iso}]`;
  const base = String(note ?? '').trim();
  if (!base) return marker;
  if (COUNTING_NOTE_PATTERN.test(base)) return base.replace(COUNTING_NOTE_PATTERN, marker).trim();
  return `${base} ${marker}`.trim();
};

const playDeviceSound = (kind: 'successIn' | 'successOut' | 'error') => {
  if (typeof Audio === 'undefined') return;
  const src =
    kind === 'successIn'
      ? encodeURI('/sound/success in.mp3')
      : kind === 'successOut'
        ? encodeURI('/sound/success out.mp3')
        : '/sound/error.mp3';
  try {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      void p.catch(() => {
        // ignore autoplay/permission errors
      });
    }
  } catch {
    // ignore autoplay/permission errors
  }
};

const getDevicePositionToneClass = (value: string) => {
  const pos = String(value ?? '').trim().toLowerCase();
  if (pos === 'pick') return 'border-sky-300/22 bg-gradient-to-br from-sky-400/[0.14] via-sky-300/[0.05] to-transparent';
  if (pos === 'pack') return 'border-rose-300/22 bg-gradient-to-br from-rose-400/[0.14] via-rose-300/[0.05] to-transparent';
  if (pos === 'rebin') return 'border-emerald-300/22 bg-gradient-to-br from-emerald-400/[0.14] via-emerald-300/[0.05] to-transparent';
  if (pos === 'preship') return 'border-amber-300/22 bg-gradient-to-br from-amber-400/[0.14] via-amber-300/[0.05] to-transparent';
  if (pos === 'transfer') return 'border-violet-300/22 bg-gradient-to-br from-violet-400/[0.14] via-violet-300/[0.05] to-transparent';
  if (
    pos === '兜底组' ||
    pos === '兜底' ||
    pos === 'flex team（机动组）' ||
    pos === 'flex team' ||
    pos === 'flexteam' ||
    pos === 'wrap-up team' ||
    pos === 'wrap up team' ||
    pos === 'wrapup team' ||
    pos === 'fallback' ||
    pos === 'backup'
  ) {
    return 'border-slate-300/22 bg-gradient-to-br from-slate-400/[0.14] via-slate-300/[0.05] to-transparent';
  }
  return 'border-white/12 bg-white/[0.03]';
};

const getDeviceStatusCardClass = (statusTone: 'available' | 'counting' | 'overdue' | 'borrowed', position: string) => {
  const positionTone = getDevicePositionToneClass(position);
  if (statusTone === 'available') return positionTone;
  if (statusTone === 'counting') return 'border-sky-300/25 bg-gradient-to-br from-sky-400/[0.16] via-sky-300/[0.06] to-transparent';
  if (statusTone === 'overdue') return 'border-rose-300/25 bg-gradient-to-br from-rose-400/[0.16] via-rose-300/[0.06] to-transparent';
  return 'border-amber-300/25 bg-gradient-to-br from-amber-400/[0.16] via-amber-300/[0.06] to-transparent';
};

export default function DeviceApp() {
  type SavedFilters = {
    search: string;
    positionFilter: AllowedPosition | '';
    typeFilter: DeviceType | '';
    borrowedOnly: boolean;
  };
  const loadSavedFilters = (): SavedFilters => {
    if (typeof window === 'undefined') {
      return { search: '', positionFilter: '', typeFilter: '', borrowedOnly: false };
    }
    try {
      const raw = window.localStorage.getItem(DEVICE_FILTERS_STORAGE_KEY);
      if (!raw) return { search: '', positionFilter: '', typeFilter: '', borrowedOnly: false };
      const parsed = JSON.parse(raw) as {
        search?: string;
        positionFilter?: string;
        typeFilter?: string;
        borrowedOnly?: boolean;
      };
      const position =
        ALLOWED_POSITIONS.includes(parsed.positionFilter as AllowedPosition) ? (parsed.positionFilter as AllowedPosition) : '';
      const type = parsed.typeFilter === 'PDA' || parsed.typeFilter === 'CART' ? (parsed.typeFilter as DeviceType) : '';
      return {
        search: String(parsed.search ?? ''),
        positionFilter: position,
        typeFilter: type,
        borrowedOnly: Boolean(parsed.borrowedOnly)
      };
    } catch {
      return { search: '', positionFilter: '', typeFilter: '', borrowedOnly: false };
    }
  };
  const savedFilters = loadSavedFilters();
  const [scanMode, setScanMode] = useState<LoanAction>('borrow');
  const [staffIdInput, setStaffIdInput] = useState('');
  const [snInput, setSnInput] = useState('');
  const [search, setSearch] = useState(savedFilters.search);
  const [positionFilter, setPositionFilter] = useState<AllowedPosition | ''>(savedFilters.positionFilter);
  const [typeFilter, setTypeFilter] = useState<DeviceType | ''>(savedFilters.typeFilter);
  const [borrowedOnly, setBorrowedOnly] = useState(savedFilters.borrowedOnly);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loans, setLoans] = useState<DeviceLoanRow[]>([]);
  const [nameByStaffId, setNameByStaffId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [message, setMessage] = useState<{ tone: StatusTone; text: string }>({
    tone: 'idle',
    text: 'Scan to borrow/return devices'
  });
  const [opLogs, setOpLogs] = useState<DeviceOpLog[]>([]);
  const [countingOpen, setCountingOpen] = useState(false);
  const [countingSnInput, setCountingSnInput] = useState('');
  const staffRef = useRef<HTMLInputElement | null>(null);
  const snRef = useRef<HTMLInputElement | null>(null);
  const countingSnRef = useRef<HTMLInputElement | null>(null);

  const fetchLastPunchAction = async (staffId: string) => {
    if (!supabase) {
      return { action: null as 'IN' | 'OUT' | null, error: 'Missing Supabase configuration.' };
    }
    const normalized = normalizeStaffId(String(staffId ?? '').trim());
    if (!normalized) {
      return { action: null as 'IN' | 'OUT' | null, error: 'Invalid staff ID.' };
    }
    const base = () => supabase.from('ob_punches').select('id, action, created_at').eq('staff_id', normalized).limit(1);
    const attemptCreatedAt = await base().order('created_at', { ascending: false });
    const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: false }) : attemptCreatedAt;
    if (attempt.error) {
      return { action: null as 'IN' | 'OUT' | null, error: attempt.error.message };
    }
    const row = ((attempt.data as Array<{ action?: string | null }> | null) ?? [])[0] ?? null;
    const action = String(row?.action ?? '').trim().toUpperCase();
    return {
      action: action === 'IN' || action === 'OUT' ? (action as 'IN' | 'OUT') : null,
      error: null as string | null
    };
  };

  const canonicalDevices = useMemo(() => {
    return devices
      .map((row) => ({
        ...row,
        device_name: String(row.device_name ?? '').trim() || null,
        device_sn: normalizeDeviceSn(String(row.device_sn ?? '')),
        device_type: normalizeDeviceType(row.device_type),
        position: String(row.position ?? '').trim() || null,
        active: row.active !== false
      }))
      .filter((row) => row.device_sn);
  }, [devices]);

  const canonicalLoans = useMemo(() => {
    return loans
      .map((row) => ({
        ...row,
        staff_id: normalizeStaffId(String(row.staff_id ?? '').trim()),
        device_sn: normalizeDeviceSn(String(row.device_sn ?? '')),
        action: String(row.action ?? '').trim().toLowerCase() === 'return' ? 'return' : 'borrow'
      }))
      .filter((row) => row.staff_id && row.device_sn);
  }, [loans]);

  const deviceBySn = useMemo(() => {
    const map = new Map<string, (typeof canonicalDevices)[number]>();
    for (const row of canonicalDevices) {
      map.set(row.device_sn!, row);
    }
    return map;
  }, [canonicalDevices]);

  const currentBorrowBySn = useMemo(() => {
    const sorted = [...canonicalLoans].sort((a, b) => {
      const aMs = Date.parse(String(a.created_at ?? '')) || 0;
      const bMs = Date.parse(String(b.created_at ?? '')) || 0;
      if (aMs !== bMs) return aMs - bMs;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''), 'en-US');
    });
    const map = new Map<string, { staffId: string; createdAt: string }>();
    for (const row of sorted) {
      if (row.action === 'borrow') {
        map.set(row.device_sn!, { staffId: row.staff_id!, createdAt: String(row.created_at ?? '') });
      } else {
        map.delete(row.device_sn!);
      }
    }
    return map;
  }, [canonicalLoans]);
  const lastUserBySn = useMemo(() => {
    const sortedDesc = [...canonicalLoans].sort((a, b) => {
      const aMs = Date.parse(String(a.created_at ?? '')) || 0;
      const bMs = Date.parse(String(b.created_at ?? '')) || 0;
      if (aMs !== bMs) return bMs - aMs;
      return String(b.id ?? '').localeCompare(String(a.id ?? ''), 'en-US');
    });
    const map = new Map<string, string>();
    for (const row of sortedDesc) {
      const sn = String(row.device_sn ?? '').trim();
      const staff = String(row.staff_id ?? '').trim();
      if (!sn || !staff) continue;
      if (!map.has(sn)) map.set(sn, staff);
    }
    return map;
  }, [canonicalLoans]);
  const lastLoanAtBySn = useMemo(() => {
    const map = new Map<string, string>();
    const sortedDesc = [...canonicalLoans].sort((a, b) => {
      const aMs = Date.parse(String(a.created_at ?? '')) || 0;
      const bMs = Date.parse(String(b.created_at ?? '')) || 0;
      if (aMs !== bMs) return bMs - aMs;
      return String(b.id ?? '').localeCompare(String(a.id ?? ''), 'en-US');
    });
    for (const row of sortedDesc) {
      const sn = String(row.device_sn ?? '').trim();
      if (!sn || map.has(sn)) continue;
      map.set(sn, String(row.created_at ?? ''));
    }
    return map;
  }, [canonicalLoans]);

  const statusRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return canonicalDevices
      .filter((row) => {
        if (row.active === false) return false;
        const position = String(row.position ?? '').trim() as AllowedPosition | '';
        const type = normalizeDeviceType(row.device_type);
        if (!q) return true;
        const holder = currentBorrowBySn.get(row.device_sn!);
        const name = holder ? nameByStaffId[holder.staffId] ?? '' : '';
        const matchesSearch = `${row.device_name ?? ''} ${row.device_sn} ${row.device_type} ${row.position ?? ''} ${holder?.staffId ?? ''} ${name}`
          .toLowerCase()
          .includes(q);
        const matchesPosition = !positionFilter || position === positionFilter;
        const matchesType = !typeFilter || type === typeFilter;
        const matchesBorrowed = !borrowedOnly || Boolean(holder);
        return matchesSearch && matchesPosition && matchesType && matchesBorrowed;
      })
      .filter((row) => {
        if (row.active === false) return false;
        const position = String(row.position ?? '').trim() as AllowedPosition | '';
        const type = normalizeDeviceType(row.device_type);
        const holder = currentBorrowBySn.get(row.device_sn!);
        const matchesPosition = !positionFilter || position === positionFilter;
        const matchesType = !typeFilter || type === typeFilter;
        const matchesBorrowed = !borrowedOnly || Boolean(holder);
        return matchesPosition && matchesType && matchesBorrowed;
      })
      .sort((a, b) => {
        const nameA = String(a.device_name ?? '').trim();
        const nameB = String(b.device_name ?? '').trim();
        const byName = nameA.localeCompare(nameB, 'en-US', { sensitivity: 'base', numeric: true });
        if (byName !== 0) return byName;
        return a.device_sn!.localeCompare(b.device_sn!, 'en-US', { numeric: true, sensitivity: 'base' });
      });
  }, [borrowedOnly, canonicalDevices, currentBorrowBySn, nameByStaffId, positionFilter, search, typeFilter]);

  const toneClass = useMemo(() => {
    if (message.tone === 'success') return 'text-emerald-300';
    if (message.tone === 'error') return 'text-rose-300';
    if (message.tone === 'pending') return 'text-amber-300';
    return 'text-slate-300';
  }, [message.tone]);

  const formatBorrowDuration = (borrowedAt: string) => {
    const startMs = Date.parse(String(borrowedAt ?? ''));
    if (!Number.isFinite(startMs) || startMs <= 0) return '-';
    const sec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  const getBorrowAgeMs = (borrowedAt: string) => {
    const startMs = Date.parse(String(borrowedAt ?? ''));
    if (!Number.isFinite(startMs) || startMs <= 0) return 0;
    return Math.max(0, nowMs - startMs);
  };
  const pushOpLog = (tone: DeviceOpLog['tone'], text: string) => {
    const entry: DeviceOpLog = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      tone,
      text
    };
    setOpLogs((prev) => [entry, ...prev].slice(0, 16));
  };

  const getNeedCounting = (row: (typeof canonicalDevices)[number]) => {
    const sn = String(row.device_sn ?? '').trim();
    if (!sn) return false;
    if (currentBorrowBySn.get(sn)) return false;
    const lastLoanAtMs = Date.parse(String(lastLoanAtBySn.get(sn) ?? '')) || 0;
    const createdAtMs = Date.parse(String(row.created_at ?? '')) || 0;
    const countedAtMs = Date.parse(parseCountedAtFromNote(row.note)) || 0;
    if (lastLoanAtMs <= 0 && countedAtMs <= 0) return true;
    const baselineMs = Math.max(lastLoanAtMs, createdAtMs, countedAtMs);
    if (!Number.isFinite(baselineMs) || baselineMs <= 0) return false;
    return nowMs - baselineMs >= COUNTING_STALE_MS;
  };

  const handleCountingSubmit = async () => {
    const sn = normalizeDeviceSn(countingSnInput);
    if (!sn) {
      setMessage({ tone: 'error', text: 'Counting failed: empty SN' });
      pushOpLog('error', 'Counting empty SN');
      return;
    }
    const device = deviceBySn.get(sn);
    if (!device) {
      setMessage({ tone: 'error', text: `Counting failed: device not found (${sn})` });
      pushOpLog('error', `Counting device not found (${sn})`);
      setCountingSnInput('');
      window.setTimeout(() => countingSnRef.current?.focus(), 0);
      return;
    }
    if (!supabase) {
      setMessage({ tone: 'error', text: 'Counting failed: missing system configuration' });
      pushOpLog('error', 'Counting missing system configuration');
      return;
    }
    const nowIso = new Date().toISOString();
    const deviceName = String(device.device_name ?? '').trim() || sn;
    const nextNote = upsertCountedAtNote(device.note, nowIso);
    const updateRes = await supabase.from(DEVICE_TABLE).update({ note: nextNote }).eq('device_sn', sn);
    if (updateRes.error) {
      setMessage({ tone: 'error', text: `Counting failed: ${updateRes.error.message}` });
      pushOpLog('error', `Counting ${deviceName} failed`);
      return;
    }
    setMessage({ tone: 'success', text: `Counting success: ${deviceName}` });
    pushOpLog('success', `Counting ${deviceName}`);
    setCountingSnInput('');
    await fetchAll();
    setNowMs(Date.now());
    window.setTimeout(() => countingSnRef.current?.focus(), 0);
  };

  const fetchAll = async () => {
    if (!supabase) {
      setMessage({ tone: 'error', text: 'Missing Supabase configuration.' });
      return;
    }
    setLoading(true);
    try {
      const [deviceRes, loanRes] = await Promise.all([
        supabase
          .from(DEVICE_TABLE)
          .select('id, device_name, device_sn, device_type, position, active, note, created_at')
          .order('created_at', { ascending: false })
          .limit(3000),
        supabase
          .from(DEVICE_LOANS_TABLE)
          .select('id, created_at, staff_id, device_sn, action')
          .order('created_at', { ascending: false })
          .limit(6000)
      ]);

      if (deviceRes.error) {
        setMessage({ tone: 'error', text: `Failed to load devices: ${deviceRes.error.message}` });
        return;
      }
      if (loanRes.error) {
        setMessage({ tone: 'error', text: `Failed to load loans: ${loanRes.error.message}` });
        return;
      }

      const nextDevices = ((deviceRes.data as any[]) ?? []) as DeviceRow[];
      const nextLoans = ((loanRes.data as any[]) ?? []) as DeviceLoanRow[];
      setDevices(nextDevices);
      setLoans(nextLoans);

      const staffSet = new Set<string>();
      for (const row of nextLoans) {
        const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
        if (staff) staffSet.add(staff);
      }
      const ids = Array.from(staffSet);
      if (ids.length === 0) {
        setNameByStaffId({});
        return;
      }

      const map: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const batch = ids.slice(i, i + 200);
        const res = await supabase.from(EMPLOYEE_TABLE).select('staff_id, name').in('staff_id', batch);
        if (res.error) continue;
        for (const row of ((res.data as any[]) ?? []) as EmployeeRow[]) {
          const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
          const name = String(row.name ?? '').trim();
          if (staff) map[staff] = name || staff;
        }
      }
      setNameByStaffId(map);
    } finally {
      setLoading(false);
    }
  };

  const submit = async (mode: LoanAction) => {
    const staffId = normalizeStaffId(staffIdInput.trim());
    const sn = normalizeDeviceSn(snInput);
    const toDeviceName = (nameRaw: unknown) => {
      const name = String(nameRaw ?? '').trim();
      return name || 'Unknown Device';
    };
    const getStaffName = (idRaw: unknown) => {
      const id = normalizeStaffId(String(idRaw ?? '').trim());
      return String(nameByStaffId[id] ?? '').trim() || 'Unknown Staff';
    };
    const clearBorrowInputsOnFailure = () => {
      if (mode !== 'borrow') return;
      setStaffIdInput('');
      setSnInput('');
      window.setTimeout(() => staffRef.current?.focus(), 0);
    };
    if (mode === 'borrow' && (!staffId || !isValidPunchStaffId(staffId))) {
      setMessage({ tone: 'error', text: 'Invalid staff ID. Please scan again.' });
      pushOpLog('error', 'Borrow invalid employee scan');
      clearBorrowInputsOnFailure();
      playDeviceSound('error');
      return;
    }
    if (!sn) {
      setMessage({ tone: 'error', text: 'Empty device SN. Please scan again.' });
      pushOpLog('error', 'Return empty device scan');
      playDeviceSound('error');
      return;
    }
    if (!supabase) {
      setMessage({ tone: 'error', text: 'Missing Supabase configuration.' });
      pushOpLog('error', `${mode === 'borrow' ? 'Borrow' : 'Return'} missing system configuration`);
      playDeviceSound('error');
      return;
    }

    let borrowStaffName = '';
    if (mode === 'borrow') {
      const employeeCheck = await supabase.from(EMPLOYEE_TABLE).select('staff_id, name').eq('staff_id', staffId).limit(1);
      if (employeeCheck.error) {
        setMessage({ tone: 'error', text: `Failed to verify employee: ${employeeCheck.error.message}` });
        pushOpLog('error', 'Borrow employee verify error');
        clearBorrowInputsOnFailure();
        playDeviceSound('error');
        return;
      }
      const employeeRows = ((employeeCheck.data as Array<{ staff_id?: string | null; name?: string | null }>) ?? []).filter((row) =>
        normalizeStaffId(String(row.staff_id ?? '').trim())
      );
      if (employeeRows.length === 0) {
        setMessage({ tone: 'error', text: `Employee not registered: ${staffId}` });
        pushOpLog('error', 'Borrow employee not registered');
        clearBorrowInputsOnFailure();
        playDeviceSound('error');
        return;
      }
      borrowStaffName = String(employeeRows[0]?.name ?? '').trim();
      const lastPunch = await fetchLastPunchAction(staffId);
      if (lastPunch.error) {
        setMessage({ tone: 'error', text: `Failed to verify sign-in: ${lastPunch.error}` });
        pushOpLog('error', 'Borrow sign-in verify error');
        clearBorrowInputsOnFailure();
        playDeviceSound('error');
        return;
      }
      if (lastPunch.action !== 'IN') {
        setMessage({ tone: 'error', text: 'Employee must be signed in before borrowing a device.' });
        pushOpLog('error', 'Borrow blocked: employee not signed in');
        clearBorrowInputsOnFailure();
        playDeviceSound('error');
        return;
      }
    }
    const device = deviceBySn.get(sn);
    if (!device) {
      setMessage({ tone: 'error', text: `Device not found: ${sn}` });
      pushOpLog('error', `${mode === 'borrow' ? 'Borrow' : 'Return'} device not found`);
      playDeviceSound('error');
      return;
    }
    const deviceName = toDeviceName(device.device_name);
    if (device.active === false) {
      setMessage({ tone: 'error', text: `Device disabled: ${sn}` });
      pushOpLog('error', `${mode === 'borrow' ? 'Borrow' : 'Return'} ${deviceName} disabled`);
      clearBorrowInputsOnFailure();
      playDeviceSound('error');
      return;
    }
    const borrowed = currentBorrowBySn.get(sn);
    if (mode === 'borrow' && borrowed) {
      const holderName = nameByStaffId[borrowed.staffId] ?? borrowed.staffId;
      setMessage({ tone: 'error', text: `Already borrowed: ${sn} (${holderName})` });
      pushOpLog('error', `Borrow ${deviceName} is with ${holderName}`);
      clearBorrowInputsOnFailure();
      playDeviceSound('error');
      return;
    }
    if (mode === 'return' && !borrowed) {
      setMessage({ tone: 'error', text: `Not currently borrowed: ${sn}` });
      pushOpLog('error', `Return ${deviceName} not currently borrowed`);
      playDeviceSound('error');
      return;
    }
    setMessage({ tone: 'pending', text: mode === 'borrow' ? 'Borrowing...' : 'Returning...' });
    const submitStaffId = mode === 'borrow' ? staffId : borrowed!.staffId;
    const res = await supabase.from(DEVICE_LOANS_TABLE).insert([
      {
        staff_id: submitStaffId,
        device_sn: sn,
        action: mode,
        operator: 'device_page',
        created_at: new Date().toISOString()
      } as any
    ]);
    if (res.error) {
      setMessage({ tone: 'error', text: `Submit failed: ${res.error.message}` });
      if (mode === 'borrow') {
        const staffName = borrowStaffName || getStaffName(staffId);
        pushOpLog('error', `Borrow ${staffName} / ${deviceName}`);
        clearBorrowInputsOnFailure();
      } else {
        const holderName = getStaffName(borrowed!.staffId);
        pushOpLog('error', `Return ${holderName} / ${deviceName}`);
      }
      playDeviceSound('error');
      return;
    }

    if (mode === 'borrow') {
      const staffName = borrowStaffName || getStaffName(staffId);
      pushOpLog('success', `Borrow ${staffName} / ${deviceName}`);
    } else {
      const holderName = getStaffName(borrowed!.staffId);
      pushOpLog('success', `Return ${holderName} / ${deviceName}`);
    }
    setMessage({
      tone: 'success',
      text: mode === 'borrow' ? `Borrowed: ${staffId} -> ${sn}` : `Returned: ${sn}`
    });
    playDeviceSound(mode === 'borrow' ? 'successIn' : 'successOut');
    setStaffIdInput('');
    setSnInput('');
    await fetchAll();
    if (mode === 'borrow') staffRef.current?.focus();
    else snRef.current?.focus();
  };

  useEffect(() => {
    void fetchAll();
    const timer = window.setInterval(() => {
      void fetchAll();
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      DEVICE_FILTERS_STORAGE_KEY,
      JSON.stringify({
        search,
        positionFilter,
        typeFilter,
        borrowedOnly
      })
    );
  }, [search, positionFilter, typeFilter, borrowedOnly]);

  useEffect(() => {
    const timer = window.setTimeout(() => staffRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!countingOpen) return;
    const timer = window.setTimeout(() => countingSnRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [countingOpen]);

  const needCountingCount = useMemo(() => {
    let count = 0;
    for (const row of statusRows) {
      if (getNeedCounting(row)) count += 1;
    }
    return count;
  }, [statusRows, nowMs, currentBorrowBySn, lastLoanAtBySn]);
  return (
    <div className="min-h-screen bg-ink text-paper">
      <main className="w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <section className="glass mx-auto w-full max-w-[1580px] rounded-[32px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          <header className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)]">
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-300">
                Device Operations
              </div>
              <div className="space-y-2">
                <h1 className="font-display text-4xl leading-none tracking-[0.03em] text-stone-50 sm:text-5xl">Device Desk</h1>
                <p className={['max-w-2xl text-sm leading-6 sm:text-[15px]', toneClass].join(' ')}>{message.text}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-start justify-end gap-2">
              <button
                type="button"
                onClick={() => setCountingOpen(true)}
                className="inline-flex items-center rounded-full border border-sky-300/25 bg-sky-400/[0.10] px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-sky-400/[0.14]"
              >
                Counting{needCountingCount > 0 ? ` (${needCountingCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.href = '/';
                }}
                className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-stone-200 transition hover:bg-white/[0.08]"
              >
                Punch
              </button>
              <button
                type="button"
                onClick={() => void fetchAll()}
                disabled={loading}
                className="rounded-full border border-[#d9cfbf]/40 bg-[#e8dfcf] px-4 py-2 text-sm font-semibold text-[#181614] transition hover:bg-[#f0e9dc] disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </header>

          <section className="mt-6 grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
            <div className="rounded-[28px] border border-white/10 bg-black/20 p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Device Actions</div>
                  <div className="mt-1 text-sm text-stone-300">Borrow and return flow with live operation log.</div>
                </div>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScanMode('borrow')}
                className={[
                  'h-12 w-full rounded-[20px] px-3 text-sm font-semibold transition',
                  scanMode === 'borrow'
                    ? 'border border-emerald-300/25 bg-emerald-400/[0.12] text-emerald-100'
                    : 'border border-white/15 bg-white/[0.04] text-stone-200 hover:bg-white/[0.08]'
                ].join(' ')}
              >
                Borrow
              </button>
              <button
                type="button"
                onClick={() => setScanMode('return')}
                className={[
                  'h-12 w-full rounded-[20px] px-3 text-sm font-semibold transition',
                  scanMode === 'return'
                    ? 'border border-rose-300/25 bg-rose-400/[0.12] text-rose-100'
                    : 'border border-white/15 bg-white/[0.04] text-stone-200 hover:bg-white/[0.08]'
                ].join(' ')}
              >
                Return
              </button>
            </div>
            <div className="min-h-[188px] rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
              <label
                className={[
                  'text-xs uppercase tracking-[0.18em] text-stone-400 transition-opacity',
                  scanMode === 'borrow' ? 'opacity-100' : 'opacity-0'
                ].join(' ')}
              >
                US ID
              </label>
              <input
                ref={staffRef}
                value={staffIdInput}
                onChange={(e) => setStaffIdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    snRef.current?.focus();
                  }
                }}
                placeholder="Scan staff ID first"
                disabled={scanMode !== 'borrow'}
                className={[
                  'mt-2 h-12 w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 text-base text-stone-100 outline-none transition focus:border-white/20',
                  scanMode === 'borrow' ? 'opacity-100' : 'pointer-events-none opacity-0'
                ].join(' ')}
              />
              <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-stone-400">SN</label>
              <input
                ref={snRef}
                value={snInput}
                onChange={(e) => setSnInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submit(scanMode);
                  }
                }}
                placeholder="Then scan device SN"
                className="mt-2 h-12 w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 text-base text-stone-100 outline-none transition focus:border-white/20"
              />
            </div>
            <div className="mt-4 h-[420px] rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Latest Result</div>
              <div className="h-[calc(100%-1.5rem)] space-y-2 overflow-auto pr-1">
                {opLogs.map((row) => (
                  <div
                    key={row.id}
                    className={[
                      'rounded-[18px] border bg-white/[0.04] px-3 py-2',
                      row.tone === 'success' ? 'border-emerald-300/25' : 'border-rose-300/25'
                    ].join(' ')}
                  >
                    {(() => {
                      const isBorrow = row.text.startsWith('Borrow');
                      const isReturn = row.text.startsWith('Return');
                      const actionLabel = isBorrow ? 'Borrow' : isReturn ? 'Return' : '';
                      const detailTextRaw = actionLabel ? row.text.slice(actionLabel.length).trimStart() : row.text;
                      const detailText = detailTextRaw.replace(/\s*\/\s*/g, ' · ');
                      const actionClass = isBorrow
                        ? 'border border-emerald-300/25 bg-emerald-400/[0.10] text-emerald-100'
                        : isReturn
                          ? 'border border-rose-300/25 bg-rose-400/[0.10] text-rose-100'
                          : row.tone === 'success'
                            ? 'border border-emerald-300/25 bg-emerald-400/[0.10] text-emerald-100'
                            : 'border border-rose-300/25 bg-rose-400/[0.10] text-rose-100';
                      const detailClass = 'text-stone-100';
                      return (
                        <div className="flex items-center gap-2">
                          {actionLabel && (
                            <span className={['inline-flex h-6 min-w-[64px] items-center justify-center rounded-full px-2 text-[10px] font-semibold leading-none tracking-[0.12em]', actionClass].join(' ')}>
                              {actionLabel}
                            </span>
                          )}
                          <span className={['min-w-0 flex-1 truncate text-xs font-semibold leading-none', detailClass].join(' ')} title={detailText}>
                            {detailText}
                          </span>
                          <span className="shrink-0 text-[11px] text-stone-500">{new Date(row.at).toLocaleTimeString('en-US', { hour12: false })}</span>
                        </div>
                      );
                    })()}
                  </div>
                ))}
                {opLogs.length === 0 && <div className="pt-10 text-center text-xs text-stone-500">No records yet</div>}
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-black/20 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">Device Status</div>
                <div className="mt-1 text-sm text-stone-300">Live availability, borrowing state, and last known holder.</div>
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SN / holder / position"
                className="h-11 w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-100 outline-none transition focus:border-white/20 md:w-72"
              />
            </div>
            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter((e.target.value as AllowedPosition | '') ?? '')}
                className="h-11 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-100 outline-none transition focus:border-white/20"
              >
                <option value="">All positions</option>
                {ALLOWED_POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter((e.target.value as DeviceType | '') ?? '')}
                className="h-11 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-100 outline-none transition focus:border-white/20"
              >
                <option value="">All types</option>
                <option value="PDA">PDA</option>
                <option value="CART">CART</option>
              </select>
              <label className="flex h-11 items-center gap-2 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-200">
                <input
                  type="checkbox"
                  checked={borrowedOnly}
                  onChange={(e) => setBorrowedOnly(e.target.checked)}
                  className="h-4 w-4 accent-[#e8dfcf]"
                />
                Borrowed only
              </label>
            </div>
            <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-auto pr-1 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {statusRows.map((row) => {
                const sn = row.device_sn!;
                const borrowed = currentBorrowBySn.get(sn);
                const holderName = borrowed ? nameByStaffId[borrowed.staffId] ?? borrowed.staffId : '';
                const lastUserStaffId = lastUserBySn.get(sn) ?? '';
                const lastUserName = lastUserStaffId ? nameByStaffId[lastUserStaffId] ?? lastUserStaffId : '-';
                const borrowAgeMs = borrowed ? getBorrowAgeMs(borrowed.createdAt) : 0;
                const needsCounting = getNeedCounting(row);
                const statusTone = !borrowed
                  ? needsCounting
                    ? 'counting'
                    : 'available'
                  : borrowAgeMs >= BORROW_OVERDUE_MS
                    ? 'overdue'
                    : 'borrowed';
                const cardClass = getDeviceStatusCardClass(statusTone, String(row.position ?? ''));
                const statusTextClass =
                  statusTone === 'available'
                    ? 'text-stone-100'
                    : statusTone === 'counting'
                      ? 'text-sky-100'
                    : statusTone === 'overdue'
                      ? 'text-rose-100'
                      : 'text-amber-100';
                return (
                  <div
                    key={sn}
                    className={['min-h-[210px] rounded-[24px] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors', cardClass].join(' ')}
                  >
                    <div className="flex h-full flex-col justify-between">
                      <div>
                        <div className="text-sm font-semibold text-stone-100">{row.device_name || '-'}</div>
                        <div className="mt-1 text-xs text-stone-400">
                          {row.device_type} · {row.position || 'No position'}
                        </div>
                      </div>
                      <div className="border-t border-white/10 pt-3">
                        {borrowed ? (
                          <>
                            <div className={['text-xs font-semibold uppercase tracking-[0.12em]', statusTextClass].join(' ')}>
                              {statusTone === 'overdue' ? 'Borrowed >8h' : 'Borrowed'}
                            </div>
                            <div className="mt-2 text-sm text-stone-100">{holderName}</div>
                            <div className="mt-1 text-[11px] text-stone-400">Duration: {formatBorrowDuration(borrowed.createdAt)}</div>
                            <div className="mt-0.5 text-[11px] text-stone-400">Last user: {lastUserName}</div>
                          </>
                        ) : (
                          <>
                            <div className={['text-xs font-semibold uppercase tracking-[0.12em]', statusTextClass].join(' ')}>
                              {statusTone === 'counting' ? 'Need Counting' : 'Available'}
                            </div>
                            <div className="mt-2 text-[11px] text-stone-400">Last user: {lastUserName}</div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {statusRows.length === 0 && <div className="col-span-full py-6 text-sm text-stone-400">No device data.</div>}
            </div>
          </div>
        </section>
        </section>
      </main>
      {countingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0c0e]/70 p-4">
          <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#17191c] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-stone-100">Counting</h3>
              <button
                type="button"
                onClick={() => setCountingOpen(false)}
                className="rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-xs font-medium text-stone-200 transition hover:bg-white/[0.08]"
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-xs text-stone-400">Scan device SN to clear Need Counting status.</p>
            <input
              ref={countingSnRef}
              value={countingSnInput}
              onChange={(e) => setCountingSnInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCountingSubmit();
                }
              }}
              placeholder="Scan device SN"
              className="h-11 w-full rounded-[18px] border border-white/10 bg-white/[0.04] px-4 text-sm text-stone-100 outline-none transition focus:border-white/20"
            />
            <button
              type="button"
              onClick={() => void handleCountingSubmit()}
              className="mt-3 h-11 w-full rounded-[18px] border border-sky-300/25 bg-sky-400/[0.12] text-sm font-semibold text-sky-100 transition hover:bg-sky-400/[0.16]"
            >
              Confirm Counting
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
