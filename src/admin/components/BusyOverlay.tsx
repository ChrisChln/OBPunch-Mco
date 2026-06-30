type TranslateFn = (zh: string, en: string) => string;

type BusyOverlayProps = {
  visible: boolean;
  themeMode: 'light' | 'dark';
  t: TranslateFn;
  titleZh?: string;
  titleEn?: string;
  detailZh?: string;
  detailEn?: string;
  progress?: number | null;
};

export default function BusyOverlay({
  visible,
  themeMode,
  t,
  titleZh = '处理中...',
  titleEn = 'Processing...',
  detailZh,
  detailEn,
  progress = null
}: BusyOverlayProps) {
  if (!visible) return null;
  const hasProgress = typeof progress === 'number' && Number.isFinite(progress);
  const progressValue = hasProgress ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 backdrop-blur-sm">
      <div
        className={[
          'w-full max-w-sm rounded-[28px] border px-6 py-5 shadow-2xl',
          themeMode === 'light' ? 'border border-slate-300 bg-white text-slate-900' : 'glass text-slate-100'
        ].join(' ')}
      >
        <div className="flex items-center gap-4">
          <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <span className="absolute inset-1 rounded-xl border border-neon/20" />
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-neon/20 border-t-neon" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-[0.18em] text-slate-200/80">
              {t(titleZh, titleEn)}
            </div>
            <div className="mt-1 flex items-center gap-3">
              {detailZh && detailEn ? (
                <div className="min-w-0 flex-1 truncate text-sm text-slate-300/75">{t(detailZh, detailEn)}</div>
              ) : null}
              {hasProgress ? (
                <div className={['shrink-0 text-xs font-semibold tabular-nums', themeMode === 'light' ? 'text-slate-500' : 'text-slate-300/75'].join(' ')}>
                  {progressValue}%
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div
          className={[
            'mt-4 h-1.5 overflow-hidden rounded-full',
            themeMode === 'light' ? 'bg-slate-200' : 'bg-white/18'
          ].join(' ')}
          role="progressbar"
          aria-label={t(titleZh, titleEn)}
          aria-valuemin={hasProgress ? 0 : undefined}
          aria-valuemax={hasProgress ? 100 : undefined}
          aria-valuenow={hasProgress ? progressValue : undefined}
        >
          <span
            className={['block h-full rounded-full bg-neon/85 shadow-[0_0_16px_rgba(34,211,238,0.45)] transition-[width] duration-300 ease-out', hasProgress ? '' : 'w-[36%] animate-pulse'].join(' ')}
            style={hasProgress ? { width: `${progressValue}%` } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
