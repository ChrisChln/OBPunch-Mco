export type ForecastVarianceTone = 'danger' | 'success' | 'neutral';

export type ForecastVariancePresentation = {
  variance: number | null;
  differenceQuantity: number | null;
  tone: ForecastVarianceTone;
};

const normalizeForThresholdComparison = (value: number) => Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;

export const getForecastVariancePresentation = (
  forecast: number | null | undefined,
  actual: number | null | undefined
): ForecastVariancePresentation => {
  if (
    forecast === null ||
    forecast === undefined ||
    actual === null ||
    actual === undefined ||
    !Number.isFinite(forecast) ||
    !Number.isFinite(actual) ||
    forecast <= 0
  ) {
    return { variance: null, differenceQuantity: null, tone: 'neutral' };
  }

  const differenceQuantity = actual - forecast;
  const variance = differenceQuantity / forecast;
  const absoluteVariance = normalizeForThresholdComparison(Math.abs(variance));
  const tone: ForecastVarianceTone = absoluteVariance > 0.08 ? 'danger' : absoluteVariance < 0.03 ? 'success' : 'neutral';

  return { variance, differenceQuantity, tone };
};

export const formatSignedDifferenceQuantity = (value: number | null): string => {
  if (value === null) return '-';
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  return value > 0 ? `+${formatted}` : formatted;
};
