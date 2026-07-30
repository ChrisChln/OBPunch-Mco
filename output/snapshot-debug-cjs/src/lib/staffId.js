"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidStaffIdForUpdate = exports.isValidScheduleStaffId = exports.isValidPunchStaffId = exports.isSchedulePlaceholderStaffId = exports.isValidStaffId = exports.normalizeStaffId = exports.STAFF_ID_PATTERN = void 0;
// Only allow "US" prefix + 3-12 digits, e.g. "US010454".
const agencyRules_js_1 = require("../shared/agencyRules.js");
exports.STAFF_ID_PATTERN = /^US\d{3,12}$/;
const SCHEDULE_ONLY_STAFF_ID_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const SCHEDULE_PLACEHOLDER_STAFF_ID_PATTERNS = [
    /^TUS\d{7,}$/,
    /^TEMP-USID-[A-Z0-9]+-\d{4,}$/,
    /^NEWREQ-\d{8}(?:-[A-Z]+)?-\d{3,}$/,
    /^\d{4}[A-Z]+\d{3,}$/,
    /^TMPACC-[A-Z0-9_-]{1,58}$/
];
const normalizeStaffId = (value) => value.trim().toUpperCase();
exports.normalizeStaffId = normalizeStaffId;
const isValidStaffId = (value) => exports.STAFF_ID_PATTERN.test((0, exports.normalizeStaffId)(value));
exports.isValidStaffId = isValidStaffId;
const isSchedulePlaceholderStaffId = (value) => {
    const normalized = (0, exports.normalizeStaffId)(value);
    return SCHEDULE_PLACEHOLDER_STAFF_ID_PATTERNS.some((pattern) => pattern.test(normalized));
};
exports.isSchedulePlaceholderStaffId = isSchedulePlaceholderStaffId;
const isValidPunchStaffId = (value) => {
    const normalized = (0, exports.normalizeStaffId)(value);
    return (0, exports.isValidStaffId)(normalized) || (0, exports.isSchedulePlaceholderStaffId)(normalized);
};
exports.isValidPunchStaffId = isValidPunchStaffId;
const isValidScheduleStaffId = (value, agency) => {
    const normalized = (0, exports.normalizeStaffId)(value);
    if ((0, exports.isValidStaffId)(normalized))
        return true;
    if ((0, exports.isSchedulePlaceholderStaffId)(normalized))
        return true;
    return (0, agencyRules_js_1.isScheduleOnlyAgency)(agency) && SCHEDULE_ONLY_STAFF_ID_PATTERN.test(normalized);
};
exports.isValidScheduleStaffId = isValidScheduleStaffId;
const isValidStaffIdForUpdate = (originalValue, nextValue) => {
    const original = (0, exports.normalizeStaffId)(originalValue);
    const next = (0, exports.normalizeStaffId)(nextValue);
    return original === next || (0, exports.isValidStaffId)(next);
};
exports.isValidStaffIdForUpdate = isValidStaffIdForUpdate;
