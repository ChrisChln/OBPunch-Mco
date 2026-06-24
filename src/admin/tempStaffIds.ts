import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeStaffId } from '../lib/staffId';

type RpcInvoker = Pick<SupabaseClient, 'rpc'>;
type RpcResult<T> = {
  data: T | null;
  error: { message?: string | null } | null;
};

export const isNewHirePlaceholderStaffId = (value: string) => {
  const staff = String(value ?? '').trim().toUpperCase();
  if (!staff) return false;
  if (/^TUS\d{7,}$/i.test(staff)) return true;
  if (/^TEMP-USID-[A-Z0-9]+-\d{4,}$/i.test(staff)) return true;
  if (/^NEWREQ-\d{8}(?:-[A-Z]+)?-\d{3,}$/i.test(staff)) return true;
  return /^\d{4}[A-Z]+\d{3,}$/i.test(staff);
};

const TUS_ID_PATTERN = /^TUS(\d{7,})$/;

export const buildTemporaryStaffId = (sequenceNumber: number) => `TUS${String(sequenceNumber).padStart(7, '0')}`;

export const extractTemporaryStaffIdNumber = (value: string) => {
  const match = String(value ?? '').trim().toUpperCase().match(TUS_ID_PATTERN);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const getHighestTemporaryStaffIdNumber = (existingStaffIds: string[] = []) => {
  let max = 0;
  for (const value of existingStaffIds) {
    const parsed = extractTemporaryStaffIdNumber(value);
    if (parsed === null) continue;
    max = Math.max(max, parsed);
  }
  return max;
};

export const createManualTemporaryStaffId = (existingStaffIds: string[] = []) => {
  return buildTemporaryStaffId(getHighestTemporaryStaffIdNumber(existingStaffIds) + 1);
};

export const resolveEmployeeEditStaffIds = (
  originalStaffRaw: string,
  nextStaffInputRaw: string
) => {
  const originalTrimmed = String(originalStaffRaw ?? '').trim();
  const isPlaceholderOriginal = isNewHirePlaceholderStaffId(originalTrimmed);
  const originalStaff = isPlaceholderOriginal ? originalTrimmed : normalizeStaffId(originalTrimmed);
  const nextInput = String(nextStaffInputRaw ?? '').trim();
  const nextStaff = nextInput ? normalizeStaffId(nextInput) : originalStaff;

  return {
    originalStaff,
    nextStaff,
    isPlaceholderOriginal
  };
};

const isMissingNextTempStaffIdRpc = (message: string) => {
  const normalized = String(message ?? '').toLowerCase();
  if (!normalized.includes('next_temp_staff_id')) return false;
  return (
    normalized.includes('could not find') ||
    normalized.includes('schema cache') ||
    normalized.includes('does not exist') ||
    normalized.includes('not found')
  );
};

export const allocateTemporaryStaffId = async (
  supabase: RpcInvoker | null,
  existingStaffIds: string[] = []
) => {
  if (!supabase) {
    return createManualTemporaryStaffId(existingStaffIds);
  }

  const result = (await supabase.rpc('next_temp_staff_id')) as RpcResult<string>;
  if (result.error) {
    const message = String(result.error.message ?? 'Failed to allocate temp staff ID.');
    if (isMissingNextTempStaffIdRpc(message)) {
      return createManualTemporaryStaffId(existingStaffIds);
    }
    throw new Error(message);
  }

  const nextStaffId = String(result.data ?? '').trim().toUpperCase();
  if (!extractTemporaryStaffIdNumber(nextStaffId)) {
    throw new Error('Failed to allocate a valid temp staff ID.');
  }
  return nextStaffId;
};
