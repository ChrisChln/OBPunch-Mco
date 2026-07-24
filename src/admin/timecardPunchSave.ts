import { normalizeStaffId } from '../lib/staffId';

type PunchAction = 'IN' | 'OUT';

export type StagedPunchEdit = {
  id: number | string;
  action: PunchAction;
  createdAt: string;
};

export type StagedPunchAddition = {
  action: PunchAction;
  createdAt: string;
};

export type TimecardPunchSavePayload = {
  p_staff_id: string;
  p_work_date: string;
  p_edits: Array<{ id: string; action: PunchAction; created_at: string }>;
  p_additions: Array<{ action: PunchAction; created_at: string }>;
  p_delete_ids: string[];
  p_operator: string | null;
};

export type ConfirmedPunchRow = {
  id: string;
  staff_id: string;
  action: PunchAction;
  created_at: string;
};

export type ConfirmedPunchSaveResult = {
  rows: ConfirmedPunchRow[];
  editedCount: number;
  addedCount: number;
  deletedCount: number;
};

type BuildPayloadInput = {
  staffId: string;
  workDate: string;
  edits: StagedPunchEdit[];
  additions: StagedPunchAddition[];
  deleteIds: Array<number | string>;
  operator: string | null | undefined;
};

const WORK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeId = (value: number | string) => {
  const id = String(value ?? '').trim();
  if (!id) throw new Error('Missing punch id.');
  return id;
};

const normalizeAction = (value: unknown): PunchAction => {
  const action = String(value ?? '').trim().toUpperCase();
  if (action !== 'IN' && action !== 'OUT') throw new Error('Invalid punch action.');
  return action;
};

const normalizeTimestamp = (value: unknown) => {
  const raw = String(value ?? '').trim();
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) throw new Error('Invalid punch timestamp.');
  return parsed.toISOString();
};

const parseCount = (value: unknown, label: string) => {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Invalid confirmed ${label} count.`);
  }
  return count;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const canOperateTimecardPunches = (
  moduleCanOperate: boolean,
  position: string,
  canOperatePosition: (position: string) => boolean
) => {
  const normalizedPosition = String(position ?? '').trim();
  return moduleCanOperate && Boolean(normalizedPosition) && canOperatePosition(normalizedPosition);
};

export const buildTimecardPunchSavePayload = ({
  staffId,
  workDate,
  edits,
  additions,
  deleteIds,
  operator
}: BuildPayloadInput): TimecardPunchSavePayload => {
  const normalizedStaffId = normalizeStaffId(staffId);
  if (!normalizedStaffId) throw new Error('Missing staff id.');
  if (!WORK_DATE_PATTERN.test(workDate)) throw new Error('Invalid work date.');

  const normalizedEdits = edits.map((edit) => ({
    id: normalizeId(edit.id),
    action: normalizeAction(edit.action),
    created_at: normalizeTimestamp(edit.createdAt)
  }));
  const normalizedAdditions = additions.map((addition) => ({
    action: normalizeAction(addition.action),
    created_at: normalizeTimestamp(addition.createdAt)
  }));
  const normalizedDeleteIds = deleteIds.map(normalizeId);

  const persistedIds = [...normalizedEdits.map((edit) => edit.id), ...normalizedDeleteIds];
  if (new Set(persistedIds).size !== persistedIds.length) {
    throw new Error('Found duplicate punch id in staged changes.');
  }

  return {
    p_staff_id: normalizedStaffId,
    p_work_date: workDate,
    p_edits: normalizedEdits,
    p_additions: normalizedAdditions,
    p_delete_ids: normalizedDeleteIds,
    p_operator: String(operator ?? '').trim() || null
  };
};

export const parseTimecardPunchSaveResult = (
  value: unknown,
  expectedStaffId: string,
  rangeStart: Date,
  rangeEnd: Date
): ConfirmedPunchSaveResult => {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    throw new Error('Database did not return confirmed punch rows.');
  }

  const expectedStaff = normalizeStaffId(expectedStaffId);
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  if (!expectedStaff || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('Invalid operational day range.');
  }

  const ids = new Set<string>();
  const rows = value.rows.map((rawRow) => {
    if (!isRecord(rawRow)) throw new Error('Database returned an invalid confirmed punch row.');
    const id = normalizeId(String(rawRow.id ?? ''));
    if (ids.has(id)) throw new Error('Database returned a duplicate punch id.');
    ids.add(id);

    const staffId = normalizeStaffId(String(rawRow.staff_id ?? ''));
    if (staffId !== expectedStaff) {
      throw new Error('Database returned a punch for another employee.');
    }

    const action = normalizeAction(rawRow.action);
    const createdAt = normalizeTimestamp(rawRow.created_at);
    const createdAtMs = new Date(createdAt).getTime();
    const exactCutoffOut = action === 'OUT' && createdAtMs === endMs;
    if (createdAtMs < startMs || (createdAtMs >= endMs && !exactCutoffOut)) {
      throw new Error('Database returned a punch outside the operational day.');
    }

    return {
      id,
      staff_id: staffId,
      action,
      created_at: createdAt
    };
  });

  rows.sort((left, right) => {
    const timeDiff = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    return timeDiff || left.id.localeCompare(right.id, 'en-US');
  });

  return {
    rows,
    editedCount: parseCount(value.edited_count, 'edited'),
    addedCount: parseCount(value.added_count, 'added'),
    deletedCount: parseCount(value.deleted_count, 'deleted')
  };
};

export const computeConfirmedOperationalDayHours = (
  rows: ConfirmedPunchRow[],
  rangeStart: Date,
  rangeEnd: Date,
  capAt: Date
) => {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const capMs = Math.max(startMs, Math.min(endMs, capAt.getTime()));
  if (![startMs, endMs, capMs].every(Number.isFinite) || endMs <= startMs) return 0;

  let openInMs: number | null = null;
  let totalMs = 0;
  for (const row of rows) {
    const atMs = new Date(row.created_at).getTime();
    if (!Number.isFinite(atMs)) continue;
    if (row.action === 'IN') {
      openInMs = atMs;
      continue;
    }
    if (openInMs === null || atMs <= openInMs) continue;
    const overlapStart = Math.max(openInMs, startMs);
    const overlapEnd = Math.min(atMs, endMs);
    if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
    openInMs = null;
  }

  if (openInMs !== null && capMs > openInMs) {
    const overlapStart = Math.max(openInMs, startMs);
    if (capMs > overlapStart) totalMs += capMs - overlapStart;
  }

  return totalMs / 3_600_000;
};
