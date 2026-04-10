import { describe, expect, test } from 'vitest';
import {
  applyFlexCoverageToRecommendedRows,
  buildFlexCoverageByDayIndex,
  createEmptyFlexCoverageCounts,
  normalizeFlexCoverageTargetPosition
} from '../../src/admin/flexCoverage';

describe('flexCoverage', () => {
  test('maps flex labels to target positions', () => {
    expect(normalizeFlexCoverageTargetPosition('Pick')).toBe('Pick');
    expect(normalizeFlexCoverageTargetPosition('pack')).toBe('Pack');
    expect(normalizeFlexCoverageTargetPosition('Sort')).toBe('Rebin');
    expect(normalizeFlexCoverageTargetPosition('Sorter')).toBe('Rebin');
    expect(normalizeFlexCoverageTargetPosition('Other')).toBeNull();
  });

  test('aggregates flex coverage by day index and shift', () => {
    const byDay = buildFlexCoverageByDayIndex([
      { dayIndex: 1, targetPosition: 'Pick', shift: 'early' },
      { dayIndex: 1, targetPosition: 'Pick', shift: 'early' },
      { dayIndex: 1, targetPosition: 'Rebin', shift: 'late' }
    ]);

    expect(byDay[1]?.Pick).toEqual({ early: 2, late: 0, total: 2 });
    expect(byDay[1]?.Rebin).toEqual({ early: 0, late: 1, total: 1 });
  });

  test('subtracts flex coverage from recommended headcount', () => {
    const coverage = createEmptyFlexCoverageCounts();
    coverage.Pick.early = 2;
    coverage.Pick.total = 2;
    coverage.Rebin.late = 1;
    coverage.Rebin.total = 1;

    expect(
      applyFlexCoverageToRecommendedRows(
        [
          { key: 'Pick', ds: 18, ns: 12, total: 30 },
          { key: 'Rebin', ds: 5, ns: 4, total: 9 },
          { key: 'Pack', ds: 20, ns: 14, total: 34 },
          { key: 'Preship', ds: 7, ns: 5, total: 12 }
        ],
        coverage
      )
    ).toEqual([
      { key: 'Pick', ds: 16, ns: 12, total: 28 },
      { key: 'Rebin', ds: 5, ns: 3, total: 8 },
      { key: 'Pack', ds: 20, ns: 14, total: 34 },
      { key: 'Preship', ds: 7, ns: 5, total: 12 }
    ]);
  });

  test('never drops below zero', () => {
    const coverage = createEmptyFlexCoverageCounts();
    coverage.Pack.early = 5;
    coverage.Pack.total = 5;

    expect(applyFlexCoverageToRecommendedRows([{ key: 'Pack', ds: 3, ns: 1, total: 4 }], coverage)).toEqual([
      { key: 'Pack', ds: 0, ns: 1, total: 1 }
    ]);
  });
});
