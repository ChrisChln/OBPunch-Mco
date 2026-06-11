import { normalizePositionDepartment, type PositionDepartment } from './positions';

export type DashboardAttendanceShift = 'early' | 'late';

export type DashboardAttendanceStatus = 'Absent' | 'Off Worked' | 'Normal' | 'Completed';

export type DashboardAttendanceStat = {
  expected: number;
  present: number;
  onClock: number;
  offWorked: number;
};

export type DashboardAttendanceSummary = Record<string, DashboardAttendanceStat>;

export type DashboardAttendanceRow = {
  staffId: string;
  position: string;
  shift: DashboardAttendanceShift;
  isExpected: boolean;
  hasPunch: boolean;
  isOnClock: boolean;
  attendance?: DashboardAttendanceStatus;
};

export const DASHBOARD_COVERAGE_DEPARTMENTS = ['OB', 'IB', 'INV'] as const;
export type DashboardCoverageDepartment = (typeof DASHBOARD_COVERAGE_DEPARTMENTS)[number];

export type DashboardDepartmentCoverageCard = {
  department: DashboardCoverageDepartment;
  shift: DashboardAttendanceShift;
  expected: number;
  present: number;
};

export const createDashboardAttendanceStat = (): DashboardAttendanceStat => ({
  expected: 0,
  present: 0,
  onClock: 0,
  offWorked: 0
});

export const getDashboardAttendanceStatKey = (shift: DashboardAttendanceShift, position: string) => `${shift}:${position}`;

export const buildDashboardAttendanceStats = (rows: readonly DashboardAttendanceRow[]): DashboardAttendanceSummary => {
  const expectedByKey = new Map<string, Set<string>>();
  const presentByKey = new Map<string, Set<string>>();
  const onClockByKey = new Map<string, Set<string>>();
  const offWorkedByKey = new Map<string, Set<string>>();

  for (const row of rows) {
    const staffId = String(row.staffId ?? '').trim();
    const position = String(row.position ?? '').trim();
    if (!staffId || !position) continue;
    const key = getDashboardAttendanceStatKey(row.shift, position);

    if (row.isExpected) {
      if (!expectedByKey.has(key)) expectedByKey.set(key, new Set());
      expectedByKey.get(key)?.add(staffId);
    }

    if (row.hasPunch) {
      if (!presentByKey.has(key)) presentByKey.set(key, new Set());
      presentByKey.get(key)?.add(staffId);
    }

    if (row.isOnClock) {
      if (!onClockByKey.has(key)) onClockByKey.set(key, new Set());
      onClockByKey.get(key)?.add(staffId);
    }

    if (row.attendance === 'Off Worked' || (!row.isExpected && row.hasPunch)) {
      if (!offWorkedByKey.has(key)) offWorkedByKey.set(key, new Set());
      offWorkedByKey.get(key)?.add(staffId);
    }
  }

  const keys = new Set([
    ...expectedByKey.keys(),
    ...presentByKey.keys(),
    ...onClockByKey.keys(),
    ...offWorkedByKey.keys()
  ]);
  const stats: DashboardAttendanceSummary = {};
  for (const key of keys) {
    stats[key] = {
      expected: expectedByKey.get(key)?.size ?? 0,
      present: presentByKey.get(key)?.size ?? 0,
      onClock: onClockByKey.get(key)?.size ?? 0,
      offWorked: offWorkedByKey.get(key)?.size ?? 0
    };
  }
  return stats;
};

const isDashboardCoverageDepartment = (value: PositionDepartment): value is DashboardCoverageDepartment =>
  DASHBOARD_COVERAGE_DEPARTMENTS.includes(value as DashboardCoverageDepartment);

export const getDashboardDepartmentTonePosition = (department: DashboardCoverageDepartment) => {
  if (department === 'IB') return 'Receive';
  if (department === 'INV') return 'Inventory';
  return 'Pick';
};

export const getDashboardDepartmentLabel = (department: DashboardCoverageDepartment) => department;

export const buildDashboardDepartmentCoverageCards = ({
  positions,
  positionDepartments,
  stats,
  expectedByPosition
}: {
  positions: readonly string[];
  positionDepartments: Readonly<Record<string, unknown>>;
  stats: DashboardAttendanceSummary;
  expectedByPosition?: ReadonlyMap<string, Partial<Record<DashboardAttendanceShift, number>>>;
}): DashboardDepartmentCoverageCard[] => {
  const cards = new Map<string, DashboardDepartmentCoverageCard>();
  for (const shift of ['early', 'late'] as const) {
    for (const department of DASHBOARD_COVERAGE_DEPARTMENTS) {
      cards.set(`${department}:${shift}`, { department, shift, expected: 0, present: 0 });
    }
  }

  for (const position of positions) {
    const department = normalizePositionDepartment(positionDepartments[position]);
    if (!isDashboardCoverageDepartment(department)) continue;

    for (const shift of ['early', 'late'] as const) {
      const stat = stats[getDashboardAttendanceStatKey(shift, position)] ?? createDashboardAttendanceStat();
      const expected = expectedByPosition?.get(position)?.[shift] ?? stat.expected;
      const card = cards.get(`${department}:${shift}`);
      if (!card) continue;
      card.expected += Number(expected || 0);
      card.present += Number(stat.present || 0);
    }
  }

  return Array.from(cards.values());
};
