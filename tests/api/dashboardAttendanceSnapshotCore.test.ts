import { describe, expect, test } from 'vitest';

import {
  buildDashboardAttendanceSnapshotStats,
  getDashboardSnapshotWorkDate,
  runDashboardAttendanceSnapshot
} from '../../api/_dashboardAttendanceSnapshotCore';

type TableRows = Record<string, Record<string, unknown>[]>;

const createQuery = (rows: Record<string, unknown>[]) => {
  const state: {
    rows: Record<string, unknown>[];
    orderColumn?: string;
    ascending?: boolean;
  } = { rows: [...rows] };
  const api: any = {
    select: () => api,
    eq: (column: string, value: unknown) => {
      state.rows = state.rows.filter((row) => row[column] === value);
      return api;
    },
    in: (column: string, values: unknown[]) => {
      const allowed = new Set(values);
      state.rows = state.rows.filter((row) => allowed.has(row[column]));
      return api;
    },
    gte: (column: string, value: unknown) => {
      state.rows = state.rows.filter((row) => String(row[column] ?? '') >= String(value ?? ''));
      return api;
    },
    lt: (column: string, value: unknown) => {
      state.rows = state.rows.filter((row) => String(row[column] ?? '') < String(value ?? ''));
      return api;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      state.orderColumn = column;
      state.ascending = options?.ascending ?? true;
      return api;
    },
    range: async (from: number, to: number) => {
      const sorted = state.orderColumn
        ? [...state.rows].sort((left, right) => {
            const diff = String(left[state.orderColumn ?? ''] ?? '').localeCompare(String(right[state.orderColumn ?? ''] ?? ''), 'en-US');
            return state.ascending ? diff : -diff;
          })
        : state.rows;
      return { data: sorted.slice(from, to + 1), error: null };
    }
  };
  return api;
};

const createSupabaseMock = (tables: TableRows) => {
  const upserts: Record<string, unknown>[][] = [];
  const supabase = {
    from(table: string) {
      return {
        ...createQuery(tables[table] ?? []),
        upsert: async (rows: Record<string, unknown>[]) => {
          upserts.push(rows);
          return { error: null };
        }
      };
    }
  };
  return { supabase, upserts };
};

describe('dashboard attendance snapshot core', () => {
  test('uses the previous operational date before the New York cutoff', () => {
    expect(
      getDashboardSnapshotWorkDate({
        now: new Date('2026-07-04T08:55:00.000Z'),
        timezone: 'America/New_York',
        cutoffHour: 5
      })
    ).toBe('2026-07-03');
  });

  test('expected snapshots before cutoff write the current operational date being refreshed', () => {
    expect(
      getDashboardSnapshotWorkDate({
        mode: 'expected',
        now: new Date('2026-07-05T08:55:00.000Z'),
        timezone: 'America/New_York',
        cutoffHour: 5
      })
    ).toBe('2026-07-04');
  });

  test('actual snapshots before cutoff write the same operational date as expected', () => {
    expect(
      getDashboardSnapshotWorkDate({
        mode: 'actual',
        now: new Date('2026-07-05T08:58:00.000Z'),
        timezone: 'America/New_York',
        cutoffHour: 5
      })
    ).toBe('2026-07-04');
  });

  test('explicit work date overrides snapshot mode date inference', () => {
    expect(
      getDashboardSnapshotWorkDate({
        mode: 'actual',
        workDate: '2026-07-04',
        now: new Date('2026-07-05T10:15:00.000Z'),
        timezone: 'America/New_York',
        cutoffHour: 5
      })
    ).toBe('2026-07-04');
  });

  test('captures expected only from working schedule states and filters invalid staff', async () => {
    const { supabase } = createSupabaseMock({
      ob_positions: [
        { name: 'Pick', department: 'OB', is_active: true, display_order: 1 },
        { name: 'Hidden Desk', department: 'hidden', is_active: true, display_order: 2 }
      ],
      ob_schedules: [
        { id: 1, staff_id: 'US001', date: '2000-01-03', position: 'Pick', note: null, created_at: '2026-07-03T10:00:00.000Z' },
        { id: 2, staff_id: 'US002', date: '2000-01-03', position: 'Pick', note: '__rest__', created_at: '2026-07-03T10:00:00.000Z' },
        { id: 3, staff_id: 'US003', date: '2000-01-03', position: 'Pick', note: null, created_at: '2026-07-03T10:00:00.000Z' },
        { id: 4, staff_id: 'US004', date: '2000-01-03', position: 'Hidden Desk', note: null, created_at: '2026-07-03T10:00:00.000Z' },
        { id: 5, staff_id: 'NEWREQ-20260703-OB-001', date: '2000-01-03', position: 'Pick', note: null, created_at: '2026-07-03T10:00:00.000Z' }
      ],
      ob_employees: [
        { staff_id: 'US001', agency: 'Prime', position: 'Pick', shift: 'early', active: true },
        { staff_id: 'US002', agency: 'Prime', position: 'Pick', shift: 'early', active: true },
        { staff_id: 'US003', agency: 'JDL', position: 'Pick', shift: 'early', active: true },
        { staff_id: 'US004', agency: 'Prime', position: 'Hidden Desk', shift: 'early', active: true },
        { staff_id: 'NEWREQ-20260703-OB-001', agency: 'Prime', position: 'Pick', shift: 'early', active: true }
      ],
      ob_punches: []
    });

    const result = await buildDashboardAttendanceSnapshotStats(supabase, {
      mode: 'expected',
      workDate: '2026-07-06',
      now: new Date('2026-07-06T08:55:00.000Z')
    });

    expect(result.stats).toEqual([
      expect.objectContaining({
        work_date: '2026-07-06',
        shift: 'early',
        position: 'Pick',
        expected: 1,
        present: 0
      })
    ]);
  });

  test('counts off-work punches as present without increasing expected', async () => {
    const { supabase } = createSupabaseMock({
      ob_positions: [{ name: 'Pack', department: 'OB', is_active: true, display_order: 1 }],
      ob_schedules: [
        { id: 1, staff_id: 'US010', date: '2000-01-03', position: 'Pack', note: null, created_at: '2026-07-06T10:00:00.000Z' },
        { id: 2, staff_id: 'US011', date: '2000-01-03', position: 'Pack', note: '__rest__', created_at: '2026-07-06T10:00:00.000Z' }
      ],
      ob_employees: [
        { staff_id: 'US010', agency: 'Prime', position: 'Pack', shift: 'early', active: true },
        { staff_id: 'US011', agency: 'Prime', position: 'Pack', shift: 'early', active: true }
      ],
      ob_punches: [
        { id: 1, staff_id: 'US010', action: 'IN', created_at: '2026-07-06T10:00:00.000Z' },
        { id: 2, staff_id: 'US010', action: 'OUT', created_at: '2026-07-06T14:00:00.000Z' },
        { id: 3, staff_id: 'US011', action: 'IN', created_at: '2026-07-06T11:00:00.000Z' }
      ]
    });

    const result = await buildDashboardAttendanceSnapshotStats(supabase, {
      mode: 'actual',
      workDate: '2026-07-06',
      now: new Date('2026-07-07T10:15:00.000Z')
    });

    expect(result.stats).toEqual([
      expect.objectContaining({
        shift: 'early',
        position: 'Pack',
        expected: 1,
        present: 2,
        on_clock: 1,
        off_worked: 1,
        work_hours: 26
      })
    ]);
  });

  test('dry run does not upsert snapshot rows', async () => {
    const { supabase, upserts } = createSupabaseMock({
      ob_positions: [{ name: 'Pick', department: 'OB', is_active: true, display_order: 1 }],
      ob_schedules: [{ id: 1, staff_id: 'US001', date: '2000-01-03', position: 'Pick', note: null, created_at: '2026-07-06T10:00:00.000Z' }],
      ob_employees: [{ staff_id: 'US001', agency: 'Prime', position: 'Pick', shift: 'early', active: true }],
      ob_punches: []
    });

    const result = await runDashboardAttendanceSnapshot(supabase, {
      mode: 'expected',
      workDate: '2026-07-06',
      dryRun: true
    });

    expect(result.rows_ready).toBe(1);
    expect(result.rows_upserted).toBe(0);
    expect(upserts).toEqual([]);
  });

  test('actual upsert includes expected headcount when expected snapshot is missing', async () => {
    const { supabase, upserts } = createSupabaseMock({
      ob_positions: [{ name: 'Pick', department: 'OB', is_active: true, display_order: 1 }],
      ob_schedules: [
        { id: 1, staff_id: 'US001', date: '2000-01-03', position: 'Pick', note: null, created_at: '2026-07-06T10:00:00.000Z' },
        { id: 2, staff_id: 'US002', date: '2000-01-03', position: 'Pick', note: null, created_at: '2026-07-06T10:00:00.000Z' }
      ],
      ob_employees: [
        { staff_id: 'US001', agency: 'Prime', position: 'Pick', shift: 'early', active: true },
        { staff_id: 'US002', agency: 'Prime', position: 'Pick', shift: 'early', active: true }
      ],
      ob_punches: [{ id: 1, staff_id: 'US001', action: 'IN', created_at: '2026-07-06T10:00:00.000Z' }]
    });

    const result = await runDashboardAttendanceSnapshot(supabase, {
      mode: 'actual',
      workDate: '2026-07-06',
      now: new Date('2026-07-07T10:15:00.000Z')
    });

    expect(result.rows_upserted).toBe(1);
    expect(upserts[0]?.[0]).toEqual(
      expect.objectContaining({
        work_date: '2026-07-06',
        shift: 'early',
        position: 'Pick',
        expected: 2,
        present: 1,
        snapshot_status: 'actual'
      })
    );
  });
});
