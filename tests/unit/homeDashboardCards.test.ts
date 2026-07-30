import { describe, expect, test } from 'vitest';

import {
  HOME_DASHBOARD_CARD_POSITIONS,
  shouldRefreshHistoricalTimecard
} from '../../src/admin/pages/HomeDashboardPage';

describe('home dashboard cards', () => {
  test('does not show FLEX TEAM attendance cards', () => {
    expect(HOME_DASHBOARD_CARD_POSITIONS).not.toContain('FLEX TEAM');
  });
});

describe('home dashboard historical timecard refresh', () => {
  test('refreshes when the saved date matches the selected historical date', () => {
    expect(shouldRefreshHistoricalTimecard('2026-07-10', '2026-07-10', '2026-07-13')).toBe(true);
  });

  test('ignores saves for another date', () => {
    expect(shouldRefreshHistoricalTimecard('2026-07-09', '2026-07-10', '2026-07-13')).toBe(false);
  });

  test('leaves the live date to the parent refresh flow', () => {
    expect(shouldRefreshHistoricalTimecard('2026-07-13', '2026-07-13', '2026-07-13')).toBe(false);
  });
});
