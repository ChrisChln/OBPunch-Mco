export type ForecastModelRow = {
  weekday: number;
  hour_of_day: number;
  avg_share: number;
  stddev_share: number;
  sample_size?: number | null;
  lookback_days?: number | null;
  lookback_start?: string | null;
  lookback_end?: string | null;
};

export type ForecastResult = {
  forecast: number | null;
  lowerBound: number | null;
  upperBound: number | null;
  upperUnbounded: boolean;
  avgShare: number;
  stddevShare: number;
  sampleSize: number;
};

export const FORECAST_HOURS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
] as const;

export const getIsoWeekday = (value: Date) => {
  const day = value.getDay();
  return day === 0 ? 7 : day;
};

export const calculateForecast = (
  currentCumVolume: number,
  currentHour: number,
  weekday: number,
  coefficient?: ForecastModelRow | null
): ForecastResult => {
  const sanitizedVolume = Number.isFinite(currentCumVolume) ? Math.max(0, currentCumVolume) : 0;
  const avgShare = Number(coefficient?.avg_share ?? 0);
  const stddevShare = Number(coefficient?.stddev_share ?? 0);
  const sampleSize = Math.max(0, Number(coefficient?.sample_size ?? 0));

  if (!coefficient || coefficient.weekday !== weekday || coefficient.hour_of_day !== currentHour || !(avgShare > 0)) {
    return {
      forecast: null,
      lowerBound: null,
      upperBound: null,
      upperUnbounded: false,
      avgShare,
      stddevShare,
      sampleSize
    };
  }

  const forecast = sanitizedVolume / avgShare;
  const lowerDenominator = avgShare + stddevShare;
  const upperDenominator = avgShare - stddevShare;
  const lowerBound = lowerDenominator > 0 ? sanitizedVolume / lowerDenominator : null;
  const upperUnbounded = upperDenominator <= 0;
  const upperBound = upperUnbounded ? Number.POSITIVE_INFINITY : sanitizedVolume / upperDenominator;

  return {
    forecast,
    lowerBound,
    upperBound,
    upperUnbounded,
    avgShare,
    stddevShare,
    sampleSize
  };
};
