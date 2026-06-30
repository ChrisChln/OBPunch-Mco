import { expect, test } from '@playwright/test';
import { adminLogin, gotoAdminTab, requireEnv } from './helpers';

test.describe('admin device management flows', () => {
  test.beforeEach(async () => {
    requireEnv(['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD']);
  });

  test('devices page main controls', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Devices|设备管理/i);

    await expect(page.getByRole('button', { name: /Import devices|导入设备/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Download template|下载模版/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export|导出/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Batch print labels|批量打印标签/i })).toBeVisible();
  });

  test('device cards show SN and status text', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Devices|设备管理/i);
    await expect(page.getByText(/SN:/i).first()).toBeVisible();
    await expect(page.getByText(/Available|Borrowed|空闲|借用中/i).first()).toBeVisible();
  });
});
