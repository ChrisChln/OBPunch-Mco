import { describe, expect, it } from 'vitest';
import {
  getEmployeeUpdateError,
  isGeneratedEmployeeColumnWriteError
} from '../../src/admin/employeeWrites';

describe('employee write validation', () => {
  it('recognizes generated agency and position column errors', () => {
    expect(
      isGeneratedEmployeeColumnWriteError({
        message: `column "agency" can only be updated to DEFAULT`
      })
    ).toBe(true);
    expect(
      isGeneratedEmployeeColumnWriteError({
        message: `column "Position" is a generated column`
      })
    ).toBe(true);
  });

  it('does not retry unrelated database errors with alternate columns', () => {
    expect(
      isGeneratedEmployeeColumnWriteError({
        message: 'duplicate key value violates unique constraint'
      })
    ).toBe(false);
  });

  it('rejects an update that returned no employee row', () => {
    expect(
      getEmployeeUpdateError({
        expectedStaffId: 'US020389',
        data: [],
        error: null
      })
    ).toBe('Employee record was not updated. Refresh and try again.');
  });

  it('accepts only a response containing the target employee', () => {
    expect(
      getEmployeeUpdateError({
        expectedStaffId: 'us020389',
        data: [{ staff_id: 'US020389' }],
        error: null
      })
    ).toBeNull();
  });
});
