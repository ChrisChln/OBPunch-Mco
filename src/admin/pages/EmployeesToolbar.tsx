import type { RefObject } from 'react';

type TranslateFn = (zh: string, en: string) => string;

type EmployeesToolbarProps = {
  t: TranslateFn;
  isLocked: boolean;
  employeeBadgeBatchPrinting: boolean;
  employeesFiltered: any[];
  normalizeStaffId: (value: string) => string;
  setEmployeeBadgeBatchSelectedStaffIds: (value: string[]) => void;
  setEmployeeBadgeBatchModalOpen: (value: boolean) => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelected: (file: File | null) => void | Promise<void>;
  uploadEmployees: () => void | Promise<void>;
  exportEmployees: () => void | Promise<void>;
  employeeAddOpen: boolean;
  setEmployeeAddOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  fetchEmployees: (arg: { reset: boolean; search?: string; agency?: string; position?: string; labels?: string[] }) => void | Promise<unknown>;
  setEmployeeSearch: (value: string) => void;
  setEmployeeAgency: (value: string) => void;
  setEmployeePosition: (value: string) => void;
  setEmployeeShiftFilter: (value: '' | 'early' | 'late') => void;
  setEmployeeLabels: (value: string[] | ((prev: string[]) => string[])) => void;
  uploadError: string | null;
  employeeSearch: string;
  employeeAgency: string;
  employeeAgencyOptions: string[];
  employeePosition: string;
  employeePositionOptions: string[];
  employeeShiftFilter: '' | 'early' | 'late';
  employeeLabels: string[];
  employeeFilterLabelOptions: string[];
  getScheduleLabelToneClass: (label: string) => string;
  cycleScheduleLabelTone: (label: string) => void;
};

export default function EmployeesToolbar({
  t,
  isLocked,
  employeeBadgeBatchPrinting,
  employeesFiltered,
  normalizeStaffId,
  setEmployeeBadgeBatchSelectedStaffIds,
  setEmployeeBadgeBatchModalOpen,
  fileInputRef,
  onFileSelected,
  uploadEmployees,
  exportEmployees,
  employeeAddOpen,
  setEmployeeAddOpen,
  fetchEmployees,
  setEmployeeSearch,
  setEmployeeAgency,
  setEmployeePosition,
  setEmployeeShiftFilter,
  setEmployeeLabels,
  uploadError,
  employeeSearch,
  employeeAgency,
  employeeAgencyOptions,
  employeePosition,
  employeePositionOptions,
  employeeShiftFilter,
  employeeLabels,
  employeeFilterLabelOptions,
  getScheduleLabelToneClass,
  cycleScheduleLabelTone
}: EmployeesToolbarProps) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('员工信息', 'Employees')}</h2>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            disabled={isLocked || employeeBadgeBatchPrinting || employeesFiltered.length === 0}
            onClick={() => {
              const allStaff = Array.from(
                new Set(
                  employeesFiltered
                    .map((e) => normalizeStaffId(String(e.staff_id ?? '').trim()))
                    .filter(Boolean)
                )
              );
              setEmployeeBadgeBatchSelectedStaffIds(allStaff);
              setEmployeeBadgeBatchModalOpen(true);
            }}
            className="rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
          >
            {employeeBadgeBatchPrinting ? t('生成中...', 'Generating...') : t('批量生成工牌', 'Batch badges')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            disabled={isLocked}
            onChange={async (e) => {
              const file = e.target.files?.[0] ?? null;
              await onFileSelected(file);
              if (file) await uploadEmployees();
              e.currentTarget.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            disabled={isLocked}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('导入', 'Import')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void exportEmployees()}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('导出', 'Export')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => setEmployeeAddOpen((prev) => !prev)}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {employeeAddOpen ? t('隐藏新增', 'Hide add') : t('新增员工', 'Add employee')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void fetchEmployees({ reset: true })}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('刷新', 'Refresh')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => {
              setEmployeeSearch('');
              setEmployeeAgency('');
              setEmployeePosition('');
              setEmployeeShiftFilter('');
              setEmployeeLabels([]);
              void fetchEmployees({ reset: true, search: '', agency: '', position: '', labels: [] });
            }}
            className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('清空筛选', 'Clear filters')}
          </button>
        </div>
      </div>
      {uploadError && <p className="mt-3 text-sm text-ember">{uploadError}</p>}

      <div className="mt-5 grid gap-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
          <input
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
            disabled={isLocked}
            placeholder={t('通过ID/名字/标签搜索', 'Search by id / name / label')}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Agency</label>
          <select
            value={employeeAgency}
            onChange={(e) => setEmployeeAgency(e.target.value)}
            disabled={isLocked}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">{t('全部Agency', 'All agencies')}</option>
            {employeeAgencyOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Position</label>
          <select
            value={employeePosition}
            onChange={(e) => setEmployeePosition(e.target.value)}
            disabled={isLocked}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">{t('全部岗位', 'All positions')}</option>
            {employeePositionOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('班次', 'Shift')}</label>
          <select
            value={employeeShiftFilter}
            onChange={(e) => setEmployeeShiftFilter((e.target.value as '' | 'early' | 'late') ?? '')}
            disabled={isLocked}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">{t('全部班次', 'All shifts')}</option>
            <option value="early">{t('白班', 'Day')}</option>
            <option value="late">{t('晚班', 'Night')}</option>
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('标签', 'Label')}</label>
          <details className="relative mt-2">
            <summary
              className={[
                'flex h-[46px] cursor-pointer list-none items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition',
                'hover:border-white/20',
                isLocked ? 'pointer-events-none cursor-not-allowed opacity-60' : ''
              ].join(' ')}
            >
              <span className="truncate">
                {employeeLabels.length === 0
                  ? t('选择标签', 'Select labels')
                  : employeeLabels.length <= 2
                    ? employeeLabels.join(', ')
                    : `${employeeLabels.slice(0, 2).join(', ')} +${employeeLabels.length - 2}`}
              </span>
              <span className="ml-3 text-xs text-slate-400">{employeeLabels.length}</span>
            </summary>
            <div className="absolute z-30 mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
              <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
                <span>{t('可多选', 'Multi-select')}</span>
                <button
                  type="button"
                  disabled={isLocked || employeeLabels.length === 0}
                  onClick={(e) => {
                    e.preventDefault();
                    setEmployeeLabels([]);
                  }}
                  className="rounded-md bg-white/10 px-2 py-1 text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('清空', 'Clear')}
                </button>
              </div>
              <div className="max-h-56 space-y-1 overflow-auto pr-1">
                {employeeFilterLabelOptions.length === 0 ? (
                  <p className="rounded-lg bg-white/5 px-2 py-2 text-xs text-slate-400">{t('暂无标签', 'No labels')}</p>
                ) : (
                  employeeFilterLabelOptions.map((item) => {
                    const checked = employeeLabels.includes(item);
                    return (
                      <label
                        key={item}
                        className={[
                          'flex cursor-pointer items-center justify-between rounded-lg border px-2 py-1.5 text-sm transition',
                          checked ? 'border-neon/50 bg-neon/10 text-neon' : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                        ].join(' ')}
                      >
                        <span className={['inline-flex max-w-[62%] items-center truncate rounded-full border px-2 py-0.5 text-xs font-semibold', getScheduleLabelToneClass(item)].join(' ')}>
                          {item}
                        </span>
                        <div className="ml-2 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              cycleScheduleLabelTone(item);
                            }}
                            className={['rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', getScheduleLabelToneClass(item)].join(' ')}
                            title={t('切换标签颜色', 'Cycle label color')}
                          >
                            {t('颜色', 'Color')}
                          </button>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setEmployeeLabels((prev) => (prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]))}
                            className="h-3.5 w-3.5 accent-lime-400"
                          />
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </details>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isLocked}
          onClick={() => void fetchEmployees({ reset: true })}
          className="rounded-2xl bg-neon px-5 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('搜索', 'Search')}
        </button>
      </div>
    </>
  );
}
