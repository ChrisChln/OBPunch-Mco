import { describe, expect, test } from 'vitest';

import { getPositionToneFromMap, normalizePositionToneKey, normalizePositionToneMap } from '../../src/admin/positionTone';

describe('positionTone', () => {
  test('normalizes custom position keys without case sensitivity', () => {
    expect(normalizePositionToneKey('  RECEIVE  ')).toBe('receive');
    expect(normalizePositionToneKey('Receive')).toBe('receive');
    expect(normalizePositionToneKey('receive')).toBe('receive');
  });

  test('uses custom configured tones across position casing variants', () => {
    const toneMap = normalizePositionToneMap({
      RECEIVE: 'cyan',
      'Inventory Control': 'violet'
    });

    expect(getPositionToneFromMap('Receive', toneMap)).toBe('cyan');
    expect(getPositionToneFromMap('receive', toneMap)).toBe('cyan');
    expect(getPositionToneFromMap('RECEIVE', toneMap)).toBe('cyan');
    expect(getPositionToneFromMap(' inventory   control ', toneMap)).toBe('violet');
  });

  test('keeps built-in fallback tones normalized', () => {
    const toneMap = normalizePositionToneMap({});

    expect(getPositionToneFromMap('Pick', toneMap)).toBe('sky');
    expect(getPositionToneFromMap('pick', toneMap)).toBe('sky');
    expect(getPositionToneFromMap('Water Spider', toneMap)).toBe('sky');
  });
});
