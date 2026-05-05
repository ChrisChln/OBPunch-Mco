// Only allow "US" prefix + 3-12 digits, e.g. "US010454".
import { isScheduleOnlyAgency } from '../shared/agencyRules';

export const STAFF_ID_PATTERN = /^US\d{3,12}$/;
const SCHEDULE_ONLY_STAFF_ID_PATTERN = /^[A-Z0-9_-]{1,64}$/;

export const normalizeStaffId = (value: string) => value.trim().toUpperCase();

export const isValidStaffId = (value: string) => STAFF_ID_PATTERN.test(normalizeStaffId(value));

export const isValidScheduleStaffId = (value: string, agency: string) => {
  const normalized = normalizeStaffId(value);
  if (isValidStaffId(normalized)) return true;
  return isScheduleOnlyAgency(agency) && SCHEDULE_ONLY_STAFF_ID_PATTERN.test(normalized);
};

export const isValidStaffIdForUpdate = (originalValue: string, nextValue: string) => {
  const original = normalizeStaffId(originalValue);
  const next = normalizeStaffId(nextValue);

  return original === next || isValidStaffId(next);
};
