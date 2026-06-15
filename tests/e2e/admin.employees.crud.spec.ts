import { expect, test } from '@playwright/test';
import { adminLogin, gotoAdminTab, requireEnv } from './helpers';

const runId = `${Date.now()}`;
const staffId = `US9${runId.slice(-6)}`;
const employeeName = `E2E_${runId}`;

test.describe('admin employees CRUD flows', () => {
  test.beforeEach(async () => {
    requireEnv(['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD']);
  });

  test('create -> edit -> depart employee', async ({ page }) => {
    await adminLogin(page);
    await gotoAdminTab(page, /Employees|员工信息/i);

    await page.getByRole('button', { name: /Add employee|新增员工/i }).click();
    await page.getByPlaceholder(/Staff ID|员工ID/i).fill(staffId);
    await page.getByPlaceholder(/Name|姓名/i).fill(employeeName);
    await page.getByPlaceholder(/^Agency$/i).fill('E2E');
    await page.getByRole('combobox').nth(2).selectOption({ label: 'Pick' });
    await page.getByPlaceholder(/Label|标签/i).fill('E2E-LABEL');
    await page.getByPlaceholder(/Work account|工作账号/i).fill('e2e.account');
    await page.getByPlaceholder(/Work password|工作密码/i).fill('e2e.password');
    await page.getByRole('button', { name: /^Add$|^添加$/i }).click();

    await page.getByPlaceholder(/Search by id|通过ID/i).fill(staffId);
    await page.getByRole('button', { name: /Search|搜索/i }).click();
    await expect(page.getByText(employeeName)).toBeVisible();

    await page.getByRole('button', { name: /Edit|编辑/i }).first().click();
    const editDialog = page.locator('div').filter({ hasText: /Edit employee|编辑员工/i }).first();
    await editDialog.locator('label:has-text("Work account") + input, label:has-text("工作账号") + input').fill('e2e.account.updated');
    await editDialog.locator('label:has-text("Work password") + input, label:has-text("工作密码") + input').fill('e2e.password.updated');
    await page.getByRole('button', { name: /^Save$|^保存$/i }).click();

    await expect(page.getByText(/e2e\.account\.updated/i)).toBeVisible();

    await page.getByRole('button', { name: /Depart|离职/i }).first().click();
    await page.getByRole('radio', { name: /Normal|正常离职/i }).check();
    await page.getByRole('button', { name: /^Confirm$|^确认$/i }).click();
  });
});
