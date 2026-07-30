# Agency Leave 24-Hour Deadline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display Agency leave submission timestamps in admin and reject leave requests unless the employee's shift starts more than 24 hours later.

**Architecture:** Put the browser-side deadline calculation in a pure shared helper that resolves a personal `HH:mm` start time, falls back to 07:00/15:00 by shift, and converts the New York wall clock to an instant. Use that helper only for the Agency Leave action while a dated SQL migration applies the same rule authoritatively inside `agency_set_schedule_state`; render the existing `submitted_at` value in the approval table.

**Tech Stack:** React 18, TypeScript, Vitest, Supabase/PostgreSQL PL/pgSQL, Tailwind CSS

---

### Task 1: Shared Agency leave deadline

**Files:**
- Modify: `src/shared/agencyShared.ts`
- Modify: `tests/unit/agencyShared.test.ts`

- [ ] **Step 1: Replace the old same-day cutoff tests with failing 24-hour tests**

Add tests that call:

```ts
canSubmitAgencyLeave({
  shift: 'early',
  startTime: '08:30',
  workDate: '2026-07-29',
  now: new Date('2026-07-28T12:29:59.000Z')
})
```

and verify more than 24 hours is allowed, exactly 24 hours is rejected, less than 24 hours is rejected, early fallback is 07:00, late fallback is 15:00, and invalid date/shift inputs are rejected. Use winter and summer dates to cover New York standard/daylight offsets.

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```powershell
npx vitest run tests/unit/agencyShared.test.ts
```

Expected: FAIL because `canSubmitAgencyLeave` is not exported.

- [ ] **Step 3: Implement the pure helper**

Add:

```ts
type AgencyLeaveDeadlineInput = {
  shift: AgencyShift | '';
  startTime: string;
  workDate: string;
  now: Date;
};

export const canSubmitAgencyLeave = ({
  shift,
  startTime,
  workDate,
  now
}: AgencyLeaveDeadlineInput) => {
  const resolvedStartTime = resolveAgencyLeaveStartTime(shift, startTime);
  const shiftStart = getNewYorkWallClockUtc(workDate, resolvedStartTime);
  if (!shiftStart || Number.isNaN(now.getTime())) return false;
  return shiftStart.getTime() - now.getTime() > 24 * 60 * 60 * 1000;
};
```

Implement `resolveAgencyLeaveStartTime` with strict `HH:mm` validation and `07:00`/`15:00` fallbacks, and implement New York wall-clock conversion with `Intl.DateTimeFormat` so daylight-saving offsets are respected.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/agencyShared.test.ts
```

Expected: all `agencyShared` tests pass.

### Task 2: Agency UI deadline

**Files:**
- Modify: `src/agency/AgencyAppPage.tsx`

- [ ] **Step 1: Import and use the shared rule**

Import `canSubmitAgencyLeave` from `src/shared/agencyShared.ts`. Replace the Leave option condition with:

```ts
if (
  canRequestAgencyLeave(state) &&
  canSubmitAgencyLeave({
    shift: employee.shift,
    startTime: employee.start_time,
    workDate,
    now: new Date()
  })
) {
  options.push({ key: 'planned_leave', label: 'Leave', cls: 'bg-amber-500 text-slate-950' });
}
```

Do not change the separate deadline behavior for non-leave schedule actions.

- [ ] **Step 2: Run TypeScript/build verification**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build exit successfully.

### Task 3: Authoritative database deadline

**Files:**
- Create: `sql/2026-07-27_enforce_agency_leave_24_hour_deadline.sql`
- Create: `supabase/migrations/20260727000000_enforce_agency_leave_24_hour_deadline.sql`
- Create: `tests/unit/agencyLeaveDeadlineMigration.test.ts`

- [ ] **Step 1: Write failing migration contract tests**

Read both migration files with `existsSync` and assert that each contains:

```ts
expect(sql).toContain("v_shift_time text := ''");
expect(sql).toContain("v_shift_start timestamptz := null");
expect(sql).toContain("'07:00'");
expect(sql).toContain("'15:00'");
expect(sql).toContain("v_shift_start - interval '24 hours'");
expect(sql).toContain("Leave requests must be submitted more than 24 hours before shift start.");
```

Also assert the dated SQL and Supabase migration are byte-identical.

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```powershell
npx vitest run tests/unit/agencyLeaveDeadlineMigration.test.ts
```

Expected: FAIL because the migration files do not exist.

- [ ] **Step 3: Add the database migration**

Copy the current authoritative `agency_set_schedule_state(text, date, text, text)` definition from `sql/2026-04-13_fix_agency_board_counts_and_new_hire_integrity.sql`, preserving authorization, state transitions, leave upsert, schedule writes, and audit logging. Add `v_shift_time` and `v_shift_start`; resolve `shift_time` from the employee JSON, validate `HH24:MI`, fall back by shift, then enforce only for `v_next_state = 'planned_leave'`:

```sql
v_shift_time := btrim(coalesce(to_jsonb(v_employee) ->> 'shift_time', ''));
if v_shift_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
  v_shift_time := case v_shift
    when 'early' then '07:00'
    when 'late' then '15:00'
    else ''
  end;
end if;
if v_shift_time = '' then
  raise exception 'Employee shift start time is required.';
end if;

v_shift_start := timezone(
  'America/New_York',
  (v_work_date::text || ' ' || v_shift_time || ':00')::timestamp
);
if v_now >= v_shift_start - interval '24 hours' then
  raise exception 'Leave requests must be submitted more than 24 hours before shift start.';
end if;
```

Write identical content to the dated SQL and Supabase migration.

- [ ] **Step 4: Run the migration contract test and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/agencyLeaveDeadlineMigration.test.ts
```

Expected: all migration contract tests pass.

### Task 4: Approval submission timestamp

**Files:**
- Modify: `src/admin/pages/LeaveApprovalPage.tsx`

- [ ] **Step 1: Type and format the existing timestamp**

Add `submitted_at: string | null` to `LeaveRow`. Update `formatDateTime` to include:

```ts
timeZone: 'America/New_York'
```

while retaining the existing invalid-value fallback.

- [ ] **Step 2: Render the Submitted column**

Add the header before Leave date:

```tsx
<th className="px-3 py-2 text-left">{t('提交时间', 'Submitted')}</th>
```

and the matching cell:

```tsx
<td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.submitted_at)}</td>
```

- [ ] **Step 3: Run build verification**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build exit successfully.

### Task 5: Full verification

**Files:**
- Verify all files changed by Tasks 1–4.

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
npx vitest run tests/unit/agencyShared.test.ts tests/unit/agencyLeaveDeadlineMigration.test.ts
```

Expected: both test files pass with zero failures.

- [ ] **Step 2: Run the full production build**

Run:

```powershell
npm run build
```

Expected: exit code 0.

- [ ] **Step 3: Review the final diff**

Run:

```powershell
git diff --check
git status --short
git diff -- src/shared/agencyShared.ts tests/unit/agencyShared.test.ts src/agency/AgencyAppPage.tsx src/admin/pages/LeaveApprovalPage.tsx sql/2026-07-27_enforce_agency_leave_24_hour_deadline.sql supabase/migrations/20260727000000_enforce_agency_leave_24_hour_deadline.sql tests/unit/agencyLeaveDeadlineMigration.test.ts
```

Expected: no whitespace errors and no unrelated files included in the feature diff.
