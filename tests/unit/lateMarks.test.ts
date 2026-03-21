import { describe, expect, test } from 'vitest';
import {
  evaluateLateDecision,
  formatClockMinutes,
  parseClockTextToMinutes,
  resolvePlannedStartMinutes,
  roundLearnedBaselineMinutes,
  resolveLateBaseline
} from '../../src/admin/lateMarks';

describe('lateMarks', () => {
  test('parses and formats clock times', () => {
    expect(parseClockTextToMinutes('07:30')).toBe(450);
    expect(parseClockTextToMinutes('25:00')).toBeNull();
    expect(formatClockMinutes(450)).toBe('07:30');
  });

  test('uses personal median when enough personal samples exist', () => {
    const baseline = resolveLateBaseline({
      personalSamples: [
        { workDate: '2026-03-01', firstInMinutes: 420 },
        { workDate: '2026-03-02', firstInMinutes: 421 },
        { workDate: '2026-03-03', firstInMinutes: 422 },
        { workDate: '2026-03-04', firstInMinutes: 423 },
        { workDate: '2026-03-05', firstInMinutes: 424 }
      ],
      teamSamples: [{ workDate: '2026-03-01', firstInMinutes: 480 }],
      shift: 'early',
      plannedStartMinutes: 480
    });
    expect(baseline).toEqual({
      learnedExpectedStartMinutesRaw: 422,
      learnedExpectedStartMinutesRounded: 420,
      guardrailExpectedStartMinutes: 495,
      finalExpectedStartMinutes: 420,
      source: 'personal',
      roundingFamily: 'early_hour',
      sampleCount: 5
    });
  });

  test('falls back to team baseline when personal sample is insufficient', () => {
    const baseline = resolveLateBaseline({
      personalSamples: [{ workDate: '2026-03-01', firstInMinutes: 420 }],
      teamSamples: [
        { workDate: '2026-03-01', firstInMinutes: 479 },
        { workDate: '2026-03-02', firstInMinutes: 480 },
        { workDate: '2026-03-03', firstInMinutes: 481 },
        { workDate: '2026-03-04', firstInMinutes: 482 },
        { workDate: '2026-03-05', firstInMinutes: 483 }
      ],
      shift: 'early',
      plannedStartMinutes: 450
    });
    expect(baseline).toEqual({
      learnedExpectedStartMinutesRaw: 481,
      learnedExpectedStartMinutesRounded: 480,
      guardrailExpectedStartMinutes: 465,
      finalExpectedStartMinutes: 465,
      source: 'team',
      roundingFamily: 'early_hour',
      sampleCount: 5
    });
  });

  test('falls back to planned start when both personal and team history are insufficient', () => {
    const baseline = resolveLateBaseline({
      personalSamples: [],
      teamSamples: [],
      shift: 'early',
      plannedStartMinutes: 450
    });
    expect(baseline).toEqual({
      learnedExpectedStartMinutesRaw: 450,
      learnedExpectedStartMinutesRounded: 450,
      guardrailExpectedStartMinutes: 465,
      finalExpectedStartMinutes: 450,
      source: 'planned',
      roundingFamily: 'early_hour',
      sampleCount: 0
    });
  });

  test('ignores obvious outliers before taking the median', () => {
    const baseline = resolveLateBaseline({
      personalSamples: [
        { workDate: '2026-03-01', firstInMinutes: 420 },
        { workDate: '2026-03-02', firstInMinutes: 421 },
        { workDate: '2026-03-03', firstInMinutes: 422 },
        { workDate: '2026-03-04', firstInMinutes: 423 },
        { workDate: '2026-03-05', firstInMinutes: 424 },
        { workDate: '2026-03-05', firstInMinutes: 900 }
      ],
      teamSamples: [],
      shift: 'early',
      plannedStartMinutes: 480
    });
    expect(baseline.learnedExpectedStartMinutesRaw).toBe(422);
    expect(baseline.learnedExpectedStartMinutesRounded).toBe(420);
    expect(baseline.finalExpectedStartMinutes).toBe(420);
    expect(baseline.source).toBe('personal');
    expect(baseline.sampleCount).toBe(5);
  });

  test('marks late only when first IN exceeds baseline by more than 10 minutes', () => {
    const common = {
      personalSamples: [
        { workDate: '2026-03-01', firstInMinutes: 420 },
        { workDate: '2026-03-02', firstInMinutes: 420 },
        { workDate: '2026-03-03', firstInMinutes: 420 },
        { workDate: '2026-03-04', firstInMinutes: 420 },
        { workDate: '2026-03-05', firstInMinutes: 420 }
      ],
      teamSamples: [],
      shift: 'early',
      plannedStartMinutes: 480
    };
    expect(evaluateLateDecision({ ...common, firstInMinutes: 429 }).isLate).toBe(false);
    expect(evaluateLateDecision({ ...common, firstInMinutes: 430 }).isLate).toBe(false);
    const late = evaluateLateDecision({ ...common, firstInMinutes: 431 });
    expect(late.isLate).toBe(true);
    expect(late.minutesLate).toBe(11);
    expect(late.source).toBe('personal');
  });

  test('caps learned baseline at planned start plus 15 minutes', () => {
    const decision = evaluateLateDecision({
      personalSamples: [
        { workDate: '2026-03-01', firstInMinutes: 500 },
        { workDate: '2026-03-02', firstInMinutes: 500 },
        { workDate: '2026-03-03', firstInMinutes: 500 },
        { workDate: '2026-03-04', firstInMinutes: 500 },
        { workDate: '2026-03-05', firstInMinutes: 500 }
      ],
      teamSamples: [],
      shift: 'early',
      plannedStartMinutes: 480,
      firstInMinutes: 506
    });
    expect(decision.learnedExpectedStartMinutesRaw).toBe(500);
    expect(decision.learnedExpectedStartMinutesRounded).toBe(480);
    expect(decision.guardrailExpectedStartMinutes).toBe(495);
    expect(decision.finalExpectedStartMinutes).toBe(480);
    expect(decision.minutesLate).toBe(26);
    expect(decision.isLate).toBe(true);
  });

  test('rounds early shift to hour with ties staying in previous bucket', () => {
    expect(roundLearnedBaselineMinutes(8 * 60 + 20, 'early')).toEqual({ roundedMinutes: 8 * 60, roundingFamily: 'early_hour' });
    expect(roundLearnedBaselineMinutes(8 * 60 + 29, 'early')).toEqual({ roundedMinutes: 8 * 60, roundingFamily: 'early_hour' });
    expect(roundLearnedBaselineMinutes(8 * 60 + 30, 'early')).toEqual({ roundedMinutes: 8 * 60, roundingFamily: 'early_hour' });
    expect(roundLearnedBaselineMinutes(8 * 60 + 50, 'early')).toEqual({ roundedMinutes: 9 * 60, roundingFamily: 'early_hour' });
    expect(roundLearnedBaselineMinutes(8 * 60 + 59, 'early')).toEqual({ roundedMinutes: 9 * 60, roundingFamily: 'early_hour' });
  });

  test('rounds late shift only to 15:30 or 16:30 with ties staying in previous bucket', () => {
    expect(roundLearnedBaselineMinutes(15 * 60 + 40, 'late')).toEqual({ roundedMinutes: 15 * 60 + 30, roundingFamily: 'late_shift_points' });
    expect(roundLearnedBaselineMinutes(15 * 60 + 59, 'late')).toEqual({ roundedMinutes: 15 * 60 + 30, roundingFamily: 'late_shift_points' });
    expect(roundLearnedBaselineMinutes(16 * 60, 'late')).toEqual({ roundedMinutes: 15 * 60 + 30, roundingFamily: 'late_shift_points' });
    expect(roundLearnedBaselineMinutes(16 * 60 + 1, 'late')).toEqual({ roundedMinutes: 16 * 60 + 30, roundingFamily: 'late_shift_points' });
    expect(roundLearnedBaselineMinutes(16 * 60 + 20, 'late')).toEqual({ roundedMinutes: 16 * 60 + 30, roundingFamily: 'late_shift_points' });
  });

  test('resolves early pick planned start to 08:00 when history clusters near 08:00', () => {
    expect(
      resolvePlannedStartMinutes({
        shift: 'early',
        position: 'Pick',
        fallbackPlannedStartMinutes: 7 * 60,
        personalSamples: [
          { workDate: '2026-03-01', firstInMinutes: 7 * 60 + 54 },
          { workDate: '2026-03-02', firstInMinutes: 7 * 60 + 56 },
          { workDate: '2026-03-03', firstInMinutes: 7 * 60 + 57 },
          { workDate: '2026-03-04', firstInMinutes: 7 * 60 + 58 },
          { workDate: '2026-03-05', firstInMinutes: 8 * 60 }
        ],
        teamSamples: []
      })
    ).toBe(8 * 60);
  });

  test('resolves early pick planned start to 07:00 when history clusters near 07:00', () => {
    expect(
      resolvePlannedStartMinutes({
        shift: 'early',
        position: 'Pick',
        fallbackPlannedStartMinutes: 7 * 60,
        personalSamples: [
          { workDate: '2026-03-01', firstInMinutes: 7 * 60 + 3 },
          { workDate: '2026-03-02', firstInMinutes: 7 * 60 + 5 },
          { workDate: '2026-03-03', firstInMinutes: 7 * 60 + 8 },
          { workDate: '2026-03-04', firstInMinutes: 7 * 60 + 10 },
          { workDate: '2026-03-05', firstInMinutes: 7 * 60 + 12 }
        ],
        teamSamples: []
      })
    ).toBe(7 * 60);
  });
});
