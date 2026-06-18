import { beforeEach, describe, expect, test, vi } from 'vitest';

type MockRes = {
  code: number;
  body: any;
  status: (code: number) => MockRes;
  json: (body: any) => void;
  end: () => void;
  setHeader: () => void;
};

const createRes = (): MockRes => {
  const out = {
    code: 0,
    body: null as any,
    status(code: number) {
      out.code = code;
      return out;
    },
    json(body: any) {
      out.body = body;
    },
    end() {},
    setHeader() {}
  };
  return out;
};

const baseBody = {
  lead_pin: '1234',
  report_date: '2026-06-18',
  exception_type: 'short_pick',
  product_barcode: 'SKU123',
  picking_list_number: 'PL-1',
  picking_container: 'C-1',
  picking_operator: 'US100',
  packing_rebin_operator: '',
  picked_location: 'A01',
  system_location_qty: 5,
  actual_qty: 4,
  count_by: 'US200',
  borrowed_location: '',
  borrowed_qty: '',
  inventory_adjustment: false,
  submitted_by_lead_id: 'US300'
};

describe('api/exception-reports', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.EXCEPTION_LEAD_PIN = '1234';
  });

  test('rejects create when Lead PIN is invalid', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({})
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body: { ...baseBody, lead_pin: 'bad' } }, res);

    expect(res.code).toBe(401);
    expect(String(res.body?.error ?? '')).toContain('Invalid Lead PIN');
  });

  test('creates exception reports with product barcode', async () => {
    const insert = vi.fn((rows: any[]) => ({
      select: () => ({
        single: async () => ({
          data: { id: 1, status: 'Open', ...rows[0] },
          error: null
        })
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body: baseBody }, res);

    expect(res.code).toBe(200);
    expect(insert.mock.calls[0][0][0].product_barcode).toBe('SKU123');
    expect(res.body.row.status).toBe('Open');
  });

  test('creates minimal exception reports with blank optional fields', async () => {
    const insert = vi.fn((rows: any[]) => ({
      select: () => ({
        single: async () => ({
          data: { id: 2, status: 'Open', ...rows[0] },
          error: null
        })
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({
      method: 'POST',
      headers: {},
      body: {
        ...baseBody,
        exception_type: '',
        picking_container: '',
        picking_operator: '',
        picked_location: '',
        system_location_qty: '',
        actual_qty: '',
        count_by: '',
        product_barcode: 'SKU123',
        picking_list_number: 'PL-1'
      }
    }, res);

    expect(res.code).toBe(200);
    expect(insert.mock.calls[0][0][0].exception_type).toBeNull();
    expect(insert.mock.calls[0][0][0].system_location_qty).toBeNull();
    expect(insert.mock.calls[0][0][0].actual_qty).toBeNull();
    expect(res.body.row.status).toBe('Open');
  });

  test('lead patch updates editable report fields without changing status', async () => {
    const updateException = vi.fn((payload: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: { id: 9, status: 'Processing', ...payload }, error: null })
        })
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 9,
                  ...baseBody,
                  lead_pin: undefined,
                  status: 'Processing',
                  product_barcode: 'OLD',
                  borrowed_location: null,
                  borrowed_qty: null,
                  resolution_note: null
                },
                error: null
              })
            })
          }),
          update: updateException
        };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        headers: {},
        body: {
          ...baseBody,
          id: 9,
          status: 'Processing',
          product_barcode: ' sku999 ',
          picking_operator: ' us400 ',
          borrowed_location: ' b02 ',
          borrowed_qty: '2'
        }
      },
      res
    );

    expect(res.code).toBe(200);
    expect(updateException.mock.calls[0][0].product_barcode).toBe('SKU999');
    expect(updateException.mock.calls[0][0].picking_operator).toBe('US400');
    expect(updateException.mock.calls[0][0].borrowed_location).toBe('B02');
    expect(updateException.mock.calls[0][0].borrowed_qty).toBe(2);
    expect(updateException.mock.calls[0][0].status).toBe('Processing');
  });

  test('lead patch can clear quantity fields', async () => {
    const updateException = vi.fn((payload: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: { id: 9, status: 'Processing', ...payload }, error: null })
        })
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 9,
                  ...baseBody,
                  lead_pin: undefined,
                  status: 'Open',
                  system_location_qty: 10,
                  actual_qty: 9,
                  borrowed_location: null,
                  borrowed_qty: null,
                  resolution_note: null
                },
                error: null
              })
            })
          }),
          update: updateException
        };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        headers: {},
        body: {
          ...baseBody,
          id: 9,
          status: 'Processing',
          system_location_qty: null,
          actual_qty: null
        }
      },
      res
    );

    expect(res.code).toBe(200);
    expect(updateException.mock.calls[0][0].system_location_qty).toBeNull();
    expect(updateException.mock.calls[0][0].actual_qty).toBeNull();
  });

  test('admin close creates one mistake report', async () => {
    const mistakeInsert = vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: 77 }, error: null })
      })
    }));
    const updateException = vi.fn((payload: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: { id: 5, status: 'Closed', ...payload }, error: null })
        })
      })
    }));

    const serviceSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@example.com' } }, error: null })
      },
      from: (table: string) => {
        if (table === 'ob_exception_reports') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 5,
                    status: 'Resolved',
                    report_date: '2026-06-18',
                    exception_type: 'short_pick',
                    mistake_report_id: null,
                    resolution_note: ''
                  },
                  error: null
                })
              })
            }),
            update: updateException
          };
        }
        if (table === 'ob_employees') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { staff_id: 'US500', position: 'Pick' }, error: null })
                })
              })
            })
          };
        }
        if (table === 'ob_mistake_reports') return { insert: mistakeInsert };
        throw new Error(`Unexpected table ${table}`);
      }
    };
    const userSupabase = {
      rpc: async () => ({
        data: {
          user_id: 'u1',
          role: 'level2',
          is_active: true,
          modules: [{ module_key: 'exceptions', access_level: 'operate' }]
        },
        error: null
      })
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: (_url: string, key: string) => (key === 'service-role' ? serviceSupabase : userSupabase)
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer token' },
        body: { action: 'close', id: 5, responsibility_result: 'responsible', responsible_staff_id: 'US500' }
      },
      res
    );

    expect(res.code).toBe(200);
    expect(mistakeInsert).toHaveBeenCalledTimes(1);
    expect(updateException.mock.calls[0][0].mistake_report_id).toBe(77);
  });
});
