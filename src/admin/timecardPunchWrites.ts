interface DatabaseErrorLike {
  message?: string | null;
}

interface UpdatedPunchRow {
  id?: string | number | null;
}

export function getPunchUpdateError({
  expectedId,
  data,
  error
}: {
  expectedId: string;
  data: UpdatedPunchRow[] | null | undefined;
  error: DatabaseErrorLike | null | undefined;
}) {
  if (error) return String(error.message ?? 'Punch update failed.');

  const expected = expectedId.trim();
  const updated = (data ?? []).some((row) => String(row.id ?? '').trim() === expected);
  return updated ? null : 'Punch record was not updated. Refresh and try again.';
}
