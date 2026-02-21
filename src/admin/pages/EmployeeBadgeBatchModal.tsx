import { createPortal } from 'react-dom';

type TranslateFn = (zh: string, en: string) => string;

type EmployeeBadgePrintRow = {
  staff: string;
  name: string;
  agency: string;
  position: string;
  workAccount: string;
  workPassword: string;
};

type EmployeeBadgeBatchModalProps = {
  open: boolean;
  t: TranslateFn;
  employeesFiltered: any[];
  normalizeStaffId: (value: string) => string;
  employeeBadgeBatchSelectedStaffIds: string[];
  setEmployeeBadgeBatchSelectedStaffIds: (value: string[] | ((prev: string[]) => string[])) => void;
  setEmployeeBadgeBatchModalOpen: (open: boolean) => void;
  employeeBadgeBatchPrinting: boolean;
  setEmployeeBadgeBatchPrinting: (value: boolean) => void;
  printEmployeeBadgeCards: (rows: EmployeeBadgePrintRow[]) => Promise<void>;
  displayStaffId: (value: string) => string;
};

export default function EmployeeBadgeBatchModal({
  open,
  t,
  employeesFiltered,
  normalizeStaffId,
  employeeBadgeBatchSelectedStaffIds,
  setEmployeeBadgeBatchSelectedStaffIds,
  setEmployeeBadgeBatchModalOpen,
  employeeBadgeBatchPrinting,
  setEmployeeBadgeBatchPrinting,
  printEmployeeBadgeCards,
  displayStaffId
}: EmployeeBadgeBatchModalProps) {
  if (!open || typeof document === 'undefined') return null;

  const modalRows = employeesFiltered
    .map((e) => {
      const staff = normalizeStaffId(String(e.staff_id ?? '').trim());
      if (!staff) return null;
      return {
        staff,
        name: String(e.name ?? '').trim() || '-',
        agency: String(e.agency ?? e.Agency ?? '').trim() || '-',
        position: String(e.position ?? e.Position ?? '').trim() || '-',
        workAccount: String(e.work_account ?? e.WorkAccount ?? '').trim() || '-',
        workPassword: String(e.work_password ?? e.WorkPassword ?? '').trim() || '-'
      };
    })
    .filter(Boolean) as EmployeeBadgePrintRow[];

  const selectedSet = new Set(employeeBadgeBatchSelectedStaffIds);
  const selectedCount = modalRows.filter((r) => selectedSet.has(r.staff)).length;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-10">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950/95 p-5 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-neon">{t('批量生成工牌', 'Batch badges')}</div>
            <div className="mt-2 text-sm text-slate-300">{t('勾选需要打印的员工', 'Select employees to print')}</div>
          </div>
          <button
            type="button"
            onClick={() => setEmployeeBadgeBatchModalOpen(false)}
            className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
          >
            {t('关闭', 'Close')}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-400">{t(`已选择 ${selectedCount} / ${modalRows.length}`, `Selected ${selectedCount} / ${modalRows.length}`)}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEmployeeBadgeBatchSelectedStaffIds(modalRows.map((r) => r.staff))}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
            >
              {t('全选', 'Select all')}
            </button>
            <button
              type="button"
              onClick={() => setEmployeeBadgeBatchSelectedStaffIds([])}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
            >
              {t('清空', 'Clear')}
            </button>
          </div>
        </div>

        <div className="mt-3 max-h-[52vh] space-y-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-2">
          {modalRows.map((row) => {
            const checked = selectedSet.has(row.staff);
            return (
              <label
                key={row.staff}
                className={[
                  'flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 transition',
                  checked ? 'border-neon/50 bg-neon/10 text-neon' : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                ].join(' ')}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{row.name}</div>
                  <div className="text-xs text-slate-400">
                    {displayStaffId(row.staff)} · {row.position} · {row.agency}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setEmployeeBadgeBatchSelectedStaffIds((prev) =>
                      prev.includes(row.staff) ? prev.filter((id) => id !== row.staff) : [...prev, row.staff]
                    )
                  }
                  className="h-4 w-4 accent-lime-400"
                />
              </label>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setEmployeeBadgeBatchModalOpen(false)}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/15"
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={employeeBadgeBatchPrinting || selectedCount === 0}
            onClick={async () => {
              const selectedRows = modalRows.filter((r) => selectedSet.has(r.staff));
              if (selectedRows.length === 0) return;
              setEmployeeBadgeBatchPrinting(true);
              try {
                await printEmployeeBadgeCards(selectedRows);
                setEmployeeBadgeBatchModalOpen(false);
              } finally {
                setEmployeeBadgeBatchPrinting(false);
              }
            }}
            className="rounded-xl bg-neon px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
          >
            {employeeBadgeBatchPrinting ? t('生成中...', 'Generating...') : t('打印', 'Print')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

