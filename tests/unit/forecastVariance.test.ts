import { describe, expect, test } from 'vitest';
import { formatSignedDifferenceQuantity, getForecastVariancePresentation } from '../../src/admin/forecastVariance';

describe('getForecastVariancePresentation', () => {
  test.each([
    [100, 109, 0.09, 9],
    [100, 91, -0.09, -9]
  ])('marks variance beyond 8%% as danger for either direction', (forecast, actual, variance, differenceQuantity) => {
    expect(getForecastVariancePresentation(forecast, actual)).toEqual({ variance, differenceQuantity, tone: 'danger' });
  });

  test.each([
    [100, 102, 0.02, 2],
    [100, 98, -0.02, -2]
  ])('marks variance below 3%% as success for either direction', (forecast, actual, variance, differenceQuantity) => {
    expect(getForecastVariancePresentation(forecast, actual)).toEqual({ variance, differenceQuantity, tone: 'success' });
  });

  test.each([
    [100, 103, 0.03, 3],
    [100, 108, 0.08, 8],
    [100, 95, -0.05, -5]
  ])('keeps the inclusive 3%% to 8%% range neutral', (forecast, actual, variance, differenceQuantity) => {
    expect(getForecastVariancePresentation(forecast, actual)).toEqual({ variance, differenceQuantity, tone: 'neutral' });
  });

  test.each([
    [null, 100],
    [100, null],
    [0, 100]
  ])('returns an empty presentation when comparison inputs are unavailable', (forecast, actual) => {
    expect(getForecastVariancePresentation(forecast, actual)).toEqual({ variance: null, differenceQuantity: null, tone: 'neutral' });
  });
});

describe('formatSignedDifferenceQuantity', () => {
  test.each([
    [1234, '+1,234'],
    [-1234, '-1,234'],
    [0, '0'],
    [null, '-']
  ])('formats %s as %s', (value, expected) => {
    expect(formatSignedDifferenceQuantity(value)).toBe(expected);
  });
});
