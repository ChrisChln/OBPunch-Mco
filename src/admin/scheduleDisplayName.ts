import { isScheduleOnlyAgency } from '../shared/agencyRules';

type ScheduleNameEmployee = {
  name?: unknown;
  agency?: unknown;
  work_account?: unknown;
  WorkAccount?: unknown;
};

const normalizeEmailKey = (value: unknown) => String(value ?? '').trim().toLowerCase();
const isEmailLike = (value: string) => value.includes('@');

export const getScheduleEmployeeAccountEmail = (employee: ScheduleNameEmployee) => {
  const value = normalizeEmailKey(employee.work_account ?? employee.WorkAccount);
  return value.includes('@') ? value : '';
};

export const getScheduleEmployeeProfileEmail = (employee: ScheduleNameEmployee) => {
  const accountEmail = getScheduleEmployeeAccountEmail(employee);
  if (accountEmail) return accountEmail;

  const nameEmail = normalizeEmailKey(employee.name);
  return nameEmail.includes('@') ? nameEmail : '';
};

export const resolveScheduleEmployeeDisplayName = (
  employee: ScheduleNameEmployee,
  registeredNameByEmail: Record<string, string>
) => {
  const rawName = String(employee.name ?? '').trim();
  const agency = String(employee.agency ?? '').trim();
  if (!isScheduleOnlyAgency(agency)) return rawName;

  const accountEmail = getScheduleEmployeeProfileEmail(employee);
  const registeredName = accountEmail ? String(registeredNameByEmail[accountEmail] ?? '').trim() : '';
  if (registeredName) return registeredName;
  return isEmailLike(rawName) ? '' : rawName;
};
