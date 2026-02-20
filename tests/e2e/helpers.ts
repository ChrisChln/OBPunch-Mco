import type { Page } from '@playwright/test';
import { test } from '@playwright/test';

export const requireEnv = (keys: string[]) => {
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  test.skip(missing.length > 0, `Missing env: ${missing.join(', ')}`);
};

export const adminLogin = async (page: Page) => {
  await page.goto('/admin.html');
  await page.getByPlaceholder(/Email/i).fill(String(process.env.E2E_ADMIN_EMAIL));
  await page.getByPlaceholder(/Password/i).fill(String(process.env.E2E_ADMIN_PASSWORD));
  await page.getByRole('button', { name: /Login|登录/i }).click();
  await page.getByText(/Admin Console|后台系统/i).waitFor();
  await ensureEnglish(page);
};

export const ensureEnglish = async (page: Page) => {
  const enBtn = page.getByRole('button', { name: /^EN$/i });
  if (await enBtn.count()) {
    await enBtn.first().click();
  }
};

export const gotoAdminTab = async (page: Page, name: RegExp) => {
  await page.getByRole('button', { name }).first().click();
};
