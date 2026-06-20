import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import QRCode from 'qrcode';
import BorderGlow from './components/reactBits/BorderGlow';
import { compactLooseSearchText, matchesLooseSearch, normalizeLooseSearchText } from './lib/textSearch';
import {
  EXCEPTION_TYPE_LABELS,
  EXCEPTION_TYPES,
  EXCEPTION_STATUS_LABELS,
  buildExceptionEditItemRows,
  buildExceptionPrintPayload,
  formatExceptionType,
  getExceptionReportNumber,
  hasExceptionReplenishmentCandidate,
  inferExceptionStatus,
  splitExceptionReportItemRows,
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

const buildLocalDateRange = (dateOnly: string) => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  if (!year || !month || !day) return null;
  const start = new Date(year, month - 1, day);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
};

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
  item_rows: [],
  count_by: '',
  borrowed_location: '',
  borrowed_qty: '',
  short_picked: false,
  extra_taken: false,
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
  item_rows: row.item_rows ?? [],
  count_by: row.count_by ?? '',
  borrowed_location: row.borrowed_location ?? '',
  borrowed_qty: row.borrowed_qty === null || row.borrowed_qty === undefined ? '' : String(row.borrowed_qty),
  short_picked: Boolean(row.short_picked),
  extra_taken: Boolean(row.extra_taken),
  inventory_adjustment: row.inventory_adjustment,
  submitted_by_lead_id: row.submitted_by_lead_id,
  lead_pin: leadPin,
  resolution_note: row.resolution_note ?? ''
});

const statusOrder: ExceptionStatus[] = ['Open', 'Processing', 'Counted', 'Pending Adjustment', 'Short Picked', 'Resolved', 'Closed'];

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
  Closed: {
    backgroundColor: '#020617',
    glowColor: '215 20 72',
    colors: ['#cbd5e1', '#94a3b8', '#64748b'],
    textClass: 'text-slate-100',
    badgeClass: 'border-slate-200/30 bg-slate-200/10 text-slate-100'
  }
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

const employeeSearchText = (employee: PresentEmployeeOption) =>
  `${employee.staff_id} ${employee.name} ${employee.position} ${employee.agency}`;

const employeeSearchScore = (employee: PresentEmployeeOption, query: string) => {
  const normalizedQuery = normalizeLooseSearchText(query);
  if (!normalizedQuery) return 0;

  const normalizedName = normalizeLooseSearchText(employee.name);
  const normalizedStaffId = normalizeLooseSearchText(employee.staff_id);
  const normalizedHaystack = normalizeLooseSearchText(employeeSearchText(employee));
  const compactQuery = compactLooseSearchText(query);
  const compactName = compactLooseSearchText(employee.name);
  const compactStaffId = compactLooseSearchText(employee.staff_id);

  if (normalizedName === normalizedQuery || normalizedStaffId === normalizedQuery) return 0;
  if (normalizedName.startsWith(normalizedQuery) || normalizedStaffId.startsWith(normalizedQuery)) return 1;
  if (compactName.startsWith(compactQuery) || compactStaffId.startsWith(compactQuery)) return 2;
  if (normalizedHaystack.includes(normalizedQuery)) return 3;
  return 4;
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

const shouldShowFollowUp = (form: Pick<ExceptionReportInput, 'exception_type' | 'system_location_qty' | 'actual_qty' | 'item_rows'>) => {
  const itemRows = buildExceptionEditItemRows({
    product_barcode: '',
    picked_location: '',
    picking_container: '',
    system_location_qty: form.system_location_qty,
    actual_qty: form.actual_qty,
    item_rows: form.item_rows
  });
  return itemRows.some((row) => {
    const value = String(row.actualQty ?? '').trim();
    return value !== '' && Number(value) === 0;
  }) || hasExceptionReplenishmentCandidate(form);
};

const shouldShowShortPicked = (form: Pick<ExceptionReportInput, 'exception_type' | 'actual_qty' | 'item_rows'>) => {
  if (form.exception_type !== 'short_shipment') return false;
  return buildExceptionEditItemRows({
    product_barcode: '',
    picked_location: '',
    picking_container: '',
    system_location_qty: '',
    actual_qty: form.actual_qty,
    item_rows: form.item_rows
  }).some((row) => {
    const value = String(row.actualQty ?? '').trim();
    return value !== '' && Number(value) === 0;
  });
};

const formWithScopedFollowUp = (form: ExceptionReportInput): ExceptionReportInput => {
  if (shouldShowFollowUp(form)) {
    const needsAdjustment = Boolean(String(form.borrowed_location ?? '').trim()) || Boolean(form.extra_taken);
    return {
      ...form,
      inventory_adjustment: needsAdjustment ? form.inventory_adjustment : false
    };
  }
  return {
    ...form,
    borrowed_location: '',
    borrowed_qty: '',
    short_picked: false,
    extra_taken: false,
    inventory_adjustment: false,
    resolution_note: form.exception_type === 'other' ? form.resolution_note : ''
  };
};

const toNullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const inputClass =
  'h-11 w-full rounded-2xl border border-slate-700/70 bg-[#080d18]/80 px-3 text-sm font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-300/60 focus:ring-4 focus:ring-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-50';

const numericInputClass =
  `${inputClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;
const itemInputClass = `${inputClass} min-w-0`;
const itemNumericInputClass = `${numericInputClass} min-w-0`;
const itemRowGridClass =
  'grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(84px,0.5fr)_minmax(76px,0.45fr)_36px] gap-3';

const textAreaClass =
  'min-h-24 w-full rounded-2xl border border-slate-700/70 bg-[#080d18]/80 px-3 py-2 text-sm font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-300/60 focus:ring-4 focus:ring-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-50';

const loginInputClass =
  'h-14 w-full rounded-[20px] border border-slate-700/70 bg-[#080d18]/80 px-5 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60';

const loginButtonClass =
  'mt-2 h-14 w-full cursor-pointer rounded-[20px] border border-cyan-200/70 bg-cyan-200 px-5 text-base font-semibold text-slate-950 shadow-[0_18px_48px_rgba(103,232,249,0.18)] transition hover:-translate-y-0.5 hover:bg-cyan-100 hover:shadow-[0_22px_60px_rgba(103,232,249,0.24)] disabled:cursor-not-allowed disabled:border-slate-700/70 disabled:bg-slate-900/80 disabled:text-slate-300 disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:bg-slate-900/80';

const joinMultiField = (rows: string[]) => rows.map((row) => row.trim()).join('\n').replace(/\n+$/g, '');

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'sm:col-span-2' : ''}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function ExceptionItemFields({
  form,
  onChange
}: {
  form: ExceptionReportInput;
  onChange: (patch: Partial<ExceptionReportInput>) => void;
}) {
  const [visibleRowCount, setVisibleRowCount] = useState(1);
  const rows = buildExceptionEditItemRows(form, visibleRowCount);

  useEffect(() => {
    setVisibleRowCount((current) => Math.max(current, rows.length));
  }, [rows.length]);

  const updateRows = (nextRows: Array<{ product: string; location: string; systemQty: string; actualQty: string }>) => {
    setVisibleRowCount(Math.max(1, nextRows.length));
    const firstRow = nextRows[0] ?? { product: '', location: '', systemQty: '', actualQty: '' };
    onChange({
      product_barcode: joinMultiField(nextRows.map((row) => row.product)),
      picked_location: joinMultiField(nextRows.map((row) => row.location)),
      system_location_qty: firstRow.systemQty,
      actual_qty: firstRow.actualQty,
      item_rows: nextRows.map((row) => ({
        product_barcode: row.product,
        picked_location: row.location,
        system_location_qty: row.systemQty,
        actual_qty: row.actualQty
      }))
    });
  };

  return (
    <div className="grid gap-2 sm:col-span-2">
      <div className={itemRowGridClass}>
        <div className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Product Barcode</div>
        <div className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Picked Location</div>
        <div className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">System Qty</div>
        <div className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Actual</div>
        <button
          type="button"
          onClick={() => setVisibleRowCount(rows.length + 1)}
          aria-label="Add item row"
          title="Add"
          className="inline-flex h-7 w-9 items-center justify-center rounded-lg border border-emerald-300/40 bg-emerald-300/10 text-emerald-100 transition hover:border-emerald-200 hover:bg-emerald-300/20"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {rows.map((row, index) => (
        <div key={`exception-item-${index}`} className={`mt-2 ${itemRowGridClass}`}>
          <input
            value={row.product}
            onChange={(event) => {
              const nextRows = [...rows];
              nextRows[index] = { ...row, product: event.target.value };
              updateRows(nextRows);
            }}
            className={itemInputClass}
          />
          <input
            value={row.location}
            onChange={(event) => {
              const nextRows = [...rows];
              nextRows[index] = { ...row, location: event.target.value };
              updateRows(nextRows);
            }}
            className={itemInputClass}
          />
          <input
            type="text"
            inputMode="decimal"
            value={row.systemQty}
            onChange={(event) => {
              const nextRows = [...rows];
              nextRows[index] = { ...row, systemQty: event.target.value };
              updateRows(nextRows);
            }}
            className={itemNumericInputClass}
          />
          <input
            type="text"
            inputMode="decimal"
            value={row.actualQty}
            onChange={(event) => {
              const nextRows = [...rows];
              nextRows[index] = { ...row, actualQty: event.target.value };
              updateRows(nextRows);
            }}
            className={itemNumericInputClass}
          />
          <button
            type="button"
            onClick={() => updateRows(rows.filter((_, rowIndex) => rowIndex !== index))}
            disabled={rows.length === 1}
            aria-label={`Remove item row ${index + 1}`}
            title="Remove"
            className="inline-flex h-11 w-9 items-center justify-center rounded-xl border border-slate-700/70 bg-[#080d18]/70 text-slate-300 transition hover:border-rose-300/70 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
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
    const query = value.trim();
    if (!query) return employees.slice(0, 12);
    return employees
      .filter((employee) => matchesLooseSearch(employeeSearchText(employee), query))
      .sort((left, right) => employeeSearchScore(left, query) - employeeSearchScore(right, query) || left.name.localeCompare(right.name, 'en-US', { sensitivity: 'base' }))
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
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 max-h-60 overflow-auto rounded-2xl border border-slate-800/80 bg-slate-950 p-1.5 shadow-2xl">
          {options.map((employee) => (
            <button
              key={`${label}-${employee.staff_id}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(employee.name || employee.staff_id);
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-slate-800/80"
            >
              <span className="min-w-0">
                <span className="block truncate font-black">{employee.name || employee.staff_id}</span>
              </span>
            </button>
          ))}
        </div>
      ) : open && value.trim() ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 rounded-2xl border border-slate-800/80 bg-slate-950 px-3 py-3 text-sm font-semibold text-slate-400 shadow-2xl">
          No clocked-in employee match
        </div>
      ) : null}
    </div>
  );
}

type PrintLabelQrDataUrls = Record<ExceptionReportPrintPayload['qrFields'][number]['key'], string>;
type PrintLabelSheet = {
  payload: ExceptionReportPrintPayload;
  qrDataUrl: string;
  qrFieldDataUrls: PrintLabelQrDataUrls;
};

const escapePrintHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildPrintLabelSheetHtml = ({ payload, qrDataUrl, qrFieldDataUrls }: PrintLabelSheet) => {
  const qrFields = payload.qrFields
    .map((field) => {
      const qr = qrFieldDataUrls[field.key];
      return `
        <div class="qr-field">
          <div class="qr-label">${escapePrintHtml(field.label)}</div>
          <div class="qr-box">${qr ? `<img src="${escapePrintHtml(qr)}" alt="QR ${escapePrintHtml(field.label)}" />` : ''}</div>
          <div class="qr-value">${escapePrintHtml(field.value)}</div>
        </div>`;
    })
    .join('');
  const fields = payload.fields
    .map(
      (field) => `
        <div class="field">
          <div class="field-label">${escapePrintHtml(field.label)}</div>
          <div class="field-value">${escapePrintHtml(field.value)}</div>
        </div>`
    )
    .join('');

  return `
  <section class="sheet">
    <div class="type-banner">
      <div class="type-icon">!</div>
      <div>
        <div class="type-kicker">Exception Type</div>
        <div class="type-value">${escapePrintHtml(payload.exceptionTypeLabel)}</div>
      </div>
    </div>
    <div class="header">
      <div>
        <div class="title">${escapePrintHtml(payload.title)}</div>
        <div class="id">#${escapePrintHtml(payload.reportId)}</div>
        <div class="status">${escapePrintHtml(payload.status)}</div>
      </div>
      <div class="main-qr"><img src="${escapePrintHtml(qrDataUrl)}" alt="QR ${escapePrintHtml(payload.reportId)}" /></div>
    </div>
    <div class="grid">
      <div class="created">
        <div class="created-grid">
          <div>
            <div class="created-label">Created</div>
            <div class="created-value">${escapePrintHtml(payload.reportDate)}</div>
          </div>
          <div>
            <div class="created-label">Created By</div>
            <div class="created-value">${escapePrintHtml(payload.createdBy)}</div>
          </div>
        </div>
      </div>
      <div class="qr-grid">${qrFields}</div>
      ${fields}
    </div>
  </section>`;
};

const buildPrintLabelHtml = (sheets: PrintLabelSheet[]) => {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Exception #${escapePrintHtml(sheets[0]?.payload.reportId ?? '')}</title>
  <style>
    @page { size: 4in 6in; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: 4in; margin: 0; background: #f8fafc; }
    body { color: #020617; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { width: 4in; height: 6in; overflow: hidden; padding: 0.18in; background: #f8fafc; break-after: page; page-break-after: always; }
    .sheet:last-child { break-after: auto; page-break-after: auto; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.12in; border-bottom: 1px solid #cbd5e1; margin-top: 0.08in; padding-bottom: 0.1in; }
    .title { font-size: 0.16in; font-weight: 900; text-transform: uppercase; letter-spacing: 0.08in; color: #64748b; }
    .id { margin-top: 0.04in; font-size: 0.26in; font-weight: 900; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { display: inline-flex; margin-top: 0.04in; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; padding: 0.02in 0.08in; font-size: 0.11in; font-weight: 800; text-transform: uppercase; }
    .main-qr { display: grid; place-items: center; width: 0.92in; height: 0.92in; flex: 0 0 auto; border: 1px solid #cbd5e1; border-radius: 0.12in; background: #fff; padding: 0.04in; }
    img { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.06in; margin-top: 0.08in; }
    .created { grid-column: span 2; border: 1px solid #e2e8f0; border-radius: 0.12in; background: #fff; color: #020617; padding: 0.08in 0.12in; }
    .created-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 0.12in; }
    .created-label { font-size: 0.1in; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04in; color: #64748b; }
    .created-value { margin-top: 0.02in; font-size: 0.18in; font-weight: 900; color: #020617; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .type-banner { grid-column: span 2; display: grid; grid-template-columns: 0.42in minmax(0, 1fr); align-items: center; gap: 0.1in; border: 2px solid #020617; border-radius: 0.12in; background: #fff; padding: 0.08in 0.12in; }
    .type-icon { display: grid; place-items: center; width: 0.36in; height: 0.36in; border: 2px solid #020617; border-radius: 999px; color: #020617; font-size: 0.24in; font-weight: 900; line-height: 1; }
    .type-kicker { font-size: 0.085in; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05in; color: #64748b; }
    .type-value { margin-top: 0.01in; font-size: 0.26in; font-weight: 900; line-height: 1; color: #020617; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .qr-grid { grid-column: span 2; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.06in; }
    .qr-field { min-width: 0; border: 1px solid #e2e8f0; border-radius: 0.08in; background: #fff; padding: 0.04in 0.06in; }
    .qr-label { text-align: center; font-size: 0.075in; font-weight: 800; text-transform: uppercase; letter-spacing: 0.012in; color: #64748b; }
    .qr-box { display: grid; place-items: center; width: 0.66in; height: 0.66in; margin: 0.04in auto 0; background: #fff; }
    .qr-value { margin-top: 0.04in; text-align: center; font-size: 0.075in; font-weight: 900; line-height: 1.1; white-space: pre-line; overflow-wrap: anywhere; }
    .field { min-height: 0.34in; border: 1px solid #e2e8f0; border-radius: 0.08in; background: #fff; padding: 0.04in 0.08in; }
    .field-label { font-size: 0.08in; font-weight: 800; text-transform: uppercase; letter-spacing: 0.015in; color: #64748b; }
    .field-value { margin-top: 0.02in; font-size: 0.108in; font-weight: 900; line-height: 1.15; color: #020617; overflow-wrap: anywhere; white-space: pre-line; }
  </style>
</head>
<body>
${sheets.map((sheet) => buildPrintLabelSheetHtml(sheet)).join('\n')}
</body>
</html>`;
};

const printLabelDocument = (sheets: PrintLabelSheet[]) => {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const printWindow = iframe.contentWindow;
  const printDocument = iframe.contentDocument ?? printWindow?.document;
  if (!printWindow || !printDocument) {
    iframe.remove();
    throw new Error('Print frame is not available.');
  }

  printDocument.open();
  printDocument.write(buildPrintLabelHtml(sheets));
  printDocument.close();

  const cleanup = () => window.setTimeout(() => iframe.remove(), 500);
  printWindow.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
    window.setTimeout(() => {
      if (document.body.contains(iframe)) iframe.remove();
    }, 30000);
  }, 100);
};

function NewExceptionModal({
  mode,
  reportId,
  status,
  form,
  employees,
  saving,
  onChange,
  onClose,
  onPrint,
  onCancelException,
  onRestartException,
  onSubmit
}: {
  mode: 'create' | 'edit';
  reportId?: string;
  status?: ExceptionStatus;
  form: ExceptionReportInput;
  employees: PresentEmployeeOption[];
  saving: boolean;
  onChange: (patch: Partial<ExceptionReportInput>) => void;
  onClose: () => void;
  onPrint?: () => void;
  onCancelException?: () => void;
  onRestartException?: () => void;
  onSubmit: () => void;
}) {
  const inferredStatus = status === 'Closed' ? 'Closed' : inferExceptionStatus(form);
  const showFollowUp = shouldShowFollowUp(form);
  const showShortPicked = shouldShowShortPicked(form);
  const showExtraTaken = hasExceptionReplenishmentCandidate(form);
  const adjustmentEnabled = Boolean(form.extra_taken || String(form.borrowed_location ?? '').trim());
  const showOtherReason = form.exception_type === 'other';

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-slate-950/75 px-4 py-6 backdrop-blur">
      <section className="mx-auto w-full max-w-5xl rounded-[1.75rem] border border-slate-800/80 bg-slate-950 p-5 text-white shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-200">{mode === 'edit' ? 'Edit' : 'New'}</div>
            <h2 className="mt-1 text-3xl font-black tracking-tight">{mode === 'edit' && reportId ? `#${reportId}` : 'Exception'}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="h-10 cursor-pointer rounded-xl border border-slate-700/70 px-4 text-sm font-black text-slate-200 transition hover:bg-slate-900/80 disabled:opacity-50">
            Close
          </button>
        </div>

        <div className={showFollowUp ? 'grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]' : 'grid gap-5'}>
          <div className="rounded-3xl border border-slate-800/80 bg-black/20 p-4">
            <div className="mb-4 text-sm font-black text-white">Report</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {mode === 'edit' && status ? (
                <Field label="Status">
                  <div className={`${inputClass} flex items-center`}>{EXCEPTION_STATUS_LABELS[inferredStatus]}</div>
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
              {showOtherReason ? (
                <Field label="Reason" wide>
                  <textarea
                    value={form.resolution_note ?? ''}
                    onChange={(event) => onChange({ resolution_note: event.target.value })}
                    className={textAreaClass}
                  />
                </Field>
              ) : null}
              <Field label="Picking List Number">
                <input value={form.picking_list_number} onChange={(event) => onChange({ picking_list_number: event.target.value })} className={inputClass} />
              </Field>
              <Field label="Container">
                <input value={form.picking_container} onChange={(event) => onChange({ picking_container: event.target.value })} className={inputClass} />
              </Field>
              <ExceptionItemFields form={form} onChange={onChange} />
              <EmployeeSearchInput label="Pick Operator" value={form.picking_operator} employees={employees} onChange={(value) => onChange({ picking_operator: value })} />
              <EmployeeSearchInput label="Packing/Rebin Operator" value={form.packing_rebin_operator ?? ''} employees={employees} onChange={(value) => onChange({ packing_rebin_operator: value })} />
              <EmployeeSearchInput label="Count By USID" value={form.count_by} employees={employees} onChange={(value) => onChange({ count_by: value })} />
            </div>
          </div>

          {showFollowUp ? <div className="rounded-3xl border border-slate-800/80 bg-black/20 p-4">
            <div className="mb-4 text-sm font-black text-white">Follow-up</div>
            <div className="grid gap-3">
              {showShortPicked ? (
                <Field label="Short Picked">
                  <div className="flex h-11 w-full items-center justify-between gap-3 rounded-2xl border border-slate-700/70 bg-[#080d18]/80 px-3 transition focus-within:border-orange-300/60 focus-within:ring-4 focus-within:ring-orange-300/10">
                    <span className={['text-sm font-black', form.short_picked ? 'text-orange-100' : 'text-slate-300'].join(' ')}>
                      {form.short_picked ? 'Yes' : 'No'}
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={Boolean(form.short_picked)}
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? { short_picked: true, extra_taken: false, borrowed_location: '', borrowed_qty: '', inventory_adjustment: false }
                            : { short_picked: false }
                        )
                      }
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={[
                        'relative h-7 w-12 shrink-0 rounded-full border transition',
                        form.short_picked ? 'border-orange-300/40 bg-orange-300/25' : 'border-slate-700/70 bg-slate-800'
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'absolute left-1 top-1 h-5 w-5 rounded-full shadow-lg transition',
                          form.short_picked ? 'translate-x-5 bg-orange-200' : 'translate-x-0 bg-slate-400'
                        ].join(' ')}
                      />
                    </span>
                  </div>
                </Field>
              ) : null}
              {showExtraTaken ? (
                <Field label="Extra Taken">
                  <div className="flex h-11 w-full items-center justify-between gap-3 rounded-2xl border border-slate-700/70 bg-[#080d18]/80 px-3 transition focus-within:border-cyan-300/60 focus-within:ring-4 focus-within:ring-cyan-300/10">
                    <span className={['text-sm font-black', form.extra_taken ? 'text-cyan-100' : 'text-slate-300'].join(' ')}>
                      {form.extra_taken ? 'Yes' : 'No'}
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={Boolean(form.extra_taken)}
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? { extra_taken: true, short_picked: false }
                            : { extra_taken: false, inventory_adjustment: form.borrowed_location ? form.inventory_adjustment : false }
                        )
                      }
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={[
                        'relative h-7 w-12 shrink-0 rounded-full border transition',
                        form.extra_taken ? 'border-cyan-300/40 bg-cyan-300/25' : 'border-slate-700/70 bg-slate-800'
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'absolute left-1 top-1 h-5 w-5 rounded-full shadow-lg transition',
                          form.extra_taken ? 'translate-x-5 bg-cyan-200' : 'translate-x-0 bg-slate-400'
                        ].join(' ')}
                      />
                    </span>
                  </div>
                </Field>
              ) : null}
              <Field label="Borrowed Location">
                <input
                  value={form.borrowed_location ?? ''}
                  onChange={(event) => onChange({ borrowed_location: event.target.value, short_picked: false })}
                  disabled={Boolean(form.short_picked)}
                  className={inputClass}
                />
              </Field>
              <Field label="Borrowed Qty">
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.borrowed_qty ?? ''}
                  onChange={(event) => onChange({ borrowed_qty: event.target.value, short_picked: false })}
                  disabled={Boolean(form.short_picked)}
                  className={numericInputClass}
                />
              </Field>
              <Field label="Inventory Adjustment">
                <div className={['flex h-11 w-full items-center justify-between gap-3 rounded-2xl border border-slate-700/70 bg-[#080d18]/80 px-3 transition focus-within:border-emerald-300/60 focus-within:ring-4 focus-within:ring-emerald-300/10', form.short_picked || !adjustmentEnabled ? 'opacity-50' : ''].join(' ')}>
                  <span className={['text-sm font-black', form.inventory_adjustment && adjustmentEnabled ? 'text-emerald-100' : 'text-slate-300'].join(' ')}>
                    {form.inventory_adjustment && adjustmentEnabled ? 'Yes' : 'No'}
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={form.inventory_adjustment && adjustmentEnabled}
                    disabled={Boolean(form.short_picked) || !adjustmentEnabled}
                    onChange={(event) => onChange({ inventory_adjustment: event.target.checked })}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={[
                      'relative h-7 w-12 shrink-0 rounded-full border transition',
                      form.inventory_adjustment ? 'border-emerald-300/40 bg-emerald-300/25' : 'border-slate-700/70 bg-slate-800'
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'absolute left-1 top-1 h-5 w-5 rounded-full shadow-lg transition',
                        form.inventory_adjustment ? 'translate-x-5 bg-emerald-200' : 'translate-x-0 bg-slate-400'
                      ].join(' ')}
                    />
                  </span>
                </div>
              </Field>
              {!showOtherReason ? <Field label="Resolution Note">
                <textarea value={form.resolution_note ?? ''} onChange={(event) => onChange({ resolution_note: event.target.value })} className={textAreaClass} />
              </Field> : null}
            </div>
          </div> : null}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {mode === 'edit' && status !== 'Closed' && onCancelException ? (
              <button type="button" onClick={onCancelException} disabled={saving} className="h-11 cursor-pointer rounded-xl border border-slate-500/40 bg-slate-950 px-5 text-sm font-black text-slate-100 transition hover:border-slate-300 hover:bg-slate-900 disabled:opacity-50">
                Cancel Exception
              </button>
            ) : null}
            {mode === 'edit' && status === 'Closed' && onRestartException ? (
              <button type="button" onClick={onRestartException} disabled={saving} className="h-11 cursor-pointer rounded-xl border border-sky-300/30 bg-sky-400/15 px-5 text-sm font-black text-sky-100 transition hover:border-sky-200 hover:bg-sky-400/25 disabled:opacity-50">
                Restart Exception
              </button>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
          {mode === 'edit' && onPrint ? (
            <button type="button" onClick={onPrint} disabled={saving} className="h-11 cursor-pointer rounded-xl border border-slate-700/70 px-5 text-sm font-black text-white transition hover:bg-slate-900/80 disabled:opacity-50">
              Print
            </button>
          ) : null}
          <button type="button" onClick={onSubmit} disabled={saving} className="h-11 cursor-pointer rounded-xl bg-emerald-300 px-5 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:opacity-50">
            {saving ? 'Saving' : mode === 'edit' ? 'Save' : 'Create'}
          </button>
          </div>
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
  const [statusFilter, setStatusFilter] = useState<'all' | ExceptionStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | ExceptionType>('all');
  const [createdDateFilter, setCreatedDateFilter] = useState(currentDate);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'idle'; text: string }>({ tone: 'idle', text: '' });

  const visibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (typeFilter !== 'all' && row.exception_type !== typeFilter) return false;
      if (!query) return true;
      const submittedBy = employeeName(presentEmployees, row.submitted_by_lead_id);
      const haystack = [
        row.id,
        row.report_number,
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

  useEffect(() => {
    if (!message.text) return undefined;
    const timer = window.setTimeout(() => {
      setMessage((current) => (current.text === message.text ? { tone: 'idle', text: '' } : current));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [message.text]);

  const loadPresentEmployees = async (pinOverride = leadPin) => {
    const pin = pinOverride.trim();
    const data = await apiJson<{ rows: PresentEmployeeOption[] }>('/api/exception-reports?present=1', {
      headers: pin ? { 'X-Exception-Lead-Pin': pin } : {}
    });
    setPresentEmployees(data.rows ?? []);
  };

  const loadRows = async (pinOverride = leadPin, createdDateOverride = createdDateFilter) => {
    setLoading(true);
    setMessage({ tone: 'idle', text: '' });
    try {
      const search = new URLSearchParams();
      const createdRange = buildLocalDateRange(createdDateOverride);
      if (createdRange) {
        search.set('created_start', createdRange.start);
        search.set('created_end', createdRange.end);
      }
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

  const handleCreatedDateChange = (value: string) => {
    setCreatedDateFilter(value);
    if (unlocked) void loadRows(leadPin, value);
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
      setForm(formFromRecord(data.row, leadPin));
      setModalOpen(false);
      setMessage({ tone: 'success', text: 'Exception updated.' });
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to update exception.') });
    } finally {
      setSaving(false);
    }
  };

  const setEditingReportStatus = async (nextStatus: ExceptionStatus) => {
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
          status: nextStatus,
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
      setForm(formFromRecord(data.row, leadPin));
      setModalOpen(false);
      setMessage({ tone: 'success', text: nextStatus === 'Closed' ? 'Exception canceled.' : 'Exception restarted.' });
    } catch (error: any) {
      setMessage({ tone: 'error', text: String(error?.message ?? error ?? 'Failed to update exception status.') });
    } finally {
      setSaving(false);
    }
  };

  const openPrint = async (row: ExceptionReportRecord) => {
    setSaving(true);
    try {
      const itemRows = splitExceptionReportItemRows(row);
      const printableRows = itemRows.length
        ? itemRows
        : [{
            product_barcode: row.product_barcode || '',
            picked_location: row.picked_location || '',
            picking_container: row.picking_container || '',
            system_location_qty: row.system_location_qty,
            actual_qty: row.actual_qty
          }];
      const sheets = await Promise.all(
        printableRows.map(async (itemRow) => {
          const payload = buildExceptionPrintPayload(
            {
              ...row,
              product_barcode: itemRow.product_barcode,
              picked_location: itemRow.picked_location,
              picking_container: row.picking_container || '',
              system_location_qty: toNullableNumber(itemRow.system_location_qty),
              actual_qty: toNullableNumber(itemRow.actual_qty)
            },
            window.location.origin,
            (staffId) => employeeName(presentEmployees, staffId)
          );
          const [qr, ...fieldQrs] = await Promise.all([
            QRCode.toDataURL(payload.qrValue, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
            ...payload.qrFields.map((field) =>
              field.value ? QRCode.toDataURL(field.value, { margin: 1, width: 180, errorCorrectionLevel: 'M' }) : Promise.resolve('')
            )
          ]);
          const nextQrFieldDataUrls = payload.qrFields.reduce<Partial<PrintLabelQrDataUrls>>((acc, field, index) => {
            acc[field.key] = fieldQrs[index] ?? '';
            return acc;
          }, {});
          return {
            payload,
            qrDataUrl: qr,
            qrFieldDataUrls: nextQrFieldDataUrls as PrintLabelQrDataUrls
          };
        })
      );
      printLabelDocument(sheets);
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
          <section className="relative mx-auto w-full max-w-[1120px] overflow-hidden rounded-[36px] border border-slate-800/80 bg-[linear-gradient(135deg,rgba(5,7,10,0.92),rgba(11,13,16,0.84))] shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -left-20 top-[-72px] h-64 w-64 rounded-full bg-[#9eff00]/10 blur-3xl" />
              <div className="absolute bottom-[-96px] right-[-56px] h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_32%)]" />
            </div>

            <div className="relative grid min-h-[520px] gap-8 px-6 py-6 md:grid-cols-[minmax(0,1.3fr)_minmax(380px,0.9fr)] md:px-8 md:py-8 xl:px-10 xl:py-10">
              <div className="flex min-h-[240px] flex-col justify-between rounded-[28px] border border-slate-800/80 bg-white/[0.03] p-6 md:p-8">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.32em] text-sky-200/80">OBP Security</div>
                  <h1 className="mt-6 max-w-[10ch] font-display text-5xl leading-[0.92] tracking-[0.03em] text-white md:text-6xl xl:text-7xl">
                    Outbound Exception
                  </h1>
                </div>
              </div>

              <div className="flex items-center">
                <div className="w-full rounded-[30px] border border-slate-800/80 bg-black/35 p-6 shadow-[0_28px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl md:p-8">
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
      <div className="mx-auto flex w-full max-w-[1760px] min-w-0 flex-col gap-6 px-5 py-6 sm:px-8 lg:px-10 2xl:px-12">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-5 md:flex-row md:items-end">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-200">Outbound</div>
            <h1 className="mt-2 text-5xl font-black tracking-tight text-white">Exception</h1>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search"
              className={`${inputClass} !w-56 shrink-0`}
            />
            <input
              type="date"
              value={createdDateFilter}
              onChange={(event) => handleCreatedDateChange(event.target.value)}
              aria-label="Created date"
              title="Created date"
              className={`${inputClass} !w-40 shrink-0`}
            />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | ExceptionType)} className={`${inputClass} !w-44 shrink-0`}>
              <option value="all">All Types</option>
              {EXCEPTION_TYPES.map((type) => (
                <option key={type} value={type}>{EXCEPTION_TYPE_LABELS[type]}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ExceptionStatus)} className={`${inputClass} !w-52 shrink-0`}>
              <option value="all">All</option>
              {statusOrder.map((status) => (
                <option key={status} value={status}>{EXCEPTION_STATUS_LABELS[status]}</option>
              ))}
            </select>
            <button type="button" disabled={loading} onClick={() => void Promise.all([loadPresentEmployees(), loadRows()])} className="h-11 shrink-0 cursor-pointer rounded-2xl border border-slate-700/70 bg-[#080d18]/70 px-4 text-sm font-black text-white transition hover:border-slate-500/80 hover:bg-slate-900/80 disabled:opacity-50">
              {loading ? 'Loading' : 'Refresh'}
            </button>
            <button type="button" onClick={openNewModal} className="h-11 shrink-0 cursor-pointer rounded-2xl bg-emerald-300 px-5 text-sm font-black text-slate-950 transition hover:bg-emerald-200">
              New Exception
            </button>
          </div>
        </header>

        {message.text ? (
          <div className="pointer-events-none fixed right-5 top-5 z-[60] w-[min(360px,calc(100vw-2.5rem))] sm:right-8 sm:top-8">
            <div className={['rounded-2xl border px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur-xl', message.tone === 'success' ? 'border-emerald-400/30 bg-emerald-950/90 text-emerald-100 shadow-emerald-950/30' : 'border-rose-400/30 bg-rose-950/90 text-rose-100 shadow-rose-950/30'].join(' ')}>
            {message.text}
            </div>
          </div>
        ) : null}

        <section className="grid min-w-0 gap-4">
          <div className="min-w-0">
            <div className="flex items-center justify-between px-1 py-3">
              <h2 className="text-xl font-black">Queue</h2>
              <span className="text-base font-bold text-slate-300">{visibleRows.length}</span>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
              {visibleRows.length === 0 ? (
                <div className="rounded-[28px] border border-slate-800/80 bg-slate-950/50 p-16 text-center text-base font-semibold text-slate-400 md:col-span-2 2xl:col-span-3">No reports</div>
              ) : (
                visibleRows.map((row) => {
                  const active = selected && String(selected.id) === String(row.id);
                  const reportNumber = getExceptionReportNumber(row);
                  const submittedBy = employeeName(presentEmployees, row.submitted_by_lead_id);
                  const createdAt = formatQueueDateTime(row.created_at);
                  const details = [formatExceptionType(row.exception_type), row.picking_list_number, row.picking_container].filter(Boolean).join(' · ');
                  const pickerName = row.picking_operator ? employeeName(presentEmployees, row.picking_operator) : '';
                  const packerName = row.packing_rebin_operator ? employeeName(presentEmployees, row.packing_rebin_operator) : '';
                  const hasAssignees = Boolean(pickerName || packerName);
                  const tone = statusCardTone[row.status];
                  return (
                    <BorderGlow
                      key={row.id}
                      className={['min-h-[300px] transition duration-200', active ? 'ring-2 ring-cyan-300/25 shadow-[0_0_0_1px_rgba(103,232,249,0.16),0_24px_70px_rgba(8,47,73,0.28)]' : ''].join(' ')}
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
                        className={`flex min-h-[300px] min-w-0 flex-col justify-between px-6 py-6 text-left ${tone.textClass}`}
                      >
                        <div className="flex min-w-0 items-start justify-between gap-5">
                          <div className="min-w-0">
                            <div className="truncate text-2xl font-black">#{reportNumber}</div>
                            <div className="mt-3 break-words text-sm font-black opacity-95">{row.product_barcode}</div>
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
                            {EXCEPTION_STATUS_LABELS[row.status]}
                          </span>
                        </div>
                        <div className="mt-8 flex items-end justify-between gap-4 border-t border-slate-700/70 pt-4">
                          <div className="min-w-0 text-sm font-semibold leading-6 text-current opacity-90">
                            <div className="truncate">{submittedBy}</div>
                            <div>{createdAt}</div>
                          </div>
                          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(row)}
                              disabled={saving}
                              aria-label={`Edit exception #${reportNumber}`}
                              title="Edit"
                              className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-600/80 bg-slate-950/50 px-3 text-sm font-black text-white shadow-[0_10px_24px_rgba(0,0,0,0.22)] transition hover:border-cyan-300/70 hover:bg-slate-900/80 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void openPrint(row);
                              }}
                              disabled={saving}
                              className="h-9 rounded-xl border border-slate-600/80 bg-slate-950/50 px-3 text-sm font-black text-white shadow-[0_10px_24px_rgba(0,0,0,0.22)] transition hover:border-slate-400/80 hover:bg-slate-900/80 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Print
                            </button>
                          </div>
                        </div>
                      </div>
                    </BorderGlow>
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
          reportId={editing ? getExceptionReportNumber(editing) : undefined}
          status={editing ? editing.status : undefined}
          form={form}
          employees={presentEmployees}
          saving={saving}
          onChange={updateForm}
          onClose={() => setModalOpen(false)}
          onPrint={editing ? () => void openPrint(editing) : undefined}
          onCancelException={editing ? () => void setEditingReportStatus('Closed') : undefined}
          onRestartException={editing ? () => void setEditingReportStatus('Open') : undefined}
          onSubmit={() => void (editing ? saveReport() : submitReport())}
        />
      ) : null}
    </main>
  );
}
