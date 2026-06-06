import { describe, expect, test } from 'vitest';
import {
  buildDailyListLightsSettingValue,
  normalizeDailyListLightPosition,
  readDailyListLightsForDate
} from '../../src/shared/dailyListLights';

describe('dailyListLights', () => {
  test('normalizes known aliases and keeps custom positions', () => {
    expect(normalizeDailyListLightPosition('pre ship')).toBe('Preship');
    expect(normalizeDailyListLightPosition('  outbound qc  ')).toBe('outbound qc');
  });

  test('preserves custom position flags by date', () => {
    const value = buildDailyListLightsSettingValue(
      null,
      '2026-06-07',
      {
        Pick: true,
        'Outbound QC': true
      },
      { updatedAt: '2026-06-06T12:00:00.000Z', operator: 'admin@example.com' }
    );

    expect(readDailyListLightsForDate(value, '2026-06-07')).toMatchObject({
      Pick: true,
      'Outbound QC': true
    });
  });
});
