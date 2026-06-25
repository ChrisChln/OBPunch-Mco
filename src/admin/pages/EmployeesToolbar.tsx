import { useEffect, useRef, type RefObject } from 'react';

import { MagicMultiSelect } from '../../components/MagicSelectControls';

type TranslateFn = (zh: string, en: string) => string;

type EmployeesToolbarProps = {
  t: TranslateFn;
  themeMode: 'light' | 'dark';
  isLocked: boolean;
  isReadOnly?: boolean;
  employeeBadgeBatchPrinting: boolean;
  employeeBadgeBatchSelectedStaffIds: string[];
  onPrintSelectedBadgeBatch: () => void | Promise<void>;
  setEmployeeBadgeBatchSelectedStaffIds: (value: string[] | ((prev: string[]) => string[])) => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelected: (file: File | null) => void | Promise<void>;
  uploadEmployees: () => void | Promise<void>;
  exportEmployees: () => void | Promise<void>;
  setEmployeeAddOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  openDepartedEmployees: () => void | Promise<void>;
  fetchEmployees: (arg: { reset: boolean; search?: string; agency?: string; position?: string; labels?: string[] }) => void | Promise<unknown>;
  setEmployeeSearch: (value: string) => void;
  setEmployeeAgency: (value: string[] | ((prev: string[]) => string[])) => void;
  setEmployeeDepartment: (value: string[] | ((prev: string[]) => string[])) => void;
  setEmployeePosition: (value: string[] | ((prev: string[]) => string[])) => void;
  setEmployeeShiftFilter: (value: Array<'early' | 'late'> | ((prev: Array<'early' | 'late'>) => Array<'early' | 'late'>)) => void;
  setEmployeeLabels: (value: string[] | ((prev: string[]) => string[])) => void;
  uploadError: string | null;
  employeeSearch: string;
  employeeAgency: string[];
  employeeAgencyOptions: string[];
  employeeDepartment: string[];
  employeeDepartmentOptions: Array<{ value: string; label: string }>;
  employeePosition: string[];
  employeePositionOptions: string[];
  employeeShiftFilter: Array<'early' | 'late'>;
  employeeLabels: string[];
  employeeFilterLabelOptions: string[];
  getSchedulePositionBadgeClass: (position: string) => string;
  getScheduleLabelToneClass: (label: string) => string;
  cycleScheduleLabelTone: (label: string) => void;
};

type EmployeeMultiSelectOption<Value extends string = string> = {
  value: Value;
  label: string;
  badgeClass?: string;
};

function EmployeeMultiSelect<Value extends string>({
  label,
  allLabel,
  selected,
  options,
  onChange,
  disabled,
  isLight
}: {
  label: string;
  allLabel: string;
  selected: Value[];
  options: readonly EmployeeMultiSelectOption<Value>[];
  onChange: (value: Value[]) => void;
  disabled: boolean;
  isLight: boolean;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{label}</label>
      <MagicMultiSelect
        selected={selected}
        options={options}
        onChange={onChange}
        allLabel={allLabel}
        disabled={disabled}
        tone={isLight ? 'light' : 'dark'}
        className="mt-2"
      />
    </div>
  );
}

export default function EmployeesToolbar({
  t,
  themeMode,
  isLocked,
  isReadOnly = false,
  employeeBadgeBatchPrinting,
  employeeBadgeBatchSelectedStaffIds,
  onPrintSelectedBadgeBatch,
  setEmployeeBadgeBatchSelectedStaffIds,
  fileInputRef,
  onFileSelected,
  uploadEmployees,
  exportEmployees,
  setEmployeeAddOpen,
  openDepartedEmployees,
  fetchEmployees,
  setEmployeeSearch,
  setEmployeeAgency,
  setEmployeeDepartment,
  setEmployeePosition,
  setEmployeeShiftFilter,
  setEmployeeLabels,
  uploadError,
  employeeSearch,
  employeeAgency,
  employeeAgencyOptions,
  employeeDepartment,
  employeeDepartmentOptions,
  employeePosition,
  employeePositionOptions,
  employeeShiftFilter,
  employeeLabels,
  employeeFilterLabelOptions,
  getSchedulePositionBadgeClass,
  getScheduleLabelToneClass,
  cycleScheduleLabelTone
}: EmployeesToolbarProps) {
  const isLight = themeMode === 'light';
  const writeLocked = isLocked || isReadOnly;
  const labelDetailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const root = labelDetailsRef.current;
      if (!root || !root.open) return;
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      root.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const root = labelDetailsRef.current;
      if (!root || !root.open) return;
      root.open = false;
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl tracking-[0.08em]">{t('员工信息', 'Employees')}</h2>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-2 sm:justify-end">
          <button
            type="button"
            disabled={isLocked || employeeBadgeBatchPrinting || employeeBadgeBatchSelectedStaffIds.length === 0}
            onClick={() => void onPrintSelectedBadgeBatch()}
            className="admin-btn admin-btn-toolbar admin-btn-primary inline-flex items-center justify-center px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {employeeBadgeBatchPrinting
              ? t('生成中...', 'Generating...')
              : t(`批量生成工牌 (${employeeBadgeBatchSelectedStaffIds.length})`, `Print selected badges (${employeeBadgeBatchSelectedStaffIds.length})`)}
          </button>
          <button
            type="button"
            disabled={isLocked || employeeBadgeBatchPrinting || employeeBadgeBatchSelectedStaffIds.length === 0}
            onClick={() => setEmployeeBadgeBatchSelectedStaffIds([])}
            className="admin-btn admin-btn-toolbar admin-btn-secondary inline-flex items-center justify-center px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('清空已选', 'Clear selected')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            disabled={writeLocked}
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
            disabled={writeLocked}
            onClick={() => fileInputRef.current?.click()}
            className="admin-btn admin-btn-toolbar admin-btn-secondary inline-flex items-center justify-center px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('导入', 'Import')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void exportEmployees()}
            className="admin-btn admin-btn-toolbar admin-btn-secondary inline-flex items-center justify-center px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('导出', 'Export')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void openDepartedEmployees()}
            className="admin-btn admin-btn-toolbar admin-btn-secondary inline-flex items-center justify-center px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('离职员工', 'Departed')}
          </button>
          <button
            type="button"
            disabled={writeLocked}
            onClick={() => setEmployeeAddOpen(true)}
            className="admin-btn admin-btn-toolbar admin-btn-secondary inline-flex items-center justify-center px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('新增员工', 'Add employee')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => void fetchEmployees({ reset: true })}
            className="admin-btn admin-btn-toolbar admin-btn-secondary inline-flex items-center justify-center px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('刷新', 'Refresh')}
          </button>
          <button
            type="button"
            disabled={isLocked}
            onClick={() => {
              setEmployeeSearch('');
              setEmployeeAgency([]);
              setEmployeeDepartment([]);
              setEmployeePosition([]);
              setEmployeeShiftFilter([]);
              setEmployeeLabels([]);
              void fetchEmployees({ reset: true, search: '', agency: '', position: '', labels: [] });
            }}
            className="admin-btn admin-btn-toolbar admin-btn-secondary inline-flex items-center justify-center px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('清空筛选', 'Clear filters')}
          </button>
        </div>
      </div>
      {uploadError && <p className="mt-3 text-sm text-ember">{uploadError}</p>}

      <div className="mt-5 grid gap-4 md:grid-cols-7">
        <div className="md:col-span-2">
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Search</label>
          <input
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
            disabled={isLocked}
            placeholder={t('通过ID/名字/标签/工作账号搜索', 'Search by id / name / label / work account')}
            className="magic-field-auto mt-2 w-full px-4 py-3 text-base disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <EmployeeMultiSelect
          label="Agency"
          allLabel={t('全部 Agency', 'All agencies')}
          selected={employeeAgency}
          options={employeeAgencyOptions.map((agency) => ({ value: agency, label: agency }))}
          onChange={setEmployeeAgency}
          disabled={isLocked}
          isLight={isLight}
        />
        <EmployeeMultiSelect
          label="Dept"
          allLabel={t('全部部门', 'All dept')}
          selected={employeeDepartment}
          options={employeeDepartmentOptions}
          onChange={setEmployeeDepartment}
          disabled={isLocked}
          isLight={isLight}
        />
        <EmployeeMultiSelect
          label="Position"
          allLabel={t('全部岗位', 'All positions')}
          selected={employeePosition}
          options={employeePositionOptions.map((position) => ({ value: position, label: position, badgeClass: getSchedulePositionBadgeClass(position) }))}
          onChange={setEmployeePosition}
          disabled={isLocked}
          isLight={isLight}
        />
        <EmployeeMultiSelect<'early' | 'late'>
          label={t('班次', 'Shift')}
          allLabel={t('全部班次', 'All shifts')}
          selected={employeeShiftFilter}
          options={[
            { value: 'early', label: t('白班', 'Day'), badgeClass: 'border-amber-300/30 bg-amber-400/[0.13] text-amber-100' },
            { value: 'late', label: t('晚班', 'Night'), badgeClass: 'border-indigo-300/30 bg-indigo-500/10 text-indigo-200' }
          ]}
          onChange={setEmployeeShiftFilter}
          disabled={isLocked}
          isLight={isLight}
        />
        <div>
          <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('标签', 'Label')}</label>
          <details ref={labelDetailsRef} className="relative mt-2">
            <summary
              className={[
                'magic-field-auto flex h-[46px] cursor-pointer list-none items-center justify-between px-4 text-sm outline-none',
                isLight ? 'text-slate-900' : 'text-white',
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
              <span className={['ml-3 text-xs', isLight ? 'text-slate-500' : 'text-slate-400'].join(' ')}>{employeeLabels.length}</span>
            </summary>
            <div
              className={[
                'magic-select-menu-glow absolute z-30 mt-2 w-full rounded-2xl border p-3',
                isLight
                  ? 'border-slate-200 bg-[#fffdf8] shadow-[0_18px_40px_rgba(15,23,42,0.14)]'
                  : 'border-slate-700 bg-slate-900 shadow-[0_18px_40px_rgba(0,0,0,0.45)]'
              ].join(' ')}
            >
              <div className={['mb-2 flex items-center justify-between text-[11px]', isLight ? 'text-slate-500' : 'text-slate-300'].join(' ')}>
                <span>{t('可多选', 'Multi-select')}</span>
                <button
                  type="button"
                  disabled={isLocked || employeeLabels.length === 0}
                  onClick={(e) => {
                    e.preventDefault();
                    setEmployeeLabels([]);
                  }}
                  className={[
                    'min-w-[52px] rounded-md border px-2 py-1 text-[12px] font-medium leading-none transition disabled:cursor-not-allowed disabled:opacity-50',
                    isLight
                      ? 'border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:bg-slate-50'
                      : 'border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
                  ].join(' ')}
                >
                  {t('清空', 'Clear')}
                </button>
              </div>
              <div role="listbox" aria-multiselectable="true" className="magic-select-menu max-h-56 space-y-1 overflow-auto pr-1">
                {employeeFilterLabelOptions.length === 0 ? (
                  <p
                    className={[
                      'rounded-lg border px-2 py-2 text-xs',
                      isLight ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-700 bg-slate-800 text-slate-300'
                    ].join(' ')}
                  >
                    {t('暂无标签', 'No labels')}
                  </p>
                ) : (
                  employeeFilterLabelOptions.map((item) => {
                    const checked = employeeLabels.includes(item);
                    return (
                      <div
                        key={item}
                        role="button"
                        tabIndex={0}
                        onClick={() => setEmployeeLabels((prev) => (prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]))}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          setEmployeeLabels((prev) => (prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]));
                        }}
                        className={[
                          'flex cursor-pointer items-center justify-between rounded-lg border px-2 py-1.5 text-sm transition',
                          checked
                            ? isLight
                              ? 'border-lime-300 bg-lime-50 text-lime-900'
                              : 'border-lime-400/60 bg-lime-400/12 text-lime-200'
                            : isLight
                              ? 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
                              : 'border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700'
                        ].join(' ')}
                      >
                        <span className={['inline-flex max-w-[62%] items-center truncate rounded-full border px-2 py-0.5 text-xs font-semibold', getScheduleLabelToneClass(item)].join(' ')}>
                          {item}
                        </span>
                        <div className="ml-2 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={writeLocked}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              cycleScheduleLabelTone(item);
                            }}
                            className={['rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', getScheduleLabelToneClass(item)].join(' ')}
                            title={t('点击切换标签颜色', 'Cycle label color')}
                          >
                            {t('颜色', 'Color')}
                          </button>
                          <input
                            type="checkbox"
                            checked={checked}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => setEmployeeLabels((prev) => (prev.includes(item) ? prev.filter((v) => v !== item) : [...prev, item]))}
                            className="sr-only"
                            aria-label={t('选择该标签', `Select label ${item}`)}
                          />
                          <span
                            aria-hidden="true"
                            className={[
                              'flex h-[18px] w-[18px] items-center justify-center rounded-md border transition',
                              checked
                                ? isLight
                                  ? 'border-lime-500 bg-lime-500 text-white shadow-[0_0_0_1px_rgba(132,204,22,0.18)]'
                                  : 'border-lime-400 bg-lime-400 text-slate-950 shadow-[0_0_0_1px_rgba(163,230,53,0.28)]'
                                : isLight
                                  ? 'border-slate-300 bg-white text-transparent'
                                  : 'border-slate-500 bg-slate-900 text-transparent'
                            ].join(' ')}
                          >
                            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </details>
        </div>
      </div>
    </>
  );
}
