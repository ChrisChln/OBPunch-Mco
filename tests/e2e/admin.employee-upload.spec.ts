import { expect, test } from '@playwright/test';
import { adminLogin, gotoAdminTab, requireEnv } from './helpers';

test.describe('admin employee upload flows', () => {
  test.beforeEach(async () => {
    requireEnv(['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD']);
  });

  test('employee upload page controls', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Employee upload|员工上传/i);
    await expect(page.getByText(/Employee Upload|员工信息上传/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Download template|下载模版/i })).toBeVisible();
  });
});

