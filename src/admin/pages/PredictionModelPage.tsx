import { useEffect, useMemo, useState } from 'react';
import StyledDateInput from '../components/StyledDateInput';
import { getIsoWeekday } from '../forecast';

type TranslateFn = (zh: string, en: string) => string;

type PredictionModelPageProps = {
  t: TranslateFn;
  isLocked: boolean;
  serverTime: Date;
  supabase: any;
  themeMode: 'light' | 'dark';
};

type VolumeHistoryRow = {
  date: string;
  last_filled_hour?: number | null;
  h00?: number | null;
  h01?: number | null;
  h02?: number | null;
  h03?: number | null;
  h04?: number | null;
  h05?: number | null;
  h06?: number | null;
  h07?: number | null;
  h08?: number | null;
  h09?: number | null;
  h10?: number | null;
  h11?: number | null;
  h12?: number | null;
  h13?: number | null;
  h14?: number | null;
  h15?: number | null;
  h16?: number | null;
  h17?: number | null;
  h18?: number | null;
  h19?: number | null;
  h20?: number | null;
  h21?: number | null;
  h22?: number | null;
  h23?: number | null;
};

type ForecastInputRow = {
  input_date: string;
  weekday?: number | null;
  previous_day_backlog?: number | null;
  current_cumulative_volume_12?: number | null;
  inventory_level?: number | null;
  severe_weather?: boolean | null;
  full_day_capacity?: number | null;
  yesterday_inflow_00_14?: number | null;
};

type FeatureContextDay = {
  date: string;
  weekday: number;
  previous_day_backlog: number;
  current_cumulative_volume_12: number;
  inventory_level: number;
  severe_weather: boolean;
  full_day_capacity: number;
  yesterday_inflow_00_14: number;
};

type PreparedDay = {
  date: string;
  weekday: number;
  total: number;
  history: VolumeHistoryRow;
  input: ForecastInputRow | null;
  context: FeatureContextDay;
};

type ModelKey = 'same_weekday_median' | 'rolling_mean_7' | 'trend_blend' | 'feature_regression_v1';
type ModelForecastMap = Record<ModelKey, number | null>;

type EvaluationRow = {
  date: string;
  weekday: number;
  actual: number;
  forecasts: ModelForecastMap;
  bestModel: string;
};

type ModelMetric = {
  key: ModelKey;
  label: string;
  samples: number;
  wape: number | null;
  mape: number | null;
  rmse: number | null;
  targetForecast: number | null;
};

const HISTORY_TABLE = 'volume_history';
const INPUT_TABLE = 'volume_forecast_daily_inputs';
const HOUR_COLUMNS = Array.from({ length: 24 }, (_, idx) => `h${String(idx).padStart(2, '0')}`) as Array<
  Exclude<keyof VolumeHistoryRow, 'date' | 'last_filled_hour'>
>;
const FEATURE_NAMES = [
  'same_weekday_mean_4',
  'same_weekday_median_4',
  'rolling_mean_7',
  'rolling_mean_14',
  'previous_day_total',
  'previous_vs_recent14',
  'previous_day_backlog',
  'inventory_level',
  'full_day_capacity',
  'yesterday_inflow_00_14',
  'severe_weather',
  'backlog_to_inventory',
  'capacity_vs_recent14',
  'has_backlog',
  'has_inventory',
  'has_capacity',
  'has_yesterday_flow'
] as const;

type FeatureName = (typeof FEATURE_NAMES)[number];
type FeatureVector = Record<FeatureName, number>;
type FeatureSample = { features: FeatureVector; target: number };
type TrainedFeatureModel = {
  bias: number;
  weights: number[];
  means: number[];
  stds: number[];
  sampleSize: number;
};

const MODEL_KEYS: ModelKey[] = ['same_weekday_median', 'rolling_mean_7', 'trend_blend', 'feature_regression_v1'];
const MODEL_LABELS: Record<ModelKey, string> = {
  same_weekday_median: 'Same Weekday Median',
  rolling_mean_7: '7-Day Mean',
  trend_blend: 'Trend Blend',
  feature_regression_v1: 'Feature Regression V1'
};
const FEATURE_LABELS: Record<FeatureName, string> = {
  same_weekday_mean_4: 'Same weekday mean (4)',
  same_weekday_median_4: 'Same weekday median (4)',
  rolling_mean_7: 'Rolling mean 7D',
  rolling_mean_14: 'Rolling mean 14D',
  previous_day_total: 'Previous day total',
  previous_vs_recent14: 'Prev vs 14D mean',
  previous_day_backlog: 'Backlog',
  inventory_level: 'Inventory',
  full_day_capacity: 'Capacity',
  yesterday_inflow_00_14: 'Yesterday 00-14',
  severe_weather: 'Severe weather',
  backlog_to_inventory: 'Backlog / inventory',
  capacity_vs_recent14: 'Capacity / 14D mean',
  has_backlog: 'Has backlog',
  has_inventory: 'Has inventory',
  has_capacity: 'Has capacity',
  has_yesterday_flow: 'Has yesterday 00-14'
};

const toDateOnly = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const addDays = (dateOnly: string, shift: number) => {
  const next = new Date(`${dateOnly}T00:00:00`);
  next.setDate(next.getDate() + shift);
  return toDateOnly(next);
};

const formatNumber = (value: number | null, digits = 0) => {
  if (value === null || Number.isNaN(value)) return '-';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
};

const formatPercent = (value: number | null, digits = 1) => {
  if (value === null || !Number.isFinite(value)) return '-';
  return `${(value * 100).toFixed(digits)}%`;
};

const mean = (values: number[]) => {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const clamp = (value: number, lower: number, upper: number) => Math.min(Math.max(value, lower), upper);
const sanitizeNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sumHistoryRow = (row: VolumeHistoryRow) => HOUR_COLUMNS.reduce((sum, key) => sum + Math.max(0, sanitizeNumber(row[key])), 0);

const createFeatureContext = (date: string, input: ForecastInputRow | null): FeatureContextDay => ({
  date,
  weekday: Number(input?.weekday ?? getIsoWeekday(new Date(`${date}T00:00:00`))),
  previous_day_backlog: Math.max(0, sanitizeNumber(input?.previous_day_backlog)),
  current_cumulative_volume_12: Math.max(0, sanitizeNumber(input?.current_cumulative_volume_12)),
  inventory_level: Math.max(0, sanitizeNumber(input?.inventory_level)),
  severe_weather: Boolean(input?.severe_weather),
  full_day_capacity: Math.max(0, sanitizeNumber(input?.full_day_capacity)),
  yesterday_inflow_00_14: Math.max(0, sanitizeNumber(input?.yesterday_inflow_00_14))
});

const buildBaselinePredictions = (targetDate: string, priorDays: PreparedDay[]): Omit<ModelForecastMap, 'feature_regression_v1'> => {
  const weekday = getIsoWeekday(new Date(`${targetDate}T00:00:00`));
  const sameWeekdayTotals = priorDays.filter((day) => day.weekday === weekday).slice(-4).map((day) => day.total);
  const rolling7Totals = priorDays.slice(-7).map((day) => day.total);
  const sameWeekdayMedian = median(sameWeekdayTotals);
  const rollingMean7 = mean(rolling7Totals);
  const trendBlend =
    sameWeekdayMedian !== null && rollingMean7 !== null
      ? sameWeekdayMedian * 0.55 + rollingMean7 * 0.45
      : sameWeekdayMedian ?? rollingMean7;

  return {
    same_weekday_median: sameWeekdayMedian,
    rolling_mean_7: rollingMean7,
    trend_blend: trendBlend
  };
};

const buildFeatureVector = (targetDay: FeatureContextDay, priorDays: PreparedDay[]): FeatureVector | null => {
  if (priorDays.length < 14) return null;
  const previousDay = priorDays[priorDays.length - 1];
  const recent7 = priorDays.slice(-7).map((day) => day.total);
  const recent14 = priorDays.slice(-14).map((day) => day.total);
  const sameWeekday = priorDays.filter((day) => day.weekday === targetDay.weekday).slice(-4).map((day) => day.total);
  const rollingMean7 = mean(recent7) ?? previousDay.total;
  const rollingMean14 = mean(recent14) ?? rollingMean7;
  const sameWeekdayMean4 = mean(sameWeekday) ?? rollingMean14;
  const sameWeekdayMedian4 = median(sameWeekday) ?? sameWeekdayMean4;
  const previousVsRecent14 = rollingMean14 > 0 ? previousDay.total / rollingMean14 - 1 : 0;
  const backlogToInventory = targetDay.inventory_level > 0 ? targetDay.previous_day_backlog / targetDay.inventory_level : 0;
  const capacityVsRecent14 = rollingMean14 > 0 ? targetDay.full_day_capacity / rollingMean14 : 0;

  return {
    same_weekday_mean_4: sameWeekdayMean4,
    same_weekday_median_4: sameWeekdayMedian4,
    rolling_mean_7: rollingMean7,
    rolling_mean_14: rollingMean14,
    previous_day_total: previousDay.total,
    previous_vs_recent14: clamp(previousVsRecent14, -3, 3),
    previous_day_backlog: targetDay.previous_day_backlog,
    inventory_level: targetDay.inventory_level,
    full_day_capacity: targetDay.full_day_capacity,
    yesterday_inflow_00_14: targetDay.yesterday_inflow_00_14,
    severe_weather: targetDay.severe_weather ? 1 : 0,
    backlog_to_inventory: clamp(backlogToInventory, 0, 10),
    capacity_vs_recent14: clamp(capacityVsRecent14, 0, 10),
    has_backlog: targetDay.previous_day_backlog > 0 ? 1 : 0,
    has_inventory: targetDay.inventory_level > 0 ? 1 : 0,
    has_capacity: targetDay.full_day_capacity > 0 ? 1 : 0,
    has_yesterday_flow: targetDay.yesterday_inflow_00_14 > 0 ? 1 : 0
  };
};

const buildTrainingSamples = (cutoffDate: string, days: PreparedDay[], lookbackDays = 160) => {
  const candidateDays = days.filter((day) => day.date < cutoffDate).slice(-lookbackDays);
  return candidateDays.reduce<FeatureSample[]>((samples, day) => {
    const priorDays = days.filter((prior) => prior.date < day.date).slice(-lookbackDays);
    const features = buildFeatureVector(day.context, priorDays);
    if (features) samples.push({ features, target: day.total });
    return samples;
  }, []);
};

const trainFeatureRegression = (samples: FeatureSample[]): TrainedFeatureModel | null => {
  if (samples.length < 18) return null;
  const means = FEATURE_NAMES.map((name) => mean(samples.map((sample) => sample.features[name])) ?? 0);
  const stds = FEATURE_NAMES.map((name, index) => {
    const base = means[index];
    const variance = mean(samples.map((sample) => (sample.features[name] - base) ** 2)) ?? 0;
    return Math.sqrt(Math.max(variance, 1e-6)) || 1;
  });

  let bias = mean(samples.map((sample) => sample.target)) ?? 0;
  let weights = Array.from({ length: FEATURE_NAMES.length }, () => 0);
  const learningRate = 0.03;
  const l2 = 0.04;
  const scale = 2 / samples.length;

  for (let iteration = 0; iteration < 320; iteration += 1) {
    const biasGradient = samples.reduce((sum, sample) => {
      const prediction = bias + FEATURE_NAMES.reduce((inner, name, index) => {
        const normalized = (sample.features[name] - means[index]) / stds[index];
        return inner + normalized * weights[index];
      }, 0);
      return sum + (prediction - sample.target);
    }, 0);

    const weightGradients = FEATURE_NAMES.map((name, index) =>
      samples.reduce((sum, sample) => {
        const prediction = bias + FEATURE_NAMES.reduce((inner, innerName, innerIndex) => {
          const normalized = (sample.features[innerName] - means[innerIndex]) / stds[innerIndex];
          return inner + normalized * weights[innerIndex];
        }, 0);
        const normalized = (sample.features[name] - means[index]) / stds[index];
        return sum + (prediction - sample.target) * normalized;
      }, 0)
    );

    bias -= learningRate * scale * biasGradient;
    weights = weights.map((weight, index) => weight - learningRate * (scale * weightGradients[index] + l2 * weight));
  }

  return { bias, weights, means, stds, sampleSize: samples.length };
};

const predictFeatureRegression = (model: TrainedFeatureModel | null, vector: FeatureVector | null) => {
  if (!model || !vector) return null;
  const rawPrediction = model.bias + FEATURE_NAMES.reduce((sum, name, index) => {
    const normalized = (vector[name] - model.means[index]) / model.stds[index];
    return sum + normalized * model.weights[index];
  }, 0);

  const anchors = [vector.same_weekday_mean_4, vector.rolling_mean_7, vector.rolling_mean_14, vector.previous_day_total].filter((value) => value > 0);
  const anchor = mean(anchors) ?? rawPrediction;
  const safePrediction = Number.isFinite(rawPrediction) ? rawPrediction : anchor;
  const lowerBound = Math.max(0, anchor * 0.35);
  const upperBound = Math.max(lowerBound + 1, anchor * 1.85);
  return clamp(Math.max(0, safePrediction), lowerBound, upperBound);
};

const buildMetric = (rows: EvaluationRow[], key: ModelKey, targetForecast: number | null): ModelMetric => {
  const validRows = rows.filter((row) => row.forecasts[key] !== null);
  const totalActual = validRows.reduce((sum, row) => sum + row.actual, 0);
  const totalAbsError = validRows.reduce((sum, row) => sum + Math.abs((row.forecasts[key] ?? 0) - row.actual), 0);
  const mapeRows = validRows.filter((row) => row.actual > 0);
  const wape = totalActual > 0 ? totalAbsError / totalActual : null;
  const mape = mapeRows.length
    ? mapeRows.reduce((sum, row) => sum + Math.abs(((row.forecasts[key] ?? 0) - row.actual) / row.actual), 0) / mapeRows.length
    : null;
  const rmse = validRows.length
    ? Math.sqrt(validRows.reduce((sum, row) => sum + ((row.forecasts[key] ?? 0) - row.actual) ** 2, 0) / validRows.length)
    : null;

  return {
    key,
    label: MODEL_LABELS[key],
    samples: validRows.length,
    wape,
    mape,
    rmse,
    targetForecast
  };
};

function MetricCard({
  label,
  value,
  hint,
  themeMode
}: {
  label: string;
  value: string;
  hint?: string;
  themeMode: 'light' | 'dark';
}) {
  const isLight = themeMode === 'light';
  return (
    <div
      className={[
        'rounded-[24px] border px-5 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)]',
        isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/40'
      ].join(' ')}
    >
      <div className={['text-[11px] uppercase tracking-[0.22em]', isLight ? 'text-slate-500' : 'text-white/55'].join(' ')}>{label}</div>
      <div className={['mt-3 text-2xl font-semibold tracking-[0.04em]', isLight ? 'text-slate-900' : 'text-white'].join(' ')}>{value}</div>
      {hint ? <div className={['mt-2 text-sm', isLight ? 'text-slate-500' : 'text-white/60'].join(' ')}>{hint}</div> : null}
    </div>
  );
}

export default function PredictionModelPage({ t, isLocked, serverTime, supabase, themeMode }: PredictionModelPageProps) {
  const isLight = themeMode === 'light';
  const today = toDateOnly(serverTime);
  const [historyRangeStart, setHistoryRangeStart] = useState(addDays(today, -119));
  const [historyRangeEnd, setHistoryRangeEnd] = useState(today);
  const [forecastTargetDate, setForecastTargetDate] = useState(addDays(today, 1));
  const [historyRows, setHistoryRows] = useState<VolumeHistoryRow[]>([]);
  const [inputRows, setInputRows] = useState<ForecastInputRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      const minDate = [historyRangeStart, forecastTargetDate].sort()[0];
      const sortedMaxDates = [historyRangeEnd, forecastTargetDate].sort();
      const maxDate = sortedMaxDates[sortedMaxDates.length - 1] ?? historyRangeEnd;
      const preloadStart = addDays(minDate, -200);

      const [historyResult, inputResult] = await Promise.all([
        supabase
          .from(HISTORY_TABLE)
          .select('date,last_filled_hour,h00,h01,h02,h03,h04,h05,h06,h07,h08,h09,h10,h11,h12,h13,h14,h15,h16,h17,h18,h19,h20,h21,h22,h23')
          .gte('date', preloadStart)
          .lte('date', maxDate)
          .order('date', { ascending: true }),
        supabase
          .from(INPUT_TABLE)
          .select(
            'input_date,weekday,previous_day_backlog,current_cumulative_volume_12,inventory_level,severe_weather,full_day_capacity,yesterday_inflow_00_14'
          )
          .gte('input_date', preloadStart)
          .lte('input_date', maxDate)
          .order('input_date', { ascending: true })
      ]);

      if (cancelled) return;
      if (historyResult.error) {
        setError(historyResult.error.message);
        setLoading(false);
        return;
      }
      if (inputResult.error) {
        setError(inputResult.error.message);
        setLoading(false);
        return;
      }

      setHistoryRows(((historyResult.data ?? []) as VolumeHistoryRow[]).map((row) => ({ ...row })));
      setInputRows(((inputResult.data ?? []) as ForecastInputRow[]).map((row) => ({ ...row })));
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [forecastTargetDate, historyRangeEnd, historyRangeStart, supabase]);

  const data = useMemo(() => {
    const inputByDate = new Map(inputRows.map((row) => [row.input_date, row]));
    const fullHistoryDays = historyRows
      .filter((row) => Number(row.last_filled_hour ?? -1) >= 23)
      .map<PreparedDay>((row) => {
        const input = inputByDate.get(row.date) ?? null;
        const context = createFeatureContext(row.date, input);
        return {
          date: row.date,
          weekday: context.weekday,
          total: sumHistoryRow(row),
          history: row,
          input,
          context
        };
      });

    const analysisDays = fullHistoryDays.filter((day) => day.date >= historyRangeStart && day.date <= historyRangeEnd);
    const planningCoverageDays = analysisDays.filter((day) => {
      const context = day.context;
      return (
        context.previous_day_backlog > 0 ||
        context.inventory_level > 0 ||
        context.full_day_capacity > 0 ||
        context.yesterday_inflow_00_14 > 0 ||
        context.severe_weather
      );
    });

    const evaluationRows = analysisDays.reduce<EvaluationRow[]>((rows, day) => {
      const priorDays = fullHistoryDays.filter((prior) => prior.date < day.date);
      if (priorDays.length < 14) return rows;
      const baselinePredictions = buildBaselinePredictions(day.date, priorDays);
      const featureVector = buildFeatureVector(day.context, priorDays);
      const featureModel = trainFeatureRegression(buildTrainingSamples(day.date, fullHistoryDays));
      const featureForecast = predictFeatureRegression(featureModel, featureVector);
      const forecasts: ModelForecastMap = {
        ...baselinePredictions,
        feature_regression_v1: featureForecast
      };

      const bestModel =
        MODEL_KEYS.map((key) => ({
          key,
          label: MODEL_LABELS[key],
          error: forecasts[key] === null ? Number.POSITIVE_INFINITY : Math.abs((forecasts[key] ?? 0) - day.total)
        }))
          .filter((item) => Number.isFinite(item.error))
          .sort((a, b) => a.error - b.error)[0]?.label ?? '-';

      rows.push({
        date: day.date,
        weekday: day.weekday,
        actual: day.total,
        forecasts,
        bestModel
      });
      return rows;
    }, []);

    const targetInput = inputByDate.get(forecastTargetDate) ?? null;
    const targetContext = createFeatureContext(forecastTargetDate, targetInput);
    const targetPriorDays = fullHistoryDays.filter((day) => day.date < forecastTargetDate);
    const targetBaselines = buildBaselinePredictions(forecastTargetDate, targetPriorDays);
    const targetFeatureModel = trainFeatureRegression(buildTrainingSamples(forecastTargetDate, fullHistoryDays));
    const targetFeatureVector = buildFeatureVector(targetContext, targetPriorDays);
    const targetForecasts: ModelForecastMap = {
      ...targetBaselines,
      feature_regression_v1: predictFeatureRegression(targetFeatureModel, targetFeatureVector)
    };

    const leaderboard = MODEL_KEYS.map((key) => buildMetric(evaluationRows, key, targetForecasts[key])).sort((a, b) => {
      if (a.wape === null) return 1;
      if (b.wape === null) return -1;
      return a.wape - b.wape;
    });

    const baselineMetrics = leaderboard.filter((metric) => metric.key !== 'feature_regression_v1');
    const bestBaselineMetric = baselineMetrics[0] ?? null;
    const featureMetric = leaderboard.find((metric) => metric.key === 'feature_regression_v1') ?? null;
    const bestMetric = leaderboard[0] ?? null;
    const featureImportanceRows =
      targetFeatureModel === null
        ? []
        : FEATURE_NAMES.map((name, index) => ({
            feature: FEATURE_LABELS[name],
            weight: targetFeatureModel.weights[index],
            importance: Math.abs(targetFeatureModel.weights[index])
          }))
            .sort((a, b) => b.importance - a.importance)
            .slice(0, 8);
    const importanceSum = featureImportanceRows.reduce((sum, row) => sum + row.importance, 0);

    return {
      analysisDays,
      planningCoverageDays,
      evaluationRows,
      targetInput,
      targetForecasts,
      targetFeatureModel,
      featureImportanceRows: featureImportanceRows.map((row) => ({
        ...row,
        importanceRatio: importanceSum > 0 ? row.importance / importanceSum : 0
      })),
      leaderboard,
      bestMetric,
      bestBaselineMetric,
      featureMetric,
      improvementVsBaseline:
        featureMetric !== null && featureMetric.wape !== null && bestBaselineMetric !== null && bestBaselineMetric.wape !== null
          ? bestBaselineMetric.wape - featureMetric.wape
          : null
    };
  }, [forecastTargetDate, historyRangeEnd, historyRangeStart, historyRows, inputRows]);

  const panelClass = isLight ? 'border border-slate-200 bg-white shadow-[0_16px_36px_rgba(15,23,42,0.06)]' : 'border border-white/10 bg-black/20';
  const subPanelClass = isLight ? 'border border-slate-200 bg-white/90' : 'border border-white/10 bg-slate-950/30';
  const tableHeaderClass = isLight ? 'bg-slate-100/80 text-slate-600' : 'bg-white/5 text-white/60';
  const cellClass = isLight ? 'border-slate-200 text-slate-800' : 'border-white/10 text-white/85';
  const mutedClass = isLight ? 'text-slate-500' : 'text-white/60';
  const titleClass = isLight ? 'text-slate-900' : 'text-white';
  const statusBadgeClass = isLight ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-200';
  const messageClass = isLight ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-white/10 bg-white/5 text-white/65';
  const coverage = data.analysisDays.length ? data.planningCoverageDays.length / data.analysisDays.length : null;
  const bestVersionLabel =
    data.featureMetric !== null &&
    data.featureMetric.wape !== null &&
    data.bestBaselineMetric !== null &&
    data.bestBaselineMetric.wape !== null &&
    data.featureMetric.wape <= data.bestBaselineMetric.wape
      ? 'V1'
      : 'V0';
  const recentRows = data.evaluationRows.slice(-14).reverse();

  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={['inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em]', statusBadgeClass].join(' ')}>
            {isLocked ? t('只读', 'Read only') : 'Phase 2'}
          </div>
          <h2 className={['mt-4 font-display text-3xl tracking-[0.06em]', titleClass].join(' ')}>{t('预测模型', 'Prediction Model')}</h2>
          <p className={['mt-2 max-w-3xl text-sm leading-6', mutedClass].join(' ')}>
            {t(
              '用现有 volume_history 和计划输入字段，回测“预测明天流入”模型，并比较 baseline 与特征回归版本。',
              'Use current volume history and planning inputs to backtest tomorrow inbound forecasts and compare baselines against a feature regression version.'
            )}
          </p>
        </div>
        <div className={['rounded-[24px] px-4 py-3 text-sm', messageClass].join(' ')}>
          <div>{t('目标', 'Target')}: {t('预测明天总流入单量', 'Predict tomorrow total inbound volume')}</div>
          <div className="mt-1">{t('限制', 'Rule')}: {t('12点累计量只展示，不参与 next-day 训练。', '12:00 cumulative is displayed only and excluded from next-day training.')}</div>
        </div>
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('分析窗口', 'Analysis window')}</div>
              <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{historyRangeStart} to {historyRangeEnd}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StyledDateInput
                value={historyRangeStart}
                onChange={(value) => {
                  setHistoryRangeStart(value);
                  if (value > historyRangeEnd) setHistoryRangeEnd(value);
                }}
                themeMode={themeMode}
                disabled={isLocked}
                max={historyRangeEnd}
              />
              <span className={mutedClass}>to</span>
              <StyledDateInput
                value={historyRangeEnd}
                onChange={(value) => {
                  setHistoryRangeEnd(value);
                  if (value < historyRangeStart) setHistoryRangeStart(value);
                }}
                themeMode={themeMode}
                disabled={isLocked}
                min={historyRangeStart}
                max={forecastTargetDate}
              />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('预测目标日', 'Target forecast day')}</div>
            <StyledDateInput
              value={forecastTargetDate}
              onChange={(value) => {
                setForecastTargetDate(value);
                if (value < historyRangeEnd) setHistoryRangeEnd(value);
              }}
              themeMode={themeMode}
              disabled={isLocked}
              min={historyRangeStart}
            />
          </div>
        </div>

        <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
          <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('当前版本', 'Current versions')}</div>
          <div className="mt-4 grid gap-3">
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V0 Baseline Pack</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>{data.bestBaselineMetric ? `${data.bestBaselineMetric.label} champion` : t('样本不足', 'Not enough samples')}</div>
            </div>
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V1 Feature Regression</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.targetFeatureModel ? `${formatNumber(data.targetFeatureModel.sampleSize)} ${t('个训练样本', 'training samples')}` : t('样本不足，尚未训练。', 'Not enough samples to train yet.')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t('完整历史日', 'Complete days')}
          value={formatNumber(data.analysisDays.length)}
          hint={t('仅统计 last_filled_hour >= 23', 'Only days with last_filled_hour >= 23')}
          themeMode={themeMode}
        />
        <MetricCard
          label={t('计划字段覆盖率', 'Planning coverage')}
          value={formatPercent(coverage, 0)}
          hint={t('backlog / inventory / capacity / weather / yesterday 00-14', 'backlog / inventory / capacity / weather / yesterday 00-14')}
          themeMode={themeMode}
        />
        <MetricCard
          label={t('最佳版本', 'Best version')}
          value={bestVersionLabel}
          hint={data.bestMetric ? `${data.bestMetric.label} • WAPE ${formatPercent(data.bestMetric.wape)}` : '-'}
          themeMode={themeMode}
        />
        <MetricCard
          label={t('目标日预测', 'Target forecast')}
          value={formatNumber(data.bestMetric?.targetForecast ?? null)}
          hint={`${forecastTargetDate} • ${data.bestMetric?.label ?? '-'}`}
          themeMode={themeMode}
        />
      </div>

      {error ? (
        <div
          className={[
            'mt-6 rounded-2xl border px-4 py-3 text-sm',
            isLight ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          ].join(' ')}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className={['mt-6 rounded-[28px] border px-5 py-10 text-center text-sm', messageClass].join(' ')}>
          {t('正在加载模型工作台...', 'Loading model workbench...')}
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('版本对比', 'Version comparison')}</div>
                  <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{t('Baseline vs Feature Model', 'Baseline vs Feature Model')}</div>
                </div>
                <div className={['text-sm', mutedClass].join(' ')}>
                  {data.improvementVsBaseline === null
                    ? t('等待足够样本', 'Waiting for enough samples')
                    : data.improvementVsBaseline >= 0
                      ? `${t('V1 优于 baseline', 'V1 beats baseline')} ${formatPercent(data.improvementVsBaseline)}`
                      : `${t('V1 落后 baseline', 'V1 trails baseline')} ${formatPercent(Math.abs(data.improvementVsBaseline))}`}
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className={tableHeaderClass}>
                      <th className="rounded-l-2xl px-4 py-3 text-left font-semibold">Version</th>
                      <th className="px-4 py-3 text-left font-semibold">{t('冠军模型', 'Champion')}</th>
                      <th className="px-4 py-3 text-right font-semibold">WAPE</th>
                      <th className="rounded-r-2xl px-4 py-3 text-right font-semibold">{t('目标日预测', 'Target forecast')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={['border-b px-4 py-3 font-semibold', cellClass].join(' ')}>V0</td>
                      <td className={['border-b px-4 py-3', cellClass].join(' ')}>{data.bestBaselineMetric?.label ?? '-'}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(data.bestBaselineMetric?.wape ?? null)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(data.bestBaselineMetric?.targetForecast ?? null)}</td>
                    </tr>
                    <tr>
                      <td className={['px-4 py-3 font-semibold', cellClass].join(' ')}>V1</td>
                      <td className={['px-4 py-3', cellClass].join(' ')}>Feature Regression V1</td>
                      <td className={['px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(data.featureMetric?.wape ?? null)}</td>
                      <td className={['px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(data.featureMetric?.targetForecast ?? null)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('目标日输入快照', 'Target input snapshot')}</div>
              <div className="mt-4 grid gap-3">
                {[
                  { label: t('Backlog', 'Backlog'), value: data.targetInput?.previous_day_backlog ?? 0 },
                  { label: t('Inventory', 'Inventory'), value: data.targetInput?.inventory_level ?? 0 },
                  { label: t('Capacity', 'Capacity'), value: data.targetInput?.full_day_capacity ?? 0 },
                  { label: t('Yesterday 00-14', 'Yesterday 00-14'), value: data.targetInput?.yesterday_inflow_00_14 ?? 0 },
                  { label: t('Severe weather', 'Severe weather'), value: data.targetInput?.severe_weather ? t('是', 'Yes') : t('否', 'No') },
                  {
                    label: t('12点累计量', '12:00 cumulative'),
                    value: `${formatNumber(data.targetInput?.current_cumulative_volume_12 ?? 0)} ${t('(仅展示，不训练)', '(display only, excluded)')}`
                  }
                ].map((item) => (
                  <div key={item.label} className={['flex items-center justify-between rounded-2xl px-4 py-3', subPanelClass].join(' ')}>
                    <div className={mutedClass}>{item.label}</div>
                    <div className={['font-semibold', titleClass].join(' ')}>
                      {typeof item.value === 'number' ? formatNumber(item.value) : item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('模型排行榜', 'Model leaderboard')}</div>
                  <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{t('时间序列回测', 'Time-series backtest')}</div>
                </div>
                <div className={['text-sm', mutedClass].join(' ')}>{formatNumber(data.evaluationRows.length)} {t('个可评估样本日', 'evaluation days')}</div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className={tableHeaderClass}>
                      <th className="rounded-l-2xl px-4 py-3 text-left font-semibold">Model</th>
                      <th className="px-4 py-3 text-right font-semibold">{t('样本数', 'Samples')}</th>
                      <th className="px-4 py-3 text-right font-semibold">WAPE</th>
                      <th className="px-4 py-3 text-right font-semibold">MAPE</th>
                      <th className="rounded-r-2xl px-4 py-3 text-right font-semibold">RMSE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaderboard.map((metric, index) => (
                      <tr key={metric.key}>
                        <td className={['border-b px-4 py-3', cellClass].join(' ')}>
                          <div className="flex items-center gap-3">
                            <span
                              className={[
                                'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold',
                                isLight ? 'bg-slate-100 text-slate-700' : 'bg-white/10 text-white/70'
                              ].join(' ')}
                            >
                              {index + 1}
                            </span>
                            <span className="font-semibold">{metric.label}</span>
                          </div>
                        </td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(metric.samples)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.wape)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.mape)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(metric.rmse)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('Feature Regression V1', 'Feature Regression V1')}</div>
              <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{t('特征权重快照', 'Feature weight snapshot')}</div>
              <p className={['mt-2 text-sm leading-6', mutedClass].join(' ')}>
                {t(
                  'V1 用最近趋势、同星期几表现、backlog / inventory / capacity / weather 等特征做 next-day 预测。',
                  'V1 uses recent trend, same-weekday behavior, backlog / inventory / capacity / weather and related features for next-day prediction.'
                )}
              </p>
              {data.featureImportanceRows.length ? (
                <div className="mt-4 space-y-3">
                  {data.featureImportanceRows.map((row) => (
                    <div key={row.feature} className={['rounded-2xl px-4 py-3', subPanelClass].join(' ')}>
                      <div className="flex items-center justify-between gap-3">
                        <div className={titleClass}>{row.feature}</div>
                        <div className={['text-sm font-semibold', titleClass].join(' ')}>{formatPercent(row.importanceRatio, 0)}</div>
                      </div>
                      <div className={['mt-2 h-2 rounded-full', isLight ? 'bg-slate-100' : 'bg-white/10'].join(' ')}>
                        <div
                          className={['h-2 rounded-full', isLight ? 'bg-lime-500' : 'bg-neon'].join(' ')}
                          style={{ width: `${Math.max(6, row.importanceRatio * 100)}%` }}
                        />
                      </div>
                      <div className={['mt-2 text-xs', mutedClass].join(' ')}>{t('系数', 'Weight')}: {row.weight.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={['mt-4 rounded-2xl border px-4 py-4 text-sm', messageClass].join(' ')}>
                  {t('当前完整样本还不够，V1 暂时不展示特征权重。', 'Not enough complete samples yet to show V1 feature weights.')}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('最近回测明细', 'Recent backtest rows')}</div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className={tableHeaderClass}>
                      <th className="rounded-l-2xl px-4 py-3 text-left font-semibold">{t('日期', 'Date')}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t('星期', 'Weekday')}</th>
                      <th className="px-4 py-3 text-right font-semibold">{t('实际', 'Actual')}</th>
                      <th className="px-4 py-3 text-right font-semibold">SWM</th>
                      <th className="px-4 py-3 text-right font-semibold">7D</th>
                      <th className="px-4 py-3 text-right font-semibold">Blend</th>
                      <th className="px-4 py-3 text-right font-semibold">V1</th>
                      <th className="rounded-r-2xl px-4 py-3 text-left font-semibold">{t('最佳', 'Best')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.map((row) => (
                      <tr key={row.date}>
                        <td className={['border-b px-4 py-3', cellClass].join(' ')}>{row.date}</td>
                        <td className={['border-b px-4 py-3', cellClass].join(' ')}>{row.weekday}</td>
                        <td className={['border-b px-4 py-3 text-right font-semibold', cellClass].join(' ')}>{formatNumber(row.actual)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.same_weekday_median)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.rolling_mean_7)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.trend_blend)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.feature_regression_v1)}</td>
                        <td className={['border-b px-4 py-3', cellClass].join(' ')}>{row.bestModel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('建模规则', 'Modeling rules')}</div>
              <div className="mt-4 space-y-3">
                {[
                  t('只使用预测时点已经知道的数据。', 'Use only data known at prediction time.'),
                  t('12点累计量会导致 next-day 泄漏，所以只展示不训练。', '12:00 cumulative would leak next-day information, so it is displayed only and excluded from training.'),
                  t('评估方式是按时间滚动回测，不做随机切分。', 'Evaluation uses rolling time-series backtests, not random splits.'),
                  t('新版本必须先稳定优于 baseline，才值得进入正式流程。', 'A new version should consistently beat the baseline before it moves into the production flow.')
                ].map((item) => (
                  <div key={item} className={['rounded-2xl px-4 py-3 text-sm leading-6', subPanelClass, titleClass].join(' ')}>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
