import { describe, expect, test, vi } from 'vitest';

import { fetchAgencyScheduleWeek } from '../../src/agency/api';

describe('fetchAgencyScheduleWeek employee notes', () => {
  test('maps both agency and admin notes from the combined RPC', async () => {
    const rpc = vi.fn((name: string) => {
      if (name === 'agency_get_schedule_week') {
        return Promise.resolve({
          data: {
            week_dates: ['2026-07-20'],
            employees: [
              {
                staff_id: 'US001',
                name: 'Alex',
                agency: 'Prime',
                position: 'Pack',
                shift: 'early',
                start_time: '07:00',
                label: '',
                fixed_work_count: 1,
                termination_status: null,
                days: []
              }
            ],
            new_hire_requests: []
          },
          error: null
        });
      }
      if (name === 'agency_get_driver_groups') {
        return Promise.resolve({ data: { assignments: [], groups: [], next_code: '1' }, error: null });
      }
      if (name === 'get_employee_notes') {
        return Promise.resolve({
          data: [{
            staff_id: 'US001',
            agency_note: 'Agency message',
            admin_note: 'Admin message',
            agency_note_updated_by: 'Prime Agency',
            admin_note_updated_by: 'Linda Chen'
          }],
          error: null
        });
      }
      return Promise.resolve({ data: null, error: { message: `Unexpected RPC: ${name}` } });
    });
    const payrateQuery = {
      select: vi.fn(),
      in: vi.fn(),
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null })
    };
    payrateQuery.select.mockReturnValue(payrateQuery);
    payrateQuery.in.mockReturnValue(payrateQuery);
    const supabase = {
      rpc,
      from: vi.fn(() => payrateQuery)
    };

    const result = await fetchAgencyScheduleWeek(supabase as never, '2026-07-20');

    expect(rpc).toHaveBeenCalledWith('get_employee_notes');
    expect(result.employees[0]).toMatchObject({
      staff_id: 'US001',
      agency_note: 'Agency message',
      admin_note: 'Admin message',
      agency_note_updated_by: 'Prime Agency',
      admin_note_updated_by: 'Linda Chen'
    });
  });
});
