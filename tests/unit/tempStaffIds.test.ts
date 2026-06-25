import { describe, expect, test, vi } from 'vitest';
import {
  allocateTemporaryStaffId,
  createManualTemporaryStaffId,
  extractTemporaryStaffIdNumber,
  getHighestTemporaryStaffIdNumber,
  isGeneratedTemporaryStaffId,
  isNewHirePlaceholderStaffId,
  resolveEmployeeEditStaffIds,
  shouldAllocateTemporaryStaffIdOnEdit
} from '../../src/admin/tempStaffIds';

describe('temporary staff ids', () => {
  test('creates the next manual TUS id for new temporary employees', () => {
    expect(createManualTemporaryStaffId(['US010454', 'TUS0000002', 'TUS0000082'])).toBe('TUS0000083');
  });

  test('reads the highest TUS sequence from existing values', () => {
    expect(getHighestTemporaryStaffIdNumber(['US010454', 'TUS0000002', 'TUS0000082'])).toBe(82);
    expect(extractTemporaryStaffIdNumber('tus0000105')).toBe(105);
    expect(extractTemporaryStaffIdNumber('US010454')).toBeNull();
  });

  test('keeps an existing TUS id when editing with an empty staff input', () => {
    expect(resolveEmployeeEditStaffIds('TUS0000082', '')).toEqual({
      originalStaff: 'TUS0000082',
      nextStaff: 'TUS0000082',
      isPlaceholderOriginal: true
    });
  });

  test('normalizes explicit edit targets', () => {
    expect(resolveEmployeeEditStaffIds('TUS0000082', 'us012345')).toEqual({
      originalStaff: 'TUS0000082',
      nextStaff: 'US012345',
      isPlaceholderOriginal: true
    });
  });

  test('recognizes generated placeholder staff ids', () => {
    expect(isNewHirePlaceholderStaffId('TUS0000001')).toBe(true);
    expect(isNewHirePlaceholderStaffId('TEMP-USID-TEST-0001')).toBe(true);
    expect(isNewHirePlaceholderStaffId('US010454')).toBe(false);
  });

  test('distinguishes generated temporary ids from agency placeholders', () => {
    expect(isGeneratedTemporaryStaffId('TUS0000001')).toBe(true);
    expect(isGeneratedTemporaryStaffId('TEMP-USID-TEST-0001')).toBe(true);
    expect(isGeneratedTemporaryStaffId('0625PACK002')).toBe(false);
  });

  test('allocates a TUS id when editing a placeholder with no entered USID', () => {
    expect(shouldAllocateTemporaryStaffIdOnEdit('0625PACK002', '')).toBe(true);
    expect(shouldAllocateTemporaryStaffIdOnEdit('TUS0000082', '')).toBe(false);
    expect(shouldAllocateTemporaryStaffIdOnEdit('0625PACK002', 'US012345')).toBe(false);
  });

  test('allocates the next TUS id from rpc when available', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: 'TUS0000123', error: null }))
    };

    await expect(allocateTemporaryStaffId(supabase as never, ['TUS0000002'])).resolves.toBe('TUS0000123');
  });

  test('falls back to local allocation when the rpc is unavailable', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: 'Could not find the function public.next_temp_staff_id() in the schema cache' }
      }))
    };

    await expect(allocateTemporaryStaffId(supabase as never, ['TUS0000002', 'TUS0000082'])).resolves.toBe('TUS0000083');
  });

  test('surfaces rpc failures that are not safe to ignore', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: 'permission denied for function next_temp_staff_id' }
      }))
    };

    await expect(allocateTemporaryStaffId(supabase as never, ['TUS0000002'])).rejects.toThrow(
      'permission denied for function next_temp_staff_id'
    );
  });
});
