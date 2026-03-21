export type LateBaselineSource = 'personal' | 'team' | 'planned';
export type LateRoundingFamily = 'early_hour' | 'late_shift_points';

export type LateSample = {
  workDate: string;
  firstInMinutes: number;
};

export type LateBaseline = {
  learnedExpectedStartMinutesRaw: number;
  learnedExpectedStartMinutesRounded: number;
  guardrailExpectedStartMinutes: number;
  finalExpectedStartMinutes: number;
  source: LateBaselineSource;
  roundingFamily: LateRoundingFamily;
  sampleCount: number;
};

export type LateDecision = LateBaseline & {
  firstInMinutes: number;
  minutesLate: number;
  isLate: boolean;
};

export const LATE_BASELINE_SAMPLE_TARGET = 20;
export const LATE_BASELINE_MIN_PERSONAL_SAMPLES = 5;
export const LATE_BASELINE_MIN_TEAM_SAMPLES = 5;
export const LATE_GRACE_MINUTES = 10;
export const LATE_OUTLIER_MAX_DELTA_MINUTES = 180;
export const LATE_GUARDRAIL_BUFFER_MINUTES = 15;

const PICK_EARLY_START_A = 7 * 60;
const PICK_EARLY_START_B = 8 * 60;

export const roundLearnedBaselineMinutes = (value: number, shift: 'early' | 'late'): {
  roundedMinutes: number;
  roundingFamily: LateRoundingFamily;
} => {
  const minutes = Math.round(Number(value ?? 0));
  if (!Number.isFinite(minutes)) {
    return {
      roundedMinutes: 0,
      roundingFamily: shift === 'late' ? 'late_shift_points' : 'early_hour'
    };
  }
  if (shift === 'late') {
    return {
      roundedMinutes: minutes <= 16 * 60 ? 15 * 60 + 30 : 16 * 60 + 30,
      roundingFamily: 'late_shift_points'
    };
  }
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const roundedHour = minute <= 30 ? hour : hour + 1;
  return {
    roundedMinutes: roundedHour * 60,
    roundingFamily: 'early_hour'
  };
};

export const parseClockTextToMinutes = (value: string) => {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

export const formatClockMinutes = (value: number) => {
  const minutes = Math.round(Number(value ?? 0));
  if (!Number.isFinite(minutes) || minutes < 0) return '00:00';
  const normalized = minutes % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

export const getClockMinutesFromDate = (value: Date) => value.getHours() * 60 + value.getMinutes();

const getMedianMinutes = (values: number[]) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.round((left + right) / 2);
};

const toRecentSamples = (samples: LateSample[], limit: number) =>
  [...samples]
    .sort((a, b) => String(b.workDate).localeCompare(String(a.workDate)))
    .slice(0, Math.max(0, limit));

const filterOutliers = (samples: LateSample[], maxDeltaMinutes: number) => {
  if (samples.length <= 2) return samples;
  const rawMedian = getMedianMinutes(samples.map((item) => item.firstInMinutes));
  if (!Number.isFinite(rawMedian)) return samples;
  const filtered = samples.filter((item) => Math.abs(item.firstInMinutes - (rawMedian as number)) <= maxDeltaMinutes);
  return filtered.length > 0 ? filtered : samples;
};

const resolveBaselineFromSamples = (samples: LateSample[], options?: { sampleTarget?: number; outlierMaxDeltaMinutes?: number }) => {
  const recent = toRecentSamples(samples, options?.sampleTarget ?? LATE_BASELINE_SAMPLE_TARGET);
  const filtered = filterOutliers(recent, options?.outlierMaxDeltaMinutes ?? LATE_OUTLIER_MAX_DELTA_MINUTES);
  const expectedStartMinutes = getMedianMinutes(filtered.map((item) => item.firstInMinutes));
  if (!Number.isFinite(expectedStartMinutes)) return null;
  return {
    expectedStartMinutes: expectedStartMinutes as number,
    sampleCount: filtered.length
  };
};

export const resolvePlannedStartMinutes = (options: {
  shift: 'early' | 'late';
  position: string;
  fallbackPlannedStartMinutes: number;
  personalSamples: LateSample[];
  teamSamples: LateSample[];
  sampleTarget?: number;
  minPersonalSamples?: number;
  minTeamSamples?: number;
  outlierMaxDeltaMinutes?: number;
}) => {
  if (options.shift !== 'early' || String(options.position ?? '').trim().toLowerCase() !== 'pick') {
    return options.fallbackPlannedStartMinutes;
  }
  const sampleTarget = options.sampleTarget ?? LATE_BASELINE_SAMPLE_TARGET;
  const minPersonalSamples = options.minPersonalSamples ?? LATE_BASELINE_MIN_PERSONAL_SAMPLES;
  const minTeamSamples = options.minTeamSamples ?? LATE_BASELINE_MIN_TEAM_SAMPLES;
  const outlierMaxDeltaMinutes = options.outlierMaxDeltaMinutes ?? LATE_OUTLIER_MAX_DELTA_MINUTES;
  const chooseBand = (samples: LateSample[] | null, minSamples: number) => {
    if (!samples || samples.length === 0) return null;
    const baseline = resolveBaselineFromSamples(samples, { sampleTarget, outlierMaxDeltaMinutes });
    if (!baseline || baseline.sampleCount < minSamples) return null;
    const rounded = roundLearnedBaselineMinutes(baseline.expectedStartMinutes, 'early').roundedMinutes;
    return rounded <= PICK_EARLY_START_A ? PICK_EARLY_START_A : PICK_EARLY_START_B;
  };
  return (
    chooseBand(options.personalSamples, minPersonalSamples) ??
    chooseBand(options.teamSamples, minTeamSamples) ??
    options.fallbackPlannedStartMinutes
  );
};

export const resolveLateBaseline = (options: {
  personalSamples: LateSample[];
  teamSamples: LateSample[];
  shift: 'early' | 'late';
  plannedStartMinutes: number;
  guardrailBufferMinutes?: number;
  sampleTarget?: number;
  minPersonalSamples?: number;
  minTeamSamples?: number;
  outlierMaxDeltaMinutes?: number;
}): LateBaseline => {
  const sampleTarget = options.sampleTarget ?? LATE_BASELINE_SAMPLE_TARGET;
  const minPersonalSamples = options.minPersonalSamples ?? LATE_BASELINE_MIN_PERSONAL_SAMPLES;
  const minTeamSamples = options.minTeamSamples ?? LATE_BASELINE_MIN_TEAM_SAMPLES;
  const outlierMaxDeltaMinutes = options.outlierMaxDeltaMinutes ?? LATE_OUTLIER_MAX_DELTA_MINUTES;
  const guardrailExpectedStartMinutes = options.plannedStartMinutes + (options.guardrailBufferMinutes ?? LATE_GUARDRAIL_BUFFER_MINUTES);

  const personal = resolveBaselineFromSamples(options.personalSamples, {
    sampleTarget,
    outlierMaxDeltaMinutes
  });
  if (personal && personal.sampleCount >= minPersonalSamples) {
    const learnedExpectedStartMinutesRaw = personal.expectedStartMinutes;
    const rounded = roundLearnedBaselineMinutes(learnedExpectedStartMinutesRaw, options.shift);
    return {
      learnedExpectedStartMinutesRaw,
      learnedExpectedStartMinutesRounded: rounded.roundedMinutes,
      guardrailExpectedStartMinutes,
      finalExpectedStartMinutes: Math.min(rounded.roundedMinutes, guardrailExpectedStartMinutes),
      source: 'personal',
      roundingFamily: rounded.roundingFamily,
      sampleCount: personal.sampleCount
    };
  }

  const team = resolveBaselineFromSamples(options.teamSamples, {
    sampleTarget,
    outlierMaxDeltaMinutes
  });
  if (team && team.sampleCount >= minTeamSamples) {
    const learnedExpectedStartMinutesRaw = team.expectedStartMinutes;
    const rounded = roundLearnedBaselineMinutes(learnedExpectedStartMinutesRaw, options.shift);
    return {
      learnedExpectedStartMinutesRaw,
      learnedExpectedStartMinutesRounded: rounded.roundedMinutes,
      guardrailExpectedStartMinutes,
      finalExpectedStartMinutes: Math.min(rounded.roundedMinutes, guardrailExpectedStartMinutes),
      source: 'team',
      roundingFamily: rounded.roundingFamily,
      sampleCount: team.sampleCount
    };
  }

  return {
    learnedExpectedStartMinutesRaw: options.plannedStartMinutes,
    learnedExpectedStartMinutesRounded: options.plannedStartMinutes,
    guardrailExpectedStartMinutes,
    finalExpectedStartMinutes: options.plannedStartMinutes,
    source: 'planned',
    roundingFamily: options.shift === 'late' ? 'late_shift_points' : 'early_hour',
    sampleCount: 0
  };
};

export const evaluateLateDecision = (options: {
  firstInMinutes: number;
  personalSamples: LateSample[];
  teamSamples: LateSample[];
  shift: 'early' | 'late';
  plannedStartMinutes: number;
  guardrailBufferMinutes?: number;
  graceMinutes?: number;
  sampleTarget?: number;
  minPersonalSamples?: number;
  minTeamSamples?: number;
  outlierMaxDeltaMinutes?: number;
}): LateDecision => {
  const baseline = resolveLateBaseline(options);
  const minutesLate = Math.max(0, Math.round(options.firstInMinutes - baseline.finalExpectedStartMinutes));
  const graceMinutes = options.graceMinutes ?? LATE_GRACE_MINUTES;
  return {
    ...baseline,
    firstInMinutes: options.firstInMinutes,
    minutesLate,
    isLate: minutesLate > graceMinutes
  };
};
