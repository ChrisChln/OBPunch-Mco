interface DatabaseErrorLike {
  message?: string | null;
}

interface EmployeeRowLike {
  staff_id?: string | null;
}

export function isGeneratedEmployeeColumnWriteError(error: DatabaseErrorLike | null | undefined) {
  const message = String(error?.message ?? '');
  return (
    /\b(?:agency|position)\b/i.test(message) &&
    /(?:generated column|only be updated to DEFAULT)/i.test(message)
  );
}

export function getEmployeeUpdateError({
  expectedStaffId,
  data,
  error
}: {
  expectedStaffId: string;
  data: EmployeeRowLike[] | null | undefined;
  error: DatabaseErrorLike | null | undefined;
}) {
  if (error) return String(error.message ?? 'Employee update failed.');

  const expected = expectedStaffId.trim().toUpperCase();
  const updated = (data ?? []).some(
    (row) => String(row.staff_id ?? '').trim().toUpperCase() === expected
  );
  return updated ? null : 'Employee record was not updated. Refresh and try again.';
}
