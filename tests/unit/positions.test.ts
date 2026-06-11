import { describe, expect, test } from 'vitest';
import {
  buildActivePositionNames,
  buildAttendanceTrackedPositionNames,
  normalizePositionDepartment,
  normalizePositionName,
  normalizePositionTone,
  resolvePositionName
} from '../../src/shared/positions';

describe('positions', () => {
  test('normalizes position names for storage and comparison', () => {
    expect(normalizePositionName('  Pick  ')).toBe('Pick');
    expect(normalizePositionName(null)).toBe('');
  });

  test('keeps inactive positions out of active option names', () => {
    expect(
      buildActivePositionNames([
        { name: 'Pick', is_active: true, display_order: 1 },
        { name: 'Old', is_active: false, display_order: 2 },
        { name: 'Pack', is_active: true, display_order: 0 }
      ])
    ).toEqual(['Pack', 'Pick']);
  });

  test('keeps hidden department positions out of attendance tracked names', () => {
    expect(
      buildAttendanceTrackedPositionNames([
        { name: 'Pick', department: 'OB', is_active: true, display_order: 1 },
        { name: 'JDL', department: 'hidden', is_active: true, display_order: 2 },
        { name: 'Receive', department: 'IB', is_active: true, display_order: 3 }
      ])
    ).toEqual(['Pick', 'Receive']);
  });

  test('normalizes position departments', () => {
    expect(normalizePositionDepartment('inventory')).toBe('INV');
    expect(normalizePositionDepartment('隐藏')).toBe('hidden');
    expect(normalizePositionDepartment('')).toBe('OB');
  });

  test('normalizes position tone keys', () => {
    expect(normalizePositionTone('emerald')).toBe('emerald');
    expect(normalizePositionTone('unknown')).toBe('slate');
    expect(normalizePositionTone(null)).toBe('slate');
  });

  test('resolves custom active position names for filters', () => {
    expect(resolvePositionName('  inbound qc  ', ['Pick', 'Inbound QC'])).toBe('Inbound QC');
    expect(resolvePositionName('waterspider', ['Pick', 'Water Spider'])).toBe('Water Spider');
    expect(resolvePositionName('unknown', ['Pick', 'Inbound QC'])).toBeNull();
  });
});
