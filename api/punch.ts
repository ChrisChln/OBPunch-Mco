import { createServiceSupabase, parseJsonBody } from './_forecastShared.js';
import { submitPunchWithServiceRole, type PunchAction } from './_punchCore.js';

type PunchBody = {
  staff_id?: unknown;
  action?: unknown;
};

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabase = createServiceSupabase();
  if (!supabase) {
    res.status(500).json({ error: 'Missing Supabase server configuration' });
    return;
  }

  const body = parseJsonBody<PunchBody>(req, res);
  if (!body) return;

  const action = String(body.action ?? '').toUpperCase();
  const result = await submitPunchWithServiceRole(supabase, {
    staffId: String(body.staff_id ?? ''),
    action: action as PunchAction,
    userAgent: String(req.headers?.['user-agent'] ?? '')
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(200).json({ status: 'ok', staff_id: result.staffId, action: result.action });
}
