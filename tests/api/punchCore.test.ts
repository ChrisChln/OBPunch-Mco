import { describe, expect, test, vi } from 'vitest';

import { submitPunchWithServiceRole } from '../../api/_punchCore';

type QueryResult = { data: any[] | null; error: { message: string } | null };

type MockOptions = {
  employees?: QueryResult;
  tempAssignments?: QueryResult | ((sourceStaffId: string) => QueryResult);
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
            eq: (_column: string, value: string) => ({
              limit: async () =>
                options.employees ?? {
                  data: [{ staff_id: value, agency: null, terminated_at: null }],
                  error: null
                }
            })
          })
        };
      }

      if (table === 'ob_temp_account_assignments') {
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              order: () => ({
                limit: async () =>
                  typeof options.tempAssignments === 'function'
                    ? options.tempAssignments(value)
                    : options.tempAssignments ?? { data: [], error: null }
              })
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

  test('accepts registered temporary staff IDs', async () => {
    const { supabase, inserts } = createSupabaseMock({
      employees: { data: [{ staff_id: '0606PICK001', agency: null, terminated_at: null }], error: null }
    });

    const result = await submitPunchWithServiceRole(supabase, {
      staffId: '0606pick001',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: true, status: 200, staffId: '0606PICK001', action: 'IN' });
    expect(inserts[0]?.[0]).toMatchObject({ staff_id: '0606PICK001', action: 'IN' });
  });

  test('resolves a bound temporary staff ID to the current employee before punching', async () => {
    let employeeLookup = 0;
    const { supabase, inserts } = createSupabaseMock({
      employees: { data: [], error: null },
      tempAssignments: { data: [{ staff_id: 'US010454', source_temp_staff_id: 'TUS0000001' }], error: null }
    });
    const wrappedSupabase = {
      from(table: string) {
        const builder = supabase.from(table);
        if (table !== 'ob_employees') return builder;
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              limit: async () => {
                employeeLookup += 1;
                return employeeLookup === 1
                  ? { data: [], error: null }
                  : { data: [{ staff_id: value, agency: null, terminated_at: null }], error: null };
              }
            })
          })
        };
      }
    };

    const result = await submitPunchWithServiceRole(wrappedSupabase, {
      staffId: 'tus0000001',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: true, status: 200, staffId: 'US010454', action: 'IN' });
    expect(inserts[0]?.[0]).toMatchObject({
      staff_id: 'US010454',
      action: 'IN',
      metadata: { input_staff_id: 'TUS0000001' }
    });
  });

  test('resolves legacy temporary IDs through the short temporary ID to the current employee', async () => {
    const employeesByStaff = new Map([
      ['US010454', { staff_id: 'US010454', agency: null, terminated_at: null }]
    ]);
    const { supabase, inserts } = createSupabaseMock({
      tempAssignments: (sourceStaffId) => {
        if (sourceStaffId === 'TEMP-USID-MQ74Q3U11B4O-0001') {
          return {
            data: [{ staff_id: 'TUS0000001', source_temp_staff_id: 'TEMP-USID-MQ74Q3U11B4O-0001' }],
            error: null
          };
        }
        if (sourceStaffId === 'TUS0000001') {
          return { data: [{ staff_id: 'US010454', source_temp_staff_id: 'TUS0000001' }], error: null };
        }
        return { data: [], error: null };
      }
    });
    const wrappedSupabase = {
      from(table: string) {
        const builder = supabase.from(table);
        if (table !== 'ob_employees') return builder;
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              limit: async () => ({ data: employeesByStaff.has(value) ? [employeesByStaff.get(value)] : [], error: null })
            })
          })
        };
      }
    };

    const result = await submitPunchWithServiceRole(wrappedSupabase, {
      staffId: 'temp-usid-mq74q3u11b4o-0001',
      action: 'IN',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: true, status: 200, staffId: 'US010454', action: 'IN' });
    expect(inserts[0]?.[0]).toMatchObject({
      staff_id: 'US010454',
      action: 'IN',
      metadata: { input_staff_id: 'TEMP-USID-MQ74Q3U11B4O-0001' }
    });
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

  test('keeps unregistered response when temporary binding schema is not deployed yet', async () => {
    const { supabase } = createSupabaseMock({
      employees: { data: [], error: null },
      tempAssignments: {
        data: null,
        error: { message: "Could not find the 'source_temp_staff_id' column of 'ob_temp_account_assignments' in the schema cache" }
      }
    });

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

  test('allows employees to punch on their termination date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T18:00:00Z'));
    try {
      const { supabase } = createSupabaseMock({
        employees: { data: [{ staff_id: 'US010454', agency: null, terminated_at: '2026-04-20T08:00:00Z' }], error: null }
      });

      const result = await submitPunchWithServiceRole(supabase, {
        staffId: 'US010454',
        action: 'IN',
        userAgent: 'test-agent'
      });

      expect(result).toEqual({ ok: true, status: 200, staffId: 'US010454', action: 'IN' });
    } finally {
      vi.useRealTimers();
    }
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
            input_staff_id: 'US010454',
            user_agent: 'test-agent'
          }
        }
      ]
    ]);
  });

  test('auto punches OUT when the latest punch is IN after resolving a legacy temporary ID', async () => {
    const employeesByStaff = new Map([
      ['TUS0000074', { staff_id: 'TUS0000074', agency: null, terminated_at: null }]
    ]);
    const { supabase, inserts } = createSupabaseMock({
      latestPunches: { data: [{ action: 'IN', created_at: '2026-06-11T01:24:42Z' }], error: null },
      tempAssignments: (sourceStaffId) => {
        if (sourceStaffId === 'TEMP-USID-MQ2NNFMV-0001') {
          return { data: [{ staff_id: 'TUS0000074', source_temp_staff_id: sourceStaffId }], error: null };
        }
        return { data: [], error: null };
      }
    });
    const wrappedSupabase = {
      from(table: string) {
        const builder = supabase.from(table);
        if (table !== 'ob_employees') return builder;
        return {
          select: () => ({
            eq: (_column: string, value: string) => ({
              limit: async () => ({ data: employeesByStaff.has(value) ? [employeesByStaff.get(value)] : [], error: null })
            })
          })
        };
      }
    };

    const result = await submitPunchWithServiceRole(wrappedSupabase, {
      staffId: 'TEMP-USID-MQ2NNFMV-0001',
      action: 'AUTO',
      userAgent: 'test-agent'
    });

    expect(result).toEqual({ ok: true, status: 200, staffId: 'TUS0000074', action: 'OUT' });
    expect(inserts[0]?.[0]).toMatchObject({
      staff_id: 'TUS0000074',
      action: 'OUT',
      metadata: { input_staff_id: 'TEMP-USID-MQ2NNFMV-0001' }
    });
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
            input_staff_id: 'US010454',
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
