# Departed Employee Operator Design

## Goal

Remove the horizontal scrollbar from the admin departed-employees modal and show the administrator who performed each employee departure.

## Scope

- Add an operator field to departed-employee records in the admin UI.
- Resolve operators from existing employee departure audit logs.
- Display the operator in the modal and include it in CSV exports.
- Keep the table within the modal width without horizontal scrolling.
- Preserve existing filters, virtualization, rehire, termination-type toggle, hard delete, and export behavior.

## Data Source

Employee departures already write audit rows to `ob_audit_logs`.

- Direct admin departures use action `employee_delete`.
- Approved agency termination requests use action `employee_termination_approve`.

When departed employees load, the admin app queries matching audit rows for the visible departed staff IDs. For each employee, it selects the latest applicable departure audit row at or before the employee's `terminated_at` timestamp. The displayed operator uses the existing audit actor display-name resolver:

1. Administrator display name.
2. Actor email or stored actor text.
3. `-` when no matching audit record exists.

An audit-query failure must not block the departed-employee list. Rows remain visible with a missing operator, while the load error remains observable.

## Application Design

Extend `EmployeeRow` with an optional UI-only `termination_operator` field. Keep audit matching in a small pure helper so timestamp and action selection can be unit tested independently.

`fetchDepartedEmployees` continues loading employee rows first, applies existing position and agency access filters, then fetches relevant audit rows and enriches the scoped employees with resolved operator values.

The optimistic row inserted after a direct departure receives the current administrator display name immediately. A later refresh replaces it with the persisted audit result.

## Modal Layout

Add an `操作人 / Operator` column before the action column.

Remove the fixed `min-w-[1240px]` table width. Use a width-constrained fixed-layout table with compact column widths. Name, reason, and operator cells truncate with a title tooltip. The table viewport keeps vertical scrolling for virtualization but hides horizontal overflow.

The modal remains responsive:

- Desktop shows all columns in the existing table.
- Narrow widths use smaller fixed column allocations without horizontal overflow.
- Row actions remain right-aligned and usable.

## Export

Add `操作人 / Operator` to the CSV header and include each row's resolved operator. Missing values export as an empty cell.

## Error Handling

- Employee-list query errors retain current behavior.
- Audit enrichment errors do not discard employee data.
- Missing or historical audit rows display `-`.
- Invalid audit timestamps are ignored when a valid timestamp comparison is required.

## Testing

- Unit-test direct and approved-termination audit matching.
- Unit-test selection of the latest applicable audit record.
- Unit-test missing audit fallback.
- Verify CSV includes the operator header and values.
- Component-test the operator column and values.
- Component-test that the table no longer has a forced minimum width and the scroll viewport hides horizontal overflow.
- Run targeted Vitest tests and `npm run build`.

