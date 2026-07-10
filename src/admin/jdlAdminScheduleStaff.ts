import type { AdminRole } from '../shared/adminAccess';

type JdlAdminScheduleAccount = {
  user_email: string;
  user_id: string;
  role: AdminRole;
  is_active: boolean;
};

export const buildJdlStaffIdCandidatesForAccount = (email: string, userId: string) => {
  const userToken = String(userId ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
  const emailPrefix = String(email ?? '').split('@')[0] ?? '';
  const base = emailPrefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || `USER${userToken}`;
  return [base, `${base}${userToken}`].filter(Boolean);
};

export const isScheduleVisibleJdlAdminRole = (role: AdminRole) =>
  role === 'level1' || role === 'level2' || role === 'level3';

export const buildHiddenJdlStaffIdsForAccounts = (
  accounts: readonly JdlAdminScheduleAccount[],
  normalizeStaffId: (value: string) => string
) => {
  const hidden = new Set<string>();
  for (const account of accounts) {
    if (account.is_active && isScheduleVisibleJdlAdminRole(account.role)) continue;
    for (const staff of buildJdlStaffIdCandidatesForAccount(account.user_email, account.user_id)) {
      const normalized = normalizeStaffId(staff);
      if (normalized) hidden.add(normalized);
    }
  }
  return hidden;
};
