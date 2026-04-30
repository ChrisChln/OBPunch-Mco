import { describe, expect, test } from 'vitest';
import { isScheduleOnlyAgency, shouldTrackAttendanceForAgency } from '../../src/shared/agencyRules';

describe('agencyRules', () => {
  test('marks JDL as schedule-only agency', () => {
    expect(isScheduleOnlyAgency('JDL')).toBe(true);
    expect(isScheduleOnlyAgency('  jdl  ')).toBe(true);
  });

  test('keeps legacy 自顾 as schedule-only agency', () => {
    expect(isScheduleOnlyAgency('自顾')).toBe(true);
    expect(isScheduleOnlyAgency('  自顾  ')).toBe(true);
  });

  test('keeps normal agencies attendance-tracked', () => {
    expect(isScheduleOnlyAgency('OSI')).toBe(false);
    expect(shouldTrackAttendanceForAgency('OSI')).toBe(true);
  });

  test('excludes schedule-only agencies from attendance tracking', () => {
    expect(shouldTrackAttendanceForAgency('JDL')).toBe(false);
    expect(shouldTrackAttendanceForAgency('自顾')).toBe(false);
  });
});
