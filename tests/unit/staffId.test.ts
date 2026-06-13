import { describe, expect, test } from 'vitest';
import {
  isValidPunchStaffId,
  isValidScheduleStaffId,
  isValidStaffId,
  isValidStaffIdForUpdate,
  normalizeStaffId,
  STAFF_ID_PATTERN
} from '../../src/lib/staffId';

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

  test('allows unchanged legacy staff IDs during updates', () => {
    expect(isValidStaffIdForUpdate('SOFISUAZAT', ' sofisuazat ')).toBe(true);
  });

  test('requires valid format when staff ID changes', () => {
    expect(isValidStaffIdForUpdate('SOFISUAZAT', 'US010454')).toBe(true);
    expect(isValidStaffIdForUpdate('SOFISUAZAT', 'SOFIA')).toBe(false);
  });

  test('allows schedule-only agency IDs for scheduling only', () => {
    expect(isValidScheduleStaffId('JDLPICK001', 'JDL')).toBe(true);
    expect(isValidScheduleStaffId('OWNTEAM001', '自顾')).toBe(true);
    expect(isValidScheduleStaffId('JDLPICK001', 'Agency A')).toBe(false);
    expect(isValidScheduleStaffId('', 'JDL')).toBe(false);
  });

  test('allows schedule placeholder IDs without an agency', () => {
    expect(isValidScheduleStaffId('0606PICK001', '')).toBe(true);
    expect(isValidScheduleStaffId('TUS0000001', '')).toBe(true);
    expect(isValidScheduleStaffId('NEWREQ-20260606-PICK-001', '')).toBe(true);
    expect(isValidScheduleStaffId('TEMP-USID-PICK-0001', '')).toBe(true);
    expect(isValidScheduleStaffId('TMPACC-60100001', '')).toBe(true);
  });

  test('allows official and temporary IDs for punch', () => {
    expect(isValidPunchStaffId('US010454')).toBe(true);
    expect(isValidPunchStaffId('TUS0000001')).toBe(true);
    expect(isValidPunchStaffId('0606PICK001')).toBe(true);
    expect(isValidPunchStaffId('NEWREQ-20260606-PICK-001')).toBe(true);
    expect(isValidPunchStaffId('TEMP-USID-PICK-0001')).toBe(true);
    expect(isValidPunchStaffId('TMPACC-60100001')).toBe(true);
    expect(isValidPunchStaffId('YANI')).toBe(false);
  });
});
