# Home Historical Timecard Refresh

## Problem

The admin home dashboard loads historical roster punches only when the selected operational date changes. Saving a punch correction emits `ob-timecard-punch-saved`, but the home dashboard does not listen for that event. When the selected historical date remains unchanged, the roster and work-hour summaries continue showing stale data.

## Design

Keep the existing save flow and event contract. Add a listener in `HomeDashboardPage` for `ob-timecard-punch-saved`.

When the event's `workDate` matches the currently selected historical operational date, reload both sources used by the historical view:

- attendance snapshot summary via `loadSnapshot`
- historical roster punches via `loadHistoricalRoster`

Ignore events for other dates. The live operational date will continue using the parent page's existing `refreshHomePanel` flow. Remove the event listener when the component unmounts or its selected date changes.

## Loading and Errors

Reuse the existing snapshot and historical roster loading states so the interface acknowledges the refresh immediately. Preserve the current behavior for query failures: clear the affected stale result and finish the loading state without introducing new UI copy.

## Testing

Add a focused regression test around the event refresh decision or listener behavior. It must verify that a matching historical date refreshes both historical data sources and a different date does not. Run the targeted Vitest test and `npm run build` after implementation.

## Scope

No database, Supabase schema, save-flow, navigation, styling, or unrelated dashboard changes are included.
