import { describe, expect, it } from 'vitest';
import { buildStaffIdsByDate, hasSystemHoursCoverage, mergeSystemHoursEntry } from '../../src/admin/workHourStats';

describe('workHourStats', () => {
  it('builds distinct staff buckets by work date', () => {
    const result = buildStaffIdsByDate([
      { workDate: '2026-04-06', staffId: 'US0001' },
      { workDate: '2026-04-06', staffId: 'US0001' },
      { workDate: '2026-04-06', staffId: 'US0002' },
      { workDate: '2026-04-07', staffId: 'US0003' }
    ]);

    expect(Array.from(result.get('2026-04-06') ?? [])).toEqual(['US0001', 'US0002']);
    expect(Array.from(result.get('2026-04-07') ?? [])).toEqual(['US0003']);
  });

  it('checks cache coverage against requested staff ids', () => {
    const entry = {
      hoursByStaff: new Map([
        ['US0001', 8],
        ['US0002', 7.5]
      ]),
      coveredStaffIds: new Set(['US0001', 'US0002'])
    };

    expect(hasSystemHoursCoverage(entry, ['US0001'])).toBe(true);
    expect(hasSystemHoursCoverage(entry, ['US0001', 'US0002'])).toBe(true);
    expect(hasSystemHoursCoverage(entry, ['US0001', 'US0003'])).toBe(false);
  });

  it('merges new fetched hours and coverage into cache entry', () => {
    const merged = mergeSystemHoursEntry(
      {
        hoursByStaff: new Map([['US0001', 8]]),
        coveredStaffIds: new Set(['US0001'])
      },
      ['US0001', 'US0002'],
      new Map([['US0002', 6.25]])
    );

    expect(Array.from(merged.hoursByStaff.entries())).toEqual([
      ['US0001', 8],
      ['US0002', 6.25]
    ]);
    expect(Array.from(merged.coveredStaffIds.values())).toEqual(['US0001', 'US0002']);
  });
});
