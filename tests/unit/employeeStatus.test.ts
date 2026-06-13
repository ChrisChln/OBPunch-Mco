import { describe, expect, test } from 'vitest';

import { getEmployeeTerminatedAt, isEmployeeTerminated } from '../../src/shared/employeeStatus';

describe('employeeStatus', () => {
  test('returns null when terminated_at is empty', () => {
    expect(getEmployeeTerminatedAt({ terminatedAt: '' })).toBeNull();
    expect(isEmployeeTerminated({ terminatedAt: '' })).toBe(false);
  });

  test('returns normalized termination timestamp when present', () => {
    expect(getEmployeeTerminatedAt({ terminatedAt: '2026-04-20T08:00:00Z' })).toBe('2026-04-20T08:00:00Z');
    expect(isEmployeeTerminated({ terminatedAt: '2026-04-20T08:00:00Z' })).toBe(true);
  });

  test('allows punch eligibility on the local termination date only', () => {
    const employee = { terminatedAt: '2026-04-20T08:00:00Z' };

    expect(isEmployeeTerminated(employee, { referenceAt: '2026-04-20T18:00:00Z', allowTerminationDate: true })).toBe(false);
    expect(isEmployeeTerminated(employee, { referenceAt: '2026-04-21T08:00:00Z', allowTerminationDate: true })).toBe(true);
  });
});
