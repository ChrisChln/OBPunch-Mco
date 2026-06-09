import { describe, expect, it } from 'vitest';
import { computeAgencyGapCount, computeAgencySummaryCards } from '../../src/agency/boardMetrics';
import type { AgencyEmployeeRow, AgencyNewHireRequestRow } from '../../src/agency/types';

const makeEmployee = (overrides: Partial<AgencyEmployeeRow>): AgencyEmployeeRow => ({
  staff_id: 'US000001',
  name: 'Test User',
  agency: 'Central',
  position: 'Pick',
  shift: 'early',
  start_time: '09:00',
  label: '',
  state: 'rest',
  fixed_work_count: 0,
  has_absent: false,
  has_late: false,
  termination_status: null,
  driver_group_code: '',
  driver_group_role: '',
  driver_group_label: '',
  agency_note: '',
  ...overrides
});

const makeNewHire = (overrides: Partial<AgencyNewHireRequestRow>): AgencyNewHireRequestRow => ({
  staff_id: '0414PICK001',
  name: '',
  agency: 'Central',
  position: 'Pick',
  shift: 'early',
  start_time: '',
  label: '',
  state: '',
  can_delete: true,
  ...overrides
});

describe('computeAgencyGapCount', () => {
  it('uses the max open slot per agency-position-shift group', () => {
    const employees = [
      makeEmployee({ staff_id: 'US1', agency: 'Central', position: 'Pick', shift: 'early' }),
      makeEmployee({ staff_id: 'US2', agency: 'Central', position: 'Pick', shift: 'early' }),
      makeEmployee({ staff_id: 'US3', agency: 'Central', position: 'Pack', shift: 'early' })
    ];
    const openSlots = new Map<string, number>([
      ['US1__2026-04-14', 1],
      ['US2__2026-04-14', 3],
      ['US3__2026-04-14', 2]
    ]);

    expect(computeAgencyGapCount(employees, openSlots, '2026-04-14')).toBe(5);
  });
});

describe('computeAgencySummaryCards', () => {
  it('counts named NEW requests as scheduled while keeping required stable', () => {
    const employees = [
      makeEmployee({ staff_id: 'US1', state: 'work' }),
      makeEmployee({ staff_id: 'US2', state: 'fixed_work' }),
      makeEmployee({ staff_id: 'US3', state: 'rest' })
    ];
    const newHireRequests = [
      makeNewHire({ staff_id: '0414PICK001', name: 'Sandy' }),
      makeNewHire({ staff_id: '0414PICK002', name: '' })
    ];
    const openSlots = new Map<string, number>([['US3__2026-04-14', 2]]);

    const cards = computeAgencySummaryCards({
      employees,
      newHireRequests,
      openSlotsByStaffDate: openSlots,
      selectedDate: '2026-04-14'
    });

    expect(cards).toEqual([
      { key: 'active', label: 'Active', value: 3 },
      { key: 'required', label: 'Required', value: 6 },
      { key: 'scheduled', label: 'Scheduled', value: 3 },
      { key: 'new_requests', label: 'New Requests', value: 2 },
      { key: 'gap', label: 'Gap', value: 2 },
      { key: 'day_off', label: 'Day Off', value: 1 },
      { key: 'excuse', label: 'Excuse#', value: 0 }
    ]);
  });

  it('stays stable because it only depends on board data, not table search state', () => {
    const employees = [
      makeEmployee({ staff_id: 'US1', state: 'work', agency: 'Central' }),
      makeEmployee({ staff_id: 'US2', state: 'work', agency: 'OSI' })
    ];
    const openSlots = new Map<string, number>([['US1__2026-04-14', 1]]);

    const cards = computeAgencySummaryCards({
      employees,
      newHireRequests: [],
      openSlotsByStaffDate: openSlots,
      selectedDate: '2026-04-14'
    });

    expect(cards.find((card) => card.key === 'scheduled')?.value).toBe(2);
    expect(cards.find((card) => card.key === 'required')?.value).toBe(3);
    expect(cards.find((card) => card.key === 'active')?.value).toBe(2);
  });

  it('counts day off and excuse states separately', () => {
    const employees = [
      makeEmployee({ staff_id: 'US1', state: 'rest' }),
      makeEmployee({ staff_id: 'US2', state: 'temp_rest' }),
      makeEmployee({ staff_id: 'US3', state: 'planned_temp_rest' }),
      makeEmployee({ staff_id: 'US4', state: 'leave_pending' }),
      makeEmployee({ staff_id: 'US5', state: 'leave' }),
      makeEmployee({ staff_id: 'US6', state: 'planned_leave' }),
      makeEmployee({ staff_id: 'US7', state: 'work' })
    ];

    const cards = computeAgencySummaryCards({
      employees,
      newHireRequests: [],
      openSlotsByStaffDate: new Map(),
      selectedDate: '2026-04-14'
    });

    expect(cards.find((card) => card.key === 'day_off')?.value).toBe(3);
    expect(cards.find((card) => card.key === 'excuse')?.value).toBe(3);
  });
});
