# Schedule Export Shift-Time Design

## Goal

Change schedule workbook day cells so working days export the employee's shift start time in HH:mm format instead of labels such as 早1 or 固定排班. Rest and leave days export 休息.

## Scope

- Change only the admin schedule Excel export.
- Preserve schedule page labels, database values, filters, and schedule editing behavior.
- Preserve the existing workbook structure, headers, shift sheets, and shift-information row.

## Export Rules

Working states are new, work, fixed_work, temp_work, and planned_temp_work. Export the employee's normalized shift_time as HH:mm, such as 08:00.

Non-working states are rest, leave, planned_leave, temp_rest, and planned_temp_rest. Export 休息 for these states and for missing schedule rows.

If shift_time is invalid or missing, use the existing fallback based on early/late shift and position.

## Architecture

Extract day-cell mapping into a pure admin schedule helper. It receives whether the day is working and the resolved shift start time, returning the time or 休息. The workbook builder calls it for each day cell.

Resolve each employee's time with the existing normalizeShiftTimeValue and resolveShiftStartTime behavior. Keep the current early/late sheet grouping.

## Error Handling

- Invalid or missing shift_time uses the existing position-and-shift fallback.
- Missing schedule rows export 休息.
- Existing export validation and status messages remain unchanged.

## Tests

Use TDD to cover all working states, all leave/rest states, missing rows, valid employee times, and fallback times. Run the targeted Vitest test and production build.
