import { describe, expect, test } from 'vitest';

import {
  getPositionToneFromMap,
  mergeLegacyPositionToneMap,
  normalizeExplicitPositionToneMap,
  normalizePositionToneKey,
  normalizePositionToneMap
} from '../../src/admin/positionTone';

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

  test('parses only explicitly saved tones for global config merges', () => {
    expect(normalizeExplicitPositionToneMap({})).toEqual({});
    expect(normalizeExplicitPositionToneMap({ Receive: 'cyan', Pack: 'invalid' })).toEqual({
      receive: 'cyan'
    });
  });

  test('keeps authoritative position tones ahead of legacy global tones', () => {
    expect(
      mergeLegacyPositionToneMap(
        { receive: 'lime', pack: 'emerald' },
        { receive: 'cyan', shipping: 'rose' },
        ['Receive', 'Pack']
      )
    ).toEqual({
      receive: 'lime',
      shipping: 'rose',
      pack: 'emerald'
    });
  });

  test('uses legacy position tones as fallback before positions load', () => {
    expect(mergeLegacyPositionToneMap({ pack: 'emerald' }, { pack: 'rose', receive: 'cyan' }, [])).toEqual({
      pack: 'rose',
      receive: 'cyan'
    });
  });
});
