# Work Hour Punch Timestamp Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display Work Hour Comparison punch-flow timestamps as deterministic local `YYYY-MM-DD HH:mm:ss` values.

**Architecture:** Add a feature-specific display helper under `src/admin` so formatting is testable without importing the large React page. `WorkHourComparisonPage` will call it only for the punch-flow modal, leaving other pages unchanged.

**Tech Stack:** TypeScript, React 18, Vitest, Vite

---

### Task 1: Add the tested timestamp formatter

**Files:**
- Create: `src/admin/workHourComparisonDisplay.ts`
- Create: `tests/unit/workHourComparisonDisplay.test.ts`

- [ ] **Step 1: Write the failing formatter tests**

```ts
import { describe, expect, test } from 'vitest';
import { formatWorkHourPunchDateTime } from '../../src/admin/workHourComparisonDisplay';

describe('workHourComparisonDisplay', () => {
  test('formats a local punch timestamp with hyphen-separated date components', () => {
    expect(formatWorkHourPunchDateTime('2026-07-17T15:50:12')).toBe('2026-07-17 15:50:12');
  });

  test('returns a fallback for an invalid punch timestamp', () => {
    expect(formatWorkHourPunchDateTime('not-a-date')).toBe('-');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run `npm.cmd test -- tests/unit/workHourComparisonDisplay.test.ts`.

Expected: FAIL because `src/admin/workHourComparisonDisplay.ts` does not exist.

- [ ] **Step 3: Implement the formatter**

```ts
const padDateTimePart = (value: number) => String(value).padStart(2, '0');

export const formatWorkHourPunchDateTime = (value: string): string => {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '-';

  const date = [at.getFullYear(), padDateTimePart(at.getMonth() + 1), padDateTimePart(at.getDate())].join('-');
  const time = [padDateTimePart(at.getHours()), padDateTimePart(at.getMinutes()), padDateTimePart(at.getSeconds())].join(':');
  return `${date} ${time}`;
};
```

- [ ] **Step 4: Run the formatter tests**

Run `npm.cmd test -- tests/unit/workHourComparisonDisplay.test.ts`.

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the tested helper**

```powershell
git add src/admin/workHourComparisonDisplay.ts tests/unit/workHourComparisonDisplay.test.ts
git commit -m "Add work hour punch timestamp formatter"
```

### Task 2: Use the formatter in the punch-flow modal

**Files:**
- Modify: `src/admin/pages/WorkHourComparisonPage.tsx:1-20`
- Modify: `src/admin/pages/WorkHourComparisonPage.tsx:496-509`
- Modify: `src/admin/pages/WorkHourComparisonPage.tsx:1894`

- [ ] **Step 1: Import the tested formatter**

```ts
import { formatWorkHourPunchDateTime } from '../workHourComparisonDisplay';
```

- [ ] **Step 2: Remove the locale-dependent formatter**

Delete the page-local `formatPunchDateTime` function that calls `toLocaleString('zh-CN', ...)`.

- [ ] **Step 3: Update the modal Time cell**

Replace:

```tsx
<td className="px-3 py-2">{formatPunchDateTime(item.createdAt)}</td>
```

with:

```tsx
<td className="px-3 py-2">{formatWorkHourPunchDateTime(item.createdAt)}</td>
```

- [ ] **Step 4: Run the targeted test**

Run `npm.cmd test -- tests/unit/workHourComparisonDisplay.test.ts`.

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Run the production build**

Run `npm.cmd run build`.

Expected: TypeScript and Vite finish with exit code 0.

- [ ] **Step 6: Inspect the final diff**

```powershell
git diff --check
git diff -- src/admin/workHourComparisonDisplay.ts src/admin/pages/WorkHourComparisonPage.tsx tests/unit/workHourComparisonDisplay.test.ts
```

Expected: no whitespace errors and no changes outside the formatter, its tests, and the modal integration.

- [ ] **Step 7: Commit the integration**

```powershell
git add src/admin/pages/WorkHourComparisonPage.tsx
git commit -m "Use fixed work hour punch timestamps"
```
