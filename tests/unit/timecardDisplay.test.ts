import { describe, expect, test } from 'vitest';
import {
  formatRoundedHours,
  getTimecardCellHoursText,
  getTimecardTotalHoursText
} from '../../src/admin/timecardDisplay';

describe('timecardDisplay', () => {
  test('formats positive hours with 2-digit rounding', () => {
    expect(formatRoundedHours(8)).toBe('8');
    expect(formatRoundedHours(8.156)).toBe('8.16');
    expect(formatRoundedHours(8.1)).toBe('8.1');
  });

  test('shows 0 for a day with punch activity that rounds down below 0.01h', () => {
    expect(
      getTimecardCellHoursText({
        hours: 4 / 3600,
        punchCount: 2,
        inProgress: false
      })
    ).toBe('0');
  });

  test('keeps empty text when there is no work time and no punch activity', () => {
    expect(
      getTimecardCellHoursText({
        hours: 0,
        punchCount: 0,
        inProgress: false
      })
    ).toBe('');
  });

  test('shows 0 in weekly total when punches exist but rounded total is 0', () => {
    expect(
      getTimecardTotalHoursText({
        totalHours: 4 / 3600,
        punchCounts: [0, 0, 2, 0, 0, 0, 0],
        inProgressWeek: false
      })
    ).toBe('0');
  });
});
