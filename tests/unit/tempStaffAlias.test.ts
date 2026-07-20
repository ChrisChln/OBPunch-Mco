import { describe, expect, test, vi } from 'vitest';
import { resolveTempStaffAlias } from '../../src/lib/tempStaffAlias';

describe('resolveTempStaffAlias', () => {
  test('uses narrow RPC lookup instead of reading the assignment table directly', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ staff_id: 'US010454', source_temp_staff_id: 'TUS0000001', created_at: '2026-06-10T12:00:00Z' }],
      error: null
    }));
    const from = vi.fn(() => {
      throw new Error('Temp alias lookup must not read the assignment table directly.');
    });

    const result = await resolveTempStaffAlias({ rpc, from } as any, 'tus0000001');

    expect(result).toEqual({ staffId: 'US010454', error: null });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('resolve_temp_staff_alias', { p_source_temp_staff_id: 'TUS0000001' });
  });

  test('returns null staff id when no alias exists', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));

    const result = await resolveTempStaffAlias({ rpc } as any, 'US010454');

    expect(result).toEqual({ staffId: null, error: null });
  });

  test('surfaces RPC errors without falling back to table enumeration', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'permission denied' } }));

    const result = await resolveTempStaffAlias({ rpc } as any, 'TUS0000001');

    expect(result).toEqual({ staffId: null, error: 'permission denied' });
  });
});
