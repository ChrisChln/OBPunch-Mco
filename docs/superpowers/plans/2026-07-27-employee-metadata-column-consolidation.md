# Employee Metadata Column Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the duplicate Agency and Position values into lowercase `agency` and `position`, safely remove `"Agency"` and `"Position"`, and make application code use the canonical columns only.

**Architecture:** Ship an atomic, database-first migration that snapshots the four source fields, resolves values with quoted-column precedence, validates all positions, drops legacy columns without `CASCADE`, and installs a lowercase-only guard. After the database migration contract is proven, simplify employee write helpers and application reads so only lowercase fields remain.

**Tech Stack:** PostgreSQL 17, Supabase migrations, React 18, TypeScript, Supabase JS v2, Vitest, Vite

---

### Task 1: Replace the pending dual-column repair with a consolidation contract

**Files:**
- Modify: `tests/unit/employeePositionRequiredMigration.test.ts`
- Remove: `sql/2026-07-24_fix_employee_position_required_dual_columns.sql`
- Remove: `supabase/migrations/20260725033000_fix_employee_position_required_dual_columns.sql`
- Create: `sql/2026-07-27_consolidate_employee_metadata_columns.sql`
- Create: `supabase/migrations/20260727190000_consolidate_employee_metadata_columns.sql`

- [ ] **Step 1: Write the failing migration contract tests**

Replace the dual-column repair suite with assertions that require a snapshot,
quoted-first merge, validation-before-drop ordering, lowercase-only trigger,
and absence of `CASCADE`:

```ts
describe('employee metadata column consolidation migration', () => {
  const datedSqlPath = resolve(
    process.cwd(),
    'sql/2026-07-27_consolidate_employee_metadata_columns.sql'
  );
  const supabaseMigrationPath = resolve(
    process.cwd(),
    'supabase/migrations/20260727190000_consolidate_employee_metadata_columns.sql'
  );
  const readSql = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  const datedSql = readSql(datedSqlPath);
  const supabaseMigrationSql = readSql(supabaseMigrationPath);

  test.each([
    ['dated SQL', datedSql],
    ['Supabase migration', supabaseMigrationSql]
  ])('%s snapshots and consolidates employee metadata safely', (_label, sql) => {
    expect(sql).toContain('ob_employee_metadata_column_backup_20260727');
    expect(sql).toContain('coalesce(nullif(btrim(employee."Agency")');
    expect(sql).toContain('coalesce(nullif(btrim(employee."Position")');
    expect(sql).toContain('raise exception');
    expect(sql).toContain('drop column "Agency"');
    expect(sql).toContain('drop column "Position"');
    expect(sql.toLowerCase()).not.toContain('cascade');
  });

  test.each([
    ['dated SQL', datedSql],
    ['Supabase migration', supabaseMigrationSql]
  ])('%s validates before dropping and installs a lowercase-only guard', (_label, sql) => {
    const validationIndex = sql.indexOf("Position consolidation left blank values");
    const dropIndex = sql.indexOf('drop column "Agency"');
    expect(validationIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeGreaterThan(validationIndex);
    expect(sql).toContain('new.agency');
    expect(sql).toContain('new.position');
    expect(sql).not.toContain("to_jsonb(new) ->> 'Position'");
    expect(sql).not.toContain("to_jsonb(new) ->> 'Agency'");
  });

  test('keeps the dated SQL and Supabase migration identical', () => {
    expect(datedSql).not.toBe('');
    expect(supabaseMigrationSql).toBe(datedSql);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/employeePositionRequiredMigration.test.ts
```

Expected: FAIL because the consolidation files do not exist and the pending
dual-column repair still represents the rejected architecture.

- [ ] **Step 3: Remove the two uncommitted repair files explicitly**

Remove only:

```text
sql/2026-07-24_fix_employee_position_required_dual_columns.sql
supabase/migrations/20260725033000_fix_employee_position_required_dual_columns.sql
```

Do not alter historical applied migrations.

- [ ] **Step 4: Create the atomic consolidation migration**

Both migration copies must contain the same SQL. The core data operations are:

```sql
begin;

lock table public.ob_employees in access exclusive mode;

create table public.ob_employee_metadata_column_backup_20260727 as
select
  staff_id,
  "Agency" as legacy_agency,
  agency as lowercase_agency,
  "Position" as legacy_position,
  position as lowercase_position,
  created_at as employee_created_at,
  updated_at as employee_updated_at,
  clock_timestamp() as backed_up_at
from public.ob_employees;

update public.ob_employees as employee
set
  agency = coalesce(nullif(btrim(employee."Agency"), ''), nullif(btrim(employee.agency), '')),
  position = coalesce(nullif(btrim(employee."Position"), ''), nullif(btrim(employee.position), ''));

do $$
begin
  if exists (
    select 1
    from public.ob_employees
    where nullif(btrim(position), '') is null
  ) then
    raise exception 'Position consolidation left blank values.';
  end if;
end
$$;

alter table public.ob_employees
  drop column "Agency",
  drop column "Position";
```

Before the backup, assert all four columns exist through
`information_schema.columns`. Before updating, drop only
`require_employee_position_before_write` and
`ob_employees_position_required_check`. After the drop, recreate the check
against `position` and recreate `public.require_employee_position()` using only
`new.agency` and `new.position`. Enable RLS on the backup, revoke access from
`anon` and `authenticated`, add column comments, execute
`pg_notify('pgrst', 'reload schema')`, and commit.

- [ ] **Step 5: Run the contract test and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/unit/employeePositionRequiredMigration.test.ts
```

Expected: PASS for the original required-position migration and the new
consolidation contract.

- [ ] **Step 6: Commit the database migration**

Stage only the migration pair and migration contract test, then commit:

```powershell
git add -- tests/unit/employeePositionRequiredMigration.test.ts sql/2026-07-27_consolidate_employee_metadata_columns.sql supabase/migrations/20260727190000_consolidate_employee_metadata_columns.sql
git commit -m "Consolidate employee metadata columns"
```

### Task 2: Simplify employee write helpers to lowercase-only payloads

**Files:**
- Modify: `tests/unit/employeePositionColumns.test.ts`
- Modify: `src/admin/employeePositionColumns.ts`
- Modify: `src/admin/AdminAppPage.tsx`

- [ ] **Step 1: Replace compatibility tests with canonical payload tests**

Use this test shape:

```ts
import { describe, expect, test } from 'vitest';
import { buildEmployeeEditWritePayload } from '../../src/admin/employeePositionColumns';

describe('employee metadata writes', () => {
  test('writes canonical lowercase agency and position columns only', () => {
    const payload = buildEmployeeEditWritePayload({
      staffId: 'US018637',
      name: 'Kristi Marmol',
      agency: 'Prime',
      position: 'Pick',
      employmentType: 'FT',
      shift: 'early',
      shiftTime: '07:00',
      label: 'Lead',
      workAccount: 'KristiMarmol',
      workPassword: 'Mco123456'
    });

    expect(payload).toMatchObject({ agency: 'Prime', position: 'Pick' });
    expect(payload).not.toHaveProperty('Agency');
    expect(payload).not.toHaveProperty('Position');
  });
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/employeePositionColumns.test.ts
```

Expected: FAIL because the helper still requires mode arguments and can emit
quoted columns.

- [ ] **Step 3: Make the helper lowercase-only**

Remove `EmployeePositionColumnMode`, `probeEmployeePositionColumnMode`, and
`buildEmployeePositionWritePayload`. Change `EmployeeEditWriteInput` to omit
mode fields and return:

```ts
export const buildEmployeeEditWritePayload = ({
  staffId,
  name,
  agency,
  position,
  employmentType,
  shift,
  shiftTime,
  label,
  workAccount,
  workPassword
}: EmployeeEditWriteInput): Record<string, unknown> => ({
  staff_id: staffId,
  name,
  agency: agency || null,
  position,
  employment_type: employmentType,
  shift: shift || null,
  shift_time: shiftTime || null,
  label: label || null,
  work_account: workAccount || null,
  work_password: workPassword || null,
  active: true,
  terminated_at: null
});
```

- [ ] **Step 4: Remove dual-column write orchestration from AdminAppPage**

Remove the position mode import, ref, and resolver. Pass no mode fields to
`buildEmployeeEditWritePayload`. Employee import/update payloads must assign:

```ts
payload.agency = normalizedAgency || null;
payload.position = normalizedPosition || null;
```

They must never assign `Agency` or `Position`.

- [ ] **Step 5: Run the helper test and verify GREEN**

Run:

```powershell
npm.cmd test -- tests/unit/employeePositionColumns.test.ts tests/unit/employeeUploadPositions.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit lowercase-only writes**

```powershell
git add -- src/admin/employeePositionColumns.ts src/admin/AdminAppPage.tsx tests/unit/employeePositionColumns.test.ts
git commit -m "Write canonical employee metadata columns"
```

### Task 3: Remove quoted Agency and Position reads from runtime code

**Files:**
- Modify: runtime files returned by:
  `rg -l '\.Agency|\.Position|"Agency"|"Position"' src api`
- Modify: affected unit and agency tests under `tests/`

- [ ] **Step 1: Add or update representative read tests**

Update employee fixtures to provide `agency` and `position` only. Assert
departed employees, schedule sorting, dashboard statistics, package staffing,
and agency API normalization continue returning the same canonical values.
Remove tests whose only purpose is quoted-column fallback.

- [ ] **Step 2: Run the representative tests and verify RED**

Run:

```powershell
npm.cmd test -- tests/unit/departedEmployees.test.ts tests/unit/employeePositionSort.test.ts tests/unit/adminAccess.test.ts tests/agency/apiDepartedEmployees.test.ts
```

Expected: at least one failure or TypeScript error while runtime readers still
expect quoted fixtures or compatibility types.

- [ ] **Step 3: Replace runtime fallback reads**

For employee records only, apply these exact transformations:

```ts
String(employee.agency ?? employee.Agency ?? '').trim()
```

becomes:

```ts
String(employee.agency ?? '').trim()
```

and:

```ts
String(employee.position ?? employee.Position ?? '').trim()
```

becomes:

```ts
String(employee.position ?? '').trim()
```

Update helper key arrays from `['agency', 'Agency']` to `['agency']` and from
`['position', 'Position']` to `['position']`. Remove quoted keys from employee
row interfaces. Do not change unrelated CSS `position`, schedule `position`,
or UI labels named “Position”.

- [ ] **Step 4: Remove quoted-column query branches**

All `ob_employees` selects use lowercase columns:

```ts
'staff_id, name, agency, position, active, terminated_at'
```

Remove probes that select `"Agency"` or `"Position"` and remove branch modes
that exist only for those fields.

- [ ] **Step 5: Verify no runtime quoted-column dependency remains**

Run:

```powershell
rg -n '\.Agency|\.Position|"Agency"|"Position"' src api
```

Expected: no employee database dependency remains. Any retained match must be a
display label or a non-employee domain type and must be inspected explicitly.

- [ ] **Step 6: Run representative tests and build**

Run:

```powershell
npm.cmd test -- tests/unit/employeePositionColumns.test.ts tests/unit/departedEmployees.test.ts tests/unit/employeePositionSort.test.ts tests/unit/adminAccess.test.ts tests/agency/apiDepartedEmployees.test.ts
npm.cmd run build
```

Expected: all selected tests pass and the production build exits zero.

- [ ] **Step 7: Commit runtime cleanup**

Stage only inspected runtime and test files, then commit:

```powershell
git commit -m "Remove legacy employee metadata reads"
```

### Task 4: Verify the migration against production preconditions

**Files:**
- Verify: `supabase/migrations/20260727190000_consolidate_employee_metadata_columns.sql`
- Verify: production `public.ob_employees`

- [ ] **Step 1: Record read-only production preconditions**

Using the configured Supabase service role without printing credentials, record:

- total row count;
- nonblank combined Position count;
- Agency and Position mismatch counts;
- the values for `US019737`;
- the four approved conflict rows.

Expected baseline: 320 rows, no combined blank Position, `US019737` resolves to
`Pack`, and the four conflicts match the design document.

- [ ] **Step 2: Confirm migration ordering**

Run:

```powershell
npx supabase migration list --linked
```

Expected: the rejected `20260725033000` migration is absent locally and the new
`20260727190000` migration is local-only.

- [ ] **Step 3: Do not apply automatically**

The migration drops production columns. Stop after code and verification unless
the user explicitly asks to deploy/apply the database migration. Provide the
exact migration filename and preflight evidence for review.

### Task 5: Final verification and scope review

**Files:**
- Verify all files changed by Tasks 1–3

- [ ] **Step 1: Run targeted tests**

```powershell
npm.cmd test -- tests/unit/employeePositionRequiredMigration.test.ts tests/unit/employeePositionColumns.test.ts tests/unit/employeeUploadPositions.test.ts tests/unit/departedEmployees.test.ts tests/unit/employeePositionSort.test.ts tests/unit/adminAccess.test.ts tests/agency/apiDepartedEmployees.test.ts
```

Expected: all targeted tests pass with zero failures.

- [ ] **Step 2: Run the full production build**

```powershell
npm.cmd run build
```

Expected: TypeScript and Vite exit zero.

- [ ] **Step 3: Inspect repository scope**

```powershell
git status --short
git diff --check
git log -4 --oneline
```

Expected: no whitespace errors; only the approved consolidation design, plan,
migration, application cleanup, and tests are changed.

- [ ] **Step 4: Report deployment boundary**

Report that code is ready and identify whether the production migration remains
unapplied. Do not claim the production schema is consolidated until a fresh
post-migration read confirms the quoted columns are absent.
