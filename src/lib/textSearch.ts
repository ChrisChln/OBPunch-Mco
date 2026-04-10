export const normalizeLooseSearchText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export const compactLooseSearchText = (value: unknown) => normalizeLooseSearchText(value).replace(/\s+/g, '');

export const matchesLooseSearch = (haystack: unknown, needle: unknown) => {
  const normalizedNeedle = normalizeLooseSearchText(needle);
  if (!normalizedNeedle) return true;

  const normalizedHaystack = normalizeLooseSearchText(haystack);
  if (normalizedHaystack.includes(normalizedNeedle)) return true;

  const compactNeedle = compactLooseSearchText(needle);
  if (!compactNeedle) return true;

  return compactLooseSearchText(haystack).includes(compactNeedle);
};
