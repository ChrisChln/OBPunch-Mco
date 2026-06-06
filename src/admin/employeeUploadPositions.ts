const normalizePositionToken = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');

const normalizePositionKey = (value: unknown) => normalizePositionToken(value).toLowerCase();

const LEGACY_POSITION_ALIASES: Record<string, string> = {
  '兜底组': 'FLEX TEAM',
  '兜底': 'FLEX TEAM',
  'flex team（机动组）': 'FLEX TEAM',
  'flex team': 'FLEX TEAM',
  flexteam: 'FLEX TEAM',
  'wrap-up team': 'FLEX TEAM',
  'wrap up team': 'FLEX TEAM',
  wrapupteam: 'FLEX TEAM',
  fallback: 'FLEX TEAM',
  backup: 'FLEX TEAM'
};

export type UploadPositionRow = {
  staff_id?: string;
  position?: string | null;
};

export const normalizeEmployeeUploadPosition = (
  positionRaw: unknown,
  activePositionNames: readonly string[]
) => {
  const token = normalizePositionToken(positionRaw);
  if (!token) return '';

  const activeByKey = new Map(
    activePositionNames
      .map((position) => normalizePositionToken(position))
      .filter(Boolean)
      .map((position) => [normalizePositionKey(position), position] as const)
  );

  const direct = activeByKey.get(normalizePositionKey(token));
  if (direct) return direct;

  const alias = LEGACY_POSITION_ALIASES[normalizePositionKey(token)];
  if (!alias) return '';
  return activeByKey.get(normalizePositionKey(alias)) ?? alias;
};

export const findInvalidEmployeeUploadPositions = (
  rows: UploadPositionRow[],
  activePositionNames: readonly string[]
) =>
  rows
    .map((row) => ({
      staff_id: String(row.staff_id ?? '').trim(),
      position: String(row.position ?? '').trim()
    }))
    .filter(({ position }) => position && !normalizeEmployeeUploadPosition(position, activePositionNames));
