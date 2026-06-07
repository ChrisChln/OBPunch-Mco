import type {
  AgencyDriverGroupAssignment,
  AgencyDriverGroupRole,
  AgencyDriverGroupSummary,
  AgencyScheduleState,
  AgencyWeekScheduleRow
} from './types';

export type DriverGroupWarning = {
  code: string;
  labels: string[];
  staffIds: string[];
  message: string;
};

const normalizeCode = (value: unknown) => String(value ?? '').trim();

const normalizeRole = (value: unknown): AgencyDriverGroupRole =>
  String(value ?? '').trim().toLowerCase() === 'driver' ? 'driver' : 'member';

export const normalizeDriverGroupAssignment = ({
  code,
  role
}: {
  code: unknown;
  role: unknown;
}): AgencyDriverGroupAssignment | null => {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;
  const normalizedRole = normalizeRole(role);
  return {
    code: normalizedCode,
    role: normalizedRole,
    label: normalizedRole === 'driver' ? `Driver${normalizedCode}` : normalizedCode
  };
};

export const getNextDriverGroupCode = (groups: Pick<AgencyDriverGroupSummary, 'code' | 'activeMemberCount'>[]): string => {
  const normalizedGroups = groups
    .map((group) => ({
      code: normalizeCode(group.code),
      activeMemberCount: Number(group.activeMemberCount ?? 0) || 0
    }))
    .filter((group) => group.code);

  const inactiveNumericCodes = normalizedGroups
    .filter((group) => group.activeMemberCount <= 0 && /^\d+$/.test(group.code))
    .map((group) => Number(group.code))
    .filter((code) => Number.isInteger(code) && code > 0)
    .sort((a, b) => a - b);
  if (inactiveNumericCodes.length > 0) return String(inactiveNumericCodes[0]);

  const usedNumericCodes = normalizedGroups
    .filter((group) => /^\d+$/.test(group.code))
    .map((group) => Number(group.code))
    .filter((code) => Number.isInteger(code) && code > 0);
  const usedCodeSet = new Set(usedNumericCodes);
  const maxCode = usedNumericCodes.length > 0 ? Math.max(...usedNumericCodes) : 0;
  for (let code = 1; code <= maxCode; code += 1) {
    if (!usedCodeSet.has(code)) return String(code);
  }
  return String(maxCode + 1);
};

const scheduleSignatureForRow = (row: AgencyWeekScheduleRow) =>
  row.days
    .map((day) => `${day.work_date}:${String(day.state ?? 'rest').trim() as AgencyScheduleState}`)
    .join('|');

export const buildDriverGroupWarnings = (rows: AgencyWeekScheduleRow[]): DriverGroupWarning[] => {
  const groups = new Map<string, AgencyWeekScheduleRow[]>();
  for (const row of rows) {
    const code = normalizeCode(row.driver_group_code);
    if (!code) continue;
    const current = groups.get(code) ?? [];
    current.push(row);
    groups.set(code, current);
  }

  const warnings: DriverGroupWarning[] = [];
  for (const [code, groupRows] of groups.entries()) {
    if (groupRows.length < 2) continue;
    const signatures = new Set(groupRows.map(scheduleSignatureForRow));
    if (signatures.size <= 1) continue;
    const labels = Array.from(new Set(groupRows.map((row) => normalizeCode(row.driver_group_label) || code))).sort((a, b) =>
      a.localeCompare(b)
    );
    warnings.push({
      code,
      labels,
      staffIds: groupRows.map((row) => row.staff_id).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      message: `Driver group ${code} has mismatched schedules.`
    });
  }
  return warnings.sort((a, b) => a.code.localeCompare(b.code));
};
