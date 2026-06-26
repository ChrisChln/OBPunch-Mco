export type AttendancePunchRow = {
  staff_id?: string | null;
  action?: string | null;
  created_at?: string | null;
};

export type AttendancePunchSummary = {
  latestByStaff: Map<string, { action: 'IN' | 'OUT'; at: string }>;
  firstInByStaff: Map<string, { at: string }>;
};

const normalizePunchAction = (value: string | null | undefined): 'IN' | 'OUT' =>
  String(value ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';

export const summarizeAttendancePunchRows = (
  rows: readonly AttendancePunchRow[],
  normalizeStaffId: (value: string) => string
): AttendancePunchSummary => {
  const latestByStaff = new Map<string, { action: 'IN' | 'OUT'; at: string }>();
  const firstInByStaff = new Map<string, { at: string }>();

  for (const row of rows) {
    const staff = normalizeStaffId(String(row.staff_id ?? '').trim());
    const at = String(row.created_at ?? '').trim();
    if (!staff || !at) continue;
    const atMs = Date.parse(at);
    if (!Number.isFinite(atMs)) continue;
    const action = normalizePunchAction(row.action);

    const currentLatest = latestByStaff.get(staff);
    if (!currentLatest || atMs > Date.parse(currentLatest.at)) {
      latestByStaff.set(staff, { action, at });
    }

    if (action !== 'IN') continue;
    const currentFirstIn = firstInByStaff.get(staff);
    if (!currentFirstIn || atMs < Date.parse(currentFirstIn.at)) {
      firstInByStaff.set(staff, { at });
    }
  }

  return { latestByStaff, firstInByStaff };
};
