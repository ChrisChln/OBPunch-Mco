# Agency Table Labels Design

## Goal

Polish the Agency Employees table so Group, Note, and Status use the same compact glowing pill language as Position and Shift while preserving their existing behavior.

## Visual Design

- Group, Note, and Status use a shared rounded-full border, vertical padding, type scale, and glow treatment aligned with `GlowLabelChip`.
- Width is content-driven. Group follows the currently selected label; Note and Status use their natural text width.
- Group remains a select control.
- Note remains an Add/View button.
- Status retains the Check or Hourglass icon.
- Pending agency status is labeled `Waiting`.

## Note Indicator

- The Agency employee name keeps a red dot when an Admin note exists.
- Hovering the employee name or focusing its interactive target shows the same note card used in Admin.
- The shared card presents available Agency and Admin note sections with the same spacing, colors, border, background, and typography in both surfaces.
- Agency users can continue opening the note dialog from the Note button.

## Architecture

- Extract the Admin note hover card markup into a shared presentation component.
- Reuse it from `EmployeeNoteNameButton` and `AgencyEmployeeName`.
- Keep Agency table control styling local to the Agency table and avoid changing global chip behavior.
- Derive the Group control width from its selected display label without fixed pixel widths.

## Testing

- Add component tests for the shared hover card behavior through Admin and Agency employee-name components.
- Add Agency table source/component coverage for the `Waiting` label and content-sized controls.
- Run targeted Vitest tests, the production build, and a focused browser inspection.

## Delivery

- Preserve all existing workspace changes.
- Commit all local repository changes and push the resulting `main` branch to `ChrisChln/OBPunch-Mco`.
