import { expect, test } from '@playwright/test';
import { requireEnv } from './helpers';

test.describe('punch feature scripts', () => {
  test('punch page shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder(/Scan your barcode/i)).toBeVisible();
    await expect(page.getByText(/PUNCH LOG/i)).toBeVisible();
    await expect(page.getByText(/ATTENDANCE/i)).toBeVisible();
  });

  test('scan punch script (requires test data)', async ({ page }) => {
    requireEnv(['E2E_PUNCH_STAFF_ID']);
    await page.goto('/');
    await page.getByPlaceholder(/Scan your barcode/i).fill(String(process.env.E2E_PUNCH_STAFF_ID));
    await page.keyboard.press('Enter');
    await expect(page.getByText(/HELLO|BYE/i)).toBeVisible();
  });

  test('punch list filter buttons visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /PICK/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /PACK/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /REBIN/i })).toBeVisible();
  });
});
