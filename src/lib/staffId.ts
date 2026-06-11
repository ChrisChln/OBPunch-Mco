// Only allow "US" prefix + 3-12 digits, e.g. "US010454".
import { isScheduleOnlyAgency } from '../shared/agencyRules.js';

export const STAFF_ID_PATTERN = /^US\d{3,12}$/;
const SCHEDULE_ONLY_STAFF_ID_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const SCHEDULE_PLACEHOLDER_STAFF_ID_PATTERNS = [
  /^TUS\d{7,}$/,
  /^TEMP-USID-[A-Z0-9]+-\d{4,}$/,
  /^NEWREQ-\d{8}(?:-[A-Z]+)?-\d{3,}$/,
  /^\d{4}[A-Z]+\d{3,}$/,
  /^TMPACC-[A-Z0-9_-]{1,58}$/
];

export const normalizeStaffId = (value: string) => value.trim().toUpperCase();

export const isValidStaffId = (value: string) => STAFF_ID_PATTERN.test(normalizeStaffId(value));

export const isSchedulePlaceholderStaffId = (value: string) => {
  const normalized = normalizeStaffId(value);
  return SCHEDULE_PLACEHOLDER_STAFF_ID_PATTERNS.some((pattern) => pattern.test(normalized));
};

export const isValidPunchStaffId = (value: string) => {
  const normalized = normalizeStaffId(value);
  return isValidStaffId(normalized) || isSchedulePlaceholderStaffId(normalized);
};

export const isValidScheduleStaffId = (value: string, agency: string) => {
  const normalized = normalizeStaffId(value);
  if (isValidStaffId(normalized)) return true;
  if (isSchedulePlaceholderStaffId(normalized)) return true;
  return isScheduleOnlyAgency(agency) && SCHEDULE_ONLY_STAFF_ID_PATTERN.test(normalized);
};

export const isValidStaffIdForUpdate = (originalValue: string, nextValue: string) => {
  const original = normalizeStaffId(originalValue);
  const next = normalizeStaffId(nextValue);

  return original === next || isValidStaffId(next);
};
