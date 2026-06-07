export const AGENCY_NOTE_MAX_LENGTH = 500;

export const normalizeAgencyNote = (value: unknown) =>
  String(value ?? '').trim().slice(0, AGENCY_NOTE_MAX_LENGTH);
