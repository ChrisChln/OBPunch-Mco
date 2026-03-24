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
  major_promotion?: boolean | null;
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
  major_promotion: boolean;
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

type ModelKey =
  | 'same_weekday_median'
  | 'rolling_mean_7'
  | 'trend_blend'
  | 'feature_regression_v1'
  | 'feature_regression_v2'
  | 'feature_regression_v3'
  | 'feature_regression_v7';
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

type ChampionScoreRow = {
  key: ModelKey;
  label: string;
  samples: number;
  actualInbound: number | null;
  targetForecast: number | null;
  variance: number | null;
  score: number;
  toppingRate: number | null;
};

type BaseVersionKey = 'v0' | 'v1' | 'v2' | 'v3';
type VersionKey = BaseVersionKey | 'v4' | 'v4_ensemble' | 'v5' | 'v6' | 'v7';
type BaseVersionForecastMap = Record<BaseVersionKey, number | null>;
type VersionForecastMap = Record<VersionKey, number | null>;
type BaseVersionApeMap = Record<BaseVersionKey, number | null>;
type BaseVersionPointMap = Record<BaseVersionKey, number>;
type BaseVersionWeightMap = Record<BaseVersionKey, number>;

type VersionInputRow = {
  date: string;
  actual: number | null;
  forecasts: BaseVersionForecastMap;
};

type V4OutputRow = VersionInputRow & {
  apes: BaseVersionApeMap;
  dailyPoints: BaseVersionPointMap;
  rollingScores14: BaseVersionPointMap;
  rollingAverageErrors14: BaseVersionApeMap;
  championModel: BaseVersionKey | null;
  baseForecast: number | null;
  championBiasAverage7: number | null;
  adjustmentRate: number;
  v4Forecast: number | null;
  v4ErrorPct: number | null;
  ensembleWeights14: BaseVersionWeightMap;
  ensembleBaseForecast: number | null;
  ensembleBiasAverage7: number | null;
  ensembleAdjustmentRate: number;
  v4EnsembleForecast: number | null;
  v4EnsembleErrorPct: number | null;
};

type V5OutputRow = VersionInputRow & {
  apes: BaseVersionApeMap;
  dailyPoints: BaseVersionPointMap;
  rollingScores14: BaseVersionPointMap;
  rollingAverageErrors14: BaseVersionApeMap;
  championModel: BaseVersionKey | null;
  runnerUpModel: BaseVersionKey | null;
  blendMode: 'single' | 'blend' | 'fallback';
  recent14Wape: BaseVersionApeMap;
  blendWeights14: BaseVersionWeightMap;
  baseForecast: number | null;
  biasAverage7: number | null;
  adjustmentRate: number;
  v5Forecast: number | null;
  v5ErrorRate: number | null;
};

type V6OutputRow = VersionInputRow & {
  apes: BaseVersionApeMap;
  dailyPoints: BaseVersionPointMap;
  rollingScores14: BaseVersionPointMap;
  rollingAverageErrors14: BaseVersionApeMap;
  championModel: BaseVersionKey | null;
  runnerUpModel: BaseVersionKey | null;
  blendMode: 'single' | 'blend' | 'fallback';
  recent14Wape: BaseVersionApeMap;
  blendWeights14: BaseVersionWeightMap;
  baseForecast: number | null;
  recent3Bias: number | null;
  sameWeekdayBias: number | null;
  trendBias: number | null;
  adjustmentRate: number;
  v6Forecast: number | null;
  v6ErrorRate: number | null;
};

type VersionEvaluationRow = {
  date: string;
  actual: number;
  forecasts: VersionForecastMap;
};

type VersionMetricSlice = {
  samples: number;
  mape: number | null;
  wape: number | null;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
};

type VersionMetric = VersionMetricSlice & {
  key: VersionKey;
  label: string;
  targetForecast: number | null;
  recent14: VersionMetricSlice;
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

const FEATURE_NAMES_V2 = [
  'same_weekday_mean_4',
  'same_weekday_median_4',
  'rolling_mean_7',
  'rolling_mean_14',
  'previous_day_total',
  'previous_vs_recent14',
  'previous_day_itr',
  'recent_itr_mean_7',
  'same_weekday_itr_mean_4',
  'severe_weather'
] as const;

const FEATURE_NAMES_V3 = [
  'forecast_v1',
  'forecast_v2',
  'rolling_mean_7_model',
  'previous_day_total_ctx',
  'previous_vs_recent14_ctx',
  'recent_itr_mean_7_ctx',
  'severe_weather_ctx'
] as const;

const FEATURE_NAMES_V7 = [
  'forecast_v1',
  'forecast_v2',
  'forecast_v3',
  'rolling_mean_7_model',
  'previous_day_total_ctx',
  'previous_vs_recent14_ctx',
  'recent_itr_mean_7_ctx',
  'severe_weather_ctx',
  'major_promotion_ctx'
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

type FeatureNameV2 = (typeof FEATURE_NAMES_V2)[number];
type FeatureVectorV2 = Record<FeatureNameV2, number>;
type FeatureSampleV2 = { features: FeatureVectorV2; target: number };
type TrainedFeatureModelV2 = {
  bias: number;
  weights: number[];
  means: number[];
  stds: number[];
  sampleSize: number;
};

type FeatureNameV3 = (typeof FEATURE_NAMES_V3)[number];
type FeatureVectorV3 = Record<FeatureNameV3, number>;
type FeatureSampleV3 = { features: FeatureVectorV3; target: number };
type TrainedFeatureModelV3 = {
  bias: number;
  weights: number[];
  means: number[];
  stds: number[];
  sampleSize: number;
};

type FeatureNameV7 = (typeof FEATURE_NAMES_V7)[number];
type FeatureVectorV7 = Record<FeatureNameV7, number>;
type FeatureSampleV7 = { features: FeatureVectorV7; target: number };
type TrainedFeatureModelV7 = {
  bias: number;
  weights: number[];
  means: number[];
  stds: number[];
  sampleSize: number;
};

const MODEL_KEYS: ModelKey[] = [
  'same_weekday_median',
  'rolling_mean_7',
  'trend_blend',
  'feature_regression_v1',
  'feature_regression_v2',
  'feature_regression_v3',
  'feature_regression_v7'
];
const MODEL_LABELS: Record<ModelKey, string> = {
  same_weekday_median: 'Same Weekday Median',
  rolling_mean_7: '7-Day Mean',
  trend_blend: 'Trend Blend',
  feature_regression_v1: 'Feature Regression V1',
  feature_regression_v2: 'Feature Regression V2',
  feature_regression_v3: 'Feature Regression V3',
  feature_regression_v7: 'Feature Regression V7'
};
const BASE_VERSION_KEYS: BaseVersionKey[] = ['v0', 'v1', 'v2', 'v3'];
const BLEND_VERSION_KEYS: BaseVersionKey[] = ['v1', 'v2', 'v3'];
const VERSION_KEYS: VersionKey[] = [...BASE_VERSION_KEYS, 'v4', 'v4_ensemble', 'v5', 'v6', 'v7'];
const VERSION_LABELS: Record<VersionKey, string> = {
  v0: 'V0',
  v1: 'V1',
  v2: 'V2',
  v3: 'V3',
  v4: 'V4 Champion',
  v4_ensemble: 'V4 Ensemble',
  v5: 'V5 Adaptive Blend',
  v6: 'V6 Residual Blend',
  v7: 'V7 Promotion-Aware Model'
};
const VERSION_TIEBREAK_ORDER: BaseVersionKey[] = ['v3', 'v2', 'v1', 'v0'];
const DAILY_POINT_VALUES = [3, 2, 1, 0] as const;
const CURRENT_MODEL_WINDOW = 14;
const CURRENT_MODEL_MIN_SAMPLES = 10;
const CURRENT_BLEND_GAP = 0.01;
const RESIDUAL_CALIBRATION_CAP = 0.04;
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
const FEATURE_LABELS_V2: Record<FeatureNameV2, string> = {
  same_weekday_mean_4: 'Same weekday mean (4)',
  same_weekday_median_4: 'Same weekday median (4)',
  rolling_mean_7: 'Rolling mean 7D',
  rolling_mean_14: 'Rolling mean 14D',
  previous_day_total: 'Previous day total',
  previous_vs_recent14: 'Prev vs 14D mean',
  previous_day_itr: 'Previous day ITR',
  recent_itr_mean_7: 'Recent ITR mean 7D',
  same_weekday_itr_mean_4: 'Same weekday ITR mean (4)',
  severe_weather: 'Severe weather'
};
const FEATURE_LABELS_V3: Record<FeatureNameV3, string> = {
  forecast_v1: 'V1 forecast',
  forecast_v2: 'V2 forecast',
  rolling_mean_7_model: '7-day mean forecast',
  previous_day_total_ctx: 'Previous day total',
  previous_vs_recent14_ctx: 'Prev vs 14D mean',
  recent_itr_mean_7_ctx: 'Recent ITR mean 7D',
  severe_weather_ctx: 'Severe weather'
};

const FEATURE_LABELS_V7: Record<FeatureNameV7, string> = {
  forecast_v1: 'V1 forecast',
  forecast_v2: 'V2 forecast',
  forecast_v3: 'V3 forecast',
  rolling_mean_7_model: '7-day mean forecast',
  previous_day_total_ctx: 'Previous day total',
  previous_vs_recent14_ctx: 'Prev vs 14D mean',
  recent_itr_mean_7_ctx: 'Recent ITR mean 7D',
  severe_weather_ctx: 'Severe weather',
  major_promotion_ctx: 'Major promotion'
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

const formatSignedNumber = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return '-';
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '-'}${Math.abs(value).toLocaleString('en-US')}`;
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
const inferLastFilledHour = (row: Partial<Record<(typeof HOUR_COLUMNS)[number], number | null | undefined>>) => {
  for (let index = HOUR_COLUMNS.length - 1; index >= 0; index -= 1) {
    const hourKey = HOUR_COLUMNS[index];
    const value = Number(row[hourKey] ?? 0);
    if (value > 0) return index;
  }
  return null;
};
const getInventoryTurnoverRate = (day: PreparedDay) => {
  const inventoryLevel = day.context.inventory_level;
  if (inventoryLevel <= 0) return null;
  return day.total / inventoryLevel;
};

const createFeatureContext = (date: string, input: ForecastInputRow | null): FeatureContextDay => ({
  date,
  weekday: Number(input?.weekday ?? getIsoWeekday(new Date(`${date}T00:00:00`))),
  previous_day_backlog: Math.max(0, sanitizeNumber(input?.previous_day_backlog)),
  current_cumulative_volume_12: Math.max(0, sanitizeNumber(input?.current_cumulative_volume_12)),
  inventory_level: Math.max(0, sanitizeNumber(input?.inventory_level)),
  severe_weather: Boolean(input?.severe_weather),
  major_promotion: Boolean(input?.major_promotion),
  full_day_capacity: Math.max(0, sanitizeNumber(input?.full_day_capacity)),
  yesterday_inflow_00_14: Math.max(0, sanitizeNumber(input?.yesterday_inflow_00_14))
});

const buildHistorySummary = (targetWeekday: number, priorDays: PreparedDay[]) => {
  if (priorDays.length < 14) return null;

  const previousDay = priorDays[priorDays.length - 1];
  const recent7Days = priorDays.slice(-7);
  const recent14Days = priorDays.slice(-14);
  const sameWeekdayDays = priorDays.filter((day) => day.weekday === targetWeekday).slice(-4);
  const recent7 = recent7Days.map((day) => day.total);
  const recent14 = recent14Days.map((day) => day.total);
  const sameWeekday = sameWeekdayDays.map((day) => day.total);
  const rollingMean7 = mean(recent7) ?? previousDay.total;
  const rollingMean14 = mean(recent14) ?? rollingMean7;
  const sameWeekdayMean4 = mean(sameWeekday) ?? rollingMean14;
  const sameWeekdayMedian4 = median(sameWeekday) ?? sameWeekdayMean4;
  const previousVsRecent14 = rollingMean14 > 0 ? previousDay.total / rollingMean14 - 1 : 0;
  const previousDayItr = getInventoryTurnoverRate(previousDay);
  const recentItrMean7 = mean(recent7Days.map((day) => getInventoryTurnoverRate(day)).filter((value): value is number => value !== null));
  const sameWeekdayItrMean4 = mean(
    sameWeekdayDays.map((day) => getInventoryTurnoverRate(day)).filter((value): value is number => value !== null)
  );

  return {
    previousDay,
    rollingMean7,
    rollingMean14,
    sameWeekdayMean4,
    sameWeekdayMedian4,
    previousVsRecent14,
    previousDayItr: clamp(previousDayItr ?? 0, 0, 10),
    recentItrMean7: clamp(recentItrMean7 ?? previousDayItr ?? 0, 0, 10),
    sameWeekdayItrMean4: clamp(sameWeekdayItrMean4 ?? recentItrMean7 ?? previousDayItr ?? 0, 0, 10)
  };
};

const buildBaselinePredictions = (targetDate: string, priorDays: PreparedDay[]): Pick<ModelForecastMap, 'same_weekday_median' | 'rolling_mean_7' | 'trend_blend'> => {
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
  const summary = buildHistorySummary(targetDay.weekday, priorDays);
  if (!summary) return null;
  const backlogToInventory = targetDay.inventory_level > 0 ? targetDay.previous_day_backlog / targetDay.inventory_level : 0;
  const capacityVsRecent14 = summary.rollingMean14 > 0 ? targetDay.full_day_capacity / summary.rollingMean14 : 0;

  return {
    same_weekday_mean_4: summary.sameWeekdayMean4,
    same_weekday_median_4: summary.sameWeekdayMedian4,
    rolling_mean_7: summary.rollingMean7,
    rolling_mean_14: summary.rollingMean14,
    previous_day_total: summary.previousDay.total,
    previous_vs_recent14: clamp(summary.previousVsRecent14, -3, 3),
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

const buildFeatureVectorV2 = (targetDay: FeatureContextDay, priorDays: PreparedDay[]): FeatureVectorV2 | null => {
  const summary = buildHistorySummary(targetDay.weekday, priorDays);
  if (!summary) return null;

  return {
    same_weekday_mean_4: summary.sameWeekdayMean4,
    same_weekday_median_4: summary.sameWeekdayMedian4,
    rolling_mean_7: summary.rollingMean7,
    rolling_mean_14: summary.rollingMean14,
    previous_day_total: summary.previousDay.total,
    previous_vs_recent14: clamp(summary.previousVsRecent14, -3, 3),
    previous_day_itr: summary.previousDayItr,
    recent_itr_mean_7: summary.recentItrMean7,
    same_weekday_itr_mean_4: summary.sameWeekdayItrMean4,
    severe_weather: targetDay.severe_weather ? 1 : 0
  };
};

const buildFeatureVectorV3 = (
  targetDay: FeatureContextDay,
  priorDays: PreparedDay[],
  baseForecasts: {
    rollingMean7: number | null;
    forecastV1: number | null;
    forecastV2: number | null;
  }
): FeatureVectorV3 | null => {
  const summary = buildHistorySummary(targetDay.weekday, priorDays);
  if (!summary) return null;
  if (baseForecasts.rollingMean7 === null || baseForecasts.forecastV1 === null || baseForecasts.forecastV2 === null) return null;

  return {
    forecast_v1: baseForecasts.forecastV1,
    forecast_v2: baseForecasts.forecastV2,
    rolling_mean_7_model: baseForecasts.rollingMean7,
    previous_day_total_ctx: summary.previousDay.total,
    previous_vs_recent14_ctx: clamp(summary.previousVsRecent14, -3, 3),
    recent_itr_mean_7_ctx: summary.recentItrMean7,
    severe_weather_ctx: targetDay.severe_weather ? 1 : 0
  };
};

const buildFeatureVectorV7 = (
  targetDay: FeatureContextDay,
  priorDays: PreparedDay[],
  baseForecasts: {
    rollingMean7: number | null;
    forecastV1: number | null;
    forecastV2: number | null;
    forecastV3: number | null;
  }
): FeatureVectorV7 | null => {
  const summary = buildHistorySummary(targetDay.weekday, priorDays);
  if (!summary) return null;
  if (
    baseForecasts.rollingMean7 === null ||
    baseForecasts.forecastV1 === null ||
    baseForecasts.forecastV2 === null ||
    baseForecasts.forecastV3 === null
  ) {
    return null;
  }

  return {
    forecast_v1: baseForecasts.forecastV1,
    forecast_v2: baseForecasts.forecastV2,
    forecast_v3: baseForecasts.forecastV3,
    rolling_mean_7_model: baseForecasts.rollingMean7,
    previous_day_total_ctx: summary.previousDay.total,
    previous_vs_recent14_ctx: clamp(summary.previousVsRecent14, -3, 3),
    recent_itr_mean_7_ctx: summary.recentItrMean7,
    severe_weather_ctx: targetDay.severe_weather ? 1 : 0,
    major_promotion_ctx: targetDay.major_promotion ? 1 : 0
  };
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

const trainFeatureRegressionV2 = (samples: FeatureSampleV2[]): TrainedFeatureModelV2 | null => {
  if (samples.length < 18) return null;
  const means = FEATURE_NAMES_V2.map((name) => mean(samples.map((sample) => sample.features[name])) ?? 0);
  const stds = FEATURE_NAMES_V2.map((name, index) => {
    const base = means[index];
    const variance = mean(samples.map((sample) => (sample.features[name] - base) ** 2)) ?? 0;
    return Math.sqrt(Math.max(variance, 1e-6)) || 1;
  });

  let bias = mean(samples.map((sample) => sample.target)) ?? 0;
  let weights = Array.from({ length: FEATURE_NAMES_V2.length }, () => 0);
  const learningRate = 0.03;
  const l2 = 0.04;
  const scale = 2 / samples.length;

  for (let iteration = 0; iteration < 320; iteration += 1) {
    const biasGradient = samples.reduce((sum, sample) => {
      const prediction = bias + FEATURE_NAMES_V2.reduce((inner, name, index) => {
        const normalized = (sample.features[name] - means[index]) / stds[index];
        return inner + normalized * weights[index];
      }, 0);
      return sum + (prediction - sample.target);
    }, 0);

    const weightGradients = FEATURE_NAMES_V2.map((name, index) =>
      samples.reduce((sum, sample) => {
        const prediction = bias + FEATURE_NAMES_V2.reduce((inner, innerName, innerIndex) => {
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

const trainFeatureRegressionV3 = (samples: FeatureSampleV3[]): TrainedFeatureModelV3 | null => {
  if (samples.length < 16) return null;
  const means = FEATURE_NAMES_V3.map((name) => mean(samples.map((sample) => sample.features[name])) ?? 0);
  const stds = FEATURE_NAMES_V3.map((name, index) => {
    const base = means[index];
    const variance = mean(samples.map((sample) => (sample.features[name] - base) ** 2)) ?? 0;
    return Math.sqrt(Math.max(variance, 1e-6)) || 1;
  });

  let bias = mean(samples.map((sample) => sample.target)) ?? 0;
  let weights = Array.from({ length: FEATURE_NAMES_V3.length }, () => 0);
  const learningRate = 0.03;
  const l2 = 0.04;
  const scale = 2 / samples.length;

  for (let iteration = 0; iteration < 320; iteration += 1) {
    const biasGradient = samples.reduce((sum, sample) => {
      const prediction = bias + FEATURE_NAMES_V3.reduce((inner, name, index) => {
        const normalized = (sample.features[name] - means[index]) / stds[index];
        return inner + normalized * weights[index];
      }, 0);
      return sum + (prediction - sample.target);
    }, 0);

    const weightGradients = FEATURE_NAMES_V3.map((name, index) =>
      samples.reduce((sum, sample) => {
        const prediction = bias + FEATURE_NAMES_V3.reduce((inner, innerName, innerIndex) => {
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

const trainFeatureRegressionV7 = (samples: FeatureSampleV7[]): TrainedFeatureModelV7 | null => {
  if (samples.length < 18) return null;
  const means = FEATURE_NAMES_V7.map((name) => mean(samples.map((sample) => sample.features[name])) ?? 0);
  const stds = FEATURE_NAMES_V7.map((name, index) => {
    const base = means[index];
    const variance = mean(samples.map((sample) => (sample.features[name] - base) ** 2)) ?? 0;
    return Math.sqrt(Math.max(variance, 1e-6)) || 1;
  });

  let bias = mean(samples.map((sample) => sample.target)) ?? 0;
  let weights = Array.from({ length: FEATURE_NAMES_V7.length }, () => 0);
  const learningRate = 0.03;
  const l2 = 0.04;
  const scale = 2 / samples.length;

  for (let iteration = 0; iteration < 320; iteration += 1) {
    const biasGradient = samples.reduce((sum, sample) => {
      const prediction = bias + FEATURE_NAMES_V7.reduce((inner, name, index) => {
        const normalized = (sample.features[name] - means[index]) / stds[index];
        return inner + normalized * weights[index];
      }, 0);
      return sum + (prediction - sample.target);
    }, 0);

    const weightGradients = FEATURE_NAMES_V7.map((name, index) =>
      samples.reduce((sum, sample) => {
        const prediction = bias + FEATURE_NAMES_V7.reduce((inner, innerName, innerIndex) => {
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

const predictFeatureRegressionV2 = (model: TrainedFeatureModelV2 | null, vector: FeatureVectorV2 | null) => {
  if (!model || !vector) return null;
  const rawPrediction = model.bias + FEATURE_NAMES_V2.reduce((sum, name, index) => {
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

const predictFeatureRegressionV3 = (model: TrainedFeatureModelV3 | null, vector: FeatureVectorV3 | null) => {
  if (!model || !vector) return null;
  const rawPrediction = model.bias + FEATURE_NAMES_V3.reduce((sum, name, index) => {
    const normalized = (vector[name] - model.means[index]) / model.stds[index];
    return sum + normalized * model.weights[index];
  }, 0);

  const anchors = [vector.forecast_v2, vector.forecast_v1, vector.rolling_mean_7_model, vector.previous_day_total_ctx].filter((value) => value > 0);
  const anchor = mean(anchors) ?? rawPrediction;
  const safePrediction = Number.isFinite(rawPrediction) ? rawPrediction : anchor;
  const lowerBound = Math.max(0, anchor * 0.35);
  const upperBound = Math.max(lowerBound + 1, anchor * 1.85);
  return clamp(Math.max(0, safePrediction), lowerBound, upperBound);
};

const predictFeatureRegressionV7 = (model: TrainedFeatureModelV7 | null, vector: FeatureVectorV7 | null) => {
  if (!model || !vector) return null;
  const rawPrediction = model.bias + FEATURE_NAMES_V7.reduce((sum, name, index) => {
    const normalized = (vector[name] - model.means[index]) / model.stds[index];
    return sum + normalized * model.weights[index];
  }, 0);

  const anchors = [vector.forecast_v3, vector.forecast_v2, vector.forecast_v1, vector.rolling_mean_7_model, vector.previous_day_total_ctx].filter(
    (value) => value > 0
  );
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

const buildFeatureImportanceRows = <T extends string>(
  weights: number[],
  featureNames: readonly T[],
  labels: Record<T, string>
) =>
  featureNames
    .map((name, index) => ({
      feature: labels[name],
      weight: weights[index] ?? 0,
      importance: Math.abs(weights[index] ?? 0)
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 8);

const createBaseVersionApeMap = (value: number | null = null): BaseVersionApeMap => ({
  v0: value,
  v1: value,
  v2: value,
  v3: value
});

const createBaseVersionPointMap = (value = 0): BaseVersionPointMap => ({
  v0: value,
  v1: value,
  v2: value,
  v3: value
});

const createBaseVersionWeightMap = (value = 0): BaseVersionWeightMap => ({
  v0: value,
  v1: value,
  v2: value,
  v3: value
});

const calculateAbsolutePercentageError = (prediction: number | null, actual: number | null) => {
  if (prediction === null || actual === null || prediction <= 0 || actual <= 0) return null;
  return Math.abs(prediction - actual) / actual;
};

const calculateVarianceRate = (prediction: number | null, actual: number | null) => {
  if (prediction === null || actual === null || prediction <= 0) return null;
  return (actual - prediction) / prediction;
};

const buildBaseVersionMetricSlice = (rows: VersionInputRow[], key: BaseVersionKey): VersionMetricSlice => {
  const validRows = rows.filter((row) => row.actual !== null && row.forecasts[key] !== null) as Array<VersionInputRow & { actual: number }>;
  const totalActual = validRows.reduce((sum, row) => sum + row.actual, 0);
  const totalForecast = validRows.reduce((sum, row) => sum + (row.forecasts[key] ?? 0), 0);
  const totalAbsError = validRows.reduce((sum, row) => sum + Math.abs((row.forecasts[key] ?? 0) - row.actual), 0);
  const totalSquaredError = validRows.reduce((sum, row) => {
    const error = (row.forecasts[key] ?? 0) - row.actual;
    return sum + error * error;
  }, 0);
  const mapeRows = validRows.filter((row) => row.actual > 0);

  return {
    samples: validRows.length,
    mape: mapeRows.length
      ? mapeRows.reduce((sum, row) => sum + Math.abs(((row.forecasts[key] ?? 0) - row.actual) / row.actual), 0) / mapeRows.length
      : null,
    wape: totalActual > 0 ? totalAbsError / totalActual : null,
    mae: validRows.length ? totalAbsError / validRows.length : null,
    rmse: validRows.length ? Math.sqrt(totalSquaredError / validRows.length) : null,
    bias: totalActual > 0 ? (totalForecast - totalActual) / totalActual : null
  };
};

// Score one day of V0-V3 forecasts against the actual volume.
const calculateErrors = (row: VersionInputRow): BaseVersionApeMap =>
  BASE_VERSION_KEYS.reduce<BaseVersionApeMap>((result, key) => {
    result[key] = calculateAbsolutePercentageError(row.forecasts[key], row.actual);
    return result;
  }, createBaseVersionApeMap());

// Convert daily rank into 3/2/1/0 points for the rolling champion selector.
const assignDailyPoints = (apes: BaseVersionApeMap): BaseVersionPointMap => {
  const points = createBaseVersionPointMap();
  const ranked = BASE_VERSION_KEYS.map((key) => ({
    key,
    ape: apes[key]
  }))
    .filter((item): item is { key: BaseVersionKey; ape: number } => item.ape !== null && Number.isFinite(item.ape))
    .sort(
      (a, b) =>
        a.ape - b.ape || VERSION_TIEBREAK_ORDER.indexOf(a.key) - VERSION_TIEBREAK_ORDER.indexOf(b.key)
    );

  ranked.forEach((item, index) => {
    points[item.key] = DAILY_POINT_VALUES[index] ?? 0;
  });
  return points;
};

// Sum the previous 14 days of points to decide the next champion model.
const calculateRollingScores = (rows: { dailyPoints: BaseVersionPointMap }[], currentIndex: number, window = 14): BaseVersionPointMap => {
  const history = rows.slice(Math.max(0, currentIndex - window), currentIndex);
  return BASE_VERSION_KEYS.reduce<BaseVersionPointMap>((result, key) => {
    result[key] = history.reduce((sum, row) => sum + row.dailyPoints[key], 0);
    return result;
  }, createBaseVersionPointMap());
};

const calculateRollingAverageErrors = (rows: { apes: BaseVersionApeMap }[], currentIndex: number, window = 14): BaseVersionApeMap => {
  const history = rows.slice(Math.max(0, currentIndex - window), currentIndex);
  return BASE_VERSION_KEYS.reduce<BaseVersionApeMap>((result, key) => {
    result[key] = mean(history.map((row) => row.apes[key]).filter((value): value is number => value !== null));
    return result;
  }, createBaseVersionApeMap());
};

// Prefer the highest rolling score, then the smallest 14-day average error.
const selectChampionModel = (
  rollingScores: BaseVersionPointMap,
  rollingAverageErrors: BaseVersionApeMap,
  currentForecasts: BaseVersionForecastMap
): BaseVersionKey | null => {
  const availableKeys = BASE_VERSION_KEYS.filter((key) => currentForecasts[key] !== null);
  if (!availableKeys.length) return null;

  const ranked = availableKeys
    .map((key) => ({
      key,
      score: rollingScores[key],
      averageError: rollingAverageErrors[key] ?? Number.POSITIVE_INFINITY
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.averageError - b.averageError ||
        VERSION_TIEBREAK_ORDER.indexOf(a.key) - VERSION_TIEBREAK_ORDER.indexOf(b.key)
    );

  return ranked[0]?.key ?? null;
};

// Measure recent directional bias and cap the correction to avoid overreacting.
const calculateBiasAdjustment = <TRow extends { actual: number | null }>(
  rows: TRow[],
  currentIndex: number,
  getPrediction: (row: TRow) => number | null,
  window = 7,
  cap = 0.03
) => {
  const history = rows.slice(Math.max(0, currentIndex - window), currentIndex);
  const biasValues = history
    .map((row) => {
      const prediction = getPrediction(row);
      if (prediction === null || prediction <= 0 || row.actual === null) return null;
      return (row.actual - prediction) / prediction;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const averageBias = mean(biasValues);
  if (averageBias === null || Math.abs(averageBias) <= 0.01) {
    return {
      averageBias,
      adjustmentRate: 0
    };
  }

  return {
    averageBias,
    adjustmentRate: clamp(averageBias, -cap, cap)
  };
};

const calculateInverseErrorWeights = (
  rows: { apes: BaseVersionApeMap }[],
  currentIndex: number,
  currentForecasts: BaseVersionForecastMap,
  window = 14
): BaseVersionWeightMap => {
  const weights = createBaseVersionWeightMap();
  const validKeys = BASE_VERSION_KEYS.filter((key) => currentForecasts[key] !== null);
  if (!validKeys.length) return weights;

  const recentErrors = calculateRollingAverageErrors(rows, currentIndex, window);
  const fallbackError = mean(validKeys.map((key) => recentErrors[key]).filter((value): value is number => value !== null)) ?? 1;
  const rawWeights = validKeys.map((key) => {
    const error = Math.max(recentErrors[key] ?? fallbackError, 0.001);
    return {
      key,
      weight: 1 / error
    };
  });
  const totalWeight = rawWeights.reduce((sum, item) => sum + item.weight, 0);
  rawWeights.forEach((item) => {
    weights[item.key] = totalWeight > 0 ? item.weight / totalWeight : 1 / rawWeights.length;
  });
  return weights;
};

const calculateWeightedForecast = (forecasts: BaseVersionForecastMap, weights: BaseVersionWeightMap) => {
  const validEntries = BASE_VERSION_KEYS.filter((key) => forecasts[key] !== null && weights[key] > 0).map((key) => ({
    forecast: forecasts[key] ?? 0,
    weight: weights[key]
  }));
  const weightSum = validEntries.reduce((sum, item) => sum + item.weight, 0);
  if (!validEntries.length || weightSum <= 0) return null;
  return validEntries.reduce((sum, item) => sum + item.forecast * item.weight, 0) / weightSum;
};

const rankCurrentVersionMetrics = (metrics: VersionMetric[], minSamples = CURRENT_MODEL_MIN_SAMPLES) =>
  [...metrics].sort((a, b) => {
    const aReady = a.recent14.samples >= minSamples && a.recent14.wape !== null;
    const bReady = b.recent14.samples >= minSamples && b.recent14.wape !== null;
    if (aReady !== bReady) return aReady ? -1 : 1;
    if (a.recent14.wape === null) return 1;
    if (b.recent14.wape === null) return -1;
    return (
      a.recent14.wape - b.recent14.wape ||
      Math.abs(a.recent14.bias ?? Number.POSITIVE_INFINITY) - Math.abs(b.recent14.bias ?? Number.POSITIVE_INFINITY) ||
      (b.recent14.samples - a.recent14.samples) ||
      (a.wape ?? Number.POSITIVE_INFINITY) - (b.wape ?? Number.POSITIVE_INFINITY)
    );
  });

const buildAdaptiveBlendWeights = (
  rows: VersionInputRow[],
  currentIndex: number,
  currentForecasts: BaseVersionForecastMap,
  window = CURRENT_MODEL_WINDOW,
  minSamples = 5,
  closeGap = CURRENT_BLEND_GAP
) => {
  const history = rows.slice(Math.max(0, currentIndex - window), currentIndex);
  const recent14Wape = createBaseVersionApeMap();
  const blendWeights14 = createBaseVersionWeightMap();
  const candidates = BLEND_VERSION_KEYS.filter((key) => currentForecasts[key] !== null)
    .map((key) => {
      const metrics = buildBaseVersionMetricSlice(history, key);
      recent14Wape[key] = metrics.wape;
      return {
        key,
        ...metrics
      };
    })
    .sort((a, b) => {
      const aReady = a.samples >= minSamples && a.wape !== null;
      const bReady = b.samples >= minSamples && b.wape !== null;
      if (aReady !== bReady) return aReady ? -1 : 1;
      if (a.wape === null) return 1;
      if (b.wape === null) return -1;
      return (
        a.wape - b.wape ||
        Math.abs(a.bias ?? Number.POSITIVE_INFINITY) - Math.abs(b.bias ?? Number.POSITIVE_INFINITY) ||
        VERSION_TIEBREAK_ORDER.indexOf(a.key) - VERSION_TIEBREAK_ORDER.indexOf(b.key)
      );
    });

  if (!candidates.length) {
    return {
      championModel: null,
      runnerUpModel: null,
      blendMode: 'fallback' as const,
      recent14Wape,
      blendWeights14,
      baseForecast: null
    };
  }

  const championModel = candidates[0]?.key ?? null;
  const runnerUpModel = candidates[1]?.key ?? null;
  const shouldBlend =
    candidates.length > 1 &&
    candidates[0]?.wape !== null &&
    candidates[1]?.wape !== null &&
    (candidates[1].wape - candidates[0].wape <= closeGap);

  if (shouldBlend) {
    const rawWeights = candidates
      .filter((candidate) => candidate.wape !== null)
      .map((candidate) => ({
        key: candidate.key,
        weight: 1 / Math.max(candidate.wape ?? 0.001, 0.001)
      }));
    const totalWeight = rawWeights.reduce((sum, item) => sum + item.weight, 0);
    rawWeights.forEach((item) => {
      blendWeights14[item.key] = totalWeight > 0 ? item.weight / totalWeight : 1 / rawWeights.length;
    });
  } else if (championModel) {
    blendWeights14[championModel] = 1;
  }

  const baseForecast = calculateWeightedForecast(currentForecasts, blendWeights14);
  return {
    championModel,
    runnerUpModel,
    blendMode: shouldBlend ? ('blend' as const) : ('single' as const),
    recent14Wape,
    blendWeights14,
    baseForecast
  };
};

const calculateResidualCalibration = (rows: V6OutputRow[], currentIndex: number, currentDate: string) => {
  const history = rows.slice(0, currentIndex);
  const validForecastRows = history.filter(
    (row): row is V6OutputRow & { actual: number; v6Forecast: number } =>
      row.actual !== null && row.v6Forecast !== null && row.v6Forecast > 0
  );
  const recent3Rows = validForecastRows.slice(-3);
  const recent3Bias = mean(recent3Rows.map((row) => (row.actual - row.v6Forecast) / row.v6Forecast));

  const targetWeekday = getIsoWeekday(new Date(`${currentDate}T00:00:00`));
  const sameWeekdayRows = validForecastRows
    .filter((row) => getIsoWeekday(new Date(`${row.date}T00:00:00`)) === targetWeekday)
    .slice(-4);
  const sameWeekdayBias = mean(sameWeekdayRows.map((row) => (row.actual - row.v6Forecast) / row.v6Forecast));

  const trendRows = history.filter(
    (row): row is V6OutputRow & { actual: number; baseForecast: number } =>
      row.actual !== null && row.baseForecast !== null && row.baseForecast > 0
  );
  const recent14TrendRows = trendRows.slice(-CURRENT_MODEL_WINDOW);
  const recent3TrendRows = recent14TrendRows.slice(-3);
  const recent14ActualMean = mean(recent14TrendRows.map((row) => row.actual));
  const recent14BaseMean = mean(recent14TrendRows.map((row) => row.baseForecast));
  const recent3ActualMean = mean(recent3TrendRows.map((row) => row.actual));
  const recent3BaseMean = mean(recent3TrendRows.map((row) => row.baseForecast));
  const trendBias =
    recent14ActualMean !== null &&
    recent14BaseMean !== null &&
    recent3ActualMean !== null &&
    recent3BaseMean !== null &&
    recent14ActualMean > 0 &&
    recent14BaseMean > 0
      ? clamp((recent3ActualMean / recent14ActualMean - 1) - (recent3BaseMean / recent14BaseMean - 1), -0.05, 0.05)
      : null;

  const weightedComponents = [
    { value: recent3Bias, weight: 0.5 },
    { value: sameWeekdayBias, weight: 0.3 },
    { value: trendBias, weight: 0.2 }
  ].filter((item): item is { value: number; weight: number } => item.value !== null && Number.isFinite(item.value));
  const totalWeight = weightedComponents.reduce((sum, item) => sum + item.weight, 0);
  const blendedBias =
    totalWeight > 0 ? weightedComponents.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight : null;
  const adjustmentRate =
    blendedBias === null || Math.abs(blendedBias) <= 0.01 ? 0 : clamp(blendedBias, -RESIDUAL_CALIBRATION_CAP, RESIDUAL_CALIBRATION_CAP);

  return {
    recent3Bias,
    sameWeekdayBias,
    trendBias,
    adjustmentRate
  };
};

// Build the full V4 output frame row by row so every forecast only uses prior history.
const buildV4Model = (rows: VersionInputRow[]) => {
  const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const outputRows: V4OutputRow[] = [];

  sortedRows.forEach((row, index) => {
    const apes = calculateErrors(row);
    const dailyPoints = assignDailyPoints(apes);
    const rollingScores14 = calculateRollingScores(outputRows, index, 14);
    const rollingAverageErrors14 = calculateRollingAverageErrors(outputRows, index, 14);
    const championModel = selectChampionModel(rollingScores14, rollingAverageErrors14, row.forecasts);
    const baseForecast = championModel ? row.forecasts[championModel] : null;
    const championBias = calculateBiasAdjustment(
      outputRows,
      index,
      (historyRow) => (championModel ? historyRow.forecasts[championModel] : null),
      7
    );
    const v4Forecast = baseForecast === null ? null : baseForecast * (1 + championBias.adjustmentRate);
    const ensembleWeights14 = calculateInverseErrorWeights(outputRows, index, row.forecasts, 14);
    const ensembleBaseForecast = calculateWeightedForecast(row.forecasts, ensembleWeights14);
    const ensembleBias = calculateBiasAdjustment(outputRows, index, (historyRow) => historyRow.v4EnsembleForecast, 7);
    const v4EnsembleForecast =
      ensembleBaseForecast === null ? null : ensembleBaseForecast * (1 + ensembleBias.adjustmentRate);

    outputRows.push({
      ...row,
      apes,
      dailyPoints,
      rollingScores14,
      rollingAverageErrors14,
      championModel,
      baseForecast,
      championBiasAverage7: championBias.averageBias,
      adjustmentRate: championBias.adjustmentRate,
      v4Forecast,
      v4ErrorPct: calculateAbsolutePercentageError(v4Forecast, row.actual),
      ensembleWeights14,
      ensembleBaseForecast,
      ensembleBiasAverage7: ensembleBias.averageBias,
      ensembleAdjustmentRate: ensembleBias.adjustmentRate,
      v4EnsembleForecast,
      v4EnsembleErrorPct: calculateAbsolutePercentageError(v4EnsembleForecast, row.actual)
    });
  });

  return outputRows;
};

// Build V5 sequentially with recent-14 adaptive model selection, soft blending, and light bias correction.
const buildV5Model = (rows: VersionInputRow[]) => {
  const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const outputRows: V5OutputRow[] = [];

  sortedRows.forEach((row, index) => {
    const apes = calculateErrors(row);
    const dailyPoints = assignDailyPoints(apes);
    const rollingScores14 = calculateRollingScores(outputRows, index, 14);
    const rollingAverageErrors14 = calculateRollingAverageErrors(outputRows, index, 14);
    const blendSelection = buildAdaptiveBlendWeights(outputRows, index, row.forecasts);
    const biasAdjustment = calculateBiasAdjustment(outputRows, index, (historyRow) => historyRow.v5Forecast, 7, 0.02);
    const v5Forecast = blendSelection.baseForecast === null ? null : blendSelection.baseForecast * (1 + biasAdjustment.adjustmentRate);
    const v5ErrorRate =
      v5Forecast === null || row.actual === null || row.actual <= 0 ? null : (v5Forecast - row.actual) / row.actual;

    outputRows.push({
      ...row,
      apes,
      dailyPoints,
      rollingScores14,
      rollingAverageErrors14,
      championModel: blendSelection.championModel,
      runnerUpModel: blendSelection.runnerUpModel,
      blendMode: blendSelection.blendMode,
      recent14Wape: blendSelection.recent14Wape,
      blendWeights14: blendSelection.blendWeights14,
      baseForecast: blendSelection.baseForecast,
      biasAverage7: biasAdjustment.averageBias,
      adjustmentRate: biasAdjustment.adjustmentRate,
      v5Forecast,
      v5ErrorRate
    });
  });

  return outputRows;
};

const buildV6Model = (rows: VersionInputRow[]) => {
  const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const outputRows: V6OutputRow[] = [];

  sortedRows.forEach((row, index) => {
    const apes = calculateErrors(row);
    const dailyPoints = assignDailyPoints(apes);
    const rollingScores14 = calculateRollingScores(outputRows, index, 14);
    const rollingAverageErrors14 = calculateRollingAverageErrors(outputRows, index, 14);
    const blendSelection = buildAdaptiveBlendWeights(outputRows, index, row.forecasts);
    const calibration = calculateResidualCalibration(outputRows, index, row.date);
    const v6Forecast = blendSelection.baseForecast === null ? null : blendSelection.baseForecast * (1 + calibration.adjustmentRate);
    const v6ErrorRate =
      v6Forecast === null || row.actual === null || row.actual <= 0 ? null : (v6Forecast - row.actual) / row.actual;

    outputRows.push({
      ...row,
      apes,
      dailyPoints,
      rollingScores14,
      rollingAverageErrors14,
      championModel: blendSelection.championModel,
      runnerUpModel: blendSelection.runnerUpModel,
      blendMode: blendSelection.blendMode,
      recent14Wape: blendSelection.recent14Wape,
      blendWeights14: blendSelection.blendWeights14,
      baseForecast: blendSelection.baseForecast,
      recent3Bias: calibration.recent3Bias,
      sameWeekdayBias: calibration.sameWeekdayBias,
      trendBias: calibration.trendBias,
      adjustmentRate: calibration.adjustmentRate,
      v6Forecast,
      v6ErrorRate
    });
  });

  return outputRows;
};

const buildVersionMetricSlice = (rows: VersionEvaluationRow[], key: VersionKey): VersionMetricSlice => {
  const validRows = rows.filter((row) => row.forecasts[key] !== null);
  const totalActual = validRows.reduce((sum, row) => sum + row.actual, 0);
  const totalForecast = validRows.reduce((sum, row) => sum + (row.forecasts[key] ?? 0), 0);
  const totalAbsError = validRows.reduce((sum, row) => sum + Math.abs((row.forecasts[key] ?? 0) - row.actual), 0);
  const totalSquaredError = validRows.reduce((sum, row) => {
    const error = (row.forecasts[key] ?? 0) - row.actual;
    return sum + error * error;
  }, 0);
  const mapeRows = validRows.filter((row) => row.actual > 0);

  return {
    samples: validRows.length,
    mape: mapeRows.length
      ? mapeRows.reduce((sum, row) => sum + Math.abs(((row.forecasts[key] ?? 0) - row.actual) / row.actual), 0) / mapeRows.length
      : null,
    wape: totalActual > 0 ? totalAbsError / totalActual : null,
    mae: validRows.length ? totalAbsError / validRows.length : null,
    rmse: validRows.length ? Math.sqrt(totalSquaredError / validRows.length) : null,
    bias: totalActual > 0 ? (totalForecast - totalActual) / totalActual : null
  };
};

// Compare V0-V7 over the full window and over the most recent 14 completed days.
const evaluateModels = (rows: VersionEvaluationRow[], targetForecasts: VersionForecastMap, recentWindow = 14): VersionMetric[] => {
  const recentRows = rows.slice(-recentWindow);
  return VERSION_KEYS.map((key) => ({
    key,
    label: VERSION_LABELS[key],
    targetForecast: targetForecasts[key],
    ...buildVersionMetricSlice(rows, key),
    recent14: buildVersionMetricSlice(recentRows, key)
  })).sort((a, b) => {
    if (a.wape === null) return 1;
    if (b.wape === null) return -1;
    return a.wape - b.wape;
  });
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
            'input_date,weekday,previous_day_backlog,current_cumulative_volume_12,inventory_level,severe_weather,major_promotion,full_day_capacity,yesterday_inflow_00_14'
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
      .filter((row) => Number(row.last_filled_hour ?? inferLastFilledHour(row) ?? -1) >= 23)
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
        context.severe_weather ||
        context.major_promotion
      );
    });

    const priorDaysCache = new Map<string, PreparedDay[]>();
    const trainingSamplesV1Cache = new Map<string, FeatureSample[]>();
    const trainingSamplesV2Cache = new Map<string, FeatureSampleV2[]>();
    const trainingSamplesV3Cache = new Map<string, FeatureSampleV3[]>();
    const trainingSamplesV7Cache = new Map<string, FeatureSampleV7[]>();
    const featureModelV1Cache = new Map<string, TrainedFeatureModel | null>();
    const featureModelV2Cache = new Map<string, TrainedFeatureModelV2 | null>();
    const featureModelV3Cache = new Map<string, TrainedFeatureModelV3 | null>();
    const featureModelV7Cache = new Map<string, TrainedFeatureModelV7 | null>();
    const coreForecastCache = new Map<
      string,
      {
        baselinePredictions: Pick<ModelForecastMap, 'same_weekday_median' | 'rolling_mean_7' | 'trend_blend'>;
        featureVectorV1: FeatureVector | null;
        featureForecastV1: number | null;
        featureVectorV2: FeatureVectorV2 | null;
        featureForecastV2: number | null;
        featureVectorV3: FeatureVectorV3 | null;
        featureForecastV3: number | null;
        featureVectorV7: FeatureVectorV7 | null;
      }
    >();

    const getPriorDays = (cutoffDate: string, lookbackDays = 160) => {
      const cacheKey = `${cutoffDate}:${lookbackDays}`;
      const cached = priorDaysCache.get(cacheKey);
      if (cached) return cached;
      const priorDays = fullHistoryDays.filter((day) => day.date < cutoffDate).slice(-lookbackDays);
      priorDaysCache.set(cacheKey, priorDays);
      return priorDays;
    };

    const getTrainingSamplesV1 = (cutoffDate: string, lookbackDays = 160) => {
      const cacheKey = `${cutoffDate}:${lookbackDays}`;
      const cached = trainingSamplesV1Cache.get(cacheKey);
      if (cached) return cached;
      const candidateDays = fullHistoryDays.filter((day) => day.date < cutoffDate).slice(-lookbackDays);
      const samples = candidateDays.reduce<FeatureSample[]>((rows, day) => {
        const features = buildFeatureVector(day.context, getPriorDays(day.date, lookbackDays));
        if (features) rows.push({ features, target: day.total });
        return rows;
      }, []);
      trainingSamplesV1Cache.set(cacheKey, samples);
      return samples;
    };

    const getTrainingSamplesV2 = (cutoffDate: string, lookbackDays = 160) => {
      const cacheKey = `${cutoffDate}:${lookbackDays}`;
      const cached = trainingSamplesV2Cache.get(cacheKey);
      if (cached) return cached;
      const candidateDays = fullHistoryDays.filter((day) => day.date < cutoffDate).slice(-lookbackDays);
      const samples = candidateDays.reduce<FeatureSampleV2[]>((rows, day) => {
        const features = buildFeatureVectorV2(day.context, getPriorDays(day.date, lookbackDays));
        if (features) rows.push({ features, target: day.total });
        return rows;
      }, []);
      trainingSamplesV2Cache.set(cacheKey, samples);
      return samples;
    };

    const getFeatureModelV1 = (cutoffDate: string) => {
      if (!featureModelV1Cache.has(cutoffDate)) {
        featureModelV1Cache.set(cutoffDate, trainFeatureRegression(getTrainingSamplesV1(cutoffDate)));
      }
      return featureModelV1Cache.get(cutoffDate) ?? null;
    };

    const getFeatureModelV2 = (cutoffDate: string) => {
      if (!featureModelV2Cache.has(cutoffDate)) {
        featureModelV2Cache.set(cutoffDate, trainFeatureRegressionV2(getTrainingSamplesV2(cutoffDate)));
      }
      return featureModelV2Cache.get(cutoffDate) ?? null;
    };

    const getCoreForecasts = (targetDate: string, targetContext: FeatureContextDay) => {
      const cached = coreForecastCache.get(targetDate);
      if (cached) return cached;

      const priorDays = getPriorDays(targetDate);
      const baselinePredictions = buildBaselinePredictions(targetDate, priorDays);
      const featureVectorV1 = buildFeatureVector(targetContext, priorDays);
      const featureForecastV1 = predictFeatureRegression(getFeatureModelV1(targetDate), featureVectorV1);
      const featureVectorV2 = buildFeatureVectorV2(targetContext, priorDays);
      const featureForecastV2 = predictFeatureRegressionV2(getFeatureModelV2(targetDate), featureVectorV2);
      const featureVectorV3 = buildFeatureVectorV3(targetContext, priorDays, {
        rollingMean7: baselinePredictions.rolling_mean_7,
        forecastV1: featureForecastV1,
        forecastV2: featureForecastV2
      });
      const featureForecastV3 = predictFeatureRegressionV3(getFeatureModelV3(targetDate), featureVectorV3);
      const featureVectorV7 = buildFeatureVectorV7(targetContext, priorDays, {
        rollingMean7: baselinePredictions.rolling_mean_7,
        forecastV1: featureForecastV1,
        forecastV2: featureForecastV2,
        forecastV3: featureForecastV3
      });

      const result = {
        baselinePredictions,
        featureVectorV1,
        featureForecastV1,
        featureVectorV2,
        featureForecastV2,
        featureVectorV3,
        featureForecastV3,
        featureVectorV7
      };
      coreForecastCache.set(targetDate, result);
      return result;
    };

    const getTrainingSamplesV3 = (cutoffDate: string, lookbackDays = 160) => {
      const cacheKey = `${cutoffDate}:${lookbackDays}`;
      const cached = trainingSamplesV3Cache.get(cacheKey);
      if (cached) return cached;
      const candidateDays = fullHistoryDays.filter((day) => day.date < cutoffDate).slice(-lookbackDays);
      const samples = candidateDays.reduce<FeatureSampleV3[]>((rows, day) => {
        const features = getCoreForecasts(day.date, day.context).featureVectorV3;
        if (features) rows.push({ features, target: day.total });
        return rows;
      }, []);
      trainingSamplesV3Cache.set(cacheKey, samples);
      return samples;
    };

    const getFeatureModelV3 = (cutoffDate: string) => {
      if (!featureModelV3Cache.has(cutoffDate)) {
        featureModelV3Cache.set(cutoffDate, trainFeatureRegressionV3(getTrainingSamplesV3(cutoffDate)));
      }
      return featureModelV3Cache.get(cutoffDate) ?? null;
    };

    const getTrainingSamplesV7 = (cutoffDate: string, lookbackDays = 160) => {
      const cacheKey = `${cutoffDate}:${lookbackDays}`;
      const cached = trainingSamplesV7Cache.get(cacheKey);
      if (cached) return cached;
      const candidateDays = fullHistoryDays.filter((day) => day.date < cutoffDate).slice(-lookbackDays);
      const samples = candidateDays.reduce<FeatureSampleV7[]>((rows, day) => {
        const features = getCoreForecasts(day.date, day.context).featureVectorV7;
        if (features) rows.push({ features, target: day.total });
        return rows;
      }, []);
      trainingSamplesV7Cache.set(cacheKey, samples);
      return samples;
    };

    const getFeatureModelV7 = (cutoffDate: string) => {
      if (!featureModelV7Cache.has(cutoffDate)) {
        featureModelV7Cache.set(cutoffDate, trainFeatureRegressionV7(getTrainingSamplesV7(cutoffDate)));
      }
      return featureModelV7Cache.get(cutoffDate) ?? null;
    };

    const buildForecasts = (targetDate: string, targetContext: FeatureContextDay): ModelForecastMap => {
      const core = getCoreForecasts(targetDate, targetContext);
      return {
        ...core.baselinePredictions,
        feature_regression_v1: core.featureForecastV1,
        feature_regression_v2: core.featureForecastV2,
        feature_regression_v3: core.featureForecastV3,
        feature_regression_v7: predictFeatureRegressionV7(getFeatureModelV7(targetDate), core.featureVectorV7)
      };
    };

    const evaluationRows = analysisDays.reduce<EvaluationRow[]>((rows, day) => {
      const forecasts = buildForecasts(day.date, day.context);
      if (MODEL_KEYS.every((key) => forecasts[key] === null)) return rows;

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
    const targetActualDay = fullHistoryDays.find((day) => day.date === forecastTargetDate) ?? null;
    const targetForecasts = buildForecasts(forecastTargetDate, targetContext);
    const targetFeatureModelV1 = getFeatureModelV1(forecastTargetDate);
    const targetFeatureModelV2 = getFeatureModelV2(forecastTargetDate);
    const targetFeatureModelV3 = getFeatureModelV3(forecastTargetDate);
    const targetFeatureModelV7 = getFeatureModelV7(forecastTargetDate);

    const leaderboard = MODEL_KEYS.map((key) => buildMetric(evaluationRows, key, targetForecasts[key])).sort((a, b) => {
      if (a.wape === null) return 1;
      if (b.wape === null) return -1;
      return a.wape - b.wape;
    });
    const modelMetricsByKey = new Map(leaderboard.map((metric) => [metric.key, metric]));
    const championScoreMap = new Map<ModelKey, number>(MODEL_KEYS.map((key) => [key, 0]));

    evaluationRows.forEach((row) => {
      const winner = MODEL_KEYS.map((key) => {
        const variance = calculateVarianceRate(row.forecasts[key], row.actual);
        return {
          key,
          absVariance: variance === null ? Number.POSITIVE_INFINITY : Math.abs(variance),
          absError: row.forecasts[key] === null ? Number.POSITIVE_INFINITY : Math.abs((row.forecasts[key] ?? 0) - row.actual)
        };
      })
        .filter((item) => Number.isFinite(item.absVariance))
        .sort(
          (a, b) =>
            a.absVariance - b.absVariance ||
            a.absError - b.absError ||
            MODEL_KEYS.indexOf(a.key) - MODEL_KEYS.indexOf(b.key)
        )[0];

      if (winner) {
        championScoreMap.set(winner.key, (championScoreMap.get(winner.key) ?? 0) + 1);
      }
    });
    const championScoreboard: ChampionScoreRow[] = MODEL_KEYS.map((key) => {
      const metric = modelMetricsByKey.get(key);
      const targetForecast = targetForecasts[key];
      const samples = metric?.samples ?? 0;
      const score = championScoreMap.get(key) ?? 0;
      return {
        key,
        label: MODEL_LABELS[key],
        samples,
        actualInbound: targetActualDay?.total ?? null,
        targetForecast,
        variance: calculateVarianceRate(targetForecast, targetActualDay?.total ?? null),
        score,
        toppingRate: samples > 0 ? score / samples : null
      };
    }).sort(
      (a, b) =>
        (b.toppingRate ?? Number.NEGATIVE_INFINITY) - (a.toppingRate ?? Number.NEGATIVE_INFINITY) ||
        b.score - a.score ||
        (b.samples - a.samples) ||
        Math.abs(a.variance ?? Number.POSITIVE_INFINITY) - Math.abs(b.variance ?? Number.POSITIVE_INFINITY) ||
        MODEL_KEYS.indexOf(a.key) - MODEL_KEYS.indexOf(b.key)
    );

    const baselineMetrics = leaderboard.filter(
      (metric) =>
        metric.key !== 'feature_regression_v1' &&
        metric.key !== 'feature_regression_v2' &&
        metric.key !== 'feature_regression_v3' &&
        metric.key !== 'feature_regression_v7'
    );
    const bestBaselineMetric = baselineMetrics[0] ?? null;
    const featureMetricV1 = leaderboard.find((metric) => metric.key === 'feature_regression_v1') ?? null;
    const featureMetricV2 = leaderboard.find((metric) => metric.key === 'feature_regression_v2') ?? null;
    const featureMetricV3 = leaderboard.find((metric) => metric.key === 'feature_regression_v3') ?? null;
    const featureMetricV7 = leaderboard.find((metric) => metric.key === 'feature_regression_v7') ?? null;
    const bestFeatureMetric =
      [featureMetricV1, featureMetricV2, featureMetricV3, featureMetricV7]
        .filter((metric): metric is ModelMetric => metric !== null)
        .sort((a, b) => {
          if (a.wape === null) return 1;
          if (b.wape === null) return -1;
          return a.wape - b.wape;
        })[0] ?? null;
    const bestMetric = leaderboard[0] ?? null;
    const v0SourceKey =
      bestBaselineMetric?.key === 'same_weekday_median' ||
      bestBaselineMetric?.key === 'rolling_mean_7' ||
      bestBaselineMetric?.key === 'trend_blend'
        ? bestBaselineMetric.key
        : 'rolling_mean_7';
    const v0SourceLabel = MODEL_LABELS[v0SourceKey];
    const versionInputRows: VersionInputRow[] = evaluationRows.map((row) => ({
      date: row.date,
      actual: row.actual,
      forecasts: {
        v0: row.forecasts[v0SourceKey],
        v1: row.forecasts.feature_regression_v1,
        v2: row.forecasts.feature_regression_v2,
        v3: row.forecasts.feature_regression_v3
      }
    }));
    const targetVersionInputRow: VersionInputRow = {
      date: forecastTargetDate,
      actual: targetActualDay?.total ?? null,
      forecasts: {
        v0: targetForecasts[v0SourceKey],
        v1: targetForecasts.feature_regression_v1,
        v2: targetForecasts.feature_regression_v2,
        v3: targetForecasts.feature_regression_v3
      }
    };
    const v4Rows = buildV4Model(
      versionInputRows.some((row) => row.date === forecastTargetDate) ? versionInputRows : [...versionInputRows, targetVersionInputRow]
    );
    const v5Rows = buildV5Model(
      versionInputRows.some((row) => row.date === forecastTargetDate) ? versionInputRows : [...versionInputRows, targetVersionInputRow]
    );
    const v6Rows = buildV6Model(
      versionInputRows.some((row) => row.date === forecastTargetDate) ? versionInputRows : [...versionInputRows, targetVersionInputRow]
    );
    const targetV4Row = v4Rows.find((row) => row.date === forecastTargetDate) ?? null;
    const targetV5Row = v5Rows.find((row) => row.date === forecastTargetDate) ?? null;
    const targetV6Row = v6Rows.find((row) => row.date === forecastTargetDate) ?? null;
    const evaluationRowsByDate = new Map(evaluationRows.map((row) => [row.date, row]));
    const v5RowsByDate = new Map(v5Rows.map((row) => [row.date, row]));
    const v6RowsByDate = new Map(v6Rows.map((row) => [row.date, row]));
    const versionEvaluationRows: VersionEvaluationRow[] = v4Rows
      .filter((row): row is V4OutputRow & { actual: number } => row.actual !== null && row.date >= historyRangeStart && row.date <= historyRangeEnd)
      .map((row) => ({
        date: row.date,
        actual: row.actual,
        forecasts: {
          ...row.forecasts,
          v4: row.v4Forecast,
          v4_ensemble: row.v4EnsembleForecast,
          v5: v5RowsByDate.get(row.date)?.v5Forecast ?? null,
          v6: v6RowsByDate.get(row.date)?.v6Forecast ?? null,
          v7: evaluationRowsByDate.get(row.date)?.forecasts.feature_regression_v7 ?? null
        }
      }));
    const targetVersionForecasts: VersionForecastMap = {
      ...(targetV4Row?.forecasts ?? targetVersionInputRow.forecasts),
      v4: targetV4Row?.v4Forecast ?? null,
      v4_ensemble: targetV4Row?.v4EnsembleForecast ?? null,
      v5: targetV5Row?.v5Forecast ?? null,
      v6: targetV6Row?.v6Forecast ?? null,
      v7: targetForecasts.feature_regression_v7
    };
    const versionLeaderboard = evaluateModels(versionEvaluationRows, targetVersionForecasts);
    const currentVersionLeaderboard = rankCurrentVersionMetrics(versionLeaderboard);
    const bestVersionMetric = currentVersionLeaderboard[0] ?? versionLeaderboard[0] ?? null;
    const v0Metric = versionLeaderboard.find((metric) => metric.key === 'v0') ?? null;
    const bestAdvancedVersionMetric = currentVersionLeaderboard.find((metric) => metric.key !== 'v0') ?? versionLeaderboard.find((metric) => metric.key !== 'v0') ?? null;
    const adaptiveComparisonLeaderboard = currentVersionLeaderboard.filter((metric) => ['v0', 'v1', 'v2', 'v3', 'v5', 'v6', 'v7'].includes(metric.key));
    const bestAdaptiveOverallMetric = versionLeaderboard.filter((metric) => ['v0', 'v1', 'v2', 'v3', 'v5', 'v6', 'v7'].includes(metric.key))[0] ?? null;
    const bestAdaptiveRecent14Metric =
      [...adaptiveComparisonLeaderboard].sort((a, b) => {
        if (a.recent14.wape === null) return 1;
        if (b.recent14.wape === null) return -1;
        return a.recent14.wape - b.recent14.wape;
      })[0] ?? null;
    const versionImprovementVsBaseline =
      bestAdvancedVersionMetric !== null &&
      bestAdvancedVersionMetric.recent14.wape !== null &&
      v0Metric !== null &&
      v0Metric.recent14.wape !== null
        ? v0Metric.recent14.wape - bestAdvancedVersionMetric.recent14.wape
        : null;
    const featureImportanceRowsV1 = targetFeatureModelV1 === null ? [] : buildFeatureImportanceRows(targetFeatureModelV1.weights, FEATURE_NAMES, FEATURE_LABELS);
    const featureImportanceRowsV2 =
      targetFeatureModelV2 === null ? [] : buildFeatureImportanceRows(targetFeatureModelV2.weights, FEATURE_NAMES_V2, FEATURE_LABELS_V2);
    const featureImportanceRowsV3 =
      targetFeatureModelV3 === null ? [] : buildFeatureImportanceRows(targetFeatureModelV3.weights, FEATURE_NAMES_V3, FEATURE_LABELS_V3);
    const featureImportanceRowsV7 =
      targetFeatureModelV7 === null ? [] : buildFeatureImportanceRows(targetFeatureModelV7.weights, FEATURE_NAMES_V7, FEATURE_LABELS_V7);
    const importanceSumV1 = featureImportanceRowsV1.reduce((sum, row) => sum + row.importance, 0);
    const importanceSumV2 = featureImportanceRowsV2.reduce((sum, row) => sum + row.importance, 0);
    const importanceSumV3 = featureImportanceRowsV3.reduce((sum, row) => sum + row.importance, 0);
    const importanceSumV7 = featureImportanceRowsV7.reduce((sum, row) => sum + row.importance, 0);

    return {
      analysisDays,
      planningCoverageDays,
      evaluationRows,
      targetInput,
      targetActual: targetActualDay?.total ?? null,
      targetForecasts,
      targetFeatureModelV1,
      targetFeatureModelV2,
      targetFeatureModelV3,
      targetFeatureModelV7,
      targetV4Row,
      targetV5Row,
      targetV6Row,
      v0SourceKey,
      v0SourceLabel,
      v4Rows,
      v5Rows,
      v6Rows,
      versionEvaluationRows,
      versionLeaderboard,
      currentVersionLeaderboard,
      adaptiveComparisonLeaderboard,
      bestVersionMetric,
      bestAdaptiveOverallMetric,
      bestAdaptiveRecent14Metric,
      v0Metric,
      bestAdvancedVersionMetric,
      featureImportanceRowsV1: featureImportanceRowsV1.map((row) => ({
        ...row,
        importanceRatio: importanceSumV1 > 0 ? row.importance / importanceSumV1 : 0
      })),
      featureImportanceRowsV2: featureImportanceRowsV2.map((row) => ({
        ...row,
        importanceRatio: importanceSumV2 > 0 ? row.importance / importanceSumV2 : 0
      })),
      featureImportanceRowsV3: featureImportanceRowsV3.map((row) => ({
        ...row,
        importanceRatio: importanceSumV3 > 0 ? row.importance / importanceSumV3 : 0
      })),
      featureImportanceRowsV7: featureImportanceRowsV7.map((row) => ({
        ...row,
        importanceRatio: importanceSumV7 > 0 ? row.importance / importanceSumV7 : 0
      })),
      leaderboard,
      championScoreboard,
      bestMetric,
      bestBaselineMetric,
      featureMetricV1,
      featureMetricV2,
      featureMetricV3,
      featureMetricV7,
      bestFeatureMetric,
      improvementVsBaseline: versionImprovementVsBaseline
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
  const targetForecastValue = data.bestVersionMetric?.targetForecast ?? null;
  const targetDiff =
    data.targetActual !== null && targetForecastValue !== null ? data.targetActual - targetForecastValue : null;
  const getVersionLabel = (key: VersionKey | undefined) => {
    if (key === 'v4_ensemble') return 'V4E';
    if (key === 'v4') return 'V4';
    if (key === 'v5') return 'V5';
    if (key === 'v6') return 'V6';
    if (key === 'v7') return 'V7';
    return key?.toUpperCase() ?? 'V0';
  };
  const getLeaderboardModelName = (key: VersionKey) => {
    if (key === 'v0') return `${data.v0SourceLabel} (V0)`;
    if (key === 'v1') return 'Feature Regression V1';
    if (key === 'v2') return 'Flow + Weather + ITR';
    if (key === 'v3') return 'Stacked Context Model';
    if (key === 'v4') return 'V4 Champion';
    if (key === 'v4_ensemble') return 'V4 Ensemble';
    if (key === 'v5') return 'V5 Adaptive Blend';
    if (key === 'v6') return 'V6 Residual Blend';
    return 'V7 Promotion-Aware Model';
  };
  const bestVersionLabel = getVersionLabel(data.bestVersionMetric?.key);
  const bestFeatureVersionLabel = data.bestAdvancedVersionMetric ? getVersionLabel(data.bestAdvancedVersionMetric.key) : null;
  const recentRows = data.evaluationRows.slice(-14).reverse();
  const recentV5Rows = data.v5Rows.filter((row) => row.actual !== null).slice(-14).reverse();
  const versionMetricsByKey = new Map(data.versionLeaderboard.map((metric) => [metric.key, metric]));
  const versionComparisonRows: Array<{ key: VersionKey; label: string; champion: string }> = [
    { key: 'v0', label: 'V0', champion: data.v0SourceLabel },
    { key: 'v1', label: 'V1', champion: 'Feature Regression V1' },
    { key: 'v2', label: 'V2', champion: 'Flow + Weather + ITR' },
    { key: 'v3', label: 'V3', champion: 'Stacked Context Model' },
    {
      key: 'v4',
      label: 'V4',
      champion: data.targetV4Row?.championModel ? `${VERSION_LABELS[data.targetV4Row.championModel]} + bias correction` : '-'
    },
    { key: 'v4_ensemble', label: 'V4E', champion: 'Inverse 14-day error weights' },
    {
      key: 'v5',
      label: 'V5',
      champion: data.targetV5Row?.championModel
        ? data.targetV5Row.blendMode === 'blend'
          ? `${VERSION_LABELS[data.targetV5Row.championModel]} + recent14 blend`
          : `${VERSION_LABELS[data.targetV5Row.championModel]} + recent14 bias`
        : '-'
    },
    {
      key: 'v6',
      label: 'V6',
      champion: data.targetV6Row?.championModel
        ? data.targetV6Row.blendMode === 'blend'
          ? `${VERSION_LABELS[data.targetV6Row.championModel]} + residual blend`
          : `${VERSION_LABELS[data.targetV6Row.championModel]} + residual calibration`
        : '-'
    },
    { key: 'v7', label: 'V7', champion: 'Promotion-aware stacked regression' }
  ];
  const getAverageDiffHint = (key: VersionKey) => `${t('平均差异', 'Avg diff')} ${formatPercent(versionMetricsByKey.get(key)?.recent14.mape ?? null)}`;

  return (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={['inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em]', statusBadgeClass].join(' ')}>
            {isLocked ? t('只读', 'Read only') : 'Phase 2'}
          </div>
          <h2 className={['mt-4 font-display text-3xl tracking-[0.06em]', titleClass].join(' ')}>{t('预测模型', 'Prediction Model')}</h2>
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
            <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>Target forecast day</div>
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
          <div className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('冠军榜', 'Champion board')}</div>
                <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{t('历史日冠军积分', 'Historical daily winners')}</div>
              </div>
              <div className={['text-sm text-right', mutedClass].join(' ')}>
                <div>{formatNumber(data.evaluationRows.length)} {t('个历史样本日', 'historical days')}</div>
                <div className="mt-1">{t('每日 |差异%| 最小模型 +1 分', 'Lowest daily |variance %| gets +1 point')}</div>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className={tableHeaderClass}>
                    <th className="rounded-l-2xl px-4 py-3 text-left font-semibold">Model</th>
                    <th className="px-4 py-3 text-right font-semibold">{t('样本数', 'Samples')}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t('实际流入', 'Actual inbound')}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t('预测值', 'Target forecast')}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t('差异%', 'Variance %')}</th>
                    <th className="px-4 py-3 text-right font-semibold">Score</th>
                    <th className="rounded-r-2xl px-4 py-3 text-right font-semibold">{t('登顶率', 'Win rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.championScoreboard.map((row, index) => {
                    const rowCellClass = [
                      index < data.championScoreboard.length - 1 ? 'border-b px-4 py-3' : 'px-4 py-3',
                      cellClass
                    ].join(' ');

                    return (
                      <tr key={`champion-${row.key}`}>
                        <td className={[rowCellClass, 'font-semibold'].join(' ')}>{row.label}</td>
                        <td className={[rowCellClass, 'text-right'].join(' ')}>{formatNumber(row.samples)}</td>
                        <td className={[rowCellClass, 'text-right'].join(' ')}>{formatNumber(row.actualInbound)}</td>
                        <td className={[rowCellClass, 'text-right'].join(' ')}>{formatNumber(row.targetForecast)}</td>
                        <td className={[rowCellClass, 'text-right'].join(' ')}>{formatPercent(row.variance)}</td>
                        <td className={[rowCellClass, 'text-right font-semibold'].join(' ')}>{formatNumber(row.score)}</td>
                        <td className={[rowCellClass, 'text-right font-semibold'].join(' ')}>{formatPercent(row.toppingRate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
          <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('当前版本', 'Current versions')}</div>
          <div className="mt-4 grid gap-3">
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V0 Baseline Pack</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.bestBaselineMetric ? `${data.v0SourceLabel} champion - ${getAverageDiffHint('v0')}` : t('样本不足', 'Not enough samples')}
              </div>
            </div>
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V1 Feature Regression</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.targetFeatureModelV1
                  ? `${formatNumber(data.targetFeatureModelV1.sampleSize)} training samples - ${getAverageDiffHint('v1')}`
                  : 'Not enough samples to train yet.'}
              </div>
            </div>
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V2 Flow + Weather + ITR</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.targetFeatureModelV2
                  ? `${formatNumber(data.targetFeatureModelV2.sampleSize)} training samples - ${getAverageDiffHint('v2')}`
                  : 'Not enough samples to train yet.'}
              </div>
            </div>
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V3 Stacked Context Model</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.targetFeatureModelV3
                  ? `${formatNumber(data.targetFeatureModelV3.sampleSize)} training samples - ${getAverageDiffHint('v3')}`
                  : 'Not enough samples to train yet.'}
              </div>
            </div>
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V7 Promotion-Aware Model</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.targetFeatureModelV7
                  ? `${formatNumber(data.targetFeatureModelV7.sampleSize)} training samples - ${getAverageDiffHint('v7')}`
                  : 'Not enough promotion-aware samples to train V7 yet.'}
              </div>
            </div>
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V4 Champion Selector</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.targetV4Row
                  ? `${data.targetV4Row.championModel ? VERSION_LABELS[data.targetV4Row.championModel] : '-'} - ${t('偏差', 'bias')} ${formatPercent(data.targetV4Row.championBiasAverage7)} - ${getAverageDiffHint('v4')}`
                  : 'Not enough history to score yet.'}
              </div>
            </div>
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V4 Ensemble</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.targetV4Row
                  ? `Inverse 14-day error weights - bias ${formatPercent(data.targetV4Row.ensembleBiasAverage7)} - ${getAverageDiffHint('v4_ensemble')}`
                  : 'Not enough history to weight yet.'}
              </div>
            </div>
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V5 Adaptive Blend</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.targetV5Row
                  ? `${data.targetV5Row.championModel ? VERSION_LABELS[data.targetV5Row.championModel] : '-'} - adjustment ${formatPercent(data.targetV5Row.adjustmentRate)} - ${getAverageDiffHint('v5')}`
                  : 'Not enough history for dynamic adjustment yet.'}
              </div>
            </div>
            <div className={['rounded-2xl p-4', subPanelClass].join(' ')}>
              <div className={['text-sm font-semibold', titleClass].join(' ')}>V6 Residual Blend</div>
              <div className={['mt-2 text-sm', mutedClass].join(' ')}>
                {data.targetV6Row
                  ? `${data.targetV6Row.championModel ? VERSION_LABELS[data.targetV6Row.championModel] : '-'} - ${t('残差修正', 'residual correction')} ${formatPercent(data.targetV6Row.adjustmentRate)} - ${getAverageDiffHint('v6')}`
                  : 'Not enough history for residual calibration yet.'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={'Complete days'}
          value={formatNumber(data.analysisDays.length)}
          themeMode={themeMode}
        />
        <MetricCard
          label={'Planning coverage'}
          value={formatPercent(coverage, 0)}
          themeMode={themeMode}
        />
        <MetricCard
          label={'Best version'}
          value={bestVersionLabel}
          hint={data.bestVersionMetric ? `${data.bestVersionMetric.label} - 14D WAPE ${formatPercent(data.bestVersionMetric.recent14.wape)}` : '-'}
          themeMode={themeMode}
        />
        <MetricCard
          label={'Target forecast'}
          value={formatNumber(targetForecastValue)}
          hint={`${forecastTargetDate} - ${data.bestVersionMetric?.label ?? '-'} - 14D`}
          themeMode={themeMode}
        />
        <MetricCard
          label={'Actual inbound'}
          value={formatNumber(data.targetActual)}
          hint={`${t('差异', 'Difference')}: ${formatSignedNumber(targetDiff)}`}
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
                  <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{t('版本预测对比', 'Forecast version comparison')}</div>
                </div>
                <div className={['text-sm', mutedClass].join(' ')}>
                  {data.improvementVsBaseline === null
                    ? t('等待足够样本', 'Waiting for enough samples')
                    : data.improvementVsBaseline >= 0
                      ? `${bestFeatureVersionLabel ?? 'V1'} ${t('优于 baseline', 'beats baseline')} ${formatPercent(data.improvementVsBaseline)}`
                      : `${bestFeatureVersionLabel ?? 'V1'} ${t('落后 baseline', 'trails baseline')} ${formatPercent(Math.abs(data.improvementVsBaseline))}`}
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className={tableHeaderClass}>
                      <th className="rounded-l-2xl px-4 py-3 text-left font-semibold">Version</th>
                      <th className="px-4 py-3 text-left font-semibold">Champion</th>
                      <th className="px-4 py-3 text-right font-semibold">Samples</th>
                      <th className="px-4 py-3 text-right font-semibold">WAPE</th>
                      <th className="px-4 py-3 text-right font-semibold">Actual inbound</th>
                      <th className="px-4 py-3 text-right font-semibold">Target forecast</th>
                      <th className="rounded-r-2xl px-4 py-3 text-right font-semibold">Variance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versionComparisonRows.map((row, index) => {
                      const metric = versionMetricsByKey.get(row.key);
                      const targetForecast = metric?.targetForecast ?? null;
                      const variance =
                        data.targetActual !== null && targetForecast !== null && targetForecast > 0
                          ? (data.targetActual - targetForecast) / targetForecast
                          : null;
                      const rowCellClass = [
                        index < versionComparisonRows.length - 1 ? 'border-b px-4 py-3' : 'px-4 py-3',
                        cellClass
                      ].join(' ');

                      return (
                        <tr key={row.key}>
                          <td className={[rowCellClass, 'font-semibold'].join(' ')}>{row.label}</td>
                          <td className={rowCellClass}>{row.champion}</td>
                          <td className={[rowCellClass, 'text-right'].join(' ')}>{formatNumber(metric?.samples ?? null)}</td>
                          <td className={[rowCellClass, 'text-right'].join(' ')}>{formatPercent(metric?.wape ?? null)}</td>
                          <td className={[rowCellClass, 'text-right'].join(' ')}>{formatNumber(data.targetActual)}</td>
                          <td className={[rowCellClass, 'text-right'].join(' ')}>{formatNumber(metric?.targetForecast ?? null)}</td>
                          <td className={[rowCellClass, 'text-right'].join(' ')}>{formatPercent(variance)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('目标输入快照', 'Target input snapshot')}</div>
              <div className="mt-4 grid gap-3">
                {[
                  { label: t('Backlog', 'Backlog'), value: data.targetInput?.previous_day_backlog ?? 0 },
                  { label: t('Inventory', 'Inventory'), value: data.targetInput?.inventory_level ?? 0 },
                  { label: t('Capacity', 'Capacity'), value: data.targetInput?.full_day_capacity ?? 0 },
                  { label: t('Yesterday 00-14', 'Yesterday 00-14'), value: data.targetInput?.yesterday_inflow_00_14 ?? 0 },
                  { label: t('恶劣天气', 'Severe weather'), value: data.targetInput?.severe_weather ? t('是', 'Yes') : t('否', 'No') },
                  { label: t('大促', 'Major promotion'), value: data.targetInput?.major_promotion ? t('是', 'Yes') : t('否', 'No') },
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
                <div className={['text-sm', mutedClass].join(' ')}>
                  {formatNumber(data.versionEvaluationRows.length)} {t('个可评估样本日', 'evaluation days')} - {t('按最近14天WAPE排序', 'sorted by recent 14D WAPE')}
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className={tableHeaderClass}>
                      <th className="rounded-l-2xl px-4 py-3 text-left font-semibold">Model</th>
                      <th className="px-4 py-3 text-right font-semibold">{t('样本数', 'Samples')}</th>
                      <th className="px-4 py-3 text-right font-semibold">WAPE</th>
                      <th className="px-4 py-3 text-right font-semibold">MAPE</th>
                      <th className="px-4 py-3 text-right font-semibold">RMSE</th>
                      <th className="px-4 py-3 text-right font-semibold">{t('实际流入', 'Actual inbound')}</th>
                      <th className="px-4 py-3 text-right font-semibold">{t('预测值', 'Target forecast')}</th>
                      <th className="rounded-r-2xl px-4 py-3 text-right font-semibold">{t('差异%', 'Variance %')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.currentVersionLeaderboard.map((metric, index) => (
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
                            <span className="font-semibold">{getLeaderboardModelName(metric.key)}</span>
                          </div>
                        </td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(metric.recent14.samples)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.recent14.wape)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.recent14.mape)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(metric.recent14.rmse)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(data.targetActual)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(metric.targetForecast)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>
                          {formatPercent(
                            data.targetActual !== null && metric.targetForecast !== null && metric.targetForecast > 0
                              ? (data.targetActual - metric.targetForecast) / metric.targetForecast
                              : null
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('特征模型', 'Feature Models')}</div>
              <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{t('特征权重快照', 'Feature weight snapshot')}</div>
              <p className={['mt-2 text-sm leading-6', mutedClass].join(' ')}>
                {t(
                  'V1 保留 backlog / inventory / capacity 等运营特征；V2 只看历史流入、恶劣天气与库存周转率（ITR）相关特征；V3 再把 V1 / V2、7日基线预测和最近上下文做二层融合。',
                  'V1 keeps operational features like backlog / inventory / capacity; V2 only uses historical inflow, severe weather, and inventory turnover rate (ITR) features; V3 stacks V1, V2, the 7-day baseline, and recent context into a second-stage regression.'
                )}
              </p>
              <p className={['mt-2 text-sm leading-6', mutedClass].join(' ')}>
                {t('V7 在 V3 的上下文堆叠基础上额外引入大促信息。', 'V7 extends the stacked context model with major-promotion information.')}
              </p>
              <div className="mt-4 space-y-4">
                {[
                  {
                    key: 'v1',
                    title: 'V1 Feature Regression',
                    emptyText: 'Not enough complete samples yet to show V1 feature weights.',
                    rows: data.featureImportanceRowsV1
                  },
                  {
                    key: 'v2',
                    title: 'V2 Flow + Weather + ITR',
                    emptyText: 'Not enough complete samples yet to show V2 feature weights.',
                    rows: data.featureImportanceRowsV2
                  },
                  {
                    key: 'v3',
                    title: 'V3 Stacked Context Model',
                    emptyText: 'Not enough trainable V1 / V2 overlap yet to show V3 feature weights.',
                    rows: data.featureImportanceRowsV3
                  },
                  {
                    key: 'v7',
                    title: 'V7 Promotion-Aware Model',
                    emptyText: 'Not enough promotion-labeled overlap yet to show V7 feature weights.',
                    rows: data.featureImportanceRowsV7
                  }
                ].map((section) => (
                  <div key={section.key} className={['rounded-2xl p-4', subPanelClass].join(' ')}>
                    <div className={['text-sm font-semibold', titleClass].join(' ')}>{section.title}</div>
                    {section.rows.length ? (
                      <div className="mt-3 space-y-3">
                        {section.rows.map((row) => (
                          <div key={`${section.key}-${row.feature}`} className={['rounded-2xl px-4 py-3', isLight ? 'bg-slate-50' : 'bg-white/5'].join(' ')}>
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
                      <div className={['mt-3 rounded-2xl border px-4 py-4 text-sm', messageClass].join(' ')}>{section.emptyText}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('自适应模型评估', 'Adaptive model summary')}</div>
                  <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{t('V0-V3 与 V5-V7 对比', 'V0-V3 and V5-V7')}</div>
                </div>
                <div className={['text-sm text-right', mutedClass].join(' ')}>
                  <div>{t('整体最佳', 'Best overall')}: {data.bestAdaptiveOverallMetric?.label ?? '-'}</div>
                  <div className="mt-1">{t('近14天最佳', 'Best recent 14D')}: {data.bestAdaptiveRecent14Metric?.label ?? '-'}</div>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className={tableHeaderClass}>
                      <th className="rounded-l-2xl px-4 py-3 text-left font-semibold">Model</th>
                      <th className="px-4 py-3 text-right font-semibold">WAPE</th>
                      <th className="px-4 py-3 text-right font-semibold">MAPE</th>
                      <th className="px-4 py-3 text-right font-semibold">MAE</th>
                      <th className="px-4 py-3 text-right font-semibold">Bias</th>
                      <th className="px-4 py-3 text-right font-semibold">{t('近14天 WAPE', '14D WAPE')}</th>
                      <th className="px-4 py-3 text-right font-semibold">{t('近14天 MAPE', '14D MAPE')}</th>
                      <th className="px-4 py-3 text-right font-semibold">{t('近14天 MAE', '14D MAE')}</th>
                      <th className="rounded-r-2xl px-4 py-3 text-right font-semibold">{t('近14天 Bias', '14D Bias')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.adaptiveComparisonLeaderboard.map((metric) => (
                      <tr key={metric.key}>
                        <td className={['border-b px-4 py-3 font-semibold', cellClass].join(' ')}>{metric.label}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.wape)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.mape)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(metric.mae)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.bias)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.recent14.wape)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.recent14.mape)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(metric.recent14.mae)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(metric.recent14.bias)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={['rounded-[28px] p-5', panelClass].join(' ')}>
              <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('样例输入格式', 'Sample input dataframe')}</div>
              <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{t('V5 输入列', 'V5 input columns')}</div>
              <div className={['mt-4 rounded-2xl px-4 py-4 text-sm leading-7', subPanelClass, titleClass].join(' ')}>
                <div>`date`</div>
                <div>`actual`</div>
                <div>`V0_prediction`</div>
                <div>`V1_prediction`</div>
                <div>`V2_prediction`</div>
                <div>`V3_prediction`</div>
              </div>
              <div className={['mt-4 rounded-2xl border px-4 py-4 text-sm leading-6', messageClass].join(' ')}>
                <div>{t('示例', 'Example')}</div>
                <div className="mt-2 font-mono text-xs">2026-03-19 | 27688 | 35708 | 29784 | 30476 | 30455</div>
              </div>
            </div>
          </div>

          <div className={['mt-6 rounded-[28px] p-5', panelClass].join(' ')}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={['text-[11px] uppercase tracking-[0.22em]', mutedClass].join(' ')}>{t('V5 输出数据帧', 'V5 output dataframe')}</div>
                <div className={['mt-2 text-xl font-semibold', titleClass].join(' ')}>{t('最近14天明细', 'Recent 14-day output')}</div>
              </div>
              <div className={['text-sm', mutedClass].join(' ')}>{t('按日期滚动构建', 'Built sequentially by date')}</div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className={tableHeaderClass}>
                    <th className="rounded-l-2xl px-4 py-3 text-left font-semibold">{t('日期', 'Date')}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t('实际', 'Actual')}</th>
                    <th className="px-4 py-3 text-right font-semibold">V0</th>
                    <th className="px-4 py-3 text-right font-semibold">V1</th>
                    <th className="px-4 py-3 text-right font-semibold">V2</th>
                    <th className="px-4 py-3 text-right font-semibold">V3</th>
                    <th className="px-4 py-3 text-right font-semibold">APE V0</th>
                    <th className="px-4 py-3 text-right font-semibold">APE V1</th>
                    <th className="px-4 py-3 text-right font-semibold">APE V2</th>
                    <th className="px-4 py-3 text-right font-semibold">APE V3</th>
                    <th className="px-4 py-3 text-right font-semibold">P V0</th>
                    <th className="px-4 py-3 text-right font-semibold">P V1</th>
                    <th className="px-4 py-3 text-right font-semibold">P V2</th>
                    <th className="px-4 py-3 text-right font-semibold">P V3</th>
                    <th className="px-4 py-3 text-right font-semibold">S V0</th>
                    <th className="px-4 py-3 text-right font-semibold">S V1</th>
                    <th className="px-4 py-3 text-right font-semibold">S V2</th>
                    <th className="px-4 py-3 text-right font-semibold">S V3</th>
                    <th className="px-4 py-3 text-left font-semibold">{t('冠军', 'Champion')}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t('基础预测', 'Base')}</th>
                    <th className="px-4 py-3 text-right font-semibold">Adjustment</th>
                    <th className="px-4 py-3 text-right font-semibold">V5</th>
                    <th className="rounded-r-2xl px-4 py-3 text-right font-semibold">V5 error rate</th>
                  </tr>
                </thead>
                <tbody>
                  {recentV5Rows.map((row) => (
                    <tr key={`v5-${row.date}`}>
                      <td className={['border-b px-4 py-3', cellClass].join(' ')}>{row.date}</td>
                      <td className={['border-b px-4 py-3 text-right font-semibold', cellClass].join(' ')}>{formatNumber(row.actual)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.v0)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.v1)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.v2)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.v3)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(row.apes.v0)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(row.apes.v1)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(row.apes.v2)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(row.apes.v3)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{row.dailyPoints.v0}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{row.dailyPoints.v1}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{row.dailyPoints.v2}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{row.dailyPoints.v3}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{row.rollingScores14.v0}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{row.rollingScores14.v1}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{row.rollingScores14.v2}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{row.rollingScores14.v3}</td>
                      <td className={['border-b px-4 py-3', cellClass].join(' ')}>
                        {row.championModel
                          ? row.blendMode === 'blend' && row.runnerUpModel
                            ? `${VERSION_LABELS[row.championModel]} + ${VERSION_LABELS[row.runnerUpModel]}`
                            : VERSION_LABELS[row.championModel]
                          : '-'}
                      </td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.baseForecast)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(row.adjustmentRate)}</td>
                      <td className={['border-b px-4 py-3 text-right font-semibold', cellClass].join(' ')}>{formatNumber(row.v5Forecast)}</td>
                      <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatPercent(row.v5ErrorRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                      <th className="px-4 py-3 text-right font-semibold">V2</th>
                      <th className="px-4 py-3 text-right font-semibold">V3</th>
                      <th className="px-4 py-3 text-right font-semibold">V7</th>
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
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.feature_regression_v2)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.feature_regression_v3)}</td>
                        <td className={['border-b px-4 py-3 text-right', cellClass].join(' ')}>{formatNumber(row.forecasts.feature_regression_v7)}</td>
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
