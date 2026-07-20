import { describe, expect, test } from 'vitest';
import { formatWorkHourPunchDateTime } from '../../src/admin/workHourComparisonDisplay';

describe('workHourComparisonDisplay', () => {
  test('formats a local punch timestamp with hyphen-separated date components', () => {
    expect(formatWorkHourPunchDateTime('2026-07-17T15:50:12')).toBe('2026-07-17 15:50:12');
  });

  test('returns a fallback for an invalid punch timestamp', () => {
    expect(formatWorkHourPunchDateTime('not-a-date')).toBe('-');
  });
});
