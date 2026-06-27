import { describe, expect, it } from 'vitest';

import { getScheduleMistakeDateRange } from '../../src/shared/scheduleMistakes';

describe('getScheduleMistakeDateRange', () => {
  it('builds a 7-day range ending on the operational date', () => {
    expect(getScheduleMistakeDateRange('2026-06-27')).toEqual({
      startDate: '2026-06-21',
      endDate: '2026-06-27'
    });
  });

  it('returns null for invalid operational dates', () => {
    expect(getScheduleMistakeDateRange('')).toBeNull();
    expect(getScheduleMistakeDateRange('2026/06/27')).toBeNull();
  });
});
