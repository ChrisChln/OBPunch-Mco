import { Fragment, useEffect, useRef } from 'react';

import type { AgencyTerminationDetails } from '../agencyTerminationApproval';

type TranslateFn = (zh: string, en: string) => string;

type AgencyTerminationApprovalDialogProps = {
  t: TranslateFn;
  details: AgencyTerminationDetails;
  themeMode: 'dark' | 'light';
  isSubmitting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function AgencyTerminationApprovalDialog({
  t,
  details,
  themeMode,
  isSubmitting,
  error,
  onCancel,
  onConfirm
}: AgencyTerminationApprovalDialogProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const submittingRef = useRef(isSubmitting);
  onCancelRef.current = onCancel;
  submittingRef.current = isSubmitting;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  const rows = [
    [t('工号', 'Staff ID'), details.staffId],
    [t('姓名', 'Name'), details.name],
    ['Agency', details.agency],
    [t('岗位', 'Position'), details.position],
    [t('离职原因', 'Reason'), details.reason]
  ];
  const isLight = themeMode === 'light';
  const overlayClass = isLight ? 'bg-slate-900/35' : 'bg-black/60';
  const panelClass = isLight
    ? 'border-slate-300 bg-white text-slate-900 shadow-[0_24px_80px_rgba(15,23,42,0.24)]'
    : 'border-emerald-400/35 bg-slate-950 text-slate-100 shadow-[0_24px_80px_rgba(0,0,0,0.55)]';
  const labelClass = isLight ? 'text-slate-500' : 'text-slate-500';
  const valueClass = isLight ? 'text-slate-800' : 'text-slate-200';
  const errorClass = isLight ? 'text-rose-700' : 'text-rose-300';

  return (
    <div
      className={['fixed inset-0 z-[125] flex items-center justify-center px-4 py-6 backdrop-blur-sm', overlayClass].join(' ')}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agency-termination-title"
        aria-busy={isSubmitting}
        className={['max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border p-5', panelClass].join(' ')}
      >
        <h2 id="agency-termination-title" className="font-display text-xl tracking-[0.08em]">
          {t('确认离职', 'Confirm Departure')}
        </h2>
        <dl className="mt-5 grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className={labelClass}>{label}</dt>
              <dd className={['min-w-0 whitespace-pre-wrap break-words', valueClass].join(' ')}>{value}</dd>
            </Fragment>
          ))}
        </dl>
        {error ? (
          <div role="alert" className={['mt-4 text-sm', errorClass].join(' ')}>
            {error}
          </div>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="admin-btn admin-btn-toolbar admin-btn-secondary px-4"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className="admin-btn admin-btn-toolbar admin-btn-primary px-4"
            disabled={isSubmitting}
            onClick={() => void onConfirm()}
          >
            {isSubmitting ? t('处理中', 'Processing') : t('确定', 'Confirm')}
          </button>
        </div>
      </section>
    </div>
  );
}
