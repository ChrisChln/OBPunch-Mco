import { MAIN_LEADERBOARD_CUTOFF } from '../src/admin/pages/PredictionModelPage.tsx';
import {
  addDaysDateOnly,
  createServiceSupabase,
  ensureCron,
  getDefaultTargetDate,
  isDateOnly,
  loadForecastSetting,
  toDateOnlyNy
} from './_forecastShared';
import { runForecast } from './_forecastRunCore';

const getNowInTimezoneParts = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateOnly: `${byType.year}-${byType.month}-${byType.day}`,
    hour: Number(byType.hour ?? '0'),
    minute: Number(byType.minute ?? '0')
  };
};

const parseTimeValue = (value: unknown) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};

const isWithinWindow = (currentMinutes: number, targetMinutes: number, toleranceMinutes: number) =>
  Math.abs(currentMinutes - targetMinutes) <= toleranceMinutes;

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!ensureCron(req, res)) return;

  const supabase = createServiceSupabase();
  if (!supabase) {
    res.status(500).json({ error: 'Missing Supabase server configuration' });
    return;
  }

  try {
    const rawSetting = (await loadForecastSetting(supabase, 'forecast_official_run_time')) as
      | { timezone?: unknown; time?: unknown }
      | null;
    const timeZone = String(rawSetting?.timezone ?? 'America/New_York').trim() || 'America/New_York';
    const parsedTime = parseTimeValue(rawSetting?.time) ?? { hour: 21, minute: 30 };
    const nowLocal = getNowInTimezoneParts(timeZone);
    const currentMinutes = nowLocal.hour * 60 + nowLocal.minute;
    const targetMinutes = parsedTime.hour * 60 + parsedTime.minute;
    const targetDateFromQuery = isDateOnly(req.query?.target_date) ? String(req.query.target_date) : null;
    const targetDate = targetDateFromQuery ?? addDaysDateOnly(nowLocal.dateOnly, 1);

    if (!targetDateFromQuery && !isWithinWindow(currentMinutes, targetMinutes, 20)) {
      res.status(200).json({
        status: 'skipped',
        reason: 'outside_run_window',
        now_local: `${nowLocal.dateOnly} ${String(nowLocal.hour).padStart(2, '0')}:${String(nowLocal.minute).padStart(2, '0')}`,
        scheduled_time: `${String(parsedTime.hour).padStart(2, '0')}:${String(parsedTime.minute).padStart(2, '0')}`,
        timezone: timeZone,
        target_date: targetDate
      });
      return;
    }

    const existingRun = await supabase
      .from('volume_forecast_runs')
      .select('id,status,started_at')
      .eq('target_date', targetDate)
      .eq('cutoff_mode', MAIN_LEADERBOARD_CUTOFF)
      .eq('run_type', 'official')
      .in('status', ['running', 'succeeded'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingRun.error) throw existingRun.error;

    if (existingRun.data) {
      res.status(200).json({
        status: 'skipped',
        reason: 'existing_official_run',
        target_date: targetDate,
        existing_run: existingRun.data
      });
      return;
    }

    const result = await runForecast({
      supabase,
      targetDate,
      runType: 'official'
    });

    res.status(200).json({
      ...result,
      triggered_by: 'cron',
      timezone: timeZone
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
}
