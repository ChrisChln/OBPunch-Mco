export type WorkHourDateStaffRow = {
  workDate: string;
  staffId: string;
};

export type CachedSystemHoursEntry = {
  hoursByStaff: Map<string, number>;
  coveredStaffIds: Set<string>;
};

export const buildStaffIdsByDate = (rows: WorkHourDateStaffRow[]) => {
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    const workDate = String(row.workDate ?? '').trim();
    const staffId = String(row.staffId ?? '').trim();
    if (!workDate || !staffId) continue;
    const bucket = result.get(workDate) ?? new Set<string>();
    bucket.add(staffId);
    result.set(workDate, bucket);
  }
  return result;
};

export const hasSystemHoursCoverage = (entry: CachedSystemHoursEntry | undefined, staffIds: Iterable<string>) => {
  if (!entry) return false;
  for (const staffId of staffIds) {
    if (!entry.coveredStaffIds.has(String(staffId ?? '').trim())) return false;
  }
  return true;
};

export const mergeSystemHoursEntry = (
  existing: CachedSystemHoursEntry | undefined,
  requestedStaffIds: Iterable<string>,
  nextHoursByStaff: Map<string, number>
): CachedSystemHoursEntry => {
  const mergedHours = new Map(existing?.hoursByStaff ?? []);
  const coveredStaffIds = new Set(existing?.coveredStaffIds ?? []);

  for (const [staffId, hours] of nextHoursByStaff.entries()) {
    mergedHours.set(staffId, hours);
  }
  for (const staffId of requestedStaffIds) {
    const normalized = String(staffId ?? '').trim();
    if (normalized) coveredStaffIds.add(normalized);
  }

  return {
    hoursByStaff: mergedHours,
    coveredStaffIds
  };
};
