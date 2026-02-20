import { describe, expect, test } from 'vitest';
import { isValidStaffId, normalizeStaffId, STAFF_ID_PATTERN } from '../../src/lib/staffId';

describe('staffId', () => {
  test('normalizes to uppercase + trim', () => {
    expect(normalizeStaffId('  us010454  ')).toBe('US010454');
  });

  test('validates allowed format', () => {
    expect(STAFF_ID_PATTERN.test('US123')).toBe(true);
    expect(STAFF_ID_PATTERN.test('US123456789012')).toBe(true);
    expect(isValidStaffId('us010454')).toBe(true);
  });

  test('rejects invalid values', () => {
    expect(isValidStaffId('US12')).toBe(false);
    expect(isValidStaffId('AB010454')).toBe(false);
    expect(isValidStaffId('US010454X')).toBe(false);
  });
});

