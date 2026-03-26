import {
  MAIN_LEADERBOARD_CUTOFF
} from '../src/admin/pages/PredictionModelPage.tsx';
import {
  addDaysDateOnly,
  asNumber,
  createServiceSupabase,
  ensureAdmin,
  getDefaultTargetDate,
  readThresholds
} from './_forecastShared';

type EvaluatePayload = {
  target_date?: string | null;
};

const calculateVarianceRate = (forecast: number | null, actual: number) => {
  if (forecast === null || actual <= 0) return null;
  return (actual - forecast) / actual;
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? null;
};

const buildSeriesMetrics = (rows: Array<{ actual: number; forecast: number | null }>) => {
  const validRows = rows.filter((row) => row.forecast !== null);
  const totalActual = validRows.reduce((sum, row) => sum + row.actual, 0);
  const totalAbsError = validRows.reduce((sum, row) => sum + Math.abs((row.forecast ?? 0) - row.actual), 0);
  const absVariances = validRows
    .map((row) => {
      const variance = calculateVarianceRate(row.forecast, row.actual);
      return variance === null ? null : Math.abs(variance);
    })
    .filter((value): value is number => value !== null);
  return {
    samples: validRows.length,
    recent14Wape: totalActual > 0 ? totalAbsError / totalActual : null,
    within3HitRate: validRows.length ? absVariances.filter((value) => value <= 0.03).length / validRows.length : null,
    p90AbsVariance: percentile(absVariances, 0.9),
    worstAbsVariance: absVariances.length ? Math.max(...absVariances) : null
  };
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

  const body = (typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')) as EvaluatePayload;
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.target_date ?? '').trim())
    ? String(body.target_date)
    : getDefaultTargetDate(-1);

  try {
    const publicationRes = await supabase
      .from('volume_forecast_publications')
      .select('id,target_date,run_id,selected_prediction_id,published_forecast,status,is_manual_override')
      .eq('target_date', targetDate)
      .eq('cutoff_mode', MAIN_LEADERBOARD_CUTOFF)
      .eq('status', 'published')
      .limit(1)
      .maybeSingle();
    if (publicationRes.error) throw publicationRes.error;
    const publication = publicationRes.data;
    if (!publication || !publication.run_id) {
      res.status(409).json({ error: `No published official forecast found for ${targetDate}.` });
      return;
    }

    const historyRes = await supabase
      .from('volume_history')
      .select('date,last_filled_hour,total_volume')
      .eq('date', targetDate)
      .limit(1)
      .maybeSingle();
    if (historyRes.error) throw historyRes.error;
    const actualValue = asNumber((historyRes.data as any)?.total_volume);
    const lastFilledHour = asNumber((historyRes.data as any)?.last_filled_hour);
    if (actualValue === null || lastFilledHour === null || lastFilledHour < 23) {
      res.status(409).json({ error: `Actuals for ${targetDate} are not complete yet.` });
      return;
    }

    const predictionsRes = await supabase
      .from('volume_forecast_predictions')
      .select('id,forecast_value,candidate_scope,candidate_key,candidate_label')
      .eq('run_id', publication.run_id)
      .order('candidate_scope', { ascending: true })
      .order('candidate_key', { ascending: true });
    if (predictionsRes.error) throw predictionsRes.error;
    const predictions = ((predictionsRes.data as any[]) ?? []).map((row) => ({
      id: Number(row.id ?? 0),
      forecastValue: asNumber(row.forecast_value) ?? 0,
      scope: String(row.candidate_scope ?? ''),
      key: String(row.candidate_key ?? ''),
      label: String(row.candidate_label ?? '')
    }));

    if (predictions.length === 0) {
      res.status(409).json({ error: `No candidate predictions found for run ${publication.run_id}.` });
      return;
    }

    const evaluationsPayload = predictions.map((prediction) => {
      const absError = Math.abs(prediction.forecastValue - actualValue);
      const variance = calculateVarianceRate(prediction.forecastValue, actualValue);
      return {
        prediction_id: prediction.id,
        actual_value: actualValue,
        abs_error: absError,
        variance_pct: variance,
        ape: actualValue > 0 ? absError / actualValue : null,
        evaluated_at: new Date().toISOString()
      };
    });
    const evaluationsUpsert = await supabase
      .from('volume_forecast_evaluations')
      .upsert(evaluationsPayload, { onConflict: 'prediction_id' });
    if (evaluationsUpsert.error) throw evaluationsUpsert.error;

    const thresholds = await readThresholds(supabase);
    const publishedRowsRes = await supabase
      .from('volume_forecast_publications')
      .select('target_date,published_forecast,status')
      .eq('cutoff_mode', MAIN_LEADERBOARD_CUTOFF)
      .eq('status', 'published')
      .lte('target_date', targetDate)
      .order('target_date', { ascending: false })
      .limit(14);
    if (publishedRowsRes.error) throw publishedRowsRes.error;

    const publishedRows = ((publishedRowsRes.data as any[]) ?? []).map((row) => ({
      targetDate: String(row.target_date ?? ''),
      forecast: asNumber(row.published_forecast)
    }));
    const actualRowsRes = await supabase
      .from('volume_history')
      .select('date,last_filled_hour,total_volume')
      .in(
        'date',
        publishedRows.map((row) => row.targetDate)
      );
    if (actualRowsRes.error) throw actualRowsRes.error;
    const actualByDate = new Map(
      (((actualRowsRes.data as any[]) ?? []) as any[])
        .filter((row) => asNumber(row.last_filled_hour) !== null && (asNumber(row.last_filled_hour) ?? -1) >= 23)
        .map((row) => [String(row.date ?? ''), asNumber(row.total_volume) ?? 0])
    );

    const recentSeries = publishedRows
      .map((row) => ({
        actual: actualByDate.get(row.targetDate) ?? null,
        forecast: row.forecast
      }))
      .filter((row): row is { actual: number; forecast: number | null } => row.actual !== null)
      .reverse();

    const metrics = buildSeriesMetrics(recentSeries);
    const alerts: Array<{
      alert_date: string;
      target_date: string;
      alert_type: string;
      severity: 'warning' | 'critical';
      details_json: Record<string, unknown>;
      status: 'open';
      updated_at: string;
    }> = [];

    if (metrics.recent14Wape !== null && metrics.recent14Wape > thresholds.recent14Wape) {
      alerts.push({
        alert_date: targetDate,
        target_date: targetDate,
        alert_type: 'recent14_wape_exceeded',
        severity: 'warning',
        details_json: { actual_metric: metrics.recent14Wape, threshold: thresholds.recent14Wape },
        status: 'open',
        updated_at: new Date().toISOString()
      });
    }
    if (metrics.p90AbsVariance !== null && metrics.p90AbsVariance > thresholds.p90AbsVariance) {
      alerts.push({
        alert_date: targetDate,
        target_date: targetDate,
        alert_type: 'p90_abs_variance_exceeded',
        severity: 'warning',
        details_json: { actual_metric: metrics.p90AbsVariance, threshold: thresholds.p90AbsVariance },
        status: 'open',
        updated_at: new Date().toISOString()
      });
    }
    if (metrics.within3HitRate !== null && metrics.within3HitRate < thresholds.within3Floor) {
      alerts.push({
        alert_date: targetDate,
        target_date: targetDate,
        alert_type: 'within3_below_floor',
        severity: 'warning',
        details_json: { actual_metric: metrics.within3HitRate, threshold: thresholds.within3Floor },
        status: 'open',
        updated_at: new Date().toISOString()
      });
    }
    if (metrics.worstAbsVariance !== null && metrics.worstAbsVariance > thresholds.worstDay) {
      alerts.push({
        alert_date: targetDate,
        target_date: targetDate,
        alert_type: 'worst_day_exceeded',
        severity: 'critical',
        details_json: { actual_metric: metrics.worstAbsVariance, threshold: thresholds.worstDay },
        status: 'open',
        updated_at: new Date().toISOString()
      });
    }
    if (alerts.length > 0) {
      alerts.push({
        alert_date: targetDate,
        target_date: targetDate,
        alert_type: 'retrain_recommended',
        severity: 'warning',
        details_json: {
          recent14_wape: metrics.recent14Wape,
          within3_hit_rate: metrics.within3HitRate,
          p90_abs_variance: metrics.p90AbsVariance,
          worst_abs_variance: metrics.worstAbsVariance
        },
        status: 'open',
        updated_at: new Date().toISOString()
      });
      const alertsUpsert = await supabase
        .from('volume_forecast_alerts')
        .upsert(alerts, { onConflict: 'alert_date,target_date,alert_type' });
      if (alertsUpsert.error) throw alertsUpsert.error;
    }

    res.status(200).json({
      status: 'ok',
      target_date: targetDate,
      actual_value: actualValue,
      evaluated_predictions: predictions.length,
      metrics,
      alerts_opened: alerts.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
}
