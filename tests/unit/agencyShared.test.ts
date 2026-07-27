import { describe, expect, test } from 'vitest';
import {
  canSubmitAgencyLeave,
  getAgencyTemplateDateByActualDate,
  isAgencyNewHireRequestStaffId,
  isAgencyWorkingState
} from '../../src/shared/agencyShared';

describe('agencyShared', () => {
  test('maps actual date into current and next template week', () => {
    expect(getAgencyTemplateDateByActualDate('2026-04-08', '2026-04-08')).toBe('2000-01-05');
    expect(getAgencyTemplateDateByActualDate('2026-04-15', '2026-04-08')).toBe('2000-01-12');
  });

  test('allows leave when a personal shift start is more than 24 hours away', () => {
    expect(
      canSubmitAgencyLeave({
        shift: 'early',
        startTime: '08:30',
        workDate: '2026-07-29',
        now: new Date('2026-07-28T12:29:59.000Z')
      })
    ).toBe(true);
  });

  test('rejects leave at or inside the 24-hour boundary', () => {
    const request = {
      shift: 'early' as const,
      startTime: '08:30',
      workDate: '2026-07-29'
    };

    expect(canSubmitAgencyLeave({ ...request, now: new Date('2026-07-28T12:30:00.000Z') })).toBe(false);
    expect(canSubmitAgencyLeave({ ...request, now: new Date('2026-07-28T12:30:01.000Z') })).toBe(false);
  });

  test('uses 07:00 and 15:00 when a shift start is missing', () => {
    expect(
      canSubmitAgencyLeave({
        shift: 'early',
        startTime: '',
        workDate: '2026-07-29',
        now: new Date('2026-07-28T10:59:59.000Z')
      })
    ).toBe(true);
    expect(
      canSubmitAgencyLeave({
        shift: 'early',
        startTime: '',
        workDate: '2026-07-29',
        now: new Date('2026-07-28T11:00:00.000Z')
      })
    ).toBe(false);
    expect(
      canSubmitAgencyLeave({
        shift: 'late',
        startTime: 'not-a-time',
        workDate: '2026-07-29',
        now: new Date('2026-07-28T18:59:59.000Z')
      })
    ).toBe(true);
    expect(
      canSubmitAgencyLeave({
        shift: 'late',
        startTime: 'not-a-time',
        workDate: '2026-07-29',
        now: new Date('2026-07-28T19:00:00.000Z')
      })
    ).toBe(false);
  });

  test('converts New York winter shift times with the standard-time offset', () => {
    expect(
      canSubmitAgencyLeave({
        shift: 'early',
        startTime: '08:30',
        workDate: '2026-01-29',
        now: new Date('2026-01-28T13:29:59.000Z')
      })
    ).toBe(true);
    expect(
      canSubmitAgencyLeave({
        shift: 'early',
        startTime: '08:30',
        workDate: '2026-01-29',
        now: new Date('2026-01-28T13:30:00.000Z')
      })
    ).toBe(false);
  });

  test('uses the PostgreSQL standard-time choice for a repeated fall clock time', () => {
    const request = {
      shift: 'early' as const,
      startTime: '01:30',
      workDate: '2026-11-01'
    };
    expect(
      canSubmitAgencyLeave({ ...request, now: new Date('2026-10-31T06:29:59.000Z') })
    ).toBe(true);
    expect(
      canSubmitAgencyLeave({ ...request, now: new Date('2026-10-31T06:30:00.000Z') })
    ).toBe(false);
  });

  test('uses the PostgreSQL normalization for a skipped spring clock time', () => {
    const request = {
      shift: 'early' as const,
      startTime: '02:30',
      workDate: '2026-03-08'
    };
    expect(
      canSubmitAgencyLeave({ ...request, now: new Date('2026-03-07T07:29:59.000Z') })
    ).toBe(true);
    expect(
      canSubmitAgencyLeave({ ...request, now: new Date('2026-03-07T07:30:00.000Z') })
    ).toBe(false);
  });

  test('rejects invalid dates, clocks, and unsupported shifts', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    expect(canSubmitAgencyLeave({ shift: '', startTime: '', workDate: '2026-07-29', now })).toBe(false);
    expect(canSubmitAgencyLeave({ shift: 'early', startTime: '08:30', workDate: 'invalid', now })).toBe(false);
    expect(
      canSubmitAgencyLeave({
        shift: 'early',
        startTime: '08:30',
        workDate: '2026-07-29',
        now: new Date('invalid')
      })
    ).toBe(false);
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
