const normalizeAgencyKey = (value: string) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const SCHEDULE_ONLY_AGENCIES = ['JDL', '自顾'] as const;

export const SCHEDULE_ONLY_AGENCY_KEYS = new Set<string>(SCHEDULE_ONLY_AGENCIES.map(normalizeAgencyKey));

export const isScheduleOnlyAgency = (value: string) => SCHEDULE_ONLY_AGENCY_KEYS.has(normalizeAgencyKey(value));

export const shouldTrackAttendanceForAgency = (value: string) => !isScheduleOnlyAgency(value);
