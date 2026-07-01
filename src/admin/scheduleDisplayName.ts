import { isScheduleOnlyAgency } from '../shared/agencyRules';

type ScheduleNameEmployee = {
  name?: unknown;
  agency?: unknown;
  Agency?: unknown;
  work_account?: unknown;
  WorkAccount?: unknown;
};

const normalizeEmailKey = (value: unknown) => String(value ?? '').trim().toLowerCase();

export const getScheduleEmployeeAccountEmail = (employee: ScheduleNameEmployee) => {
  const value = normalizeEmailKey(employee.work_account ?? employee.WorkAccount);
  return value.includes('@') ? value : '';
};

export const resolveScheduleEmployeeDisplayName = (
  employee: ScheduleNameEmployee,
  registeredNameByEmail: Record<string, string>
) => {
  const rawName = String(employee.name ?? '').trim();
  const agency = String(employee.agency ?? employee.Agency ?? '').trim();
  if (!isScheduleOnlyAgency(agency)) return rawName;

  const accountEmail = getScheduleEmployeeAccountEmail(employee);
  const registeredName = accountEmail ? String(registeredNameByEmail[accountEmail] ?? '').trim() : '';
  return registeredName || rawName;
};
