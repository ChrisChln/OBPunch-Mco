import { describe, expect, test } from 'vitest';
import {
  buildEmployeeUploadRows,
  findInvalidEmployeeUploadPositions,
  normalizeEmployeeUploadPosition
} from '../../src/admin/employeeUploadPositions';

describe('employee upload position validation', () => {
  const positions = ['Pick', 'Shipping', 'Lead', 'FLEX TEAM'];

  test('accepts custom active positions', () => {
    expect(normalizeEmployeeUploadPosition('Shipping', positions)).toBe('Shipping');
    expect(findInvalidEmployeeUploadPositions([{ staff_id: 'US018638', position: 'Shipping' }], positions)).toEqual([]);
  });

  test('normalizes custom position casing and spacing', () => {
    expect(normalizeEmployeeUploadPosition('  shipping  ', positions)).toBe('Shipping');
    expect(normalizeEmployeeUploadPosition('lead', positions)).toBe('Lead');
  });

  test('keeps supported legacy aliases', () => {
    expect(normalizeEmployeeUploadPosition('wrap up team', positions)).toBe('FLEX TEAM');
  });

  test('reports positions outside the active custom range', () => {
    expect(findInvalidEmployeeUploadPositions([{ staff_id: 'US018639', position: 'Unknown' }], positions)).toEqual([
      { staff_id: 'US018639', position: 'Unknown' }
    ]);
  });

  test('allows imported employees without USID by assigning temporary editable IDs', () => {
    const result = buildEmployeeUploadRows(
      [
        {
          staff_id: '',
          name: 'Alex Chen',
          agency: 'OB',
          position: 'pick',
          employment_type: 'PT',
          shift_time: '09:00',
          label: 'New',
          work_account: 'alex.c',
          work_password: 'pw'
        }
      ],
      positions,
      { temporaryIdPrefix: 'TEMP-USID-TEST' }
    );

    expect(result.duplicateInFileCount).toBe(0);
    expect(result.rows).toEqual([
      {
        staff_id: 'TEMP-USID-TEST-0001',
        name: 'Alex Chen',
        agency: 'OB',
        position: 'Pick',
        employment_type: 'PT',
        shift_time: '09:00',
        label: 'New',
        work_account: 'alex.c',
        work_password: 'pw'
      }
    ]);
  });
});
