import { useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseClient } from './lib/supabase';

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
  attendance: 'Absent' | 'Has punch';
};

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const PUNCHES_TABLE = 'ob_punches';
const SCHEDULE_TABLE = (import.meta.env.VITE_SCHEDULE_TABLE as string | undefined) ?? 'ob_schedules';
const supabase = createSupabaseClient({ persistSession: false });
const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW)
  ? Math.min(23, Math.max(0, DAY_CUTOFF_HOUR_RAW))
  : 5;

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

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-CA', { hour12: false });
};

const chunkArray = <T,>(list: T[], size: number): T[][] => {
  if (size <= 0) return [list];
  const chunks: T[][] = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
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

export default function DashboardPage() {
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [operationalDate, setOperationalDate] = useState('');
  const [rangeText, setRangeText] = useState('');
  const [renderCount, setRenderCount] = useState(120);
  const [expandedStaffIds, setExpandedStaffIds] = useState<Set<string>>(new Set());
  const inFlightRef = useRef(false);
  const fetchSeqRef = useRef(0);

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
      const scheduleRes = await supabase
        .from(SCHEDULE_TABLE)
        .select('id, staff_id, position, shift, note, updated_at, created_at, date')
        .eq('date', currentOperationalDate)
        .order('created_at', { ascending: false })
        .limit(20000);

      if (scheduleRes.error) {
        if (fetchSeqRef.current === currentSeq) {
          setError(scheduleRes.error.message);
          setRows([]);
        }
        return;
      }

      const latestScheduleRows = pickLatestByStaff((((scheduleRes.data as any[]) ?? []) as any[]));
      const workingScheduleRows = latestScheduleRows.filter((row) =>
        isWorkingScheduleState(getScheduleStateFromNote((row as any).note))
      );
      const scheduledByStaff = new Map<
        string,
        {
          position: string;
          shift: string;
        }
      >();
      for (const row of workingScheduleRows) {
        const staffId = String((row as any).staff_id ?? '').trim();
        if (!staffId) continue;
        scheduledByStaff.set(staffId, {
          position: String((row as any).position ?? '').trim(),
          shift: String((row as any).shift ?? '').trim()
        });
      }
      const scheduledStaffIds = Array.from(scheduledByStaff.keys());

      if (scheduledStaffIds.length === 0) {
        if (fetchSeqRef.current === currentSeq) {
          setRows([]);
          setOperationalDate(currentOperationalDate);
          setRangeText(
            `${range.start.toLocaleString('en-CA', { hour12: false })} -> ${range.end.toLocaleString('en-CA', { hour12: false })}`
          );
          setLastUpdatedAt(new Date().toLocaleString('en-CA', { hour12: false }));
        }
        return;
      }

      const punchesByStaff = new Map<string, PunchRow[]>();
      for (const staffIds of chunkArray(scheduledStaffIds, 200)) {
        const punchesRes = await supabase
          .from(PUNCHES_TABLE)
          .select('id, staff_id, action, created_at')
          .in('staff_id', staffIds)
          .gte('created_at', rangeStartIso)
          .lt('created_at', rangeEndIso)
          .order('created_at', { ascending: true })
          .limit(25000);

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
          const list = punchesByStaff.get(staffId) ?? [];
          list.push({
            id: String(row.id ?? ''),
            staff_id: staffId,
            action: String(row.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
            created_at: String(row.created_at ?? '')
          });
          punchesByStaff.set(staffId, list);
        }
      }

      const latestByStaff = new Map<string, EmployeeRow>();
      const staffIdChunks = chunkArray(scheduledStaffIds, 200);
      for (const staffIds of staffIdChunks) {
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
          if (!staffId || latestByStaff.has(staffId)) continue;
          latestByStaff.set(staffId, {
            staff_id: staffId,
            name: String(row.name ?? '').trim(),
            agency: String(row.agency ?? '').trim(),
            position: String(row.position ?? '').trim(),
            label: String(row.label ?? '').trim(),
            work_account: String(row.work_account ?? '').trim(),
            work_password: String(row.work_password ?? '').trim(),
            hire_date: String(row.hire_date ?? '').trim(),
            shift: String(row.shift ?? '').trim()
          });
        }
      }

      const nextRows: DashboardRow[] = scheduledStaffIds
        .sort((a, b) => a.localeCompare(b, 'en-US'))
        .map((staffId) => {
          const employee = latestByStaff.get(staffId);
          const schedule = scheduledByStaff.get(staffId);
          const punches = punchesByStaff.get(staffId) ?? [];
          return {
            staff_id: staffId,
            name: employee?.name ?? '',
            agency: employee?.agency ?? '',
            position: employee?.position ?? schedule?.position ?? '',
            label: employee?.label ?? '',
            work_account: employee?.work_account ?? '',
            work_password: employee?.work_password ?? '',
            hire_date: employee?.hire_date ?? '',
            shift: employee?.shift ?? schedule?.shift ?? '',
            punches,
            attendance: punches.length > 0 ? 'Has punch' : 'Absent'
          };
        });

      if (fetchSeqRef.current !== currentSeq) return;
      setRows(nextRows);
      setOperationalDate(currentOperationalDate);
      setRangeText(`${range.start.toLocaleString('en-CA', { hour12: false })} -> ${range.end.toLocaleString('en-CA', { hour12: false })}`);
      setLastUpdatedAt(new Date().toLocaleString('en-CA', { hour12: false }));
      setExpandedStaffIds((prev) => {
        if (!prev.size) return prev;
        const validIds = new Set(nextRows.map((row) => row.staff_id));
        const next = new Set<string>();
        prev.forEach((id) => {
          if (validIds.has(id)) next.add(id);
        });
        return next;
      });
    } finally {
      if (fetchSeqRef.current === currentSeq) setLoading(false);
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    void fetchData(true);
    const timer = window.setInterval(() => {
      void fetchData();
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = `${row.staff_id} ${row.name} ${row.agency} ${row.position} ${row.label} ${row.work_account}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  useEffect(() => {
    setRenderCount(120);
  }, [search, rows.length]);

  const renderedRows = useMemo(
    () => filteredRows.slice(0, Math.max(0, renderCount)),
    [filteredRows, renderCount]
  );

  return (
    <main className="min-h-screen px-6 py-6 text-paper">
      <section className="glass rounded-3xl px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl tracking-[0.08em]">Dashboard</h1>
            <p className="mt-1 text-xs text-slate-400">
              Schedule date: <span className="text-slate-200">{operationalDate || '-'}</span> | Window: <span className="text-slate-200">{rangeText || '-'}</span> | Auto refresh 15s
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by staff id / name / agency / position / account"
            className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-neon"
          />
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
                  <th className="px-3 py-2 text-left">Staff ID</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Agency</th>
                  <th className="px-3 py-2 text-left">Position</th>
                  <th className="px-3 py-2 text-left">Label</th>
                  <th className="px-3 py-2 text-left">Work Account</th>
                  <th className="px-3 py-2 text-left">Shift</th>
                  <th className="px-3 py-2 text-left">Attendance</th>
                  <th className="px-3 py-2 text-left">Punch Logs</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => {
                  const isExpanded = expandedStaffIds.has(row.staff_id);
                  const firstPunch = row.punches[0];
                  const lastPunch = row.punches[row.punches.length - 1];

                  return (
                    <tr key={row.staff_id} className="border-t border-white/5 odd:bg-white/[0.03]">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-200">{row.staff_id || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-200">{row.name || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{row.agency || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{row.position || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{row.label || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{row.work_account || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-300">{row.shift || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span
                          className={[
                            'inline-flex items-center rounded-lg border px-2 py-0.5 text-xs font-semibold',
                            row.attendance === 'Has punch'
                              ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                              : 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                          ].join(' ')}
                        >
                          {row.attendance}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {row.punches.length === 0 ? (
                          <span className="text-slate-500">No punch in window</span>
                        ) : (
                          <div className="space-y-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedStaffIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row.staff_id)) next.delete(row.staff_id);
                                  else next.add(row.staff_id);
                                  return next;
                                })
                              }
                              className="inline-flex items-center rounded-lg border border-sky-400/50 bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-200"
                            >
                              {isExpanded ? 'Hide details' : 'Show details'} ({row.punches.length})
                            </button>
                            {!isExpanded && (
                              <div className="text-xs text-slate-400">
                                {firstPunch && lastPunch
                                  ? `First ${firstPunch.action} ${formatDateTime(firstPunch.created_at)} | Last ${lastPunch.action} ${formatDateTime(lastPunch.created_at)}`
                                  : '-'}
                              </div>
                            )}
                            {isExpanded && (
                              <div className="max-w-[560px] space-y-1">
                                {row.punches.map((punch, idx) => (
                                  <div key={punch.id || `${row.staff_id}-p-${idx}`} className="text-xs">
                                    <span
                                      className={[
                                        'mr-2 inline-flex items-center rounded-lg border px-2 py-0.5 font-semibold',
                                        punch.action === 'IN'
                                          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                                          : 'border-rose-400/60 bg-rose-500/15 text-rose-200'
                                      ].join(' ')}
                                    >
                                      {`${idx + 1}. ${punch.action}`}
                                    </span>
                                    <span className="text-slate-300">{formatDateTime(punch.created_at)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
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
      </section>
    </main>
  );
}
