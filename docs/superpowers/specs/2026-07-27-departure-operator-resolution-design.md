# Departure Operator Resolution

## Goal

The Admin departed-employees list must show the person who initiated the departure:

- Agency-requested departure: show the agency user who submitted the request, not the Admin who approved it.
- Direct Admin departure: show the Admin who performed the departure.
- Existing historical records must resolve automatically from existing audit logs without rewriting employee data.

## Data flow

The departed-employees loader will fetch relevant audit actions for each departed staff member:

- `agency_termination_request`
- `employee_termination_approve`
- `employee_delete`

Operator resolution will group and sort audit rows per staff member, then associate the correct departure event with the employee's `terminated_at` timestamp.

For an approved agency request, the resolver will prefer the matching request submitter over the approval actor. For a direct Admin departure, it will use the matching `employee_delete` actor. Approval records are supporting evidence and must not become the displayed operator when a corresponding agency request exists.

The time association will tolerate audit rows created immediately after `terminated_at`, because direct departures update the employee before writing the audit row. It must not select an unrelated audit from a different departure cycle.

## Historical behavior

No data backfill is required. Opening or refreshing the departed-employees list recomputes the operator from existing audit history. Records without enough audit evidence continue to display `-`.

## Error handling

If audit loading fails, employee rows still load and the existing operator-loading warning remains visible. Missing or malformed audit timestamps and actors are ignored safely.

## Tests

Unit tests will cover:

- Agency-requested departure resolves to the request submitter.
- Approval actor is not displayed when a matching agency request exists.
- Direct Admin departure resolves from an audit written just after `terminated_at`.
- Multiple departure cycles select the audit associated with the current `terminated_at`.
- Missing audit evidence returns a null operator and renders as `-`.

The targeted unit tests and production build must pass before completion.
