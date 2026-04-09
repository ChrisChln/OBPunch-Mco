const normalizeAgencyKey = (value: string) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const SCHEDULE_ONLY_AGENCY_KEYS = new Set<string>(['自顾'].map(normalizeAgencyKey));

export const isScheduleOnlyAgency = (value: string) => SCHEDULE_ONLY_AGENCY_KEYS.has(normalizeAgencyKey(value));

export const shouldTrackAttendanceForAgency = (value: string) => !isScheduleOnlyAgency(value);
