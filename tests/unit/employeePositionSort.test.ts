import { describe, expect, test } from 'vitest';

import { buildEmployeePositionRankMap, sortEmployeesByPositionOrder } from '../../src/admin/employeePositionSort';

const normalizeStaffId = (value: string) => value.trim().toUpperCase();

describe('employeePositionSort', () => {
  test('builds a stable rank map from configured positions', () => {
    const rankMap = buildEmployeePositionRankMap(['Pick', 'Pack', 'Rebin']);
    expect(rankMap.get('pick')).toBe(0);
    expect(rankMap.get('pack')).toBe(1);
    expect(rankMap.get('rebin')).toBe(2);
  });

  test('sorts employees by configured position order before staff id', () => {
    const rows = [
      { staff_id: 'US003', position: 'Rebin' },
      { staff_id: 'US002', position: 'Pack' },
      { staff_id: 'US001', position: 'Pick' },
      { staff_id: 'US004', position: 'Pack' }
    ];

    expect(sortEmployeesByPositionOrder(rows, ['Pick', 'Pack', 'Rebin'], normalizeStaffId)).toEqual([
      { staff_id: 'US001', position: 'Pick' },
      { staff_id: 'US002', position: 'Pack' },
      { staff_id: 'US004', position: 'Pack' },
      { staff_id: 'US003', position: 'Rebin' }
    ]);
  });

  test('pushes unknown positions to the end', () => {
    const rows = [
      { staff_id: 'US003', position: 'Unknown' },
      { staff_id: 'US001', position: 'Pick' },
      { staff_id: 'US002', Position: 'Pack' }
    ];

    expect(sortEmployeesByPositionOrder(rows, ['Pick', 'Pack'], normalizeStaffId).map((row) => row.staff_id)).toEqual([
      'US001',
      'US002',
      'US003'
    ]);
  });

  test('keeps priority groups before position order', () => {
    const rows = [
      { staff_id: 'US003', position: 'Pick', agency: 'Prime' },
      { staff_id: '', position: 'Pack', agency: 'JDL', name: 'JDL Pack' },
      { staff_id: 'US001', position: 'Pack', agency: 'Prime' },
      { staff_id: '', position: 'Rebin', agency: 'JDL', name: 'JDL Rebin' }
    ];

    const sorted = sortEmployeesByPositionOrder(
      rows,
      ['Pick', 'Pack', 'Rebin'],
      normalizeStaffId,
      (left, right) => {
        const leftJdl = String(left.agency ?? '').toLowerCase() === 'jdl';
        const rightJdl = String(right.agency ?? '').toLowerCase() === 'jdl';
        if (leftJdl === rightJdl) return 0;
        return leftJdl ? -1 : 1;
      }
    );

    expect(sorted.map((row) => row.name ?? row.staff_id)).toEqual(['JDL Pack', 'JDL Rebin', 'US003', 'US001']);
  });
});
