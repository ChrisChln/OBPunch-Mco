type EmployeePositionLike = {
  staff_id?: string | null;
  position?: string | null;
  Position?: string | null;
};

export const buildEmployeePositionRankMap = (positionNames: readonly string[]) => {
  const rankMap = new Map<string, number>();
  positionNames.forEach((position, index) => {
    const key = String(position ?? '').trim().toLowerCase();
    if (!key || rankMap.has(key)) return;
    rankMap.set(key, index);
  });
  return rankMap;
};

export const sortEmployeesByPositionOrder = <T extends EmployeePositionLike>(
  employees: readonly T[],
  positionNames: readonly string[],
  normalizeStaffId: (value: string) => string
) => {
  const rankMap = buildEmployeePositionRankMap(positionNames);
  return [...employees].sort((a, b) => {
    const positionA = String(a.position ?? a.Position ?? '').trim();
    const positionB = String(b.position ?? b.Position ?? '').trim();
    const keyA = positionA.toLowerCase();
    const keyB = positionB.toLowerCase();
    const rankA = rankMap.get(keyA) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rankMap.get(keyB) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    const positionCompare = positionA.localeCompare(positionB, 'en-US', { sensitivity: 'base' });
    if (positionCompare !== 0) return positionCompare;
    const staffA = normalizeStaffId(String(a.staff_id ?? '').trim());
    const staffB = normalizeStaffId(String(b.staff_id ?? '').trim());
    return staffA.localeCompare(staffB, 'en-US');
  });
};
