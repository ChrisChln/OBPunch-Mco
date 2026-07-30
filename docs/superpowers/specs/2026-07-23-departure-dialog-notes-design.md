# Departure Dialog Notes

## Goal

Update the admin departure confirmation dialog so a departure reason is required and the employee's existing Admin Note and Agency Note are visible before confirmation.

## UI

- Keep the current employee identity and Normal/Blacklist controls.
- Show the Admin Note first, followed by the Agency Note.
- Render notes as read-only blocks.
- Hide a note block, including its label, when its trimmed content is empty.
- Place the required departure reason field after the visible note blocks.
- Mark the departure reason as required.
- Disable confirmation while the trimmed reason is empty or while the dialog is locked.

## Data Flow

- Reuse the existing `employeeNotesByStaffId` data already loaded by the admin page.
- Pass the selected employee's Admin Note and Agency Note into `DepartureConfirmDialog`.
- Do not add a new query or allow note editing from the departure dialog.
- Keep the submit-handler validation as a defensive second check before persisting the departure.

## Tests

Component tests will verify:

- Admin Note and Agency Note render in that order when both have content.
- Only the populated note renders when the other note is empty.
- Neither note label renders when both notes are empty.
- Blank or whitespace-only departure reasons cannot be confirmed.
- A non-empty departure reason allows confirmation.

## Scope

This change does not alter note storage, note permissions, the employee notes editor, or departure database fields beyond the existing termination reason flow.
