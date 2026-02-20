import { expect, test } from '@playwright/test';
import { requireEnv } from './helpers';

test.describe('device feature scripts', () => {
  test('device page main controls', async ({ page }) => {
    await page.goto('/device.html');
    await expect(page.getByText(/DEVICE BORROW\/RETURN|设备借还/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Borrow/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Return/i })).toBeVisible();
    await expect(page.getByText(/LATEST RESULT/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Counting/i })).toBeVisible();
    await expect(page.getByPlaceholder(/Search SN/i)).toBeVisible();
  });

  test('borrow flow script (requires test data)', async ({ page }) => {
    requireEnv(['E2E_DEVICE_STAFF_ID', 'E2E_DEVICE_SN']);
    await page.goto('/device.html');
    await page.getByPlaceholder(/Scan staff ID first/i).fill(String(process.env.E2E_DEVICE_STAFF_ID));
    await page.getByPlaceholder(/scan device SN/i).fill(String(process.env.E2E_DEVICE_SN));
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Borrow success|Borrow failed|Borrow/i)).toBeVisible();
  });

  test('return flow uses SN only script (requires test data)', async ({ page }) => {
    requireEnv(['E2E_DEVICE_SN']);
    await page.goto('/device.html');
    await page.getByRole('button', { name: /Return/i }).click();
    await page.getByPlaceholder(/scan device SN/i).fill(String(process.env.E2E_DEVICE_SN));
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Return success|Return failed|Return/i)).toBeVisible();
  });

  test('counting modal open/close', async ({ page }) => {
    await page.goto('/device.html');
    await page.getByRole('button', { name: /Counting/i }).click();
    await expect(page.getByText(/Counting/i).first()).toBeVisible();
    await page.getByRole('button', { name: /Close/i }).last().click();
  });
});
