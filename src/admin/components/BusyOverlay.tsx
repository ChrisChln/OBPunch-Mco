type TranslateFn = (zh: string, en: string) => string;

type BusyOverlayProps = {
  visible: boolean;
  themeMode: 'light' | 'dark';
  t: TranslateFn;
};

export default function BusyOverlay({ visible, themeMode, t }: BusyOverlayProps) {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 backdrop-blur-sm">
      <div
        className={[
          'flex items-center gap-3 rounded-2xl px-5 py-4 shadow-2xl',
          themeMode === 'light' ? 'border border-slate-300 bg-white text-slate-900' : 'glass text-slate-100'
        ].join(' ')}
      >
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-neon/25 border-t-neon" />
        <span className="text-sm font-semibold">{t('处理中...', 'Processing...')}</span>
      </div>
    </div>
  );
}

