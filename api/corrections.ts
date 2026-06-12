import { createClient } from '@supabase/supabase-js';
import { isEmployeeTerminated } from '../src/shared/employeeStatus.js';

const supabaseUrl = process.env.SUPABASE_URL as string | undefined;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const adminToken = process.env.ADMIN_TOKEN as string | undefined;

const supabase = supabaseUrl && supabaseServiceRoleKey ? createClient(supabaseUrl, supabaseServiceRoleKey) : null;

type CorrectionPayload = {
  staff_id: string;
  action: 'IN' | 'OUT';
  effective_at?: string | null;
  note?: string | null;
};

type EmployeeStatusRow = {
  terminated_at?: string | null;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = (req.headers?.authorization as string | undefined) ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!adminToken || token !== adminToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!supabase) {
    res.status(500).json({ error: 'Missing Supabase server configuration' });
    return;
  }

  let body: CorrectionPayload;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch (err) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const staffId = (body.staff_id ?? '').trim().toUpperCase();
  const action = body.action ?? '';
  if (!/^[A-Z]{0,4}\d{3,12}$/.test(staffId) || (action !== 'IN' && action !== 'OUT')) {
    res.status(400).json({ error: 'Invalid payload: staff_id or action' });
    return;
  }

  const effectiveAt = body.effective_at ? String(body.effective_at) : null;
  const note = body.note ? String(body.note) : null;

  try {
    const employeeRes = await supabase
      .from('ob_employees')
      .select('terminated_at')
      .eq('staff_id', staffId)
      .limit(1);

    if (employeeRes.error) {
      res.status(500).json({ error: employeeRes.error.message });
      return;
    }

    const employee = ((employeeRes.data as EmployeeStatusRow[] | null) ?? [])[0] ?? null;
    if (isEmployeeTerminated({ terminatedAt: employee?.terminated_at }, { referenceAt: effectiveAt ?? new Date(), allowTerminationDate: true })) {
      res.status(409).json({ error: 'Terminated employee cannot punch.' });
      return;
    }

    const { error } = await supabase.from('ob_punches').insert([
      {
        staff_id: staffId,
        action,
        ...(effectiveAt ? { created_at: effectiveAt } : {}),
        device: 'admin_api',
        source: 'correction',
        operator: 'admin_api',
        note
      }
    ]);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
}






