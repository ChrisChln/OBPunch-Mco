# Agency Leave 24-Hour Deadline

## Goal

Show the Agency leave submission time on the admin approval page and require Agency leave requests to be submitted more than 24 hours before the employee's shift starts.

## Deadline Rule

- Build the shift start instant from the requested leave date and the employee's `shift_time`.
- Interpret the shift start in the `America/New_York` time zone.
- If `shift_time` is missing or invalid, use `07:00` for an early shift and `15:00` for a late shift.
- Allow a leave request only when the shift start is strictly more than 24 hours after the current instant.
- Reject a request when exactly 24 hours or less remain.
- A missing or unsupported shift prevents leave submission because no safe fallback can be selected.

## Agency UI

- Reuse one pure deadline helper for the schedule-cell Leave option.
- Do not offer the Leave action when the 24-hour deadline has been reached.
- Keep the existing loading, optimistic update, rollback, and error notice behavior.

## Database Enforcement

- Add a dated migration that updates the active Agency schedule-state RPC.
- Resolve the employee shift time in the database with the same personal-time-first and shift-default fallback rules.
- Compare the current instant with the New York shift start minus 24 hours.
- Reject requests at or after the deadline with a clear error.
- Keep the existing authorization, employee scope, schedule-state, leave-record, and audit behavior unchanged.

The database check is authoritative so stale browser state or direct RPC calls cannot bypass the rule.

## Approval Page

- Include `submitted_at` in the typed leave row.
- Add a compact `提交时间 / Submitted` table column.
- Format the timestamp in New York local date and time.
- Show `-` when a legacy record has no valid submission timestamp.

## Testing

- Add unit tests for a request with more than 24 hours remaining.
- Add boundary tests for exactly 24 hours and less than 24 hours.
- Cover an employee-specific shift time.
- Cover the `07:00` early-shift and `15:00` late-shift fallbacks.
- Cover invalid input and daylight-saving-aware New York conversion.
- Run the targeted unit tests and the production build after implementation.

## Scope

This change does not alter approval decisions, schedule approval effects, other Agency schedule-edit deadlines, or historical leave records.
