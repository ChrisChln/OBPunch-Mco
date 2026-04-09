import { describe, expect, test } from 'vitest';
import { shouldAutofillShiftTime } from '../../src/admin/shiftTimeAutofill';

describe('shiftTimeAutofill', () => {
  test('autofills only when the field is truly blank', () => {
    expect(shouldAutofillShiftTime('')).toBe(true);
    expect(shouldAutofillShiftTime('   ')).toBe(true);
    expect(shouldAutofillShiftTime(null)).toBe(true);
  });

  test('preserves in-progress manual edits', () => {
    expect(shouldAutofillShiftTime('16:')).toBe(false);
    expect(shouldAutofillShiftTime('7')).toBe(false);
    expect(shouldAutofillShiftTime('07:0')).toBe(false);
    expect(shouldAutofillShiftTime('07:00')).toBe(false);
  });
});
