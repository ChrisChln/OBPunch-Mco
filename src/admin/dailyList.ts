import { isScheduleOnlyAgency } from '../shared/agencyRules';
import type { DailyListRow } from './types';

type NormalizeDailyListPosition = (value: string) => string | null | undefined;

export const isDailyListCountedRow = (
  row: Pick<DailyListRow, 'position' | 'shift'>,
  normalizePosition: NormalizeDailyListPosition
) => {
  if (row.shift !== 'early' && row.shift !== 'late') return false;
  return Boolean(normalizePosition(String(row.position ?? '').trim()));
};

export const isDailyListDisplayRow = (row: Pick<DailyListRow, 'agency' | 'scheduleOnly'>) =>
  !row.scheduleOnly && !isScheduleOnlyAgency(String(row.agency ?? '').trim());

export const filterDailyListCountedRows = (
  rows: DailyListRow[],
  normalizePosition: NormalizeDailyListPosition
) => rows.filter((row) => isDailyListCountedRow(row, normalizePosition));

export const filterDailyListDisplayRows = (rows: DailyListRow[]) => rows.filter(isDailyListDisplayRow);

export const selectDailyListCapacityRows = (countedRows: DailyListRow[]) => countedRows;
