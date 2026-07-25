import { describe, expect, test } from 'vitest';

import {
  attachDepartureOperators,
  buildDepartedEmployeesCsv,
  filterDepartedEmployees,
  normalizeTerminationReason
} from '../../src/admin/departedEmployees';
import type { AuditRow, EmployeeRow } from '../../src/admin/types';

const rows: EmployeeRow[] = [
  {
    staff_id: 'US010001',
    name: 'Jennifer Bravo',
    agency: 'Prime',
    position: 'Pick',
    terminated_at: '2026-06-14T10:00:00.000Z',
    termination_type: 'normal',
    termination_reason: 'Moved out of state',
    termination_operator: 'Linda Chen'
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
    expect(csv).toContain('Operator');
    expect(csv).toContain('Linda Chen');
    expect(csv).toContain('"Attendance, repeated"');
    expect(csv).toContain('2026-06-14');
  });

  test('uses the latest applicable departure audit actor for each employee', () => {
    const audits: AuditRow[] = [
      {
        staff_id: 'US010001',
        action: 'employee_delete',
        actor: 'first@example.com',
        created_at: '2026-06-14T08:00:00.000Z'
      },
      {
        staff_id: 'US010001',
        action: 'employee_termination_approve',
        actor: 'latest@example.com',
        created_at: '2026-06-14T09:59:58.000Z'
      },
      {
        staff_id: 'US010001',
        action: 'employee_delete',
        actor: 'future@example.com',
        created_at: '2026-06-15T10:00:00.000Z'
      },
      {
        staff_id: 'US010001',
        action: 'employee_update',
        actor: 'unrelated@example.com',
        created_at: '2026-06-14T09:59:59.000Z'
      }
    ];

    expect(
      attachDepartureOperators(rows, audits, (audit) => `Admin: ${String(audit.actor ?? '')}`)
    ).toEqual([
      expect.objectContaining({ termination_operator: 'Admin: latest@example.com' }),
      expect.objectContaining({ termination_operator: null })
    ]);
  });
});
