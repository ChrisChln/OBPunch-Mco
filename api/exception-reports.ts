import { createClient } from '@supabase/supabase-js';
import {
  buildExceptionInsertPayload,
  buildExceptionUpdatePayload,
  isValidExceptionTransition,
  needsInventoryAdjustment,
  normalizeExceptionStatus,
  validateExceptionReportInput,
  type ExceptionReportInput
} from '../src/shared/exceptionReports.js';
import { getModuleMapFromContext, hasModuleAccess, normalizeAdminAccessContext } from '../src/shared/adminAccess.js';

const isProduction = process.env.NODE_ENV === 'production';
const supabaseUrl =
  (process.env.SUPABASE_URL as string | undefined) ??
  (!isProduction ? ((process.env.VITE_SUPABASE_URL as string | undefined) ?? undefined) : undefined);
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const supabaseAnonKey =
  (process.env.SUPABASE_ANON_KEY as string | undefined) ??
  (process.env.VITE_SUPABASE_ANON_KEY as string | undefined);
const normalizeConfiguredPin = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text || undefined;
};
const exceptionLeadPin = normalizeConfiguredPin(process.env.EXCEPTION_LEAD_PIN) ?? (!isProduction ? '6666' : undefined);

const EXCEPTION_TABLE = 'ob_exception_reports';
const MISTAKE_REPORT_TABLE = (process.env.VITE_MISTAKE_REPORT_TABLE as string | undefined) ?? 'ob_mistake_reports';
const EMPLOYEE_TABLE = (process.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const REPORT_NUMBER_SEQUENCE_WIDTH = 4;

const createServiceSupabase = () =>
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      })
    : null;

const createUserSupabase = (token: string) =>
  supabaseUrl && supabaseAnonKey && token
    ? createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      })
    : null;

const applyDevCorsHeaders = (req: any, res: any) => {
  const origin = String(req.headers?.origin ?? '');
  if (!/^https?:\/\/localhost(?::\d+)?$/i.test(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Exception-Lead-Pin');
};

const parseJsonBody = <T>(req: any, res: any): T | null => {
  try {
    return (typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(String(req.body || '{}'))) as T;
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return null;
  }
};

const getHeaderValue = (req: any, name: string) => {
  const headers = (req.headers ?? {}) as Record<string, unknown>;
  const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (direct !== undefined) return direct;
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? headers[match] : '';
};

const getBearerToken = (req: any) => {
  const authHeader = String(getHeaderValue(req, 'authorization') ?? '');
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
};

const hasLeadPin = (req: any, body?: Record<string, unknown> | null) => {
  const pin =
    String(body?.lead_pin ?? '').trim() ||
    String(getHeaderValue(req, 'x-exception-lead-pin') ?? '').trim() ||
    String(req.query?.lead_pin ?? '').trim();
  return Boolean(exceptionLeadPin) && pin === exceptionLeadPin;
};

const ensureLeadPinConfigured = (res: any) => {
  if (exceptionLeadPin) return true;
  res.status(500).json({ error: 'Exception Lead PIN is not configured.' });
  return false;
};

const parseIsoDateParam = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const reportDateKey = (value: unknown) => String(value ?? '').trim().replace(/-/g, '');

const buildExceptionReportNumber = (reportDate: string, sequence: number) =>
  `${reportDateKey(reportDate)}${String(sequence).padStart(REPORT_NUMBER_SEQUENCE_WIDTH, '0')}`;

const parseExceptionReportSequence = (reportNumber: unknown, reportDate: string) => {
  const prefix = reportDateKey(reportDate);
  const text = String(reportNumber ?? '').trim();
  if (!text.startsWith(prefix)) return 0;
  const sequence = Number(text.slice(prefix.length));
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
};

const getNextExceptionReportNumber = async (supabase: any, reportDate: string) => {
  const prefix = reportDateKey(reportDate);
  const result = await supabase
    .from(EXCEPTION_TABLE)
    .select('report_number')
    .gte('report_number', `${prefix}${'0'.repeat(REPORT_NUMBER_SEQUENCE_WIDTH)}`)
    .lt('report_number', `${prefix}:`)
    .order('report_number', { ascending: false })
    .limit(1);

  if (result.error) throw new Error(result.error.message);
  const lastSequence = parseExceptionReportSequence(result.data?.[0]?.report_number, reportDate);
  return buildExceptionReportNumber(reportDate, lastSequence + 1);
};

const isUniqueConstraintError = (error: any) =>
  String(error?.code ?? '') === '23505' || /duplicate key|unique/i.test(String(error?.message ?? ''));

const isMissingItemRowsColumnError = (error: any) =>
  String(error?.code ?? '') === 'PGRST204' &&
  /item_rows/i.test(String(error?.message ?? error?.details ?? ''));

const withoutItemRows = <T extends Record<string, unknown>>(payload: T) => {
  const { item_rows: _itemRows, ...fallbackPayload } = payload;
  return fallbackPayload;
};

const insertExceptionReport = async (supabase: any, payload: Record<string, unknown>) => {
  const result = await supabase.from(EXCEPTION_TABLE).insert([payload]).select('*').single();
  if (!isMissingItemRowsColumnError(result.error)) return result;
  return supabase.from(EXCEPTION_TABLE).insert([withoutItemRows(payload)]).select('*').single();
};

const updateExceptionReport = async (supabase: any, id: string, payload: Record<string, unknown>) => {
  const result = await supabase.from(EXCEPTION_TABLE).update(payload).eq('id', id).select('*').single();
  if (!isMissingItemRowsColumnError(result.error)) return result;
  return supabase.from(EXCEPTION_TABLE).update(withoutItemRows(payload)).eq('id', id).select('*').single();
};

const ensureAdminAccess = async (req: any, res: any, serviceSupabase: any, required: 'view' | 'operate' = 'operate') => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const userRes = await serviceSupabase.auth.getUser(token);
  if (userRes.error || !userRes.data?.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const userSupabase = createUserSupabase(token);
  if (!userSupabase) {
    res.status(500).json({ error: 'Missing Supabase client configuration' });
    return null;
  }

  const accessRes = await userSupabase.rpc('get_admin_access_context');
  if (accessRes.error) {
    res.status(403).json({ error: 'Failed to verify exception permission.' });
    return null;
  }

  const accessContext = normalizeAdminAccessContext(accessRes.data, userRes.data.user.email ?? null);
  const moduleMap = getModuleMapFromContext(accessContext);
  if (!hasModuleAccess(moduleMap, 'exceptions', required)) {
    res.status(403).json({ error: `Exceptions ${required} permission is required.` });
    return null;
  }

  return userRes.data.user;
};

const handleGet = async (req: any, res: any, supabase: any) => {
  if (String(req.query?.present ?? '') === '1') {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    const punchRes = await supabase
      .from('ob_punches')
      .select('staff_id')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .limit(5000);
    if (punchRes.error) {
      res.status(500).json({ error: punchRes.error.message });
      return;
    }

    const staffIds = Array.from(
      new Set(((punchRes.data ?? []) as Array<{ staff_id?: string | null }>).map((row) => String(row.staff_id ?? '').trim().toUpperCase()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right, 'en-US', { numeric: true }));

    if (staffIds.length === 0) {
      res.status(200).json({ rows: [] });
      return;
    }

    const employeeRes = await supabase
      .from(EMPLOYEE_TABLE)
      .select('staff_id, name, position, agency')
      .in('staff_id', staffIds)
      .limit(5000);
    if (employeeRes.error) {
      res.status(500).json({ error: employeeRes.error.message });
      return;
    }

    const employeeByStaff = new Map(
      ((employeeRes.data ?? []) as Array<{ staff_id?: string | null; name?: string | null; position?: string | null; agency?: string | null }>).map((row) => [
        String(row.staff_id ?? '').trim().toUpperCase(),
        row
      ])
    );
    const rows = staffIds.map((staffId) => {
      const employee = employeeByStaff.get(staffId);
      return {
        staff_id: staffId,
        name: String(employee?.name ?? '').trim(),
        position: String(employee?.position ?? '').trim(),
        agency: String(employee?.agency ?? '').trim()
      };
    });
    res.status(200).json({ rows });
    return;
  }

  const token = getBearerToken(req);
  if (!token && !ensureLeadPinConfigured(res)) return;
  if (!token && !hasLeadPin(req)) {
    res.status(401).json({ error: 'Lead PIN or admin authorization is required.' });
    return;
  }
  if (token) {
    const user = await ensureAdminAccess(req, res, supabase, 'view');
    if (!user) return;
  }

  const id = String(req.query?.id ?? '').trim();
  const reportDate = String(req.query?.date ?? '').trim();
  const createdStart = parseIsoDateParam(req.query?.created_start);
  const createdEnd = parseIsoDateParam(req.query?.created_end);
  const status = normalizeExceptionStatus(req.query?.status);

  if (createdStart === null || createdEnd === null) {
    res.status(400).json({ error: 'Invalid created date range.' });
    return;
  }

  let query = supabase.from(EXCEPTION_TABLE).select('*').order('created_at', { ascending: false }).limit(200);
  if (id) query = /^\d{12}$/.test(id) ? query.eq('report_number', id).limit(1) : query.eq('id', id).limit(1);
  if (reportDate) query = query.eq('report_date', reportDate);
  if (createdStart) query = query.gte('created_at', createdStart);
  if (createdEnd) query = query.lt('created_at', createdEnd);
  if (status) query = query.eq('status', status);

  const result = await query;
  if (result.error) {
    res.status(500).json({ error: result.error.message });
    return;
  }
  res.status(200).json({ rows: result.data ?? [] });
};

const handlePost = async (req: any, res: any, supabase: any) => {
  const body = parseJsonBody<ExceptionReportInput>(req, res);
  if (!body) return;
  if (!ensureLeadPinConfigured(res)) return;
  if (!hasLeadPin(req, body as Record<string, unknown>)) {
    res.status(401).json({ error: 'Invalid Lead PIN.' });
    return;
  }

  const errors = validateExceptionReportInput(body);
  const payload = buildExceptionInsertPayload(body);
  if (errors.length || !payload) {
    res.status(400).json({ error: errors[0] ?? 'Invalid exception report.' });
    return;
  }

  let lastError: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reportNumber = await getNextExceptionReportNumber(supabase, payload.report_date);
    const result = await insertExceptionReport(supabase, { ...payload, report_number: reportNumber, status: 'Open' });
    if (!result.error) {
      res.status(200).json({ row: result.data });
      return;
    }
    lastError = result.error;
    if (!isUniqueConstraintError(result.error)) break;
  }
  res.status(500).json({ error: lastError?.message ?? 'Failed to create exception report.' });
};

const handleLeadPatch = async (req: any, res: any, supabase: any, body: any) => {
  if (!ensureLeadPinConfigured(res)) return;
  if (!hasLeadPin(req, body)) {
    res.status(401).json({ error: 'Invalid Lead PIN.' });
    return;
  }

  const id = String(body.id ?? '').trim();
  const nextStatus = normalizeExceptionStatus(body.status);
  if (!id || !nextStatus) {
    res.status(400).json({ error: 'A valid id and status are required.' });
    return;
  }

  const currentRes = await supabase.from(EXCEPTION_TABLE).select('*').eq('id', id).single();
  if (currentRes.error || !currentRes.data) {
    res.status(404).json({ error: currentRes.error?.message ?? 'Exception report not found.' });
    return;
  }

  const currentStatus = normalizeExceptionStatus(currentRes.data.status) ?? 'Open';
  if (!isValidExceptionTransition(currentStatus, nextStatus)) {
    res.status(400).json({ error: `Cannot move ${currentStatus} to ${nextStatus}.` });
    return;
  }

  const valueFromBody = (key: string, fallback: unknown) =>
    Object.prototype.hasOwnProperty.call(body, key) ? body[key] : fallback;

  const editedInput = {
    report_date: String(valueFromBody('report_date', currentRes.data.report_date) ?? ''),
    exception_type: String(valueFromBody('exception_type', currentRes.data.exception_type) ?? ''),
    product_barcode: String(valueFromBody('product_barcode', currentRes.data.product_barcode) ?? ''),
    picking_list_number: String(valueFromBody('picking_list_number', currentRes.data.picking_list_number) ?? ''),
    picking_container: String(valueFromBody('picking_container', currentRes.data.picking_container) ?? ''),
    picking_operator: String(valueFromBody('picking_operator', currentRes.data.picking_operator) ?? ''),
    packing_rebin_operator: String(valueFromBody('packing_rebin_operator', currentRes.data.packing_rebin_operator) ?? ''),
    picked_location: String(valueFromBody('picked_location', currentRes.data.picked_location) ?? ''),
    system_location_qty: valueFromBody('system_location_qty', currentRes.data.system_location_qty),
    actual_qty: valueFromBody('actual_qty', currentRes.data.actual_qty),
    item_rows: valueFromBody('item_rows', currentRes.data.item_rows ?? []),
    count_by: String(valueFromBody('count_by', currentRes.data.count_by) ?? ''),
    borrowed_location: String(valueFromBody('borrowed_location', currentRes.data.borrowed_location) ?? ''),
    borrowed_qty: valueFromBody('borrowed_qty', currentRes.data.borrowed_qty ?? ''),
    inventory_adjustment: Boolean(valueFromBody('inventory_adjustment', currentRes.data.inventory_adjustment)),
    submitted_by_lead_id: String(valueFromBody('submitted_by_lead_id', currentRes.data.submitted_by_lead_id) ?? ''),
    resolution_note: String(valueFromBody('resolution_note', currentRes.data.resolution_note) ?? '')
  } satisfies ExceptionReportInput;
  const errors = validateExceptionReportInput(editedInput);
  const editedPayload = buildExceptionUpdatePayload(editedInput);
  if (errors.length || !editedPayload) {
    res.status(400).json({ error: errors[0] ?? 'Invalid exception report.' });
    return;
  }
  if (nextStatus === 'Resolved' && needsInventoryAdjustment(editedInput)) {
    res.status(400).json({ error: 'Inventory adjustment is required before resolving this exception.' });
    return;
  }

  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    ...editedPayload
  };
  if (nextStatus === 'Processing') updatePayload.processed_at = new Date().toISOString();
  if (nextStatus === 'Resolved') updatePayload.resolved_at = new Date().toISOString();
  if (nextStatus === 'Closed') {
    updatePayload.closed_at = new Date().toISOString();
    updatePayload.responsibility_result = 'pending';
    updatePayload.responsible_staff_id = null;
    updatePayload.mistake_report_id = null;
  }
  if (currentStatus === 'Closed' && nextStatus === 'Open') {
    updatePayload.processed_at = null;
    updatePayload.resolved_at = null;
    updatePayload.closed_at = null;
    updatePayload.responsibility_result = 'pending';
    updatePayload.responsible_staff_id = null;
    updatePayload.mistake_report_id = null;
  }

  const result = await updateExceptionReport(supabase, id, updatePayload);
  if (result.error) {
    res.status(500).json({ error: result.error.message });
    return;
  }
  res.status(200).json({ row: result.data });
};

const handleAdminClose = async (req: any, res: any, supabase: any, body: any) => {
  const user = await ensureAdminAccess(req, res, supabase);
  if (!user) return;

  const id = String(body.id ?? '').trim();
  const responsibilityResult = String(body.responsibility_result ?? '').trim();
  const responsibleStaffId = String(body.responsible_staff_id ?? '').trim().toUpperCase();
  if (!id || !['responsible', 'no_responsibility'].includes(responsibilityResult)) {
    res.status(400).json({ error: 'A valid close decision is required.' });
    return;
  }
  if (responsibilityResult === 'responsible' && !responsibleStaffId) {
    res.status(400).json({ error: 'Responsible staff ID is required.' });
    return;
  }

  const currentRes = await supabase.from(EXCEPTION_TABLE).select('*').eq('id', id).single();
  if (currentRes.error || !currentRes.data) {
    res.status(404).json({ error: currentRes.error?.message ?? 'Exception report not found.' });
    return;
  }
  if (currentRes.data.status === 'Closed') {
    res.status(409).json({ error: 'Exception report is already closed.' });
    return;
  }
  if (currentRes.data.status !== 'Resolved') {
    res.status(400).json({ error: 'Only Resolved exception reports can be closed.' });
    return;
  }

  let mistakeReportId: number | string | null = currentRes.data.mistake_report_id ?? null;
  if (responsibilityResult === 'responsible') {
    if (mistakeReportId) {
      res.status(409).json({ error: 'Mistake has already been created for this exception.' });
      return;
    }

    const employeeRes = await supabase
      .from('ob_employees')
      .select('staff_id, position')
      .eq('staff_id', responsibleStaffId)
      .limit(1)
      .maybeSingle();
    if (employeeRes.error) {
      res.status(500).json({ error: employeeRes.error.message });
      return;
    }
    if (!employeeRes.data?.staff_id) {
      res.status(400).json({ error: 'Responsible staff was not found.' });
      return;
    }

    const mistakeRes = await supabase
      .from(MISTAKE_REPORT_TABLE)
      .insert([
        {
          position: String(employeeRes.data.position ?? 'Exception'),
          employee_staff_id: responsibleStaffId,
          reason: `Exception #${String(currentRes.data.report_number ?? id).trim()}: ${currentRes.data.exception_type}`,
          reporter_staff_id: String(user.email ?? user.id ?? 'admin'),
          operational_date: currentRes.data.report_date
        }
      ])
      .select('id')
      .single();
    if (mistakeRes.error) {
      res.status(500).json({ error: mistakeRes.error.message });
      return;
    }
    mistakeReportId = mistakeRes.data?.id ?? null;
  }

  const result = await supabase
    .from(EXCEPTION_TABLE)
    .update({
      status: 'Closed',
      responsibility_result: responsibilityResult,
      responsible_staff_id: responsibilityResult === 'responsible' ? responsibleStaffId : null,
      mistake_report_id: mistakeReportId,
      resolution_note: String(body.resolution_note ?? currentRes.data.resolution_note ?? '').trim() || null,
      closed_at: new Date().toISOString()
    })
    .eq('id', id)
    .select('*')
    .single();
  if (result.error) {
    res.status(500).json({ error: result.error.message });
    return;
  }
  res.status(200).json({ row: result.data });
};

export default async function handler(req: any, res: any) {
  applyDevCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const supabase = createServiceSupabase();
  if (!supabase) {
    res.status(500).json({ error: 'Missing Supabase server configuration' });
    return;
  }

  try {
    if (req.method === 'GET') {
      await handleGet(req, res, supabase);
      return;
    }
    if (req.method === 'POST') {
      await handlePost(req, res, supabase);
      return;
    }
    if (req.method === 'PATCH') {
      const body = parseJsonBody<Record<string, unknown>>(req, res);
      if (!body) return;
      if (body.action === 'close') {
        await handleAdminClose(req, res, supabase, body);
        return;
      }
      await handleLeadPatch(req, res, supabase, body);
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    res.status(500).json({ error: String(error?.message ?? error ?? 'Exception request failed.') });
  }
}
