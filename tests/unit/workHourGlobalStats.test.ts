import { describe, expect, it } from 'vitest';
import { getTrackedStaffIds } from '../../src/admin/workHourGlobalStats';

describe('workHourGlobalStats', () => {
  it('returns only tracked position staff ids', () => {
    const result = getTrackedStaffIds(
      {
        US0001: { staffId: 'US0001', position: 'Pick' },
        US0002: { staffId: 'US0002', position: 'Transfer' },
        US0003: { staffId: 'US0003', position: 'Manager' }
      },
      ['Pick', 'Pack', 'Transfer']
    );

    expect(result).toEqual(['US0001', 'US0002']);
  });

  it('deduplicates and sorts tracked staff ids', () => {
    const result = getTrackedStaffIds(
      {
        B: { staffId: 'US0002', position: 'Pack' },
        A: { staffId: 'US0001', position: 'Pack' },
        C: { staffId: 'US0002', position: 'Pack' }
      },
      ['Pack']
    );

    expect(result).toEqual(['US0001', 'US0002']);
  });
});
