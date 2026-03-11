import { describe, expect, test } from 'vitest';
import {
  activatePlannedScheduleNote,
  buildDailyPlannedActivationUpserts,
  buildWeeklyRolloverUpserts,
  normalizeScheduleNoteForWeeklyReset,
  preserveScheduleNoteForWeekRollover,
  shouldActivateDailyPlannedStates,
  shouldRunWeeklyScheduleReset,
  shouldRunWeeklyScheduleRollover
} from '../../src/admin/scheduleWeek';

const REST_NOTE = '__rest__';
const TEMP_WORK_NOTE = '__temp_work__';
const TEMP_REST_NOTE = '__temp_rest__';
const PLANNED_TEMP_WORK_NOTE = '__planned_temp_work__';
const PLANNED_LEAVE_NOTE = '__planned_leave__';
const PLANNED_TEMP_REST_NOTE = '__planned_temp_rest__';
const mondayAfterFive = new Date('2026-03-09T05:01:00');
const mondayBeforeFive = new Date('2026-03-09T04:59:59');
const nextMondayAfterFive = new Date('2026-03-16T05:01:00');
const sundayNight = new Date('2026-03-08T23:30:00');
const tuesdayMorning = new Date('2026-03-10T09:00:00');
const sixAmMinusOneSecond = new Date('2026-03-10T05:59:59');
const sixAmPlusOneMinute = new Date('2026-03-10T06:01:00');

describe('schedule week note handling', () => {
  test('weekly reset only runs on Monday after 05:00', () => {
    expect(
      shouldRunWeeklyScheduleReset({
        now: sundayNight,
        inFlight: false,
        doneWeek: '',
        existingWeek: ''
      })
    ).toEqual({ shouldRun: false, weekStart: '2026-03-02' });

    expect(
      shouldRunWeeklyScheduleReset({
        now: mondayBeforeFive,
        inFlight: false,
        doneWeek: '',
        existingWeek: ''
      })
    ).toEqual({ shouldRun: false, weekStart: '2026-03-09' });

    expect(
      shouldRunWeeklyScheduleReset({
        now: tuesdayMorning,
        inFlight: false,
        doneWeek: '',
        existingWeek: ''
      })
    ).toEqual({ shouldRun: false, weekStart: '2026-03-09' });

    expect(
      shouldRunWeeklyScheduleReset({
        now: mondayAfterFive,
        inFlight: false,
        doneWeek: '',
        existingWeek: ''
      })
    ).toEqual({ shouldRun: true, weekStart: '2026-03-09' });
  });

  test('weekly reset does not rerun when already in flight or marked done', () => {
    expect(
      shouldRunWeeklyScheduleReset({
        now: mondayAfterFive,
        inFlight: true,
        doneWeek: '',
        existingWeek: ''
      }).shouldRun
    ).toBe(false);

    expect(
      shouldRunWeeklyScheduleReset({
        now: mondayAfterFive,
        inFlight: false,
        doneWeek: '2026-03-09',
        existingWeek: ''
      }).shouldRun
    ).toBe(false);

    expect(
      shouldRunWeeklyScheduleReset({
        now: mondayAfterFive,
        inFlight: false,
        doneWeek: '',
        existingWeek: '2026-03-09'
      }).shouldRun
    ).toBe(false);
  });

  test('weekly reset can run again for a new week after the previous week was completed', () => {
    expect(
      shouldRunWeeklyScheduleReset({
        now: nextMondayAfterFive,
        inFlight: false,
        doneWeek: '2026-03-09',
        existingWeek: '2026-03-09'
      })
    ).toEqual({ shouldRun: true, weekStart: '2026-03-16' });
  });

  test('weekly reset converts transient notes back to base schedule states', () => {
    expect(normalizeScheduleNoteForWeeklyReset(TEMP_REST_NOTE, REST_NOTE, TEMP_WORK_NOTE, TEMP_REST_NOTE)).toBeNull();
    expect(normalizeScheduleNoteForWeeklyReset(TEMP_WORK_NOTE, REST_NOTE, TEMP_WORK_NOTE, TEMP_REST_NOTE)).toBe(REST_NOTE);
    expect(normalizeScheduleNoteForWeeklyReset(REST_NOTE, REST_NOTE, TEMP_WORK_NOTE, TEMP_REST_NOTE)).toBe(REST_NOTE);
    expect(normalizeScheduleNoteForWeeklyReset(null, REST_NOTE, TEMP_WORK_NOTE, TEMP_REST_NOTE)).toBeNull();
  });

  test('weekly reset is idempotent when triggered multiple times in the same week', () => {
    const sourceNotes = [TEMP_REST_NOTE, TEMP_WORK_NOTE, REST_NOTE, null];
    const runReset = (notes: Array<string | null>) =>
      notes.map((note) => normalizeScheduleNoteForWeeklyReset(note, REST_NOTE, TEMP_WORK_NOTE, TEMP_REST_NOTE));

    const firstPass = runReset(sourceNotes);
    const secondPass = runReset(firstPass);

    expect(firstPass).toEqual([null, REST_NOTE, REST_NOTE, null]);
    expect(secondPass).toEqual(firstPass);
  });

  test('week rollover preserves transient notes instead of normalizing them again', () => {
    expect(preserveScheduleNoteForWeekRollover(TEMP_REST_NOTE)).toBe(TEMP_REST_NOTE);
    expect(preserveScheduleNoteForWeekRollover(TEMP_WORK_NOTE)).toBe(TEMP_WORK_NOTE);
    expect(preserveScheduleNoteForWeekRollover(REST_NOTE)).toBe(REST_NOTE);
    expect(preserveScheduleNoteForWeekRollover(null)).toBeNull();
  });

  test('week rollover only fills missing current-week rows and does not overwrite existing ones', () => {
    const result = buildWeeklyRolloverUpserts(
      [
        {
          staff_id: 'US001',
          date: '2026-03-16',
          position: 'Pick',
          note: TEMP_WORK_NOTE,
          operator: 'planner@example.com'
        },
        {
          staff_id: 'US002',
          date: '2026-03-17',
          position: 'Pack',
          note: TEMP_REST_NOTE,
          operator: 'planner@example.com'
        }
      ],
      [
        {
          staff_id: 'US001',
          date: '2026-03-09'
        }
      ],
      '2026-03-09T05:01:00.000Z'
    );

    expect(result).toEqual([
      {
        staff_id: 'US002',
        date: '2026-03-10',
        position: 'Pack',
        note: TEMP_REST_NOTE,
        operator: 'planner@example.com',
        updated_at: '2026-03-09T05:01:00.000Z'
      }
    ]);
  });

  test('week rollover skips rows with missing position', () => {
    const result = buildWeeklyRolloverUpserts(
      [
        {
          staff_id: 'US003',
          date: '2026-03-18',
          position: null,
          note: TEMP_WORK_NOTE,
          operator: 'planner@example.com'
        }
      ],
      [],
      '2026-03-09T05:01:00.000Z'
    );

    expect(result).toEqual([]);
  });

  test('week rollover uses the same Monday-after-05:00 gate and done markers', () => {
    expect(
      shouldRunWeeklyScheduleRollover({
        now: mondayBeforeFive,
        inFlight: false,
        doneWeek: '',
        existingWeek: ''
      }).shouldRun
    ).toBe(false);

    expect(
      shouldRunWeeklyScheduleRollover({
        now: mondayAfterFive,
        inFlight: false,
        doneWeek: '2026-03-09',
        existingWeek: ''
      }).shouldRun
    ).toBe(false);

    expect(
      shouldRunWeeklyScheduleRollover({
        now: mondayAfterFive,
        inFlight: false,
        doneWeek: '',
        existingWeek: '2026-03-09'
      }).shouldRun
    ).toBe(false);

    expect(
      shouldRunWeeklyScheduleRollover({
        now: mondayAfterFive,
        inFlight: false,
        doneWeek: '',
        existingWeek: ''
      })
    ).toEqual({ shouldRun: true, weekStart: '2026-03-09' });
  });

  test('week rollover can run again on a later Monday after an earlier week was marked complete', () => {
    expect(
      shouldRunWeeklyScheduleRollover({
        now: nextMondayAfterFive,
        inFlight: false,
        doneWeek: '2026-03-09',
        existingWeek: '2026-03-09'
      })
    ).toEqual({ shouldRun: true, weekStart: '2026-03-16' });
  });

  test('daily planned-state activation only runs after 06:00 and once per day', () => {
    expect(
      shouldActivateDailyPlannedStates({
        now: sixAmMinusOneSecond,
        inFlight: false,
        doneDate: '',
        existingDate: '',
        triggerHour: 6
      })
    ).toEqual({ shouldRun: false, dateKey: '2026-03-10' });

    expect(
      shouldActivateDailyPlannedStates({
        now: sixAmPlusOneMinute,
        inFlight: false,
        doneDate: '',
        existingDate: '',
        triggerHour: 6
      })
    ).toEqual({ shouldRun: true, dateKey: '2026-03-10' });

    expect(
      shouldActivateDailyPlannedStates({
        now: sixAmPlusOneMinute,
        inFlight: false,
        doneDate: '2026-03-10',
        existingDate: '',
        triggerHour: 6
      }).shouldRun
    ).toBe(false);

    expect(
      shouldActivateDailyPlannedStates({
        now: sixAmPlusOneMinute,
        inFlight: false,
        doneDate: '',
        existingDate: '2026-03-10',
        triggerHour: 6
      }).shouldRun
    ).toBe(false);
  });

  test('daily planned-state activation converts planned notes into active day-of notes', () => {
    expect(
      activatePlannedScheduleNote(
        PLANNED_TEMP_WORK_NOTE,
        TEMP_WORK_NOTE,
        REST_NOTE,
        TEMP_REST_NOTE,
        PLANNED_TEMP_WORK_NOTE,
        PLANNED_LEAVE_NOTE,
        PLANNED_TEMP_REST_NOTE
      )
    ).toBe(TEMP_WORK_NOTE);
    expect(
      activatePlannedScheduleNote(
        PLANNED_LEAVE_NOTE,
        TEMP_WORK_NOTE,
        '__leave__',
        TEMP_REST_NOTE,
        PLANNED_TEMP_WORK_NOTE,
        PLANNED_LEAVE_NOTE,
        PLANNED_TEMP_REST_NOTE
      )
    ).toBe('__leave__');
    expect(
      activatePlannedScheduleNote(
        PLANNED_TEMP_REST_NOTE,
        TEMP_WORK_NOTE,
        '__leave__',
        TEMP_REST_NOTE,
        PLANNED_TEMP_WORK_NOTE,
        PLANNED_LEAVE_NOTE,
        PLANNED_TEMP_REST_NOTE
      )
    ).toBe(TEMP_REST_NOTE);
    expect(
      activatePlannedScheduleNote(
        TEMP_REST_NOTE,
        TEMP_WORK_NOTE,
        '__leave__',
        TEMP_REST_NOTE,
        PLANNED_TEMP_WORK_NOTE,
        PLANNED_LEAVE_NOTE,
        PLANNED_TEMP_REST_NOTE
      )
    ).toBe(TEMP_REST_NOTE);
  });

  test('daily planned-state activation catches up overdue planned rows when the 06:00 window was missed', () => {
    expect(
      buildDailyPlannedActivationUpserts(
        [
          { staff_id: 'US001', date: '2026-03-09', position: 'Pick', note: PLANNED_LEAVE_NOTE, operator: 'planner@example.com' },
          { staff_id: 'US002', date: '2026-03-10', position: 'Pack', note: PLANNED_TEMP_REST_NOTE, operator: 'planner@example.com' },
          { staff_id: 'US003', date: '2026-03-11', position: 'Rebin', note: PLANNED_TEMP_WORK_NOTE, operator: 'planner@example.com' }
        ],
        '2026-03-10',
        '2026-03-10T06:01:00.000Z',
        TEMP_WORK_NOTE,
        '__leave__',
        TEMP_REST_NOTE,
        PLANNED_TEMP_WORK_NOTE,
        PLANNED_LEAVE_NOTE,
        PLANNED_TEMP_REST_NOTE
      )
    ).toEqual([
      {
        staff_id: 'US001',
        date: '2026-03-09',
        position: 'Pick',
        note: '__leave__',
        operator: 'planner@example.com',
        updated_at: '2026-03-10T06:01:00.000Z'
      },
      {
        staff_id: 'US002',
        date: '2026-03-10',
        position: 'Pack',
        note: TEMP_REST_NOTE,
        operator: 'planner@example.com',
        updated_at: '2026-03-10T06:01:00.000Z'
      }
    ]);
  });

  test('daily planned-state activation skips rows with missing position', () => {
    expect(
      buildDailyPlannedActivationUpserts(
        [{ staff_id: 'US001', date: '2026-03-10', note: PLANNED_LEAVE_NOTE, operator: 'planner@example.com' }],
        '2026-03-10',
        '2026-03-10T06:01:00.000Z',
        TEMP_WORK_NOTE,
        '__leave__',
        TEMP_REST_NOTE,
        PLANNED_TEMP_WORK_NOTE,
        PLANNED_LEAVE_NOTE,
        PLANNED_TEMP_REST_NOTE
      )
    ).toEqual([]);
  });
});
