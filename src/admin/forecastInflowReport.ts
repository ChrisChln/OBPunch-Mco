export const INFLOW_HOUR_KEYS = Array.from(
  { length: 24 },
  (_, hour) => `h${String(hour).padStart(2, '0')}`
) as Array<`h${number}`>;

export type InflowHourKey = (typeof INFLOW_HOUR_KEYS)[number];

export type ImportedVolumeHistoryRow = {
  date: string;
  last_filled_hour: number;
} & Record<InflowHourKey, number>;

export type OutboundReportStats = {
  sourceRows: number;
  importedRows: number;
  dayCount: number;
  totalQuantity: number;
  earliestDate: string;
  latestDate: string;
};

export type OutboundReportResult = {
  rows: ImportedVolumeHistoryRow[];
  stats: OutboundReportStats;
};

export type ReportProgress = {
  processedRows: number;
  totalRows: number;
  percent: number;
};

export class OutboundReportError extends Error {
  constructor(
    message: string,
    readonly rowNumber?: number,
    readonly field?: '创建时间' | '货品数量'
  ) {
    super(message);
    this.name = 'OutboundReportError';
  }
}

type ParsedReportTimestamp = {
  date: string;
  hour: number;
};

type MutableDailyRow = {
  date: string;
  lastFilledHour: number;
  hours: number[];
};

const formatDateOnly = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const parseReportTimestamp = (value: unknown, rowNumber: number): ParsedReportTimestamp => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      date: formatDateOnly(value.getFullYear(), value.getMonth() + 1, value.getDate()),
      hour: value.getHours()
    };
  }

  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) {
    throw new OutboundReportError(`第 ${rowNumber} 行“创建时间”无效`, rowNumber, '创建时间');
  }

  const [, monthText, dayText, yearText, hourText, minuteText, secondText, meridiemText] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = Number(yearText);
  const hour12 = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour12 < 1 || hour12 > 12 || minute > 59 || second > 59) {
    throw new OutboundReportError(`第 ${rowNumber} 行“创建时间”无效`, rowNumber, '创建时间');
  }

  const hour = (hour12 % 12) + (meridiemText.toUpperCase() === 'PM' ? 12 : 0);
  const localDate = new Date(year, month - 1, day, hour, minute, second);
  if (
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== month - 1 ||
    localDate.getDate() !== day ||
    localDate.getHours() !== hour ||
    localDate.getMinutes() !== minute ||
    localDate.getSeconds() !== second
  ) {
    throw new OutboundReportError(`第 ${rowNumber} 行“创建时间”无效`, rowNumber, '创建时间');
  }

  return { date: formatDateOnly(year, month, day), hour };
};

const parseQuantity = (value: unknown, rowNumber: number) => {
  const quantity = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
    throw new OutboundReportError(`第 ${rowNumber} 行“货品数量”无效`, rowNumber, '货品数量');
  }
  return quantity;
};

export function aggregateOutboundRows(
  rows: ReadonlyArray<readonly [unknown, unknown]>,
  firstExcelRowNumber = 1
): OutboundReportResult {
  const dailyRows = new Map<string, MutableDailyRow>();
  let totalQuantity = 0;

  rows.forEach(([createdAtValue, quantityValue], index) => {
    const rowNumber = firstExcelRowNumber + index;
    const createdAt = parseReportTimestamp(createdAtValue, rowNumber);
    const quantity = parseQuantity(quantityValue, rowNumber);
    const daily = dailyRows.get(createdAt.date) ?? {
      date: createdAt.date,
      lastFilledHour: createdAt.hour,
      hours: Array.from({ length: 24 }, () => 0)
    };
    daily.hours[createdAt.hour] += quantity;
    daily.lastFilledHour = Math.max(daily.lastFilledHour, createdAt.hour);
    dailyRows.set(createdAt.date, daily);
    totalQuantity += quantity;
  });

  const importedRows = Array.from(dailyRows.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((daily) => {
      const hourValues = Object.fromEntries(
        INFLOW_HOUR_KEYS.map((hourKey, hour) => [hourKey, daily.hours[hour]])
      ) as Record<InflowHourKey, number>;
      return {
        date: daily.date,
        last_filled_hour: daily.lastFilledHour,
        ...hourValues
      };
    });
  const earliestDate = importedRows[0]?.date ?? '';
  const latestDate = importedRows[importedRows.length - 1]?.date ?? '';

  return {
    rows: importedRows,
    stats: {
      sourceRows: rows.length,
      importedRows: rows.length,
      dayCount: importedRows.length,
      totalQuantity,
      earliestDate,
      latestDate
    }
  };
}

const isBlankCell = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

const findFirstNonEmptySheetRows = (workbook: XLSX.WorkBook): unknown[][] | null => {
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet?.['!ref']) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: null });
    if (rows.some((row) => row.some((cell) => !isBlankCell(cell)))) return rows;
  }
  return null;
};

export function parseOutboundReportWorkbook(
  data: ArrayBuffer | Uint8Array,
  onProgress?: (progress: ReportProgress) => void
): OutboundReportResult {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const tableRows = findFirstNonEmptySheetRows(workbook);
  if (!tableRows) {
    throw new OutboundReportError('文件为空或没有可读取的工作表。');
  }

  let headerRowIndex = -1;
  let createdAtColumnIndex = -1;
  let quantityColumnIndex = -1;
  for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex += 1) {
    const normalizedHeaders = tableRows[rowIndex].map((cell) => String(cell ?? '').trim());
    const createdAtIndex = normalizedHeaders.indexOf('创建时间');
    const quantityIndex = normalizedHeaders.indexOf('货品数量');
    if (createdAtIndex >= 0 && quantityIndex >= 0) {
      headerRowIndex = rowIndex;
      createdAtColumnIndex = createdAtIndex;
      quantityColumnIndex = quantityIndex;
      break;
    }
  }

  if (headerRowIndex < 0) {
    throw new OutboundReportError('缺少必需列：创建时间、货品数量。');
  }

  const sourceRows = tableRows.slice(headerRowIndex + 1).filter((row) => row.some((cell) => !isBlankCell(cell)));
  if (sourceRows.length === 0) {
    throw new OutboundReportError('文件中没有可导入的数据。');
  }

  const importRows: Array<readonly [unknown, unknown]> = [];
  sourceRows.forEach((row, index) => {
    importRows.push([row[createdAtColumnIndex], row[quantityColumnIndex]]);
    const processedRows = index + 1;
    if (processedRows % 5_000 === 0 || processedRows === sourceRows.length) {
      onProgress?.({
        processedRows,
        totalRows: sourceRows.length,
        percent: Math.round((processedRows / sourceRows.length) * 100)
      });
    }
  });

  return aggregateOutboundRows(importRows, headerRowIndex + 2);
}
import * as XLSX from 'xlsx';
