import { describe, expect, it } from 'vitest';
import { findAgencyNewHireNameConflict, normalizeAgencyEmployeeName, type AgencyExistingEmployeeNameRecord } from '../../src/agency/newHireValidation';
import type { AgencyEmployeeRow, AgencyNewHireRequestRow } from '../../src/agency/types';

const makeEmployee = (overrides: Partial<AgencyEmployeeRow> = {}): AgencyEmployeeRow => ({
  staff_id: 'US000001',
  name: 'Test User',
  agency: 'Central',
  position: 'Pick',
  shift: 'early',
  start_time: '09:00',
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
  staff_id: '0624PICK001',
  name: 'New Hire',
  agency: 'Central',
  position: 'Pick',
  shift: 'early',
  start_time: '09:00',
  label: '',
  payrate: '',
  state: '',
  can_delete: true,
  ...overrides
});

const makeEmployeeRecord = (overrides: Partial<AgencyExistingEmployeeNameRecord> = {}): AgencyExistingEmployeeNameRecord => ({
  staffId: 'US000099',
  name: 'Existing User',
  terminatedAt: null,
  ...overrides
});

describe('normalizeAgencyEmployeeName', () => {
  it('normalizes case, accents, punctuation, and repeated spaces', () => {
    expect(normalizeAgencyEmployeeName('  Mércèdes   Wright!! ')).toBe('mercedes wright');
  });
});

describe('findAgencyNewHireNameConflict', () => {
  it('blocks names already scheduled on the board', () => {
    const result = findAgencyNewHireNameConflict('mercedes wright', {
      scheduledEmployees: [makeEmployee({ staff_id: 'US123', name: 'Mercedes Wright' })],
      newHireRequests: [],
      existingEmployeeRecords: []
    });

    expect(result).toEqual({
      type: 'scheduled_employee',
      staffId: 'US123',
      name: 'Mercedes Wright'
    });
  });

  it('blocks names already present in new requests except the row being edited', () => {
    const result = findAgencyNewHireNameConflict(' Mercedes Wright ', {
      scheduledEmployees: [],
      newHireRequests: [makeNewHireRequest({ staff_id: '0624PICK009', name: 'Mercedes Wright' })],
      existingEmployeeRecords: [],
      ignoreNewHireStaffId: '0624PICK001'
    });

    expect(result).toEqual({
      type: 'new_hire_request',
      staffId: '0624PICK009',
      name: 'Mercedes Wright'
    });
  });

  it('allows editing the current new request without self-conflict', () => {
    const result = findAgencyNewHireNameConflict('Mercedes Wright', {
      scheduledEmployees: [],
      newHireRequests: [makeNewHireRequest({ staff_id: '0624PICK001', name: 'Mercedes Wright' })],
      existingEmployeeRecords: [],
      ignoreNewHireStaffId: '0624PICK001'
    });

    expect(result).toBeNull();
  });

  it('blocks active employees from being added again', () => {
    const result = findAgencyNewHireNameConflict('mercedes-wright', {
      scheduledEmployees: [],
      newHireRequests: [],
      existingEmployeeRecords: [makeEmployeeRecord({ staffId: 'US777', name: 'Mercedes Wright', terminatedAt: null })]
    });

    expect(result).toEqual({
      type: 'active_employee_record',
      staffId: 'US777',
      name: 'Mercedes Wright'
    });
  });

  it('blocks departed employees so they must be rehired in admin first', () => {
    const result = findAgencyNewHireNameConflict('Mercedes Wright', {
      scheduledEmployees: [],
      newHireRequests: [],
      existingEmployeeRecords: [
        makeEmployeeRecord({ staffId: 'US888', name: 'Mercedes Wright', terminatedAt: '2026-06-01T08:00:00Z' })
      ]
    });

    expect(result).toEqual({
      type: 'departed_employee_record',
      staffId: 'US888',
      name: 'Mercedes Wright'
    });
  });
});
