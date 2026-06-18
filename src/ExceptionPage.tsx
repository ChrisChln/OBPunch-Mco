import { useEffect, useMemo, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import {
  EXCEPTION_TYPE_LABELS,
  EXCEPTION_TYPES,
  EXCEPTION_STATUS_LABELS,
  buildExceptionPrintPayload,
  formatExceptionType,
  type ExceptionReportInput,
  type ExceptionReportPrintPayload,
  type ExceptionReportRecord,
  type ExceptionStatus,
  type ExceptionType
} from './shared/exceptionReports';

type PresentEmployeeOption = {
  staff_id: string;
  name: string;
  position: string;
  agency: string;
};

const currentDate = () => new Date().toLocaleDateString('en-CA');

const emptyForm = (leadId = ''): ExceptionReportInput => ({
  report_date: currentDate(),
  exception_type: '',
  product_barcode: '',
  picking_list_number: '',
  picking_container: '',
  picking_operator: '',
  packing_rebin_operator: '',
  picked_location: '',
  system_location_qty: '',
  actual_qty: '',
  count_by: '',
  borrowed_location: '',
  borrowed_qty: '',
  inventory_adjustment: false,
  submitted_by_lead_id: leadId,
  lead_pin: '',
  resolution_note: ''
});

const formFromRecord = (row: ExceptionReportRecord, leadPin: string): ExceptionReportInput => ({
  report_date: row.report_date,
  exception_type: row.exception_type ?? '',
  product_barcode: row.product_barcode ?? '',
  picking_list_number: row.picking_list_number ?? '',
  picking_container: row.picking_container ?? '',
  picking_operator: row.picking_operator ?? '',
  packing_rebin_operator: row.packing_rebin_operator ?? '',
  picked_location: row.picked_location ?? '',
  system_location_qty: String(row.system_location_qty ?? ''),
  actual_qty: String(row.actual_qty ?? ''),
  count_by: row.count_by ?? '',
  borrowed_location: row.borrowed_location ?? '',
  borrowed_qty: row.borrowed_qty === null || row.borrowed_qty === undefined ? '' : String(row.borrowed_qty),
  inventory_adjustment: row.inventory_adjustment,
  submitted_by_lead_id: row.submitted_by_lead_id,
  lead_pin: leadPin,
  resolution_note: row.resolution_note ?? ''
});

const statusOrder: ExceptionStatus[] = ['Open', 'Processing', 'Resolved', 'Closed'];

const rowStatusClass: Record<ExceptionStatus, string> = {
  Open: 'border-sky-400/70 bg-sky-950/70 text-sky-50 hover:bg-sky-900/70',
  Processing: 'border-amber-400/70 bg-amber-950/70 text-amber-50 hover:bg-amber-900/70',
  Resolved: 'border-emerald-400/70 bg-emerald-950/65 text-emerald-50 hover:bg-emerald-900/70',
  Closed: 'border-slate-600 bg-black text-slate-100 hover:bg-slate-950'
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

const normalizeStaffInput = (value: unknown) => String(value ?? '').trim().toUpperCase();

const findPresentEmployee = (employees: PresentEmployeeOption[], value: unknown) => {
  const normalized = normalizeStaffInput(value);
  if (!normalized) return null;
  return (
    employees.find((employee) => employee.staff_id === normalized) ??
    employees.find((employee) => employee.name.trim().toUpperCase() === normalized) ??
    null
  );
};

const employeeName = (employees: PresentEmployeeOption[], value: unknown) => {
  const employee = findPresentEmployee(employees, value);
  return employee?.name.trim() || String(value ?? '').trim() || '-';
};

const formatQueueDateTime = (value: unknown) => {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const shouldShowFollowUp = (actualQty: unknown) => {
  const value = String(actualQty ?? '').trim();
  return value !== '' && Number(value) === 0;
};

const formWithScopedFollowUp = (form: ExceptionReportInput): ExceptionReportInput =>
  shouldShowFollowUp(form.actual_qty)
    ? form
    : {
        ...form,
        borrowed_location: '',
        borrowed_qty: '',
        inventory_adjustment: false,
        resolution_note: ''
      };

const inputClass =
  'h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-3 text-sm font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-300/70 focus:ring-4 focus:ring-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-50';

const numericInputClass =
  `${inputClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

const textAreaClass =
  'min-h-24 w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-300/70 focus:ring-4 focus:ring-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-50';

const loginInputClass =
  'h-14 w-full rounded-[20px] border border-white/12 bg-black/30 px-5 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60';

const loginButtonClass =
  'mt-2 h-14 w-full cursor-pointer rounded-[20px] bg-neon px-5 text-base font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-400 disabled:shadow-none disabled:hover:translate-y-0';

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'sm:col-span-2' : ''}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function EmployeeSearchInput({
  label,
  value,
  employees,
  onChange,
  className = inputClass
}: {
  label: string;
  value: string;
  employees: PresentEmployeeOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedEmployee = useMemo(() => findPresentEmployee(employees, value), [employees, value]);
  const displayValue = selectedEmployee?.name || value;
  const options = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return employees.slice(0, 12);
    return employees
      .filter((employee) => {
        const haystack = `${employee.staff_id} ${employee.name} ${employee.position} ${employee.agency}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 12);
  }, [employees, value]);

  return (
    <div className="relative">
      <Field label={label}>
        <input
          value={displayValue}
          autoComplete="off"
          name={`exception-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder="Search name"
          className={className}
        />
      </Field>
      {open && options.length > 0 ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 max-h-60 overflow-auto rounded-2xl border border-white/10 bg-slate-950 p-1.5 shadow-2xl">
          {options.map((employee) => (
            <button
              key={`${label}-${employee.staff_id}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(employee.name || employee.staff_id);
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
            >
              <span className="min-w-0">
                <span className="block truncate font-black">{employee.name || employee.staff_id}</span>
              </span>
            </button>
          ))}
        </div>
      ) : open && value.trim() ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 rounded-2xl border border-white/10 bg-slate-950 px-3 py-3 text-sm font-semibold text-slate-400 shadow-2xl">
          No clocked-in employee match
        </div>
      ) : null}
    </div>
  );
}

function PrintLabelPreview({ payload, qrDataUrl, onClose }: { payload: ExceptionReportPrintPayload; qrDataUrl: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-slate-950/80 px-4 py-6 backdrop-blur">
      <style>{`
        @media print {
          @page { size: 4in 6in; margin: 0; }
          body * { visibility: hidden !important; }
          .exception-print-sheet, .exception-print-sheet * { visibility: visible !important; }
          .exception-print-sheet { position: fixed !important; inset: 0 !important; margin: 0 !important; box-shadow: none !important; }
          .exception-print-chrome { display: none !important; }
        }
      `}</style>
      <div className="exception-print-chrome mx-auto mb-4 flex max-w-[4.6in] items-center justify-between gap-3 text-white">
        <div>
          <div className="text-sm font-semibold">4x6 Label</div>
          <div className="text-xs text-slate-300">Preview</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="h-10 cursor-pointer rounded-xl border border-white/15 px-4 text-sm font-semibold text-white transition hover:bg-white/10">
            Close
          </button>
          <button type="button" onClick={() => window.print()} className="h-10 cursor-pointer rounded-xl bg-white px-4 text-sm font-semibold text-slate-950 transition hover:bg-slate-200">
            Print
          </button>
        </div>
      </div>

      <section className="exception-print-sheet mx-auto h-[6in] w-[4in] overflow-hidden rounded-[0.18in] bg-[#f8fafc] p-[0.18in] text-slate-950 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-300 pb-3">
          <div className="min-w-0">
            <div className="text-[0.16in] font-black uppercase tracking-[0.08in] text-slate-500">{payload.title}</div>
            <div className="mt-1 truncate text-[0.26in] font-black leading-none">#{payload.reportId}</div>
            <div className="mt-1 inline-flex rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[0.11in] font-bold uppercase">{payload.status}</div>
          </div>
          <div className="grid h-[0.92in] w-[0.92in] shrink-0 place-items-center rounded-xl border border-slate-300 bg-white p-1">
            <img src={qrDataUrl} alt={`QR ${payload.reportId}`} className="h-full w-full" />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <div className="col-span-2 rounded-xl bg-slate-950 px-3 py-2 text-white">
            <div className="text-[0.1in] font-bold uppercase tracking-[0.04in] text-slate-400">Created</div>
            <div className="mt-0.5 text-[0.18in] font-black">{payload.reportDate}</div>
          </div>
          {payload.fields.map((field) => (
            <div key={field.label} className="min-h-[0.34in] rounded-lg border border-slate-200 bg-white px-2 py-1">
              <div className="text-[0.08in] font-bold uppercase tracking-[0.015in] text-slate-500">{field.label}</div>
              <div className="mt-0.5 line-clamp-2 break-words text-[0.108in] font-black leading-tight text-slate-950">{field.value}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function NewExceptionModal({
  mode,
  reportId,
  status,
  form,
  employees,
  saving,
  onChange,
  onStatusChange,
  onClose,
  onPrint,
  onSubmit
}: {
  mode: 'create' | 'edit';
  reportId?: string;
  status?: ExceptionStatus;
  form: ExceptionReportInput;
  employees: PresentEmployeeOption[];
  saving: boolean;
  onChange: (patch: Partial<ExceptionReportInput>) => void;
  onStatusChange?: (status: ExceptionStatus) => void;
  onClose: () => void;
  onPrint?: () => void;
  onSubmit: () => void;
}) {
  const nextStatus = status ? statusOrder[statusOrder.indexOf(status) + 1] : null;
  const editableStatuses = status ? [status, ...(nextStatus && nextStatus !== 'Closed' ? [nextStatus] : [])] : [];
  const showFollowUp = shouldShowFollowUp(form.actual_qty);

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-slate-950/75 px-4 py-6 backdrop-blur">
      <section className="mx-auto w-full max-w-3xl rounded-[1.75rem] border border-white/10 bg-slate-950 p-5 text-white shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-200">{mode === 'edit' ? 'Edit' : 'New'}</div>
            <h2 className="mt-1 text-3xl font-black tracking-tight">{mode === 'edit' && reportId ? `#${reportId}` : 'Exception'}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="h-10 cursor-pointer rounded-xl border border-white/10 px-4 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-50">
            Close
          </button>
        </div>

        <div className={showFollowUp ? 'grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]' : 'grid gap-5'}>
          <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="mb-4 text-sm font-black text-white">Report</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {mode === 'edit' && status && onStatusChange ? (
                <Field label="Status">
                  <select value={status} onChange={(event) => onStatusChange(event.target.value as ExceptionStatus)} className={inputClass}>
                    {editableStatuses.map((option) => (
                      <option key={option} value={option}>{EXCEPTION_STATUS_LABELS[option]}</option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="Exception Type">
                <select value={form.exception_type} onChange={(event) => onChange({ exception_type: event.target.value as ExceptionType })} className={inputClass}>
                  <option value=""></option>
                  {EXCEPTION_TYPES.map((type) => (
                    <option key={type} value={type}>{EXCEPTION_TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Picking List Number" wide>
                <input value={form.picking_list_number} onChange={(event) => onChange({ picking_list_number: event.target.value })} className={inputClass} />
              </Field>
              <Field label="Product Barcode" wide>
                <input value={form.product_barcode} onChange={(event) => onChange({ product_barcode: event.target.value })} className={inputClass} />
              </Field>
              <Field label="Picking Container">
                <input value={form.picking_container} onChange={(event) => onChange({ picking_container: event.target.value })} className={inputClass} />
              </Field>
              <Field label="Picked Location">
                <input value={form.picked_location} onChange={(event) => onChange({ picked_location: event.target.value })} className={inputClass} />
              </Field>
              <Field label="System Location Qty">
                <input type="text" inputMode="decimal" value={form.system_location_qty} onChange={(event) => onChange({ system_location_qty: event.target.value })} className={numericInputClass} />
              </Field>
              <Field label="Actual">
                <input type="text" inputMode="decimal" value={form.actual_qty} onChange={(event) => onChange({ actual_qty: event.target.value })} className={numericInputClass} />
              </Field>
              <EmployeeSearchInput label="Pick Operator" value={form.picking_operator} employees={employees} onChange={(value) => onChange({ picking_operator: value })} />
              <EmployeeSearchInput label="Packing/Rebin Operator" value={form.packing_rebin_operator ?? ''} employees={employees} onChange={(value) => onChange({ packing_rebin_operator: value })} />
              <EmployeeSearchInput label="Count By USID" value={form.count_by} employees={employees} onChange={(value) => onChange({ count_by: value })} />
            </div>
          </div>

          {showFollowUp ? <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="mb-4 text-sm font-black text-white">Follow-up</div>
            <div className="grid gap-3">
              <Field label="Borrowed Location">
                <input value={form.borrowed_location ?? ''} onChange={(event) => onChange({ borrowed_location: event.target.value })} className={inputClass} />
              </Field>
              <Field label="Borrowed Qty">
                <input type="text" inputMode="decimal" value={form.borrowed_qty ?? ''} onChange={(event) => onChange({ borrowed_qty: event.target.value })} className={numericInputClass} />
              </Field>
              <Field label="Inventory Adjustment">
                <select value={form.inventory_adjustment ? 'yes' : 'no'} onChange={(event) => onChange({ inventory_adjustment: event.target.value === 'yes' })} className={inputClass}>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </Field>
              <Field label="Resolution Note">
                <textarea value={form.resolution_note ?? ''} onChange={(event) => onChange({ resolution_note: event.target.value })} className={textAreaClass} />
              </Field>
            </div>
          </div> : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          {mode === 'edit' && onPrint ? (
            <button type="button" onClick={onPrint} disabled={saving} className="h-11 cursor-pointer rounded-xl border border-white/10 px-5 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-50">
              Print
            </button>
          ) : null}
          <button type="button" onClick={onSubmit} disabled={saving} className="h-11 cursor-pointer rounded-xl bg-emerald-300 px-5 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:opacity-50">
            {saving ? 'Saving' : mode === 'edit' ? 'Save' : 'Create'}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function ExceptionPage() {
  const [leadId, setLeadId] = useState('');
  const [leadPin, setLeadPin] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [form, setForm] = useState<ExceptionReportInput>(() => emptyForm());
  const [rows, setRows] = useState<ExceptionReportRecord[]>([]);
  const [presentEmployees, setPresentEmployees] = useState<PresentEmployeeOption[]>([]);
  const [selected, setSelected] = useState<ExceptionReportRecord | null>(null);
  const [editing, setEditing] = useState<ExceptionReportRecord | null>(null);
  const [editingStatus, setEditingStatus] = useState<ExceptionStatus>('Open');
  const [statusFilter, setStatusFilter] = useState<'all' | ExceptionStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | ExceptionType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'idle'; text: string }>({ tone: 'idle', text: '' });
  const [printPayload, setPrintPayload] = useState<ExceptionReportPrintPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');

  const visibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (typeFilter !== 'all' && row.exception_type !== typeFilter) return false;
      if (!query) return true;
      const submittedBy = employeeName(presentEmployees, row.submitted_by_lead_id);
      const haystack = [
        row.id,
        row.product_barcode,
        row.picking_list_number,
        row.picking_container,
        row.picking_operator,
        row.packing_rebin_operator,
        row.count_by,
        submittedBy,
        formatExceptionType(row.exception_type)
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [presentEmployees, rows, searchQuery, statusFilter, typeFilter]);

  const updateForm = (patch: Partial<ExceptionReportInput>) => setForm((current) => ({ ...current, ...patch }));

  const loadPresentEmployees = async (pinOverride = leadPin) => {
    const pin = pinOverride.trim();
    const data = await apiJson<{ rows: PresentEmployeeOption[] }>('/api/exception-reports?present=1', {
      headers: pin ? { 'X-Exception-Lead-Pin': pin } : {}
    });
    setPresentEmployees(data.rows ?? []);
  };

  const loadRows = async (pinOverride = leadPin) => {
    setLoading(true);
    setMessage({ tone: 'idle', text: '' });
    try {
      const search = new URLSearchParams({ date: currentDate() });
      const data = await apiJson<{ rows: ExceptionReportRecord[] }>(`/api/exception-reports?${search.toString()}`, {
        headers: { 'X-Exception-Lead-Pin': pinOverride }
      });
      setRows(data.rows ?? []);
      setSelected((current) => {
        if (!current) return (data.rows ?? [])[0] ?? null;
        return (data.rows ?? []).find((row) => String(row.id) === String(current.id)) ?? null;
      });
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to load reports.') });
    } finally {
      setLoading(false);
    }
  };

  const unlock = async () => {
    const normalizedLead = leadId.trim().toUpperCase();
    const pin = leadPin.trim();
    if (!normalizedLead || !pin) {
      setMessage({ tone: 'error', text: 'Lead USID and PIN are required.' });
      return;
    }
    setLoading(true);
    setMessage({ tone: 'idle', text: '' });
    try {
      const employeesData = await apiJson<{ rows: PresentEmployeeOption[] }>('/api/exception-reports?present=1', {
        headers: { 'X-Exception-Lead-Pin': pin }
      });
      const nextEmployees = employeesData.rows ?? [];
      const matchedLead = findPresentEmployee(nextEmployees, normalizedLead);
      if (!matchedLead) {
        throw new Error('Lead USID must match an employee clocked in today.');
      }
      setPresentEmployees(nextEmployees);
      setLeadId(matchedLead.staff_id);
      setForm({ ...emptyForm(matchedLead.staff_id), lead_pin: pin });
      await loadRows(pin);
      setUnlocked(true);
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to unlock page.') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (unlocked) return;
    const timer = window.setTimeout(() => {
      loadPresentEmployees(leadPin.trim()).catch(() => {
        setPresentEmployees([]);
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [leadPin, unlocked]);

  const openNewModal = () => {
    setEditing(null);
    setForm({ ...emptyForm(leadId), submitted_by_lead_id: leadId, lead_pin: leadPin });
    setModalOpen(true);
  };

  const openEditModal = (row: ExceptionReportRecord) => {
    setSelected(row);
    setEditing(row);
    setEditingStatus(row.status);
    setForm(formFromRecord(row, leadPin));
    setModalOpen(true);
  };

  useEffect(() => {
    if (unlocked) return;
    loadPresentEmployees('').catch(() => {
      setPresentEmployees([]);
    });
  }, [unlocked]);

  const submitReport = async () => {
    setSaving(true);
    setMessage({ tone: 'idle', text: '' });
    try {
      const pickingOperator = findPresentEmployee(presentEmployees, form.picking_operator);
      const packingRebinOperator = form.packing_rebin_operator ? findPresentEmployee(presentEmployees, form.packing_rebin_operator) : null;
      const countBy = findPresentEmployee(presentEmployees, form.count_by);

      const scopedForm = formWithScopedFollowUp(form);
      const data = await apiJson<{ row: ExceptionReportRecord }>('/api/exception-reports', {
        method: 'POST',
        body: JSON.stringify({
          ...scopedForm,
          report_date: currentDate(),
          picking_operator: pickingOperator?.staff_id ?? form.picking_operator,
          packing_rebin_operator: packingRebinOperator?.staff_id ?? form.packing_rebin_operator ?? '',
          count_by: countBy?.staff_id ?? form.count_by,
          submitted_by_lead_id: leadId,
          lead_pin: leadPin
        })
      });
      setRows((current) => [data.row, ...current]);
      setSelected(data.row);
      setModalOpen(false);
      setMessage({ tone: 'success', text: 'Exception saved.' });
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to save exception.') });
    } finally {
      setSaving(false);
    }
  };

  const saveReport = async () => {
    if (!editing) return;
    setSaving(true);
    setMessage({ tone: 'idle', text: '' });
    try {
      const pickingOperator = findPresentEmployee(presentEmployees, form.picking_operator);
      const packingRebinOperator = form.packing_rebin_operator ? findPresentEmployee(presentEmployees, form.packing_rebin_operator) : null;
      const countBy = findPresentEmployee(presentEmployees, form.count_by);

      const scopedForm = formWithScopedFollowUp(form);
      const data = await apiJson<{ row: ExceptionReportRecord }>('/api/exception-reports', {
        method: 'PATCH',
        body: JSON.stringify({
          ...scopedForm,
          id: editing.id,
          status: editingStatus,
          picking_operator: pickingOperator?.staff_id ?? form.picking_operator,
          packing_rebin_operator: packingRebinOperator?.staff_id ?? form.packing_rebin_operator ?? '',
          count_by: countBy?.staff_id ?? form.count_by,
          submitted_by_lead_id: form.submitted_by_lead_id || leadId,
          lead_pin: leadPin
        })
      });
      setRows((current) => current.map((item) => (String(item.id) === String(data.row.id) ? data.row : item)));
      setSelected(data.row);
      setEditing(data.row);
      setEditingStatus(data.row.status);
      setForm(formFromRecord(data.row, leadPin));
      setModalOpen(false);
      setMessage({ tone: 'success', text: 'Exception updated.' });
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to update exception.') });
    } finally {
      setSaving(false);
    }
  };

  const advanceStatus = async (row: ExceptionReportRecord) => {
    const currentIndex = statusOrder.indexOf(row.status);
    const nextStatus = statusOrder[currentIndex + 1];
    if (!nextStatus || nextStatus === 'Closed') return;
    setSaving(true);
    setMessage({ tone: 'idle', text: '' });
    try {
      const data = await apiJson<{ row: ExceptionReportRecord }>('/api/exception-reports', {
        method: 'PATCH',
        body: JSON.stringify({
          id: row.id,
          lead_pin: leadPin,
          status: nextStatus,
          resolution_note: row.resolution_note,
          borrowed_location: row.borrowed_location,
          borrowed_qty: row.borrowed_qty,
          inventory_adjustment: row.inventory_adjustment
        })
      });
      setRows((current) => current.map((item) => (String(item.id) === String(row.id) ? data.row : item)));
      setSelected(data.row);
      setMessage({ tone: 'success', text: `Moved to ${nextStatus}.` });
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to update status.') });
    } finally {
      setSaving(false);
    }
  };

  const openPrint = async (row: ExceptionReportRecord) => {
    setSaving(true);
    try {
      const payload = buildExceptionPrintPayload(row, window.location.origin);
      const qr = await QRCode.toDataURL(payload.qrValue, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
      setPrintPayload(payload);
      setQrDataUrl(qr);
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to build label.') });
    } finally {
      setSaving(false);
    }
  };

  if (!unlocked) {
    return (
      <main className="min-h-screen px-5 py-8 text-white">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1480px] items-center justify-center">
          <section className="relative mx-auto w-full max-w-[1120px] overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(135deg,rgba(5,7,10,0.92),rgba(11,13,16,0.84))] shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -left-20 top-[-72px] h-64 w-64 rounded-full bg-[#9eff00]/10 blur-3xl" />
              <div className="absolute bottom-[-96px] right-[-56px] h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_32%)]" />
            </div>

            <div className="relative grid min-h-[520px] gap-8 px-6 py-6 md:grid-cols-[minmax(0,1.3fr)_minmax(380px,0.9fr)] md:px-8 md:py-8 xl:px-10 xl:py-10">
              <div className="flex min-h-[240px] flex-col justify-between rounded-[28px] border border-white/8 bg-white/[0.03] p-6 md:p-8">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.32em] text-sky-200/80">OBP Security</div>
                  <h1 className="mt-6 max-w-[10ch] font-display text-5xl leading-[0.92] tracking-[0.03em] text-white md:text-6xl xl:text-7xl">
                    Outbound Exception
                  </h1>
                </div>
              </div>

              <div className="flex items-center">
                <div className="w-full rounded-[30px] border border-white/10 bg-black/35 p-6 shadow-[0_28px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl md:p-8">
                  <div className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Sign In</div>
                  <div className="mt-8 grid gap-5">
                    <EmployeeSearchInput label="Lead USID" value={leadId} employees={presentEmployees} onChange={setLeadId} className={loginInputClass} />
                    <Field label="PIN">
                      <input type="password" autoComplete="new-password" name="exception-pin" value={leadPin} onChange={(event) => setLeadPin(event.target.value)} className={loginInputClass} />
                    </Field>
                    <button type="button" onClick={() => void unlock()} disabled={loading || leadId.trim() === '' || leadPin.trim() === ''} className={loginButtonClass}>
                      {loading ? 'Verifying...' : 'Enter'}
                    </button>
                  </div>
                  {message.text ? <p className="mt-5 min-h-[1.25rem] text-sm text-rose-300">{message.text}</p> : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.1),transparent_26%),linear-gradient(180deg,#020617,#0f172a)] text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-200">Outbound</div>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-white">Exception</h1>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search"
              className={`${inputClass} !w-56 shrink-0`}
            />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | ExceptionType)} className={`${inputClass} !w-44 shrink-0`}>
              <option value="all">All Types</option>
              {EXCEPTION_TYPES.map((type) => (
                <option key={type} value={type}>{EXCEPTION_TYPE_LABELS[type]}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ExceptionStatus)} className={`${inputClass} !w-40 shrink-0`}>
              <option value="all">All</option>
              {statusOrder.map((status) => (
                <option key={status} value={status}>{EXCEPTION_STATUS_LABELS[status]}</option>
              ))}
            </select>
            <button type="button" disabled={loading} onClick={() => void Promise.all([loadPresentEmployees(), loadRows()])} className="h-11 shrink-0 cursor-pointer rounded-2xl border border-white/10 px-4 text-sm font-black text-white transition hover:bg-white/10 disabled:opacity-50">
              {loading ? 'Loading' : 'Refresh'}
            </button>
            <button type="button" onClick={openNewModal} className="h-11 shrink-0 cursor-pointer rounded-2xl bg-emerald-300 px-5 text-sm font-black text-slate-950 transition hover:bg-emerald-200">
              New Exception
            </button>
          </div>
        </header>

        {message.text ? (
          <div className={['rounded-2xl border px-4 py-3 text-sm font-semibold', message.tone === 'success' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-rose-400/30 bg-rose-400/10 text-rose-100'].join(' ')}>
            {message.text}
          </div>
        ) : null}

        <section className="grid min-w-0 gap-5">
          <div className="min-w-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/70 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="font-black">Queue</h2>
              <span className="text-sm font-bold text-slate-400">{visibleRows.length}</span>
            </div>
            <div>
              {visibleRows.length === 0 ? (
                <div className="p-10 text-center text-sm font-semibold text-slate-400">No reports</div>
              ) : (
                visibleRows.map((row) => {
                  const active = selected && String(selected.id) === String(row.id);
                  const nextStatus = statusOrder[statusOrder.indexOf(row.status) + 1];
                  const submittedBy = employeeName(presentEmployees, row.submitted_by_lead_id);
                  const createdAt = formatQueueDateTime(row.created_at);
                  const details = [formatExceptionType(row.exception_type), row.picking_list_number, row.picking_container].filter(Boolean).join(' · ');
                  return (
                    <button key={row.id} type="button" onClick={() => openEditModal(row)} className={['block w-full min-w-0 cursor-pointer border-b px-4 py-3 text-left transition last:border-b-0', rowStatusClass[row.status], active ? 'ring-2 ring-white/50' : ''].join(' ')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 pr-2">
                          <div className="truncate text-sm font-black">#{row.id} · {row.product_barcode}</div>
                          {details ? <div className="mt-1 break-words text-xs font-semibold text-current opacity-90">{details}</div> : null}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                        {nextStatus && nextStatus !== 'Closed' ? (
                          <span role="button" onClick={(event) => { event.stopPropagation(); void advanceStatus(row); }} className="rounded-lg bg-white px-2 py-1 text-xs font-black text-slate-950">
                            Move {nextStatus}
                          </span>
                        ) : null}
                        <span role="button" onClick={(event) => { event.stopPropagation(); void openPrint(row); }} className="rounded-lg border border-white/50 px-2 py-1 text-xs font-black text-white">
                          Print
                        </span>
                        <span className="ml-auto text-right text-xs font-semibold text-current opacity-90">
                          {submittedBy} · {createdAt}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>

      {modalOpen ? (
        <NewExceptionModal
          mode={editing ? 'edit' : 'create'}
          reportId={editing ? String(editing.id) : undefined}
          status={editing ? editingStatus : undefined}
          form={form}
          employees={presentEmployees}
          saving={saving}
          onChange={updateForm}
          onStatusChange={setEditingStatus}
          onClose={() => setModalOpen(false)}
          onPrint={editing ? () => void openPrint(editing) : undefined}
          onSubmit={() => void (editing ? saveReport() : submitReport())}
        />
      ) : null}
      {printPayload && qrDataUrl ? <PrintLabelPreview payload={printPayload} qrDataUrl={qrDataUrl} onClose={() => setPrintPayload(null)} /> : null}
    </main>
  );
}
