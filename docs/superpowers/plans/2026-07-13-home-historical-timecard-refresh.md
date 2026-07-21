# Home Historical Timecard Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the admin home dashboard automatically after a punch correction is saved for the historical operational date currently being viewed.

**Architecture:** Reuse the existing `ob-timecard-punch-saved` browser event emitted by the save flow. Add a small pure predicate for the refresh decision, then have `HomeDashboardPage` reload its existing snapshot and historical roster data sources only when the event date matches the selected non-live date.

**Tech Stack:** React 18, TypeScript, Vitest, Supabase JS v2

---

## File Structure

- Modify `src/admin/pages/HomeDashboardPage.tsx`: export the refresh predicate and subscribe the historical dashboard to the existing save event.
- Modify `tests/unit/homeDashboardCards.test.ts`: cover matching historical dates, unrelated dates, and the live operational date.

### Task 1: Specify the historical refresh decision

**Files:**
- Modify: `tests/unit/homeDashboardCards.test.ts`
- Test: `tests/unit/homeDashboardCards.test.ts`

- [ ] **Step 1: Write the failing predicate tests**

Replace the import and append the new suite:

```ts
import {
  HOME_DASHBOARD_CARD_POSITIONS,
  shouldRefreshHistoricalTimecard
} from '../../src/admin/pages/HomeDashboardPage';

describe('home dashboard historical timecard refresh', () => {
  test('refreshes when the saved date matches the selected historical date', () => {
    expect(shouldRefreshHistoricalTimecard('2026-07-10', '2026-07-10', '2026-07-13')).toBe(true);
  });

  test('ignores saves for another date', () => {
    expect(shouldRefreshHistoricalTimecard('2026-07-09', '2026-07-10', '2026-07-13')).toBe(false);
  });

  test('leaves the live date to the parent refresh flow', () => {
    expect(shouldRefreshHistoricalTimecard('2026-07-13', '2026-07-13', '2026-07-13')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/homeDashboardCards.test.ts
```

Expected: FAIL because `shouldRefreshHistoricalTimecard` is not exported by `HomeDashboardPage.tsx`.

- [ ] **Step 3: Add the minimal pure predicate**

In `src/admin/pages/HomeDashboardPage.tsx`, next to the existing exported dashboard constants, add:

```ts
const TIMECARD_PUNCH_SAVED_EVENT = 'ob-timecard-punch-saved';

export const shouldRefreshHistoricalTimecard = (
  savedWorkDate: string,
  selectedOperationalDate: string,
  currentOperationalDate: string
) =>
  Boolean(savedWorkDate) &&
  savedWorkDate === selectedOperationalDate &&
  selectedOperationalDate !== currentOperationalDate;
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/unit/homeDashboardCards.test.ts
```

Expected: PASS for the existing card test and all three refresh-decision tests.

### Task 2: Refresh the historical dashboard on save

**Files:**
- Modify: `src/admin/pages/HomeDashboardPage.tsx:558-565`
- Test: `tests/unit/homeDashboardCards.test.ts`

- [ ] **Step 1: Add the save-event subscription**

Immediately after the existing historical-date loading effect, add:

```ts
useEffect(() => {
  if (typeof window === 'undefined') return undefined;

  const handleTimecardPunchSaved = (event: Event) => {
    const detail = (event as CustomEvent<{ workDate?: string }>).detail;
    const workDate = String(detail?.workDate ?? '').trim();
    const currentDate = getCurrentOperationalDate();
    if (!shouldRefreshHistoricalTimecard(workDate, selectedOperationalDate, currentDate)) return;

    void Promise.all([
      loadSnapshot(selectedOperationalDate),
      loadHistoricalRoster(selectedOperationalDate)
    ]);
  };

  window.addEventListener(TIMECARD_PUNCH_SAVED_EVENT, handleTimecardPunchSaved as EventListener);
  return () => {
    window.removeEventListener(TIMECARD_PUNCH_SAVED_EVENT, handleTimecardPunchSaved as EventListener);
  };
}, [selectedOperationalDate, homeDashboardPositionNames]);
```

This reuses the existing loading and failure handling inside both loaders and cleans up the listener on dependency changes and unmount.

- [ ] **Step 2: Run the focused regression test**

Run:

```powershell
npm.cmd test -- tests/unit/homeDashboardCards.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run:

```powershell
npm.cmd run build
```

Expected: TypeScript and Vite production build complete successfully with no errors.

- [ ] **Step 4: Review the final diff**

Run:

```powershell
git diff --check
git diff -- src/admin/pages/HomeDashboardPage.tsx tests/unit/homeDashboardCards.test.ts
```

Expected: no whitespace errors; diff contains only the refresh predicate, event subscription, and focused tests.

- [ ] **Step 5: Commit the fix**

```powershell
git add src/admin/pages/HomeDashboardPage.tsx tests/unit/homeDashboardCards.test.ts docs/superpowers/plans/2026-07-13-home-historical-timecard-refresh.md
git commit -m "Fix historical timecard refresh on home dashboard"
```
