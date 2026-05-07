import { describe, expect, test } from 'vitest';
import { buildActivePositionNames, normalizePositionName } from '../../src/shared/positions';

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
});
