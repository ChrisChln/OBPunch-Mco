import { describe, expect, it } from 'vitest';
import {
  buildTodoDueAtForInstance,
  isValidTodoUrl,
  listTodoOccurrenceDates,
  matchesTodoRecurrenceDate,
  normalizeTodoLinks,
  validateTodoRecurrenceRule
} from '../../src/admin/todoShared';

describe('todoShared', () => {
  it('validates and normalizes recurrence rules', () => {
    expect(validateTodoRecurrenceRule('daily', { interval_days: 0 })).toEqual({ interval_days: 1 });
    expect(validateTodoRecurrenceRule('weekly', { weekdays: [3, 1, 3, 7] })).toEqual({ weekdays: [1, 3, 7] });
    expect(validateTodoRecurrenceRule('monthly', { month_days: [15, 1, 15], nth_weekdays: [{ week: -1, weekday: 5 }] })).toEqual({
      month_days: [1, 15],
      nth_weekdays: [{ week: -1, weekday: 5 }]
    });
  });

  it('matches recurrence dates across daily weekly and monthly rules', () => {
    expect(matchesTodoRecurrenceDate('2026-04-07', 'daily', { interval_days: 2 }, '2026-04-09')).toBe(true);
    expect(matchesTodoRecurrenceDate('2026-04-07', 'weekly', { weekdays: [2, 4] }, '2026-04-09')).toBe(true);
    expect(matchesTodoRecurrenceDate('2026-04-07', 'monthly', { month_days: [10] }, '2026-05-10')).toBe(true);
    expect(matchesTodoRecurrenceDate('2026-04-07', 'monthly', { nth_weekdays: [{ week: 2, weekday: 1 }] }, '2026-05-11')).toBe(true);
  });

  it('lists occurrence dates in a range', () => {
    expect(listTodoOccurrenceDates('2026-04-07', 'daily', { interval_days: 2 }, '2026-04-07', '2026-04-13')).toEqual([
      '2026-04-09',
      '2026-04-11',
      '2026-04-13'
    ]);
    expect(listTodoOccurrenceDates('2026-04-07', 'weekly', { weekdays: [3, 5] }, '2026-04-07', '2026-04-17')).toEqual([
      '2026-04-08',
      '2026-04-10',
      '2026-04-15',
      '2026-04-17'
    ]);
  });

  it('validates links and preserves sort order', () => {
    expect(isValidTodoUrl('https://example.com')).toBe(true);
    expect(isValidTodoUrl('ftp://example.com')).toBe(false);
    expect(
      normalizeTodoLinks([
        { label: 'Docs', url: 'https://docs.example.com', sort_order: 5 },
        { label: 'Board', url: 'https://board.example.com', sort_order: 1 }
      ])
    ).toEqual([
      { label: 'Board', url: 'https://board.example.com', sort_order: 0 },
      { label: 'Docs', url: 'https://docs.example.com', sort_order: 1 }
    ]);
  });

  it('builds due time for later instances', () => {
    expect(buildTodoDueAtForInstance('2026-04-07T13:30:00.000Z', '2026-04-09')).toBe('2026-04-09T13:30:00.000Z');
  });
});
