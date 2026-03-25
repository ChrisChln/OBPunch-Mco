import {
  createServiceSupabase,
  ensureAdmin,
  getDefaultTargetDate,
  isDateOnly,
  parseJsonBody
} from './_forecastShared';
import { runForecast } from './_forecastRunCore';

type RunPayload = {
  target_date?: string | null;
  run_type?: 'official' | 'manual' | 'backfill' | null;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!ensureAdmin(req, res)) return;

  const supabase = createServiceSupabase();
  if (!supabase) {
    res.status(500).json({ error: 'Missing Supabase server configuration' });
    return;
  }

  const body = parseJsonBody<RunPayload>(req, res);
  if (!body) return;
  const targetDate = isDateOnly(body.target_date) ? String(body.target_date) : getDefaultTargetDate(1);
  const runType = body.run_type && ['official', 'manual', 'backfill'].includes(body.run_type) ? body.run_type : 'official';

  try {
    const result = await runForecast({
      supabase,
      targetDate,
      runType
    });
    res.status(200).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
}
