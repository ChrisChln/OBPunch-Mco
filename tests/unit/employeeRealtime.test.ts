import { describe, expect, test } from 'vitest';

import { shouldEnableEmployeeRealtime } from '../../src/admin/useEmployeeRealtime';

describe('shouldEnableEmployeeRealtime', () => {
  test('enables realtime on employee-related pages', () => {
    expect(shouldEnableEmployeeRealtime('employees', false)).toBe(true);
    expect(shouldEnableEmployeeRealtime('accounts', false)).toBe(true);
    expect(shouldEnableEmployeeRealtime('employee_upload', false)).toBe(true);
  });

  test('enables realtime while departed modal is open', () => {
    expect(shouldEnableEmployeeRealtime('schedule', true)).toBe(true);
  });

  test('stays disabled on unrelated pages', () => {
    expect(shouldEnableEmployeeRealtime('schedule', false)).toBe(false);
    expect(shouldEnableEmployeeRealtime('home', false)).toBe(false);
  });
});
