import { isScheduleOnlyAgency } from '../shared/agencyRules';

type ScheduleEmployeeSortRow = {
  staff_id?: string | null;
  agency?: string | null;
  Agency?: string | null;
};

type SortScheduleEmployeesOptions = {
  normalizeStaffId: (value: string) => string;
  pendingStaffIds: Pick<ReadonlySet<string>, 'has'>;
  sortByUphDesc: boolean;
  uphByStaffId: Record<string, number | string | null | undefined>;
};

const compareScheduleOnlyAgencyPriority = <T extends ScheduleEmployeeSortRow>(a: T, b: T) => {
  const agencyA = String(a.agency ?? a.Agency ?? '').trim();
  const agencyB = String(b.agency ?? b.Agency ?? '').trim();
  const isScheduleOnlyA = isScheduleOnlyAgency(agencyA);
  const isScheduleOnlyB = isScheduleOnlyAgency(agencyB);
  if (isScheduleOnlyA === isScheduleOnlyB) return 0;
  return isScheduleOnlyA ? -1 : 1;
};

export const sortScheduleEmployees = <T extends ScheduleEmployeeSortRow>(
  employees: readonly T[],
  options: SortScheduleEmployeesOptions
) => {
  const { normalizeStaffId, pendingStaffIds, sortByUphDesc, uphByStaffId } = options;

  return [...employees].sort((a, b) => {
    const staffA = normalizeStaffId(String(a.staff_id ?? '').trim());
    const staffB = normalizeStaffId(String(b.staff_id ?? '').trim());
    const pendingA = pendingStaffIds.has(staffA);
    const pendingB = pendingStaffIds.has(staffB);
    if (pendingA !== pendingB) return pendingA ? -1 : 1;

    const scheduleOnlyCompare = compareScheduleOnlyAgencyPriority(a, b);
    if (scheduleOnlyCompare !== 0) return scheduleOnlyCompare;

    if (!sortByUphDesc) return staffA.localeCompare(staffB, 'en-US');

    const rawA = Number(uphByStaffId[staffA]);
    const rawB = Number(uphByStaffId[staffB]);
    const hasA = Number.isFinite(rawA);
    const hasB = Number.isFinite(rawB);
    if (hasA && hasB && rawA !== rawB) return rawB - rawA;
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;
    return staffA.localeCompare(staffB, 'en-US');
  });
};
