import { describe, expect, test } from 'vitest';
import { fetchAgencyDepartedEmployees } from '../../src/agency/api';

type MockDepartedRow = {
  staff_id: string;
  name: string;
  agency?: string;
  Agency?: string;
  position?: string;
  Position?: string;
  shift: string;
  shift_time: string;
  terminated_at: string;
};

const createMockSupabase = (rows: MockDepartedRow[], options: { failLowercase?: boolean } = {}) => ({
  from: () => ({
    select: (columns: string) => ({
      not: () => ({
        order: () => ({
          range: async (from: number, to: number) => {
            if (options.failLowercase && columns.includes('agency')) {
              return { data: null, error: { message: 'column agency does not exist' } };
            }
            return { data: rows.slice(from, to + 1), error: null };
          }
        })
      })
    })
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

  test('falls back to cased agency and position columns', async () => {
    const rows = await fetchAgencyDepartedEmployees(
      createMockSupabase(makeRows(2, { agency: undefined, position: undefined, Agency: 'Lyneer', Position: 'Shipping' }), {
        failLowercase: true
      }) as any,
      ['Lyneer']
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.agency).toBe('Lyneer');
    expect(rows[0]?.position).toBe('Shipping');
  });

  test('uses cased agency and position values when lowercase fields are empty', async () => {
    const rows = await fetchAgencyDepartedEmployees(
      createMockSupabase(makeRows(1, { agency: '', position: '', Agency: 'Central', Position: 'Pick' })) as any,
      ['Central']
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.agency).toBe('Central');
    expect(rows[0]?.position).toBe('Pick');
  });
});
