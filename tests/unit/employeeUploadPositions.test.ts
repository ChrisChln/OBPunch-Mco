import { describe, expect, test } from 'vitest';
import {
  buildEmployeeUploadRows,
  detectEmployeeImportIdentityConflicts,
  findInvalidEmployeeUploadPositions,
  isGeneratedEmployeeUploadStaffId,
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

  test('does not flag generated temporary new-hire IDs as modified USIDs', () => {
    const result = detectEmployeeImportIdentityConflicts(
      [
        {
          staff_id: 'TEMP-USID-TEST-0001',
          name: 'Alex Chen',
          agency: 'OB',
          position: 'Pick',
          employment_type: 'FT',
          work_account: ''
        }
      ],
      [{ staff_id: 'US018949', name: 'Alex Chen', agency: 'OB', work_account: 'alex.c' }]
    );

    expect(isGeneratedEmployeeUploadStaffId('TEMP-USID-TEST-0001')).toBe(true);
    expect(result.modifiedStaffIds).toEqual([]);
    expect(result.duplicateWorkAccounts).toEqual([]);
  });

  test('reports duplicate work accounts for generated temporary new-hire IDs without calling them USID edits', () => {
    const result = detectEmployeeImportIdentityConflicts(
      [
        {
          staff_id: 'TEMP-USID-TEST-0001',
          name: 'New Hire',
          agency: 'OB',
          position: 'Pick',
          employment_type: 'FT',
          work_account: 'alex.c'
        }
      ],
      [{ staff_id: 'US018949', name: 'Alex Chen', agency: 'OB', work_account: 'alex.c' }]
    );

    expect(result.modifiedStaffIds).toEqual([]);
    expect(result.duplicateWorkAccounts).toEqual(['TEMP-USID-TEST-0001 -> US018949 (work_account)']);
  });
});
