import { createPortal } from 'react-dom';

type TranslateFn = (zh: string, en: string) => string;

type EmployeeEditModalProps = {
  open: boolean;
  t: TranslateFn;
  isLocked: boolean;
  userEmail: string;
  staffIdEditorEmail: string;
  isNewHirePlaceholderStaffId: (staffId: string) => boolean;
  displayStaffId: (value: string) => string;
  employeeEditOriginalStaffId: string | null;
  employeeEditStaffId: string | null;
  setEmployeeEditStaffId: (value: string) => void;
  employeeEditName: string;
  setEmployeeEditName: (value: string) => void;
  employeeEditAgency: string;
  setEmployeeEditAgency: (value: string) => void;
  employeeEditPosition: string;
  setEmployeeEditPosition: (value: string) => void;
  employeeEditShift: '' | 'early' | 'late';
  setEmployeeEditShift: (value: '' | 'early' | 'late') => void;
  employeeEditLabel: string;
  setEmployeeEditLabel: (value: string) => void;
  employeeEditWorkAccount: string;
  setEmployeeEditWorkAccount: (value: string) => void;
  employeeEditWorkPassword: string;
  setEmployeeEditWorkPassword: (value: string) => void;
  employeeEditLabelOptions: string[];
  allowedPositions: readonly string[];
  closeEmployeeEdit: () => void;
  saveEmployeeEdit: () => void | Promise<void>;
};

export default function EmployeeEditModal({
  open,
  t,
  isLocked,
  userEmail,
  staffIdEditorEmail,
  isNewHirePlaceholderStaffId,
  displayStaffId,
  employeeEditOriginalStaffId,
  employeeEditStaffId,
  setEmployeeEditStaffId,
  employeeEditName,
  setEmployeeEditName,
  employeeEditAgency,
  setEmployeeEditAgency,
  employeeEditPosition,
  setEmployeeEditPosition,
  employeeEditShift,
  setEmployeeEditShift,
  employeeEditLabel,
  setEmployeeEditLabel,
  employeeEditWorkAccount,
  setEmployeeEditWorkAccount,
  employeeEditWorkPassword,
  setEmployeeEditWorkPassword,
  employeeEditLabelOptions,
  allowedPositions,
  closeEmployeeEdit,
  saveEmployeeEdit
}: EmployeeEditModalProps) {
  if (!open || typeof document === 'undefined') return null;

  const originalStaff = String(employeeEditOriginalStaffId ?? '').trim();
  const canEditStaffId = isNewHirePlaceholderStaffId(originalStaff) || userEmail.trim().toLowerCase() === staffIdEditorEmail;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-10">
      <div className="w-full max-w-6xl rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('编辑员工', 'Edit Employee')}</div>
            <div className="mt-2 text-sm text-slate-400">
              {t('当前工号：', 'Current staff: ')}
              <span className="text-slate-200">{displayStaffId(String(employeeEditOriginalStaffId ?? '')) || '-'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={closeEmployeeEdit}
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
                  value={employeeEditStaffId ?? ''}
                  onChange={(e) => setEmployeeEditStaffId(e.target.value)}
                  disabled={isLocked || !canEditStaffId}
                  placeholder={t('例如：US012345', 'e.g. US12345')}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-mono text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
                {!canEditStaffId && <p className="mt-1 text-[11px] text-slate-500">Only {staffIdEditorEmail} can edit staff ID.</p>}
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('姓名', 'Name')}</label>
                <input
                  value={employeeEditName}
                  onChange={(e) => setEmployeeEditName(e.target.value)}
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
                <input
                  value={employeeEditAgency}
                  onChange={(e) => setEmployeeEditAgency(e.target.value)}
                  disabled={isLocked}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">Position</label>
                <select
                  value={employeeEditPosition}
                  onChange={(e) => setEmployeeEditPosition((e.target.value as string) ?? '')}
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
                      onClick={() => setEmployeeEditShift(val as '' | 'early' | 'late')}
                      className={[
                        'flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition',
                        employeeEditShift === val
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
                  value={employeeEditLabel}
                  onChange={(e) => setEmployeeEditLabel(e.target.value)}
                  disabled={isLocked}
                  list="employee-label-edit-options"
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
                <datalist id="employee-label-edit-options">
                  {employeeEditLabelOptions.map((d) => (
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
                  value={employeeEditWorkAccount}
                  onChange={(e) => setEmployeeEditWorkAccount(e.target.value)}
                  disabled={isLocked}
                  className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">{t('工作密码', 'Work password')}</label>
                <input
                  value={employeeEditWorkPassword}
                  onChange={(e) => setEmployeeEditWorkPassword(e.target.value)}
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
            onClick={closeEmployeeEdit}
            className="rounded-2xl bg-white/10 px-5 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('取消', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={isLocked || !employeeEditStaffId}
            onClick={() => void saveEmployeeEdit()}
            className="rounded-2xl bg-neon px-6 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('保存', 'Save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
