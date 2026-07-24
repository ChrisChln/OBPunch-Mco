import EmployeeNoteHoverCard from '../../components/EmployeeNoteHoverCard';

type AgencyEmployeeNameProps = {
  staffId: string;
  name: string;
  agencyNote: string;
  adminNote: string;
};

export default function AgencyEmployeeName({
  staffId,
  name,
  agencyNote,
  adminNote
}: AgencyEmployeeNameProps) {
  const normalizedName = String(name ?? '').trim() || '-';
  const normalizedAdminNote = String(adminNote ?? '').trim();
  const normalizedAgencyNote = String(agencyNote ?? '').trim();
  const title = normalizedAgencyNote
    ? `${normalizedName}\n${normalizedAgencyNote}`
    : normalizedName;

  return (
    <span
      className="group relative inline-flex max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
      tabIndex={normalizedAdminNote ? 0 : undefined}
    >
      <span className="truncate font-medium" title={normalizedAdminNote ? undefined : title}>
        {normalizedName}
      </span>
      {normalizedAdminNote ? (
        <span
          data-testid={`agency-admin-note-dot-${staffId}`}
          aria-hidden="true"
          className="pointer-events-none absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-rose-500"
        />
      ) : null}
      {normalizedAdminNote ? (
        <EmployeeNoteHoverCard agencyNote={normalizedAgencyNote} adminNote={normalizedAdminNote} isLight={false} />
      ) : null}
    </span>
  );
}
