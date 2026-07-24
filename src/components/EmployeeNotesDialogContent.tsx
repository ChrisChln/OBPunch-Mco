type TranslateFn = (zh: string, en: string) => string;

type EmployeeNotesDialogContentProps = {
  t: TranslateFn;
  themeMode: 'dark' | 'light';
  editor: 'admin' | 'agency';
  agencyNote: string;
  adminNote: string;
  agencyNoteUpdatedBy?: string;
  adminNoteUpdatedBy?: string;
  draft: string;
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

const MAX_NOTE_LENGTH = 500;

export default function EmployeeNotesDialogContent({
  t,
  themeMode,
  editor,
  agencyNote,
  adminNote,
  agencyNoteUpdatedBy = '',
  adminNoteUpdatedBy = '',
  draft,
  canEdit,
  dirty,
  saving,
  error,
  onDraftChange,
  onClose,
  onSave
}: EmployeeNotesDialogContentProps) {
  const isLight = themeMode === 'light';
  const panelClass = isLight
    ? 'border-slate-200 bg-slate-50'
    : 'border-white/10 bg-white/[0.035]';
  const editablePanelClass = isLight
    ? 'border-cyan-300 bg-cyan-50/70'
    : 'border-cyan-400/30 bg-cyan-400/[0.055]';
  const inputClass = isLight
    ? 'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400'
    : 'border-white/15 bg-slate-950/80 text-slate-100 placeholder:text-slate-600';
  const bodyTextClass = isLight ? 'text-slate-700' : 'text-slate-200';
  const mutedTextClass = isLight ? 'text-slate-500' : 'text-slate-500';

  const renderSection = (owner: 'agency' | 'admin', note: string) => {
    const isEditable = editor === owner;
    const label = owner === 'agency' ? t('Agency 留言', 'Agency note') : t('Admin 留言', 'Admin note');
    const updatedBy = owner === 'agency' ? agencyNoteUpdatedBy : adminNoteUpdatedBy;
    return (
      <section className={['rounded-2xl border p-4', isEditable ? editablePanelClass : panelClass].join(' ')}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <label
            htmlFor={isEditable ? `employee-${owner}-note` : undefined}
            className={[
              'text-xs font-semibold uppercase tracking-[0.14em]',
              isEditable ? (isLight ? 'text-cyan-700' : 'text-cyan-200') : mutedTextClass
            ].join(' ')}
          >
            {label}
          </label>
          <span className={['text-[10px] font-semibold uppercase tracking-[0.12em]', mutedTextClass].join(' ')}>
            {updatedBy ? `${t('更新人', 'Updated by')} ${updatedBy}` : t('更新人 —', 'Updated by —')}
          </span>
        </div>

        {isEditable ? (
          <>
            <textarea
              id={`employee-${owner}-note`}
              aria-label={label}
              value={draft}
              maxLength={MAX_NOTE_LENGTH}
              rows={5}
              disabled={!canEdit || saving}
              onChange={(event) => onDraftChange(event.target.value)}
              className={[
                'min-h-28 w-full resize-none rounded-xl border px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-65',
                inputClass
              ].join(' ')}
            />
            <div className={['mt-1 text-right text-[10px] tabular-nums', mutedTextClass].join(' ')}>
              {draft.length}/{MAX_NOTE_LENGTH}
            </div>
          </>
        ) : (
          <div
            data-testid={`${owner}-note-readonly`}
            className={['min-h-16 whitespace-pre-wrap break-words text-sm leading-6', bodyTextClass].join(' ')}
          >
            {String(note ?? '').trim() || '-'}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-3">
      {renderSection('agency', agencyNote)}
      {renderSection('admin', adminNote)}

      {error ? (
        <div
          role="alert"
          className={[
            'rounded-xl border px-3 py-2 text-sm',
            isLight ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-rose-400/25 bg-rose-400/10 text-rose-200'
          ].join(' ')}
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className={[
            'rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
            isLight
              ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
          ].join(' ')}
        >
          {t('关闭', 'Close')}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canEdit || !dirty || saving}
          className="rounded-xl border border-cyan-300/30 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? t('保存中...', 'Saving...') : t('保存', 'Save')}
        </button>
      </div>
    </div>
  );
}
