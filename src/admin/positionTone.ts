import { LABEL_TONE_KEYS, type LabelToneKey } from '../lib/labelTone';
import { normalizePositionName } from '../shared/positions';

export type PositionToneMap = Record<string, LabelToneKey>;

const DEFAULT_POSITION_TONES: PositionToneMap = {
  pick: 'sky',
  pack: 'emerald',
  rebin: 'amber',
  preship: 'rose',
  transfer: 'violet',
  'water spider': 'sky',
  'flex team': 'slate'
};

export const normalizePositionToneKey = (value: unknown) => normalizePositionName(value).toLowerCase();

export const getDefaultPositionToneKey = (value: unknown): LabelToneKey => {
  const key = normalizePositionToneKey(value);
  return DEFAULT_POSITION_TONES[key] ?? 'slate';
};

export const normalizePositionToneMap = (value: unknown): PositionToneMap => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const next: PositionToneMap = { ...DEFAULT_POSITION_TONES };
  for (const [rawPosition, rawTone] of Object.entries(raw)) {
    const key = normalizePositionToneKey(rawPosition);
    const tone = String(rawTone ?? '').trim() as LabelToneKey;
    if (!key || !LABEL_TONE_KEYS.includes(tone)) continue;
    next[key] = tone;
  }
  return next;
};

export const normalizeExplicitPositionToneMap = (value: unknown): PositionToneMap => {
  const raw = (value ?? {}) as Record<string, unknown>;
  const next: PositionToneMap = {};
  for (const [rawPosition, rawTone] of Object.entries(raw)) {
    const key = normalizePositionToneKey(rawPosition);
    const tone = String(rawTone ?? '').trim() as LabelToneKey;
    if (!key || !LABEL_TONE_KEYS.includes(tone)) continue;
    next[key] = tone;
  }
  return next;
};

export const mergeLegacyPositionToneMap = (
  current: PositionToneMap,
  legacy: PositionToneMap,
  authoritativePositions: readonly string[]
): PositionToneMap => {
  if (authoritativePositions.length === 0) return { ...current, ...legacy };
  return { ...legacy, ...current };
};

export const getPositionToneFromMap = (value: unknown, toneMap?: Partial<PositionToneMap>) => {
  const key = normalizePositionToneKey(value);
  return (key ? toneMap?.[key] : undefined) ?? getDefaultPositionToneKey(value);
};
