export type EmployeePunchEligibility = {
  terminatedAt?: unknown;
};

export const getEmployeeTerminatedAt = (employee: EmployeePunchEligibility | null | undefined) => {
  const value = String(employee?.terminatedAt ?? '').trim();
  return value || null;
};

export const isEmployeeTerminated = (employee: EmployeePunchEligibility | null | undefined) =>
  Boolean(getEmployeeTerminatedAt(employee));
