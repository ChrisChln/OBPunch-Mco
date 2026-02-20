import { expect, test } from '@playwright/test';
import { adminLogin, gotoAdminTab, requireEnv } from './helpers';

test.describe('admin schedule flows', () => {
  test.beforeEach(async () => {
    requireEnv(['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD']);
  });

  test('open daily list and change date', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Schedule|排班/i);
    await page.getByRole('button', { name: /Daily list|每日名单/i }).click();
    await expect(page.getByText(/Daily list|每日名单/i)).toBeVisible();

    const dateInput = page.locator('input[type="date"]').first();
    if (await dateInput.count()) {
      await dateInput.fill('2026-02-20');
      await expect(dateInput).toHaveValue('2026-02-20');
    }
  });

  test('new-hire demand modal opens with required fields', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Schedule|排班/i);
    await page.getByRole('button', { name: /Daily list|每日名单/i }).click();
    await page.getByRole('button', { name: /New hire demand|新人需求/i }).click();

    await expect(page.getByText(/New hire demand|新人需求/i)).toBeVisible();
    await expect(page.getByText(/Position|岗位/i)).toBeVisible();
    await expect(page.getByText(/Shift|班次/i)).toBeVisible();
    await expect(page.getByText(/Headcount|需求人数/i)).toBeVisible();
  });

  test('print sign-in sheet controls visible', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Schedule|排班/i);
    await expect(page.getByRole('button', { name: /Print sign-in sheet|打印签到表/i })).toBeVisible();
  });
});

