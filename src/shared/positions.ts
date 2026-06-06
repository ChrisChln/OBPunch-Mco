export type PositionRecord = {
  id?: string | number;
  name: string;
  is_active: boolean;
  display_order: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export const DEFAULT_POSITION_NAMES = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'Water Spider', 'FLEX TEAM'] as const;

export const normalizePositionName = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');

export const resolvePositionName = (value: unknown, positionNames: readonly string[]) => {
  const trimmed = normalizePositionName(value);
  if (!trimmed) return null;

  const direct = positionNames.find((position) => normalizePositionName(position).toLowerCase() === trimmed.toLowerCase());
  if (direct) return normalizePositionName(direct);

  const normalized = trimmed.toLowerCase();
  if (normalized === 'water spider' || normalized === 'waterspider' || normalized === 'water-spider') {
    return positionNames.find((position) => normalizePositionName(position).toLowerCase() === 'water spider') ?? null;
  }
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
    return positionNames.find((position) => normalizePositionName(position).toLowerCase() === 'flex team') ?? null;
  }

  return null;
};

export const buildActivePositionNames = (positions: PositionRecord[]) =>
  positions
    .filter((position) => position.is_active && normalizePositionName(position.name))
    .sort((left, right) => {
      const orderDiff = Number(left.display_order ?? 0) - Number(right.display_order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return normalizePositionName(left.name).localeCompare(normalizePositionName(right.name), 'en-US');
    })
    .map((position) => normalizePositionName(position.name));
