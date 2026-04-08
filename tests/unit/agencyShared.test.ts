import { describe, expect, test } from 'vitest';
import {
  canEditAgencyPlannedLeave,
  getAgencyTemplateDateByActualDate,
  isAgencyNewHireRequestStaffId,
  isAgencyWorkingState
} from '../../src/shared/agencyShared';

describe('agencyShared', () => {
  test('maps actual date into current and next template week', () => {
    expect(getAgencyTemplateDateByActualDate('2026-04-08', '2026-04-08')).toBe('2000-01-05');
    expect(getAgencyTemplateDateByActualDate('2026-04-15', '2026-04-08')).toBe('2000-01-12');
  });

  test('enforces leave cutoffs by shift on same day', () => {
    expect(canEditAgencyPlannedLeave('early', '2026-04-08', new Date('2026-04-08T09:59:59'))).toBe(true);
    expect(canEditAgencyPlannedLeave('early', '2026-04-08', new Date('2026-04-08T10:00:01'))).toBe(false);
    expect(canEditAgencyPlannedLeave('late', '2026-04-08', new Date('2026-04-08T16:59:59'))).toBe(true);
    expect(canEditAgencyPlannedLeave('late', '2026-04-08', new Date('2026-04-08T17:00:01'))).toBe(false);
  });

  test('treats future dates as editable', () => {
    expect(canEditAgencyPlannedLeave('early', '2026-04-09', new Date('2026-04-08T21:00:00'))).toBe(true);
  });

  test('recognizes working states', () => {
    expect(isAgencyWorkingState('fixed_work')).toBe(true);
    expect(isAgencyWorkingState('planned_leave')).toBe(false);
  });

  test('detects new-hire demand ids by work date prefix', () => {
    expect(isAgencyNewHireRequestStaffId('0408PICK001', '2026-04-08')).toBe(true);
    expect(isAgencyNewHireRequestStaffId('EMP001', '2026-04-08')).toBe(false);
  });
});
