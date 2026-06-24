import { createClient } from '@supabase/supabase-js';
import {
  buildExceptionInsertPayload,
  buildExceptionUpdatePayload,
  getShortPickMissingQty,
  hasNoReplenishmentStockConfirmation,
  inferAutomaticExceptionClosure,
  inferExceptionStatus,
  isValidExceptionTransition,
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
const REPORT_NUMBER_CREATE_ATTEMPT_LIMIT = 50;

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

const getMaxExceptionReportSequence = (rows: Array<{ report_number?: unknown }> | null | undefined, reportDate: string) =>
  Math.max(0, ...(rows ?? []).map((row) => parseExceptionReportSequence(row.report_number, reportDate)));

const getNextExceptionReportNumber = async (supabase: any, reportDate: string, minimumSequence = 1) => {
  const prefix = reportDateKey(reportDate);
  const result = await supabase
    .from(EXCEPTION_TABLE)
    .select('report_number')
    .gte('report_number', `${prefix}${'0'.repeat(REPORT_NUMBER_SEQUENCE_WIDTH)}`)
    .lt('report_number', `${prefix}:`)
    .order('report_number', { ascending: false })
    .limit(2000);

  if (result.error) throw new Error(result.error.message);
  const lastSequence = getMaxExceptionReportSequence(result.data, reportDate);
  return buildExceptionReportNumber(reportDate, Math.max(lastSequence + 1, minimumSequence));
};

const isUniqueConstraintError = (error: any) =>
  String(error?.code ?? '') === '23505' || /duplicate key|unique/i.test(String(error?.message ?? ''));

const isMissingAtomicCreateFunctionError = (error: any) =>
  ['42883', 'PGRST202'].includes(String(error?.code ?? '')) ||
  /could not find.*create_exception_report_atomic|function.*create_exception_report_atomic.*does not exist/i.test(
    String(error?.message ?? error?.details ?? '')
  );

const isMissingOptionalExceptionColumnError = (error: any) =>
  String(error?.code ?? '') === 'PGRST204' &&
  /item_rows|extra_taken/i.test(String(error?.message ?? error?.details ?? ''));

const withoutOptionalExceptionColumns = <T extends Record<string, unknown>>(payload: T, error: any) => {
  const missing = String(error?.message ?? error?.details ?? '');
  if (/item_rows/i.test(missing)) {
    const { item_rows: _itemRows, ...nextPayload } = payload;
    return nextPayload;
  }
  if (/extra_taken/i.test(missing)) {
    const { extra_taken: _extraTaken, ...nextPayload } = payload;
    return nextPayload;
  }
  return payload;
};

const insertExceptionReport = async (supabase: any, payload: Record<string, unknown>) => {
  const result = await supabase.from(EXCEPTION_TABLE).insert([payload]).select('*').single();
  if (!isMissingOptionalExceptionColumnError(result.error)) return result;
  return supabase.from(EXCEPTION_TABLE).insert([withoutOptionalExceptionColumns(payload, result.error)]).select('*').single();
};

const insertExceptionReportAtomic = async (supabase: any, payload: Record<string, unknown>, status: string) => {
  if (typeof supabase.rpc !== 'function') return null;
  const result = await supabase.rpc('create_exception_report_atomic', { p_payload: { ...payload, status } });
  if (isMissingAtomicCreateFunctionError(result.error)) return null;
  return result;
};

const updateExceptionReport = async (supabase: any, id: string, payload: Record<string, unknown>) => {
  const result = await supabase.from(EXCEPTION_TABLE).update(payload).eq('id', id).select('*').single();
  if (!isMissingOptionalExceptionColumnError(result.error)) return result;
  return supabase.from(EXCEPTION_TABLE).update(withoutOptionalExceptionColumns(payload, result.error)).eq('id', id).select('*').single();
};

const normalizeStaffId = (value: unknown) => String(value ?? '').trim().toUpperCase();

const resolveResponsibilityTargets = (
  report: Record<string, unknown>,
  responsibilityResult: string,
  responsibleStaffId: string
) => {
  const pickerStaffId = normalizeStaffId(report.picking_operator);
  const packerStaffId = normalizeStaffId(report.packing_rebin_operator);
  const selectedResponsibleStaffIds =
    responsibilityResult === 'picker'
      ? [pickerStaffId]
      : responsibilityResult === 'packer'
        ? [packerStaffId]
        : responsibilityResult === 'all'
          ? [pickerStaffId, packerStaffId]
          : responsibilityResult === 'responsible'
            ? [responsibleStaffId]
            : [];
  const targetStaffIds = Array.from(new Set(selectedResponsibleStaffIds.filter(Boolean)));

  if (responsibilityResult !== 'no_responsibility' && targetStaffIds.length === 0) {
    return { error: 'Responsible staff was not found on this exception.' };
  }
  if (responsibilityResult === 'responsible' && ![pickerStaffId, packerStaffId].includes(responsibleStaffId)) {
    return { error: 'Responsible staff must be the picker or packing/rebin operator.' };
  }

  return { pickerStaffId, packerStaffId, targetStaffIds };
};

const createMistakeReportForExceptionCompletion = async (
  supabase: any,
  report: Record<string, unknown>,
  targetStaffIds: string[],
  reporterStaffId: string
) => {
  if (!targetStaffIds.length) return { mistakeReportId: report.mistake_report_id ?? null, error: null };
  if (report.mistake_report_id) {
    return { mistakeReportId: report.mistake_report_id, error: 'Mistake has already been created for this exception.' };
  }

  const pickerStaffId = normalizeStaffId(report.picking_operator);
  const packerStaffId = normalizeStaffId(report.packing_rebin_operator);
  const mistakeRows = [];
  for (const staffId of targetStaffIds) {
    const employeeRes = await supabase
      .from(EMPLOYEE_TABLE)
      .select('staff_id, position')
      .eq('staff_id', staffId)
      .limit(1)
      .maybeSingle();
    if (employeeRes.error) return { mistakeReportId: null, error: employeeRes.error.message };
    if (!employeeRes.data?.staff_id) return { mistakeReportId: null, error: 'Responsible staff was not found.' };

    const roleLabel = staffId === pickerStaffId ? 'Picker' : staffId === packerStaffId ? 'Packing/Rebin' : 'Responsible';
    mistakeRows.push({
      position: String(employeeRes.data.position ?? 'Exception'),
      employee_staff_id: staffId,
      reason: `Exception #${String(report.report_number ?? report.id ?? '').trim()}: ${report.exception_type} (${roleLabel})`,
      reporter_staff_id: reporterStaffId,
      operational_date: report.report_date
    });
  }

  const mistakeRes = await supabase
    .from(MISTAKE_REPORT_TABLE)
    .insert(mistakeRows)
    .select('id');
  if (mistakeRes.error) return { mistakeReportId: null, error: mistakeRes.error.message };

  const mistakeData = Array.isArray(mistakeRes.data) ? mistakeRes.data : [mistakeRes.data].filter(Boolean);
  return { mistakeReportId: mistakeData[0]?.id ?? null, error: null };
};

const completeExceptionReport = async (
  supabase: any,
  report: Record<string, unknown>,
  responsibilityResult: string,
  responsibleStaffId: string,
  resolutionNote: string,
  reporterStaffId: string
) => {
  const targetRes = resolveResponsibilityTargets(report, responsibilityResult, responsibleStaffId);
  if ('error' in targetRes) return { statusCode: 400, error: targetRes.error };

  const mistakeRes = await createMistakeReportForExceptionCompletion(supabase, report, targetRes.targetStaffIds, reporterStaffId);
  if (mistakeRes.error) {
    return {
      statusCode: /already been created/i.test(mistakeRes.error) ? 409 : 500,
      error: mistakeRes.error
    };
  }

  const nowIso = new Date().toISOString();
  const result = await updateExceptionReport(supabase, String(report.id ?? ''), {
    status: 'Completed',
    responsibility_result: responsibilityResult,
    responsible_staff_id: targetRes.targetStaffIds.length === 1 ? targetRes.targetStaffIds[0] : null,
    mistake_report_id: mistakeRes.mistakeReportId,
    resolution_note: resolutionNote || null,
    resolved_at: String(report.resolved_at ?? '').trim() || nowIso,
    closed_at: nowIso
  });
  if (result.error) return { statusCode: 500, error: result.error.message };
  return { statusCode: 200, row: result.data };
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
    const employeeRes = await supabase
      .from(EMPLOYEE_TABLE)
      .select('staff_id, name, position, agency')
      .order('staff_id', { ascending: true })
      .limit(5000);
    if (employeeRes.error) {
      res.status(500).json({ error: employeeRes.error.message });
      return;
    }

    const rows = ((employeeRes.data ?? []) as Array<{ staff_id?: string | null; name?: string | null; position?: string | null; agency?: string | null }>)
      .map((row) => ({
        staff_id: String(row.staff_id ?? '').trim().toUpperCase(),
        name: String(row.name ?? '').trim(),
        position: String(row.position ?? '').trim(),
        agency: String(row.agency ?? '').trim()
      }))
      .filter((row) => Boolean(row.staff_id));
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

  const errors = validateExceptionReportInput(body, { requireCountByForQuantities: true });
  const payload = buildExceptionInsertPayload(body);
  if (errors.length || !payload) {
    res.status(400).json({ error: errors[0] ?? 'Invalid exception report.' });
    return;
  }

  const status = inferExceptionStatus(body);
  const atomicResult = await insertExceptionReportAtomic(supabase, payload, status);
  if (atomicResult) {
    if (atomicResult.error) {
      res.status(500).json({ error: atomicResult.error.message });
      return;
    }
    res.status(200).json({ row: atomicResult.data });
    return;
  }

  let lastError: any = null;
  let minimumSequence = 1;
  for (let attempt = 0; attempt < REPORT_NUMBER_CREATE_ATTEMPT_LIMIT; attempt += 1) {
    const reportNumber = await getNextExceptionReportNumber(supabase, payload.report_date, minimumSequence);
    const result = await insertExceptionReport(supabase, { ...payload, report_number: reportNumber, status });
    if (!result.error) {
      res.status(200).json({ row: result.data });
      return;
    }
    lastError = result.error;
    if (!isUniqueConstraintError(result.error)) break;
    minimumSequence = parseExceptionReportSequence(reportNumber, payload.report_date) + 1;
  }
  res.status(500).json({ error: lastError?.message ?? 'Failed to create exception report.' });
};

const handleLeadPatch = async (
  req: any,
  res: any,
  supabase: any,
  body: any,
  options: { skipLeadPin?: boolean } = {}
) => {
  if (!options.skipLeadPin) {
    if (!ensureLeadPinConfigured(res)) return;
    if (!hasLeadPin(req, body)) {
      res.status(401).json({ error: 'Invalid Lead PIN.' });
      return;
    }
  }

  const id = String(body.id ?? '').trim();
  const requestedStatus = Object.prototype.hasOwnProperty.call(body, 'status') ? normalizeExceptionStatus(body.status) : null;
  if (!id || (Object.prototype.hasOwnProperty.call(body, 'status') && !requestedStatus)) {
    res.status(400).json({ error: 'A valid id and status are required.' });
    return;
  }

  const currentRes = await supabase.from(EXCEPTION_TABLE).select('*').eq('id', id).single();
  if (currentRes.error || !currentRes.data) {
    res.status(404).json({ error: currentRes.error?.message ?? 'Exception report not found.' });
    return;
  }

  const currentStatus = normalizeExceptionStatus(currentRes.data.status) ?? 'Open';

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
    missing_qty: valueFromBody('missing_qty', getShortPickMissingQty(currentRes.data)),
    borrowed_location: String(valueFromBody('borrowed_location', currentRes.data.borrowed_location) ?? ''),
    borrowed_qty: valueFromBody('borrowed_qty', currentRes.data.borrowed_qty ?? ''),
    no_replenishment_stock: Boolean(valueFromBody('no_replenishment_stock', hasNoReplenishmentStockConfirmation(currentRes.data))),
    short_picked: Boolean(valueFromBody('short_picked', currentRes.data.short_picked)),
    extra_taken: Boolean(valueFromBody('extra_taken', currentRes.data.extra_taken)),
    inventory_adjustment: Boolean(valueFromBody('inventory_adjustment', currentRes.data.inventory_adjustment)),
    submitted_by_lead_id: String(valueFromBody('submitted_by_lead_id', currentRes.data.submitted_by_lead_id) ?? ''),
    resolution_note: String(valueFromBody('resolution_note', currentRes.data.resolution_note) ?? '')
  } satisfies ExceptionReportInput;
  const errors = validateExceptionReportInput(editedInput, { requireCountByForQuantities: true });
  const editedPayload = buildExceptionUpdatePayload(editedInput);
  if (errors.length || !editedPayload) {
    res.status(400).json({ error: errors[0] ?? 'Invalid exception report.' });
    return;
  }

  const nextStatus =
    requestedStatus === 'Closed' || (currentStatus === 'Closed' && requestedStatus === 'Open')
      ? requestedStatus
      : inferExceptionStatus(editedInput);
  const automaticClosure = requestedStatus || currentStatus === 'Closed' ? null : inferAutomaticExceptionClosure(editedInput);
  if (!nextStatus) {
    res.status(400).json({ error: 'A valid id and status are required.' });
    return;
  }
  if ((requestedStatus === 'Closed' || currentStatus === 'Closed') && !isValidExceptionTransition(currentStatus, nextStatus)) {
    res.status(400).json({ error: `Cannot move ${currentStatus} to ${nextStatus}.` });
    return;
  }
  if (automaticClosure) {
    const closeResult = await completeExceptionReport(
      supabase,
      { ...currentRes.data, ...editedPayload, id },
      automaticClosure.responsibility_result,
      automaticClosure.responsible_staff_id,
      String(editedPayload.resolution_note ?? ''),
      normalizeStaffId(editedPayload.submitted_by_lead_id ?? currentRes.data.submitted_by_lead_id ?? 'LEAD')
    );
    if (closeResult.error) {
      res.status(closeResult.statusCode).json({ error: closeResult.error });
      return;
    }
    res.status(200).json({ row: closeResult.row });
    return;
  }

  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    ...editedPayload
  };
  if (nextStatus === 'Open') {
    updatePayload.processed_at = null;
    updatePayload.resolved_at = null;
  }
  if (nextStatus === 'Processing' || nextStatus === 'Counted') updatePayload.processed_at = new Date().toISOString();
  if (nextStatus === 'Processing' || nextStatus === 'Counted' || nextStatus === 'Pending Adjustment') updatePayload.resolved_at = null;
  if (nextStatus === 'Resolved') updatePayload.resolved_at = new Date().toISOString();
  if (nextStatus === 'Closed') {
    updatePayload.closed_at = new Date().toISOString();
    updatePayload.responsibility_result = 'pending';
    updatePayload.responsible_staff_id = null;
    updatePayload.mistake_report_id = null;
  }
  if (nextStatus === 'Completed') {
    updatePayload.closed_at = null;
  }
  if ((currentStatus === 'Closed' || currentStatus === 'Completed') && nextStatus === 'Open') {
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
  if (!id || !['picker', 'packer', 'all', 'responsible', 'no_responsibility'].includes(responsibilityResult)) {
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
  if (currentRes.data.status === 'Completed') {
    res.status(409).json({ error: 'Exception report is already completed.' });
    return;
  }
  if (currentRes.data.status === 'Closed') {
    res.status(409).json({ error: 'Exception report is already closed.' });
    return;
  }
  if (currentRes.data.status !== 'Resolved') {
    res.status(400).json({ error: 'Only Resolved exception reports can be completed.' });
    return;
  }

  const closeResult = await completeExceptionReport(
    supabase,
    currentRes.data,
    responsibilityResult,
    responsibleStaffId,
    String(body.resolution_note ?? currentRes.data.resolution_note ?? '').trim(),
    String(user.email ?? user.id ?? 'admin')
  );
  if (closeResult.error) {
    res.status(closeResult.statusCode).json({ error: closeResult.error });
    return;
  }
  res.status(200).json({ row: closeResult.row });
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
      const token = getBearerToken(req);
      if (token) {
        const user = await ensureAdminAccess(req, res, supabase, 'operate');
        if (!user) return;
        await handleLeadPatch(req, res, supabase, body, { skipLeadPin: true });
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
