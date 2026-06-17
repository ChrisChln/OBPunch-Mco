import { describe, expect, test } from 'vitest';
import {
  createManualTemporaryStaffId,
  isNewHirePlaceholderStaffId,
  resolveEmployeeEditStaffIds
} from '../../src/admin/tempStaffIds';

describe('temporary staff ids', () => {
  test('creates the next manual TUS id for new temporary employees', () => {
    expect(createManualTemporaryStaffId(['US010454', 'TUS0000002', 'TUS0000082'])).toBe('TUS0000083');
  });

  test('keeps an existing TUS id when editing with an empty staff input', () => {
    expect(resolveEmployeeEditStaffIds('TUS0000082', '')).toEqual({
      originalStaff: 'TUS0000082',
      nextStaff: 'TUS0000082',
      isPlaceholderOriginal: true
    });
  });

  test('normalizes explicit edit targets', () => {
    expect(resolveEmployeeEditStaffIds('TUS0000082', 'us012345')).toEqual({
      originalStaff: 'TUS0000082',
      nextStaff: 'US012345',
      isPlaceholderOriginal: true
    });
  });

  test('recognizes generated placeholder staff ids', () => {
    expect(isNewHirePlaceholderStaffId('TUS0000001')).toBe(true);
    expect(isNewHirePlaceholderStaffId('TEMP-USID-TEST-0001')).toBe(true);
    expect(isNewHirePlaceholderStaffId('US010454')).toBe(false);
  });
});
