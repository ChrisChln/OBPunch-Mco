import { DEFAULT_POSITION_NAMES, normalizePositionName, resolvePositionName } from './positions';

export const DEFAULT_DASHBOARD_CARD_POSITIONS = DEFAULT_POSITION_NAMES.filter((position) => position !== 'FLEX TEAM');

export const resolveDashboardPositionName = (value: unknown, positionNames: readonly string[]) => {
  const resolved = resolvePositionName(value, positionNames);
  if (resolved) return resolved;

  const trimmed = normalizePositionName(value);
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();
  if (lowered.includes('pick')) return 'Pick';
  if (lowered.includes('pack')) return 'Pack';
  if (lowered.includes('rebin')) return 'Rebin';
  if (lowered.includes('preship')) return 'Preship';
  if (lowered.includes('transfer')) return 'Transfer';
  if (lowered.includes('flex') || lowered.includes('兜底') || lowered.includes('wrap')) return 'FLEX TEAM';
  return '';
};

const addUniquePosition = (target: string[], seen: Set<string>, value: unknown) => {
  const position = normalizePositionName(value);
  if (!position) return;
  const key = position.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  target.push(position);
};

export const buildDashboardPositionOptions = (activePositions: readonly string[], observedPositions: readonly string[] = []) => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const position of activePositions) {
    addUniquePosition(result, seen, position);
  }
  for (const position of observedPositions) {
    const resolved = resolveDashboardPositionName(position, result);
    addUniquePosition(result, seen, resolved || position);
  }
  return result;
};

export const buildDashboardCardPositions = (activePositions: readonly string[], observedPositions: readonly string[] = []) =>
  buildDashboardPositionOptions(activePositions.length ? activePositions : DEFAULT_DASHBOARD_CARD_POSITIONS, observedPositions).filter(
    (position) => resolveDashboardPositionName(position, activePositions) !== 'FLEX TEAM' && normalizePositionName(position).toLowerCase() !== 'flex team'
  );
