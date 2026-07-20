# Employee Position Column Unification Design

## Goal

Prevent employee positions from reverting after save when `ob_employees` contains both `position` and quoted `"Position"` columns, while repairing the confirmed conflict for `US019860` without disrupting older clients or temporary-employee workflows.

## Root Cause

PostgreSQL treats `position` and quoted `"Position"` as different columns. The production table currently contains both. Temporary-employee and agency flows can write `position`, while the admin compatibility probe selects the quoted-column mode first and writes `"Position"`. Employee displays prefer `position`, so a row with conflicting values appears to revert after a successful save.

`US019860` was upgraded from temporary ID `TUS0000136`. That path preserved `position = Shipping`; later admin edits wrote `"Position" = Receive`. It is the only active mismatch where both columns are populated with different values.

## Chosen Approach

Use lowercase `position` as the canonical application field, but keep `"Position"` synchronized during a compatibility period. Do not drop the quoted column in this change because existing deployed clients and most historical rows still rely on it.

The alternatives rejected are:

- UI-only precedence change: hides the current symptom but permits future divergence.
- Immediate removal of `"Position"`: cleanest final schema, but unsafe while older deployed clients may still write it.

## Database Design

Add a dated migration that:

1. Backfills `position` from `"Position"` whenever the quoted value is nonblank, otherwise preserves the lowercase value. This makes the most recently saved admin value (`Receive`) canonical for `US019860` and preserves lower-only temporary rows.
2. Adds a `BEFORE INSERT OR UPDATE` trigger that synchronizes either column when only one changes.
3. Rejects writes that explicitly attempt to set both columns to different nonblank values in the same statement.
4. Adds a validation constraint requiring the two populated values to match.

The migration is idempotent and checks that both columns exist before installing compatibility logic. It performs no deletion.

## Application Design

Extend employee column detection with a `both` mode. In that mode, employee edit and employee import updates write the same normalized position to both columns. Lower-only and quoted-only deployments retain their current payload shape.

Move mode-dependent position payload construction and position resolution into small pure helpers so the behavior is testable outside `AdminAppPage.tsx`. Existing display precedence remains lowercase-first because the database migration guarantees equality during the compatibility period.

## Data Repair

The migration repairs `US019860` by copying the current quoted value `Receive` into lowercase `position`. A post-migration read must show both fields as `Receive`. No other employee receives a different effective position: quoted-only rows are copied into lowercase, lower-only rows retain their existing value, and already-equal rows remain unchanged.

## Error Handling and Observability

Conflicting dual-column writes fail with a descriptive database error instead of silently choosing one value. Existing employee audit logging remains in place. Verification includes a mismatch-count query that must return zero after the migration.

## Testing and Verification

- Unit tests cover position resolution and write payloads for `lower`, `cased`, and `both` modes.
- A regression test reproduces `position = Shipping` with `"Position" = Receive` and confirms `both` mode resolves and writes one canonical value.
- Run the targeted Vitest test, the full relevant unit suite, and `npm run build`.
- Apply the migration, then verify `US019860` and the global mismatch count with read-only queries.

## Follow-up

After all deployed clients use the lowercase field and the mismatch monitor remains at zero, a separate reviewed migration can remove the trigger, constraint, and quoted `"Position"` column. That destructive schema cleanup is intentionally outside this change.
