import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL as string | undefined;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const syncToken = (process.env.GOOGLE_SHEET_SYNC_TOKEN as string | undefined) || (process.env.ADMIN_TOKEN as string | undefined);

const supabase = supabaseUrl && supabaseServiceRoleKey ? createClient(supabaseUrl, supabaseServiceRoleKey) : null;

const EMPLOYEE_TABLE = process.env.EMPLOYEE_TABLE || 'ob_employees';
const LEAVE_REQUEST_TABLE = process.env.LEAVE_REQUEST_TABLE || 'ob_leave_requests';

type EmployeeLite = {
  staffId: string;
  name: string;
};

type ExistingLeaveRow = {
  source: string;
  source_row_key: string;
  status: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

type NormalizedLeaveRow = {
  source: string;
  source_row_key: string;
  submitted_at: string | null;
  submitted_at_raw: string | null;
  employee_name_raw: string;
  employee_staff_id_raw: string | null;
  matched_staff_id: string | null;
  matched_employee_name: string | null;
  matching_method: string | null;
  matching_score: number | null;
  position_raw: string | null;
  leave_date: string;
  leave_type: string;
  schedule_adjusted: boolean;
  reason: string | null;
  raw_payload: Record<string, unknown>;
};

const normalizeStaffId = (value: unknown) => String(value ?? '').trim().toUpperCase();
const isValidStaffId = (value: unknown) => /^US\d{3,12}$/.test(normalizeStaffId(value));

const normalizePersonName = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const compactPersonName = (value: unknown) => normalizePersonName(value).replace(/\s+/g, '');

const scoreNameMatch = (candidate: string, employeeName: string) => {
  const a = normalizePersonName(candidate);
  const b = normalizePersonName(employeeName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const ac = compactPersonName(candidate);
  const bc = compactPersonName(employeeName);
  if (ac && ac === bc) return 96;
  if (ac && bc && (ac.includes(bc) || bc.includes(ac))) return 88;
  const aTokens = a.split(' ').filter((part) => part.length >= 2);
  const bTokens = b.split(' ').filter((part) => part.length >= 2);
  const shared = aTokens.filter((token) => bTokens.includes(token));
  if (shared.length === 0) return 0;
  const coverage = shared.length / Math.max(aTokens.length, bTokens.length);
  return coverage >= 0.75 ? Math.round(coverage * 80 + shared.length * 5) : 0;
};

const parseDateCell = (raw: unknown) => {
  const text = String(raw ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!text) return '';
  const serial = Number(text);
  if (Number.isFinite(serial) && /^\d+(\.\d+)?$/.test(text) && serial > 20000 && serial < 80000) {
    const utcDays = Math.floor(serial - 25569);
    const utcMs = utcDays * 86400 * 1000;
    const date = new Date(utcMs);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
  }
  const normalized = text.replace(/[./]/g, '-');
  const ymd = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${String(Number(ymd[2])).padStart(2, '0')}-${String(Number(ymd[3])).padStart(2, '0')}`;
  const mdy = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${String(Number(mdy[1])).padStart(2, '0')}-${String(Number(mdy[2])).padStart(2, '0')}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
};

const parseSubmittedAtCell = (raw: unknown) => {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const serial = Number(text);
  if (Number.isFinite(serial) && /^\d+(\.\d+)?$/.test(text) && serial > 20000 && serial < 80000) {
    const utcMs = Math.round((serial - 25569) * 86400 * 1000);
    const date = new Date(utcMs);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const parseBooleanCell = (raw: unknown) => {
  const text = String(raw ?? '').trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'y' || text === '1' || text === 'done';
};

const firstNonEmpty = (record: Record<string, unknown>, aliases: string[]) => {
  for (const alias of aliases) {
    for (const [key, value] of Object.entries(record)) {
      if (normalizePersonName(key) === normalizePersonName(alias)) {
        const text = Array.isArray(value) ? value[0] : value;
        if (String(text ?? '').trim()) return text;
      }
    }
  }
  return '';
};

const getSourceRowKey = (record: Record<string, unknown>, index: number) => {
  const explicitKey = String(record.source_row_key ?? record.sourceRowKey ?? '').trim();
  if (explicitKey) return explicitKey;
  const rowNumber = String(record.row_number ?? record.rowNumber ?? '').trim();
  const sheetId = String(record.sheet_id ?? record.sheetId ?? record.spreadsheet_id ?? record.spreadsheetId ?? '').trim();
  const sheetName = String(record.sheet_name ?? record.sheetName ?? '').trim();
  if (sheetId && rowNumber) return `${sheetId}:${sheetName || 'sheet'}:${rowNumber}`;
  const timestamp = String(firstNonEmpty(record, ['时间戳记', 'Timestamp', 'submitted_at']) ?? '').trim();
  const name = String(firstNonEmpty(record, ['Name/ Nombre', 'Name', 'Nombre', 'employee_name']) ?? '').trim();
  const leaveDate = String(firstNonEmpty(record, ['Off Date / Fecha del', 'Off Date', 'Leave Date']) ?? '').trim();
  return `fallback:${timestamp}:${name}:${leaveDate}:${index}`;
};

const resolveEmployeeMatch = (employees: EmployeeLite[], employeeNameRaw: string, employeeStaffIdRaw: string) => {
  const normalizedId = normalizeStaffId(employeeStaffIdRaw);
  let best: { employee: EmployeeLite; method: string; score: number } | null = null;
  for (const employee of employees) {
    const score = scoreNameMatch(employeeNameRaw, employee.name);
    if (score < 88) continue;
    const method = score >= 100 ? 'name_exact' : score >= 96 ? 'name_compact' : 'name_token';
    if (!best || score > best.score) best = { employee, method, score };
  }
  if (best) {
    return {
      matched_staff_id: best.employee.staffId,
      matched_employee_name: best.employee.name,
      matching_method: best.method,
      matching_score: best.score
    };
  }
  if (isValidStaffId(normalizedId)) {
    const exactById = employees.find((employee) => employee.staffId === normalizedId);
    if (exactById) {
      return {
        matched_staff_id: exactById.staffId,
        matched_employee_name: exactById.name,
        matching_method: 'id_exact',
        matching_score: 100
      };
    }
  }
  return {
    matched_staff_id: null,
    matched_employee_name: null,
    matching_method: 'unmatched',
    matching_score: null
  };
};

const normalizeIncomingRow = (record: Record<string, unknown>, employees: EmployeeLite[], index: number): NormalizedLeaveRow | null => {
  const employeeNameRaw = String(firstNonEmpty(record, ['Name/ Nombre', 'Name', 'Nombre', 'employee_name']) ?? '').trim();
  const employeeStaffIdRaw = String(
    firstNonEmpty(record, ['Employee ID / ID del', 'Employee ID /ID del empleado', 'Employee ID', 'ID del empleado', 'staff_id', 'employee_staff_id']) ?? ''
  ).trim();
  const positionRaw = String(firstNonEmpty(record, ['Position', '岗位']) ?? '').trim();
  const leaveDate = parseDateCell(firstNonEmpty(record, ['Off Date / Fecha del', 'Off Date/ Fecha del permiso', 'Off Date', 'Leave Date', 'Fecha del permiso', 'off_date']));
  const leaveType = String(firstNonEmpty(record, ['Type of Leave/Tipo de permiso', 'Type of Leave / Tipo de permiso', 'Type of Leave', 'Leave Type', 'leave_type']) ?? '').trim();
  if (!employeeNameRaw || !leaveDate || !leaveType) return null;
  const submittedAtRaw = String(firstNonEmpty(record, ['时间戳记', 'Timestamp', 'submitted_at']) ?? '').trim();
  const submittedAt = parseSubmittedAtCell(submittedAtRaw);
  const scheduleAdjusted = parseBooleanCell(firstNonEmpty(record, ['是否完成排班调整', 'Schedule Adjusted', 'schedule_adjusted']));
  const reason = String(firstNonEmpty(record, ['Reason', '备注', '请假原因']) ?? '').trim() || null;
  const match = resolveEmployeeMatch(employees, employeeNameRaw, employeeStaffIdRaw);
  return {
    source: String(record.source ?? 'google_form').trim() || 'google_form',
    source_row_key: getSourceRowKey(record, index),
    submitted_at: submittedAt,
    submitted_at_raw: submittedAtRaw || null,
    employee_name_raw: employeeNameRaw,
    employee_staff_id_raw: employeeStaffIdRaw || null,
    matched_staff_id: match.matched_staff_id,
    matched_employee_name: match.matched_employee_name,
    matching_method: match.matching_method,
    matching_score: match.matching_score,
    position_raw: positionRaw || null,
    leave_date: leaveDate,
    leave_type: leaveType,
    schedule_adjusted: scheduleAdjusted,
    reason,
    raw_payload: record
  };
};

const chunk = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const loadEmployees = async () => {
  if (!supabase) return [] as EmployeeLite[];
  const { data, error } = await supabase.from(EMPLOYEE_TABLE).select('staff_id,name').limit(20000);
  if (error) throw new Error(error.message || 'Failed to load employees.');
  return ((data ?? []) as any[])
    .map((row) => ({
      staffId: normalizeStaffId(row.staff_id),
      name: String(row.name ?? '').trim()
    }))
    .filter((row) => row.staffId);
};

const loadExistingRows = async (source: string, sourceRowKeys: string[]) => {
  if (!supabase || sourceRowKeys.length === 0) return new Map<string, ExistingLeaveRow>();
  const found = new Map<string, ExistingLeaveRow>();
  for (const keys of chunk(sourceRowKeys, 200)) {
    const { data, error } = await supabase
      .from(LEAVE_REQUEST_TABLE)
      .select('source,source_row_key,status,reviewed_by,reviewed_at,review_note')
      .eq('source', source)
      .in('source_row_key', keys);
    if (error) throw new Error(error.message || 'Failed to load existing leave requests.');
    for (const row of ((data ?? []) as ExistingLeaveRow[])) found.set(row.source_row_key, row);
  }
  return found;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = (req.headers?.authorization as string | undefined) ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!syncToken || token !== syncToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!supabase) {
    res.status(500).json({ error: 'Missing Supabase server configuration' });
    return;
  }

  let body: any;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const incomingRows = Array.isArray(body?.rows) ? body.rows : body?.row ? [body.row] : Array.isArray(body) ? body : [];
  if (!Array.isArray(incomingRows) || incomingRows.length === 0) {
    res.status(400).json({ error: 'Missing rows payload' });
    return;
  }

  try {
    const employees = await loadEmployees();
    const normalizedRows = incomingRows
      .map((row, index) => normalizeIncomingRow(typeof row === 'object' && row ? row : {}, employees, index))
      .filter((row): row is NormalizedLeaveRow => Boolean(row));

    if (normalizedRows.length === 0) {
      res.status(400).json({ error: 'No valid leave rows were found in payload' });
      return;
    }

    const source = normalizedRows[0]?.source || 'google_form';
    const existingByKey = await loadExistingRows(
      source,
      normalizedRows.map((row) => row.source_row_key)
    );
    const nowIso = new Date().toISOString();

    const upsertPayload = normalizedRows.map((row) => {
      const existing = existingByKey.get(row.source_row_key);
      return {
        ...row,
        status: existing?.status || 'pending',
        reviewed_by: existing?.reviewed_by || null,
        reviewed_at: existing?.reviewed_at || null,
        review_note: existing?.review_note || null,
        updated_at: nowIso
      };
    });

    const { error } = await supabase.from(LEAVE_REQUEST_TABLE).upsert(upsertPayload as any[], { onConflict: 'source,source_row_key' });
    if (error) {
      res.status(500).json({ error: error.message || 'Failed to sync leave requests' });
      return;
    }

    res.status(200).json({
      status: 'ok',
      received: incomingRows.length,
      synced: normalizedRows.length,
      matched: normalizedRows.filter((row) => row.matched_staff_id).length,
      unmatched: normalizedRows.filter((row) => !row.matched_staff_id).length
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
}
