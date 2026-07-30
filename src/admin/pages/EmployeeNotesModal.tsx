import { createPortal } from 'react-dom';

import EmployeeNotesDialogContent from '../../components/EmployeeNotesDialogContent';

type TranslateFn = (zh: string, en: string) => string;

type EmployeeNotesModalProps = {
  open: boolean;
  t: TranslateFn;
  themeMode: 'dark' | 'light';
  staff: string;
  name: string;
  agencyNote: string;
  adminNote: string;
  agencyNoteUpdatedBy: string;
  adminNoteUpdatedBy: string;
  draft: string;
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export default function EmployeeNotesModal({
  open,
  t,
  themeMode,
  staff,
  name,
  agencyNote,
  adminNote,
  agencyNoteUpdatedBy,
  adminNoteUpdatedBy,
  draft,
  canEdit,
  dirty,
  saving,
  error,
  onDraftChange,
  onClose,
  onSave
}: EmployeeNotesModalProps) {
  if (!open || typeof document === 'undefined') return null;
  const isLight = themeMode === 'light';

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-notes-title"
        className={[
          'max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[28px] border p-5 shadow-2xl sm:p-6',
          isLight ? 'border-slate-200 bg-white text-slate-900' : 'border-white/10 bg-slate-950 text-white'
        ].join(' ')}
      >
        <div className="mb-5">
          <h3 id="employee-notes-title" className="text-xl font-bold tracking-tight">
            {t('留言', 'Notes')}
          </h3>
          <div className={['mt-2 text-sm font-semibold', isLight ? 'text-slate-600' : 'text-slate-300'].join(' ')}>
            {name || staff} <span className={isLight ? 'text-slate-400' : 'text-slate-500'}>({staff})</span>
          </div>
        </div>

        <EmployeeNotesDialogContent
          t={t}
          themeMode={themeMode}
          editor="admin"
          agencyNote={agencyNote}
          adminNote={adminNote}
          agencyNoteUpdatedBy={agencyNoteUpdatedBy}
          adminNoteUpdatedBy={adminNoteUpdatedBy}
          draft={draft}
          canEdit={canEdit}
          dirty={dirty}
          saving={saving}
          error={error}
          onDraftChange={onDraftChange}
          onClose={onClose}
          onSave={onSave}
        />
      </div>
    </div>,
    document.body
  );
}
