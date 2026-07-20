import { describe, expect, test } from 'vitest';

import {
  buildHiddenJdlStaffIdsForAccounts,
  buildJdlStaffIdCandidatesForAccount,
  isScheduleVisibleJdlAdminRole
} from '../../src/admin/jdlAdminScheduleStaff';

const normalizeStaffId = (value: string) => value.trim().toUpperCase();

describe('jdlAdminScheduleStaff', () => {
  test('builds deterministic staff id candidates from account identity', () => {
    expect(buildJdlStaffIdCandidatesForAccount('central.user@example.com', '12345678-abcd')).toEqual([
      'CENTRALUSER',
      'CENTRALUSER12345678'
    ]);
  });

  test('only level admin roles are schedule-visible', () => {
    expect(isScheduleVisibleJdlAdminRole('level1')).toBe(true);
    expect(isScheduleVisibleJdlAdminRole('level2')).toBe(true);
    expect(isScheduleVisibleJdlAdminRole('level3')).toBe(true);
    expect(isScheduleVisibleJdlAdminRole('agency')).toBe(false);
  });

  test('hides active agency accounts and inactive level accounts from JDL schedule staff', () => {
    const hidden = buildHiddenJdlStaffIdsForAccounts(
      [
        {
          user_email: 'central@example.com',
          user_id: '11111111-aaaa',
          role: 'agency',
          is_active: true
        },
        {
          user_email: 'level3@example.com',
          user_id: '22222222-bbbb',
          role: 'level3',
          is_active: true
        },
        {
          user_email: 'inactive@example.com',
          user_id: '33333333-cccc',
          role: 'level1',
          is_active: false
        }
      ],
      normalizeStaffId
    );

    expect(hidden.has('CENTRAL')).toBe(true);
    expect(hidden.has('CENTRAL11111111')).toBe(true);
    expect(hidden.has('LEVEL3')).toBe(false);
    expect(hidden.has('INACTIVE')).toBe(true);
  });
});
