export const normalizeScheduleDriverFilterValue = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const digits = text.match(/\d+/);
  return digits ? digits[0] : '';
};

export const matchesScheduleDriverFilter = (driverCode: unknown, filterValue: unknown) => {
  const normalizedFilter = normalizeScheduleDriverFilterValue(filterValue);
  if (!normalizedFilter) return true;
  return normalizeScheduleDriverFilterValue(driverCode) === normalizedFilter;
};
