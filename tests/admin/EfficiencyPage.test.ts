import { describe, expect, it } from 'vitest';
import { calculateShiftForecastSplit, getThroughputCapacityTotals } from '../../src/admin/pages/EfficiencyPage';

describe('calculateShiftForecastSplit', () => {
  it('caps day shift forecast at the full day forecast', () => {
    const split = calculateShiftForecastSplit({
      fullDayForecast: 11000,
      previousDayBacklog: 9000,
      previousDayCapacity: 0,
      yesterdayInflow0014: 5000,
      buffer: 2000
    });

    expect(split).toEqual({
      dayShiftForecast: 11000,
      nightShiftForecast: 0
    });
  });

  it('uses the remaining full day forecast for night shift when day shift is below the cap', () => {
    const split = calculateShiftForecastSplit({
      fullDayForecast: 20000,
      previousDayBacklog: 4000,
      previousDayCapacity: 6000,
      yesterdayInflow0014: 3000,
      buffer: 2000
    });

    expect(split).toEqual({
      dayShiftForecast: 19000,
      nightShiftForecast: 1000
    });
  });
});

describe('getThroughputCapacityTotals', () => {
  it('uses Pick capacity for the table total instead of summing area capacities', () => {
    const totals = getThroughputCapacityTotals([
      { key: 'picking_group', dsCapacity: 9126, nsCapacity: 0 },
      { key: 'rebin_group', dsCapacity: 5850, nsCapacity: 0 },
      { key: 'con_group', dsCapacity: 7800, nsCapacity: 0 },
      { key: 'packing_group', dsCapacity: 8650, nsCapacity: 0 },
      { key: 'waterspider_group', dsCapacity: 0, nsCapacity: 0 },
      { key: 'preship', dsCapacity: 6400, nsCapacity: 0 }
    ]);

    expect(totals).toEqual({
      totalDsCapacity: 9126,
      totalNsCapacity: 0
    });
  });

  it('returns zero when Pick is not present', () => {
    const totals = getThroughputCapacityTotals([
      { key: 'rebin_group', dsCapacity: 5850, nsCapacity: 0 }
    ]);

    expect(totals).toEqual({
      totalDsCapacity: 0,
      totalNsCapacity: 0
    });
  });
});
