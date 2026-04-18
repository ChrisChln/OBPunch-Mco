export type AdminUserIdentityView = {
  displayName: string;
  avatarUrl: string;
  fallbackInitial: string;
};

export type AdminUserIdentityInput = {
  userId?: string | null;
  userEmail?: string | null;
  actor?: unknown;
  displayName?: string | null;
  avatarUrl?: string | null;
};

const normalizeText = (value: unknown) => String(value ?? '').trim();

const getFallbackSource = (input: AdminUserIdentityInput) =>
  normalizeText(input.displayName) ||
  normalizeText(input.userEmail) ||
  normalizeText(input.actor) ||
  normalizeText(input.userId);

export const getAdminUserFallbackInitial = (input: AdminUserIdentityInput) => {
  const source = getFallbackSource(input);
  if (!source) return '?';
  const [firstToken = ''] = source.split(/[\s@._-]+/).filter(Boolean);
  const initial = firstToken.slice(0, 1).toUpperCase();
  return initial || '?';
};

export const buildAdminUserIdentityView = (input: AdminUserIdentityInput): AdminUserIdentityView => {
  const displayName =
    normalizeText(input.displayName) ||
    normalizeText(input.userEmail) ||
    normalizeText(input.actor) ||
    normalizeText(input.userId);

  return {
    displayName: displayName || '?',
    avatarUrl: normalizeText(input.avatarUrl),
    fallbackInitial: getAdminUserFallbackInitial(input)
  };
};
