import { describe, expect, test } from 'vitest';
import { shouldShowAgencyLiveAbsent } from '../../src/agency/liveAbsent';

describe('agency live absent', () => {
  test('shows absent as soon as an early shift start time has passed without punch', () => {
    expect(
      shouldShowAgencyLiveAbsent({
        shift: 'early',
        startTime: '08:00',
        workDate: '2026-06-26',
        state: 'fixed_work',
        operationalDate: '2026-06-26',
        currentMinutes: 8 * 60,
        hasPunch: false,
        earlyShiftFallbackMinutes: 12 * 60
      })
    ).toBe(true);
  });

  test('does not show absent before the scheduled start time', () => {
    expect(
      shouldShowAgencyLiveAbsent({
        shift: 'early',
        startTime: '08:00',
        workDate: '2026-06-26',
        state: 'fixed_work',
        operationalDate: '2026-06-26',
        currentMinutes: 7 * 60 + 59,
        hasPunch: false,
        earlyShiftFallbackMinutes: 12 * 60
      })
    ).toBe(false);
  });

  test('uses start time for late shifts instead of waiting for the legacy cutoff', () => {
    expect(
      shouldShowAgencyLiveAbsent({
        shift: 'late',
        startTime: '15:00',
        workDate: '2026-06-26',
        state: 'temp_work',
        operationalDate: '2026-06-26',
        currentMinutes: 15 * 60 + 5,
        hasPunch: false,
        earlyShiftFallbackMinutes: 12 * 60
      })
    ).toBe(true);
  });

  test('falls back safely when start time is invalid', () => {
    expect(
      shouldShowAgencyLiveAbsent({
        shift: 'early',
        startTime: '',
        workDate: '2026-06-26',
        state: 'fixed_work',
        operationalDate: '2026-06-26',
        currentMinutes: 11 * 60 + 59,
        hasPunch: false,
        earlyShiftFallbackMinutes: 12 * 60
      })
    ).toBe(false);

    expect(
      shouldShowAgencyLiveAbsent({
        shift: 'early',
        startTime: '',
        workDate: '2026-06-26',
        state: 'fixed_work',
        operationalDate: '2026-06-26',
        currentMinutes: 12 * 60,
        hasPunch: false,
        earlyShiftFallbackMinutes: 12 * 60
      })
    ).toBe(true);
  });

  test('keeps non-working, punched, or non-operational rows out of absent', () => {
    expect(
      shouldShowAgencyLiveAbsent({
        shift: 'early',
        startTime: '08:00',
        workDate: '2026-06-26',
        state: 'rest',
        operationalDate: '2026-06-26',
        currentMinutes: 9 * 60,
        hasPunch: false,
        earlyShiftFallbackMinutes: 12 * 60
      })
    ).toBe(false);

    expect(
      shouldShowAgencyLiveAbsent({
        shift: 'early',
        startTime: '08:00',
        workDate: '2026-06-26',
        state: 'fixed_work',
        operationalDate: '2026-06-26',
        currentMinutes: 9 * 60,
        hasPunch: true,
        earlyShiftFallbackMinutes: 12 * 60
      })
    ).toBe(false);

    expect(
      shouldShowAgencyLiveAbsent({
        shift: 'early',
        startTime: '08:00',
        workDate: '2026-06-25',
        state: 'fixed_work',
        operationalDate: '2026-06-26',
        currentMinutes: 9 * 60,
        hasPunch: false,
        earlyShiftFallbackMinutes: 12 * 60
      })
    ).toBe(false);
  });
});
