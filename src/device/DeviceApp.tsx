import { useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseClient } from '../lib/supabase';
import { isValidStaffId as isValidStaffIdValue, normalizeStaffId } from '../lib/staffId';

type DeviceType = 'PDA' | 'CART';
type LoanAction = 'borrow' | 'return';
type StatusTone = 'idle' | 'pending' | 'success' | 'error';

type DeviceRow = {
  id?: number | string;
  device_name?: string | null;
  device_sn?: string | null;
  device_type?: string | null;
  position?: string | null;
  active?: boolean | null;
  note?: string | null;
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

const ALLOWED_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer'] as const;
type AllowedPosition = (typeof ALLOWED_POSITIONS)[number];

const DEVICE_TABLE = (import.meta.env.VITE_DEVICE_TABLE as string | undefined) ?? 'ob_devices';
const DEVICE_LOANS_TABLE = (import.meta.env.VITE_DEVICE_LOANS_TABLE as string | undefined) ?? 'ob_device_loans';
const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const BORROW_OVERDUE_MS = 24 * 60 * 60 * 1000;

const supabase = createSupabaseClient({ persistSession: false });

const normalizeDeviceSn = (value: string) => String(value ?? '').trim().toUpperCase();
const normalizeDeviceType = (value: unknown): DeviceType => {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw === 'CAR' || raw === 'CART' ? 'CART' : 'PDA';
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

export default function DeviceApp() {
  const [scanMode, setScanMode] = useState<LoanAction>('borrow');
  const [staffIdInput, setStaffIdInput] = useState('');
  const [snInput, setSnInput] = useState('');
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState<AllowedPosition | ''>('');
  const [typeFilter, setTypeFilter] = useState<DeviceType | ''>('');
  const [borrowedOnly, setBorrowedOnly] = useState(false);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loans, setLoans] = useState<DeviceLoanRow[]>([]);
  const [nameByStaffId, setNameByStaffId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [message, setMessage] = useState<{ tone: StatusTone; text: string }>({
    tone: 'idle',
    text: 'Scan to borrow/return devices'
  });
  const staffRef = useRef<HTMLInputElement | null>(null);
  const snRef = useRef<HTMLInputElement | null>(null);

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

  const statusRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return canonicalDevices
      .filter((row) => {
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
          .select('id, device_name, device_sn, device_type, position, active, note')
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
    if (mode === 'borrow' && (!staffId || !isValidStaffIdValue(staffId))) {
      setMessage({ tone: 'error', text: 'Invalid staff ID. Please scan again.' });
      playDeviceSound('error');
      return;
    }
    if (!sn) {
      setMessage({ tone: 'error', text: 'Empty device SN. Please scan again.' });
      playDeviceSound('error');
      return;
    }
    if (!supabase) {
      setMessage({ tone: 'error', text: 'Missing Supabase configuration.' });
      playDeviceSound('error');
      return;
    }

    if (mode === 'borrow') {
      const employeeCheck = await supabase.from(EMPLOYEE_TABLE).select('staff_id').eq('staff_id', staffId).limit(1);
      if (employeeCheck.error) {
        setMessage({ tone: 'error', text: `Failed to verify employee: ${employeeCheck.error.message}` });
        playDeviceSound('error');
        return;
      }
      const employeeRows = ((employeeCheck.data as Array<{ staff_id?: string | null }>) ?? []).filter((row) =>
        normalizeStaffId(String(row.staff_id ?? '').trim())
      );
      if (employeeRows.length === 0) {
        setMessage({ tone: 'error', text: `Employee not registered: ${staffId}` });
        playDeviceSound('error');
        return;
      }
    }
    const device = deviceBySn.get(sn);
    if (!device) {
      setMessage({ tone: 'error', text: `Device not found: ${sn}` });
      playDeviceSound('error');
      return;
    }
    if (device.active === false) {
      setMessage({ tone: 'error', text: `Device disabled: ${sn}` });
      playDeviceSound('error');
      return;
    }
    const borrowed = currentBorrowBySn.get(sn);
    if (mode === 'borrow' && borrowed) {
      const holderName = nameByStaffId[borrowed.staffId] ?? borrowed.staffId;
      setMessage({ tone: 'error', text: `Already borrowed: ${sn} (${holderName})` });
      playDeviceSound('error');
      return;
    }
    if (mode === 'return' && !borrowed) {
      setMessage({ tone: 'error', text: `Not currently borrowed: ${sn}` });
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
      playDeviceSound('error');
      return;
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
    const timer = window.setTimeout(() => staffRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-ink text-paper">
      <main className="w-full px-4 py-6 md:px-6 xl:px-8">
        <header className="glass rounded-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-display text-2xl tracking-[0.08em]">Device Borrow/Return</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  window.location.href = '/';
                }}
                className="rounded-xl bg-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/15"
              >
                Punch
              </button>
              <button
                type="button"
                onClick={() => void fetchAll()}
                disabled={loading}
                className="rounded-xl bg-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/15 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
          <p className={['mt-2 text-sm', toneClass].join(' ')}>{message.text}</p>
        </header>

        <section className="mt-4 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="glass rounded-3xl p-4">
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setScanMode('borrow')}
                className={[
                  'h-12 w-full rounded-2xl px-3 text-base font-bold transition',
                  scanMode === 'borrow'
                    ? 'bg-neon text-ink shadow-glow'
                    : 'border border-white/15 bg-white/10 text-slate-200 hover:bg-white/15'
                ].join(' ')}
              >
                Borrow
              </button>
              <button
                type="button"
                onClick={() => setScanMode('return')}
                className={[
                  'h-12 w-full rounded-2xl px-3 text-base font-bold transition',
                  scanMode === 'return'
                    ? 'bg-neon text-ink shadow-glow'
                    : 'border border-white/15 bg-white/10 text-slate-200 hover:bg-white/15'
                ].join(' ')}
              >
                Return
              </button>
            </div>
            {scanMode === 'borrow' && (
              <>
                <label className="text-xs uppercase tracking-[0.18em] text-slate-400">US ID</label>
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
                  className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow"
                />
              </>
            )}
            <label className="mt-3 block text-xs uppercase tracking-[0.18em] text-slate-400">SN</label>
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
              className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white outline-none transition focus:border-neon focus:shadow-glow"
            />
          </div>

          <div className="glass rounded-3xl p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl tracking-[0.06em]">Device Status</h2>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SN / holder / position"
                className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon md:w-64"
              />
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter((e.target.value as AllowedPosition | '') ?? '')}
                className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon"
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
                className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition focus:border-neon"
              >
                <option value="">All types</option>
                <option value="PDA">PDA</option>
                <option value="CART">CART</option>
              </select>
              <label className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={borrowedOnly}
                  onChange={(e) => setBorrowedOnly(e.target.checked)}
                  className="h-4 w-4 accent-lime-400"
                />
                Borrowed only
              </label>
            </div>
            <div className="grid max-h-[70vh] grid-cols-5 gap-2 overflow-auto pr-1 md:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
              {statusRows.map((row) => {
                const sn = row.device_sn!;
                const borrowed = currentBorrowBySn.get(sn);
                const holderName = borrowed ? nameByStaffId[borrowed.staffId] ?? borrowed.staffId : '';
                const borrowAgeMs = borrowed ? getBorrowAgeMs(borrowed.createdAt) : 0;
                const statusTone = !borrowed ? 'available' : borrowAgeMs >= BORROW_OVERDUE_MS ? 'overdue' : 'borrowed';
                const cardClass =
                  statusTone === 'available'
                    ? 'border-emerald-400/45 bg-emerald-500/10'
                    : statusTone === 'overdue'
                      ? 'border-rose-400/55 bg-rose-500/10'
                      : 'border-amber-400/55 bg-amber-500/10';
                const statusTextClass =
                  statusTone === 'available'
                    ? 'text-emerald-300'
                    : statusTone === 'overdue'
                      ? 'text-rose-300'
                      : 'text-amber-300';
                return (
                  <div key={sn} className={['aspect-square rounded-xl border px-3 py-3 transition-colors', cardClass].join(' ')}>
                    <div className="flex h-full flex-col justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">{row.device_name || '-'}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {row.device_type} · {row.position || 'No position'}
                        </div>
                      </div>
                      <div className="border-t border-white/10 pt-2 text-right">
                        {borrowed ? (
                          <>
                            <div className={['text-xs font-semibold', statusTextClass].join(' ')}>
                              {statusTone === 'overdue' ? 'Borrowed >24h' : 'Borrowed'}
                            </div>
                            <div className="text-xs text-slate-200">{holderName}</div>
                            <div className="text-[11px] text-slate-400">Duration: {formatBorrowDuration(borrowed.createdAt)}</div>
                          </>
                        ) : (
                          <div className={['text-xs font-semibold', statusTextClass].join(' ')}>Available</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {statusRows.length === 0 && <div className="col-span-full py-6 text-sm text-slate-400">No device data.</div>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
