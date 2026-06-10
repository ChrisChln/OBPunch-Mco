import { describe, expect, it } from 'vitest';
import { matchesScheduleDriverFilter, normalizeScheduleDriverFilterValue } from '../../src/admin/scheduleDriverFilter';

describe('normalizeScheduleDriverFilterValue', () => {
  it('treats driver labels and plain numbers as the same group', () => {
    expect(normalizeScheduleDriverFilterValue('driver1')).toBe('1');
    expect(normalizeScheduleDriverFilterValue('Driver 1')).toBe('1');
    expect(normalizeScheduleDriverFilterValue('1')).toBe('1');
  });

  it('keeps the numeric part only', () => {
    expect(normalizeScheduleDriverFilterValue('driver')).toBe('');
    expect(normalizeScheduleDriverFilterValue('team1')).toBe('1');
  });
});

describe('matchesScheduleDriverFilter', () => {
  it('matches members and drivers by numeric code', () => {
    expect(matchesScheduleDriverFilter('Driver5', '5')).toBe(true);
    expect(matchesScheduleDriverFilter('5', 'driver5')).toBe(true);
    expect(matchesScheduleDriverFilter('4', 'driver5')).toBe(false);
  });
});
