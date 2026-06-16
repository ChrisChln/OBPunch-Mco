import { afterEach, describe, expect, test, vi } from 'vitest';

type MockRes = {
  code: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (body: unknown) => void;
};

const createRes = (): MockRes => {
  const out = {
    code: 0,
    body: null as unknown,
    status(code: number) {
      out.code = code;
      return out;
    },
    json(body: unknown) {
      out.body = body;
    }
  };
  return out;
};

const loadForecastShared = async () => {
  vi.resetModules();
  return await import('../../api/_forecastShared');
};

describe('forecast shared cron auth', () => {
  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
    delete process.env.CRON_SECRET;
    vi.resetModules();
  });

  test('allows Vercel cron requests even when no cron secret is configured', async () => {
    const { ensureCron } = await loadForecastShared();
    const res = createRes();

    const ok = ensureCron({ headers: { 'x-vercel-cron': '1' } }, res);

    expect(ok).toBe(true);
    expect(res.code).toBe(0);
  });

  test('allows manual cron calls with admin token', async () => {
    process.env.ADMIN_TOKEN = 'admin-token';
    const { ensureCron } = await loadForecastShared();
    const res = createRes();

    const ok = ensureCron({ headers: { authorization: 'Bearer admin-token' } }, res);

    expect(ok).toBe(true);
    expect(res.code).toBe(0);
  });

  test('rejects non-cron requests without a valid token', async () => {
    const { ensureCron } = await loadForecastShared();
    const res = createRes();

    const ok = ensureCron({ headers: {} }, res);

    expect(ok).toBe(false);
    expect(res.code).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
});
