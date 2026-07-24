import { describe, expect, test } from 'vitest';

import {
  buildDepartedEmployeesCsv,
  filterDepartedEmployees,
  normalizeTerminationReason
} from '../../src/admin/departedEmployees';
import type { EmployeeRow } from '../../src/admin/types';

const rows: EmployeeRow[] = [
  {
    staff_id: 'US010001',
    name: 'Jennifer Bravo',
    agency: 'Prime',
    position: 'Pick',
    terminated_at: '2026-06-14T10:00:00.000Z',
    termination_type: 'normal',
    termination_reason: 'Moved out of state'
  },
  {
    staff_id: 'US010002',
    name: 'Zion Green',
    agency: 'Lyneer',
    position: 'Pack',
    terminated_at: '2026-06-13T10:00:00.000Z',
    termination_type: 'blacklist',
    termination_reason: 'Attendance, repeated'
  }
];

describe('departed employee helpers', () => {
  test('requires a non-empty normalized departure reason', () => {
    expect(normalizeTerminationReason('  Moved out of state  ')).toBe('Moved out of state');
    expect(normalizeTerminationReason('   ')).toBe('');
  });

  test('filters departure dates inclusively and searches the reason', () => {
    expect(
      filterDepartedEmployees(rows, {
        search: '',
        agency: '',
        position: '',
        type: 'all',
        startDate: '2026-06-14',
        endDate: '2026-06-14'
      }).map((row) => row.staff_id)
    ).toEqual(['US010001']);

    expect(
      filterDepartedEmployees(rows, {
        search: 'attendance',
        agency: '',
        position: '',
        type: 'all',
        startDate: '',
        endDate: ''
      }).map((row) => row.staff_id)
    ).toEqual(['US010002']);
  });

  test('exports the filtered rows with UTF-8 BOM and escaped CSV values', () => {
    const csv = buildDepartedEmployeesCsv(rows, (_zh, en) => en, (value) => value);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Departure reason');
    expect(csv).toContain('"Attendance, repeated"');
    expect(csv).toContain('2026-06-14');
  });
});
