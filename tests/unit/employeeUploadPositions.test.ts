import { describe, expect, test } from 'vitest';
import {
  buildEmployeeUploadRows,
  detectEmployeeImportIdentityConflicts,
  findTemporaryEmployeeUploadMatches,
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
    const defaultResult = buildEmployeeUploadRows([{ staff_id: '', name: 'Taylor', agency: 'OB' }], positions);
    expect(defaultResult.rows[0]?.staff_id).toBe('TUS0000001');

    const result = buildEmployeeUploadRows(
      [
        {
          staff_id: '',
          name: 'Alex Chen',
          agency: 'OB',
          position: 'pick',
          employment_type: 'PT',
          Shift: 'Day',
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
        shift: 'early',
        shift_time: '09:00',
        label: 'New',
        work_account: 'alex.c',
        work_password: 'pw'
      }
    ]);
  });

  test('normalizes uploaded shift labels', () => {
    const result = buildEmployeeUploadRows(
      [
        { staff_id: 'US000001', position: 'Shipping', Shift: 'Day', employment_type: 'FT' },
        { staff_id: 'US000002', position: 'Shipping', Shift: 'Night', employment_type: 'FT' }
      ],
      positions
    );

    expect(result.rows.map((row) => ({ staff_id: row.staff_id, shift: row.shift }))).toEqual([
      { staff_id: 'US000001', shift: 'early' },
      { staff_id: 'US000002', shift: 'late' }
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
    expect(isGeneratedEmployeeUploadStaffId('TUS0000001')).toBe(true);
    expect(result.modifiedStaffIds).toEqual([]);
    expect(result.duplicateWorkAccounts).toEqual([]);
  });

  test('allows USID changes when name and agency match an existing temporary employee', () => {
    const result = detectEmployeeImportIdentityConflicts(
      [
        {
          staff_id: 'US018928',
          name: 'Barbara Rujano',
          agency: 'Central',
          position: 'Pick',
          employment_type: 'FT',
          work_account: ''
        }
      ],
      [{ staff_id: 'TEMP-USID-MQ2VLTPL-0002', name: 'Barbara Rujano', agency: 'Central', work_account: '' }]
    );

    expect(result.modifiedStaffIds).toEqual([]);
    expect(result.duplicateWorkAccounts).toEqual([]);
  });

  test('matches real USIDs to unique temporary employees by name and agency', () => {
    const result = findTemporaryEmployeeUploadMatches(
      [
        {
          staff_id: 'US018928',
          name: 'Barbara Rujano',
          agency: 'Central',
          position: 'Putaway',
          employment_type: 'FT',
          work_account: 'ib-barbararujano'
        }
      ],
      [{ staff_id: 'TEMP-USID-MQ2VLTPL-0002', name: 'Barbara Rujano', agency: 'Central', work_account: '' }]
    );

    expect(result).toEqual([
      {
        incomingStaffId: 'US018928',
        temporaryStaffId: 'TEMP-USID-MQ2VLTPL-0002'
      }
    ]);
  });

  test('does not match ambiguous temporary employees by name and agency', () => {
    const result = findTemporaryEmployeeUploadMatches(
      [
        {
          staff_id: 'US018928',
          name: 'Barbara Rujano',
          agency: 'Central',
          position: 'Putaway',
          employment_type: 'FT',
          work_account: ''
        }
      ],
      [
        { staff_id: 'TEMP-USID-MQ2VLTPL-0002', name: 'Barbara Rujano', agency: 'Central', work_account: '' },
        { staff_id: 'TEMP-USID-MQ2VLTPL-0099', name: 'Barbara Rujano', agency: 'Central', work_account: '' }
      ]
    );

    expect(result).toEqual([]);
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
