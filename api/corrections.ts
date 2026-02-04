import { createClient } from '@supabase/supabase-js';

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
    const { error } = await supabase.from('ob_punches').insert([
      {
        staff_id: staffId,
        action,
        metadata: {
          device: 'admin_api',
          kind: 'correction',
          operator: 'admin_api',
          note,
          effective_at: effectiveAt
        }
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





