# Remove Work-Hour Position Cards

## Scope

Remove the two position-level summary card grids from the work-hour comparison page and remove the `Hide Transfer` filter shown beside the remaining filters.

Keep the four top-level summary metrics, all other filters, the detail table, uploads, corrections, and date navigation unchanged.

## Implementation

- Remove the position-card markup and its click-to-jump behavior.
- Remove the global position-stat state, loaders, and refresh calls that exist only for those cards.
- Remove the `hideTransfer` state, saved-filter field, and row-filter condition so a previously saved browser value cannot continue hiding Transfer rows after the control is gone.
- Let the filter row follow the top-level summary metrics with the existing spacing scale.

## Testing

- Add a regression test that verifies the retired controls and position-card loading path are absent while the remaining discrepancy filter stays available.
- Run the targeted test and confirm it fails before the production change.
- Run the targeted test, related unit tests, and the production build after implementation.

## Non-goals

- No changes to comparison calculations, discrepancy thresholds, imports, database schema, or API behavior.
- No redesign of the remaining summary cards, filters, or table.
