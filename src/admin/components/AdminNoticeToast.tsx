import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type AdminNoticeTone = 'idle' | 'success' | 'error';

type AdminNoticeToastProps = {
  open: boolean;
  tone: AdminNoticeTone;
  message: string;
  themeMode: 'light' | 'dark';
  onClose?: () => void;
};

export default function AdminNoticeToast({ open, tone, message, themeMode, onClose }: AdminNoticeToastProps) {
  if (!open || tone === 'idle' || !message) return null;

  const isLight = themeMode === 'light';
  const toneClass =
    tone === 'success'
      ? isLight
        ? 'border-emerald-200 bg-emerald-50/95 text-emerald-800 shadow-[0_18px_38px_rgba(16,185,129,0.18)]'
        : 'border-emerald-500/30 bg-emerald-500/12 text-emerald-100 shadow-[0_18px_38px_rgba(5,150,105,0.2)]'
      : tone === 'error'
        ? isLight
          ? 'border-rose-200 bg-rose-50/95 text-rose-800 shadow-[0_18px_38px_rgba(244,63,94,0.16)]'
          : 'border-rose-500/30 bg-rose-500/12 text-rose-100 shadow-[0_18px_38px_rgba(190,24,93,0.24)]'
        : isLight
          ? 'border-slate-200 bg-white/95 text-slate-700 shadow-[0_18px_38px_rgba(15,23,42,0.1)]'
          : 'border-slate-700/80 bg-slate-900/95 text-slate-200 shadow-[0_18px_38px_rgba(2,6,23,0.4)]';
  const iconClass =
    tone === 'success' ? 'text-emerald-500' : tone === 'error' ? 'text-rose-400' : isLight ? 'text-slate-500' : 'text-slate-300';
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertTriangle : Info;

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[140] max-w-[min(34rem,calc(100vw-2rem))]">
      <div className={['pointer-events-auto rounded-2xl border px-4 py-3 text-sm leading-6 backdrop-blur', toneClass].join(' ')}>
        <div className="flex items-start gap-3">
          <Icon className={['mt-0.5 h-4 w-4 shrink-0', iconClass].join(' ')} />
          <div className="min-w-0 flex-1 whitespace-pre-wrap font-medium">{message}</div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className={['-mr-1 rounded-lg p-1 transition', isLight ? 'hover:bg-slate-900/5' : 'hover:bg-white/10'].join(' ')}
              aria-label="Close notice"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
