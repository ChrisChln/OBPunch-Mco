import { createPortal } from 'react-dom';
import { useEffect, useMemo } from 'react';

type AppDialogProps = {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  tone?: 'neutral' | 'danger';
  themeMode?: 'dark' | 'light';
};

export default function AppDialog({
  open,
  title = '提示',
  message,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  onCancel,
  tone = 'neutral',
  themeMode
}: AppDialogProps) {
  if (!open || typeof document === 'undefined') return null;

  useEffect(() => {
    if (!open || !onCancel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  const mode = useMemo<'dark' | 'light'>(() => {
    if (themeMode) return themeMode;
    if (typeof document !== 'undefined') {
      const bodyTheme = String(document.body?.dataset?.theme ?? '').trim().toLowerCase();
      if (bodyTheme === 'light') return 'light';
      if (bodyTheme === 'dark') return 'dark';
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }, [themeMode]);

  const panelClass =
    mode === 'light'
      ? 'border-slate-300 bg-white text-slate-900 shadow-[0_20px_60px_rgba(15,23,42,0.22)]'
      : 'border-emerald-400/35 bg-slate-950/95 text-slate-100 shadow-[0_0_0_1px_rgba(16,185,129,0.2),0_20px_60px_rgba(2,6,23,0.75)]';
  const titleClass = mode === 'light' ? 'text-slate-900' : 'text-slate-100';
  const messageClass = mode === 'light' ? 'text-slate-700' : 'text-slate-200';
  const cancelClass =
    mode === 'light'
      ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      : 'bg-white/10 text-slate-200 hover:bg-white/15';
  const confirmClass =
    tone === 'danger'
      ? mode === 'light'
        ? 'bg-rose-600 text-white hover:bg-rose-500'
        : 'bg-rose-600 text-white hover:bg-rose-500'
      : mode === 'light'
        ? 'bg-emerald-500 text-white hover:bg-emerald-400'
        : 'bg-neon text-ink shadow-glow hover:-translate-y-0.5';

  return createPortal(
    <div
      className={[
        'fixed inset-0 z-[120] flex items-center justify-center px-4',
        mode === 'light' ? 'bg-slate-900/35' : 'bg-black/55'
      ].join(' ')}
      onClick={() => onCancel?.()}
    >
      <div
        className={['w-full max-w-[520px] rounded-2xl border p-5 backdrop-blur transition', panelClass].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={['text-2xl font-semibold', titleClass].join(' ')}>{title}</div>
        <div className={['mt-3 whitespace-pre-wrap text-base', messageClass].join(' ')}>{message}</div>
        <div className="mt-6 flex justify-end gap-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className={['rounded-2xl px-5 py-2 text-sm font-semibold transition', cancelClass].join(' ')}
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={['rounded-2xl px-5 py-2 text-sm font-semibold transition', confirmClass].join(' ')}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
