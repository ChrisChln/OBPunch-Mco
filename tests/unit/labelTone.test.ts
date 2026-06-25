import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  getLabelToneClass,
  LABEL_TONE_CLASS_BY_KEY,
  LABEL_TONE_KEYS,
  LABEL_TONE_STORAGE_KEY,
  buildLabelToneRows,
  loadLabelToneMap,
  normalizeLabelToneMap,
  readLabelToneMapFromRows,
  saveLabelToneMap
} from '../../src/lib/labelTone';

describe('labelTone', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, String(v));
      }
    });
    vi.restoreAllMocks();
  });

  test('loads persisted tone map with normalized keys', () => {
    localStorage.setItem(
      LABEL_TONE_STORAGE_KEY,
      JSON.stringify({
        Blue: 'sky',
        RED: 'rose',
        InvalidTone: 'foo'
      })
    );

    expect(loadLabelToneMap()).toEqual({
      blue: 'sky',
      red: 'rose'
    });
  });

  test('returns empty when no persisted raw value', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: (_k: string, _v: string) => void 0
    });
    expect(loadLabelToneMap()).toEqual({});
  });

  test('filters blank key and invalid tone entries', () => {
    localStorage.setItem(
      LABEL_TONE_STORAGE_KEY,
      JSON.stringify({
        '': 'sky',
        '   ': 'emerald',
        Valid: 'amber',
        Invalid: ''
      })
    );
    expect(loadLabelToneMap()).toEqual({ valid: 'amber' });
  });

  test('handles parsed null payload via parsed ?? {} branch', () => {
    localStorage.setItem(LABEL_TONE_STORAGE_KEY, 'null');
    expect(loadLabelToneMap()).toEqual({});
  });

  test('handles null tone value via v ?? branch', () => {
    localStorage.setItem(LABEL_TONE_STORAGE_KEY, JSON.stringify({ Blue: null }));
    expect(loadLabelToneMap()).toEqual({});
  });

  test('save map writes to localStorage', () => {
    saveLabelToneMap({ yellow: 'amber' });
    expect(JSON.parse(storage.get(LABEL_TONE_STORAGE_KEY) ?? '{}')).toEqual({ yellow: 'amber' });
  });

  test('falls back to slate tone class', () => {
    expect(getLabelToneClass('unknown', {})).toBe(LABEL_TONE_CLASS_BY_KEY.slate);
    expect(getLabelToneClass('', { blue: LABEL_TONE_KEYS[0] })).toBe(LABEL_TONE_CLASS_BY_KEY.slate);
  });

  test('normalizes label tone maps from external values', () => {
    expect(
      normalizeLabelToneMap({
        Blue: 'sky',
        '  Lead  ': 'rose',
        Missing: 'invalid',
        Empty: null
      })
    ).toEqual({ blue: 'sky', lead: 'rose' });
  });

  test('builds and reads dedicated label tone rows', () => {
    const rows = buildLabelToneRows(
      {
        Blue: 'sky',
        Lead: 'rose',
        Invalid: 'missing' as (typeof LABEL_TONE_KEYS)[number]
      },
      { updatedAt: '2026-06-15T12:00:00.000Z', operator: 'ops@example.com' }
    );

    expect(rows).toEqual([
      {
        label: 'blue',
        tone: 'sky',
        updated_at: '2026-06-15T12:00:00.000Z',
        operator: 'ops@example.com'
      },
      {
        label: 'lead',
        tone: 'rose',
        updated_at: '2026-06-15T12:00:00.000Z',
        operator: 'ops@example.com'
      }
    ]);
    expect(readLabelToneMapFromRows(rows)).toEqual({ blue: 'sky', lead: 'rose' });
  });

  test('returns mapped tone class when label exists', () => {
    expect(getLabelToneClass('Blue', { blue: 'sky' })).toBe(LABEL_TONE_CLASS_BY_KEY.sky);
  });

  test('handles nullish labels as slate', () => {
    expect(getLabelToneClass((undefined as unknown) as string, { blue: 'sky' })).toBe(LABEL_TONE_CLASS_BY_KEY.slate);
    expect(getLabelToneClass((null as unknown) as string, { blue: 'sky' })).toBe(LABEL_TONE_CLASS_BY_KEY.slate);
  });

  test('load returns empty map when storage/json is broken', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{bad-json',
      setItem: (_k: string, _v: string) => void 0
    });
    expect(loadLabelToneMap()).toEqual({});

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('read failed');
      },
      setItem: (_k: string, _v: string) => void 0
    });
    expect(loadLabelToneMap()).toEqual({});
  });

  test('save ignores localStorage write errors', () => {
    vi.stubGlobal('localStorage', {
      getItem: (_k: string) => null,
      setItem: () => {
        throw new Error('write failed');
      }
    });
    expect(() => saveLabelToneMap({ blue: 'sky' })).not.toThrow();
  });
});
