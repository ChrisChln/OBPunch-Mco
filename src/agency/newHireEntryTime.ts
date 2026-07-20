import type { AgencyEmployeeRow, AgencyNewHireRequestRow } from './types';

const DEFAULT_NEW_HIRE_ENTRY_TIME = '09:00';

const isValidClockTime = (value: string) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);

export const normalizeAgencyEntryTime = (value: unknown, fallback = DEFAULT_NEW_HIRE_ENTRY_TIME) => {
  const normalized = String(value ?? '').trim();
  if (isValidClockTime(normalized)) return normalized;
  return fallback;
};

export const resolveAgencyNewHireEntryTime = ({
  employees,
  newHireRequest,
  agency,
  position,
  shift
}: {
  employees: AgencyEmployeeRow[];
  newHireRequest?: AgencyNewHireRequestRow | null;
  agency?: string;
  position?: string;
  shift?: '' | 'early' | 'late';
}) => {
  const existingRequestTime = normalizeAgencyEntryTime(newHireRequest?.start_time ?? '', '');
  if (existingRequestTime) return existingRequestTime;

  const match = employees.find(
    (employee) =>
      String(employee.agency ?? '').trim() === String(agency ?? '').trim() &&
      String(employee.position ?? '').trim() === String(position ?? '').trim() &&
      String(employee.shift ?? '').trim() === String(shift ?? '').trim() &&
      Boolean(String(employee.start_time ?? '').trim())
  );

  return normalizeAgencyEntryTime(match?.start_time ?? '', DEFAULT_NEW_HIRE_ENTRY_TIME);
};

export { DEFAULT_NEW_HIRE_ENTRY_TIME };
