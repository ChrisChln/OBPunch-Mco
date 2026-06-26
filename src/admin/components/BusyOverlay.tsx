type TranslateFn = (zh: string, en: string) => string;

type BusyOverlayProps = {
  visible: boolean;
  themeMode: 'light' | 'dark';
  t: TranslateFn;
  titleZh?: string;
  titleEn?: string;
  detailZh?: string;
  detailEn?: string;
};

export default function BusyOverlay({
  visible,
  themeMode,
  t,
  titleZh = '处理中...',
  titleEn = 'Processing...',
  detailZh,
  detailEn
}: BusyOverlayProps) {
  if (!visible) return null;
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
            {detailZh && detailEn ? (
              <div className="mt-1 text-sm text-slate-300/75">{t(detailZh, detailEn)}</div>
            ) : null}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <span className="h-1.5 rounded-full bg-neon/80 shadow-[0_0_16px_rgba(34,211,238,0.45)] animate-pulse" />
          <span
            className="h-1.5 rounded-full bg-white/30 animate-pulse"
            style={{ animationDelay: '120ms' }}
          />
          <span
            className="h-1.5 rounded-full bg-white/15 animate-pulse"
            style={{ animationDelay: '240ms' }}
          />
        </div>
      </div>
    </div>
  );
}
