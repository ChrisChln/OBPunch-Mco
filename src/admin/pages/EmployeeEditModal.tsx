import { createPortal } from 'react-dom';

type TranslateFn = (zh: string, en: string) => string;

type EmployeeEditModalProps = {
  open: boolean;
  t: TranslateFn;
  themeMode: 'light' | 'dark';
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
  employeeAgencyOptions: string[];
  employeeEditPosition: string;
  setEmployeeEditPosition: (value: string) => void;
  employeeEditShift: '' | 'early' | 'late';
  setEmployeeEditShift: (value: '' | 'early' | 'late') => void;
  employeeEditShiftTime: string;
  setEmployeeEditShiftTime: (value: string) => void;
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
  themeMode,
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
  employeeAgencyOptions,
  employeeEditPosition,
  setEmployeeEditPosition,
  employeeEditShift,
  setEmployeeEditShift,
  employeeEditShiftTime,
  setEmployeeEditShiftTime,
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

  const isLight = themeMode === 'light';
  const originalStaff = String(employeeEditOriginalStaffId ?? '').trim();
  const canEditStaffId = isNewHirePlaceholderStaffId(originalStaff) || userEmail.trim().toLowerCase() === staffIdEditorEmail;

  const overlayClass = isLight ? 'bg-slate-900/35' : 'bg-black/60';
  const panelClass = isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/90 backdrop-blur';
  const titleClass = isLight ? 'text-slate-500' : 'text-slate-400';
  const titleValueClass = isLight ? 'text-slate-900' : 'text-slate-200';
  const sectionTitleClass = isLight ? 'text-slate-700' : 'text-slate-300';
  const labelClass = isLight ? 'text-slate-600' : 'text-slate-400';
  const noteClass = isLight ? 'text-slate-500' : 'text-slate-500';
  const fieldClass = isLight
    ? 'mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)] disabled:cursor-not-allowed disabled:opacity-60'
    : 'mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60';
  const monoFieldClass = isLight
    ? 'mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 font-mono text-sm text-slate-900 outline-none transition focus:border-neon/60 focus:shadow-[0_0_0_2px_rgba(132,204,22,0.15)] disabled:cursor-not-allowed disabled:opacity-60'
    : 'mt-2 h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-mono text-sm text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60';
  const shiftGroupClass = isLight
    ? 'mt-2 flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2'
    : 'mt-2 flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-2';
  const shiftInactiveClass = isLight
    ? 'text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60'
    : 'text-slate-400 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60';
  const closeBtnClass = isLight
    ? 'rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200'
    : 'rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15';
  const cancelBtnClass = isLight
    ? 'rounded-2xl bg-slate-100 px-5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60'
    : 'rounded-2xl bg-white/10 px-5 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60';
  const saveBtnClass = isLight
    ? 'rounded-2xl bg-neon px-6 py-2 text-sm font-semibold text-slate-900 shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50'
    : 'rounded-2xl bg-neon px-6 py-2 text-sm font-semibold text-white shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50';

  return createPortal(
    <div className={['fixed inset-0 z-40 flex items-center justify-center overflow-y-auto px-4 py-10', overlayClass].join(' ')}>
      <div className={['w-full max-w-6xl rounded-3xl border p-6 shadow-2xl', panelClass].join(' ')}>
        <div className="flex items-start justify-between">
          <div>
            <div className={['text-xs uppercase tracking-[0.25em]', titleClass].join(' ')}>{t('编辑员工', 'Edit Employee')}</div>
            <div className={['mt-2 text-sm', titleClass].join(' ')}>
              {t('当前工号: ', 'Current staff: ')}
              <span className={titleValueClass}>{displayStaffId(String(employeeEditOriginalStaffId ?? '')) || '-'}</span>
            </div>
          </div>
          <button type="button" onClick={closeEmployeeEdit} className={closeBtnClass}>
            {t('关闭', 'Close')}
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <div>
            <div className={['mb-4 text-sm font-semibold uppercase tracking-[0.2em]', sectionTitleClass].join(' ')}>{t('基本信息', 'Basic Info')}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={['text-xs uppercase tracking-[0.25em]', labelClass].join(' ')}>{t('工号', 'Staff ID')}</label>
                <input
                  value={employeeEditStaffId ?? ''}
                  onChange={(e) => setEmployeeEditStaffId(e.target.value)}
                  disabled={isLocked || !canEditStaffId}
                  placeholder={t('例如 US12345', 'e.g. US12345')}
                  className={monoFieldClass}
                />
                {!canEditStaffId && <p className={['mt-1 text-[11px]', noteClass].join(' ')}>Only {staffIdEditorEmail} can edit staff ID.</p>}
              </div>
              <div>
                <label className={['text-xs uppercase tracking-[0.25em]', labelClass].join(' ')}>{t('姓名', 'Name')}</label>
                <input value={employeeEditName} onChange={(e) => setEmployeeEditName(e.target.value)} disabled={isLocked} className={fieldClass} />
              </div>
            </div>
          </div>

          <div>
            <div className={['mb-4 text-sm font-semibold uppercase tracking-[0.2em]', sectionTitleClass].join(' ')}>{t('工作信息', 'Work Info')}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={['text-xs uppercase tracking-[0.25em]', labelClass].join(' ')}>Agency</label>
                <select value={employeeEditAgency} onChange={(e) => setEmployeeEditAgency(e.target.value)} disabled={isLocked} className={fieldClass}>
                  <option value="">{t('选择中介', 'Select agency')}</option>
                  {employeeAgencyOptions.map((agency) => (
                    <option key={agency} value={agency}>
                      {agency}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={['text-xs uppercase tracking-[0.25em]', labelClass].join(' ')}>Position</label>
                <select
                  value={employeeEditPosition}
                  onChange={(e) => setEmployeeEditPosition((e.target.value as string) ?? '')}
                  disabled={isLocked}
                  className={fieldClass}
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
                <label className={['text-xs uppercase tracking-[0.25em]', labelClass].join(' ')}>{t('班次', 'Shift')}</label>
                <div className={shiftGroupClass}>
                  {([
                    ['early', t('早班', 'Morning')],
                    ['late', t('晚班', 'Night')]
                  ] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      disabled={isLocked}
                      onClick={() => setEmployeeEditShift(val as '' | 'early' | 'late')}
                      className={[
                        'flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition',
                        employeeEditShift === val
                          ? val === 'early'
                            ? 'bg-amber-500 text-white shadow-md'
                            : 'bg-indigo-500 text-white shadow-md'
                          : shiftInactiveClass
                      ].join(' ')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={['text-xs uppercase tracking-[0.25em]', labelClass].join(' ')}>{t('班次时间', 'Shift time')}</label>
                <input
                  value={employeeEditShiftTime}
                  onChange={(e) => setEmployeeEditShiftTime(e.target.value)}
                  disabled={isLocked}
                  placeholder={t('例如 07:00', 'e.g. 07:00')}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={['text-xs uppercase tracking-[0.25em]', labelClass].join(' ')}>{t('标签', 'Label')}</label>
                <input
                  value={employeeEditLabel}
                  onChange={(e) => setEmployeeEditLabel(e.target.value)}
                  disabled={isLocked}
                  list="employee-label-edit-options"
                  className={fieldClass}
                />
                <datalist id="employee-label-edit-options">
                  {employeeEditLabelOptions.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>

          <div>
            <div className={['mb-4 text-sm font-semibold uppercase tracking-[0.2em]', sectionTitleClass].join(' ')}>{t('账号信息', 'Account Info')}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={['text-xs uppercase tracking-[0.25em]', labelClass].join(' ')}>{t('工作账号', 'Work account')}</label>
                <input
                  value={employeeEditWorkAccount}
                  onChange={(e) => setEmployeeEditWorkAccount(e.target.value)}
                  disabled={isLocked}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={['text-xs uppercase tracking-[0.25em]', labelClass].join(' ')}>{t('工作密码', 'Work password')}</label>
                <input
                  value={employeeEditWorkPassword}
                  onChange={(e) => setEmployeeEditWorkPassword(e.target.value)}
                  disabled={isLocked}
                  className={fieldClass}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <button type="button" disabled={isLocked} onClick={closeEmployeeEdit} className={cancelBtnClass}>
            {t('取消', 'Cancel')}
          </button>
          <button type="button" disabled={isLocked || !employeeEditStaffId} onClick={() => void saveEmployeeEdit()} className={saveBtnClass}>
            {t('保存', 'Save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
