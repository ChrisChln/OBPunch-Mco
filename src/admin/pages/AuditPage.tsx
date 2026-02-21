type TranslateFn = (zh: string, en: string) => string;

type AuditPageProps = {
  t: TranslateFn;
  locale: string;
  isLocked: boolean;
  auditSearch: string;
  setAuditSearch: (value: string) => void;
  fetchAudit: (params: { search: string }) => void | Promise<void>;
  auditError: string | null;
  auditRows: any[];
  AUDIT_TABLE: string;
  formatAuditDetail: (row: any) => { summary: string; details: Array<{ label: string; value: string }> };
};

export default function AuditPage({
  t,
  locale,
  isLocked,
  auditSearch,
  setAuditSearch,
  fetchAudit,
  auditError,
  auditRows,
  AUDIT_TABLE,
  formatAuditDetail
}: AuditPageProps) {
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
            placeholder={t('通过工号搜索', 'Search by staff id / actor / action')}
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
            {t('（需要创建表：', '(Need table: ')}
            {AUDIT_TABLE}
            {t('）', ')')}
          </span>
        </p>
      )}

      {!auditError && auditRows.length === 0 && <p className="mt-3 text-sm text-slate-400">{t('暂无日志。', 'No audit records.')}</p>}

      {!auditError && auditRows.length > 0 && (
        <div className="mt-4 space-y-2">
          {auditRows.map((r, idx) => {
            const id = String(r.id ?? idx);
            const at = r.created_at ? new Date(r.created_at).toLocaleString(locale, { hour12: false }) : '';
            const actor = String(r.actor ?? '').trim() || '-';
            const action = String(r.action ?? '').trim() || '-';
            const staff = String(r.staff_id ?? '').trim() || '-';
            const target = String(r.target ?? '').trim() || '-';
            const auditDetail = formatAuditDetail(r);

            return (
              <div key={id} className="rounded-2xl bg-white/5 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-200">
                      {action}
                    </span>
                    <span className="text-sm text-slate-200">{auditDetail.summary}</span>
                    <span className="text-sm text-slate-200">
                      {t('工号：', 'Staff: ')}
                      <span className="font-mono">{staff}</span>
                    </span>
                    <span className="text-xs text-slate-400">
                      {t('操作者：', 'Actor: ')}
                      {actor}
                    </span>
                    <span className="text-xs text-slate-500">
                      {t('目标：', 'Target: ')}
                      {target}
                    </span>
                  </div>
                  <div className="text-right text-xs text-slate-400">{at}</div>
                </div>
                {auditDetail.details.length > 0 && (
                  <div className="mt-2 grid gap-1 text-xs text-slate-400">
                    {auditDetail.details.map((item, detailIdx) => (
                      <div key={`${id}-detail-${detailIdx}`} className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-500">{item.label}</span>
                        <span className="text-slate-200">{item.value}</span>
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

