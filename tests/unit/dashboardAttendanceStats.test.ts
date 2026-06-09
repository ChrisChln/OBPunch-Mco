import { describe, expect, test } from 'vitest';

import { buildDashboardAttendanceStats } from '../../src/shared/dashboardAttendanceStats';

describe('dashboard attendance stats', () => {
  test('keeps off-work punches out of coverage while preserving live counts', () => {
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
      present: 1,
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
});
