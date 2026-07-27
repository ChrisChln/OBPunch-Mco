import { describe, expect, test } from 'vitest';

import {
  normalizeScheduleShiftTime,
  resolveScheduleShiftTimeChange
} from '../../src/admin/scheduleShiftTime';

describe('normalizeScheduleShiftTime', () => {
  test.each([
    ['8:00', '08:00'],
    ['08:00:00', '08:00'],
    ['8：30', '08:30']
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeScheduleShiftTime(input)).toBe(expected);
  });

  test.each(['', '25:00', 'not-a-time'])('rejects invalid value %s', (input) => {
    expect(normalizeScheduleShiftTime(input)).toBe('');
  });
});

describe('resolveScheduleShiftTimeChange', () => {
  test('returns a normalized changed value', () => {
    expect(resolveScheduleShiftTimeChange('07:00', '8:00')).toEqual({
      kind: 'changed',
      value: '08:00'
    });
  });

  test('returns unchanged for equivalent values', () => {
    expect(resolveScheduleShiftTimeChange('08:00', '8:00')).toEqual({
      kind: 'unchanged',
      value: '08:00'
    });
  });

  test('returns invalid for an empty or invalid draft', () => {
    expect(resolveScheduleShiftTimeChange('08:00', '')).toEqual({ kind: 'invalid' });
    expect(resolveScheduleShiftTimeChange('08:00', '26:00')).toEqual({ kind: 'invalid' });
  });
});
