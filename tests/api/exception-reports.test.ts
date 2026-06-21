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
    const select = vi.fn(() => ({
      gte: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null })
          })
        })
      })
    }));
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
        return { insert, select };
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
    expect(insert.mock.calls[0][0][0].report_number).toBe('202606180001');
    expect(insert.mock.calls[0][0][0].item_rows).toEqual([
      { product_barcode: 'SKU123', picked_location: 'A01', system_location_qty: 5, actual_qty: 4 }
    ]);
    expect(res.body.row.status).toBe('Counted');
  });

  test('creates exception reports through atomic database rpc when available', async () => {
    const rpc = vi.fn(async (name: string, params: any) => ({
      data: {
        id: 10,
        ...params.p_payload,
        report_number: '202606180011'
      },
      error: null
    }));
    const insert = vi.fn();
    const select = vi.fn();
    const serviceSupabase = {
      rpc,
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert, select };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body: baseBody }, res);

    expect(res.code).toBe(200);
    expect(rpc).toHaveBeenCalledWith('create_exception_report_atomic', {
      p_payload: expect.objectContaining({
        report_date: '2026-06-18',
        product_barcode: 'SKU123',
        status: 'Counted'
      })
    });
    expect(insert).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(res.body.row.report_number).toBe('202606180011');
  });

  test('falls back to compatible insert when atomic database rpc is not deployed yet', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.create_exception_report_atomic(p_payload) in the schema cache'
      }
    }));
    const select = vi.fn(() => ({
      gte: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({ data: [{ report_number: '202606180011' }], error: null })
          })
        })
      })
    }));
    const insert = vi.fn((rows: any[]) => ({
      select: () => ({
        single: async () => ({
          data: { id: 11, status: 'Open', ...rows[0] },
          error: null
        })
      })
    }));
    const serviceSupabase = {
      rpc,
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert, select };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body: baseBody }, res);

    expect(res.code).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0][0].report_number).toBe('202606180012');
    expect(res.body.row.report_number).toBe('202606180012');
  });

  test('increments report number after stale duplicate sequence read', async () => {
    const select = vi.fn(() => ({
      gte: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({ data: [{ report_number: '202606180001' }], error: null })
          })
        })
      })
    }));
    const insert = vi.fn((rows: any[]) => ({
      select: () => ({
        single: async () => {
          if (rows[0].report_number === '202606180002') {
            return {
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "ob_exception_reports_report_number_key"'
              }
            };
          }
          return { data: { id: 4, status: 'Open', ...rows[0] }, error: null };
        }
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert, select };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body: baseBody }, res);

    expect(res.code).toBe(200);
    expect(insert.mock.calls.map((call) => call[0][0].report_number)).toEqual(['202606180002', '202606180003']);
    expect(res.body.row.report_number).toBe('202606180003');
  });

  test('falls back when item rows column is not in the Supabase schema cache', async () => {
    const select = vi.fn(() => ({
      gte: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null })
          })
        })
      })
    }));
    const insert = vi.fn((rows: any[]) => ({
      select: () => ({
        single: async () => {
          if (Object.prototype.hasOwnProperty.call(rows[0], 'item_rows')) {
            return {
              data: null,
              error: {
                code: 'PGRST204',
                message: "Could not find the 'item_rows' column of 'ob_exception_reports' in the schema cache"
              }
            };
          }
          return { data: { id: 1, status: 'Open', ...rows[0] }, error: null };
        }
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert, select };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body: baseBody }, res);

    expect(res.code).toBe(200);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0][0].item_rows).toBeDefined();
    expect(insert.mock.calls[1][0][0].item_rows).toBeUndefined();
    expect(res.body.row.status).toBe('Counted');
  });

  test('creates minimal exception reports with blank optional fields', async () => {
    const select = vi.fn(() => ({
      gte: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({ data: [{ report_number: '202606180009' }], error: null })
          })
        })
      })
    }));
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
        return { insert, select };
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
    expect(insert.mock.calls[0][0][0].report_number).toBe('202606180010');
    expect(insert.mock.calls[0][0][0].system_location_qty).toBeNull();
    expect(insert.mock.calls[0][0][0].actual_qty).toBeNull();
    expect(res.body.row.status).toBe('Open');
  });

  test('post requires count by when counted quantities are entered', async () => {
    const insert = vi.fn();
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return {
          select: () => ({
            gte: () => ({
              lt: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [],
                    error: null
                  })
                })
              })
            })
          }),
          insert
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
        method: 'POST',
        headers: {},
        body: {
          ...baseBody,
          count_by: ''
        }
      },
      res
    );

    expect(res.code).toBe(400);
    expect(String(res.body?.error ?? '')).toContain('Count By USID is required');
    expect(insert).not.toHaveBeenCalled();
  });

  test('creates the eleventh exception report for the same date', async () => {
    const select = vi.fn(() => ({
      gte: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({
              data: Array.from({ length: 10 }, (_, index) => ({
                report_number: `20260618${String(index + 1).padStart(4, '0')}`
              })),
              error: null
            })
          })
        })
      })
    }));
    const insert = vi.fn((rows: any[]) => ({
      select: () => ({
        single: async () => ({
          data: { id: 11, status: 'Open', ...rows[0] },
          error: null
        })
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert, select };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body: baseBody }, res);

    expect(res.code).toBe(200);
    expect(insert.mock.calls[0][0][0].report_number).toBe('202606180011');
    expect(res.body.row.report_number).toBe('202606180011');
  });

  test('keeps trying until the eleventh report number after stale empty sequence reads', async () => {
    const select = vi.fn(() => ({
      gte: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null })
          })
        })
      })
    }));
    const insert = vi.fn((rows: any[]) => ({
      select: () => ({
        single: async () => {
          const sequence = Number(String(rows[0].report_number).slice('20260618'.length));
          if (sequence <= 10) {
            return {
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "ob_exception_reports_report_number_key"'
              }
            };
          }
          return { data: { id: 12, status: 'Open', ...rows[0] }, error: null };
        }
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert, select };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'POST', headers: {}, body: baseBody }, res);

    expect(res.code).toBe(200);
    expect(insert).toHaveBeenCalledTimes(11);
    expect(insert.mock.calls.map((call) => call[0][0].report_number)).toEqual([
      '202606180001',
      '202606180002',
      '202606180003',
      '202606180004',
      '202606180005',
      '202606180006',
      '202606180007',
      '202606180008',
      '202606180009',
      '202606180010',
      '202606180011'
    ]);
    expect(res.body.row.report_number).toBe('202606180011');
  });

  test('creates Other exception reports with a required reason', async () => {
    const select = vi.fn(() => ({
      gte: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null })
          })
        })
      })
    }));
    const insert = vi.fn((rows: any[]) => ({
      select: () => ({
        single: async () => ({
          data: { id: 3, status: 'Open', ...rows[0] },
          error: null
        })
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert, select };
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
        exception_type: 'other',
        resolution_note: 'Mixed SKU issue'
      }
    }, res);

    expect(res.code).toBe(200);
    expect(insert.mock.calls[0][0][0].exception_type).toBe('other');
    expect(insert.mock.calls[0][0][0].resolution_note).toBe('Mixed SKU issue');
  });

  test('creates Short Picked reports as a separate status', async () => {
    const select = vi.fn(() => ({
      gte: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null })
          })
        })
      })
    }));
    const insert = vi.fn((rows: any[]) => ({
      select: () => ({
        single: async () => ({
          data: { id: 8, ...rows[0] },
          error: null
        })
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return { insert, select };
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
        exception_type: 'short_shipment',
        packing_rebin_operator: 'US500',
        actual_qty: 0,
        short_picked: true
      }
    }, res);

    expect(res.code).toBe(200);
    expect(insert.mock.calls[0][0][0].short_picked).toBe(true);
    expect(res.body.row.status).toBe('Short Picked');
  });

  test('lead patch infers pending adjustment when borrowed inventory is not adjusted', async () => {
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
          packing_rebin_operator: 'us500',
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
    expect(updateException.mock.calls[0][0].status).toBe('Pending Adjustment');
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

  test('lead patch requires count by when counted quantities are entered', async () => {
    const updateException = vi.fn();
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
                  count_by: '',
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
          count_by: '',
          system_location_qty: 4,
          actual_qty: 0
        }
      },
      res
    );

    expect(res.code).toBe(400);
    expect(String(res.body?.error ?? '')).toContain('Count By USID is required');
    expect(updateException).not.toHaveBeenCalled();
  });

  test('lead patch ignores manual resolved status until borrowed inventory is adjusted', async () => {
    const updateException = vi.fn((payload: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: { id: 9, status: 'Pending Adjustment', ...payload }, error: null })
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
                  borrowed_location: 'B02',
                  borrowed_qty: 2,
                  inventory_adjustment: false,
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
          status: 'Resolved',
          packing_rebin_operator: 'US500',
          borrowed_location: 'B02',
          borrowed_qty: 2,
          inventory_adjustment: false
        }
      },
      res
    );

    expect(res.code).toBe(200);
    expect(updateException.mock.calls[0][0].status).toBe('Pending Adjustment');
  });

  test('lead patch keeps matched stock shortage processing until a replenishment action is selected', async () => {
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
                  packing_rebin_operator: 'US500',
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
          status: 'Resolved',
          packing_rebin_operator: 'US500',
          system_location_qty: 3,
          actual_qty: 3,
          extra_taken: false,
          inventory_adjustment: false
        }
      },
      res
    );

    expect(res.code).toBe(200);
    expect(updateException.mock.calls[0][0].status).toBe('Processing');
  });

  test('lead patch requires inventory adjustment after extra taken replenishment', async () => {
    const updateException = vi.fn((payload: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: { id: 9, status: payload.status, ...payload }, error: null })
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
                  packing_rebin_operator: 'US500',
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
    const pendingRes = createRes();
    await handler(
      {
        method: 'PATCH',
        headers: {},
        body: {
          ...baseBody,
          id: 9,
          status: 'Resolved',
          packing_rebin_operator: 'US500',
          system_location_qty: 3,
          actual_qty: 3,
          extra_taken: true,
          inventory_adjustment: false
        }
      },
      pendingRes
    );

    const resolvedRes = createRes();
    await handler(
      {
        method: 'PATCH',
        headers: {},
        body: {
          ...baseBody,
          id: 9,
          status: 'Resolved',
          packing_rebin_operator: 'US500',
          system_location_qty: 3,
          actual_qty: 3,
          extra_taken: true,
          inventory_adjustment: true
        }
      },
      resolvedRes
    );

    expect(pendingRes.code).toBe(200);
    expect(resolvedRes.code).toBe(200);
    expect(updateException.mock.calls[0][0].status).toBe('Pending Adjustment');
    expect(updateException.mock.calls[1][0].status).toBe('Resolved');
  });

  test('lead patch auto closes Over Pick when extra qty matches and physically fixed is enabled', async () => {
    const mistakeInsert = vi.fn(() => ({
      select: async () => ({ data: [{ id: 91 }], error: null })
    }));
    const updateException = vi.fn((payload: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: { id: 13, ...payload }, error: null })
        })
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        if (table === 'ob_exception_reports') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 13,
                    report_number: '202606180013',
                    ...baseBody,
                    exception_type: 'over_pick',
                    status: 'Counted',
                    packing_rebin_operator: '',
                    borrowed_location: null,
                    borrowed_qty: null,
                    inventory_adjustment: false,
                    mistake_report_id: null,
                    resolution_note: null
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
                  maybeSingle: async () => ({ data: { staff_id: 'US100', position: 'Pick' }, error: null })
                })
              })
            })
          };
        }
        if (table === 'ob_mistake_reports') return { insert: mistakeInsert };
        throw new Error(`Unexpected table ${table}`);
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
          id: 13,
          exception_type: 'over_pick',
          packing_rebin_operator: '',
          system_location_qty: 74,
          actual_qty: 77,
          borrowed_qty: 3,
          inventory_adjustment: true
        }
      },
      res
    );

    expect(res.code).toBe(200);
    expect(mistakeInsert).toHaveBeenCalledTimes(1);
    expect(updateException.mock.calls[0][0].status).toBe('Closed');
    expect(updateException.mock.calls[0][0].responsibility_result).toBe('picker');
    expect(updateException.mock.calls[0][0].responsible_staff_id).toBe('US100');
    expect(updateException.mock.calls[0][0].mistake_report_id).toBe(91);
  });

  test('lead patch auto closes Less Pick when missing qty matches and physically fixed is enabled', async () => {
    const mistakeInsert = vi.fn(() => ({
      select: async () => ({ data: [{ id: 92 }], error: null })
    }));
    const updateException = vi.fn((payload: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: { id: 14, ...payload }, error: null })
        })
      })
    }));
    const serviceSupabase = {
      from: (table: string) => {
        if (table === 'ob_exception_reports') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 14,
                    report_number: '202606180014',
                    ...baseBody,
                    exception_type: 'short_pick',
                    status: 'Counted',
                    packing_rebin_operator: '',
                    borrowed_location: null,
                    borrowed_qty: null,
                    inventory_adjustment: false,
                    mistake_report_id: null,
                    resolution_note: null
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
                  maybeSingle: async () => ({ data: { staff_id: 'US100', position: 'Pick' }, error: null })
                })
              })
            })
          };
        }
        if (table === 'ob_mistake_reports') return { insert: mistakeInsert };
        throw new Error(`Unexpected table ${table}`);
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
          id: 14,
          exception_type: 'short_pick',
          packing_rebin_operator: '',
          system_location_qty: 74,
          actual_qty: 71,
          borrowed_qty: 3,
          inventory_adjustment: true
        }
      },
      res
    );

    expect(res.code).toBe(200);
    expect(mistakeInsert).toHaveBeenCalledTimes(1);
    expect(updateException.mock.calls[0][0].status).toBe('Closed');
    expect(updateException.mock.calls[0][0].responsibility_result).toBe('picker');
    expect(updateException.mock.calls[0][0].responsible_staff_id).toBe('US100');
    expect(updateException.mock.calls[0][0].mistake_report_id).toBe(92);
  });

  test('admin list accepts Authorization header casing', async () => {
    const serviceSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'admin@example.com' } }, error: null })
      },
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: [{ id: 5, status: 'Open' }], error: null })
            })
          })
        };
      }
    };
    const userSupabase = {
      rpc: async () => ({
        data: {
          user_id: 'u1',
          role: 'level2',
          is_active: true,
          modules: [{ module_key: 'exceptions', access_level: 'view' }]
        },
        error: null
      })
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: (_url: string, key: string) => (key === 'service-role' ? serviceSupabase : userSupabase)
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'GET', headers: { Authorization: 'Bearer token' }, query: {} }, res);

    expect(res.code).toBe(200);
    expect(res.body.rows).toEqual([{ id: 5, status: 'Open' }]);
  });

  test('lead list accepts X-Exception-Lead-Pin header casing', async () => {
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: [{ id: 6, status: 'Processing' }], error: null })
            })
          })
        };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'GET', headers: { 'X-Exception-Lead-Pin': '1234' }, query: {} }, res);

    expect(res.code).toBe(200);
    expect(res.body.rows).toEqual([{ id: 6, status: 'Processing' }]);
  });

  test('lead list accepts configured PIN with surrounding whitespace', async () => {
    process.env.EXCEPTION_LEAD_PIN = ' 1234 \n';
    const serviceSupabase = {
      from: (table: string) => {
        expect(table).toBe('ob_exception_reports');
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: [{ id: 7, status: 'Open' }], error: null })
            })
          })
        };
      }
    };

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => serviceSupabase
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'GET', headers: { 'X-Exception-Lead-Pin': '1234' }, query: {} }, res);

    expect(res.code).toBe(200);
    expect(res.body.rows).toEqual([{ id: 7, status: 'Open' }]);
  });

  test('lead list reports missing production PIN configuration', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.EXCEPTION_LEAD_PIN;

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({})
    }));

    const { default: handler } = await import('../../api/exception-reports');
    const res = createRes();
    await handler({ method: 'GET', headers: { 'X-Exception-Lead-Pin': '1234' }, query: {} }, res);

    process.env.NODE_ENV = previousNodeEnv;
    expect(res.code).toBe(500);
    expect(String(res.body?.error ?? '')).toContain('Exception Lead PIN is not configured');
  });

  test('admin close creates one mistake report', async () => {
    const mistakeInsert = vi.fn(() => ({
      select: async () => ({ data: [{ id: 77 }], error: null })
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
                    report_number: '202606180011',
                    status: 'Resolved',
                    report_date: '2026-06-18',
                    exception_type: 'short_pick',
                    picking_operator: 'US500',
                    packing_rebin_operator: 'US501',
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
        body: { action: 'close', id: 5, responsibility_result: 'picker' }
      },
      res
    );

    expect(res.code).toBe(200);
    expect(mistakeInsert).toHaveBeenCalledTimes(1);
    expect(mistakeInsert.mock.calls[0][0][0].reason).toContain('Exception #202606180011');
    expect(mistakeInsert.mock.calls[0][0][0].reason).toContain('Picker');
    expect(mistakeInsert.mock.calls[0][0][0].employee_staff_id).toBe('US500');
    expect(updateException.mock.calls[0][0].mistake_report_id).toBe(77);
  });

  test('admin close creates picker and packer mistakes when all are responsible', async () => {
    const mistakeInsert = vi.fn(() => ({
      select: async () => ({ data: [{ id: 81 }, { id: 82 }], error: null })
    }));
    const updateException = vi.fn((payload: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: { id: 6, status: 'Closed', ...payload }, error: null })
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
                    id: 6,
                    report_number: '202606180012',
                    status: 'Resolved',
                    report_date: '2026-06-18',
                    exception_type: 'wrong_pick',
                    picking_operator: 'US500',
                    packing_rebin_operator: 'US501',
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
              eq: (column: string, staffId: string) => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { staff_id: staffId, position: staffId === 'US500' ? 'Pick' : 'Pack' }, error: null })
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
        body: { action: 'close', id: 6, responsibility_result: 'all' }
      },
      res
    );

    expect(res.code).toBe(200);
    expect(mistakeInsert).toHaveBeenCalledTimes(1);
    expect(mistakeInsert.mock.calls[0][0].map((row: any) => row.employee_staff_id)).toEqual(['US500', 'US501']);
    expect(updateException.mock.calls[0][0].responsibility_result).toBe('all');
    expect(updateException.mock.calls[0][0].responsible_staff_id).toBeNull();
    expect(updateException.mock.calls[0][0].mistake_report_id).toBe(81);
  });
});
