type TranslateFn = (zh: string, en: string) => string;

type AuditPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  isReadOnly?: boolean;
  auditSearch: string;
  setAuditSearch: (value: string) => void;
  fetchAudit: (params: { search: string }) => void | Promise<void>;
  auditError: string | null;
  auditRows: any[];
  AUDIT_TABLE: string;
  formatAuditDetail: (row: any) => { summary: string; details: Array<{ label: string; value: string }> };
  renderAuditSummary: (summary: string) => any;
  formatAuditActionLabel: (action: string) => string;
  resolveAuditStaffName: (staffId: string) => string;
  formatAuditCreatedAt: (value: string | null | undefined) => string;
  resolveAuditBusinessDate: (row: any) => string;
  canUndoAuditRow: (row: any) => boolean;
  isAuditRowUndone: (row: any) => boolean;
  undoAuditRow: (row: any) => void | Promise<void>;
};

export default function AuditPage({
  t,
  isLocked,
  isReadOnly = false,
  auditSearch,
  setAuditSearch,
  fetchAudit,
  auditError,
  auditRows,
  AUDIT_TABLE,
  formatAuditDetail,
  renderAuditSummary,
  formatAuditActionLabel,
  resolveAuditStaffName,
  formatAuditCreatedAt,
  resolveAuditBusinessDate,
  canUndoAuditRow,
  isAuditRowUndone,
  undoAuditRow
}: AuditPageProps) {
  const writeLocked = isLocked || isReadOnly;
  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('日志', 'Log')}</h2>
        <button
          type="button"
          disabled={isLocked}
          onClick={() => void fetchAudit({ search: auditSearch })}
          className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t('刷新', 'Refresh')}
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
          <input
            value={auditSearch}
            onChange={(e) => setAuditSearch(e.target.value)}
            disabled={isLocked}
            placeholder={t('通过工号、员工名、操作者或动作搜索', 'Search by staff id, employee name, actor, or action')}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div className="flex items-end gap-3">
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void fetchAudit({ search: auditSearch })}
            className="h-12 flex-1 rounded-2xl bg-neon px-6 text-base font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('查询', 'Search')}
          </button>
          <button
            type="button"
            disabled={isLocked || auditSearch.trim().length === 0}
            onClick={() => {
              setAuditSearch('');
              void fetchAudit({ search: '' });
            }}
            className="h-12 flex-1 rounded-2xl bg-white/10 px-6 text-base font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('清空', 'Clear')}
          </button>
        </div>
      </div>

      {auditError && (
        <p className="mt-3 text-sm text-ember">
          {t('加载失败：', 'Load failed: ')}
          {auditError}
          <span className="ml-2 text-xs text-slate-400">
            {t('（需要表：', '(Need table: ')}
            {AUDIT_TABLE}
            {t('）', ')')}
          </span>
        </p>
      )}

      {!auditError && auditRows.length === 0 && <p className="mt-3 text-sm text-slate-400">{t('暂无日志。', 'No audit records.')}</p>}

      {!auditError && auditRows.length > 0 && (
        <div className="mt-4 space-y-3">
          {auditRows.map((row, idx) => {
            const id = String(row.id ?? idx);
            const at = formatAuditCreatedAt(row.created_at);
            const actor = String(row.actor ?? '').trim() || '-';
            const action = String(row.action ?? '').trim() || '-';
            const staff = String(row.staff_id ?? '').trim() || '-';
            const staffName = staff !== '-' ? resolveAuditStaffName(staff) : '';
            const target = String(row.target ?? '').trim() || '-';
            const businessDate = resolveAuditBusinessDate(row);
            const auditDetail = formatAuditDetail(row);
            const undoable = canUndoAuditRow(row);
            const undone = isAuditRowUndone(row);

            return (
              <div key={id} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-200">
                        {formatAuditActionLabel(action)}
                      </span>
                      {staff !== '-' && (
                        <span className="rounded-full bg-neon/10 px-2 py-0.5 text-[11px] font-medium text-neon">
                          {staffName ? `${staffName} (${staff})` : staff}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">{target}</span>
                    </div>

                    <div className="mt-2 text-sm text-slate-100">{renderAuditSummary(auditDetail.summary)}</div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span>
                        {t('操作者：', 'Actor: ')}
                        <span className="text-slate-200">{actor}</span>
                      </span>
                      {businessDate && (
                        <span>
                          {t('日期：', 'Date: ')}
                          <span className="text-slate-200">{businessDate}</span>
                        </span>
                      )}
                      <span>
                        {t('时间：', 'Time: ')}
                        <span className="text-slate-200">{at || '-'}</span>
                      </span>
                    </div>
                  </div>

                  {undoable && (
                    <button
                      type="button"
                      disabled={writeLocked || undone}
                      onClick={() => void undoAuditRow(row)}
                      className={`rounded-xl px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        undone
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                      }`}
                    >
                      {undone ? t('已撤销', 'Undone') : t('撤销', 'Undo')}
                    </button>
                  )}
                </div>

                {auditDetail.details.length > 0 && (
                  <div className="mt-3 grid gap-2 rounded-2xl bg-black/10 px-3 py-3 text-xs">
                    {auditDetail.details.map((item, detailIdx) => (
                      <div key={`${id}-detail-${detailIdx}`} className="grid gap-1 md:grid-cols-[120px_1fr] md:items-start">
                        <span className="text-slate-500">{item.label}</span>
                        <span className="break-words text-slate-100">{item.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
