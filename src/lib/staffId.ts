export const STAFF_ID_PATTERN = /^[A-Za-z]{0,4}\d{3,12}$/;

export const normalizeStaffId = (value: string) => value.trim().toUpperCase();

export const isValidStaffId = (value: string) => STAFF_ID_PATTERN.test(normalizeStaffId(value));

