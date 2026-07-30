# Forecast Week Date Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the forecast dialog date picker navigate the displayed week, highlight the selected day, and place a high-contrast report import action beside the historical-inflow title.

**Architecture:** Keep one selected date in `ForecastPage`, derive the historical week offset from it with pure date helpers, and route both direct date changes and week buttons through one async week-loading handler. Preserve the report parser and persistence path while moving only its file input and trigger.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest, Testing Library

---

### Task 1: Date-to-week navigation behavior

**Files:**
- Modify: `src/admin/pages/ForecastPage.tsx`
- Test: `tests/admin/ForecastPage.reportImport.test.tsx`

- [ ] **Step 1: Write the failing interaction test**

Open the weekly-data dialog, change the navigation date to `2026-05-14`, and assert that the seven rendered date inputs span `2026-05-11` through `2026-05-17` and the selected row exposes `data-selected="true"`.

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `npm.cmd test -- tests/admin/ForecastPage.reportImport.test.tsx`

Expected: FAIL because the weekly view has no controlling date input and no selected-row marker.

- [ ] **Step 3: Add minimal week-offset helpers and navigation handler**

Add a pure helper that compares the Monday for the selected date with the Monday for `serverTime` and returns the repository's historical offset convention (`0` current week, positive values older weeks). Add one async handler that validates `YYYY-MM-DD`, loads that week, updates draft rows, clears dirty/error state, and stores the selected date.

- [ ] **Step 4: Connect week buttons and selected-row styling**

Make date changes call the handler. Make previous, next, and current-week buttons choose a concrete date and call the same handler. Add a stable selected marker and subtle accent styling to the matching table row.

- [ ] **Step 5: Run the targeted test and verify GREEN**

Run: `npm.cmd test -- tests/admin/ForecastPage.reportImport.test.tsx`

Expected: all tests in the file pass.

### Task 2: Move report import into the historical-inflow header

**Files:**
- Modify: `src/admin/pages/ForecastPage.tsx`
- Test: `tests/admin/ForecastPage.reportImport.test.tsx`

- [ ] **Step 1: Update the placement test and verify RED**

Assert that “导入报表” is available beside the historical-inflow title and is no longer rendered inside the historical paste panel.

- [ ] **Step 2: Run the targeted test**

Run: `npm.cmd test -- tests/admin/ForecastPage.reportImport.test.tsx`

Expected: FAIL because the import trigger currently exists inside the historical paste panel.

- [ ] **Step 3: Move the existing file input and trigger**

Place the hidden file input and import button beside the historical-inflow title. Use a high-contrast dark-mode style, remove the old trigger from the paste panel, and preserve all disabled/loading conditions and `onOutboundReportSelected` behavior.

- [ ] **Step 4: Verify the import regression tests**

Run: `npm.cmd test -- tests/admin/ForecastPage.reportImport.test.tsx`

Expected: all report selection, persistence, and validation tests pass.

### Task 3: Final verification

**Files:**
- Verify: `src/admin/pages/ForecastPage.tsx`
- Verify: `tests/admin/ForecastPage.reportImport.test.tsx`

- [ ] **Step 1: Run the focused tests**

Run: `npm.cmd test -- tests/admin/ForecastPage.reportImport.test.tsx`

Expected: zero failures.

- [ ] **Step 2: Run the production build**

Run: `npm.cmd run build`

Expected: TypeScript and Vite finish with exit code 0.

- [ ] **Step 3: Inspect the browser flow**

Open the forecast dialog, select a cross-month date, confirm the table switches to its Monday-Sunday range and highlights the chosen date, then confirm import remains usable beside the title without horizontal overflow.
