import type { DailyListRow } from './types';

type NormalizeDailyListPosition = (value: string) => string | null | undefined;

export const isDailyListCountedRow = (
  row: Pick<DailyListRow, 'position' | 'shift'>,
  normalizePosition: NormalizeDailyListPosition
) => {
  if (row.shift !== 'early' && row.shift !== 'late') return false;
  return Boolean(normalizePosition(String(row.position ?? '').trim()));
};

export const isDailyListDisplayRow = (
  row: Pick<DailyListRow, 'position' | 'shift'>,
  normalizePosition: NormalizeDailyListPosition
) => isDailyListCountedRow(row, normalizePosition);

export const filterDailyListCountedRows = (
  rows: DailyListRow[],
  normalizePosition: NormalizeDailyListPosition
) => rows.filter((row) => isDailyListCountedRow(row, normalizePosition));

export const filterDailyListDisplayRows = (
  rows: DailyListRow[],
  normalizePosition: NormalizeDailyListPosition
) => rows.filter((row) => isDailyListDisplayRow(row, normalizePosition));

export const selectDailyListCapacityRows = (countedRows: DailyListRow[]) => countedRows;

export const resolveDailyListPositionSource = (profilePosition: unknown, schedulePosition: unknown) => {
  const profile = String(profilePosition ?? '').trim();
  const schedule = String(schedulePosition ?? '').trim();
  return {
    position: profile || schedule,
    profilePosition: profile,
    schedulePosition: schedule
  };
};
