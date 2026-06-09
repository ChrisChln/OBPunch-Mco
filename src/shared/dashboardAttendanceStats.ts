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
      if (row.hasPunch) {
        if (!presentByKey.has(key)) presentByKey.set(key, new Set());
        presentByKey.get(key)?.add(staffId);
      }
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
