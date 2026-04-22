import { createServiceSupabase, ensureCron, isDateOnly } from './_forecastShared';
import { getOperationalMetricDateNow, syncScheduledHeadcountForDate } from './_packageStaffingSync';

export default async function handler(req: any, res: any) {
  if (!ensureCron(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabase = createServiceSupabase();
  if (!supabase) {
    res.status(500).json({ error: 'Missing Supabase server configuration' });
    return;
  }

  try {
    const requestedMetricDate = String(req.query?.metric_date ?? req.body?.metric_date ?? '').trim();
    const metricDate = isDateOnly(requestedMetricDate) ? requestedMetricDate : getOperationalMetricDateNow(new Date());
    const scheduledHeadcount = await syncScheduledHeadcountForDate(supabase, metricDate);
    res.status(200).json({
      status: 'ok',
      metric_date: metricDate,
      scheduled_headcount: scheduledHeadcount
    });
  } catch (error: any) {
    res.status(400).json({ error: String(error?.message ?? error ?? 'Failed to sync package staffing.') });
  }
}
