import { formatClockMinutes, parseClockTextToMinutes } from './lateMarks';
import type { EmploymentType } from './types';

const normalizePositionToken = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');

const normalizePositionKey = (value: unknown) => normalizePositionToken(value).toLowerCase();

const LEGACY_POSITION_ALIASES: Record<string, string> = {
  '兜底组': 'FLEX TEAM',
  '兜底': 'FLEX TEAM',
  'flex team（机动组）': 'FLEX TEAM',
  'flex team': 'FLEX TEAM',
  flexteam: 'FLEX TEAM',
  'wrap-up team': 'FLEX TEAM',
  'wrap up team': 'FLEX TEAM',
  wrapupteam: 'FLEX TEAM',
  fallback: 'FLEX TEAM',
  backup: 'FLEX TEAM'
};

export type UploadPositionRow = {
  staff_id?: string;
  position?: string | null;
};

type RawUploadRow = Record<string, unknown>;

export type EmployeeUploadRow = {
  staff_id: string;
  name?: string;
  agency?: string;
  position?: string;
  employment_type: EmploymentType;
  shift?: '' | 'early' | 'late';
  shift_time?: string;
  label?: string;
  work_account?: string;
  work_password?: string;
};

export type ExistingEmployeeIdentityRow = {
  staff_id?: string | null;
  name?: string | null;
  agency?: string | null;
  Agency?: string | null;
  work_account?: string | null;
};

export type EmployeeImportIdentityConflicts = {
  modifiedStaffIds: string[];
  duplicateWorkAccounts: string[];
};

export type TemporaryEmployeeUploadMatch = {
  incomingStaffId: string;
  temporaryStaffId: string;
};

const EMPLOYEE_KEY_ALIASES: Record<string, keyof EmployeeUploadRow | 'staff_id'> = {
  employee_id: 'staff_id',
  employeeid: 'staff_id',
  uid: 'staff_id',
  staffid: 'staff_id',
  staff_id: 'staff_id',
  '工号': 'staff_id',
  '员工号': 'staff_id',
  name: 'name',
  agency: 'agency',
  'agency ': 'agency',
  position: 'position',
  '岗位': 'position',
  '职位': 'position',
  employment_type: 'employment_type',
  employmenttype: 'employment_type',
  ft_pt: 'employment_type',
  ftpt: 'employment_type',
  full_part_time: 'employment_type',
  fullparttime: 'employment_type',
  shift: 'shift',
  shift_name: 'shift',
  shiftname: 'shift',
  'ft/pt': 'employment_type',
  '全职兼职': 'employment_type',
  '用工类型': 'employment_type',
  label: 'label',
  '标签': 'label',
  work_account: 'work_account',
  workaccount: 'work_account',
  '工作账号': 'work_account',
  '账号': 'work_account',
  work_password: 'work_password',
  workpassword: 'work_password',
  '工作密码': 'work_password',
  '密码': 'work_password',
  shift_time: 'shift_time',
  shifttime: 'shift_time',
  start_time: 'shift_time',
  starttime: 'shift_time',
  '班次时间': 'shift_time',
  '上班时间': 'shift_time',
  '开始时间': 'shift_time'
};

const EMPLOYEE_UPLOAD_KEYS = new Set<keyof EmployeeUploadRow>([
  'staff_id',
  'name',
  'agency',
  'position',
  'employment_type',
  'shift',
  'shift_time',
  'label',
  'work_account',
  'work_password'
]);

const normalizeHeaderKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');

const normalizeEmploymentTypeValue = (value: unknown): EmploymentType => {
  const text = String(value ?? '').trim().toUpperCase();
  return text === 'PT' ? 'PT' : 'FT';
};

const normalizeShiftValue = (value: unknown): '' | 'early' | 'late' => {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'early' || text === 'day' || text === 'morning') return 'early';
  if (text === 'late' || text === 'night' || text === 'evening') return 'late';
  return '';
};

const normalizeShiftTimeValue = (value: unknown) => {
  const parsed = parseClockTextToMinutes(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return '';
  return formatClockMinutes(parsed as number);
};

const buildTemporaryStaffId = (prefix: string, index: number) => {
  if (prefix === 'TUS') return `TUS${String(index + 1).padStart(6, '0')}`;
  return `${prefix}-${String(index + 1).padStart(4, '0')}`;
};

export const isGeneratedEmployeeUploadStaffId = (value: unknown) =>
  /^(?:TUS\d{6,}|TEMP-USID-[A-Z0-9]+-\d{4,})$/i.test(String(value ?? '').trim());

export const detectEmployeeImportIdentityConflicts = (
  rows: EmployeeUploadRow[],
  existingRows: ExistingEmployeeIdentityRow[]
): EmployeeImportIdentityConflicts => {
  const existingByStaff = new Set<string>();
  const existingByAccount = new Map<string, string>();

  for (const row of existingRows) {
    const staff = String(row.staff_id ?? '').trim().toUpperCase();
    if (!staff) continue;
    existingByStaff.add(staff);
    const account = String(row.work_account ?? '').trim().toLowerCase();
    if (account && !existingByAccount.has(account)) existingByAccount.set(account, staff);
  }

  const modifiedStaffIds: string[] = [];
  const duplicateWorkAccounts: string[] = [];
  for (const row of rows) {
    const incomingStaff = String(row.staff_id ?? '').trim().toUpperCase();
    if (!incomingStaff || existingByStaff.has(incomingStaff)) continue;

    const account = String(row.work_account ?? '').trim().toLowerCase();
    const accountOwner = account ? existingByAccount.get(account) ?? '' : '';
    if (accountOwner && accountOwner !== incomingStaff) {
      duplicateWorkAccounts.push(`${incomingStaff} -> ${accountOwner} (work_account)`);
    }
  }

  return { modifiedStaffIds, duplicateWorkAccounts };
};

export const findTemporaryEmployeeUploadMatches = (
  rows: EmployeeUploadRow[],
  existingRows: ExistingEmployeeIdentityRow[]
): TemporaryEmployeeUploadMatch[] => {
  const existingByStaff = new Set<string>();
  const temporaryByNameAgency = new Map<string, string[]>();

  for (const row of existingRows) {
    const staff = String(row.staff_id ?? '').trim().toUpperCase();
    if (!staff) continue;
    existingByStaff.add(staff);
    if (!isGeneratedEmployeeUploadStaffId(staff)) continue;

    const name = String(row.name ?? '').trim().toLowerCase();
    const agency = String(row.agency ?? row.Agency ?? '').trim().toLowerCase();
    if (!name || !agency) continue;

    const key = `${name}__${agency}`;
    const current = temporaryByNameAgency.get(key) ?? [];
    current.push(staff);
    temporaryByNameAgency.set(key, current);
  }

  return rows
    .map((row) => {
      const incomingStaffId = String(row.staff_id ?? '').trim().toUpperCase();
      if (!incomingStaffId || existingByStaff.has(incomingStaffId) || isGeneratedEmployeeUploadStaffId(incomingStaffId)) {
        return null;
      }

      const name = String(row.name ?? '').trim().toLowerCase();
      const agency = String(row.agency ?? '').trim().toLowerCase();
      const candidates = name && agency ? temporaryByNameAgency.get(`${name}__${agency}`) ?? [] : [];
      if (candidates.length !== 1) return null;

      return {
        incomingStaffId,
        temporaryStaffId: candidates[0]
      };
    })
    .filter((match): match is TemporaryEmployeeUploadMatch => Boolean(match));
};

export const normalizeEmployeeUploadPosition = (
  positionRaw: unknown,
  activePositionNames: readonly string[]
) => {
  const token = normalizePositionToken(positionRaw);
  if (!token) return '';

  const activeByKey = new Map(
    activePositionNames
      .map((position) => normalizePositionToken(position))
      .filter(Boolean)
      .map((position) => [normalizePositionKey(position), position] as const)
  );

  const direct = activeByKey.get(normalizePositionKey(token));
  if (direct) return direct;

  const alias = LEGACY_POSITION_ALIASES[normalizePositionKey(token)];
  if (!alias) return '';
  return activeByKey.get(normalizePositionKey(alias)) ?? alias;
};

export const findInvalidEmployeeUploadPositions = (
  rows: UploadPositionRow[],
  activePositionNames: readonly string[]
) =>
  rows
    .map((row) => ({
      staff_id: String(row.staff_id ?? '').trim(),
      position: String(row.position ?? '').trim()
    }))
    .filter(({ position }) => position && !normalizeEmployeeUploadPosition(position, activePositionNames));

export const buildEmployeeUploadRows = (
  parsedRows: RawUploadRow[],
  activePositionNames: readonly string[],
  options?: { temporaryIdPrefix?: string }
) => {
  const uniqueByStaff = new Map<string, EmployeeUploadRow>();
  let duplicateInFileCount = 0;
  let temporaryStaffIdIndex = 0;
  const temporaryIdPrefix = options?.temporaryIdPrefix ?? 'TUS';

  for (const sourceRow of parsedRows) {
    const canonical: Partial<Record<keyof EmployeeUploadRow, string>> = {};
    for (const [rawKey, rawValue] of Object.entries(sourceRow)) {
      if (!rawKey) continue;
      const value = String(rawValue ?? '').trim();
      if (!value) continue;
      const normalized = normalizeHeaderKey(rawKey);
      const mapped = EMPLOYEE_KEY_ALIASES[normalized] ?? normalized;
      if (!EMPLOYEE_UPLOAD_KEYS.has(mapped as keyof EmployeeUploadRow)) continue;
      const key = mapped as keyof EmployeeUploadRow;
      if (!canonical[key]) canonical[key] = value;
    }

    const rawStaff = String(canonical.staff_id ?? '').trim().toUpperCase();
    const staff = rawStaff || buildTemporaryStaffId(temporaryIdPrefix, temporaryStaffIdIndex++);
    if (uniqueByStaff.has(staff)) {
      duplicateInFileCount += 1;
      continue;
    }

    const name = canonical.name?.trim();
    const agency = canonical.agency?.trim();
    const positionRaw = canonical.position?.trim();
    const position = positionRaw ? normalizeEmployeeUploadPosition(positionRaw, activePositionNames) : '';
    const employmentType = normalizeEmploymentTypeValue(canonical.employment_type ?? '');
    const shift = normalizeShiftValue(canonical.shift ?? '');
    const label = canonical.label?.trim();
    const shiftTime = normalizeShiftTimeValue(canonical.shift_time ?? '');
    const workAccount = canonical.work_account?.trim();
    const workPassword = canonical.work_password?.trim();

    const record: EmployeeUploadRow = { staff_id: staff, employment_type: employmentType };
    if (name) record.name = name;
    if (agency) record.agency = agency;
    if (position) record.position = position;
    if (positionRaw && !position) record.position = positionRaw;
    if (shift) record.shift = shift;
    if (shiftTime) record.shift_time = shiftTime;
    if (label) record.label = label;
    if (workAccount) record.work_account = workAccount;
    if (workPassword) record.work_password = workPassword;
    uniqueByStaff.set(staff, record);
  }

  return {
    rows: Array.from(uniqueByStaff.values()),
    duplicateInFileCount
  };
};
