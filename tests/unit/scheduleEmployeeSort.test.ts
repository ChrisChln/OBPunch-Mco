import { describe, expect, test } from 'vitest';

import { sortScheduleEmployees } from '../../src/admin/scheduleEmployeeSort';

const normalizeStaffId = (value: string) => value.trim().toUpperCase();

describe('sortScheduleEmployees', () => {
  test('keeps schedule-only agency employees before regular staff ids', () => {
    const rows = [
      { staff_id: 'US001', agency: 'Prime' },
      { staff_id: 'YUEFANHU', agency: 'JDL' },
      { staff_id: 'US002', agency: 'Lyneer' },
      { staff_id: 'WFE', agency: 'JDL' }
    ];

    const sorted = sortScheduleEmployees(rows, {
      normalizeStaffId,
      pendingStaffIds: new Set(),
      sortByUphDesc: false,
      uphByStaffId: {}
    });

    expect(sorted.map((row) => row.staff_id)).toEqual(['WFE', 'YUEFANHU', 'US001', 'US002']);
  });

  test('keeps pending termination rows above schedule-only agency priority', () => {
    const rows = [
      { staff_id: 'US001', agency: 'Prime' },
      { staff_id: 'WFE', agency: 'JDL' },
      { staff_id: 'US002', agency: 'Prime' }
    ];

    const sorted = sortScheduleEmployees(rows, {
      normalizeStaffId,
      pendingStaffIds: new Set(['US002']),
      sortByUphDesc: false,
      uphByStaffId: {}
    });

    expect(sorted.map((row) => row.staff_id)).toEqual(['US002', 'WFE', 'US001']);
  });

  test('sorts by UPH inside each priority group', () => {
    const rows = [
      { staff_id: 'US001', agency: 'Prime' },
      { staff_id: 'WFE', agency: 'JDL' },
      { staff_id: 'US002', agency: 'Prime' },
      { staff_id: 'YUEFANHU', agency: 'JDL' }
    ];

    const sorted = sortScheduleEmployees(rows, {
      normalizeStaffId,
      pendingStaffIds: new Set(),
      sortByUphDesc: true,
      uphByStaffId: {
        US001: 10,
        US002: 20,
        WFE: 1,
        YUEFANHU: 2
      }
    });

    expect(sorted.map((row) => row.staff_id)).toEqual(['YUEFANHU', 'WFE', 'US002', 'US001']);
  });
});
