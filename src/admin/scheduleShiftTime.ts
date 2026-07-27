import { formatClockMinutes, parseClockTextToMinutes } from './lateMarks';

export const normalizeScheduleShiftTime = (value: unknown): string => {
  const normalizedText = String(value ?? '')
    .trim()
    .replace(/：/g, ':')
    .replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');
  const parsed = parseClockTextToMinutes(normalizedText);
  if (!Number.isFinite(parsed)) return '';
  return formatClockMinutes(parsed as number);
};

export type ScheduleShiftTimeChange =
  | { kind: 'invalid' }
  | { kind: 'unchanged'; value: string }
  | { kind: 'changed'; value: string };

export const resolveScheduleShiftTimeChange = (
  currentValue: unknown,
  draftValue: unknown
): ScheduleShiftTimeChange => {
  const current = normalizeScheduleShiftTime(currentValue);
  const draft = normalizeScheduleShiftTime(draftValue);
  if (!draft) return { kind: 'invalid' };
  if (draft === current) return { kind: 'unchanged', value: draft };
  return { kind: 'changed', value: draft };
};
