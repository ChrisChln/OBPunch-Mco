export const formatRoundedHours = (value: number) => {
  const rounded = Math.round(Number(value ?? 0) * 100) / 100;
  if (!Number.isFinite(rounded) || rounded <= 0) return '';
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

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
