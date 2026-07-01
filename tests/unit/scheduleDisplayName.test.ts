import { describe, expect, test } from 'vitest';
import { getScheduleEmployeeAccountEmail, resolveScheduleEmployeeDisplayName } from '../../src/admin/scheduleDisplayName';

describe('scheduleDisplayName', () => {
  test('uses registered profile name for schedule-only employees', () => {
    expect(
      resolveScheduleEmployeeDisplayName(
        {
          name: 'central@jdl.com',
          agency: 'JDL',
          work_account: 'CENTRAL@JDL.COM'
        },
        { 'central@jdl.com': 'Central User' }
      )
    ).toBe('Central User');
  });

  test('keeps employee table name when the agency tracks attendance', () => {
    expect(
      resolveScheduleEmployeeDisplayName(
        {
          name: 'Andrea Ongetta',
          agency: 'Central',
          work_account: 'andrea@example.com'
        },
        { 'andrea@example.com': 'Profile Name' }
      )
    ).toBe('Andrea Ongetta');
  });

  test('falls back to stored employee name without a profile match', () => {
    expect(
      resolveScheduleEmployeeDisplayName(
        {
          name: 'central@jdl.com',
          agency: 'JDL',
          work_account: 'central@jdl.com'
        },
        {}
      )
    ).toBe('central@jdl.com');
  });

  test('normalizes work account email keys', () => {
    expect(getScheduleEmployeeAccountEmail({ work_account: ' CENTRAL@JDL.COM ' })).toBe('central@jdl.com');
  });
});
