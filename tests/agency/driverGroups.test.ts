import { describe, expect, it } from 'vitest';
import {
  buildDriverGroupWarnings,
  getNextDriverGroupCode,
  normalizeDriverGroupAssignment
} from '../../src/agency/driverGroups';
import type { AgencyScheduleState, AgencyWeekScheduleRow } from '../../src/agency/types';

const makeWeekRow = (
  staffId: string,
  groupCode: string,
  states: AgencyScheduleState[],
  driverGroupRole: 'driver' | 'member' = 'member'
): AgencyWeekScheduleRow => ({
  staff_id: staffId,
  name: staffId,
  agency: 'Central',
  position: 'Pick',
  shift: 'early',
  start_time: '09:00',
  label: '',
  fixed_work_count: 0,
  termination_status: null,
  driver_group_code: groupCode,
  driver_group_role: driverGroupRole,
  driver_group_label: driverGroupRole === 'driver' ? `Driver${groupCode}` : groupCode,
  agency_note: '',
  days: states.map((state, index) => ({
    work_date: `2026-04-${String(13 + index).padStart(2, '0')}`,
    template_date: `2026-04-${String(13 + index).padStart(2, '0')}`,
    state,
    base_state: state,
    substitute_open_count: 0
  }))
});

describe('getNextDriverGroupCode', () => {
  it('reuses the lowest inactive code before allocating a new one', () => {
    const code = getNextDriverGroupCode([
      { code: '1', activeMemberCount: 2 },
      { code: '2', activeMemberCount: 0 },
      { code: '3', activeMemberCount: 1 }
    ]);

    expect(code).toBe('2');
  });

  it('allocates the next number when all existing groups still have active members', () => {
    const code = getNextDriverGroupCode([
      { code: '1', activeMemberCount: 1 },
      { code: '2', activeMemberCount: 1 }
    ]);

    expect(code).toBe('3');
  });

  it('reuses the lowest missing numeric code after a group disappears', () => {
    const code = getNextDriverGroupCode([
      { code: '1', activeMemberCount: 1 },
      { code: '3', activeMemberCount: 1 }
    ]);

    expect(code).toBe('2');
  });
});

describe('normalizeDriverGroupAssignment', () => {
  it('uses DriverN for the driver and N for the other members', () => {
    expect(normalizeDriverGroupAssignment({ code: '1', role: 'driver' })).toEqual({
      code: '1',
      role: 'driver',
      label: 'Driver1'
    });
    expect(normalizeDriverGroupAssignment({ code: '1', role: 'member' })).toEqual({
      code: '1',
      role: 'member',
      label: '1'
    });
  });
});

describe('buildDriverGroupWarnings', () => {
  it('warns when members in the same driver group have different weekly schedules', () => {
    const warnings = buildDriverGroupWarnings([
      makeWeekRow('US1', '1', ['work', 'rest', 'work'], 'driver'),
      makeWeekRow('US2', '1', ['work', 'rest', 'work']),
      makeWeekRow('US3', '2', ['work', 'work', 'rest']),
      makeWeekRow('US4', '2', ['work', 'rest', 'rest'])
    ]);

    expect(warnings).toEqual([
      {
        code: '2',
        labels: ['2'],
        staffIds: ['US3', 'US4'],
        message: 'Driver group 2 has mismatched schedules.'
      }
    ]);
  });
});
