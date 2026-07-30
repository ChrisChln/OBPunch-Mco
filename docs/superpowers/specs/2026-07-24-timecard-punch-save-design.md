# Timecard Punch Save Reliability

## Problem

The timecard editor currently checks only the account's module-level `timecard`
operation permission. PostgreSQL row-level security additionally requires
position-level `timecard/operate` access.

When RLS filters an update to zero rows, the Supabase update request can return
without an error. The client then updates an in-memory snapshot, writes an audit
entry from that snapshot, displays a success message, and later reloads the
unchanged database value. This produces a misleading audit transition such as
`4.02h -> 8.17h` while the timecard remains at `4.02h`.

## Goals

- Preserve position-scoped timecard permissions.
- Prevent users without position-level operation access from editing punches.
- Save punch edits, additions, and deletions atomically.
- Treat missing, mismatched, unauthorized, or unchanged target rows as failures.
- Create audit data only from database-confirmed results.
- Refresh the displayed timecard immediately after a confirmed save.
- Return concise, actionable errors instead of reporting false success.

## Non-Goals

- Expanding timecard permissions.
- Changing operational-day boundaries or work-hour calculations.
- Redesigning the timecard interface.
- Refactoring unrelated admin or attendance workflows.

## Chosen Approach

Add a security-definer PostgreSQL RPC for batch punch corrections and route the
existing editor through it.

The RPC is preferable to multiple direct client mutations because it provides a
single authorization boundary and an all-or-nothing transaction. Existing RLS
policies remain enabled and continue to protect direct table access.

## Database Design

Create `public.save_timecard_punch_changes` with:

- Target staff ID.
- Expected work date.
- JSON arrays for edits, additions, and deletion IDs.
- Optional operator email for correction metadata.

The function will:

1. Normalize and validate the staff ID and work date.
2. Require an authenticated caller.
3. Require `user_can_access_staff_position('timecard', staff_id, 'operate')`.
4. Lock every persisted target punch row before mutation.
5. Verify every edited or deleted record exists and belongs to the target staff.
6. Validate actions and timestamps.
7. Require every changed timestamp to remain inside the selected operational day.
8. Apply edits, additions, and deletions in the same transaction.
9. Mark edited and added rows with `admin_console`, `manual_edit` or
   `manual_add`, the operator, and a correction note.
10. Return the confirmed rows for the operational day after the mutation.

Any validation or mutation failure raises an exception. PostgreSQL then rolls
back the complete batch.

The function will be executable by `authenticated` only. It will use a fixed
`search_path`, fully qualified object names, and revoke public execution.

## Frontend Design

The selected employee's normalized position determines whether the editor is
writable:

- Module-level `timecard` access must be `operate`.
- Position-level `timecard` access must also be `operate`.
- Users with view access can still open the punch modal in read-only mode.

Saving will call the RPC once with all staged changes. The client will not
optimistically count rows as saved. It will:

1. Keep the modal open and show a loading state while the RPC runs.
2. Display the database error if the RPC rejects the batch.
3. Use the returned rows to calculate the confirmed post-save hours and punch
   count.
4. Write the existing audit entry only after the RPC succeeds.
5. Close the modal and refresh the timecard without using stale cached punches.

If the post-save audit write fails, the punch mutation remains successful. The
UI will report that punches were saved but audit logging failed, then refresh
the timecard. Audit failure must not misrepresent the punch save as rolled back.

## Error Handling

Expected user-facing failure categories:

- No operation access for the employee's position.
- Target punch no longer exists.
- Target punch belongs to another employee.
- Invalid action or timestamp.
- Timestamp falls outside the selected operational day.
- Database request failure.

All failures keep staged edits visible so the user can retry or correct them.
No success message is shown until the database returns confirmed rows.

## Testing

### Database contract tests

- Reject unauthenticated calls.
- Reject callers without position-level operation access.
- Reject edits or deletions for missing records.
- Reject records belonging to another employee.
- Reject timestamps outside the selected operational day.
- Apply edits, additions, and deletions successfully.
- Roll back every mutation when any item in the batch fails.
- Return the authoritative post-save punch rows.

### Frontend/unit tests

- Resolve the modal as read-only when module access is writable but position
  access is view-only.
- Convert staged changes into the RPC payload without losing IDs, actions, or
  timestamps.
- Treat an empty or malformed RPC result as a failed save.
- Calculate audit hours from confirmed database rows rather than the draft.

### Verification

- Run the targeted Vitest tests.
- Run the full unit test suite if targeted tests pass.
- Run `npm run build`.
- Exercise one authorized save and one position-view-only attempt in the browser
  when an authenticated local session is available.

## Migration and Compatibility

The change is additive: one new SQL migration and a frontend call-site update.
Existing RLS policies remain intact. No existing punch rows are rewritten.

Deploy the database migration before or together with the frontend. If the RPC
is missing, the frontend will show the returned database error and keep edits
open rather than falling back to the unsafe direct-update path.
