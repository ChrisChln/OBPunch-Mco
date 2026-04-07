export const getTrackedStaffIds = <T extends { staffId?: string; position?: string }>(
  employeeMap: Record<string, T>,
  trackedPositions: readonly string[]
) => {
  const trackedSet = new Set(trackedPositions.map((value) => String(value ?? '').trim()));
  const result = new Set<string>();

  for (const employee of Object.values(employeeMap)) {
    const staffId = String(employee?.staffId ?? '').trim();
    const position = String(employee?.position ?? '').trim();
    if (!staffId || !trackedSet.has(position)) continue;
    result.add(staffId);
  }

  return Array.from(result).sort((a, b) => a.localeCompare(b, 'en-US'));
};
