import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import BorderGlow from '../../components/reactBits/BorderGlow';
import {
  EXCEPTION_TYPE_LABELS,
  EXCEPTION_TYPES,
  buildExceptionPrintPayload,
  formatExceptionType,
  type ExceptionReportRecord,
  type ExceptionStatus,
  type ExceptionType
} from '../../shared/exceptionReports';
import type { EmployeeRow } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type ExceptionsPageProps = {
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  isLocked: boolean;
  isReadOnly: boolean;
  supabase: SupabaseClient | null;
  userEmail: string;
};

const statusOptions: Array<'all' | ExceptionStatus> = ['all', 'Open', 'Processing', 'Pending Adjustment', 'Resolved', 'Closed'];
const typeOptions: Array<'all' | ExceptionType> = ['all', ...EXCEPTION_TYPES];

const todayDate = () => new Date().toLocaleDateString('en-CA');

const statusCardTone: Record<ExceptionStatus, { backgroundColor: string; glowColor: string; colors: string[]; textClass: string; badgeClass: string }> = {
  Open: {
    backgroundColor: '#082f49',
    glowColor: '199 95 74',
    colors: ['#7dd3fc', '#38bdf8', '#0ea5e9'],
    textClass: 'text-sky-50',
    badgeClass: 'border-sky-200/40 bg-sky-200/12 text-sky-100'
  },
  Processing: {
    backgroundColor: '#451a03',
    glowColor: '43 96 72',
    colors: ['#fde68a', '#fbbf24', '#f59e0b'],
    textClass: 'text-amber-50',
    badgeClass: 'border-amber-200/40 bg-amber-200/12 text-amber-100'
  },
  'Pending Adjustment': {
    backgroundColor: '#312e81',
    glowColor: '239 84 77',
    colors: ['#c4b5fd', '#818cf8', '#6366f1'],
    textClass: 'text-indigo-50',
    badgeClass: 'border-indigo-200/40 bg-indigo-200/12 text-indigo-100'
  },
  Resolved: {
    backgroundColor: '#022c22',
    glowColor: '160 84 72',
    colors: ['#a7f3d0', '#34d399', '#10b981'],
    textClass: 'text-emerald-50',
    badgeClass: 'border-emerald-200/40 bg-emerald-200/12 text-emerald-100'
  },
  Closed: {
    backgroundColor: '#020617',
    glowColor: '215 20 72',
    colors: ['#cbd5e1', '#94a3b8', '#64748b'],
    textClass: 'text-slate-100',
    badgeClass: 'border-slate-200/30 bg-slate-200/10 text-slate-100'
  }
};

const inputClass = (isLight: boolean) =>
  [
    'h-10 rounded-xl border px-3 text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
    isLight ? 'border-slate-200 bg-white text-slate-900 focus:border-slate-400' : 'border-slate-800/90 bg-[#080d18] text-white focus:border-cyan-300/40 focus:ring-4 focus:ring-cyan-300/10'
  ].join(' ');

const panelClass = (isLight: boolean) =>
  ['rounded-3xl border p-4 shadow-sm', isLight ? 'border-slate-200 bg-white' : 'border-slate-900 bg-slate-950/70'].join(' ');

const formatReviewDateTime = (value: unknown) => {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const employeeName = (employees: EmployeeRow[], value: unknown) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return '-';
  const employee = employees.find((item) => String(item.staff_id ?? '').trim().toUpperCase() === normalized);
  return String(employee?.name ?? '').trim() || normalized;
};

const apiJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(body?.error ?? `Request failed: ${res.status}`));
  return body as T;
};

export default function ExceptionsPage({ t, themeMode, isLocked, isReadOnly, supabase, userEmail }: ExceptionsPageProps) {
  const isLight = themeMode === 'light';
  const [rows, setRows] = useState<ExceptionReportRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [dateFilter, setDateFilter] = useState(todayDate());
  const [statusFilter, setStatusFilter] = useState<'all' | ExceptionStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | ExceptionType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [decision, setDecision] = useState<'responsible' | 'no_responsibility'>('responsible');
  const [responsibleStaffId, setResponsibleStaffId] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'idle'; text: string }>({ tone: 'idle', text: '' });

  const employeeOptions = useMemo(
    () =>
      employees
        .map((employee) => ({
          staffId: String(employee.staff_id ?? '').trim().toUpperCase(),
          label: `${String(employee.staff_id ?? '').trim().toUpperCase()} - ${String(employee.name ?? '').trim() || '-'}`
        }))
        .filter((employee) => employee.staffId),
    [employees]
  );

  const visibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter !== 'all' && row.exception_type !== typeFilter) return false;
      if (!query) return true;
      const haystack = [
        row.id,
        row.product_barcode,
        row.picking_list_number,
        row.picking_container,
        row.picked_location,
        row.picking_operator,
        row.packing_rebin_operator,
        row.count_by,
        row.submitted_by_lead_id,
        formatExceptionType(row.exception_type),
        row.status
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [rows, searchQuery, typeFilter]);

  const selected = useMemo(
    () => visibleRows.find((row) => String(row.id) === selectedId) ?? visibleRows[0] ?? null,
    [visibleRows, selectedId]
  );

  const loadRows = async () => {
    if (!supabase) {
      setMessage({ tone: 'error', text: 'Supabase is not configured.' });
      return;
    }
    setLoading(true);
    setMessage({ tone: 'idle', text: '' });
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error('Admin session is required.');

      const search = new URLSearchParams({ date: dateFilter });
      if (statusFilter !== 'all') search.set('status', statusFilter);
      const data = await apiJson<{ rows: ExceptionReportRecord[] }>(`/api/exception-reports?${search.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRows(data.rows ?? []);
      if (!selectedId && data.rows?.[0]) setSelectedId(String(data.rows[0].id));
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to load exceptions.') });
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    if (!supabase) return;
    const res = await supabase
      .from('ob_employees')
      .select('staff_id, name, position, agency, active, terminated_at')
      .order('staff_id', { ascending: true })
      .limit(2000);
    if (!res.error) setEmployees((res.data ?? []) as EmployeeRow[]);
  };

  useEffect(() => {
    void loadEmployees();
  }, [supabase]);

  useEffect(() => {
    void loadRows();
  }, [dateFilter, statusFilter, supabase]);

  useEffect(() => {
    if (!selected) return;
    setResolutionNote(String(selected.resolution_note ?? ''));
    setResponsibleStaffId(String(selected.responsible_staff_id ?? ''));
    setDecision(selected.responsibility_result === 'no_responsibility' ? 'no_responsibility' : 'responsible');
  }, [selected?.id]);

  const closeSelected = async () => {
    if (!supabase || !selected) return;
    setSaving(true);
    setMessage({ tone: 'idle', text: '' });
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error('Admin session is required.');

      const data = await apiJson<{ row: ExceptionReportRecord }>('/api/exception-reports', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'close',
          id: selected.id,
          responsibility_result: decision,
          responsible_staff_id: responsibleStaffId,
          resolution_note: resolutionNote
        })
      });
      setRows((current) => current.map((row) => (String(row.id) === String(data.row.id) ? data.row : row)));
      setSelectedId(String(data.row.id));
      setMessage({ tone: 'success', text: 'Exception closed.' });
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to close exception.') });
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (row: ExceptionReportRecord) => {
    const active = selected && String(selected.id) === String(row.id);
    const details = [formatExceptionType(row.exception_type), row.picking_list_number, row.picking_container].filter(Boolean).join(' · ');
    const submittedBy = employeeName(employees, row.submitted_by_lead_id);
    const createdAt = formatReviewDateTime(row.created_at);
    const pickerName = row.picking_operator ? employeeName(employees, row.picking_operator) : '';
    const packerName = row.packing_rebin_operator ? employeeName(employees, row.packing_rebin_operator) : '';
    const hasAssignees = Boolean(pickerName || packerName);
    const tone = statusCardTone[row.status];
    return (
      <BorderGlow
        key={row.id}
        className={['min-h-[300px] cursor-pointer transition duration-200 hover:-translate-y-1', active ? 'ring-2 ring-cyan-300/25 shadow-[0_0_0_1px_rgba(103,232,249,0.16),0_24px_70px_rgba(8,47,73,0.28)]' : ''].join(' ')}
        edgeSensitivity={30}
        glowColor={tone.glowColor}
        backgroundColor={tone.backgroundColor}
        borderRadius={28}
        glowRadius={46}
        glowIntensity={1.15}
        coneSpread={25}
        animated={false}
        colors={tone.colors}
        fillOpacity={0.42}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSelectedId(String(row.id))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSelectedId(String(row.id));
            }
          }}
          className={`flex min-h-[300px] min-w-0 flex-col justify-between px-6 py-6 text-left ${tone.textClass}`}
        >
          <div className="flex min-w-0 items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="truncate text-2xl font-black">#{row.id}</div>
              <div className="mt-3 break-words text-sm font-black opacity-95">{row.product_barcode || row.picking_list_number || '-'}</div>
              {details ? <div className="mt-3 break-words text-sm font-semibold leading-6 text-current opacity-90">{details}</div> : null}
              {hasAssignees ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {pickerName ? (
                    <div className="rounded-2xl border border-slate-700/70 bg-black/20 px-4 py-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-current opacity-60">Picker</div>
                      <div className="mt-1 truncate text-base font-black">{pickerName}</div>
                    </div>
                  ) : null}
                  {packerName ? (
                    <div className="rounded-2xl border border-slate-700/70 bg-black/20 px-4 py-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-current opacity-60">Packer</div>
                      <div className="mt-1 truncate text-base font-black">{packerName}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.14em] shadow-[0_10px_26px_rgba(0,0,0,0.22)] backdrop-blur ${tone.badgeClass}`}>
              {row.status}
            </span>
          </div>
          <div className="mt-8 flex items-end justify-between gap-4 border-t border-slate-700/70 pt-4">
            <div className="min-w-0 text-sm font-semibold leading-6 text-current opacity-90">
              <div className="truncate">{submittedBy}</div>
              <div>{createdAt}</div>
            </div>
          </div>
        </div>
      </BorderGlow>
    );
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className={['text-xs font-bold uppercase tracking-[0.22em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>Admin</div>
          <h1 className="mt-2 text-4xl font-black tracking-tight">{t('异常单', 'Exceptions')}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search"
            className={[inputClass(isLight), 'w-56'].join(' ')}
          />
          <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className={inputClass(isLight)} />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | ExceptionType)} className={[inputClass(isLight), 'w-44'].join(' ')}>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {type === 'all' ? 'All Types' : EXCEPTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ExceptionStatus)} className={inputClass(isLight)}>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status === 'all' ? 'All' : status}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadRows()}
            className={['h-10 rounded-xl border px-4 text-sm font-black transition disabled:opacity-50', isLight ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800' : 'border-slate-700/80 bg-[#100f17] text-white hover:border-slate-500/80 hover:bg-slate-900'].join(' ')}
          >
            {loading ? 'Loading' : 'Refresh'}
          </button>
        </div>
      </div>

      {message.text ? (
        <div
          className={[
            'mb-4 rounded-2xl border px-4 py-3 text-sm font-semibold',
            message.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
          ].join(' ')}
        >
          {message.text}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0">
          <div className="flex items-center justify-between px-1 py-3">
            <h2 className="text-xl font-black">Queue</h2>
            <span className="text-base font-bold text-slate-300">{visibleRows.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
            {visibleRows.length ? visibleRows.map(renderRow) : (
              <div className="rounded-[28px] border border-slate-800/80 bg-slate-950/50 p-16 text-center text-base font-semibold text-slate-400 md:col-span-2 2xl:col-span-3">
                No reports
              </div>
            )}
          </div>
        </section>

        <aside className={panelClass(isLight)}>
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={['text-xs font-bold uppercase tracking-[0.18em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>Review</div>
                  <div className="mt-1 text-3xl font-black">#{selected.id}</div>
                </div>
                <span className={['rounded-full border px-3 py-1 text-xs font-black', isLight ? 'border-slate-200 bg-white' : 'border-slate-700/80 bg-slate-950/60'].join(' ')}>{selected.status}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {buildExceptionPrintPayload(selected).fields.map((field) => (
                  <div key={field.label} className={['rounded-xl border px-3 py-2', isLight ? 'border-slate-100 bg-slate-50' : 'border-slate-800/80 bg-[#0b1020]'].join(' ')}>
                    <div className={['text-[11px] font-bold uppercase tracking-[0.14em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{field.label}</div>
                    <div className="mt-1 break-words text-sm font-black">{field.value}</div>
                  </div>
                ))}
              </div>

              <div className={['border-t pt-4', isLight ? 'border-slate-200' : 'border-slate-800/90'].join(' ')}>
                <div className="mb-3 text-sm font-black">Decision</div>
                <select
                  value={decision}
                  disabled={isLocked || isReadOnly || selected.status !== 'Resolved' || saving}
                  onChange={(event) => setDecision(event.target.value as 'responsible' | 'no_responsibility')}
                  className={[inputClass(isLight), 'w-full'].join(' ')}
                >
                  <option value="responsible">Responsible</option>
                  <option value="no_responsibility">No responsibility</option>
                </select>
                {decision === 'responsible' ? (
                  <select
                    value={responsibleStaffId}
                    disabled={isLocked || isReadOnly || selected.status !== 'Resolved' || saving}
                    onChange={(event) => setResponsibleStaffId(event.target.value)}
                    className={[inputClass(isLight), 'mt-3 w-full'].join(' ')}
                  >
                    <option value="">Select staff</option>
                    {employeeOptions.map((employee) => (
                      <option key={employee.staffId} value={employee.staffId}>
                        {employee.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                <textarea
                  value={resolutionNote}
                  disabled={isLocked || isReadOnly || selected.status !== 'Resolved' || saving}
                  onChange={(event) => setResolutionNote(event.target.value)}
                  placeholder="Resolution note"
                  className={[
                    'mt-3 min-h-24 w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none disabled:cursor-not-allowed disabled:opacity-60',
                    isLight ? 'border-slate-200 bg-white text-slate-900' : 'border-slate-800/90 bg-[#080d18] text-white focus:border-cyan-300/40 focus:ring-4 focus:ring-cyan-300/10'
                  ].join(' ')}
                />
                <button
                  type="button"
                  disabled={isLocked || isReadOnly || selected.status !== 'Resolved' || saving}
                  onClick={() => void closeSelected()}
                  className={['mt-3 h-11 w-full rounded-xl border text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50', isLight ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800' : 'border-slate-700/80 bg-[#100f17] text-white hover:border-slate-500/80 hover:bg-slate-900'].join(' ')}
                >
                  {saving ? 'Closing' : 'Close'}
                </button>
                {userEmail ? <div className="mt-2 text-xs font-semibold text-slate-500">Reviewer: {userEmail}</div> : null}
              </div>
            </div>
          ) : (
            <div className="grid min-h-[420px] place-items-center text-center text-sm font-semibold text-slate-500">Select an exception</div>
          )}
        </aside>
      </div>
    </div>
  );
}
