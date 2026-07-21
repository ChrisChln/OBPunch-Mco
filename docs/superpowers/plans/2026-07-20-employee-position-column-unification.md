# Employee Position Column Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make employee position saves deterministic when both `position` and `"Position"` exist, repair `US019860`, and prevent either column from diverging again.

**Architecture:** Add a focused pure helper for position-column detection, resolution, and write payloads; integrate it into admin edit/import paths without changing Agency-column compatibility. Add an idempotent PostgreSQL migration that backfills both position columns, synchronizes single-column writes in either direction, rejects conflicting dual writes, and validates equality.

**Tech Stack:** React 18, TypeScript, Supabase JS v2, PostgreSQL, Vitest, Vite

---

### Task 1: Position-column compatibility helper

**Files:**
- Create: `src/admin/employeePositionColumns.ts`
- Create: `tests/unit/employeePositionColumns.test.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildEmployeePositionWritePayload,
  detectEmployeePositionColumnMode,
  resolveEmployeePositionValue
} from '../../src/admin/employeePositionColumns';

describe('employee position columns', () => {
  it('detects a table containing both position columns', () => {
    expect(detectEmployeePositionColumnMode({ lowerAvailable: true, casedAvailable: true })).toBe('both');
  });

  it('prefers the lowercase canonical value while both columns coexist', () => {
    expect(resolveEmployeePositionValue({ position: 'Receive', Position: 'Shipping' })).toBe('Receive');
  });

  it('falls back to the quoted value for historical rows', () => {
    expect(resolveEmployeePositionValue({ position: null, Position: 'Pack' })).toBe('Pack');
  });

  it('writes both columns in dual-column mode', () => {
    expect(buildEmployeePositionWritePayload('both', 'Receive')).toEqual({ position: 'Receive', Position: 'Receive' });
  });

  it('writes only the available column in single-column modes', () => {
    expect(buildEmployeePositionWritePayload('lower', 'Pick')).toEqual({ position: 'Pick' });
    expect(buildEmployeePositionWritePayload('cased', null)).toEqual({ Position: null });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- tests/unit/employeePositionColumns.test.ts`

Expected: FAIL because `src/admin/employeePositionColumns.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

```ts
export type EmployeePositionColumnMode = 'lower' | 'cased' | 'both';

export interface EmployeePositionRecord {
  position?: unknown;
  Position?: unknown;
}

export const detectEmployeePositionColumnMode = ({
  lowerAvailable,
  casedAvailable
}: {
  lowerAvailable: boolean;
  casedAvailable: boolean;
}): EmployeePositionColumnMode => {
  if (lowerAvailable && casedAvailable) return 'both';
  if (lowerAvailable) return 'lower';
  return 'cased';
};

export const resolveEmployeePositionValue = (row: EmployeePositionRecord | null | undefined): string => {
  const lower = String(row?.position ?? '').trim();
  if (lower) return lower;
  return String(row?.Position ?? '').trim();
};

export const buildEmployeePositionWritePayload = (
  mode: EmployeePositionColumnMode,
  position: string | null
): { position?: string | null; Position?: string | null } => {
  if (mode === 'both') return { position, Position: position };
  return mode === 'lower' ? { position } : { Position: position };
};
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm.cmd test -- tests/unit/employeePositionColumns.test.ts`

Expected: PASS with five tests.

- [ ] **Step 5: Commit the helper and tests**

```powershell
git add src/admin/employeePositionColumns.ts tests/unit/employeePositionColumns.test.ts
git commit -m "Add employee position column compatibility helpers"
```

### Task 2: Integrate deterministic position writes

**Files:**
- Modify: `src/admin/AdminAppPage.tsx:1476`
- Modify: `src/admin/AdminAppPage.tsx:2959`
- Modify: `src/admin/AdminAppPage.tsx:9214`
- Modify: `src/admin/AdminAppPage.tsx:13814`
- Test: `tests/unit/employeePositionColumns.test.ts`

- [ ] **Step 1: Add a failing asynchronous probe test**

Extend the helper import with `probeEmployeePositionColumnMode`, then append:

```ts
it('probes both physical position columns independently', async () => {
  const probed: Array<'position' | 'Position'> = [];
  const mode = await probeEmployeePositionColumnMode(async (column) => {
    probed.push(column);
    return true;
  });

  expect(probed).toEqual(['position', 'Position']);
  expect(mode).toBe('both');
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `npm.cmd test -- tests/unit/employeePositionColumns.test.ts`

Expected: FAIL because `probeEmployeePositionColumnMode` is not exported.

- [ ] **Step 3: Add position-mode probing without changing Agency mode**

Import the helper and add a dedicated ref:

```ts
import {
  buildEmployeePositionWritePayload,
  probeEmployeePositionColumnMode,
  type EmployeePositionColumnMode
} from './employeePositionColumns';

const employeePositionColumnModeRef = useRef<EmployeePositionColumnMode | null>(null);
```

Add a resolver next to `resolveEmployeeColumnMode`:

```ts
// Add this pure orchestration helper to employeePositionColumns.ts first.
export const probeEmployeePositionColumnMode = async (
  probe: (column: 'position' | 'Position') => Promise<boolean>
): Promise<EmployeePositionColumnMode> =>
  detectEmployeePositionColumnMode({
    lowerAvailable: await probe('position'),
    casedAvailable: await probe('Position')
  });

const resolveEmployeePositionColumnMode = async (): Promise<EmployeePositionColumnMode> => {
  const cached = employeePositionColumnModeRef.current;
  if (cached) return cached;
  if (!supabase) return 'lower';

  const mode = await probeEmployeePositionColumnMode(async (column) => {
    const select = column === 'Position' ? 'staff_id, "Position"' : 'staff_id, position';
    const result = await supabase.from(EMPLOYEE_TABLE).select(select).limit(1);
    return !result.error;
  });
  employeePositionColumnModeRef.current = mode;
  return mode;
};
```

Keep `EmployeeColumnMode = 'lower' | 'cased'` unchanged so Agency, Label, WorkAccount, and other compatibility behavior cannot switch columns as a side effect.

- [ ] **Step 4: Make employee edit write the detected position columns**

Resolve both modes before building the payload:

```ts
const mode = await resolveEmployeeColumnMode();
const positionMode = await resolveEmployeePositionColumnMode();
const positionPayload = buildEmployeePositionWritePayload(positionMode, normalizedPos);
```

Remove the inline `Position`/`position` property from each branch and spread `...positionPayload` into both payload branches.

- [ ] **Step 5: Make employee import updates write the detected position columns**

Resolve `positionMode` once in `writeEmployeeBatch`. Replace the current conditional at the position update with:

```ts
Object.assign(payload, buildEmployeePositionWritePayload(positionMode, String(row.position).trim()));
```

Leave the existing `existingDetailsRes.mode` logic in place for all non-position fields.

- [ ] **Step 6: Run targeted tests and build**

Run: `npm.cmd test -- tests/unit/employeePositionColumns.test.ts tests/unit/employeeUploadPositions.test.ts`

Expected: PASS.

Run: `npm.cmd run build`

Expected: TypeScript and Vite production build complete successfully.

- [ ] **Step 7: Commit application integration**

```powershell
git add src/admin/AdminAppPage.tsx tests/unit/employeePositionColumns.test.ts
git commit -m "Keep employee position columns synchronized"
```

### Task 3: Add the database synchronization migration

**Files:**
- Create: `sql/2026-07-20_unify_employee_position_columns.sql`
- Create: `tests/unit/employeePositionMigration.test.ts`

- [ ] **Step 1: Write a failing migration contract test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'sql/2026-07-20_unify_employee_position_columns.sql'), 'utf8');

describe('employee position column migration', () => {
  it('backfills, synchronizes, rejects conflicts, and validates equality', () => {
    expect(sql).toContain('sync_ob_employee_position_columns');
    expect(sql).toContain('before insert or update');
    expect(sql).toContain('Conflicting employee position columns');
    expect(sql).toContain('ob_employees_position_columns_match');
    expect(sql).toContain('validate constraint ob_employees_position_columns_match');
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm.cmd test -- tests/unit/employeePositionMigration.test.ts`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Create the idempotent migration**

```sql
do $$
declare
  has_lower boolean;
  has_cased boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ob_employees' and column_name = 'position'
  ) into has_lower;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ob_employees' and column_name = 'Position'
  ) into has_cased;

  if not (has_lower and has_cased) then
    raise notice 'Position compatibility migration skipped because both columns are not present.';
    return;
  end if;

  update public.ob_employees
  set
    position = coalesce(nullif(btrim("Position"), ''), nullif(btrim(position), '')),
    "Position" = coalesce(nullif(btrim("Position"), ''), nullif(btrim(position), ''))
  where position is distinct from coalesce(nullif(btrim("Position"), ''), nullif(btrim(position), ''))
     or "Position" is distinct from coalesce(nullif(btrim("Position"), ''), nullif(btrim(position), ''));

  execute $function$
    create or replace function public.sync_ob_employee_position_columns()
    returns trigger
    language plpgsql
    as $body$
    declare
      lower_changed boolean := tg_op = 'INSERT' or new.position is distinct from old.position;
      cased_changed boolean := tg_op = 'INSERT' or new."Position" is distinct from old."Position";
      lower_value text := nullif(btrim(new.position), '');
      cased_value text := nullif(btrim(new."Position"), '');
    begin
      if tg_op = 'INSERT' then
        if lower_value is not null and cased_value is not null and lower_value is distinct from cased_value then
          raise exception 'Conflicting employee position columns: position=% and Position=%', new.position, new."Position";
        end if;
        new.position := coalesce(lower_value, cased_value);
        new."Position" := coalesce(lower_value, cased_value);
        return new;
      end if;

      if lower_changed and cased_changed and lower_value is distinct from cased_value then
        raise exception 'Conflicting employee position columns: position=% and Position=%', new.position, new."Position";
      elsif lower_changed then
        new.position := lower_value;
        new."Position" := lower_value;
      elsif cased_changed then
        new.position := cased_value;
        new."Position" := cased_value;
      end if;
      return new;
    end;
    $body$
  $function$;

  drop trigger if exists sync_ob_employee_position_columns on public.ob_employees;
  create trigger sync_ob_employee_position_columns
  before insert or update of position, "Position" on public.ob_employees
  for each row execute function public.sync_ob_employee_position_columns();

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ob_employees'::regclass
      and conname = 'ob_employees_position_columns_match'
  ) then
    alter table public.ob_employees
      add constraint ob_employees_position_columns_match
      check (nullif(btrim(position), '') is not distinct from nullif(btrim("Position"), ''))
      not valid;
  end if;

  alter table public.ob_employees validate constraint ob_employees_position_columns_match;
end
$$;
```

- [ ] **Step 4: Run the contract test and verify GREEN**

Run: `npm.cmd test -- tests/unit/employeePositionMigration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the migration and test**

```powershell
git add sql/2026-07-20_unify_employee_position_columns.sql tests/unit/employeePositionMigration.test.ts
git commit -m "Prevent employee position column divergence"
```

### Task 4: Apply, verify, and run the regression suite

**Files:**
- Verify: `sql/2026-07-20_unify_employee_position_columns.sql`
- Verify: `src/admin/AdminAppPage.tsx`

- [ ] **Step 1: Confirm the exact migration target before writing**

Run read-only checks for the configured Supabase project URL, migration history, and the current `US019860` row. Do not print credentials. Expected precondition: `position = Shipping`, `"Position" = Receive`.

- [ ] **Step 2: Apply only the new dated migration**

Use the repository's linked Supabase migration command or SQL execution path. Do not run unrelated pending migrations. Expected: transaction succeeds without deleting rows.

- [ ] **Step 3: Verify the repaired employee and global invariant**

Run read-only queries equivalent to:

```sql
select staff_id, position, "Position"
from public.ob_employees
where staff_id = 'US019860';

select count(*) as mismatch_count
from public.ob_employees
where nullif(btrim(position), '') is distinct from nullif(btrim("Position"), '');
```

Expected: `US019860` has `Receive` in both columns and `mismatch_count = 0`.

- [ ] **Step 4: Verify the trigger in a rollback-safe transaction**

Inside a transaction, update one column for `US019860`, confirm the other matches, then roll back. The final persisted value must remain `Receive`.

- [ ] **Step 5: Run final automated verification**

Run: `npm.cmd test -- tests/unit/employeePositionColumns.test.ts tests/unit/employeePositionMigration.test.ts tests/unit/employeeUploadPositions.test.ts tests/unit/employeesTableSection.test.tsx`

Expected: PASS.

Run: `npm.cmd run build`

Expected: PASS with no TypeScript or Vite errors.

- [ ] **Step 6: Inspect final scope**

Run: `git status --short` and `git diff HEAD~3 --stat`.

Expected: only the helper, targeted admin integration, migration, tests, design, and plan are present.
