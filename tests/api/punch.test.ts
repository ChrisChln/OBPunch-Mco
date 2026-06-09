import { beforeEach, describe, expect, test } from 'vitest';

type MockRes = {
  code: number;
  body: unknown;
  ended: boolean;
  status: (code: number) => MockRes;
  json: (body: unknown) => void;
  end: () => void;
};

const createRes = (): MockRes => {
  const out = {
    code: 0,
    body: null as unknown,
    ended: false,
    status(code: number) {
      out.code = code;
      return out;
    },
    json(body: unknown) {
      out.body = body;
    },
    end() {
      out.ended = true;
    }
  };
  return out;
};

describe('api/punch', () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  test('returns 405 for non-POST methods', async () => {
    const { default: handler } = await import('../../api/punch');
    const res = createRes();

    await handler({ method: 'GET', headers: {} }, res);

    expect(res.code).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  test('returns 500 when service Supabase config is missing', async () => {
    const { default: handler } = await import('../../api/punch');
    const res = createRes();

    await handler({ method: 'POST', headers: {}, body: { staff_id: 'US010454', action: 'IN' } }, res);

    expect(res.code).toBe(500);
    expect(res.body).toEqual({ error: 'Missing Supabase server configuration' });
  });
});
