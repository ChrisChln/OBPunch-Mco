export const formatRoundedHours = (value: number) => {
  const rounded = Math.round(Number(value ?? 0) * 100) / 100;
  if (!Number.isFinite(rounded) || rounded <= 0) return '';
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

const toLocalDateKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

export const getTimecardCellHoursText = (options: {
  hours: number;
  punchCount: number;
  inProgress: boolean;
}) => {
  const hoursText = formatRoundedHours(options.hours);
  if (hoursText) return hoursText;
  if (Number(options.punchCount ?? 0) > 0 || options.inProgress) return '0';
  return '';
};

export const getTimecardExportDayCellText = (options: {
  hours: number;
  punchCount: number;
  inProgress: boolean;
  absent: boolean;
}) => {
  const hoursText = getTimecardCellHoursText({
    hours: options.hours,
    punchCount: options.punchCount,
    inProgress: options.inProgress
  });
  if (hoursText) return hoursText;
  return options.absent ? '缺勤' : '';
};

export const buildTimecardExportDailyPeopleRow = (options: {
  columnCount: number;
  dayColumnStartIndex: number;
  dailyCounts: number[];
}) => {
  const normalizedColumnCount = Math.floor(Number(options.columnCount));
  const normalizedDayColumnStartIndex = Math.floor(Number(options.dayColumnStartIndex));
  const safeColumnCount = Number.isFinite(normalizedColumnCount) ? Math.max(2, normalizedColumnCount) : 2;
  const safeDayColumnStartIndex = Number.isFinite(normalizedDayColumnStartIndex)
    ? Math.min(Math.max(1, normalizedDayColumnStartIndex), safeColumnCount - 1)
    : 1;
  const row = Array.from({ length: safeColumnCount }, () => '');
  row[0] = '总计人数';
  options.dailyCounts.slice(0, 7).forEach((count, dayIndex) => {
    const columnIndex = safeDayColumnStartIndex + dayIndex;
    if (columnIndex >= safeColumnCount) return;
    const normalizedCount = Math.floor(Number(count));
    const safeCount = Number.isFinite(normalizedCount) ? Math.max(0, normalizedCount) : 0;
    row[columnIndex] = String(safeCount);
  });
  return row;
};

export const getTimecardTotalHoursText = (options: {
  totalHours: number;
  punchCounts: number[];
  inProgressWeek: boolean;
}) => {
  const hoursText = formatRoundedHours(options.totalHours);
  if (hoursText) return hoursText;
  const weeklyPunchCount = Array.isArray(options.punchCounts)
    ? options.punchCounts.reduce((sum, value) => sum + Number(value ?? 0), 0)
    : 0;
  if (weeklyPunchCount > 0 || options.inProgressWeek) return '0';
  return '';
};

export const getTimecardTerminatedByDay = (options: {
  terminatedAt?: string | null;
  weekDateKeys: string[];
}) => {
  const terminatedRaw = String(options.terminatedAt ?? '').trim();
  if (!terminatedRaw) return options.weekDateKeys.map(() => false);
  const terminatedAt = new Date(terminatedRaw);
  if (Number.isNaN(terminatedAt.getTime())) return options.weekDateKeys.map(() => false);
  const terminatedDateKey = toLocalDateKey(terminatedAt);
  return options.weekDateKeys.map((dateKey) => Boolean(dateKey && dateKey >= terminatedDateKey));
};
