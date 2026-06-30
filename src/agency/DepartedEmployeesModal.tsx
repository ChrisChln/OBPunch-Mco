import { createPortal } from 'react-dom';
import { useMemo, useState } from 'react';
import type { AgencyDepartedEmployeeRow } from './types';

type DepartedEmployeesModalProps = {
  open: boolean;
  rows: AgencyDepartedEmployeeRow[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
};

const normalizeText = (value: unknown) => String(value ?? '').trim();

const formatDate = (value: unknown) => {
  const text = normalizeText(value);
  if (!text) return '-';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10) || '-';
  return date.toISOString().slice(0, 10);
};

const formatShift = (value: AgencyDepartedEmployeeRow['shift']) => {
  if (value === 'early') return 'Morning';
  if (value === 'late') return 'Night';
  return '-';
};

export default function DepartedEmployeesModal({
  open,
  rows,
  loading,
  error,
  onClose,
  onRefresh
}: DepartedEmployeesModalProps) {
  const [search, setSearch] = useState('');
  const [agency, setAgency] = useState('');
  const [position, setPosition] = useState('');

  const agencyOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => normalizeText(row.agency)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const positionOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => normalizeText(row.position)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const needle = normalizeText(search).toLowerCase();
    return rows.filter((row) => {
      if (agency && normalizeText(row.agency) !== agency) return false;
      if (position && normalizeText(row.position) !== position) return false;
      if (!needle) return true;
      const haystack = [
        row.staff_id,
        row.name,
        row.agency,
        row.position,
        row.start_time,
        row.terminated_at
      ]
        .map((value) => normalizeText(value).toLowerCase())
        .join(' ');
      return haystack.includes(needle);
    });
  }, [agency, position, rows, search]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-4 py-6">
      <div className="flex max-h-[88vh] w-full max-w-6xl flex-col rounded-[32px] border border-white/10 bg-slate-950 p-6 shadow-2xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl tracking-[0.04em] text-white">Departed</h3>
            <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">Read Only</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void onRefresh()} className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={loading}>
              Refresh
            </button>
            <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10">
              Close
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name / USID"
            className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-[#9eff00]"
          />
          <select
            value={agency}
            onChange={(event) => setAgency(event.target.value)}
            className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-[#9eff00]"
          >
            <option value="">All Agency</option>
            {agencyOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-[#9eff00]"
          >
            <option value="">All Position</option>
            {positionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {error ? <div className="mt-4 text-sm text-rose-300">{error}</div> : null}

        <div className="mt-5 min-h-0 flex-1 overflow-auto rounded-[22px] border border-white/10 bg-white/[0.03]">
          <div className="min-w-[920px]">
            <div className="grid grid-cols-[120px_minmax(160px,1.5fr)_140px_140px_140px_110px_96px] items-center gap-3 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-slate-400">
              <div>Date</div>
              <div>Name</div>
              <div>ID</div>
              <div>Agency</div>
              <div>Position</div>
              <div>Shift</div>
              <div className="text-center">Start</div>
            </div>
            <div className="h-px bg-white/10" />
            {loading ? <div className="px-4 py-8 text-sm text-slate-400">Loading...</div> : null}
            {!loading && filteredRows.length === 0 ? <div className="px-4 py-8 text-sm text-slate-400">No departed employees.</div> : null}
            {!loading
              ? filteredRows.map((row) => (
                  <div
                    key={`${row.staff_id}__${row.terminated_at}`}
                    className="grid grid-cols-[120px_minmax(160px,1.5fr)_140px_140px_140px_110px_96px] items-center gap-3 px-4 py-4 text-sm text-slate-200"
                  >
                    <div className="font-mono text-slate-400">{formatDate(row.terminated_at)}</div>
                    <div className="truncate">{normalizeText(row.name) || '-'}</div>
                    <div className="font-mono">{normalizeText(row.staff_id) || '-'}</div>
                    <div className="truncate">{normalizeText(row.agency) || '-'}</div>
                    <div className="truncate">{normalizeText(row.position) || '-'}</div>
                    <div>{formatShift(row.shift)}</div>
                    <div className="text-center font-mono text-slate-400">{normalizeText(row.start_time) || '-'}</div>
                  </div>
                ))
              : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
