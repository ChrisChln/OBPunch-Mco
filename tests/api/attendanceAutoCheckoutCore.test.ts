import { describe, expect, test } from 'vitest';

import { getMostRecentCutoff, runAttendanceAutoCheckout } from '../../api/_attendanceAutoCheckoutCore';

type MockPunch = {
  staff_id: string;
  action: 'IN' | 'OUT';
  created_at: string;
};

type MockEmployee = {
  staff_id: string;
  agency?: string | null;
  terminated_at?: string | null;
};

const createSupabaseMock = ({
  punches,
  employees
}: {
  punches: MockPunch[];
  employees: MockEmployee[];
}) => {
  const inserts: MockPunch[][] = [];
  const employeeByStaff = new Map(employees.map((employee) => [employee.staff_id, employee]));

  const supabase = {
    from(table: string) {
      if (table === 'ob_punches') {
        return {
          select: () => ({
            gte: (_column: string, start: string) => ({
              lte: (_endColumn: string, end: string) => ({
                order: () => ({
                  range: async () => ({
                    data: punches
                      .filter((row) => row.created_at >= start && row.created_at <= end)
                      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
                    error: null
                  })
                })
              })
            })
          }),
          insert: async (rows: MockPunch[]) => {
            inserts.push(rows);
            punches.push(...rows);
            return { error: null };
          }
        };
      }

      if (table === 'ob_employees') {
        return {
          select: () => ({
            in: async (_column: string, staffIds: string[]) => ({
              data: staffIds.map((staffId) => employeeByStaff.get(staffId)).filter(Boolean),
              error: null
            })
          })
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }
  };

  return { supabase, inserts };
};

describe('attendance auto checkout', () => {
  test('finds the most recent New York cutoff in daylight time', () => {
    const cutoff = getMostRecentCutoff(new Date('2026-06-10T09:05:00.000Z'), 'America/New_York', 5);
    expect(cutoff.toISOString()).toBe('2026-06-10T09:00:00.000Z');
  });

  test('inserts OUT at cutoff for staff whose latest punch is IN', async () => {
    const { supabase, inserts } = createSupabaseMock({
      punches: [
        { staff_id: 'US001', action: 'IN', created_at: '2026-06-10T00:00:00.000Z' },
        { staff_id: 'US002', action: 'IN', created_at: '2026-06-10T00:10:00.000Z' },
        { staff_id: 'US002', action: 'OUT', created_at: '2026-06-10T01:00:00.000Z' }
      ],
      employees: [
        { staff_id: 'US001', agency: 'Prime' },
        { staff_id: 'US002', agency: 'Prime' }
      ]
    });

    const result = await runAttendanceAutoCheckout(supabase, {
      now: new Date('2026-06-10T09:05:00.000Z'),
      timezone: 'America/New_York',
      cutoffHour: 5
    });

    expect(result.inserted_staff_ids).toEqual(['US001']);
    expect(result.inserted).toBe(1);
    expect(inserts[0]).toEqual([
      expect.objectContaining({
        staff_id: 'US001',
        action: 'OUT',
        created_at: '2026-06-10T09:00:00.000Z'
      })
    ]);
  });

  test('skips schedule-only and terminated employees', async () => {
    const { supabase, inserts } = createSupabaseMock({
      punches: [
        { staff_id: 'US001', action: 'IN', created_at: '2026-06-10T00:00:00.000Z' },
        { staff_id: 'US002', action: 'IN', created_at: '2026-06-10T00:10:00.000Z' }
      ],
      employees: [
        { staff_id: 'US001', agency: 'JDL' },
        { staff_id: 'US002', agency: 'Prime', terminated_at: '2026-06-01T00:00:00.000Z' }
      ]
    });

    const result = await runAttendanceAutoCheckout(supabase, {
      now: new Date('2026-06-10T09:05:00.000Z'),
      timezone: 'America/New_York',
      cutoffHour: 5
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped_staff_ids).toEqual(['US002', 'US001']);
    expect(inserts).toEqual([]);
  });
});
