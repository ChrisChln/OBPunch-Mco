import type { AgencyDepartedEmployeeRow } from './types';

const normalizeText = (value: unknown) => String(value ?? '').trim();

export const filterAgencyDepartedEmployees = (
  rows: AgencyDepartedEmployeeRow[],
  managedAgencies: string[]
) => {
  const allowedAgencies = new Set(managedAgencies.map((agency) => normalizeText(agency)).filter(Boolean));

  return rows
    .filter((row) => {
      const terminatedAt = normalizeText(row.terminated_at);
      if (!terminatedAt) return false;
      if (allowedAgencies.size === 0) return true;
      return allowedAgencies.has(normalizeText(row.agency));
    })
    .sort((left, right) => normalizeText(right.terminated_at).localeCompare(normalizeText(left.terminated_at)));
};
