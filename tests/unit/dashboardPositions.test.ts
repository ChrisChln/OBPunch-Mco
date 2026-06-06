import { describe, expect, test } from 'vitest';

import {
  buildDashboardCardPositions,
  buildDashboardPositionOptions,
  resolveDashboardPositionName
} from '../../src/shared/dashboardPositions';

describe('dashboard positions', () => {
  test('builds attendance cards from active custom positions without flex team', () => {
    expect(buildDashboardCardPositions(['Pick', 'Shipping', 'Lead', 'FLEX TEAM'], ['Returns'])).toEqual([
      'Pick',
      'Shipping',
      'Lead',
      'Returns'
    ]);
  });

  test('builds filter options from active positions before observed positions', () => {
    expect(buildDashboardPositionOptions(['Pick', 'Shipping'], ['shipping', 'Returns'])).toEqual([
      'Pick',
      'Shipping',
      'Returns'
    ]);
  });

  test('resolves custom position names and legacy aliases', () => {
    expect(resolveDashboardPositionName(' shipping ', ['Pick', 'Shipping'])).toBe('Shipping');
    expect(resolveDashboardPositionName('wrapup team', ['Pick', 'FLEX TEAM'])).toBe('FLEX TEAM');
    expect(resolveDashboardPositionName('Unknown', ['Pick', 'Shipping'])).toBe('');
  });
});
