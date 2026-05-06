import { describe, expect, test } from 'vitest';
import {
  formatRoundedHours,
  getTimecardCellHoursText,
  getTimecardExportDayCellText,
  getTimecardTerminatedByDay,
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

  test('exports absent marker when a day has no hours and is absent', () => {
    expect(
      getTimecardExportDayCellText({
        hours: 0,
        punchCount: 0,
        inProgress: false,
        absent: true
      })
    ).toBe('缺勤');

    expect(
      getTimecardExportDayCellText({
        hours: 8.2,
        punchCount: 4,
        inProgress: false,
        absent: true
      })
    ).toBe('8.2');
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

  test('marks the termination day and later days as terminated', () => {
    expect(
      getTimecardTerminatedByDay({
        terminatedAt: '2026-03-18T15:50:06.336Z',
        weekDateKeys: ['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22']
      })
    ).toEqual([false, false, true, true, true, true, true]);
  });
});
