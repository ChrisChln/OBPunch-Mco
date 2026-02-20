import { expect, test } from '@playwright/test';
import { adminLogin, gotoAdminTab, requireEnv } from './helpers';

test.describe('admin printing flows', () => {
  test.beforeEach(async () => {
    requireEnv(['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD']);
  });

  test('schedule print controls visible', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Schedule|排班/i);
    await expect(page.getByRole('button', { name: /Print sign-in sheet|打印签到表/i })).toBeVisible();
  });

  test('employee badge print button visible', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Employees|员工信息/i);
    await expect(page.getByRole('button', { name: /Print badge|打印工牌/i }).first()).toBeVisible();
  });
});

