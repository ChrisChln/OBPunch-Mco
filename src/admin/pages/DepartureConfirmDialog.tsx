import { normalizeTerminationReason } from '../departedEmployees';
import type { TerminationType } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type DepartureConfirmDialogProps = {
  t: TranslateFn;
  displayName: string;
  type: TerminationType;
  reason: string;
  adminNote: string;
  agencyNote: string;
  isLocked: boolean;
  onTypeChange: (type: TerminationType) => void;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function DepartureConfirmDialog({
  t,
  displayName,
  type,
  reason,
  adminNote,
  agencyNote,
  isLocked,
  onTypeChange,
  onReasonChange,
  onCancel,
  onConfirm
}: DepartureConfirmDialogProps) {
  const canConfirm = Boolean(normalizeTerminationReason(reason)) && !isLocked;
  const visibleNotes = [
    { label: 'Admin Note', value: String(adminNote ?? '').trim() },
    { label: 'Agency Note', value: String(agencyNote ?? '').trim() }
  ].filter((note) => note.value);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-5 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="font-display text-xl tracking-[0.08em]">{t('离职确认', 'Departure')}</div>
        <div className="mt-4 text-sm text-slate-300">{displayName}</div>
        <div className="mt-5 grid gap-3">
          <label className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <span className="flex items-center gap-3 text-sm font-semibold">
              <input
                type="radio"
                name="termination_type"
                checked={type === 'normal'}
                onChange={() => onTypeChange('normal')}
              />
              {t('正常离职', 'Normal')}
            </span>
          </label>
          <label className="rounded-2xl border border-rose-300/20 bg-rose-500/[0.06] p-3">
            <span className="flex items-center gap-3 text-sm font-semibold text-rose-100">
              <input
                type="radio"
                name="termination_type"
                checked={type === 'blacklist'}
                onChange={() => onTypeChange('blacklist')}
              />
              {t('黑名单', 'Blacklist')}
            </span>
          </label>
          {visibleNotes.map((note) => (
            <section key={note.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{note.label}</div>
              <div className="mt-2 whitespace-pre-wrap break-words text-sm font-normal leading-6 text-slate-200">
                {note.value}
              </div>
            </section>
          ))}
          <label className="grid gap-2 text-sm font-semibold">
            <span>
              {t('离职原因', 'Departure reason')} <span className="text-rose-400">*</span>
            </span>
            <textarea
              aria-label={t('离职原因', 'Departure reason')}
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              required
              rows={3}
              className="resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-neon"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="admin-btn admin-btn-toolbar admin-btn-secondary px-4"
            onClick={onCancel}
            disabled={isLocked}
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-toolbar admin-btn-primary px-4"
            onClick={() => void onConfirm()}
            disabled={!canConfirm}
          >
            {t('确认', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
