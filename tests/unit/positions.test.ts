import { describe, expect, test } from 'vitest';
import { buildActivePositionNames, normalizePositionName, resolvePositionName } from '../../src/shared/positions';

describe('positions', () => {
  test('normalizes position names for storage and comparison', () => {
    expect(normalizePositionName('  Pick  ')).toBe('Pick');
    expect(normalizePositionName(null)).toBe('');
  });

  test('keeps inactive positions out of active option names', () => {
    expect(
      buildActivePositionNames([
        { name: 'Pick', is_active: true, display_order: 1 },
        { name: 'Old', is_active: false, display_order: 2 },
        { name: 'Pack', is_active: true, display_order: 0 }
      ])
    ).toEqual(['Pack', 'Pick']);
  });

  test('resolves custom active position names for filters', () => {
    expect(resolvePositionName('  inbound qc  ', ['Pick', 'Inbound QC'])).toBe('Inbound QC');
    expect(resolvePositionName('waterspider', ['Pick', 'Water Spider'])).toBe('Water Spider');
    expect(resolvePositionName('unknown', ['Pick', 'Inbound QC'])).toBeNull();
  });
});
