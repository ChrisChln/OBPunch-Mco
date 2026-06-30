import { describe, expect, it } from 'vitest';
import { filterAgencyDepartedEmployees } from '../../src/agency/departedEmployees';
import type { AgencyDepartedEmployeeRow } from '../../src/agency/types';

const makeRow = (overrides: Partial<AgencyDepartedEmployeeRow> = {}): AgencyDepartedEmployeeRow => ({
  staff_id: 'US000001',
  name: 'Test User',
  agency: 'Central',
  position: 'Pack',
  shift: 'early',
  start_time: '08:00',
  terminated_at: '2026-06-20T12:00:00Z',
  ...overrides
});

describe('filterAgencyDepartedEmployees', () => {
  it('keeps only rows inside the managed agencies', () => {
    const result = filterAgencyDepartedEmployees(
      [
        makeRow({ staff_id: 'US1', agency: 'Central' }),
        makeRow({ staff_id: 'US2', agency: 'Lyneer' })
      ],
      ['Lyneer']
    );

    expect(result.map((row) => row.staff_id)).toEqual(['US2']);
  });

  it('drops rows without a termination timestamp', () => {
    const result = filterAgencyDepartedEmployees(
      [
        makeRow({ staff_id: 'US1', terminated_at: '' }),
        makeRow({ staff_id: 'US2', terminated_at: '2026-06-21T12:00:00Z' })
      ],
      []
    );

    expect(result.map((row) => row.staff_id)).toEqual(['US2']);
  });

  it('sorts newest departures first', () => {
    const result = filterAgencyDepartedEmployees(
      [
        makeRow({ staff_id: 'US1', terminated_at: '2026-06-20T12:00:00Z' }),
        makeRow({ staff_id: 'US2', terminated_at: '2026-06-22T12:00:00Z' }),
        makeRow({ staff_id: 'US3', terminated_at: '2026-06-21T12:00:00Z' })
      ],
      []
    );

    expect(result.map((row) => row.staff_id)).toEqual(['US2', 'US3', 'US1']);
  });
});
