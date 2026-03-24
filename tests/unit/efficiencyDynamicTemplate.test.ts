import { describe, expect, test } from 'vitest';
import { resolveDynamicProcKey } from '../../src/admin/efficiencyDynamicTemplate';

describe('efficiencyDynamicTemplate', () => {
  test('maps pick and rebin positions directly', () => {
    expect(resolveDynamicProcKey('Pick', '')).toBe('pick');
    expect(resolveDynamicProcKey('Rebin', '')).toBe('rebin');
  });

  test('maps pack labels to single and multi pack buckets', () => {
    expect(resolveDynamicProcKey('Pack', 'Single Pack')).toBe('single_pack');
    expect(resolveDynamicProcKey('Pack', 'multi pack')).toBe('multi_pack');
  });

  test('ignores pack rows whose labels are not single or multi', () => {
    expect(resolveDynamicProcKey('Pack', 'Pack Lead')).toBeNull();
    expect(resolveDynamicProcKey('Pack', 'Water Spider')).toBeNull();
  });

  test('ignores unsupported positions', () => {
    expect(resolveDynamicProcKey('Preship', 'Preship')).toBeNull();
    expect(resolveDynamicProcKey('Consolidation', '')).toBeNull();
  });
});
