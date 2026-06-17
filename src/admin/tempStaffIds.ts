import { normalizeStaffId } from '../lib/staffId';

export const isNewHirePlaceholderStaffId = (value: string) => {
  const staff = String(value ?? '').trim().toUpperCase();
  if (!staff) return false;
  if (/^TUS\d{7,}$/i.test(staff)) return true;
  if (/^TEMP-USID-[A-Z0-9]+-\d{4,}$/i.test(staff)) return true;
  if (/^NEWREQ-\d{8}(?:-[A-Z]+)?-\d{3,}$/i.test(staff)) return true;
  return /^\d{4}[A-Z]+\d{3,}$/i.test(staff);
};

export const createManualTemporaryStaffId = (existingStaffIds: string[] = []) => {
  let max = 0;
  for (const value of existingStaffIds) {
    const match = String(value ?? '').trim().toUpperCase().match(/^TUS(\d{7,})$/);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return `TUS${String(max + 1).padStart(7, '0')}`;
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
