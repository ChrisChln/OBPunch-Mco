# Agency Termination Approval Dialog

## Goal

Fix the admin schedule workflow where confirming an Agency termination request does not reliably start the approval action. Replace the generic confirmation prompt with a dedicated approval dialog that shows the Agency-provided termination details before the administrator confirms.

## User Experience

When an administrator selects `确认离职` for a pending Agency termination request, open a focused dialog with these read-only fields in order:

1. Staff ID
2. Name
3. Agency
4. Position
5. Agency termination reason

The dialog uses the existing dark admin visual language and the selected compact detail-grid layout. Long reasons wrap without horizontal overflow. The administrator cannot edit the Agency reason.

The footer contains `取消` and `确定`. Selecting `确定` immediately shows a loading state and disables both actions to prevent duplicate approval. On success, close the dialog, show the existing success status, and refresh the schedule and pending request data. On failure, keep the dialog open, restore its actions, and show the error through the existing admin error/status presentation.

The reject flow remains unchanged unless the shared root cause requires the same safe dialog plumbing.

## Data Sources

Use the existing `TerminationRequestRecord` returned by `list_employee_termination_requests`.

- Staff ID comes from `request.staff_id`.
- Agency comes from `request.agency`.
- Agency termination reason comes from `request.reason`.
- Name and position come from `request.employee_snapshot`.

Snapshot values are external data and must be normalized defensively. Missing name, Agency, position, or reason values display `-`; missing optional display values must not block an otherwise valid approval request.

No new database column, query, or API parameter is required. The existing approval RPC remains responsible for copying the Agency reason into the departed employee's `termination_reason`.

## Component Design

Add a focused admin component for reviewing an Agency termination request. Its public inputs are:

- the normalized request details;
- whether approval is in progress;
- cancel and confirm callbacks;
- current theme and translation behavior.

`AdminAppPage` owns the selected request and submission state. Opening the dialog records the pending request. Confirming calls the existing termination review service directly, instead of relying on the generic promise-based `askConfirm` bridge.

The existing generic `AppDialog` hook ordering will be covered by a regression test. If the test reproduces the reported no-response behavior, correct the component so hooks execute consistently on every render. This fix remains limited to dialog reliability.

## Error Handling

- Ignore repeated confirmation while an approval is in progress.
- Preserve the selected request and displayed details when the RPC fails.
- Surface the normalized RPC error instead of silently returning.
- Do not show a success message or refresh data unless the approval RPC completes successfully.
- Keep the existing permission and missing-Supabase checks before opening or submitting the approval.

## Testing

Follow TDD with failing tests before production changes.

Component tests cover:

- all five fields render from a request;
- the reason is read-only and wraps safely;
- snapshot values are normalized and missing values use `-`;
- confirm calls the approval callback once;
- loading disables cancel and confirm and exposes visible progress;
- a failed approval keeps the dialog available for retry.

Regression coverage also verifies that the underlying dialog can transition from closed to open without a hook-order failure and that confirming a pending Agency request reaches the review service.

Run the focused Vitest tests, then `npm run build`. Use a targeted in-browser check when the local admin data needed to exercise the pending-request flow is available.

## Scope

This change does not alter Agency request creation, request cancellation, rejection semantics, permission rules, RPC signatures, database schema, or direct employee departure behavior.
