import { createServiceSupabase, ensureCron } from './_forecastShared.js';
import { runAttendanceAutoCheckout } from './_attendanceAutoCheckoutCore.js';
import { runDashboardAttendanceSnapshot } from './_dashboardAttendanceSnapshotCore.js';

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
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const job = String(req.query?.job ?? body.job ?? '').trim().toLowerCase();
    if (job === 'dashboard-attendance-snapshot') {
      const modeRaw = String(req.query?.mode ?? body.mode ?? '').trim().toLowerCase();
      const mode = modeRaw === 'actual' ? 'actual' : 'expected';
      const workDate = String(req.query?.work_date ?? body.work_date ?? '').trim();
      const cutoffHour = Number(req.query?.cutoff_hour ?? body.cutoff_hour ?? process.env.DASHBOARD_ATTENDANCE_CUTOFF_HOUR ?? 5);
      const dryRun = String(req.query?.dry_run ?? body.dry_run ?? '').toLowerCase() === 'true';
      const result = await runDashboardAttendanceSnapshot(supabase, {
        mode,
        workDate,
        cutoffHour,
        dryRun
      });
      res.status(200).json({ status: 'ok', ...result });
      return;
    }

    const cutoffHour = Number(req.query?.cutoff_hour ?? req.body?.cutoff_hour ?? process.env.ATTENDANCE_AUTO_CHECKOUT_HOUR ?? 5);
    const lookbackHours = Number(req.query?.lookback_hours ?? req.body?.lookback_hours ?? process.env.ATTENDANCE_AUTO_CHECKOUT_LOOKBACK_HOURS ?? 24);
    const dryRun = String(req.query?.dry_run ?? req.body?.dry_run ?? '').toLowerCase() === 'true';
    const result = await runAttendanceAutoCheckout(supabase, {
      cutoffHour,
      lookbackHours,
      dryRun
    });
    res.status(200).json({ status: 'ok', dry_run: dryRun, ...result });
  } catch (error: any) {
    res.status(500).json({ error: String(error?.message ?? error ?? 'Failed to run attendance auto checkout.') });
  }
}
