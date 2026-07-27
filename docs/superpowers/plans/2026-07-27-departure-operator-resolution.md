# Departure Operator Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve departed-employee operators from historical audit logs so agency departures show the submitter and direct Admin departures show the acting Admin.

**Architecture:** Keep operator resolution as a pure helper in `src/admin/departedEmployees.ts`. Select the departure event nearest the employee's current `terminated_at`; when that event is an approval, join its `payload.request_id` to the original agency request audit and display that actor. Expand the Admin loader to fetch the request audits needed by the helper.

**Tech Stack:** React 18, TypeScript, Supabase JS v2, Vitest

---

### Task 1: Lock the operator rules with unit tests

**Files:**
- Modify: `tests/unit/departedEmployees.test.ts`

- [ ] **Step 1: Replace the existing operator test with focused failing cases**

Add tests that provide:

```ts
const employee: EmployeeRow = {
  staff_id: 'US010001',
  terminated_at: '2026-06-14T10:00:00.000Z'
};
```

Verify:

```ts
expect(result[0].termination_operator).toBe('Agency: submitter@example.com');
expect(directResult[0].termination_operator).toBe('Admin: admin@example.com');
expect(rehiredResult[0].termination_operator).toBe('Admin: current@example.com');
expect(noEvidenceResult[0].termination_operator).toBeNull();
```

The agency case must link `employee_termination_approve` and `agency_termination_request` with the same `payload.request_id`. The direct case must put `employee_delete` immediately after `terminated_at`. The repeated-cycle case must include an older and current `employee_delete`.

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/departedEmployees.test.ts
```

Expected: the agency case returns the approver or null, and the post-termination direct Admin case returns null.

### Task 2: Implement historical audit resolution

**Files:**
- Modify: `src/admin/departedEmployees.ts`
- Modify: `src/admin/AdminAppPage.tsx`

- [ ] **Step 1: Implement the minimal pure resolver**

In `attachDepartureOperators`:

```ts
const DEPARTURE_EVENT_ACTIONS = new Set(['employee_delete', 'employee_termination_approve']);
const REQUEST_ACTION = 'agency_termination_request';
```

Group valid audits by normalized staff ID. For each employee, choose the `employee_delete` or `employee_termination_approve` audit with the smallest absolute time difference from `terminated_at`. If the chosen audit is an approval, read its normalized `payload.request_id`, find the agency request audit with the same request ID, and resolve that request actor. Otherwise resolve the chosen direct-departure actor. Return `null` when no usable actor exists.

- [ ] **Step 2: Fetch agency request audits**

In `fetchDepartedEmployees`, change the action filter to:

```ts
.in(
  'action',
  ['employee_delete', 'employee_termination_approve', 'agency_termination_request'] as any
)
```

This reuses the existing paged staff-ID audit query and actor-display-name lookup.

- [ ] **Step 3: Run the targeted test and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/unit/departedEmployees.test.ts
```

Expected: all tests in the file pass.

### Task 3: Verify the integrated change

**Files:**
- Verify: `src/admin/departedEmployees.ts`
- Verify: `src/admin/AdminAppPage.tsx`
- Verify: `tests/unit/departedEmployees.test.ts`

- [ ] **Step 1: Run related modal tests**

Run:

```powershell
npm.cmd test -- tests/unit/departedEmployeesModal.test.tsx tests/unit/departedEmployees.test.ts
```

Expected: both test files pass.

- [ ] **Step 2: Run the production build**

Run:

```powershell
npm.cmd run build
```

Expected: TypeScript and Vite production build complete successfully.

- [ ] **Step 3: Review the final diff**

Run:

```powershell
git diff --check
git diff -- src/admin/departedEmployees.ts src/admin/AdminAppPage.tsx tests/unit/departedEmployees.test.ts
```

Expected: no whitespace errors; changes are limited to operator resolution, audit loading, and regression tests.
