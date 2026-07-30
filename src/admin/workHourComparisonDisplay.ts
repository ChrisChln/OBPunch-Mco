const padDateTimePart = (value: number) => String(value).padStart(2, '0');

export const formatWorkHourPunchDateTime = (value: string): string => {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '-';

  const date = [at.getFullYear(), padDateTimePart(at.getMonth() + 1), padDateTimePart(at.getDate())].join('-');
  const time = [padDateTimePart(at.getHours()), padDateTimePart(at.getMinutes()), padDateTimePart(at.getSeconds())].join(':');
  return `${date} ${time}`;
};
