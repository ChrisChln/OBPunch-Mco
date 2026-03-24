import { buildPredictionWorkbenchData, MAIN_LEADERBOARD_CUTOFF } from '../src/admin/pages/PredictionModelPage.tsx';
import {
  DEFAULT_CODE_VERSION,
  addDaysDateOnly,
  createServiceSupabase,
  ensureAdmin,
  getDefaultTargetDate,
  isDateOnly,
  readEnabledModels
} from './_forecastShared';

type RunPayload = {
  target_date?: string | null;
  run_type?: 'official' | 'manual' | 'backfill' | null;
};

const HISTORY_SELECT =
  'date,last_filled_hour,h00,h01,h02,h03,h04,h05,h06,h07,h08,h09,h10,h11,h12,h13,h14,h15,h16,h17,h18,h19,h20,h21,h22,h23';
const INPUT_SELECT =
  'input_date,weekday,previous_day_backlog,current_cumulative_volume_12,inventory_level,severe_weather,major_promotion,full_day_capacity,yesterday_inflow_00_14';

const toFinite = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

const buildMetrics = <TRow,>(
  rows: TRow[],
  getActual: (row: TRow) => number,
  getForecast: (row: TRow) => number | null
) => {
  const validRows = rows.filter((row) => getForecast(row) !== null);
  const samples = validRows.length;
  const totalActual = validRows.reduce((sum, row) => sum + getActual(row), 0);
  const totalAbsError = validRows.reduce((sum, row) => sum + Math.abs((getForecast(row) ?? 0) - getActual(row)), 0);
  const totalSquaredError = validRows.reduce((sum, row) => {
    const error = (getForecast(row) ?? 0) - getActual(row);
    return sum + error * error;
  }, 0);
  const mapeRows = validRows.filter((row) => getActual(row) > 0);
  const absVariances = validRows
    .map((row) => {
      const variance = calculateVarianceRate(getForecast(row), getActual(row));
      return variance === null ? null : Math.abs(variance);
    })
    .filter((value): value is number => value !== null);
  const within1 = absVariances.filter((value) => value <= 0.01).length;
  const within2 = absVariances.filter((value) => value <= 0.02).length;
  const within3 = absVariances.filter((value) => value <= 0.03).length;

  return {
    samples,
    wape: totalActual > 0 ? totalAbsError / totalActual : null,
    mape: mapeRows.length
      ? mapeRows.reduce((sum, row) => sum + Math.abs(((getForecast(row) ?? 0) - getActual(row)) / getActual(row)), 0) / mapeRows.length
      : null,
    rmse: samples ? Math.sqrt(totalSquaredError / samples) : null,
    within1HitRate: samples ? within1 / samples : null,
    within2HitRate: samples ? within2 / samples : null,
    within3HitRate: samples ? within3 / samples : null,
    p90AbsVariance: percentile(absVariances, 0.9),
    worstAbsVariance: absVariances.length ? Math.max(...absVariances) : null
  };
};

const compareRecommendation = (a: any, b: any) =>
  (b.metrics.within1HitRate ?? Number.NEGATIVE_INFINITY) - (a.metrics.within1HitRate ?? Number.NEGATIVE_INFINITY) ||
  (b.metrics.within3HitRate ?? Number.NEGATIVE_INFINITY) - (a.metrics.within3HitRate ?? Number.NEGATIVE_INFINITY) ||
  (a.metrics.p90AbsVariance ?? Number.POSITIVE_INFINITY) - (b.metrics.p90AbsVariance ?? Number.POSITIVE_INFINITY) ||
  (a.metrics.recent14Wape ?? Number.POSITIVE_INFINITY) - (b.metrics.recent14Wape ?? Number.POSITIVE_INFINITY) ||
  (a.metrics.worstAbsVariance ?? Number.POSITIVE_INFINITY) - (b.metrics.worstAbsVariance ?? Number.POSITIVE_INFINITY) ||
  String(a.key).localeCompare(String(b.key));

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

  const body = (typeof req.body === 'object' ? req.body : JSON.parse(req.body ?? '{}')) as RunPayload;
  const targetDate = isDateOnly(body.target_date) ? String(body.target_date) : getDefaultTargetDate(1);
  const runType = body.run_type && ['official', 'manual', 'backfill'].includes(body.run_type) ? body.run_type : 'official';
  const historyRangeEnd = addDaysDateOnly(targetDate, -1);
  const historyRangeStart = addDaysDateOnly(targetDate, -120);
  const preloadStart = addDaysDateOnly(targetDate, -400);
  let runId: number | null = null;

  try {
    const runInsert = await supabase
      .from('volume_forecast_runs')
      .insert([
        {
          run_type: runType,
          target_date: targetDate,
          cutoff_mode: MAIN_LEADERBOARD_CUTOFF,
          status: 'running',
          code_version: DEFAULT_CODE_VERSION,
          training_window_start: preloadStart,
          training_window_end: historyRangeEnd
        }
      ])
      .select('id')
      .single();
    if (runInsert.error) throw runInsert.error;
    runId = Number(runInsert.data?.id ?? 0);

    const [historyResult, inputResult, enabledModels] = await Promise.all([
      supabase.from('volume_history').select(HISTORY_SELECT).gte('date', preloadStart).lte('date', targetDate).order('date', { ascending: true }),
      supabase.from('volume_forecast_daily_inputs').select(INPUT_SELECT).gte('input_date', preloadStart).lte('input_date', targetDate).order('input_date', { ascending: true }),
      readEnabledModels(supabase)
    ]);
    if (historyResult.error) throw historyResult.error;
    if (inputResult.error) throw inputResult.error;

    const data = buildPredictionWorkbenchData({
      historyRows: (historyResult.data ?? []) as any[],
      inputRows: (inputResult.data ?? []) as any[],
      historyRangeStart,
      historyRangeEnd,
      forecastTargetDate: targetDate
    });

    const versionCandidates = data.versionLeaderboard
      .filter((metric) => metric.targetForecast !== null)
      .filter((metric) => !enabledModels || enabledModels.includes(metric.key))
      .map((metric) => {
        const fullMetrics = buildMetrics(
          data.versionEvaluationRows,
          (row) => row.actual,
          (row) => row.forecasts[metric.key]
        );
        const recentRows = data.versionEvaluationRows.slice(-14);
        const recentMetrics = buildMetrics(
          recentRows,
          (row) => row.actual,
          (row) => row.forecasts[metric.key]
        );
        return {
          scope: 'version' as const,
          key: metric.key,
          label: metric.label,
          forecastValue: Number(metric.targetForecast ?? 0),
          trainingSamples: metric.samples,
          metrics: {
            ...fullMetrics,
            recent14Wape: recentMetrics.wape,
            recent14Mape: recentMetrics.mape,
            recent14Rmse: recentMetrics.rmse
          }
        };
      })
      .sort(compareRecommendation);

    const modelCandidates = data.leaderboard
      .filter((metric) => metric.targetForecast !== null)
      .map((metric) => {
        const fullMetrics = buildMetrics(
          data.evaluationRows,
          (row) => row.actual,
          (row) => row.forecasts[metric.key]
        );
        const recentRows = data.evaluationRows.slice(-14);
        const recentMetrics = buildMetrics(
          recentRows,
          (row) => row.actual,
          (row) => row.forecasts[metric.key]
        );
        return {
          scope: 'model' as const,
          key: metric.key,
          label: metric.label,
          forecastValue: Number(metric.targetForecast ?? 0),
          trainingSamples: metric.samples,
          metrics: {
            ...fullMetrics,
            recent14Wape: recentMetrics.wape,
            recent14Mape: recentMetrics.mape,
            recent14Rmse: recentMetrics.rmse
          }
        };
      })
      .sort(compareRecommendation);

    const recommendedVersion = versionCandidates[0] ?? null;
    const featureSnapshotInsert = await supabase.from('volume_forecast_feature_snapshots').insert([
      {
        run_id: runId,
        target_date: targetDate,
        cutoff_mode: MAIN_LEADERBOARD_CUTOFF,
        feature_version: 'prediction_model_page_v1',
        raw_inputs_json: {
          preopen_input: data.targetFeatureSnapshot.preopenContext,
          excluded_fields: ['previous_day_backlog', 'inventory_level', 'yesterday_inflow_00_14', 'current_cumulative_volume_12']
        },
        features_json: data.targetFeatureSnapshot
      }
    ]);
    if (featureSnapshotInsert.error) throw featureSnapshotInsert.error;

    const predictionInsert = await supabase
      .from('volume_forecast_predictions')
      .insert(
        [...modelCandidates, ...versionCandidates].map((candidate) => ({
          run_id: runId,
          target_date: targetDate,
          cutoff_mode: MAIN_LEADERBOARD_CUTOFF,
          candidate_scope: candidate.scope,
          candidate_key: candidate.key,
          candidate_label: candidate.label,
          forecast_value: candidate.forecastValue,
          training_samples: candidate.trainingSamples,
          metrics_json: candidate.metrics,
          is_recommended: candidate.scope === 'version' && recommendedVersion?.key === candidate.key
        }))
      )
      .select('id,candidate_scope,candidate_key,forecast_value');
    if (predictionInsert.error) throw predictionInsert.error;

    const predictionIdByKey = new Map(
      ((predictionInsert.data as any[]) ?? []).map((row) => [`${row.candidate_scope}:${row.candidate_key}`, Number(row.id ?? 0)])
    );
    const recommendedPredictionId =
      recommendedVersion === null ? null : predictionIdByKey.get(`version:${recommendedVersion.key}`) ?? null;

    const publicationUpsert = await supabase.from('volume_forecast_publications').upsert(
      [
        {
          target_date: targetDate,
          cutoff_mode: MAIN_LEADERBOARD_CUTOFF,
          run_id: runId,
          recommended_prediction_id: recommendedPredictionId,
          selected_prediction_id: recommendedPredictionId,
          recommended_forecast: recommendedVersion?.forecastValue ?? null,
          published_forecast: recommendedVersion?.forecastValue ?? null,
          is_manual_override: false,
          override_reason: null,
          status: 'pending_review',
          updated_at: new Date().toISOString()
        }
      ],
      { onConflict: 'target_date,cutoff_mode' }
    );
    if (publicationUpsert.error) throw publicationUpsert.error;

    const runUpdate = await supabase
      .from('volume_forecast_runs')
      .update({
        status: 'succeeded',
        finished_at: new Date().toISOString(),
        recommendation_json: {
          scope: 'version',
          key: recommendedVersion?.key ?? null,
          label: recommendedVersion?.label ?? null,
          forecast_value: recommendedVersion?.forecastValue ?? null
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', runId);
    if (runUpdate.error) throw runUpdate.error;

    res.status(200).json({
      status: 'ok',
      run_id: runId,
      target_date: targetDate,
      cutoff_mode: MAIN_LEADERBOARD_CUTOFF,
      recommended_version: recommendedVersion,
      model_candidates: modelCandidates.length,
      version_candidates: versionCandidates.length
    });
  } catch (err: any) {
    if (runId !== null) {
      await supabase
        .from('volume_forecast_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: err?.message ?? String(err),
          updated_at: new Date().toISOString()
        })
        .eq('id', runId);
    }
    res.status(500).json({ error: err?.message ?? String(err) });
  }
}
