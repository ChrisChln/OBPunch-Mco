# Schedule Export Shift-Time Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export each working schedule day as the employee's HH:mm shift start time and every non-working day as 休息.

**Architecture:** Add a pure schedule-export mapper that owns the working-state versus rest-state conversion. Keep employee time normalization and position/shift fallback in AdminAppPage by reusing its existing resolveShiftStartTime function, then pass the resolved value into the mapper.

**Tech Stack:** React 18, TypeScript, Vitest, Vite, xlsx

---

### Task 1: Add the pure export-cell mapper

**Files:**
- Create: `src/admin/scheduleExport.ts`
- Create: `tests/unit/scheduleExport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scheduleExport.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import type { ScheduleBaseState } from '../../src/admin/types';
import { getScheduleExportCellValue } from '../../src/admin/scheduleExport';

describe('getScheduleExportCellValue', () => {
  test.each<ScheduleBaseState>(['new', 'work', 'fixed_work', 'temp_work', 'planned_temp_work'])(
    'exports the resolved shift time for %s',
    (state) => {
      expect(getScheduleExportCellValue(state, '08:00')).toBe('08:00');
    }
  );

  test.each<ScheduleBaseState | null>([
    'rest',
    'leave',
    'planned_leave',
    'temp_rest',
    'planned_temp_rest',
    null
  ])('exports rest for %s', (state) => {
    expect(getScheduleExportCellValue(state, '08:00')).toBe('休息');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- tests/unit/scheduleExport.test.ts`

Expected: FAIL because `src/admin/scheduleExport.ts` does not exist.

- [ ] **Step 3: Implement the mapper**

Create `src/admin/scheduleExport.ts`:

```ts
import type { ScheduleBaseState } from './types';

const WORKING_SCHEDULE_STATES: ReadonlySet<ScheduleBaseState> = new Set([
  'new',
  'work',
  'fixed_work',
  'temp_work',
  'planned_temp_work'
]);

export const getScheduleExportCellValue = (
  state: ScheduleBaseState | null,
  resolvedShiftStartTime: string
) => {
  if (!state || !WORKING_SCHEDULE_STATES.has(state)) return '休息';
  return resolvedShiftStartTime;
};
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm.cmd test -- tests/unit/scheduleExport.test.ts`

Expected: PASS with all parameterized working and non-working cases passing.

### Task 2: Connect the mapper to workbook generation

**Files:**
- Modify: `src/admin/AdminAppPage.tsx:171`
- Modify: `src/admin/AdminAppPage.tsx:16840-16867`

- [ ] **Step 1: Import the mapper**

Add:

```ts
import { getScheduleExportCellValue } from './scheduleExport';
```

- [ ] **Step 2: Resolve employee shift start time once per row**

Inside the employee map, after `name`, resolve the position and time:

```ts
const position = String(employee.position ?? employee.Position ?? '').trim();
const resolvedShiftStartTime = resolveShiftStartTime(
  shift,
  position,
  employee.shift_time ?? employee.ShiftTime
);
```

This reuses existing behavior: valid values normalize to HH:mm; missing or invalid values fall back by shift and position.

- [ ] **Step 3: Replace label mapping with the pure mapper**

Replace the current state-specific label returns with:

```ts
const dayCells = Array.from({ length: 7 }, (_, dayIndex) => {
  const row = scheduleRowsByStaffDayIndex.get(`${staff}__${dayIndex}`);
  const state = row ? getScheduleBaseStateFromNote(row.note) : null;
  return getScheduleExportCellValue(state, resolvedShiftStartTime);
});
```

Expected behavior: all working states return the employee time; leave, rest, and missing rows return 休息.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- tests/unit/scheduleExport.test.ts tests/unit/shiftTimeAutofill.test.ts`

Expected: PASS.

- [ ] **Step 5: Run production build**

Run: `npm.cmd run build`

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 6: Review the final diff**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git diff -- src/admin/scheduleExport.ts src/admin/AdminAppPage.tsx tests/unit/scheduleExport.test.ts`

Expected: only the export mapper, its tests, import, and workbook cell mapping changed.
