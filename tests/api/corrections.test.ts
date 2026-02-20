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

describe('api/corrections', () => {
  const mockSupabaseModule = (insertErrorMessage?: string) => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          insert: async () =>
            insertErrorMessage ? { error: { message: insertErrorMessage } } : { error: null }
        })
      })
    }));
  };
  const mockSupabaseModuleThrowing = (message: string) => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          insert: async () => {
            throw new Error(message);
          }
        })
      })
    }));
  };

  beforeEach(() => {
    vi.resetModules();
    vi.unmock('@supabase/supabase-js');
    delete process.env.ADMIN_TOKEN;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  test('returns 405 for non-POST', async () => {
    const { default: handler } = await import('../../api/corrections');
    const req = { method: 'GET', headers: {} };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(405);
  });

  test('returns 401 for bad token', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    mockSupabaseModule();
    const { default: handler } = await import('../../api/corrections');
    const req = { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: {} };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(401);
  });

  test('returns 500 when supabase server config missing', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    const { default: handler } = await import('../../api/corrections');
    const req = { method: 'POST', headers: { authorization: 'Bearer secret' }, body: {} };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(500);
    expect(String(res.body?.error ?? '')).toContain('Missing Supabase server configuration');
  });

  test('returns 400 for invalid JSON body', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    mockSupabaseModule();
    const { default: handler } = await import('../../api/corrections');
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: '{bad-json'
    };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(400);
  });

  test('returns 400 for invalid staff_id/action', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    mockSupabaseModule();
    const { default: handler } = await import('../../api/corrections');
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: { staff_id: 'BAD', action: 'NOPE' }
    };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(400);
  });

  test('returns 500 when insert fails', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    mockSupabaseModule('insert failed');
    const { default: handler } = await import('../../api/corrections');
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: { staff_id: 'US010454', action: 'IN' }
    };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(500);
    expect(String(res.body?.error ?? '')).toContain('insert failed');
  });

  test('returns 200 on successful insert', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    mockSupabaseModule();
    const { default: handler } = await import('../../api/corrections');
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: { staff_id: 'US010454', action: 'OUT' }
    };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('accepts non-Bearer authorization token format', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    mockSupabaseModule();
    const { default: handler } = await import('../../api/corrections');
    const req = {
      method: 'POST',
      headers: { authorization: 'secret' },
      body: { staff_id: 'US010454', action: 'IN', effective_at: '2026-02-20T08:00:00Z', note: 'manual fix' }
    };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('returns 500 when insert throws exception', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    mockSupabaseModuleThrowing('insert crashed');
    const { default: handler } = await import('../../api/corrections');
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: { staff_id: 'US010454', action: 'IN' }
    };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(500);
    expect(String(res.body?.error ?? '')).toContain('insert crashed');
  });

  test('returns 500 with String(err) fallback when thrown value has no message', async () => {
    process.env.ADMIN_TOKEN = 'secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => ({
          insert: async () => {
            throw 'raw failure';
          }
        })
      })
    }));
    const { default: handler } = await import('../../api/corrections');
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: { staff_id: 'US010454', action: 'OUT' }
    };
    const res = createRes();
    await handler(req, res);
    expect(res.code).toBe(500);
    expect(String(res.body?.error ?? '')).toContain('raw failure');
  });
});
