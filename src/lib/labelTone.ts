export const LABEL_TONE_STORAGE_KEY = 'obpunch_schedule_label_tones_v1';
export const LABEL_TONE_KEYS = [
  'sky',
  'cyan',
  'teal',
  'emerald',
  'lime',
  'amber',
  'orange',
  'rose',
  'fuchsia',
  'violet',
  'indigo',
  'slate'
] as const;
export type LabelToneKey = (typeof LABEL_TONE_KEYS)[number];

export type LabelToneRow = {
  label?: string | null;
  tone?: string | null;
  updated_at?: string | null;
  operator?: string | null;
};

export const LABEL_TONE_CLASS_BY_KEY: Record<LabelToneKey, string> = {
  sky: 'badge-elevated-dark border-sky-400/60 bg-sky-500/10 text-sky-200',
  cyan: 'badge-elevated-dark border-cyan-400/60 bg-cyan-500/10 text-cyan-200',
  teal: 'badge-elevated-dark border-teal-400/60 bg-teal-500/10 text-teal-200',
  emerald: 'badge-elevated-dark border-emerald-400/60 bg-emerald-500/10 text-emerald-200',
  lime: 'badge-elevated-dark border-lime-400/60 bg-lime-500/10 text-lime-200',
  amber: 'badge-elevated-dark border-amber-400/60 bg-amber-500/10 text-amber-200',
  orange: 'badge-elevated-dark border-orange-400/60 bg-orange-500/10 text-orange-200',
  rose: 'badge-elevated-dark border-rose-400/60 bg-rose-500/10 text-rose-200',
  fuchsia: 'badge-elevated-dark border-fuchsia-400/60 bg-fuchsia-500/10 text-fuchsia-200',
  violet: 'badge-elevated-dark border-violet-400/60 bg-violet-500/10 text-violet-200',
  indigo: 'badge-elevated-dark border-indigo-400/60 bg-indigo-500/10 text-indigo-200',
  slate: 'badge-elevated-dark border-slate-400/60 bg-slate-500/10 text-slate-200'
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

export const normalizeLabelToneMap = (value: unknown): Record<string, LabelToneKey> => {
  const out: Record<string, LabelToneKey> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = String(k ?? '').trim();
    const tone = String(v ?? '').trim() as LabelToneKey;
    if (!key || !LABEL_TONE_KEYS.includes(tone)) continue;
    out[key.toLowerCase()] = tone;
  }
  return out;
};

export const readLabelToneMapFromRows = (rows: readonly LabelToneRow[] | null | undefined): Record<string, LabelToneKey> => {
  const out: Record<string, LabelToneKey> = {};
  for (const row of rows ?? []) {
    const label = String(row.label ?? '').trim();
    const tone = String(row.tone ?? '').trim() as LabelToneKey;
    if (!label || !LABEL_TONE_KEYS.includes(tone)) continue;
    out[label.toLowerCase()] = tone;
  }
  return out;
};

export const buildLabelToneRows = (
  map: Record<string, LabelToneKey>,
  meta?: {
    updatedAt?: string | null;
    operator?: string | null;
  }
): LabelToneRow[] => {
  const rows: LabelToneRow[] = [];
  for (const [labelRaw, toneRaw] of Object.entries(map)) {
    const label = String(labelRaw ?? '').trim();
    const tone = String(toneRaw ?? '').trim() as LabelToneKey;
    if (!label || !LABEL_TONE_KEYS.includes(tone)) continue;
    rows.push({
      label: label.toLowerCase(),
      tone,
      updated_at: meta?.updatedAt ?? null,
      operator: meta?.operator ?? null
    });
  }
  return rows;
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
