const MAX_PAYRATE = 9999.99;

export const normalizeAgencyPayrateInput = (value: unknown): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const compact = raw.replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(compact)) return '';
  const amount = Number(compact);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_PAYRATE) return '';
  return amount.toFixed(2);
};

export const formatAgencyPayrate = (value: unknown): string => {
  const normalized = normalizeAgencyPayrateInput(value);
  return normalized || '-';
};
