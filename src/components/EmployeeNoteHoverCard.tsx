type EmployeeNoteHoverCardProps = {
  agencyNote: string;
  adminNote: string;
  isLight: boolean;
};

export default function EmployeeNoteHoverCard({
  agencyNote,
  adminNote,
  isLight
}: EmployeeNoteHoverCardProps) {
  const normalizedAgencyNote = String(agencyNote ?? '').trim();
  const normalizedAdminNote = String(adminNote ?? '').trim();

  if (!normalizedAgencyNote && !normalizedAdminNote) return null;

  return (
    <span
      data-testid="employee-note-hover-card"
      className={[
        'pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-64 space-y-2 rounded-xl border p-2.5 text-left text-[11px] leading-snug shadow-2xl backdrop-blur group-hover:block group-focus-within:block',
        isLight
          ? 'border-slate-200 bg-white/95 text-slate-700'
          : 'border-white/10 bg-slate-950/95 text-slate-100'
      ].join(' ')}
    >
      {normalizedAgencyNote ? (
        <span className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-400">Agency note</span>
          <span className="mt-1 block whitespace-pre-wrap break-words">{normalizedAgencyNote}</span>
        </span>
      ) : null}
      {normalizedAdminNote ? (
        <span className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-400">Admin note</span>
          <span className="mt-1 block whitespace-pre-wrap break-words">{normalizedAdminNote}</span>
        </span>
      ) : null}
    </span>
  );
}
