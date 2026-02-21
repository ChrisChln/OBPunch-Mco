import { createPortal } from 'react-dom';

type TranslateFn = (zh: string, en: string) => string;

type EmployeeBadgePreview = {
  staff: string;
  name: string;
  agency: string;
  position: string;
  qrDataUrl: string;
};

type EmployeeBadgePreviewModalProps = {
  preview: EmployeeBadgePreview | null;
  t: TranslateFn;
  close: () => void;
};

export default function EmployeeBadgePreviewModal({ preview, t, close }: EmployeeBadgePreviewModalProps) {
  if (!preview || typeof document === 'undefined') return null;

  return createPortal(
    <div className="employee-badge-print-host">
      <style>{`
        @page { size: 4in 6in; margin: 0; }
        @media print {
          html, body {
            width: 4in !important;
            height: 6in !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }
          body > * { display: none !important; }
          .employee-badge-print-host {
            display: block !important;
            position: fixed !important;
            inset: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            z-index: 9999 !important;
          }
          .employee-badge-sheet-wrap {
            width: 4in !important;
            height: 6in !important;
            margin: 0 !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
          }
          .employee-badge-preview-overlay {
            display: block !important;
            position: fixed !important;
            inset: 0 !important;
            background: #fff !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .employee-badge-preview-chrome { display: none !important; }
          .employee-badge-preview-canvas {
            overflow: visible !important;
            border: none !important;
            background: transparent !important;
            padding: 0 !important;
          }
          .employee-badge-preview-scale {
            transform: none !important;
            margin: 0 !important;
          }
        }
      `}</style>
      <div className="employee-badge-preview-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-10">
        <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950/95 p-5 shadow-2xl backdrop-blur">
          <div className="mb-4 flex items-center justify-between employee-badge-preview-chrome">
            <h3 className="font-display text-xl tracking-[0.08em] text-white">{t('打印临时工牌', 'Print Temp Badge')}</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.setTimeout(() => window.print(), 80)}
                className="rounded-xl bg-neon px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-xl"
              >
                {t('打印', 'Print')}
              </button>
              <button
                type="button"
                onClick={close}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/15"
              >
                {t('关闭', 'Close')}
              </button>
            </div>
          </div>
          <p className="mb-4 text-xs text-slate-400 employee-badge-preview-chrome">{t('打印尺寸：4 x 6 inch 标签纸。', 'Print size: 4 x 6 inch label.')}</p>
          <div className="overflow-auto rounded-2xl border border-white/10 bg-black/20 p-4 employee-badge-preview-canvas">
            <div className="mx-auto origin-top scale-[0.52] md:scale-[0.66] employee-badge-preview-scale">
              <div
                className="employee-badge-sheet-wrap"
                style={{
                  width: '4in',
                  height: '6in',
                  background: '#fff',
                  color: '#111',
                  fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
                  padding: '0.14in 0.16in',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.1in',
                  boxSizing: 'border-box',
                  overflow: 'hidden'
                }}
              >
                <div style={{ textAlign: 'center', fontSize: '16pt', fontWeight: 800, letterSpacing: '0.04em' }}>TEMP BADGE</div>
                <div
                  style={{
                    height: '2.85in',
                    border: '2px solid #111',
                    borderRadius: '10px',
                    padding: '0.07in',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box'
                  }}
                >
                  <img src={preview.qrDataUrl} alt={`QR Code for ${preview.staff}`} style={{ width: '100%', maxWidth: '2.55in', height: 'auto' }} />
                </div>
                <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '20pt', letterSpacing: '0.04em' }}>{preview.staff}</div>
                <div
                  style={{
                    border: '2px solid #111',
                    borderRadius: '10px',
                    padding: '0.08in 0.1in',
                    display: 'grid',
                    gap: '0.06in',
                    boxSizing: 'border-box'
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '0.78in 1fr', alignItems: 'baseline', gap: '0.05in' }}>
                    <div style={{ fontSize: '9pt', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Name</div>
                    <div style={{ fontSize: '12.5pt', fontWeight: 700, lineHeight: 1.1, wordBreak: 'break-word' }}>{preview.name || '-'}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '0.78in 1fr', alignItems: 'baseline', gap: '0.05in' }}>
                    <div style={{ fontSize: '9pt', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Position</div>
                    <div style={{ fontSize: '12.5pt', fontWeight: 700, lineHeight: 1.1, wordBreak: 'break-word' }}>{preview.position || '-'}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '0.78in 1fr', alignItems: 'baseline', gap: '0.05in' }}>
                    <div style={{ fontSize: '9pt', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Agency</div>
                    <div style={{ fontSize: '12.5pt', fontWeight: 700, lineHeight: 1.1, wordBreak: 'break-word' }}>{preview.agency || '-'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

