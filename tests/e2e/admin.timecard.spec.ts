import { expect, test } from '@playwright/test';
import { adminLogin, gotoAdminTab, requireEnv } from './helpers';

test.describe('admin timecard flows', () => {
  test.beforeEach(async () => {
    requireEnv(['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD']);
  });

  test('timecard filters and toolbar are visible', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Timecard|时间卡/i);

    await expect(page.getByRole('button', { name: /Refresh|刷新/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export|导出/i }).first()).toBeVisible();
    await expect(page.getByText(/Agency/i)).toBeVisible();
    await expect(page.getByText(/Position/i)).toBeVisible();
    await expect(page.getByText(/Shift/i)).toBeVisible();
  });

  test('timecard shows weekly columns', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Timecard|时间卡/i);
    await expect(page.getByText(/MON|TUE|WED|THU|FRI/i).first()).toBeVisible();
  });
});

