export const DAILY_LIST_LIGHTS_KEY = 'daily_list_position_lights';

export const DAILY_LIST_LIGHT_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'FLEX TEAM'] as const;

export type DailyListLightPosition = (typeof DAILY_LIST_LIGHT_POSITIONS)[number];

export type DailyListLightFlags = Record<DailyListLightPosition, boolean>;

export const createEmptyDailyListLightFlags = (): DailyListLightFlags => ({
  Pick: false,
  Pack: false,
  Rebin: false,
  Preship: false,
  Transfer: false,
  'FLEX TEAM': false
});

export const normalizeDailyListLightPosition = (value: unknown): DailyListLightPosition | '' => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'pick') return 'Pick';
  if (normalized === 'pack') return 'Pack';
  if (normalized === 'rebin') return 'Rebin';
  if (normalized === 'preship' || normalized === 'pre ship' || normalized === 'pre-ship') return 'Preship';
  if (normalized === 'transfer') return 'Transfer';
  if (normalized === 'water spider' || normalized === 'waterspider' || normalized === 'water-spider') return 'Pack';
  if (
    normalized === '兜底组' ||
    normalized === '兜底' ||
    normalized === 'flex team（机动组）' ||
    normalized === 'flex team' ||
    normalized === 'flexteam' ||
    normalized === 'wrap-up team' ||
    normalized === 'wrap up team' ||
    normalized === 'wrapup team' ||
    normalized === 'fallback' ||
    normalized === 'backup'
  ) {
    return 'FLEX TEAM';
  }
  return '';
};

const isDateOnlyValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const readFlagsFromRecord = (value: unknown): DailyListLightFlags => {
  const next = createEmptyDailyListLightFlags();
  if (!value || typeof value !== 'object') return next;
  for (const [key, enabled] of Object.entries(value as Record<string, unknown>)) {
    const position = normalizeDailyListLightPosition(key);
    if (!position) continue;
    next[position] = next[position] || Boolean(enabled);
  }
  return next;
};

export const readDailyListLightsByDate = (value: unknown): Record<string, DailyListLightFlags> => {
  const result: Record<string, DailyListLightFlags> = {};
  if (!value || typeof value !== 'object') return result;

  const record = value as Record<string, unknown>;
  const selectedByDateRaw = record.selected_by_date;
  if (selectedByDateRaw && typeof selectedByDateRaw === 'object') {
    for (const [dateKey, flagsRaw] of Object.entries(selectedByDateRaw as Record<string, unknown>)) {
      if (!isDateOnlyValue(dateKey)) continue;
      result[dateKey] = readFlagsFromRecord(flagsRaw);
    }
    return result;
  }

  const legacyDate = String(record.operational_date ?? '').trim();
  if (isDateOnlyValue(legacyDate)) {
    result[legacyDate] = readFlagsFromRecord(record.selected_positions);
  }
  return result;
};

export const readDailyListLightsForDate = (value: unknown, targetDate: string): DailyListLightFlags => {
  const byDate = readDailyListLightsByDate(value);
  return byDate[targetDate] ?? createEmptyDailyListLightFlags();
};

export const buildDailyListLightsSettingValue = (
  currentValue: unknown,
  targetDate: string,
  nextFlags: DailyListLightFlags,
  meta?: {
    updatedAt?: string | null;
    operator?: string | null;
  }
) => {
  const selectedByDate = readDailyListLightsByDate(currentValue);
  selectedByDate[targetDate] = { ...nextFlags };
  return {
    selected_by_date: selectedByDate,
    updated_at: meta?.updatedAt ?? null,
    operator: meta?.operator ?? null
  };
};
