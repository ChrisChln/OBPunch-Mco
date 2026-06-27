const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const toDateOnly = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

export const getScheduleMistakeDateRange = (operationalDate: string) => {
  const normalizedOperationalDate = String(operationalDate ?? '').trim();
  if (!isDateOnly(normalizedOperationalDate)) {
    return null;
  }

  const endDate = new Date(`${normalizedOperationalDate}T12:00:00`);
  if (Number.isNaN(endDate.getTime())) {
    return null;
  }

  return {
    endDate: normalizedOperationalDate,
    startDate: toDateOnly(addDays(endDate, -6))
  };
};
