import type { AgencyDepartedEmployeeRow } from './types';

const normalizeText = (value: unknown) => String(value ?? '').trim();
const normalizeAgencyKey = (value: unknown) => normalizeText(value).replace(/\s+/g, ' ').toLowerCase();

export const filterAgencyDepartedEmployees = (
  rows: AgencyDepartedEmployeeRow[],
  managedAgencies: string[]
) => {
  const allowedAgencies = new Set(managedAgencies.map((agency) => normalizeAgencyKey(agency)).filter(Boolean));

  return rows
    .filter((row) => {
      const terminatedAt = normalizeText(row.terminated_at);
      if (!terminatedAt) return false;
      if (allowedAgencies.size === 0) return true;
      return allowedAgencies.has(normalizeAgencyKey(row.agency));
    })
    .sort((left, right) => normalizeText(right.terminated_at).localeCompare(normalizeText(left.terminated_at)));
};
