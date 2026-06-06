import { describe, expect, test } from 'vitest';

import { submitPunchWithServiceRole } from '../../api/_punchCore';

type QueryResult = { data: any[] | null; error: { message: string } | null };

type MockOptions = {
  employees?: QueryResult;
  latestPunches?: QueryResult;
  insertError?: string | null;
  firstInsertError?: string | null;
};

const createSupabaseMock = (options: MockOptions) => {
  const inserts: any[][] = [];
  const supabase = {
    from(table: string) {
      if (table === 'ob_employees') {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => options.employees ?? { data: [{ staff_id: 'US010454', agency: null, terminated_at: null }], error: null }
            })
          })
        };
      }

      if (table === 'ob_punches') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => options.latestPunches ?? { data: [], error: null }
              })
            })
          }),
          insert: async (rows: any[]) => {
            inserts.push(rows);
            if (options.firstInsertError && inserts.length === 1) {
              return { error: { message: options.firstInsertError } };
            }
            return options.insertError ? { error: { message: options.insertError } } : { error: null };
          }
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }
  };

  return { supabase, inserts };
};

describe('submitPunchWithServiceRole', () => {
  test('rejects invalid staff IDs', async () => {
    const { supabase } = createSupabaseMock({});

    const result = await submitPunchWithServiceRole(supabase, {
      staffId: 'bad',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid staff ID format.' });
  });

  test('rejects unregistered employees', async () => {
    const { supabase } = createSupabaseMock({ employees: { data: [], error: null } });

    const result = await submitPunchWithServiceRole(supabase, {
      staffId: 'US010454',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: false, status: 404, error: 'Employee not registered: US010454' });
  });

  test('rejects schedule-only employees', async () => {
    const { supabase } = createSupabaseMock({
      employees: { data: [{ staff_id: 'US010454', agency: 'JDL', terminated_at: null }], error: null }
    });

    const result = await submitPunchWithServiceRole(supabase, {
      staffId: 'US010454',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: false, status: 409, error: 'Employee does not use punch: US010454' });
  });

  test('rejects terminated employees', async () => {
    const { supabase } = createSupabaseMock({
      employees: { data: [{ staff_id: 'US010454', agency: null, terminated_at: '2026-04-20T08:00:00Z' }], error: null }
    });

    const result = await submitPunchWithServiceRole(supabase, {
      staffId: 'US010454',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: false, status: 409, error: 'Employee is terminated and cannot punch: US010454' });
  });

  test('rejects repeated IN when latest punch is IN', async () => {
    const { supabase } = createSupabaseMock({
      latestPunches: { data: [{ action: 'IN', created_at: '2026-06-06T04:00:00Z' }], error: null }
    });

    const result = await submitPunchWithServiceRole(supabase, {
      staffId: 'US010454',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: false, status: 409, error: 'Last action is IN. Please punch OUT next.' });
  });

  test('inserts a valid OUT punch with server metadata', async () => {
    const { supabase, inserts } = createSupabaseMock({
      latestPunches: { data: [{ action: 'IN', created_at: '2026-06-06T04:00:00Z' }], error: null }
    });

    const result = await submitPunchWithServiceRole(supabase, {
      staffId: ' us010454 ',
      action: 'OUT',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: true, status: 200, staffId: 'US010454', action: 'OUT' });
    expect(inserts).toEqual([
      [
        {
          staff_id: 'US010454',
          action: 'OUT',
          metadata: {
            device: 'web_browser',
            source: 'api_punch',
            user_agent: 'test-agent'
          }
        }
      ]
    ]);
  });

  test('keeps the Supabase insert builder context when writing punches', async () => {
    const inserts: any[][] = [];
    const punchBuilder = {
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null })
          })
        })
      }),
      async insert(rows: any[]) {
        if (this !== punchBuilder) {
          throw new Error('insert lost builder context');
        }
        inserts.push(rows);
        return { error: null };
      }
    };
    const supabase = {
      from(table: string) {
        if (table === 'ob_employees') {
          return {
            select: () => ({
              eq: () => ({
                limit: async () => ({ data: [{ staff_id: 'US010454', agency: null, terminated_at: null }], error: null })
              })
            })
          };
        }
        if (table === 'ob_punches') return punchBuilder;
        throw new Error(`Unexpected table ${table}`);
      }
    };

    const result = await submitPunchWithServiceRole(supabase, {
      staffId: 'US010454',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: true, status: 200, staffId: 'US010454', action: 'IN' });
    expect(inserts).toHaveLength(1);
  });

  test('falls back when the deployed punches table has no metadata column', async () => {
    const { supabase, inserts } = createSupabaseMock({
      firstInsertError: "Could not find the 'metadata' column of 'ob_punches' in the schema cache"
    });

    const result = await submitPunchWithServiceRole(supabase, {
      staffId: 'US010454',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: true, status: 200, staffId: 'US010454', action: 'IN' });
    expect(inserts).toEqual([
      [
        {
          staff_id: 'US010454',
          action: 'IN',
          metadata: {
            device: 'web_browser',
            source: 'api_punch',
            user_agent: 'test-agent'
          }
        }
      ],
      [
        {
          staff_id: 'US010454',
          action: 'IN'
        }
      ]
    ]);
  });
});
