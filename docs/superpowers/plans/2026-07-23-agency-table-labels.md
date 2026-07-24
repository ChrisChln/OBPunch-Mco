# Agency Table Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agency Group, Note, and Status controls content-sized glowing pills and give the Agency Admin-note dot the same hover card as Admin.

**Architecture:** Extract the existing Admin hover-card markup into one shared presentation component, then consume it from both employee-name components. Add focused Agency pill-control components that compose `GlowLabelChip`, leaving table data and mutation behavior in `AgencyAppPage`.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide React, Vitest, Testing Library

---

## File Structure

- Create `src/components/EmployeeNoteHoverCard.tsx`: shared note-card presentation and note normalization.
- Create `src/agency/components/AgencyTablePillControl.tsx`: content-sized select and button controls composed with `GlowLabelChip`.
- Modify `src/admin/components/EmployeeNoteNameButton.tsx`: delegate hover-card rendering to the shared component.
- Modify `src/agency/components/AgencyEmployeeName.tsx`: render the shared hover card for Admin-note dots.
- Modify `src/agency/AgencyAppPage.tsx`: use pill controls, `GlowLabelChip` for Status, and the `Waiting` label.
- Modify `tests/agency/AgencyEmployeeName.test.tsx`: cover the Admin-equivalent hover content.
- Create `tests/agency/AgencyTablePillControl.test.tsx`: cover current-label sizing and control behavior.
- Create `tests/agency/agencyTableLabels.test.tsx`: cover Status labels and chip composition through exported helpers.
- Modify `tests/unit/employeesTableSection.test.tsx`: retain Admin hover-card behavior coverage after extraction.

### Task 1: Shared Employee Note Hover Card

**Files:**
- Create: `src/components/EmployeeNoteHoverCard.tsx`
- Modify: `src/admin/components/EmployeeNoteNameButton.tsx`
- Modify: `src/agency/components/AgencyEmployeeName.tsx`
- Modify: `tests/agency/AgencyEmployeeName.test.tsx`
- Modify: `tests/unit/employeesTableSection.test.tsx`

- [ ] **Step 1: Write the failing Agency hover-card test**

Add an assertion that an Agency employee with an Admin note renders the shared card sections and Admin note text:

```tsx
render(
  <AgencyEmployeeName
    staffId="US001"
    name="Alex"
    agencyNote="Agency message"
    adminNote="Admin message"
  />
);

expect(screen.getByText('Agency note')).toBeInTheDocument();
expect(screen.getByText('Agency message')).toBeInTheDocument();
expect(screen.getByText('Admin note')).toBeInTheDocument();
expect(screen.getByText('Admin message')).toBeInTheDocument();
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run tests/agency/AgencyEmployeeName.test.tsx
```

Expected: FAIL because `AgencyEmployeeName` does not render note-card content.

- [ ] **Step 3: Extract and reuse the shared card**

Create a typed shared component:

```tsx
type EmployeeNoteHoverCardProps = {
  agencyNote: string;
  adminNote: string;
  isLight: boolean;
};

export default function EmployeeNoteHoverCard(props: EmployeeNoteHoverCardProps) {
  // Normalize both strings and render the existing Admin card markup only
  // when at least one note exists.
}
```

Replace the duplicated Admin card markup with `EmployeeNoteHoverCard`, then add it to the Agency employee-name group. Keep the Agency red dot conditional on a non-empty Admin note and make the wrapper keyboard-focusable when the card is available.

- [ ] **Step 4: Run shared-card tests and verify GREEN**

Run:

```powershell
npx vitest run tests/agency/AgencyEmployeeName.test.tsx tests/unit/employeesTableSection.test.tsx
```

Expected: both files pass with the same Agency/Admin note labels and content.

### Task 2: Content-Sized Agency Pill Controls

**Files:**
- Create: `src/agency/components/AgencyTablePillControl.tsx`
- Create: `tests/agency/AgencyTablePillControl.test.tsx`
- Modify: `src/agency/AgencyAppPage.tsx`

- [ ] **Step 1: Write failing pill-control tests**

Cover a select whose hidden sizing label contains only the current visible label and a button that has no fixed width:

```tsx
render(
  <AgencyTablePillSelect
    ariaLabel="Driver group"
    displayLabel="Individual"
    value="individual"
    tone="emerald"
    onChange={() => undefined}
  >
    <option value="individual">Individual</option>
    <option value="new">New group A12</option>
  </AgencyTablePillSelect>
);

expect(screen.getByTestId('agency-pill-select-sizer')).toHaveTextContent('Individual');
expect(screen.getByRole('combobox', { name: 'Driver group' })).not.toHaveClass('w-[68px]');
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run tests/agency/AgencyTablePillControl.test.tsx
```

Expected: FAIL because the pill-control module does not exist.

- [ ] **Step 3: Implement minimal controls**

Compose `GlowLabelChip` with:

```tsx
<span className="inline-grid">
  <span data-testid="agency-pill-select-sizer" aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-pre">
    {displayLabel}
  </span>
  <select className="col-start-1 row-start-1 w-full appearance-none bg-transparent">
    {children}
  </select>
</span>
```

Use matching `px-2.5 py-[5px] text-[10px] font-semibold leading-none` dimensions inside the shared glow boundary. Provide a pill button variant with natural inline width and visible focus styles.

- [ ] **Step 4: Replace Group and Note controls**

In `AgencyAppPage`:

- Derive `driverGroupDisplayLabel` from `driver_group_label`, driver role, or `Individual`.
- Replace the fixed `h-7 w-[68px]` Group select with `AgencyTablePillSelect`.
- Replace the fixed `h-8 rounded-lg` Add/View button with `AgencyTablePillButton`.
- Preserve disabled states, titles, handlers, option values, and tone selection.

- [ ] **Step 5: Run pill tests and verify GREEN**

Run:

```powershell
npx vitest run tests/agency/AgencyTablePillControl.test.tsx
```

Expected: all pill-control tests pass.

### Task 3: Status Chip and Waiting Copy

**Files:**
- Modify: `src/agency/AgencyAppPage.tsx`
- Create: `tests/agency/agencyTableLabels.test.ts`

- [ ] **Step 1: Write failing status-label tests**

Export and test the status helper:

```ts
expect(getAgencyStatusLabel('ready')).toBe('Ready');
expect(getAgencyStatusLabel('wait_confirm')).toBe('Waiting');
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run tests/agency/agencyTableLabels.test.ts
```

Expected: FAIL because the helper is not exported and pending status still returns `Wait for Confirm`.

- [ ] **Step 3: Implement the Status chip**

- Rename/export the helper as `getAgencyStatusLabel`.
- Return `Waiting` for non-ready status.
- Replace the custom Status span with `GlowLabelChip`.
- Use `emerald` for Ready and `amber` for Waiting.
- Preserve Check and Hourglass icons and natural content width.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run:

```powershell
npx vitest run tests/agency/AgencyEmployeeName.test.tsx tests/agency/AgencyTablePillControl.test.tsx tests/agency/agencyTableLabels.test.ts tests/unit/employeesTableSection.test.tsx
```

Expected: all targeted tests pass.

### Task 4: Verification and Delivery

**Files:**
- Verify all changed source, tests, migrations, and documentation already present in the workspace.

- [ ] **Step 1: Run production build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite finish with exit code 0.

- [ ] **Step 2: Run the unit suite**

Run:

```powershell
npm run test:unit
```

Expected: Vitest reports zero failed tests.

- [ ] **Step 3: Inspect repository diff**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; all local source changes remain in scope for the user-requested all-local-changes commit.

- [ ] **Step 4: Commit all local changes**

Run:

```powershell
git add --all
git commit -m "Polish agency labels and employee notes"
```

Expected: commit succeeds on `main`.

- [ ] **Step 5: Push main**

Run:

```powershell
git push origin main
```

Expected: local `main` is pushed to `ChrisChln/OBPunch-Mco`.
