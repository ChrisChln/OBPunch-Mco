# Departure Dialog Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a departure reason and show the selected employee's non-empty Admin Note and Agency Note in the admin departure confirmation dialog.

**Architecture:** Reuse the admin page's existing normalized employee-note map and pass the selected employee's notes into the focused `DepartureConfirmDialog` component. Keep visibility and required-field behavior inside the dialog, while retaining the submit handler's defensive reason validation.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Tailwind CSS

---

### Task 1: Define and verify dialog behavior

**Files:**
- Modify: `tests/unit/departureConfirmDialog.test.tsx`
- Modify: `src/admin/pages/DepartureConfirmDialog.tsx`

- [ ] **Step 1: Write failing component tests**

Add `adminNote` and `agencyNote` props to each existing render and add focused tests:

```tsx
test('shows populated notes in admin then agency order', () => {
  renderDialog({
    adminNote: 'Admin message',
    agencyNote: 'Agency message'
  });

  const adminLabel = screen.getByText('Admin Note');
  const agencyLabel = screen.getByText('Agency Note');
  expect(adminLabel).toBeInTheDocument();
  expect(agencyLabel).toBeInTheDocument();
  expect(adminLabel.compareDocumentPosition(agencyLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('Admin message')).toBeInTheDocument();
  expect(screen.getByText('Agency message')).toBeInTheDocument();
});

test('hides note sections whose trimmed content is empty', () => {
  renderDialog({
    adminNote: '  ',
    agencyNote: 'Agency message'
  });

  expect(screen.queryByText('Admin Note')).not.toBeInTheDocument();
  expect(screen.getByText('Agency Note')).toBeInTheDocument();
});
```

Also assert that the departure reason textarea is required:

```tsx
expect(screen.getByLabelText('离职原因')).toBeRequired();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/unit/departureConfirmDialog.test.tsx
```

Expected: FAIL because `DepartureConfirmDialog` does not accept or render the note props and the textarea lacks the required attribute.

- [ ] **Step 3: Implement minimal dialog rendering**

Extend the props:

```tsx
type DepartureConfirmDialogProps = {
  // existing props
  adminNote: string;
  agencyNote: string;
};
```

Normalize both values in the component and render only non-empty note blocks, in Admin then Agency order:

```tsx
const visibleNotes = [
  { label: 'Admin Note', value: adminNote.trim() },
  { label: 'Agency Note', value: agencyNote.trim() }
].filter((note) => note.value);
```

Render the note blocks between the termination type controls and the required reason field. Add `required` to the textarea and preserve the existing trimmed `canConfirm` check.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/unit/departureConfirmDialog.test.tsx
```

Expected: all tests in the file PASS.

### Task 2: Connect employee notes to the departure dialog

**Files:**
- Modify: `src/admin/AdminAppPage.tsx`

- [ ] **Step 1: Pass normalized selected-employee notes**

Resolve the selected employee note pair from the existing map:

```tsx
const departureNotes = departureConfirm
  ? employeeNotesByStaffId[normalizeStaffId(departureConfirm.staff)]
  : undefined;
```

Pass both values into the dialog:

```tsx
<DepartureConfirmDialog
  adminNote={departureNotes?.adminNote ?? ''}
  agencyNote={departureNotes?.agencyNote ?? ''}
  // existing props
/>
```

No new database request or editable note state is added.

- [ ] **Step 2: Run component tests and build**

Run:

```bash
npx vitest run tests/unit/departureConfirmDialog.test.tsx
npm run build
```

Expected: focused tests PASS and the TypeScript/Vite build exits with code 0.

### Task 3: Final verification

**Files:**
- Verify: `tests/unit/departureConfirmDialog.test.tsx`
- Verify: `src/admin/pages/DepartureConfirmDialog.tsx`
- Verify: `src/admin/AdminAppPage.tsx`

- [ ] **Step 1: Check the patch**

Run:

```bash
git diff --check
git diff -- tests/unit/departureConfirmDialog.test.tsx src/admin/pages/DepartureConfirmDialog.tsx src/admin/AdminAppPage.tsx
```

Expected: no whitespace errors; the diff contains only the required dialog-note wiring plus the pre-existing work in those files.

- [ ] **Step 2: Run relevant verification**

Run:

```bash
npx vitest run tests/unit/departureConfirmDialog.test.tsx
npm run build
```

Expected: all focused tests PASS and build exits with code 0.
