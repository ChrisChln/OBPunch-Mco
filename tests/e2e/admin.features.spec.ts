import { expect, test } from '@playwright/test';
import { adminLogin, gotoAdminTab, requireEnv } from './helpers';

test.describe('admin core pages', () => {
  test.beforeEach(async () => {
    requireEnv(['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD']);
  });

  test('navigation tabs are reachable', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Home|首页/i);
    await expect(page.getByRole('button', { name: /Employees|员工信息/i })).toBeVisible();

    await gotoAdminTab(page, /Employees|员工信息/i);
    await expect(page.getByText(/Employees|员工信息/i)).toBeVisible();

    await gotoAdminTab(page, /Timecard|时间卡/i);
    await expect(page.getByText(/Timecard|时间卡/i)).toBeVisible();

    await gotoAdminTab(page, /Punches|打卡流水/i);
    await expect(page.getByText(/Punch Log|打卡流水/i)).toBeVisible();

    await gotoAdminTab(page, /Audit|操作日志/i);
    await expect(page.getByText(/Audit Log|操作日志/i)).toBeVisible();

    await gotoAdminTab(page, /Schedule|排班/i);
    await expect(page.getByText(/Schedule|排班/i)).toBeVisible();

    await gotoAdminTab(page, /Devices|设备管理/i);
    await expect(page.getByText(/Devices|设备管理/i)).toBeVisible();
  });

  test('employees table includes new columns', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Employees|员工信息/i);
    await expect(page.getByText(/Work account|工作账号/i)).toBeVisible();
    await expect(page.getByText(/Work password|工作密码/i)).toBeVisible();
  });

  test('timecard page controls exist', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Timecard|时间卡/i);
    await expect(page.getByRole('button', { name: /Refresh|刷新/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export|导出/i }).first()).toBeVisible();
  });

  test('schedule page controls exist', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Schedule|排班/i);
    await expect(page.getByRole('button', { name: /Daily list|每日名单/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Print sign-in sheet|打印签到表/i })).toBeVisible();
  });

  test('audit page visible', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Audit|操作日志/i);
    await expect(page.getByText(/Audit Log|操作日志/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Refresh|刷新/i })).toBeVisible();
  });

  test('devices admin page visible', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Devices|设备管理/i);
    await expect(page.getByText(/Devices|设备管理/i)).toBeVisible();
    await expect(page.getByPlaceholder(/Search/i)).toBeVisible();
  });
});
