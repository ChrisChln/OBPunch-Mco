import { describe, expect, it } from 'vitest';
import { DEFAULT_NEW_HIRE_ENTRY_TIME, normalizeAgencyEntryTime, resolveAgencyNewHireEntryTime } from '../../src/agency/newHireEntryTime';
import type { AgencyEmployeeRow, AgencyNewHireRequestRow } from '../../src/agency/types';

const makeEmployee = (overrides: Partial<AgencyEmployeeRow> = {}): AgencyEmployeeRow => ({
  staff_id: 'US000001',
  name: 'Test User',
  agency: 'Central',
  position: 'Pack',
  shift: 'early',
  start_time: '08:00',
  label: '',
  payrate: '',
  state: 'work',
  agencyStatus: 'ready',
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

const makeNewHireRequest = (overrides: Partial<AgencyNewHireRequestRow> = {}): AgencyNewHireRequestRow => ({
  staff_id: '0625PACK001',
  name: 'New Hire',
  agency: 'Central',
  position: 'Pack',
  shift: 'early',
  start_time: '08:00',
  label: '',
  payrate: '',
  state: '',
  can_delete: true,
  ...overrides
});

describe('normalizeAgencyEntryTime', () => {
  it('keeps valid HH:mm values', () => {
    expect(normalizeAgencyEntryTime('08:00')).toBe('08:00');
  });

  it('falls back for invalid values', () => {
    expect(normalizeAgencyEntryTime('8:00')).toBe(DEFAULT_NEW_HIRE_ENTRY_TIME);
  });
});

describe('resolveAgencyNewHireEntryTime', () => {
  it('prefers the edited NEW request start time', () => {
    expect(
      resolveAgencyNewHireEntryTime({
        employees: [makeEmployee({ start_time: '09:00' })],
        newHireRequest: makeNewHireRequest({ start_time: '08:00' }),
        agency: 'Central',
        position: 'Pack',
        shift: 'early'
      })
    ).toBe('08:00');
  });

  it('uses the matching employee group start time for new requests', () => {
    expect(
      resolveAgencyNewHireEntryTime({
        employees: [
          makeEmployee({ agency: 'Central', position: 'Pack', shift: 'early', start_time: '08:00' }),
          makeEmployee({ agency: 'Central', position: 'Pack', shift: 'late', start_time: '09:00' })
        ],
        agency: 'Central',
        position: 'Pack',
        shift: 'early'
      })
    ).toBe('08:00');
  });

  it('falls back to the default when no matching time exists', () => {
    expect(
      resolveAgencyNewHireEntryTime({
        employees: [makeEmployee({ agency: 'Prime', position: 'Pick', shift: 'late', start_time: '' })],
        agency: 'Central',
        position: 'Pack',
        shift: 'early'
      })
    ).toBe(DEFAULT_NEW_HIRE_ENTRY_TIME);
  });
});
