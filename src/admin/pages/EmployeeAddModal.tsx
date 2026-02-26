import { createPortal } from 'react-dom';

type TranslateFn = (zh: string, en: string) => string;

type EmployeeAddModalProps = {
  open: boolean;
  t: TranslateFn;
  isLocked: boolean;
  employeeNewStaffId: string;
  setEmployeeNewStaffId: (value: string) => void;
  employeeNewName: string;
  setEmployeeNewName: (value: string) => void;
  employeeNewAgency: string;
  setEmployeeNewAgency: (value: string) => void;
  employeeAgencyOptions: string[];
  employeeNewPosition: string;
  setEmployeeNewPosition: (value: any) => void;
  employeeNewShift: '' | 'early' | 'late';
  setEmployeeNewShift: (value: '' | 'early' | 'late') => void;
  employeeNewLabel: string;
  setEmployeeNewLabel: (value: string) => void;
  employeeNewWorkAccount: string;
  setEmployeeNewWorkAccount: (value: string) => void;
  employeeNewWorkPassword: string;
  setEmployeeNewWorkPassword: (value: string) => void;
  employeeAddLabelOptions: string[];
  allowedPositions: readonly string[];
  closeEmployeeAdd: () => void;
  addEmployeeRow: () => void | Promise<void>;
};

export default function EmployeeAddModal({
  open,
  t,
  isLocked,
  employeeNewStaffId,
  setEmployeeNewStaffId,
  employeeNewName,
  setEmployeeNewName,
  employeeNewAgency,
  setEmployeeNewAgency,
  employeeAgencyOptions,
  employeeNewPosition,
  setEmployeeNewPosition,
  employeeNewShift,
  setEmployeeNewShift,
  employeeNewLabel,
  setEmployeeNewLabel,
  employeeNewWorkAccount,
  setEmployeeNewWorkAccount,
  employeeNewWorkPassword,
  setEmployeeNewWorkPassword,
  employeeAddLabelOptions,
  allowedPositions,
  closeEmployeeAdd,
  addEmployeeRow
}: EmployeeAddModalProps) {
  if (!open || typeof document === 'undefined') return null;
  const NEW_AGENCY_OPTION = '__new_agency__';
  const hasAgencyInOptions = employeeAgencyOptions.includes(employeeNewAgency);
  const agencySelectValue = hasAgencyInOptions ? employeeNewAgency : NEW_AGENCY_OPTION;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-10">
      <div className="w-full max-w-6xl rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('新增员工', 'Add Employee')}</div>
          </div>
          <button
            type="button"
            onClick={closeEmployeeAdd}
            className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
          >
            {t('关闭', 'Close')}
          </button>
        </div>

        <div className="mt-6 space-y-6">
          {/* 基本信息 */}
          <div>
            <div className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">{t('基本信息', 'Basic Info')}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('工号', 'Staff ID')}</label>
                <input
                  value={employeeNewStaffId}
                  onChange={(e) => setEmployeeNewStaffId(e.target.value)}
                  disabled={isLocked}
                  placeholder={t('例如：US012345', 'e.g. US12345')}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-mono text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('姓名', 'Name')}</label>
                <input
                  value={employeeNewName}
                  onChange={(e) => setEmployeeNewName(e.target.value)}
                  disabled={isLocked}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          </div>

          {/* 工作信息 */}
          <div>
            <div className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">{t('工作信息', 'Work Info')}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Agency</label>
                <select
                  value={agencySelectValue}
                  onChange={(e) => {
                    const selected = String(e.target.value ?? '').trim();
                    if (selected === NEW_AGENCY_OPTION) {
                      if (hasAgencyInOptions) setEmployeeNewAgency('');
                      return;
                    }
                    setEmployeeNewAgency(selected);
                  }}
                  disabled={isLocked}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">{t('选择中介', 'Select agency')}</option>
                  {employeeAgencyOptions.map((agency) => (
                    <option key={agency} value={agency}>
                      {agency}
                    </option>
                  ))}
                  <option value={NEW_AGENCY_OPTION}>{t('新中介', 'New agency')}</option>
                </select>
                {agencySelectValue === NEW_AGENCY_OPTION && (
                  <input
                    value={employeeNewAgency}
                    onChange={(e) => setEmployeeNewAgency(e.target.value)}
                    disabled={isLocked}
                    placeholder={t('输入新中介', 'Enter new agency')}
                    className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                  />
                )}
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Position</label>
                <select
                  value={employeeNewPosition}
                  onChange={(e) => setEmployeeNewPosition((e.target.value as string) ?? '')}
                  disabled={isLocked}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">{t('选择岗位', 'Position')}</option>
                  {allowedPositions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('班次', 'Shift')}</label>
                <div className="mt-2 flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-2">
                  {([['early', t('早班', 'Morning')], ['late', t('晚班', 'Night')]] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      disabled={isLocked}
                      onClick={() => setEmployeeNewShift(val as '' | 'early' | 'late')}
                      className={[
                        'flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition',
                        employeeNewShift === val
                          ? val === 'early' ? 'bg-amber-500 text-white shadow-md' : 'bg-indigo-500 text-white shadow-md'
                          : 'text-slate-400 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60'
                      ].join(' ')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('标签', 'Label')}</label>
                <input
                  value={employeeNewLabel}
                  onChange={(e) => setEmployeeNewLabel(e.target.value)}
                  disabled={isLocked}
                  list="employee-label-add-options"
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
                <datalist id="employee-label-add-options">
                  {employeeAddLabelOptions.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>

          {/* 账号信息 */}
          <div>
            <div className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">{t('账号信息', 'Account Info')}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('工作账号', 'Work account')}</label>
                <input
                  value={employeeNewWorkAccount}
                  onChange={(e) => setEmployeeNewWorkAccount(e.target.value)}
                  disabled={isLocked}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('工作密码', 'Work password')}</label>
                <input
                  value={employeeNewWorkPassword}
                  onChange={(e) => setEmployeeNewWorkPassword(e.target.value)}
                  disabled={isLocked}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isLocked}
            onClick={closeEmployeeAdd}
            className="rounded-2xl bg-white/10 px-5 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={isLocked || !employeeNewStaffId}
            onClick={() => void addEmployeeRow()}
            className="rounded-2xl bg-neon px-6 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('添加', 'Add')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
