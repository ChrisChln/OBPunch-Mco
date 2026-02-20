import { expect, test } from '@playwright/test';

test.describe('entry pages smoke', () => {
  test('punch page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ObPunch/i);
  });

  test('admin page renders', async ({ page }) => {
    await page.goto('/admin.html');
    await expect(page).toHaveTitle(/ObPunch Admin/i);
    await expect(page.getByText(/管理员登录|Admin/i)).toBeVisible();
  });

  test('device page renders', async ({ page }) => {
    await page.goto('/device.html');
    await expect(page).toHaveTitle(/ObPunch Device/i);
    await expect(page.getByText(/DEVICE BORROW\/RETURN|设备借还/i)).toBeVisible();
  });
});

