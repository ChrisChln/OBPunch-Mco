import { describe, expect, test } from 'vitest';
import { calculateForecast } from '../../src/admin/forecast';

describe('calculateForecast', () => {
  test('computes forecast and interval from avg share and sd', () => {
    const result = calculateForecast(1200, 10, 3, {
      weekday: 3,
      hour_of_day: 10,
      avg_share: 0.4,
      stddev_share: 0.05,
      sample_size: 20
    });

    expect(result.forecast).toBeCloseTo(3000);
    expect(result.lowerBound).toBeCloseTo(2666.6667, 3);
    expect(result.upperBound).toBeCloseTo(3428.5714, 3);
    expect(result.upperUnbounded).toBe(false);
  });

  test('protects against zero avg share', () => {
    const result = calculateForecast(1200, 10, 3, {
      weekday: 3,
      hour_of_day: 10,
      avg_share: 0,
      stddev_share: 0.05,
      sample_size: 20
    });

    expect(result.forecast).toBeNull();
    expect(result.lowerBound).toBeNull();
    expect(result.upperBound).toBeNull();
  });

  test('returns unbounded upper forecast when avg share minus sd is not positive', () => {
    const result = calculateForecast(1200, 10, 3, {
      weekday: 3,
      hour_of_day: 10,
      avg_share: 0.12,
      stddev_share: 0.2,
      sample_size: 20
    });

    expect(result.lowerBound).toBeCloseTo(3750, 3);
    expect(result.upperUnbounded).toBe(true);
    expect(result.upperBound).toBe(Number.POSITIVE_INFINITY);
  });
});

