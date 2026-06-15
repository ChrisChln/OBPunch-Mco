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

export const buildWorkHourPositionList = <T extends { position?: string }>(
  employeeMap: Record<string, T>,
  configuredPositions: readonly string[] = [],
  positionDepartments: Record<string, string | undefined> = {},
  hiddenDepartment = 'hidden'
) => {
  const hidden = String(hiddenDepartment ?? '').trim().toLowerCase();
  const byLowerName = new Map<string, string>();
  const addPosition = (value: unknown, options: { configured: boolean }) => {
    const position = String(value ?? '').trim();
    if (!position) return;
    const lowerPosition = position.toLowerCase();
    const department = String(positionDepartments[position] ?? positionDepartments[lowerPosition] ?? '').trim().toLowerCase();
    if (department === hidden) return;
    if (!byLowerName.has(lowerPosition) || options.configured) byLowerName.set(lowerPosition, position);
  };

  configuredPositions.forEach((position) => addPosition(position, { configured: true }));

  const extraPositions = new Set<string>();
  Object.values(employeeMap).forEach((employee) => {
    const position = String(employee?.position ?? '').trim();
    if (!position || byLowerName.has(position.toLowerCase())) return;
    extraPositions.add(position);
  });
  Array.from(extraPositions)
    .sort((a, b) => a.localeCompare(b, 'en-US'))
    .forEach((position) => addPosition(position, { configured: false }));

  return Array.from(byLowerName.values());
};
