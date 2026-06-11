import { describe, expect, test } from 'vitest';

import { resolveDashboardStaffPosition } from '../../src/DashboardPage';
import {
  buildDashboardAttendanceStats,
  buildDashboardDepartmentCoverageCards
} from '../../src/shared/dashboardAttendanceStats';

describe('dashboard attendance stats', () => {
  test('counts off-work punches in present while keeping expected headcount scheduled-only', () => {
    const stats = buildDashboardAttendanceStats([
      {
        staffId: 'US001',
        position: 'Pick',
        shift: 'early',
        isExpected: true,
        hasPunch: true,
        isOnClock: false,
        attendance: 'Completed'
      },
      {
        staffId: 'US002',
        position: 'Pick',
        shift: 'early',
        isExpected: true,
        hasPunch: false,
        isOnClock: false,
        attendance: 'Absent'
      },
      {
        staffId: 'US003',
        position: 'Pick',
        shift: 'early',
        isExpected: false,
        hasPunch: true,
        isOnClock: true,
        attendance: 'Off Worked'
      }
    ]);

    expect(stats['early:Pick']).toEqual({
      expected: 2,
      present: 2,
      onClock: 1,
      offWorked: 1
    });
  });

  test('deduplicates repeated staff records in each bucket', () => {
    const stats = buildDashboardAttendanceStats([
      {
        staffId: 'US001',
        position: 'Pack',
        shift: 'late',
        isExpected: true,
        hasPunch: true,
        isOnClock: true
      },
      {
        staffId: 'US001',
        position: 'Pack',
        shift: 'late',
        isExpected: true,
        hasPunch: true,
        isOnClock: true
      }
    ]);

    expect(stats['late:Pack']).toEqual({
      expected: 1,
      present: 1,
      onClock: 1,
      offWorked: 0
    });
  });

  test('splits coverage summaries by OB, IB, and INV departments', () => {
    const stats = buildDashboardAttendanceStats([
      {
        staffId: 'US001',
        position: 'Pick',
        shift: 'early',
        isExpected: true,
        hasPunch: true,
        isOnClock: true
      },
      {
        staffId: 'US002',
        position: 'Receive',
        shift: 'early',
        isExpected: true,
        hasPunch: false,
        isOnClock: false
      },
      {
        staffId: 'US003',
        position: 'Inventory',
        shift: 'early',
        isExpected: true,
        hasPunch: true,
        isOnClock: true
      },
      {
        staffId: 'US004',
        position: 'Pack',
        shift: 'late',
        isExpected: true,
        hasPunch: true,
        isOnClock: true
      }
    ]);

    expect(
      buildDashboardDepartmentCoverageCards({
        positions: ['Pick', 'Pack', 'Receive', 'Inventory'],
        positionDepartments: {
          Pick: 'OB',
          Pack: 'OB',
          Receive: 'IB',
          Inventory: 'INV'
        },
        stats
      })
    ).toEqual([
      { department: 'OB', shift: 'early', expected: 1, present: 1 },
      { department: 'IB', shift: 'early', expected: 1, present: 0 },
      { department: 'INV', shift: 'early', expected: 1, present: 1 },
      { department: 'OB', shift: 'late', expected: 1, present: 1 },
      { department: 'IB', shift: 'late', expected: 0, present: 0 },
      { department: 'INV', shift: 'late', expected: 0, present: 0 }
    ]);
  });

  test('uses employee profile position before schedule snapshot position', () => {
    expect(resolveDashboardStaffPosition('Receive', 'Pick', ['Pick', 'Receive'])).toBe('Pick');
    expect(resolveDashboardStaffPosition('Receive', '', ['Pick', 'Receive'])).toBe('Receive');
  });
});
