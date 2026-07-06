import { describe, expect, test, vi } from 'vitest';
import { deleteAgencyNewHireDemand, upsertAgencyNewHireDemand, upsertAgencyPayrate } from '../../src/agency/api';

const createPayrateSupabase = () => {
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name === 'save_agency_payrates') {
      return { data: { saved_count: 1, staff_ids: params.p_staff_ids }, error: null };
    }
    if (name === 'agency_upsert_new_hire_demand') {
      return { data: { staff_ids: ['TUS0000001', 'TUS0000002'] }, error: null };
    }
    if (name === 'agency_delete_new_hire_demand') {
      return { data: { status: 'ok' }, error: null };
    }
    return { data: null, error: { message: `Unexpected rpc ${name}` } };
  });
  const from = vi.fn(() => {
    throw new Error('Payrate writes must not use direct table access.');
  });
  return { supabase: { rpc, from }, rpc, from };
};

describe('agency payrate API', () => {
  test('saves payrates through scoped RPC instead of direct table upsert', async () => {
    const { supabase, rpc, from } = createPayrateSupabase();

    await upsertAgencyPayrate(supabase as any, 'US010454', '2026-06-17', '18.5');

    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('save_agency_payrates', {
      p_staff_ids: ['US010454'],
      p_work_date: '2026-06-17',
      p_payrate: '18.50'
    });
  });

  test('clears payrates through scoped RPC for deleted new-hire demand', async () => {
    const { supabase, rpc, from } = createPayrateSupabase();

    await deleteAgencyNewHireDemand(supabase as any, 'TUS0000001', '2026-06-17');

    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('save_agency_payrates', {
      p_staff_ids: ['TUS0000001'],
      p_work_date: '2026-06-17',
      p_payrate: null
    });
  });

  test('saves generated new-hire payrates for every returned staff id', async () => {
    const { supabase, rpc, from } = createPayrateSupabase();

    await upsertAgencyNewHireDemand(supabase as any, {
      workDate: '2026-06-17',
      position: 'Pick',
      shift: 'early',
      agency: 'Lyneer',
      label: '',
      entryTime: '07:00',
      note: '',
      payrate: '20',
      count: 2,
      employeeName: ''
    });

    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('save_agency_payrates', {
      p_staff_ids: ['TUS0000001', 'TUS0000002'],
      p_work_date: '2026-06-17',
      p_payrate: '20.00'
    });
  });
});
