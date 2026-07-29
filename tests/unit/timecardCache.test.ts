import { describe, expect, it } from 'vitest';
import { shouldUseTimecardWeekCache } from '../../src/admin/timecardCache';

describe('shouldUseTimecardWeekCache', () => {
  it('uses the cache for the same week during a normal load', () => {
    expect(
      shouldUseTimecardWeekCache({
        cachedWeekKey: '2026-07-20',
        requestedWeekKey: '2026-07-20',
        bypassCache: false
      })
    ).toBe(true);
  });

  it('does not use the cache after a write requests a forced refresh', () => {
    expect(
      shouldUseTimecardWeekCache({
        cachedWeekKey: '2026-07-20',
        requestedWeekKey: '2026-07-20',
        bypassCache: true
      })
    ).toBe(false);
  });

  it('does not use a cache entry from another week', () => {
    expect(
      shouldUseTimecardWeekCache({
        cachedWeekKey: '2026-07-13',
        requestedWeekKey: '2026-07-20',
        bypassCache: false
      })
    ).toBe(false);
  });
});
