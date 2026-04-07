import { normalizeStaffId } from '../lib/staffId';

export type ParsedUploadRow = {
  workDate: string;
  sourceUserCode: string;
  staffId: string;
  iamsHours: number;
  rowNumber: number;
};

export type PreparedWorkHourUploadRows = {
  matchedRows: ParsedUploadRow[];
  skipReasons: string[];
  duplicateReasons: string[];
};

export const chunkArray = <T,>(rows: T[], size: number) => {
  const chunkSize = Math.max(1, Math.floor(size || 0));
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
};

export const prepareWorkHourUploadRows = (
  parsedRows: ParsedUploadRow[],
  employeeMap: Record<string, unknown>
): PreparedWorkHourUploadRows => {
  const matchedRowsByKey = new Map<string, ParsedUploadRow[]>();
  const skipReasons: string[] = [];

  for (const row of parsedRows) {
    if (!row.staffId) {
      skipReasons.push(`Row ${row.rowNumber}: user code ${row.sourceUserCode} is invalid.`);
      continue;
    }
    const normalizedStaffId = normalizeStaffId(row.staffId);
    if (!employeeMap[normalizedStaffId]) {
      skipReasons.push(`Row ${row.rowNumber}: ${normalizedStaffId} not found in OBPUNCH employees.`);
      continue;
    }
    const key = `${row.workDate}__${normalizedStaffId}`;
    const bucket = matchedRowsByKey.get(key) ?? [];
    bucket.push({
      ...row,
      staffId: normalizedStaffId
    });
    matchedRowsByKey.set(key, bucket);
  }

  const matchedRows: ParsedUploadRow[] = [];
  const duplicateReasons: string[] = [];

  for (const [key, rows] of matchedRowsByKey.entries()) {
    if (rows.length === 1) {
      matchedRows.push(rows[0]);
      continue;
    }
    const [workDate, staffId] = key.split('__');
    const rowNumbers = rows.map((row) => row.rowNumber).sort((a, b) => a - b);
    duplicateReasons.push(`Duplicate rows for ${workDate} / ${staffId}: rows ${rowNumbers.join(', ')}.`);
  }

  matchedRows.sort((a, b) =>
    a.workDate === b.workDate ? a.staffId.localeCompare(b.staffId, 'en-US') : a.workDate.localeCompare(b.workDate, 'en-US')
  );

  duplicateReasons.sort((a, b) => a.localeCompare(b, 'en-US'));

  return {
    matchedRows,
    skipReasons,
    duplicateReasons
  };
};
