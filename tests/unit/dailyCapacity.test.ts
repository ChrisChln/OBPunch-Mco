import { describe, expect, test } from 'vitest';
import { averageRecentDataDaysUph, resolveDailyCapacityProcKey } from '../../src/admin/dailyCapacity';

describe('dailyCapacity', () => {
  test('maps employees to capacity proc keys', () => {
    expect(resolveDailyCapacityProcKey('Pick', 'Blue')).toBe('pick');
    expect(resolveDailyCapacityProcKey('Rebin', 'Sorter')).toBe('rebin');
    expect(resolveDailyCapacityProcKey('Rebin', 'Consolidation')).toBe('consolidation');
    expect(resolveDailyCapacityProcKey('Pack', 'Single Pack')).toBe('single_pack');
    expect(resolveDailyCapacityProcKey('Pack', 'Multi Pack')).toBe('multi_pack');
    expect(resolveDailyCapacityProcKey('Pack', 'Water Spider')).toBe('waterspider');
    expect(resolveDailyCapacityProcKey('Preship', 'Preship')).toBe('pre_ship');
    expect(resolveDailyCapacityProcKey('Transfer', 'Order Picker')).toBeNull();
  });

  test('averages only the latest 14 data days', () => {
    const buckets = Array.from({ length: 16 }, (_, index) => ({
      workDate: `2026-03-${String(index + 1).padStart(2, '0')}`,
      sum: 100 + index,
      count: 1
    }));
    const avg = averageRecentDataDaysUph(buckets);
    const expected = Array.from({ length: 14 }, (_, index) => 102 + index).reduce((sum, value) => sum + value, 0) / 14;
    expect(avg).toBe(expected);
  });
});
