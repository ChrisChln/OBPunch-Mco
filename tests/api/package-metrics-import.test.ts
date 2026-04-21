import { beforeEach, describe, expect, test, vi } from 'vitest';

type MockRes = {
  code: number;
  body: any;
  status: (code: number) => MockRes;
  json: (body: any) => void;
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
    }
  };
  return out;
};

describe('api/package-metrics-import', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
  });

  test('returns 403 when user lacks package metrics operate permission', async () => {
    const serviceSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com' } }, error: null })
      }
    };
    const userSupabase = {
      rpc: async () => ({
        data: {
          user_id: 'u1',
          role: 'level3',
          is_active: true,
          modules: [{ module_key: 'package_metrics', access_level: 'view' }]
        },
        error: null
      })
    };

    vi.doMock('../../api/_forecastShared', () => ({
      createServiceSupabase: () => serviceSupabase,
      parseJsonBody: () => ({
        metric_date: '2026-04-21',
        filename: 'package.csv',
        rows: [{ quantity: 1, inboundAt: '2026-04-21 08:00:00', shippingStatus: '已发货', packedAt: null }]
      })
    }));
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => userSupabase
    }));
    vi.doMock('../../api/_packageMetricsImportCore', () => ({
      processPackageMetricsImport: vi.fn(),
      processPackageMetricsRowsImport: vi.fn()
    }));

    const { default: handler } = await import('../../api/package-metrics-import');
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {}
    };
    const res = createRes();
    await handler(req, res);

    expect(res.code).toBe(403);
    expect(String(res.body?.error ?? '')).toContain('Package metrics operate permission is required');
  });

  test('allows import when user has package metrics operate permission', async () => {
    const maybeSingle = vi.fn(async () => ({ data: { inventory_level: 4937303 }, error: null }));
    const serviceSupabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'user@example.com' } }, error: null })
      },
      from: (table: string) => {
        if (table === 'volume_forecast_daily_inputs') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle
              })
            })
          };
        }

        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'run-1' }, error: null })
            })
          }),
          update: () => ({
            eq: async () => ({ error: null })
          }),
          upsert: async () => ({ error: null })
        };
      }
    };
    const userSupabase = {
      rpc: async () => ({
        data: {
          user_id: 'u1',
          role: 'level2',
          is_active: true,
          modules: [{ module_key: 'package_metrics', access_level: 'operate' }]
        },
        error: null
      })
    };
    const processPackageMetricsRowsImport = vi.fn(async () => ({
      metrics: { metric_date: '2026-04-21' },
      source_row_count: 1,
      computed_at: '2026-04-21T12:00:00Z'
    }));

    vi.doMock('../../api/_forecastShared', () => ({
      createServiceSupabase: () => serviceSupabase,
      parseJsonBody: () => ({
        metric_date: '2026-04-21',
        filename: 'package.csv',
        rows: [{ quantity: 1, inboundAt: '2026-04-21 08:00:00', shippingStatus: '已发货', packedAt: null }]
      })
    }));
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => userSupabase
    }));
    vi.doMock('../../api/_packageMetricsImportCore', () => ({
      processPackageMetricsImport: vi.fn(),
      processPackageMetricsRowsImport
    }));

    const { default: handler } = await import('../../api/package-metrics-import');
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {}
    };
    const res = createRes();
    await handler(req, res);

    expect(processPackageMetricsRowsImport).toHaveBeenCalledOnce();
    expect(processPackageMetricsRowsImport).toHaveBeenCalledWith(
      expect.objectContaining({
        metricDate: '2026-04-21',
        inventoryQty: 4937303
      }),
      expect.anything()
    );
    expect(maybeSingle).toHaveBeenCalledOnce();
    expect(res.code).toBe(200);
    expect(res.body?.status).toBe('ok');
  });
});
