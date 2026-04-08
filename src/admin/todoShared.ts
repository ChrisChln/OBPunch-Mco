export const TODO_TIMEZONE = 'America/New_York';
export const TODO_UPDATED_EVENT = 'ob-todo-updated';

export type TodoDeliveryMode = 'shared' | 'individual';
export type TodoStatus = 'open' | 'done' | 'pending_delete' | 'deleted';
export type TodoRecurrenceKind = 'none' | 'daily' | 'weekly' | 'monthly';

export type TodoMonthlyNthWeekday = {
  week: 1 | 2 | 3 | 4 | -1;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
};

export type TodoRecurrenceRule = {
  interval_days?: number;
  weekdays?: number[];
  month_days?: number[];
  nth_weekdays?: TodoMonthlyNthWeekday[];
};

export type TodoAssigneeInput = {
  user_id: string;
  user_email: string;
  display_name: string;
};

export type TodoLinkInput = {
  label: string;
  url: string;
  sort_order: number;
};

export type TodoItemLink = {
  id: string;
  label: string;
  url: string;
  sort_order: number;
};

export type TodoItemAssignee = {
  id: string;
  assignee_user_id: string;
  assignee_email: string;
  assignee_display_name: string;
};

export type TodoItemRecord = {
  id: string;
  template_id: string;
  title: string;
  content: string;
  due_at: string | null;
  instance_date: string | null;
  delivery_mode: TodoDeliveryMode;
  status: TodoStatus;
  creator_user_id: string;
  creator_email: string;
  creator_display_name: string;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completed_by_display: string | null;
  delete_requested_at: string | null;
  delete_requested_by_user_id: string | null;
  delete_requested_by_display: string | null;
  recurrence_kind: TodoRecurrenceKind;
  recurrence_rule: TodoRecurrenceRule;
  is_template_active: boolean;
  created_at: string;
  updated_at: string;
  assignees: TodoItemAssignee[];
  links: TodoItemLink[];
};

export const isValidDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());

const parseDateOnly = (dateOnly: string) => {
  const [year, month, day] = String(dateOnly ?? '').split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
};

const formatDateOnly = (value: Date) =>
  `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;

export const addDaysDateOnly = (dateOnly: string, amount: number) => {
  const next = parseDateOnly(dateOnly);
  next.setUTCDate(next.getUTCDate() + amount);
  return formatDateOnly(next);
};

export const diffDateOnlyDays = (from: string, to: string) => {
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
};

export const getDateOnlyInTimeZone = (value: string | Date, timeZone = TODO_TIMEZONE) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(typeof value === 'string' ? new Date(value) : value);

const getTimePartsInTimeZone = (value: string | Date, timeZone = TODO_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(typeof value === 'string' ? new Date(value) : value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    hour: Number(byType.hour ?? '0'),
    minute: Number(byType.minute ?? '0'),
    second: Number(byType.second ?? '0')
  };
};

const getDateTimePartsInTimeZone = (value: string | Date, timeZone = TODO_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(typeof value === 'string' ? new Date(value) : value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year ?? '0'),
    month: Number(byType.month ?? '0'),
    day: Number(byType.day ?? '0'),
    hour: Number(byType.hour ?? '0'),
    minute: Number(byType.minute ?? '0'),
    second: Number(byType.second ?? '0')
  };
};

export const getTodoInstanceDateFromDueAt = (dueAt: string | null, fallbackDateOnly?: string) => {
  const raw = String(dueAt ?? '').trim();
  if (!raw) return fallbackDateOnly && isValidDateOnly(fallbackDateOnly) ? fallbackDateOnly : null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallbackDateOnly && isValidDateOnly(fallbackDateOnly) ? fallbackDateOnly : null;
  return getDateOnlyInTimeZone(parsed);
};

const getIsoWeekday = (dateOnly: string) => {
  const weekday = parseDateOnly(dateOnly).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

const getDaysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const getNthWeekdayDate = (year: number, month: number, week: number, weekday: number) => {
  if (week === -1) {
    const lastDay = getDaysInMonth(year, month);
    for (let day = lastDay; day >= 1; day -= 1) {
      const dateOnly = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (getIsoWeekday(dateOnly) === weekday) return dateOnly;
    }
    return null;
  }

  let seen = 0;
  const daysInMonth = getDaysInMonth(year, month);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateOnly = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (getIsoWeekday(dateOnly) !== weekday) continue;
    seen += 1;
    if (seen === week) return dateOnly;
  }
  return null;
};

const uniqueNumbers = (values: number[], min: number, max: number) =>
  Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= min && value <= max)
    )
  ).sort((a, b) => a - b);

export const normalizeTodoLinks = (links: TodoLinkInput[]) =>
  links
    .map((item, index) => ({
      label: String(item.label ?? '').trim(),
      url: String(item.url ?? '').trim(),
      sort_order: Number.isFinite(item.sort_order) ? Number(item.sort_order) : index
    }))
    .filter((item) => item.label && item.url)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'en-US'))
    .map((item, index) => ({ ...item, sort_order: index }));

export const normalizeTodoAssignees = (assignees: TodoAssigneeInput[]) => {
  const byId = new Map<string, TodoAssigneeInput>();
  for (const item of assignees) {
    const userId = String(item.user_id ?? '').trim();
    if (!userId) continue;
    byId.set(userId, {
      user_id: userId,
      user_email: String(item.user_email ?? '').trim(),
      display_name: String(item.display_name ?? '').trim()
    });
  }
  return Array.from(byId.values()).sort((a, b) =>
    (a.display_name || a.user_email || a.user_id).localeCompare(b.display_name || b.user_email || b.user_id, 'en-US')
  );
};

export const isValidTodoUrl = (value: string) => /^https?:\/\/.+/i.test(String(value ?? '').trim());

export const validateTodoRecurrenceRule = (kind: TodoRecurrenceKind, rule: TodoRecurrenceRule): TodoRecurrenceRule => {
  if (kind === 'none') return {};

  if (kind === 'daily') {
    const interval = Math.max(1, Math.floor(Number(rule.interval_days ?? 1)));
    return { interval_days: interval };
  }

  if (kind === 'weekly') {
    const weekdays = uniqueNumbers(Array.isArray(rule.weekdays) ? rule.weekdays : [], 1, 7);
    if (!weekdays.length) throw new Error('Weekly recurrence requires at least one weekday.');
    return { weekdays };
  }

  const monthDays = uniqueNumbers(Array.isArray(rule.month_days) ? rule.month_days : [], 1, 31);
  const nthWeekdays = Array.isArray(rule.nth_weekdays)
    ? rule.nth_weekdays
        .map((item) => ({
          week: Number(item?.week) as TodoMonthlyNthWeekday['week'],
          weekday: Number(item?.weekday) as TodoMonthlyNthWeekday['weekday']
        }))
        .filter((item) => [-1, 1, 2, 3, 4].includes(item.week) && item.weekday >= 1 && item.weekday <= 7)
    : [];

  if (!monthDays.length && !nthWeekdays.length) {
    throw new Error('Monthly recurrence requires at least one month day or nth weekday rule.');
  }

  const uniqueNth = Array.from(new Map(nthWeekdays.map((item) => [`${item.week}-${item.weekday}`, item])).values()).sort((a, b) =>
    a.week === b.week ? a.weekday - b.weekday : a.week - b.week
  );
  return {
    month_days: monthDays,
    nth_weekdays: uniqueNth
  };
};

export const matchesTodoRecurrenceDate = (
  anchorDate: string,
  kind: TodoRecurrenceKind,
  rule: TodoRecurrenceRule,
  candidateDate: string
) => {
  if (!isValidDateOnly(anchorDate) || !isValidDateOnly(candidateDate)) return false;
  if (diffDateOnlyDays(anchorDate, candidateDate) < 0) return false;
  const normalizedRule = validateTodoRecurrenceRule(kind, rule);

  if (kind === 'none') return candidateDate === anchorDate;
  if (kind === 'daily') {
    const interval = Math.max(1, Number(normalizedRule.interval_days ?? 1));
    return diffDateOnlyDays(anchorDate, candidateDate) % interval === 0;
  }
  if (kind === 'weekly') {
    return (normalizedRule.weekdays ?? []).includes(getIsoWeekday(candidateDate));
  }

  const [year, month, day] = candidateDate.split('-').map(Number);
  if ((normalizedRule.month_days ?? []).includes(day)) return true;
  return (normalizedRule.nth_weekdays ?? []).some((entry) => getNthWeekdayDate(year, month, entry.week, entry.weekday) === candidateDate);
};

export const listTodoOccurrenceDates = (
  anchorDate: string,
  kind: TodoRecurrenceKind,
  rule: TodoRecurrenceRule,
  startExclusive: string,
  endInclusive: string
) => {
  if (!isValidDateOnly(anchorDate) || !isValidDateOnly(startExclusive) || !isValidDateOnly(endInclusive)) return [] as string[];
  if (diffDateOnlyDays(startExclusive, endInclusive) < 0) return [] as string[];
  const nextDates: string[] = [];
  let cursor = addDaysDateOnly(startExclusive, 1);
  let guard = 0;
  while (diffDateOnlyDays(cursor, endInclusive) >= 0 && guard < 5000) {
    if (matchesTodoRecurrenceDate(anchorDate, kind, rule, cursor)) nextDates.push(cursor);
    cursor = addDaysDateOnly(cursor, 1);
    guard += 1;
  }
  return nextDates;
};

export const buildTodoDueAtForInstance = (templateDueAt: string | null, instanceDate: string) => {
  const raw = String(templateDueAt ?? '').trim();
  if (!raw || !isValidDateOnly(instanceDate)) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const time = getTimePartsInTimeZone(parsed);
  const targetUtc = Date.UTC(
    Number(instanceDate.slice(0, 4)),
    Number(instanceDate.slice(5, 7)) - 1,
    Number(instanceDate.slice(8, 10)),
    time.hour,
    time.minute,
    time.second
  );
  let guess = new Date(targetUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getDateTimePartsInTimeZone(guess);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const diffMs = targetUtc - actualUtc;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }
  return guess.toISOString();
};

export const getTodoStatusLabel = (status: TodoStatus) => {
  if (status === 'done') return 'done';
  if (status === 'pending_delete') return 'pending_delete';
  if (status === 'deleted') return 'deleted';
  return 'open';
};
