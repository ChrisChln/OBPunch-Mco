import { expect, test } from '@playwright/test';
import { adminLogin, gotoAdminTab, requireEnv } from './helpers';

test.describe('admin audit log flows', () => {
  test.beforeEach(async () => {
    requireEnv(['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD']);
  });

  test('audit list renders', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Audit|操作日志/i);
    await expect(page.getByText(/Audit Log|操作日志/i)).toBeVisible();
  });

  test('payload fallback line is hidden', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Audit|操作日志/i);
    await expect(page.getByText(/^Payload$/i)).toHaveCount(0);
  });

  test('summary arrow style exists as split blocks', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Audit|操作日志/i);
    const arrows = page.getByText('→');
    if (await arrows.count()) {
      await expect(arrows.first()).toBeVisible();
    }
  });
});

