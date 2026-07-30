# Departed Employee Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show who departed each employee and remove horizontal scrolling from the departed-employees modal.

**Architecture:** Resolve the operator from existing `ob_audit_logs` rows and attach it as a UI-only field on departed employee records. Keep audit selection in a pure helper, enrich rows during the existing departed-employee fetch, then render and export the resolved operator while constraining the table to the modal width.

**Tech Stack:** React 18, TypeScript, Supabase JS v2, Tailwind CSS, Vitest, Testing Library

---

## File Structure

- Modify `src/admin/types.ts`: add the optional `termination_operator` display field.
- Modify `src/admin/departedEmployees.ts`: add pure audit matching and operator enrichment helpers; include the operator in filtering and CSV export.
- Modify `src/admin/AdminAppPage.tsx`: query applicable audit logs, resolve actor display names, enrich fetched rows, and populate optimistic departures.
- Modify `src/admin/pages/DepartedEmployeesModal.tsx`: add the operator column and remove forced horizontal overflow.
- Modify `tests/unit/departedEmployees.test.ts`: cover audit matching and CSV output.
- Modify `tests/unit/departedEmployeesModal.test.tsx`: cover operator display and responsive overflow classes.

### Task 1: Audit matching helper

**Files:**
- Modify: `src/admin/types.ts`
- Modify: `src/admin/departedEmployees.ts`
- Test: `tests/unit/departedEmployees.test.ts`

- [ ] **Step 1: Write failing tests for departure audit matching**

Add audit rows for both supported actions and assert that the latest applicable row at or before `terminated_at` wins:

```ts
const audits: AuditRow[] = [
  {
    staff_id: 'US010001',
    action: 'employee_delete',
    actor: 'first@example.com',
    created_at: '2026-06-14T09:00:00.000Z'
  },
  {
    staff_id: 'US010001',
    action: 'employee_termination_approve',
    actor: 'latest@example.com',
    created_at: '2026-06-14T10:00:00.000Z'
  },
  {
    staff_id: 'US010001',
    action: 'employee_delete',
    actor: 'future@example.com',
    created_at: '2026-06-15T10:00:00.000Z'
  }
];

expect(
  attachDepartureOperators(rows, audits, (row) => `Admin: ${row.actor}`)
).toEqual([
  expect.objectContaining({ termination_operator: 'Admin: latest@example.com' }),
  expect.objectContaining({ termination_operator: null })
]);
```

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```powershell
npx vitest run tests/unit/departedEmployees.test.ts
```

Expected: failure because `attachDepartureOperators` does not exist.

- [ ] **Step 3: Implement the typed pure helper**

Add `termination_operator?: string | null` to `EmployeeRow`. In `departedEmployees.ts`, accept `AuditRow[]`, restrict actions to `employee_delete` and `employee_termination_approve`, ignore invalid timestamps and audits after the row's termination timestamp, and call the supplied actor resolver for the selected row:

```ts
const DEPARTURE_AUDIT_ACTIONS = new Set([
  'employee_delete',
  'employee_termination_approve'
]);

export const attachDepartureOperators = (
  rows: EmployeeRow[],
  audits: AuditRow[],
  resolveActor: (audit: AuditRow) => string
): EmployeeRow[] => {
  // Group valid audits by normalized staff ID, newest first.
  // For each employee, select the first audit no later than terminated_at.
  // Return a copied row with termination_operator or null.
};
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/departedEmployees.test.ts
```

Expected: all departed employee helper tests pass.

### Task 2: Load and resolve departure operators

**Files:**
- Modify: `src/admin/AdminAppPage.tsx`
- Test: `tests/unit/departedEmployees.test.ts`

- [ ] **Step 1: Add failure and fallback coverage**

Add a helper test proving unrelated actions are ignored and a missing applicable audit yields `termination_operator: null`.

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```powershell
npx vitest run tests/unit/departedEmployees.test.ts
```

Expected: the new edge-case assertion fails until action filtering and fallback behavior are complete.

- [ ] **Step 3: Enrich departed rows from `ob_audit_logs`**

In `fetchDepartedEmployees`, after access filtering:

1. Build normalized staff ID chunks.
2. Query `AUDIT_TABLE` for `id, created_at, actor, action, staff_id, target, payload`.
3. Restrict actions to `employee_delete` and `employee_termination_approve`.
4. Call `rememberAuditActorDisplayNames`.
5. Attach operators using `attachDepartureOperators(..., getAuditActorDisplay)`.
6. If audit loading fails, keep the employee rows and set a non-blocking departed modal error.

Use bounded chunks to avoid oversized Supabase query URLs:

```ts
const DEPARTED_AUDIT_STAFF_CHUNK_SIZE = 100;
for (const staffChunk of chunkArray(staffIds, DEPARTED_AUDIT_STAFF_CHUNK_SIZE)) {
  const result = await supabase
    .from(AUDIT_TABLE)
    .select('id, created_at, actor, action, staff_id, target, payload')
    .in('staff_id', staffChunk)
    .in('action', ['employee_delete', 'employee_termination_approve'])
    .order('created_at', { ascending: false });
  // Accumulate rows or preserve employee data on failure.
}
```

When direct departure succeeds, set the optimistic row's `termination_operator` to `userDisplayName.trim() || user?.email || null`.

- [ ] **Step 4: Run helper and existing modal tests**

Run:

```powershell
npx vitest run tests/unit/departedEmployees.test.ts tests/unit/departedEmployeesModal.test.tsx
```

Expected: all tests pass.

### Task 3: Operator column, CSV, and no horizontal scrollbar

**Files:**
- Modify: `src/admin/departedEmployees.ts`
- Modify: `src/admin/pages/DepartedEmployeesModal.tsx`
- Test: `tests/unit/departedEmployees.test.ts`
- Test: `tests/unit/departedEmployeesModal.test.tsx`

- [ ] **Step 1: Write failing CSV and modal tests**

Extend a fixture with:

```ts
termination_operator: 'Linda Chen'
```

Assert:

```ts
expect(csv).toContain('Operator');
expect(csv).toContain('Linda Chen');
expect(screen.getByText('操作人')).toBeInTheDocument();
expect(screen.getByText('Linda Chen')).toBeInTheDocument();

const table = screen.getByRole('table');
expect(table).not.toHaveClass('min-w-[1240px]');
expect(table.parentElement).toHaveClass('overflow-x-hidden');
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/departedEmployees.test.ts tests/unit/departedEmployeesModal.test.tsx
```

Expected: failures for the missing operator header/value and overflow class.

- [ ] **Step 3: Implement CSV and modal presentation**

Update CSV headers and rows:

```ts
t('操作人', 'Operator')
// ...
normalizeText(row.termination_operator)
```

In the modal:

- Change the scroll viewport from `overflow-auto` to `overflow-y-auto overflow-x-hidden`.
- Change the table from `w-full min-w-[1240px] table-fixed` to `w-full table-fixed`.
- Add the operator header before the action column.
- Render a truncated operator cell with a title tooltip.
- Update virtual spacer `colSpan` values for the additional column.
- Compact name, agency, position, reason, operator, and action widths so all columns fit.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/departedEmployees.test.ts tests/unit/departedEmployeesModal.test.tsx
```

Expected: both test files pass.

### Task 4: Final verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Check patch formatting**

Run:

```powershell
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 2: Run targeted tests**

Run:

```powershell
npx vitest run tests/unit/departedEmployees.test.ts tests/unit/departedEmployeesModal.test.tsx
```

Expected: all targeted tests pass with zero failures.

- [ ] **Step 3: Run the production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build successfully.

- [ ] **Step 4: Review final scope**

Run:

```powershell
git status --short
git diff --stat
```

Expected: only the planned departed-employee files and plan documentation are modified.

