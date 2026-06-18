import { buildPredictionWorkbenchData } from '../src/admin/pages/PredictionModelPage.tsx';
import { DEFAULT_CODE_VERSION, MAIN_LEADERBOARD_CUTOFF, addDaysDateOnly, readEnabledModels } from './_forecastShared.js';

type RunType = 'official' | 'manual' | 'backfill';
type FeedbackRegimeKey = 'transition_down' | 'promotion';
type FeedbackPublicationRow = {
  target_date: string;
  recommended_prediction_id?: number | null;
  selected_prediction_id?: number | null;
  published_forecast?: number | null;
  is_manual_override?: boolean | null;
  status?: string | null;
};
type FeedbackPredictionRow = {
  id: number;
  candidate_scope: 'model' | 'version';
  candidate_key: string;
  forecast_value: number;
};
type WorkbenchMetric = {
  key: string;
  label: string;
  samples: number;
  targetForecast: number | null;
};
type WorkbenchEvaluationRow = {
  date: string;
  actual: number;
  forecasts: Record<string, number | null>;
};
type WorkbenchSelectorEvaluationRow = {
  date: string;
  regimeKey: string;
};
type PredictionWorkbenchData = ReturnType<typeof buildPredictionWorkbenchData> & {
  leaderboard: WorkbenchMetric[];
  versionLeaderboard: WorkbenchMetric[];
  evaluationRows: WorkbenchEvaluationRow[];
  versionEvaluationRows: WorkbenchEvaluationRow[];
  selectorEvaluationRows: WorkbenchSelectorEvaluationRow[];
};
type VersionCandidate = {
  scope: 'version';
  key: string;
  label: string;
  forecastValue: number;
  trainingSamples: number;
  metrics: {
    samples: number;
    wape: number | null;
    mape: number | null;
    rmse: number | null;
    within1HitRate: number | null;
    within2HitRate: number | null;
    within3HitRate: number | null;
    p90AbsVariance: number | null;
    worstAbsVariance: number | null;
    recent14Wape: number | null;
    recent14Mape: number | null;
    recent14Rmse: number | null;
  };
  feedback?: {
    regimeKey: FeedbackRegimeKey;
    regimeSamples: number;
    selectedCount: number;
    selectedShare: number;
    qualified: boolean;
    promoted: boolean;
  } | null;
  recommendationReason?: 'historical_metrics' | 'human_feedback_boost';
};

const HISTORY_SELECT =
  'date,last_filled_hour,h00,h01,h02,h03,h04,h05,h06,h07,h08,h09,h10,h11,h12,h13,h14,h15,h16,h17,h18,h19,h20,h21,h22,h23';
const INPUT_SELECT =
  'input_date,weekday,previous_day_backlog,current_cumulative_volume_12,inventory_level,severe_weather,major_promotion,full_day_capacity,yesterday_inflow_00_14';
const FEEDBACK_REGIME_KEYS = new Set<FeedbackRegimeKey>(['transition_down', 'promotion']);
const FEEDBACK_MIN_SAMPLES = 6;
const FEEDBACK_MIN_SHARE = 0.5;
const FEEDBACK_BASE_RANK_LIMIT = 3;

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

const approxEqualForecast = (a: number | null | undefined, b: number | null | undefined) => {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false;
  const left = Number(a);
  const right = Number(b);
  const tolerance = Math.max(1, Math.abs(right) * 0.001);
  return Math.abs(left - right) <= tolerance;
};

const buildHumanFeedbackByRegime = ({
  publications,
  predictionsById,
  regimeByDate
}: {
  publications: FeedbackPublicationRow[];
  predictionsById: Map<number, FeedbackPredictionRow>;
  regimeByDate: Map<string, string>;
}) => {
  const totals = new Map<FeedbackRegimeKey, number>();
  const counts = new Map<FeedbackRegimeKey, Map<string, number>>();

  for (const publication of publications) {
    const regimeKey = regimeByDate.get(publication.target_date);
    if (!regimeKey || !FEEDBACK_REGIME_KEYS.has(regimeKey as FeedbackRegimeKey)) continue;
    if (!publication.is_manual_override) continue;
    const selectedPredictionId = Number(publication.selected_prediction_id ?? 0);
    if (!selectedPredictionId) continue;
    const selectedPrediction = predictionsById.get(selectedPredictionId);
    if (!selectedPrediction || selectedPrediction.candidate_scope !== 'version') continue;
    if (!approxEqualForecast(publication.published_forecast, selectedPrediction.forecast_value)) continue;

    const typedRegimeKey = regimeKey as FeedbackRegimeKey;
    totals.set(typedRegimeKey, (totals.get(typedRegimeKey) ?? 0) + 1);
    const regimeCounts = counts.get(typedRegimeKey) ?? new Map<string, number>();
    regimeCounts.set(selectedPrediction.candidate_key, (regimeCounts.get(selectedPrediction.candidate_key) ?? 0) + 1);
    counts.set(typedRegimeKey, regimeCounts);
  }

  return { totals, counts };
};

const applyHumanFeedbackBoost = ({
  candidates,
  regimeKey,
  feedback
}: {
  candidates: VersionCandidate[];
  regimeKey: string;
  feedback: ReturnType<typeof buildHumanFeedbackByRegime>;
}) => {
  const baseSorted = [...candidates].sort(compareRecommendation);
  if (!FEEDBACK_REGIME_KEYS.has(regimeKey as FeedbackRegimeKey)) {
    return baseSorted.map((candidate) => ({
      ...candidate,
      feedback: null,
      recommendationReason: 'historical_metrics' as const
    }));
  }

  const typedRegimeKey = regimeKey as FeedbackRegimeKey;
  const regimeSamples = feedback.totals.get(typedRegimeKey) ?? 0;
  const regimeCounts = feedback.counts.get(typedRegimeKey) ?? new Map<string, number>();
  const baseRankByKey = new Map(baseSorted.map((candidate, index) => [candidate.key, index]));

  const withFeedback = baseSorted.map((candidate) => {
    const selectedCount = regimeCounts.get(candidate.key) ?? 0;
    const selectedShare = regimeSamples > 0 ? selectedCount / regimeSamples : 0;
    const qualified = regimeSamples >= FEEDBACK_MIN_SAMPLES && selectedShare >= FEEDBACK_MIN_SHARE;
    const promoted = qualified && (baseRankByKey.get(candidate.key) ?? Number.POSITIVE_INFINITY) < FEEDBACK_BASE_RANK_LIMIT;
    return {
      ...candidate,
      feedback: {
        regimeKey: typedRegimeKey,
        regimeSamples,
        selectedCount,
        selectedShare,
        qualified,
        promoted
      },
      recommendationReason: 'historical_metrics' as const
    };
  });

  const boosted = [...withFeedback].sort((a, b) => {
    const aPromoted = a.feedback?.promoted ? 1 : 0;
    const bPromoted = b.feedback?.promoted ? 1 : 0;
    if (aPromoted !== bPromoted) return bPromoted - aPromoted;
    if (aPromoted && bPromoted) {
      const shareDiff = (b.feedback?.selectedShare ?? 0) - (a.feedback?.selectedShare ?? 0);
      if (shareDiff !== 0) return shareDiff;
      const countDiff = (b.feedback?.selectedCount ?? 0) - (a.feedback?.selectedCount ?? 0);
      if (countDiff !== 0) return countDiff;
    }
    return compareRecommendation(a, b);
  });

  return boosted.map((candidate, index) => ({
    ...candidate,
    recommendationReason:
      index === 0 && candidate.feedback?.promoted ? ('human_feedback_boost' as const) : ('historical_metrics' as const)
  }));
};

export const runForecast = async ({
  supabase,
  targetDate,
  runType
}: {
  supabase: any;
  targetDate: string;
  runType: RunType;
}) => {
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
    }) as PredictionWorkbenchData;

    const baseVersionCandidates: VersionCandidate[] = data.versionLeaderboard
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
      });

    const historicalPublicationsResult = await supabase
      .from('volume_forecast_publications')
      .select('target_date,recommended_prediction_id,selected_prediction_id,published_forecast,is_manual_override,status')
      .gte('target_date', historyRangeStart)
      .lte('target_date', historyRangeEnd)
      .eq('cutoff_mode', MAIN_LEADERBOARD_CUTOFF)
      .eq('status', 'published')
      .not('selected_prediction_id', 'is', null);
    if (historicalPublicationsResult.error) throw historicalPublicationsResult.error;

    const feedbackPredictionIds = Array.from(
      new Set(
        (((historicalPublicationsResult.data as FeedbackPublicationRow[] | null) ?? []) as FeedbackPublicationRow[])
          .flatMap((row) => [Number(row.selected_prediction_id ?? 0), Number(row.recommended_prediction_id ?? 0)])
          .filter((value) => value > 0)
      )
    );
    const feedbackPredictionsById = new Map<number, FeedbackPredictionRow>();
    if (feedbackPredictionIds.length > 0) {
      const feedbackPredictionsResult = await supabase
        .from('volume_forecast_predictions')
        .select('id,candidate_scope,candidate_key,forecast_value')
        .in('id', feedbackPredictionIds);
      if (feedbackPredictionsResult.error) throw feedbackPredictionsResult.error;
      (((feedbackPredictionsResult.data as FeedbackPredictionRow[] | null) ?? []) as FeedbackPredictionRow[]).forEach((row) => {
        feedbackPredictionsById.set(Number(row.id), {
          ...row,
          id: Number(row.id),
          forecast_value: Number(row.forecast_value ?? 0)
        });
      });
    }

    const regimeByDate = new Map(data.selectorEvaluationRows.map((row) => [row.date, row.regimeKey]));
    const humanFeedback = buildHumanFeedbackByRegime({
      publications: (((historicalPublicationsResult.data as FeedbackPublicationRow[] | null) ?? []) as FeedbackPublicationRow[]),
      predictionsById: feedbackPredictionsById,
      regimeByDate
    });

    const versionCandidates = applyHumanFeedbackBoost({
      candidates: baseVersionCandidates,
      regimeKey: data.regimeSnapshot.regimeKey,
      feedback: humanFeedback
    });

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

    const predictionIdByKey = new Map<string, number>(
      (
        (predictionInsert.data as Array<{ id?: number | string | null; candidate_scope?: string | null; candidate_key?: string | null }> | null) ??
        []
      ).map((row) => [`${row.candidate_scope}:${row.candidate_key}`, Number(row.id ?? 0)])
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
          forecast_value: recommendedVersion?.forecastValue ?? null,
          reason: recommendedVersion?.recommendationReason ?? 'historical_metrics',
          feedback: recommendedVersion?.feedback ?? null
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', runId);
    if (runUpdate.error) throw runUpdate.error;

    return {
      status: 'ok' as const,
      run_id: runId,
      target_date: targetDate,
      cutoff_mode: MAIN_LEADERBOARD_CUTOFF,
      recommended_version: recommendedVersion,
      recommendation_reason: recommendedVersion?.recommendationReason ?? 'historical_metrics',
      model_candidates: modelCandidates.length,
      version_candidates: versionCandidates.length
    };
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
    throw err;
  }
};
