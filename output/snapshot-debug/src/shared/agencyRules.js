const normalizeAgencyKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export const SCHEDULE_ONLY_AGENCIES = ['JDL', '自顾'];
export const SCHEDULE_ONLY_AGENCY_KEYS = new Set(SCHEDULE_ONLY_AGENCIES.map(normalizeAgencyKey));
export const isScheduleOnlyAgency = (value) => SCHEDULE_ONLY_AGENCY_KEYS.has(normalizeAgencyKey(value));
export const shouldTrackAttendanceForAgency = (value) => !isScheduleOnlyAgency(value);
