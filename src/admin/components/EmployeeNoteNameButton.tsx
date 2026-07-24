import EmployeeNoteHoverCard from '../../components/EmployeeNoteHoverCard';

export type EmployeeNotePair = {
  agencyNote: string;
  adminNote: string;
  agencyNoteUpdatedBy: string;
  adminNoteUpdatedBy: string;
};

type EmployeeNoteNameButtonProps = {
  staff: string;
  name: string;
  position: string;
  notes?: EmployeeNotePair;
  isLight: boolean;
  onOpen: (employee: { staff: string; name: string; position: string }) => void;
};

export default function EmployeeNoteNameButton({
  staff,
  name,
  position,
  notes,
  isLight,
  onOpen
}: EmployeeNoteNameButtonProps) {
  const agencyNote = String(notes?.agencyNote ?? '').trim();
  const adminNote = String(notes?.adminNote ?? '').trim();
  const hasNotes = Boolean(agencyNote || adminNote);

  return (
    <span className="group relative inline-flex max-w-full">
      <button
        type="button"
        className={[
          'relative block max-w-full truncate text-left underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70',
          isLight ? 'text-slate-700' : 'text-slate-200'
        ].join(' ')}
        aria-label={`Open notes for ${name || staff}`}
        title={hasNotes ? undefined : name || '-'}
        onClick={(event) => {
          event.stopPropagation();
          onOpen({ staff, name, position });
        }}
      >
        {name || '-'}
      </button>

      {hasNotes ? (
        <span
          data-testid={`employee-note-dot-${staff}`}
          aria-hidden="true"
          className="pointer-events-none absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-rose-500"
        />
      ) : null}

      <EmployeeNoteHoverCard agencyNote={agencyNote} adminNote={adminNote} isLight={isLight} />
    </span>
  );
}
