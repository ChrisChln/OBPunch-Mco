import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import BorderGlow from '../../components/reactBits/BorderGlow';
import {
  NewExceptionModal,
  emptyForm,
  findPresentEmployee,
  formFromRecord,
  formWithScopedFollowUp,
  type PresentEmployeeOption
} from '../../ExceptionPage';
import {
  EXCEPTION_STATUS_LABELS,
  EXCEPTION_TYPE_LABELS,
  EXCEPTION_TYPES,
  formatExceptionType,
  getExceptionReportWarnings,
  getExceptionReportNumber,
  getShortPickMissingQty,
  hasNoReplenishmentStockConfirmation,
  hasOutstandingShortPickMissingQty,
  validateExceptionReportInput,
  type ExceptionReportInput,
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

type ResponsibilityDecision = 'picker' | 'packer' | 'all' | 'no_responsibility';

const statusOptions: Array<'all' | ExceptionStatus> = ['all', 'Open', 'Processing', 'Counted', 'Pending Adjustment', 'Short Picked', 'Resolved', 'Completed', 'Closed'];
const typeOptions: Array<'all' | ExceptionType> = ['all', ...EXCEPTION_TYPES];

const normalizeStaffId = (value: unknown) => String(value ?? '').trim().toUpperCase();

const defaultResponsibilityDecision = (report: ExceptionReportRecord): ResponsibilityDecision => {
  if (normalizeStaffId(report.picking_operator)) return 'picker';
  if (normalizeStaffId(report.packing_rebin_operator)) return 'packer';
  return 'no_responsibility';
};

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
  Counted: {
    backgroundColor: '#083344',
    glowColor: '187 92 69',
    colors: ['#a5f3fc', '#22d3ee', '#0891b2'],
    textClass: 'text-cyan-50',
    badgeClass: 'border-cyan-200/40 bg-cyan-200/12 text-cyan-100'
  },
  'Pending Adjustment': {
    backgroundColor: '#312e81',
    glowColor: '239 84 77',
    colors: ['#c4b5fd', '#818cf8', '#6366f1'],
    textClass: 'text-indigo-50',
    badgeClass: 'border-indigo-200/40 bg-indigo-200/12 text-indigo-100'
  },
  'Short Picked': {
    backgroundColor: '#3b2605',
    glowColor: '35 92 68',
    colors: ['#fed7aa', '#fb923c', '#ea580c'],
    textClass: 'text-orange-50',
    badgeClass: 'border-orange-200/40 bg-orange-200/12 text-orange-100'
  },
  Resolved: {
    backgroundColor: '#022c22',
    glowColor: '160 84 72',
    colors: ['#a7f3d0', '#34d399', '#10b981'],
    textClass: 'text-emerald-50',
    badgeClass: 'border-emerald-200/40 bg-emerald-200/12 text-emerald-100'
  },
  Completed: {
    backgroundColor: '#052e16',
    glowColor: '132 199 89',
    colors: ['#dcfce7', '#86efac', '#22c55e'],
    textClass: 'text-lime-50',
    badgeClass: 'border-lime-200/40 bg-lime-200/12 text-lime-100'
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

const detailCardClass = (isLight: boolean) =>
  ['rounded-2xl border px-3 py-2.5', isLight ? 'border-slate-200 bg-slate-50' : 'border-slate-800/80 bg-[#0b1020]'].join(' ');

const sectionTitleClass = (isLight: boolean) =>
  ['text-[11px] font-bold uppercase tracking-[0.18em]', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ');

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

const formatQty = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '-';
  const next = Number(value);
  if (!Number.isFinite(next)) return String(value);
  return Number.isInteger(next) ? String(next) : String(next);
};

const formatFlag = (value: boolean) => (value ? 'Yes' : 'No');

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
  const [editingRow, setEditingRow] = useState<ExceptionReportRecord | null>(null);
  const [dateFilter, setDateFilter] = useState(todayDate());
  const [statusFilter, setStatusFilter] = useState<'all' | ExceptionStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | ExceptionType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [decision, setDecision] = useState<ResponsibilityDecision>('picker');
  const [editForm, setEditForm] = useState<ExceptionReportInput>(() => emptyForm());
  const [resolutionNote, setResolutionNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'idle'; text: string }>({ tone: 'idle', text: '' });

  const adminEmployees = useMemo<PresentEmployeeOption[]>(
    () =>
      employees.map((employee) => ({
        staff_id: String(employee.staff_id ?? '').trim().toUpperCase(),
        name: String(employee.name ?? '').trim(),
        position: String(employee.position ?? '').trim(),
        agency: String(employee.agency ?? '').trim()
      })),
    [employees]
  );

  const visibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter !== 'all' && row.exception_type !== typeFilter) return false;
      if (!query) return true;
      const haystack = [
        row.id,
        row.report_number,
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
    const result = selected.responsibility_result;
    if (result === 'picker' || result === 'packer' || result === 'all' || result === 'no_responsibility') {
      setDecision(result);
      return;
    }
    const responsibleStaff = normalizeStaffId(selected.responsible_staff_id);
    const pickerStaff = normalizeStaffId(selected.picking_operator);
    const packerStaff = normalizeStaffId(selected.packing_rebin_operator);
    if (responsibleStaff && responsibleStaff === packerStaff) setDecision('packer');
    else if (responsibleStaff && responsibleStaff === pickerStaff) setDecision('picker');
    else setDecision(defaultResponsibilityDecision(selected));
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
          resolution_note: resolutionNote
        })
      });
      setRows((current) => current.map((row) => (String(row.id) === String(data.row.id) ? data.row : row)));
      setSelectedId(String(data.row.id));
      setMessage({ tone: 'success', text: 'Exception completed.' });
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to complete exception.') });
    } finally {
      setSaving(false);
    }
  };

  const openEditSelected = (row: ExceptionReportRecord) => {
    setEditingRow(row);
    setEditForm(formFromRecord(row, ''));
    setMessage({ tone: 'idle', text: '' });
  };

  const updateEditForm = (patch: Partial<ExceptionReportInput>) => {
    setEditForm((current) => ({ ...current, ...patch }));
  };

  const saveEditSelected = async () => {
    if (!supabase || !editingRow) return;
    const scopedForm = formWithScopedFollowUp(editForm);
    const validationErrors = validateExceptionReportInput(scopedForm, { requireCountByForQuantities: true });
    if (validationErrors.length) {
      setMessage({ tone: 'error', text: validationErrors[0] });
      return;
    }
    const validationWarnings = getExceptionReportWarnings(scopedForm);
    if (validationWarnings.length) window.alert(validationWarnings[0]);
    setEditSaving(true);
    setMessage({ tone: 'idle', text: '' });
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error('Admin session is required.');
      const pickingOperator = findPresentEmployee(adminEmployees, editForm.picking_operator);
      const packingRebinOperator = editForm.packing_rebin_operator ? findPresentEmployee(adminEmployees, editForm.packing_rebin_operator) : null;
      const countBy = findPresentEmployee(adminEmployees, editForm.count_by);
      const data = await apiJson<{ row: ExceptionReportRecord }>('/api/exception-reports', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...scopedForm,
          id: editingRow.id,
          picking_operator: pickingOperator?.staff_id ?? editForm.picking_operator,
          packing_rebin_operator: packingRebinOperator?.staff_id ?? editForm.packing_rebin_operator ?? '',
          count_by: countBy?.staff_id ?? editForm.count_by,
          submitted_by_lead_id: editForm.submitted_by_lead_id || editingRow.submitted_by_lead_id || userEmail
        })
      });
      setRows((current) => current.map((row) => (String(row.id) === String(data.row.id) ? data.row : row)));
      setSelectedId(String(data.row.id));
      setEditingRow(data.row);
      setEditForm(formFromRecord(data.row, ''));
      setMessage({ tone: 'success', text: 'Exception updated.' });
      setEditingRow(null);
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to update exception.') });
    } finally {
      setEditSaving(false);
    }
  };

  const renderRow = (row: ExceptionReportRecord) => {
    const active = selected && String(selected.id) === String(row.id);
    const reportNumber = getExceptionReportNumber(row);
    const details = [formatExceptionType(row.exception_type), row.picking_list_number, row.picking_container].filter(Boolean).join(' · ');
    const submittedBy = employeeName(employees, row.submitted_by_lead_id);
    const createdAt = formatReviewDateTime(row.created_at);
    const pickerName = row.picking_operator ? employeeName(employees, row.picking_operator) : '';
    const packerName = row.packing_rebin_operator ? employeeName(employees, row.packing_rebin_operator) : '';
    const hasAssignees = Boolean(pickerName || packerName);
    const tone = statusCardTone[row.status];
    const missingQty = getShortPickMissingQty(row);
    const qtySummary = [
      `S ${formatQty(row.system_location_qty)}`,
      `A ${formatQty(row.actual_qty)}`,
      row.exception_type === 'short_pick' && missingQty !== null ? `M ${formatQty(missingQty)}` : ''
    ]
      .filter(Boolean)
      .join(' · ');
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
              <div className="truncate text-2xl font-black">#{reportNumber}</div>
              <div className="mt-3 break-words text-sm font-black opacity-95">{row.product_barcode || row.picking_list_number || '-'}</div>
              {details ? <div className="mt-3 break-words text-sm font-semibold leading-6 text-current opacity-90">{details}</div> : null}
              <div className="mt-3 text-[11px] font-black uppercase tracking-[0.18em] text-current opacity-70">{qtySummary}</div>
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
              {EXCEPTION_STATUS_LABELS[row.status]}
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

  const selectedReportNumber = selected ? getExceptionReportNumber(selected) : '';
  const selectedMissingQty = selected ? getShortPickMissingQty(selected) : null;
  const selectedNoReplenishmentStock = selected ? hasNoReplenishmentStockConfirmation(selected) : false;
  const selectedHasOutstandingMissingQty = selected ? hasOutstandingShortPickMissingQty(selected) : false;
  const selectedFlow = !selected
    ? '-'
    : selected.exception_type === 'over_pick'
      ? 'Over Pick Fix'
      : selected.exception_type === 'short_pick'
        ? selectedHasOutstandingMissingQty
          ? 'Less Pick Replenishment'
          : 'Less Pick Physical Fix'
        : Number(selected.actual_qty ?? '') === 0
          ? 'Stockout Follow-up'
          : 'Review';
  const selectedDetailRows = !selected
    ? []
    : [
        { label: 'Product', value: String(selected.product_barcode ?? '').trim() || '-' },
        { label: 'Picking List', value: String(selected.picking_list_number ?? '').trim() || '-' },
        { label: 'Container', value: String(selected.picking_container ?? '').trim() || '-' },
        { label: 'Picked Loc', value: String(selected.picked_location ?? '').trim() || '-' },
        { label: 'System Qty', value: formatQty(selected.system_location_qty) },
        { label: 'Actual', value: formatQty(selected.actual_qty) },
        { label: 'Missing Qty', value: selected.exception_type === 'short_pick' ? formatQty(selectedMissingQty) : '-' },
        { label: 'Count By', value: employeeName(employees, selected.count_by) }
      ];
  const selectedFollowUpRows = !selected
    ? []
    : [
        { label: 'Borrowed Loc', value: String(selected.borrowed_location ?? '').trim() || '-' },
        { label: 'Borrowed Qty', value: formatQty(selected.borrowed_qty) },
        { label: 'Extra Taken', value: formatFlag(Boolean(selected.extra_taken)) },
        { label: 'No Replen.', value: formatFlag(selectedNoReplenishmentStock) },
        { label: 'Short Picked', value: formatFlag(Boolean(selected.short_picked)) },
        { label: 'Inv Adj', value: formatFlag(Boolean(selected.inventory_adjustment)) }
      ];

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
                {status === 'all' ? 'All' : EXCEPTION_STATUS_LABELS[status]}
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
                  <div className="mt-1 text-3xl font-black">#{selectedReportNumber}</div>
                  <div className={['mt-2 text-sm font-semibold', isLight ? 'text-slate-600' : 'text-slate-300'].join(' ')}>
                    {formatExceptionType(selected.exception_type) || 'Unknown'} · {selectedFlow}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className={['rounded-full border px-3 py-1 text-xs font-black', isLight ? 'border-slate-200 bg-white' : 'border-slate-700/80 bg-slate-950/60'].join(' ')}>{EXCEPTION_STATUS_LABELS[selected.status]}</span>
                  <button
                    type="button"
                    disabled={isLocked || isReadOnly || editSaving}
                    onClick={() => openEditSelected(selected)}
                    className={['h-9 rounded-xl border px-4 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50', isLight ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800' : 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:border-cyan-200/70 hover:bg-cyan-300/15'].join(' ')}
                  >
                    Edit
                  </button>
                </div>
              </div>

              <div className={['rounded-2xl border p-3', isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800/80 bg-[#0a1020]/80'].join(' ')}>
                <div className={sectionTitleClass(isLight)}>Count Snapshot</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {selectedDetailRows.map((field) => (
                    <div key={field.label} className={detailCardClass(isLight)}>
                      <div className={sectionTitleClass(isLight)}>{field.label}</div>
                      <div className="mt-1 break-words text-sm font-black">{field.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={['rounded-2xl border p-3', isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800/80 bg-[#0a1020]/80'].join(' ')}>
                <div className={sectionTitleClass(isLight)}>Follow-up</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {selectedFollowUpRows.map((field) => (
                    <div key={field.label} className={detailCardClass(isLight)}>
                      <div className={sectionTitleClass(isLight)}>{field.label}</div>
                      <div className="mt-1 break-words text-sm font-black">{field.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={['rounded-2xl border p-3', isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800/80 bg-[#0a1020]/80'].join(' ')}>
                <div className={sectionTitleClass(isLight)}>People</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    { label: 'Picker', value: employeeName(employees, selected.picking_operator) },
                    { label: 'Packing/Rebin', value: employeeName(employees, selected.packing_rebin_operator) },
                    { label: 'Lead', value: employeeName(employees, selected.submitted_by_lead_id) },
                    { label: 'Created', value: formatReviewDateTime(selected.created_at) }
                  ].map((field) => (
                    <div key={field.label} className={detailCardClass(isLight)}>
                      <div className={sectionTitleClass(isLight)}>{field.label}</div>
                      <div className="mt-1 break-words text-sm font-black">{field.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={['rounded-2xl border p-3', isLight ? 'border-slate-200 bg-slate-50/80' : 'border-slate-800/80 bg-[#0a1020]/80'].join(' ')}>
                <div className={sectionTitleClass(isLight)}>Resolution Note</div>
                <div className={['mt-2 whitespace-pre-wrap break-words rounded-2xl border px-3 py-3 text-sm font-semibold', isLight ? 'border-slate-200 bg-white text-slate-700' : 'border-slate-800/80 bg-[#0b1020] text-slate-200'].join(' ')}>
                  {String(selected.resolution_note ?? '').trim() || 'No note'}
                </div>
              </div>

              <div className={['border-t pt-4', isLight ? 'border-slate-200' : 'border-slate-800/90'].join(' ')}>
                <div className="mb-3 text-sm font-black">Decision</div>
                <select
                  value={decision}
                  disabled={isLocked || isReadOnly || selected.status !== 'Resolved' || saving}
                  onChange={(event) => setDecision(event.target.value as ResponsibilityDecision)}
                  className={[inputClass(isLight), 'w-full'].join(' ')}
                >
                  <option value="picker" disabled={!selected.picking_operator}>
                    Picker{selected.picking_operator ? ` - ${employeeName(employees, selected.picking_operator)}` : ''}
                  </option>
                  <option value="packer" disabled={!selected.packing_rebin_operator}>
                    Packing/Rebin{selected.packing_rebin_operator ? ` - ${employeeName(employees, selected.packing_rebin_operator)}` : ''}
                  </option>
                  <option value="all" disabled={!selected.picking_operator && !selected.packing_rebin_operator}>All responsible</option>
                  <option value="no_responsibility">No responsibility</option>
                </select>
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
                  {saving ? 'Completing' : 'Complete'}
                </button>
                {userEmail ? <div className="mt-2 text-xs font-semibold text-slate-500">Reviewer: {userEmail}</div> : null}
              </div>
            </div>
          ) : (
            <div className="grid min-h-[420px] place-items-center text-center text-sm font-semibold text-slate-500">Select an exception</div>
          )}
        </aside>
      </div>
      {editingRow ? (
        <NewExceptionModal
          mode="edit"
          reportId={getExceptionReportNumber(editingRow)}
          status={editingRow.status}
          form={editForm}
          employees={adminEmployees}
          saving={editSaving}
          onChange={updateEditForm}
          onClose={() => setEditingRow(null)}
          onSubmit={() => void saveEditSelected()}
        />
      ) : null}
    </div>
  );
}
