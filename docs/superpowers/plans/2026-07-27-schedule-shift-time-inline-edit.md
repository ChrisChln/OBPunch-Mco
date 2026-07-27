# Schedule Shift Time Inline Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a schedule-table shift-time column that edits the employee-owned `ob_employees.shift_time` value inline.

**Architecture:** A focused `ScheduleShiftTimeCell` component owns keyboard, focus, draft, and saving UI state. A small pure helper normalizes and compares values. `AdminAppPage` remains responsible for permission checks, Supabase persistence, local employee-state synchronization, status messages, and audit writes.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, Supabase JS v2, Vitest, Testing Library.

---

## File Structure

- Create `src/admin/scheduleShiftTime.ts`: pure normalization and change-resolution helpers.
- Create `src/admin/components/ScheduleShiftTimeCell.tsx`: accessible inline display/edit component.
- Create `tests/unit/scheduleShiftTime.test.ts`: helper behavior tests.
- Create `tests/unit/scheduleShiftTimeCell.test.tsx`: interaction, loading, permission, and failure tests.
- Modify `src/admin/AdminAppPage.tsx`: persistence handler, edit permissions, table column, local state, and audit integration.

### Task 1: Shift-time normalization and change resolution

**Files:**
- Create: `src/admin/scheduleShiftTime.ts`
- Test: `tests/unit/scheduleShiftTime.test.ts`
- Modify: `src/admin/AdminAppPage.tsx:3117-3121`

- [ ] **Step 1: Write the failing helper tests**

Create `tests/unit/scheduleShiftTime.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  normalizeScheduleShiftTime,
  resolveScheduleShiftTimeChange
} from '../../src/admin/scheduleShiftTime';

describe('normalizeScheduleShiftTime', () => {
  test.each([
    ['8:00', '08:00'],
    ['08:00:00', '08:00'],
    ['8：30', '08:30']
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeScheduleShiftTime(input)).toBe(expected);
  });

  test.each(['', '25:00', 'not-a-time'])('rejects invalid value %s', (input) => {
    expect(normalizeScheduleShiftTime(input)).toBe('');
  });
});

describe('resolveScheduleShiftTimeChange', () => {
  test('returns a normalized changed value', () => {
    expect(resolveScheduleShiftTimeChange('07:00', '8:00')).toEqual({
      kind: 'changed',
      value: '08:00'
    });
  });

  test('returns unchanged for equivalent values', () => {
    expect(resolveScheduleShiftTimeChange('08:00', '8:00')).toEqual({
      kind: 'unchanged',
      value: '08:00'
    });
  });

  test('returns invalid for an empty or invalid draft', () => {
    expect(resolveScheduleShiftTimeChange('08:00', '')).toEqual({ kind: 'invalid' });
    expect(resolveScheduleShiftTimeChange('08:00', '26:00')).toEqual({ kind: 'invalid' });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run tests/unit/scheduleShiftTime.test.ts
```

Expected: FAIL because `src/admin/scheduleShiftTime.ts` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `src/admin/scheduleShiftTime.ts`:

```ts
import { formatClockMinutes, parseClockTextToMinutes } from './lateMarks';

export const normalizeScheduleShiftTime = (value: unknown): string => {
  const parsed = parseClockTextToMinutes(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return '';
  return formatClockMinutes(parsed as number);
};

export type ScheduleShiftTimeChange =
  | { kind: 'invalid' }
  | { kind: 'unchanged'; value: string }
  | { kind: 'changed'; value: string };

export const resolveScheduleShiftTimeChange = (
  currentValue: unknown,
  draftValue: unknown
): ScheduleShiftTimeChange => {
  const current = normalizeScheduleShiftTime(currentValue);
  const draft = normalizeScheduleShiftTime(draftValue);
  if (!draft) return { kind: 'invalid' };
  if (draft === current) return { kind: 'unchanged', value: draft };
  return { kind: 'changed', value: draft };
};
```

In `src/admin/AdminAppPage.tsx`, import `normalizeScheduleShiftTime` and replace the local body with an alias so all existing consumers retain their behavior:

```ts
import {
  normalizeScheduleShiftTime,
  resolveScheduleShiftTimeChange
} from './scheduleShiftTime';

const normalizeShiftTimeValue = normalizeScheduleShiftTime;
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/scheduleShiftTime.test.ts
```

Expected: all helper tests PASS.

- [ ] **Step 5: Commit the helper**

```powershell
git add -- src/admin/scheduleShiftTime.ts tests/unit/scheduleShiftTime.test.ts src/admin/AdminAppPage.tsx
git commit -m "Add schedule shift time helpers"
```

### Task 2: Accessible inline shift-time cell

**Files:**
- Create: `src/admin/components/ScheduleShiftTimeCell.tsx`
- Test: `tests/unit/scheduleShiftTimeCell.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `tests/unit/scheduleShiftTimeCell.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ScheduleShiftTimeCell from '../../src/admin/components/ScheduleShiftTimeCell';

afterEach(cleanup);

const t = (_zh: string, en: string) => en;

describe('ScheduleShiftTimeCell', () => {
  test('shows the normalized value and enters edit mode on click', async () => {
    const user = userEvent.setup();
    render(<ScheduleShiftTimeCell value="8:00" canEdit saving={false} t={t} onSave={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));

    expect(screen.getByLabelText('Shift time')).toHaveValue('08:00');
    expect(screen.getByLabelText('Shift time')).toHaveFocus();
  });

  test('shows a dash and no button when editing is not allowed', () => {
    render(<ScheduleShiftTimeCell value="" canEdit={false} saving={false} t={t} onSave={vi.fn()} />);

    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit shift time' })).not.toBeInTheDocument();
  });

  test('saves on Enter through blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<ScheduleShiftTimeCell value="07:00" canEdit saving={false} t={t} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '08:30' } });
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith('08:30');
  });

  test('saves on blur', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(true);
    render(<ScheduleShiftTimeCell value="07:00" canEdit saving={false} t={t} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    fireEvent.blur(screen.getByLabelText('Shift time'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('09:00'));
  });

  test('cancels with Escape without saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ScheduleShiftTimeCell value="07:00" canEdit saving={false} t={t} onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    await user.keyboard('{Escape}');

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit shift time' })).toHaveTextContent('07:00');
  });

  test('keeps editing when save fails and disables input while saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(false);
    const { rerender } = render(
      <ScheduleShiftTimeCell value="07:00" canEdit saving={false} t={t} onSave={onSave} />
    );

    await user.click(screen.getByRole('button', { name: 'Edit shift time' }));
    fireEvent.change(screen.getByLabelText('Shift time'), { target: { value: '09:00' } });
    fireEvent.blur(screen.getByLabelText('Shift time'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(screen.getByLabelText('Shift time')).toHaveValue('09:00');
    rerender(<ScheduleShiftTimeCell value="07:00" canEdit saving t={t} onSave={onSave} />);
    expect(screen.getByLabelText('Shift time')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/scheduleShiftTimeCell.test.tsx
```

Expected: FAIL because `ScheduleShiftTimeCell` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/admin/components/ScheduleShiftTimeCell.tsx` with this public contract:

```tsx
import { useEffect, useRef, useState } from 'react';
import { normalizeScheduleShiftTime } from '../scheduleShiftTime';

type Props = {
  value: unknown;
  canEdit: boolean;
  saving: boolean;
  t: (zh: string, en: string) => string;
  onSave: (draft: string) => Promise<boolean>;
};

export default function ScheduleShiftTimeCell({ value, canEdit, saving, t, onSave }: Props) {
  const normalizedValue = normalizeScheduleShiftTime(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(normalizedValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(normalizedValue);
  }, [editing, normalizedValue]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = async () => {
    if (cancelledRef.current || saving) return;
    const saved = await onSave(draft);
    if (saved) setEditing(false);
  };

  if (!editing) {
    if (!canEdit) return <span className="font-mono tabular-nums">{normalizedValue || '-'}</span>;
    return (
      <button
        type="button"
        aria-label={t('编辑班次时间', 'Edit shift time')}
        onClick={() => {
          cancelledRef.current = false;
          setDraft(normalizedValue);
          setEditing(true);
        }}
        className="rounded-md px-1.5 py-1 font-mono tabular-nums transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/60"
      >
        {normalizedValue || '-'}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="time"
      step={60}
      value={draft}
      disabled={saving}
      aria-label={saving ? t('正在保存班次时间', 'Saving shift time') : t('班次时间', 'Shift time')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelledRef.current = true;
          setDraft(normalizedValue);
          setEditing(false);
        }
      }}
      className="h-7 w-[72px] rounded-md border border-white/15 bg-slate-950 px-1 font-mono text-[11px] text-slate-100 outline-none focus:border-neon/60 disabled:cursor-wait disabled:opacity-60"
    />
  );
}
```

Adjust only as needed to satisfy the tests, including preventing duplicate saves caused by Enter followed by blur.

- [ ] **Step 4: Run component tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/scheduleShiftTimeCell.test.tsx
```

Expected: all component tests PASS without React warnings.

- [ ] **Step 5: Commit the component**

```powershell
git add -- src/admin/components/ScheduleShiftTimeCell.tsx tests/unit/scheduleShiftTimeCell.test.tsx
git commit -m "Add inline schedule shift time cell"
```

### Task 3: Persist the employee shift time from the schedule table

**Files:**
- Modify: `src/admin/AdminAppPage.tsx:2372-2375`
- Modify: `src/admin/AdminAppPage.tsx:16078-16140`
- Modify: `src/admin/AdminAppPage.tsx:18255-18640`

- [ ] **Step 1: Add page state and component import**

Import the component:

```ts
import ScheduleShiftTimeCell from './components/ScheduleShiftTimeCell';
```

Add saving state beside `scheduleLabelSavingStaffId`:

```ts
const [scheduleShiftTimeSavingStaffId, setScheduleShiftTimeSavingStaffId] = useState<string | null>(null);
```

- [ ] **Step 2: Add the persistence handler**

Add `updateScheduleEmployeeShiftTime` beside `updateScheduleEmployeeLabel`. It must:

```ts
const updateScheduleEmployeeShiftTime = async (
  employee: EmployeeRow,
  draft: string
): Promise<boolean> => {
  const staff = normalizeStaffId(String(employee.staff_id ?? '').trim());
  const position = normalizePositionKey(String(employee.position ?? employee.Position ?? '').trim());
  const currentValue = normalizeScheduleShiftTime(employee.shift_time ?? employee.ShiftTime ?? '');
  const change = resolveScheduleShiftTimeChange(currentValue, draft);

  if (!staff || !position) return false;
  if (change.kind === 'unchanged') return true;
  if (change.kind === 'invalid') {
    setStatus({ tone: 'error', message: t('请输入有效的班次时间。', 'Enter a valid shift time.') });
    return false;
  }
  if (!scheduleCanOperate || !canOperatePosition('schedule', position)) {
    setStatus({ tone: 'error', message: t('排班模块当前为只读。', 'Schedule is read-only.') });
    return false;
  }
  if (!supabase) {
    setStatus({ tone: 'error', message: t('缺少 Supabase 配置。', 'Missing Supabase config.') });
    return false;
  }

  setScheduleShiftTimeSavingStaffId(staff);
  try {
    let saved = false;
    await runLocked('schedule_shift_time_update', async () => {
      const { error } = await supabase
        .from(EMPLOYEE_TABLE)
        .update({ shift_time: change.value } as any)
        .eq('staff_id', staff);
      if (error) {
        setStatus({ tone: 'error', message: `${t('保存失败：', 'Save failed: ')}${error.message}` });
        return;
      }
      setEmployees((previous) =>
        previous.map((row) =>
          normalizeStaffId(String(row.staff_id ?? '').trim()) === staff
            ? ({ ...row, shift_time: change.value, ShiftTime: change.value } as EmployeeRow)
            : row
        )
      );
      await writeAudit({
        action: 'employee_shift_time_update',
        staffId: staff,
        target: EMPLOYEE_TABLE,
        payload: {
          staff_id: staff,
          position,
          before: { shift_time: currentValue },
          after: { shift_time: change.value },
          source: 'schedule'
        }
      });
      setStatus({ tone: 'success', message: t('班次时间已更新。', 'Shift time updated.') });
      saved = true;
    });
    return saved;
  } finally {
    setScheduleShiftTimeSavingStaffId((current) => (current === staff ? null : current));
  }
};
```

Keep the employee table as the only persistence target. Do not update `ob_schedules`.

- [ ] **Step 3: Add the table column**

In the schedule table:

- Add `<col className="w-[78px]" />` immediately after the shift column.
- Add the bilingual header immediately after “班次 / Shift”:

```tsx
<th className="sticky top-0 z-20 w-[78px] bg-slate-950/95 px-1 py-2 text-center backdrop-blur">
  {t('班次时间', 'Shift Time')}
</th>
```

- For each employee, derive:

```ts
const canEditScheduleShiftTime =
  Boolean(normalizedPosition) &&
  scheduleCanOperate &&
  canOperatePosition('schedule', normalizedPosition);
const shiftTimeSaving = scheduleShiftTimeSavingStaffId === staff;
```

- Render immediately after the shift cell:

```tsx
<td className={['px-1 py-2 text-center', scheduleBodyTextClass].join(' ')}>
  <ScheduleShiftTimeCell
    value={employee.shift_time ?? employee.ShiftTime ?? ''}
    canEdit={canEditScheduleShiftTime && !isLocked}
    saving={shiftTimeSaving}
    t={t}
    onSave={(draft) => updateScheduleEmployeeShiftTime(employee, draft)}
  />
</td>
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/scheduleShiftTime.test.ts tests/unit/scheduleShiftTimeCell.test.tsx tests/unit/scheduleExport.test.ts tests/unit/employeeEditModal.test.tsx
```

Expected: all selected tests PASS.

- [ ] **Step 5: Run the production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build exit with code 0.

- [ ] **Step 6: Commit integration**

```powershell
git add -- src/admin/AdminAppPage.tsx
git commit -m "Add shift time editing to schedule"
```

### Task 4: Final verification

**Files:**
- Verify only; no source files should be changed unless a failure is found.

- [ ] **Step 1: Run all unit tests**

Run:

```powershell
npm run test
```

Expected: Vitest exits with code 0 and reports zero failed tests.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: ESLint exits with code 0.

- [ ] **Step 3: Re-run the production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build exit with code 0.

- [ ] **Step 4: Perform a targeted browser check**

Start the development server:

```powershell
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

Open `/admin.html`, navigate to Schedule, and verify:

1. “Shift Time” appears immediately after “Shift”.
2. Existing employee values match the Employee page.
3. Clicking a permitted value focuses a time input.
4. Enter and blur save and show immediate saving feedback.
5. Escape restores the previous value.
6. Refreshing both Schedule and Employees shows the same saved value.
7. The table remains usable without new page-level horizontal overflow at desktop and tablet widths.

- [ ] **Step 5: Inspect the final diff**

Run:

```powershell
git status --short
git diff --check HEAD~3..HEAD
git diff --stat HEAD~3..HEAD
```

Expected: no whitespace errors; only the planned files and pre-existing unrelated workspace changes are present.
