# Employee Metadata Column Consolidation Design

## Goal

Make lowercase `agency` and `position` the only Agency and Position columns on
`public.ob_employees`. Preserve all existing employee data, resolve known
conflicts deterministically, and remove the quoted legacy columns `"Agency"`
and `"Position"` without using `CASCADE`.

This design supersedes the compatibility-period cleanup deferred by
`2026-07-20-employee-position-column-unification-design.md`.

## Confirmed Production State

The production table contains four independent writable columns:

- `"Agency"` and `agency`
- `"Position"` and `position`

Across 320 current rows:

- 297 rows have different normalized Agency values.
- 286 rows have different normalized Position values.
- 277 rows contain only the quoted Agency value.
- 20 rows contain only the lowercase Agency value.
- 261 rows contain only the quoted Position value.
- 21 rows contain only the lowercase Position value.
- Four active rows contain conflicting nonblank Position values.

`US019737`, from the reported departure failure, has `"Position" = 'Pack'`
and `position is null`. The current required-position constraint checks the
lowercase column, so an unrelated departure update is rejected.

## Chosen Approach

Use a two-release consolidation:

1. Apply one atomic database migration that snapshots, merges, validates, and
   removes the legacy columns.
2. After the migration succeeds, deploy application cleanup that removes
   quoted-column probing, fallback reads, and dual-column writes.

The current application already falls back from quoted columns to lowercase
columns when the quoted columns are absent. This makes the database-first
deployment order compatible with the currently deployed client.

## Alternatives Considered

### Keep both columns synchronized

This reduces immediate write failures but preserves the duplicate source of
truth, compatibility branches, and future divergence risk. It is rejected
because the requested end state is one column per field.

### Drop the quoted columns without a snapshot

This is simpler but makes conflict-resolution mistakes difficult to recover
from. It is rejected because the table contains confirmed divergent data.

### Consolidate in one database and application release

This creates ordering risk: application code that assumes the merged lowercase
data could deploy before the database migration. Separate database-first and
application-cleanup releases avoid that window.

## Database Migration

The migration runs in a transaction and performs these operations:

1. Acquire the table lock required for deterministic validation and DDL.
2. Assert that all four expected columns exist.
3. Create a timestamped backup table containing `staff_id`, both Agency
   values, both Position values, and the source row timestamps. The backup is
   outside `ob_employees` and is not used by application queries.
4. Remove the current required-position trigger and constraint.
5. Merge into lowercase columns:
   - `agency` uses nonblank `"Agency"` first, then nonblank `agency`.
   - `position` uses nonblank `"Position"` first, then nonblank `position`.
6. Assert that no merged Position is blank. Any failure raises an exception
   and rolls back the entire migration.
7. Drop `"Agency"` and `"Position"` without `CASCADE`. Any unknown dependent
   object blocks the migration and triggers a full rollback.
8. Recreate the required-position constraint against lowercase `position`.
9. Recreate the defaulting/validation trigger using only lowercase `agency`
   and `position`.
10. Add canonical-column comments and notify PostgREST to reload its schema.

The four confirmed Position conflicts use the quoted `"Position"` value, as
approved. Existing quoted-only and lowercase-only rows are both preserved.

## Application Cleanup

After the database migration:

- Employee reads use `agency` and `position` only.
- Employee inserts and updates write `agency` and `position` only.
- Position-column probing and the `both` mode are removed.
- SQL functions introduced by this change use only lowercase columns.
- Historical migrations remain unchanged except for the currently uncommitted,
  not-yet-applied dual-column repair, which is replaced by the consolidation
  migration.
- Compatibility helpers for unrelated legacy employee fields remain out of
  scope.

## Failure and Rollback Behavior

- The migration never uses `DROP ... CASCADE`.
- All merge, validation, and drop operations are atomic.
- A missing column, blank merged Position, or dependent database object aborts
  before commit.
- The backup table provides the exact pre-merge values needed for a reviewed
  rollback migration.
- The backup table is retained until production verification is complete. Its
  later removal requires a separate explicit operation.

## Testing

Test-first coverage will verify that the migration:

- selects quoted values first while preserving lowercase-only rows;
- snapshots the four source columns before mutation;
- validates merged Position data before dropping columns;
- drops only `"Agency"` and `"Position"` and never uses `CASCADE`;
- recreates the trigger and constraint against lowercase columns only;
- keeps the dated SQL and Supabase migration identical.

Application tests will verify that employee payloads and reads no longer depend
on quoted Agency or Position columns.

## Deployment Verification

Before applying the migration, record row and mismatch counts. After applying
it:

- confirm `ob_employees` exposes `agency` and `position` but not the quoted
  legacy columns;
- confirm the row count remains 320;
- confirm every Position is nonblank;
- verify `US019737` retains `Pack`;
- verify the four conflict rows retain their approved quoted Position values;
- exercise employee departure, employee edit, employee add/import, schedule
  loading, and Agency access;
- run targeted unit tests and `npm run build` before application deployment.
