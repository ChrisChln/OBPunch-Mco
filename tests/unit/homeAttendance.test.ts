import { describe, expect, test } from 'vitest';
import { summarizeAttendancePunchRows } from '../../src/admin/homeAttendance';

const normalizeStaffId = (value: string) => value.trim().toUpperCase();

describe('summarizeAttendancePunchRows', () => {
  test('keeps latest punch and earliest IN per staff', () => {
    const summary = summarizeAttendancePunchRows(
      [
        { staff_id: 'us1', action: 'IN', created_at: '2026-06-26T08:30:00.000Z' },
        { staff_id: 'us1', action: 'OUT', created_at: '2026-06-26T17:00:00.000Z' },
        { staff_id: 'us1', action: 'IN', created_at: '2026-06-26T09:00:00.000Z' },
        { staff_id: 'us2', action: 'OUT', created_at: '2026-06-26T12:00:00.000Z' },
        { staff_id: 'us2', action: 'IN', created_at: '2026-06-26T07:45:00.000Z' }
      ],
      normalizeStaffId
    );

    expect(summary.latestByStaff.get('US1')).toEqual({
      action: 'OUT',
      at: '2026-06-26T17:00:00.000Z'
    });
    expect(summary.firstInByStaff.get('US1')).toEqual({
      at: '2026-06-26T08:30:00.000Z'
    });
    expect(summary.latestByStaff.get('US2')).toEqual({
      action: 'OUT',
      at: '2026-06-26T12:00:00.000Z'
    });
    expect(summary.firstInByStaff.get('US2')).toEqual({
      at: '2026-06-26T07:45:00.000Z'
    });
  });

  test('ignores invalid rows safely', () => {
    const summary = summarizeAttendancePunchRows(
      [
        { staff_id: '', action: 'IN', created_at: '2026-06-26T08:30:00.000Z' },
        { staff_id: 'us1', action: 'IN', created_at: '' },
        { staff_id: 'us1', action: 'IN', created_at: 'not-a-date' },
        { staff_id: 'us1', action: 'IN', created_at: '2026-06-26T08:30:00.000Z' }
      ],
      normalizeStaffId
    );

    expect(summary.latestByStaff.get('US1')).toEqual({
      action: 'IN',
      at: '2026-06-26T08:30:00.000Z'
    });
    expect(summary.firstInByStaff.get('US1')).toEqual({
      at: '2026-06-26T08:30:00.000Z'
    });
    expect(summary.latestByStaff.size).toBe(1);
    expect(summary.firstInByStaff.size).toBe(1);
  });
});
