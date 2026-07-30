import { describe, expect, test } from 'vitest';
import { fetchAgencyDepartedEmployees } from '../../src/agency/api';

type MockDepartedRow = {
  staff_id: string;
  name: string;
  agency: string;
  position: string;
  shift: string;
  shift_time: string;
  terminated_at: string;
};

const createMockSupabase = (rows: MockDepartedRow[], selectedColumns: string[] = []) => ({
  from: () => ({
    select: (columns: string) => {
      selectedColumns.push(columns);
      return {
        not: () => ({
          order: () => ({
            range: async (from: number, to: number) => ({
              data: rows.slice(from, to + 1),
              error: null
            })
          })
        })
      };
    }
  })
});

const makeRows = (count: number, overrides: Partial<MockDepartedRow> = {}) =>
  Array.from({ length: count }, (_, index) => ({
    staff_id: `US${String(index + 1).padStart(6, '0')}`,
    name: `Departed ${index + 1}`,
    agency: 'Central',
    position: 'Pick',
    shift: index % 2 === 0 ? 'early' : 'late',
    shift_time: '07:00',
    terminated_at: `2026-06-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    ...overrides
  }));

describe('fetchAgencyDepartedEmployees', () => {
  test('loads every departed employee across paged results', async () => {
    const rows = await fetchAgencyDepartedEmployees(createMockSupabase(makeRows(1005)) as any, []);

    expect(rows).toHaveLength(1005);
    expect(rows.some((row) => row.staff_id === 'US001005')).toBe(true);
  });

  test('queries only canonical lowercase employee metadata columns', async () => {
    const selectedColumns: string[] = [];
    const rows = await fetchAgencyDepartedEmployees(createMockSupabase(makeRows(1), selectedColumns) as any, ['Central']);

    expect(rows).toHaveLength(1);
    expect(selectedColumns).toEqual([
      'staff_id, name, agency, position, shift, shift_time, terminated_at'
    ]);
  });
});
