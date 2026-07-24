# Timecard Punch Save Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make timecard punch batches save atomically with position-scoped authorization and database-confirmed results.

**Architecture:** Add a focused TypeScript boundary for permission resolution, RPC payload construction, response validation, and confirmed-hour calculation. Add a security-definer PostgreSQL RPC that validates the caller and every target row before applying the entire batch in one transaction, then integrate the existing timecard editor with that contract.

**Tech Stack:** React 18, TypeScript, Supabase JS v2, PostgreSQL/PLpgSQL, Vitest.

---

## File Map

- Create `src/admin/timecardPunchSave.ts`: typed client contract and pure validation/calculation helpers.
- Create `tests/unit/timecardPunchSave.test.ts`: client contract regression tests.
- Create `supabase/migrations/20260724170000_save_timecard_punch_changes.sql`: atomic authorized RPC.
- Create `sql/2026-07-24_save_timecard_punch_changes.sql`: deployable mirror of the migration.
- Create `tests/unit/timecardPunchSaveMigration.test.ts`: SQL security and transaction contract checks.
- Modify `src/admin/AdminAppPage.tsx`: position-aware editability and RPC-backed save flow.

### Task 1: Client Save Contract

**Files:**
- Create: `tests/unit/timecardPunchSave.test.ts`
- Create: `src/admin/timecardPunchSave.ts`

- [ ] **Step 1: Write failing permission and response tests**

Test that module-level operate access is insufficient when position access is
view-only, malformed RPC output is rejected, and confirmed rows are normalized:

```ts
expect(canOperateTimecardPunches(true, 'Pick', () => false)).toBe(false);
expect(() => parseTimecardPunchSaveResult(null)).toThrow('confirmed punch rows');
expect(parseTimecardPunchSaveResult({ rows: [{ id: 7, staff_id: 'us001', action: 'out', created_at: validIso }] }))
  .toEqual([{ id: '7', staff_id: 'US001', action: 'OUT', created_at: validIso }]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/unit/timecardPunchSave.test.ts
```

Expected: FAIL because `src/admin/timecardPunchSave.ts` does not exist.

- [ ] **Step 3: Implement the minimal typed helpers**

Export:

```ts
export type ConfirmedPunchRow = {
  id: string;
  staff_id: string;
  action: 'IN' | 'OUT';
  created_at: string;
};

export const canOperateTimecardPunches = (
  moduleCanOperate: boolean,
  position: string,
  canOperatePosition: (position: string) => boolean
) => moduleCanOperate && Boolean(position.trim()) && canOperatePosition(position);
```

Add `buildTimecardPunchSavePayload`, `parseTimecardPunchSaveResult`, and
`computeConfirmedOperationalDayHours`. Reject missing rows, duplicate IDs,
invalid actions, invalid timestamps, wrong staff IDs, and rows outside the
operational range.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/timecardPunchSave.test.ts
```

Expected: PASS.

### Task 2: Atomic Database RPC

**Files:**
- Create: `tests/unit/timecardPunchSaveMigration.test.ts`
- Create: `supabase/migrations/20260724170000_save_timecard_punch_changes.sql`
- Create: `sql/2026-07-24_save_timecard_punch_changes.sql`

- [ ] **Step 1: Write the failing migration contract test**

Read both SQL files and require each to contain:

```ts
expect(sql).toContain('security definer');
expect(sql).toContain("auth.uid() is null");
expect(sql).toContain("user_can_access_staff_position('timecard', v_staff_id, 'operate')");
expect(sql).toContain('for update');
expect(sql).toContain("raise exception 'Punch record not found");
expect(sql).toContain("raise exception 'Punch record belongs to another employee");
expect(sql).toContain('revoke all on function public.save_timecard_punch_changes');
expect(sql).toContain('grant execute on function public.save_timecard_punch_changes');
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```powershell
npx vitest run tests/unit/timecardPunchSaveMigration.test.ts
```

Expected: FAIL because the migration files do not exist.

- [ ] **Step 3: Implement the RPC**

Create:

```sql
public.save_timecard_punch_changes(
  p_staff_id text,
  p_work_date date,
  p_edits jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb,
  p_delete_ids jsonb default '[]'::jsonb,
  p_operator text default null
) returns jsonb
```

The function must normalize the staff ID, require authentication and
position-level operate access, validate JSON array shapes, lock and validate all
persisted target IDs before any mutation, enforce the 05:00 operational range,
write correction metadata, and return:

```json
{
  "rows": [],
  "edited_count": 0,
  "added_count": 0,
  "deleted_count": 0
}
```

Use a fixed `search_path`, revoke public execution, and grant execution only to
`authenticated`. Keep the two migration copies byte-for-byte identical.

- [ ] **Step 4: Run the migration test and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/timecardPunchSaveMigration.test.ts
```

Expected: PASS.

### Task 3: Integrate the Timecard Editor

**Files:**
- Modify: `src/admin/AdminAppPage.tsx:12453-12505`
- Modify: `src/admin/AdminAppPage.tsx:13083-13418`
- Modify: `src/admin/AdminAppPage.tsx:15167`
- Test: `tests/unit/timecardPunchSave.test.ts`

- [ ] **Step 1: Extend the client tests for RPC payload construction**

Assert that edits, additions, deletions, staff ID, work date, and operator map to
the exact Supabase RPC parameter names:

```ts
expect(payload).toMatchObject({
  p_staff_id: 'US001',
  p_work_date: '2026-07-24',
  p_delete_ids: ['9']
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/unit/timecardPunchSave.test.ts
```

Expected: FAIL because the required payload behavior is absent.

- [ ] **Step 3: Implement position-aware editability**

Resolve the selected employee position once and define the modal as writable
only when:

```ts
canOperateTimecardPunches(
  timecardCanOperate,
  selectedPosition,
  (position) => canOperatePosition('timecard', position)
)
```

Keep the modal available in read-only mode for users with view access. Use the
same predicate in add, delete, and save handlers so UI state and handler
authorization cannot diverge.

- [ ] **Step 4: Replace direct mutations with one RPC call**

Build the typed payload and call:

```ts
const rpcResult = await supabase.rpc('save_timecard_punch_changes', payload);
```

On error or malformed output, keep the modal open, retain staged edits, and show
the error. On success, calculate `hours_after` and punch count from returned
rows, write the existing audit entry, clear the week cache, close the modal, and
await a soft timecard refresh. Do not increment edit counts from local draft
operations.

- [ ] **Step 5: Run focused tests and build**

Run:

```powershell
npx vitest run tests/unit/timecardPunchSave.test.ts tests/unit/timecardPunchSaveMigration.test.ts
npm run build
```

Expected: all focused tests PASS and build exits 0.

### Task 4: Regression Verification

**Files:**
- Review all files above.

- [ ] **Step 1: Run the full unit suite**

Run:

```powershell
npm run test:unit
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Check source and migration consistency**

Run:

```powershell
git diff --check
git diff --no-index -- sql/2026-07-24_save_timecard_punch_changes.sql supabase/migrations/20260724170000_save_timecard_punch_changes.sql
```

Expected: both commands exit 0.

- [ ] **Step 3: Review the final diff**

Confirm:

- No direct `ob_punches` update/insert/delete remains in
  `saveAllTimecardPunchRows`.
- Audit `hours_after` comes from confirmed RPC rows.
- Unauthorized position access is read-only before save.
- RPC rejects partial, missing, mismatched, and unauthorized batches.
- No unrelated files changed.
