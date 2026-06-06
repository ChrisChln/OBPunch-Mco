import { describe, expect, test } from 'vitest';
import { normalizeEmployeeUploadPosition, findInvalidEmployeeUploadPositions } from '../../src/admin/employeeUploadPositions';

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
});
