import { describe, expect, test } from 'vitest';

import {
  buildOperationalDayRange,
  buildTimecardPunchSavePayload,
  canOperateTimecardPunches,
  computeConfirmedOperationalDayHours,
  parseTimecardPunchSaveResult
} from '../../src/admin/timecardPunchSave';

const workDate = '2026-07-24';
const rangeStart = new Date('2026-07-24T05:00:00-04:00');
const rangeEnd = new Date('2026-07-25T05:00:00-04:00');

describe('timecard punch save contract', () => {
  test('requires both module and position operation access', () => {
    expect(canOperateTimecardPunches(false, 'Pick', () => true)).toBe(false);
    expect(canOperateTimecardPunches(true, 'Pick', () => false)).toBe(false);
    expect(canOperateTimecardPunches(true, '  ', () => true)).toBe(false);
    expect(canOperateTimecardPunches(true, 'Pick', (position) => position === 'Pick')).toBe(true);
  });

  test('builds the exact RPC payload from staged changes', () => {
    expect(
      buildTimecardPunchSavePayload({
        staffId: ' us001 ',
        workDate,
        edits: [{ id: 7, action: 'OUT', createdAt: '2026-07-24T17:15:00.000Z' }],
        additions: [{ action: 'IN', createdAt: '2026-07-24T13:00:00.000Z' }],
        deleteIds: [9],
        operator: ' admin@example.com '
      })
    ).toEqual({
      p_staff_id: 'US001',
      p_work_date: workDate,
      p_edits: [{ id: '7', action: 'OUT', created_at: '2026-07-24T17:15:00.000Z' }],
      p_additions: [{ action: 'IN', created_at: '2026-07-24T13:00:00.000Z' }],
      p_delete_ids: ['9'],
      p_operator: 'admin@example.com'
    });
  });

  test('rejects duplicate persisted target ids before sending', () => {
    expect(() =>
      buildTimecardPunchSavePayload({
        staffId: 'US001',
        workDate,
        edits: [{ id: 7, action: 'OUT', createdAt: '2026-07-24T17:15:00.000Z' }],
        additions: [],
        deleteIds: ['7'],
        operator: null
      })
    ).toThrow('duplicate punch id');
  });

  test('normalizes database-confirmed rows and counts', () => {
    expect(
      parseTimecardPunchSaveResult(
        {
          rows: [
            {
              id: 7,
              staff_id: 'us001',
              action: 'out',
              created_at: '2026-07-24T17:15:00.000Z'
            }
          ],
          edited_count: 1,
          added_count: 0,
          deleted_count: 0
        },
        'US001',
        rangeStart,
        rangeEnd
      )
    ).toEqual({
      rows: [
        {
          id: '7',
          staff_id: 'US001',
          action: 'OUT',
          created_at: '2026-07-24T17:15:00.000Z'
        }
      ],
      editedCount: 1,
      addedCount: 0,
      deletedCount: 0
    });
  });

  test('rejects null confirmation counts', () => {
    expect(() =>
      parseTimecardPunchSaveResult(
        { rows: [], edited_count: null, added_count: 0, deleted_count: 0 },
        'US001',
        rangeStart,
        rangeEnd
      )
    ).toThrow('edited count');
  });

  test('keeps the local cutoff hour across DST transitions', () => {
    const spring = buildOperationalDayRange(new Date(2026, 2, 2), 6, 5);
    const fall = buildOperationalDayRange(new Date(2026, 9, 26), 6, 5);

    expect(spring.start.getHours()).toBe(5);
    expect(spring.end.getHours()).toBe(5);
    expect(fall.start.getHours()).toBe(5);
    expect(fall.end.getHours()).toBe(5);
  });

  test('rejects empty, mismatched, duplicate, or out-of-range confirmations', () => {
    expect(() => parseTimecardPunchSaveResult(null, 'US001', rangeStart, rangeEnd)).toThrow(
      'confirmed punch rows'
    );

    const base = {
      edited_count: 1,
      added_count: 0,
      deleted_count: 0
    };
    expect(() =>
      parseTimecardPunchSaveResult(
        {
          ...base,
          rows: [
            {
              id: '7',
              staff_id: 'US002',
              action: 'OUT',
              created_at: '2026-07-24T17:15:00.000Z'
            }
          ]
        },
        'US001',
        rangeStart,
        rangeEnd
      )
    ).toThrow('another employee');

    expect(() =>
      parseTimecardPunchSaveResult(
        {
          ...base,
          rows: [
            {
              id: '7',
              staff_id: 'US001',
              action: 'IN',
              created_at: '2026-07-24T13:00:00.000Z'
            },
            {
              id: 7,
              staff_id: 'US001',
              action: 'OUT',
              created_at: '2026-07-24T17:15:00.000Z'
            }
          ]
        },
        'US001',
        rangeStart,
        rangeEnd
      )
    ).toThrow('duplicate punch id');

    expect(() =>
      parseTimecardPunchSaveResult(
        {
          ...base,
          rows: [
            {
              id: '7',
              staff_id: 'US001',
              action: 'OUT',
              created_at: '2026-07-25T10:00:00.000Z'
            }
          ]
        },
        'US001',
        rangeStart,
        rangeEnd
      )
    ).toThrow('outside the operational day');
  });

  test('calculates hours only from confirmed rows', () => {
    const rows = parseTimecardPunchSaveResult(
      {
        rows: [
          { id: '1', staff_id: 'US001', action: 'IN', created_at: '2026-07-24T13:00:00.000Z' },
          { id: '2', staff_id: 'US001', action: 'OUT', created_at: '2026-07-24T17:00:00.000Z' },
          { id: '3', staff_id: 'US001', action: 'IN', created_at: '2026-07-24T17:30:00.000Z' },
          { id: '4', staff_id: 'US001', action: 'OUT', created_at: '2026-07-24T21:40:00.000Z' }
        ],
        edited_count: 1,
        added_count: 0,
        deleted_count: 0
      },
      'US001',
      rangeStart,
      rangeEnd
    ).rows;

    expect(computeConfirmedOperationalDayHours(rows, rangeStart, rangeEnd, rangeEnd)).toBeCloseTo(
      8.1667,
      3
    );
  });
});
