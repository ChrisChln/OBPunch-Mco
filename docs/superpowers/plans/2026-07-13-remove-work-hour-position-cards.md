# Remove Work-Hour Position Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the position-level anomaly cards and the Hide Transfer filter from the work-hour comparison page without changing the remaining comparison workflow.

**Architecture:** Keep the page's current component structure and make a focused cleanup in `WorkHourComparisonPage.tsx`. A render-level regression test will define the visible behavior first; TypeScript and the production build will catch dead references after the card-only loader, state, and filter persistence are removed.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Vite

---

## File Structure

- Create `tests/admin/WorkHourComparisonPage.test.tsx`: render-level regression coverage for the removed and retained controls.
- Modify `src/admin/pages/WorkHourComparisonPage.tsx`: remove card UI, card-only data loading, click-jump state, and Hide Transfer filtering/persistence.

### Task 1: Define the retired UI behavior

**Files:**
- Create: `tests/admin/WorkHourComparisonPage.test.tsx`
- Test: `tests/admin/WorkHourComparisonPage.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import WorkHourComparisonPage from '../../src/admin/pages/WorkHourComparisonPage';

describe('WorkHourComparisonPage', () => {
  it('omits retired position summaries and Transfer filter while keeping discrepancy filtering', () => {
    render(
      <WorkHourComparisonPage
        t={(zh) => zh}
        isLocked={false}
        supabase={null}
        themeMode="dark"
        serverTime={new Date('2026-07-13T12:00:00-04:00')}
      />
    );

    expect(screen.queryByText(/未处理异常/)).not.toBeInTheDocument();
    expect(screen.queryByText(/差异数/)).not.toBeInTheDocument();
    expect(screen.queryByText('不看Transfer')).not.toBeInTheDocument();
    expect(screen.getByText('仅看差异大')).toBeInTheDocument();

    const source = readFileSync(
      resolve(process.cwd(), 'src/admin/pages/WorkHourComparisonPage.tsx'),
      'utf8'
    );
    expect(source).not.toContain('loadGlobalUnresolvedCounts');
    expect(source).not.toContain('globalUnresolvedByPosition');
    expect(source).not.toContain('globalLargeDiffByPosition');
    expect(source).not.toContain('hideTransfer');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- tests/admin/WorkHourComparisonPage.test.tsx`

Expected: FAIL because the current page still renders `不看Transfer` and position-level summary labels.

### Task 2: Remove retired UI and its private logic

**Files:**
- Modify: `src/admin/pages/WorkHourComparisonPage.tsx`
- Test: `tests/admin/WorkHourComparisonPage.test.tsx`

- [ ] **Step 1: Remove card-only types, constants, helpers, and state**

Delete `PositionJumpTarget`, `PositionCardStat`, `buildEmptyUnresolvedByPosition`, `GLOBAL_IMPORT_FETCH_STAFF_BATCH_SIZE`, `loadSystemHoursByDate`, `fetchTrackedImportedRows`, `globalUnresolvedByPosition`, `globalLargeDiffByPosition`, both jump cursors, and `jumpToPositionTarget`. Remove the now-unused `buildStaffIdsByDate`, `buildWorkHourPositionList`, and `getTrackedStaffIds` imports. Retain `ALL_SYSTEM_HOURS_COVERAGE_TOKEN`, `hasSystemHoursCoverage`, `mergeSystemHoursEntry`, `CachedSystemHoursEntry`, and `sortPositionsByDisplayOrder` because the current-date comparison and position dropdown still use them.

- [ ] **Step 2: Remove the global position-stat loading path**

Delete `loadGlobalUnresolvedCounts` and every call to it from initialization, punch-save refresh, upload completion, and mark-fixed completion. Keep the neighboring `loadComparisonRows` calls unchanged.

- [ ] **Step 3: Remove Hide Transfer state and persistence**

Change the saved-filter shape and payload to omit `hideTransfer`:

```ts
const parsed = JSON.parse(raw) as {
  search?: string;
  agency?: string;
  position?: string;
  shift?: '' | 'early' | 'late';
  direction?: DirectionFilter;
  discrepancyOnly?: boolean;
};
```

Keep only the remaining values in the persistence effect dependency list. Remove the Transfer-specific condition from `filteredRows` so all positions remain visible unless another active filter excludes them.

- [ ] **Step 4: Remove both card grids and the checkbox markup**

Delete the two grids between the top-level metrics and filter row, plus the label containing `不看Transfer`. Keep the filter row at `mt-3`, preserving the existing 4px/8px spacing system.

- [ ] **Step 5: Run the targeted test and verify GREEN**

Run: `npm.cmd test -- tests/admin/WorkHourComparisonPage.test.tsx`

Expected: PASS with the three retired labels absent and `仅看差异大` present.

### Task 3: Verify related behavior and build

**Files:**
- Verify: `src/admin/pages/WorkHourComparisonPage.tsx`
- Verify: `tests/admin/WorkHourComparisonPage.test.tsx`

- [ ] **Step 1: Run related work-hour unit tests**

Run: `npm.cmd test -- tests/admin/WorkHourComparisonPage.test.tsx tests/unit/workHourComparisonData.test.ts tests/unit/workHourGlobalStats.test.ts tests/unit/workHourStats.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 2: Run the production build**

Run: `npm.cmd run build`

Expected: TypeScript and Vite complete successfully with no unresolved references.

- [ ] **Step 3: Review the final diff**

Run: `git diff --check` and `git diff -- src/admin/pages/WorkHourComparisonPage.tsx tests/admin/WorkHourComparisonPage.test.tsx`

Expected: no whitespace errors; the diff is limited to the approved removal and its regression test.
