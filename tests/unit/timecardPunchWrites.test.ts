import { describe, expect, it } from 'vitest';
import { getPunchUpdateError } from '../../src/admin/timecardPunchWrites';

describe('getPunchUpdateError', () => {
  it('preserves a database error', () => {
    expect(
      getPunchUpdateError({
        expectedId: '123',
        data: null,
        error: { message: 'permission denied' }
      })
    ).toBe('permission denied');
  });

  it('rejects an update that returned no target row', () => {
    expect(
      getPunchUpdateError({
        expectedId: '123',
        data: [],
        error: null
      })
    ).toBe('Punch record was not updated. Refresh and try again.');
  });

  it('accepts a response containing the target row', () => {
    expect(
      getPunchUpdateError({
        expectedId: '123',
        data: [{ id: 123 }],
        error: null
      })
    ).toBeNull();
  });
});
