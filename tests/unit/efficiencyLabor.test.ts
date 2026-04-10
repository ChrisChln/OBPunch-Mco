import { describe, expect, it } from 'vitest';
import { calculateRequirement } from '../../src/admin/pages/EfficiencyPage';

describe('calculateRequirement', () => {
  it('returns 0 when workload is 0 even if lead is configured', () => {
    expect(calculateRequirement(0, '1000', '7.5', '1', 'ceil')).toBe(0);
  });

  it('does not force consolidation to keep 1 person when packages are 0', () => {
    expect(calculateRequirement(0, '1000', '7.5', '1', 'ceil')).toBe(0);
  });

  it('still adds lead when workload exists', () => {
    expect(calculateRequirement(7500, '1000', '7.5', '1', 'ceil')).toBe(2);
  });
});
