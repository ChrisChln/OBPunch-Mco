import { describe, expect, test } from 'vitest';
import {
  filterDailyListCountedRows,
  filterDailyListDisplayRows,
  isDailyListCountedRow,
  isDailyListDisplayRow,
  selectDailyListCapacityRows
} from '../../src/admin/dailyList';
import type { DailyListRow } from '../../src/admin/types';

const normalizePosition = (value: string) => {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'pick') return 'Pick';
  if (text === 'pack') return 'Pack';
  if (text === 'transfer') return 'Transfer';
  return '';
};

describe('dailyList', () => {
  test('counts schedule-only rows when position and shift are valid', () => {
    const row: DailyListRow = {
      staff_id: 'CENTRAL',
      name: 'Central',
      agency: 'JDL',
      position: 'Pick',
      shift: 'early',
      start_time: '08:00',
      scheduleOnly: true
    };

    expect(isDailyListCountedRow(row, normalizePosition)).toBe(true);
  });

  test('shows schedule-only rows in displayed shift tables', () => {
    const rows: DailyListRow[] = [
      {
        staff_id: 'CENTRAL',
        name: 'Central',
        agency: 'JDL',
        position: 'Pick',
        shift: 'early',
        start_time: '08:00',
        scheduleOnly: true
      },
      {
        staff_id: 'US010454',
        name: 'Gio Luki',
        agency: 'Central',
        position: 'Pick',
        shift: 'early',
        start_time: '08:00'
      }
    ];

    expect(filterDailyListCountedRows(rows, normalizePosition).map((row) => row.staff_id)).toEqual(['CENTRAL', 'US010454']);
    expect(filterDailyListDisplayRows(rows, normalizePosition).map((row) => row.staff_id)).toEqual(['CENTRAL', 'US010454']);
    expect(isDailyListDisplayRow(rows[0], normalizePosition)).toBe(true);
  });

  test('uses counted rows for capacity and display', () => {
    const rows: DailyListRow[] = [
      {
        staff_id: 'JDL-PICK',
        name: 'JDL Pick',
        agency: 'JDL',
        position: 'Pick',
        shift: 'early',
        start_time: '07:00',
        scheduleOnly: true
      },
      {
        staff_id: 'US010454',
        name: 'Gio Luki',
        agency: 'Central',
        position: 'Pick',
        shift: 'early',
        start_time: '08:00'
      }
    ];
    const countedRows = filterDailyListCountedRows(rows, normalizePosition);

    expect(selectDailyListCapacityRows(countedRows).map((row) => row.staff_id)).toEqual(['JDL-PICK', 'US010454']);
    expect(filterDailyListDisplayRows(countedRows, normalizePosition).map((row) => row.staff_id)).toEqual(['JDL-PICK', 'US010454']);
  });

  test('does not count rows without a valid position or shift', () => {
    const rows = [
      {
        staff_id: 'OPS',
        name: 'Ops',
        agency: 'JDL',
        position: '',
        shift: 'early',
        start_time: '',
        scheduleOnly: true
      },
      {
        staff_id: 'ADMIN',
        name: 'Admin',
        agency: 'JDL',
        position: 'Pick',
        shift: '',
        start_time: '',
        scheduleOnly: true
      }
    ] as DailyListRow[];

    expect(filterDailyListCountedRows(rows, normalizePosition)).toEqual([]);
  });
});
