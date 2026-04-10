import type { AllowedPosition } from './types';

export type FlexCoverageTargetPosition = Extract<AllowedPosition, 'Pick' | 'Pack' | 'Rebin'>;
export type FlexCoverageShift = 'early' | 'late';
export type FlexCoverageCounts = Record<FlexCoverageTargetPosition, { early: number; late: number; total: number }>;
export type FlexCoverageByDayIndex = Record<number, FlexCoverageCounts>;
export type FlexCoverageEntry = {
  dayIndex: number;
  targetPosition: FlexCoverageTargetPosition;
  shift: FlexCoverageShift;
};
export type RecommendedPositionRow = {
  key: 'Pick' | 'Rebin' | 'Pack' | 'Preship';
  total: number;
  ds: number;
  ns: number;
};

const normalizeFlexCoverageKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '');

export const normalizeFlexCoverageTargetPosition = (value: unknown): FlexCoverageTargetPosition | null => {
  const key = normalizeFlexCoverageKey(value);
  if (!key) return null;
  if (key === 'pick' || key === 'picker' || key === 'picking') return 'Pick';
  if (key === 'pack' || key === 'packer' || key === 'packing') return 'Pack';
  if (key === 'sort' || key === 'sorter' || key === 'sorting' || key === 'rebin') return 'Rebin';
  return null;
};

export const createEmptyFlexCoverageCounts = (): FlexCoverageCounts => ({
  Pick: { early: 0, late: 0, total: 0 },
  Pack: { early: 0, late: 0, total: 0 },
  Rebin: { early: 0, late: 0, total: 0 }
});

export const buildFlexCoverageByDayIndex = (entries: FlexCoverageEntry[]): FlexCoverageByDayIndex => {
  const next: FlexCoverageByDayIndex = {};
  for (const entry of entries) {
    const dayIndex = Number(entry.dayIndex);
    if (!Number.isInteger(dayIndex) || dayIndex < 0) continue;
    const dayCounts = next[dayIndex] ?? createEmptyFlexCoverageCounts();
    const bucket = dayCounts[entry.targetPosition];
    bucket[entry.shift] += 1;
    bucket.total += 1;
    next[dayIndex] = dayCounts;
  }
  return next;
};

export const applyFlexCoverageToRecommendedRows = (
  rows: RecommendedPositionRow[],
  coverage: FlexCoverageCounts | null | undefined
): RecommendedPositionRow[] => {
  if (!coverage) return rows.map((row) => ({ ...row }));
  return rows.map((row) => {
    if (row.key !== 'Pick' && row.key !== 'Pack' && row.key !== 'Rebin') {
      return { ...row };
    }
    const ds = Math.max(0, Number(row.ds ?? 0) - Number(coverage[row.key].early ?? 0));
    const ns = Math.max(0, Number(row.ns ?? 0) - Number(coverage[row.key].late ?? 0));
    return {
      ...row,
      ds,
      ns,
      total: ds + ns
    };
  });
};
