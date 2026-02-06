// Only allow "US" prefix + 3-12 digits, e.g. "US010454".
export const STAFF_ID_PATTERN = /^US\d{3,12}$/;

export const normalizeStaffId = (value: string) => value.trim().toUpperCase();

export const isValidStaffId = (value: string) => STAFF_ID_PATTERN.test(normalizeStaffId(value));
