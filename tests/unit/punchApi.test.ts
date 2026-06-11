import { afterEach, describe, expect, test, vi } from 'vitest';

import { submitPunchToApi } from '../../src/lib/punchApi';

describe('submitPunchToApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('posts normalized punch payload to the API', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok', staff_id: 'US010454', action: 'IN' })
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitPunchToApi({ staffId: 'US010454', action: 'IN' });

    expect(result).toEqual({ ok: true, staffId: 'US010454', action: 'IN' });
    expect(fetchMock).toHaveBeenCalledWith('/api/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: 'US010454', action: 'IN' })
    });
  });

  test('returns API error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: 'Last action is IN. Please punch OUT next.' })
      }))
    );

    const result = await submitPunchToApi({ staffId: 'US010454', action: 'IN' });

    expect(result).toEqual({ ok: false, error: 'Last action is IN. Please punch OUT next.' });
  });

  test('returns a fallback message when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    const result = await submitPunchToApi({ staffId: 'US010454', action: 'OUT' });

    expect(result).toEqual({ ok: false, error: 'Punch API request failed: network down' });
  });
});
