type TranslateFn = (zh: string, en: string) => string;

type EmployeeAddPanelProps = {
  t: TranslateFn;
  open: boolean;
  isLocked: boolean;
  employeeNewStaffId: string;
  setEmployeeNewStaffId: (value: string) => void;
  employeeNewName: string;
  setEmployeeNewName: (value: string) => void;
  employeeNewAgency: string;
  setEmployeeNewAgency: (value: string) => void;
  employeeNewPosition: string;
  setEmployeeNewPosition: (value: any) => void;
  employeeNewLabel: string;
  setEmployeeNewLabel: (value: string) => void;
  employeeNewWorkAccount: string;
  setEmployeeNewWorkAccount: (value: string) => void;
  employeeNewWorkPassword: string;
  setEmployeeNewWorkPassword: (value: string) => void;
  employeeAddLabelOptions: string[];
  allowedPositions: readonly string[];
  addEmployeeRow: () => void | Promise<void>;
};

export default function EmployeeAddPanel({
  t,
  open,
  isLocked,
  employeeNewStaffId,
  setEmployeeNewStaffId,
  employeeNewName,
  setEmployeeNewName,
  employeeNewAgency,
  setEmployeeNewAgency,
  employeeNewPosition,
  setEmployeeNewPosition,
  employeeNewLabel,
  setEmployeeNewLabel,
  employeeNewWorkAccount,
  setEmployeeNewWorkAccount,
  employeeNewWorkPassword,
  setEmployeeNewWorkPassword,
  employeeAddLabelOptions,
  allowedPositions,
  addEmployeeRow
}: EmployeeAddPanelProps) {
  if (!open) return null;

  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('新增员工', 'Add Employee')}</div>
      <div className="mt-3 grid gap-3 md:grid-cols-8">
        <input
          value={employeeNewStaffId}
          onChange={(e) => setEmployeeNewStaffId(e.target.value)}
          disabled={isLocked}
          placeholder={t('员工ID（例如：US010454）', 'Staff ID (e.g. US010454)')}
          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
        />
        <input
          value={employeeNewName}
          onChange={(e) => setEmployeeNewName(e.target.value)}
          disabled={isLocked}
          placeholder={t('姓名', 'Name')}
          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
        />
        <input
          value={employeeNewAgency}
          onChange={(e) => setEmployeeNewAgency(e.target.value)}
          disabled={isLocked}
          placeholder="Agency"
          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
        />
        <select
          value={employeeNewPosition}
          onChange={(e) => setEmployeeNewPosition((e.target.value as string) ?? '')}
          disabled={isLocked}
          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">{t('选择岗位', 'Position')}</option>
          {allowedPositions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          value={employeeNewLabel}
          onChange={(e) => setEmployeeNewLabel(e.target.value)}
          disabled={isLocked}
          list="employee-label-add-options"
          placeholder={t('标签', 'Label')}
          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
        />
        <input
          value={employeeNewWorkAccount}
          onChange={(e) => setEmployeeNewWorkAccount(e.target.value)}
          disabled={isLocked}
          placeholder={t('工作账号', 'Work account')}
          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
        />
        <input
          value={employeeNewWorkPassword}
          onChange={(e) => setEmployeeNewWorkPassword(e.target.value)}
          disabled={isLocked}
          placeholder={t('工作密码', 'Work password')}
          className="h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
        />
        <datalist id="employee-label-add-options">
          {employeeAddLabelOptions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <button
          type="button"
          disabled={isLocked}
          onClick={() => void addEmployeeRow()}
          className="h-11 rounded-2xl bg-neon px-6 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('添加', 'Add')}
        </button>
      </div>
    </div>
  );
}
