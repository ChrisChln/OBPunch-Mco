import { describe, expect, test } from 'vitest';

import { HOME_DASHBOARD_CARD_POSITIONS } from '../../src/admin/pages/HomeDashboardPage';

describe('home dashboard cards', () => {
  test('does not show FLEX TEAM attendance cards', () => {
    expect(HOME_DASHBOARD_CARD_POSITIONS).not.toContain('FLEX TEAM');
  });
});
