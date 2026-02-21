import { createPortal } from 'react-dom';
import type { AuditRow } from '../types';

type TranslateFn = (zh: string, en: string) => string;

type EmployeeAuditModalProps = {
  open: boolean;
  t: TranslateFn;
  employeeAuditName: string;
  employeeAuditStaffId: string | null;
  employeeAuditLoading: boolean;
  employeeAuditError: string | null;
  employeeAuditRows: AuditRow[];
  setEmployeeAuditOpen: (open: boolean) => void;
  formatCellAuditTime: (value: string | null | undefined) => string;
  renderAuditSummary: (text: string) => any;
  formatAuditDetail: (row: AuditRow) => { summary: string; details: Array<{ label: string; value: string }> };
  displayStaffId: (value: string) => string;
};

export default function EmployeeAuditModal({
  open,
  t,
  employeeAuditName,
  employeeAuditStaffId,
  employeeAuditLoading,
  employeeAuditError,
  employeeAuditRows,
  setEmployeeAuditOpen,
  formatCellAuditTime,
  renderAuditSummary,
  formatAuditDetail,
  displayStaffId
}: EmployeeAuditModalProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-10">
      <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-950/95 p-5 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-cyan-300">{t('日志', 'Log')}</div>
            <div className="mt-2 text-sm text-slate-300">
              <span className="font-semibold text-white">{employeeAuditName || '-'}</span>
              <span className="ml-2 font-mono text-slate-400">{displayStaffId(String(employeeAuditStaffId ?? '')) || '-'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEmployeeAuditOpen(false)}
            className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
          >
            {t('关闭', 'Close')}
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {employeeAuditLoading ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-slate-300">
              {t('加载中...', 'Loading...')}
            </div>
          ) : (
            <>
              {employeeAuditError && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {t(`加载失败：${employeeAuditError}`, `Load failed: ${employeeAuditError}`)}
                </div>
              )}
              {employeeAuditRows.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-slate-300">
                  {t('暂无记录', 'No records')}
                </div>
              ) : (
                employeeAuditRows.map((item) => {
                  const detail = formatAuditDetail(item);
                  return (
                    <div
                      key={String(item.id ?? `${item.created_at ?? ''}_${item.action ?? ''}`)}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                    >
                      <div className="text-[11px] text-slate-400">
                        {formatCellAuditTime(item.created_at)} · {String(item.actor ?? '').trim() || '-'}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-100">{renderAuditSummary(detail.summary)}</div>
                      {detail.details.slice(0, 2).map((d, idx2) => (
                        <div key={`${String(item.id ?? 'row')}_${d.label}_${idx2}`} className="mt-1 text-xs">
                          <div className="whitespace-normal break-words text-slate-200">{renderAuditSummary(`${d.label}: ${d.value}`)}</div>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
