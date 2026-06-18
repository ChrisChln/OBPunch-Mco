import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildExceptionPrintPayload,
  formatExceptionType,
  type ExceptionReportRecord,
  type ExceptionStatus
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

const statusOptions: Array<'all' | ExceptionStatus> = ['all', 'Open', 'Processing', 'Resolved', 'Closed'];

const todayDate = () => new Date().toLocaleDateString('en-CA');

const inputClass = (isLight: boolean) =>
  [
    'h-10 rounded-xl border px-3 text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-60',
    isLight ? 'border-slate-200 bg-white text-slate-900 focus:border-slate-400' : 'border-white/10 bg-slate-900 text-white focus:border-white/30'
  ].join(' ');

const panelClass = (isLight: boolean) =>
  ['rounded-3xl border p-4 shadow-sm', isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/70'].join(' ');

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
  const [decision, setDecision] = useState<'responsible' | 'no_responsibility'>('responsible');
  const [responsibleStaffId, setResponsibleStaffId] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'idle'; text: string }>({ tone: 'idle', text: '' });

  const selected = useMemo(
    () => rows.find((row) => String(row.id) === selectedId) ?? rows[0] ?? null,
    [rows, selectedId]
  );

  const openRows = useMemo(() => rows.filter((row) => row.status !== 'Closed'), [rows]);
  const closedRows = useMemo(() => rows.filter((row) => row.status === 'Closed'), [rows]);

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
    const details = [formatExceptionType(row.exception_type), row.picking_container].filter(Boolean).join(' · ');
    return (
      <button
        key={row.id}
        type="button"
        onClick={() => setSelectedId(String(row.id))}
        className={[
          'w-full border-b px-4 py-3 text-left transition last:border-b-0',
          isLight ? 'border-slate-100' : 'border-white/10',
          active ? (isLight ? 'bg-slate-950 text-white' : 'bg-white text-slate-950') : isLight ? 'hover:bg-slate-50' : 'hover:bg-white/5'
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black">#{row.id} · {row.picking_list_number}</div>
            {details ? <div className={['mt-1 text-xs font-semibold', active ? 'opacity-75' : isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{details}</div> : null}
          </div>
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-black">{row.status}</span>
        </div>
      </button>
    );
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className={['text-xs font-bold uppercase tracking-[0.22em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>Admin</div>
          <h1 className="mt-2 text-4xl font-black tracking-tight">Exceptions</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className={inputClass(isLight)} />
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
            className="h-10 rounded-xl bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-50"
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
        <section className={panelClass(isLight)}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h2 className="font-black">{t('未处理', 'Open')}</h2>
                <span className="text-sm font-bold text-slate-500">{openRows.length}</span>
              </div>
              <div className="max-h-[620px] overflow-auto">
                {openRows.length ? openRows.map(renderRow) : <div className="p-8 text-center text-sm font-semibold text-slate-500">No open exceptions</div>}
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h2 className="font-black">{t('已处理', 'Closed')}</h2>
                <span className="text-sm font-bold text-slate-500">{closedRows.length}</span>
              </div>
              <div className="max-h-[620px] overflow-auto">
                {closedRows.length ? closedRows.map(renderRow) : <div className="p-8 text-center text-sm font-semibold text-slate-500">No closed exceptions</div>}
              </div>
            </div>
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
                <span className="rounded-full border px-3 py-1 text-xs font-black">{selected.status}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {buildExceptionPrintPayload(selected).fields.map((field) => (
                  <div key={field.label} className={['rounded-xl px-3 py-2', isLight ? 'bg-slate-50' : 'bg-white/5'].join(' ')}>
                    <div className={['text-[11px] font-bold uppercase tracking-[0.14em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{field.label}</div>
                    <div className="mt-1 break-words text-sm font-black">{field.value}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-200 pt-4">
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
                    isLight ? 'border-slate-200 bg-white text-slate-900' : 'border-white/10 bg-slate-900 text-white'
                  ].join(' ')}
                />
                <button
                  type="button"
                  disabled={isLocked || isReadOnly || selected.status !== 'Resolved' || saving}
                  onClick={() => void closeSelected()}
                  className="mt-3 h-11 w-full rounded-xl bg-slate-950 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
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
