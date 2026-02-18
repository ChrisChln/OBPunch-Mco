export const LABEL_TONE_STORAGE_KEY = 'obpunch_schedule_label_tones_v1';
export const LABEL_TONE_KEYS = ['sky', 'emerald', 'amber', 'violet', 'rose', 'slate'] as const;
export type LabelToneKey = (typeof LABEL_TONE_KEYS)[number];

export const LABEL_TONE_CLASS_BY_KEY: Record<LabelToneKey, string> = {
  sky: 'border-sky-400/60 bg-sky-500/10 text-sky-200',
  emerald: 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200',
  amber: 'border-amber-400/60 bg-amber-500/10 text-amber-200',
  violet: 'border-violet-400/60 bg-violet-500/10 text-violet-200',
  rose: 'border-rose-400/60 bg-rose-500/10 text-rose-200',
  slate: 'border-slate-400/60 bg-slate-500/10 text-slate-200'
};

export const loadLabelToneMap = (): Record<string, LabelToneKey> => {
  try {
    const raw = localStorage.getItem(LABEL_TONE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, LabelToneKey> = {};
    for (const [k, v] of Object.entries(parsed ?? {})) {
      const key = String(k ?? '').trim();
      const tone = String(v ?? '').trim() as LabelToneKey;
      if (!key || !LABEL_TONE_KEYS.includes(tone)) continue;
      out[key.toLowerCase()] = tone;
    }
    return out;
  } catch {
    return {};
  }
};

export const saveLabelToneMap = (map: Record<string, LabelToneKey>) => {
  try {
    localStorage.setItem(LABEL_TONE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
};

export const getLabelToneClass = (label: string, map: Record<string, LabelToneKey>) => {
  const key = String(label ?? '').trim().toLowerCase();
  const tone = key ? map[key] ?? 'slate' : 'slate';
  return LABEL_TONE_CLASS_BY_KEY[tone];
};
