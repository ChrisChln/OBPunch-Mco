# Exception SOP

## Purpose

This SOP controls outbound exception handling from discovery to responsibility closeout.

## Roles

- Lead: creates and updates the exception report.
- Counter: verifies original picked location quantity and fills `Count By USID`.
- Packer/Rebin: reports packing shortage or wrong item found during packing.
- Admin: closes the resolved exception and assigns responsibility.

## Status Flow

1. `Created`: exception created, counting may not be complete.
2. `In Progress`: investigation is still open.
3. `Counted`: counted quantities are entered, but operator/count fields are incomplete.
4. `Pending Adjustment`: Extra Taken or Borrowed Location is selected, but inventory adjustment is not complete.
5. `Short Picked`: Short Pick is confirmed and no stock is available to ship.
6. `Ensolved`: operational action is complete.
7. `Cancel`: exception canceled.

## Create

1. Lead opens `Exception`.
2. Select exception type.
3. Enter picking list, container, product barcode if known.
4. Create the report.

Creation does not require `Count By USID`.

## Count
1. Find the original picked location
1. Go to the original picked location.
2. Count actual stock at that location.
3. Enter `System Qty` and `Actual`.
4. Enter `Count By USID`.

When counted quantities are entered during edit, `Count By USID` is required.

## Less Pick Decision

Use this table when packing finds one or more missing units.

| Original Location Count | Meaning | System Action |
| --- | --- | --- |
| `Actual > System` | Product is still left at original location. Picker under-picked. | Complete processing and assign picker responsibility. No inventory adjustment. |
| `Actual = System` | Original location inventory matches system. Missing unit must be replenished from stock. | Select `Extra Taken` or use `Borrowed Location`. Inventory adjustment is required. |
| `Actual < System` | Original location is short versus system. Missing unit still needs replenishment, and stock count must be adjusted. | Select `Extra Taken` or use `Borrowed Location`. Inventory adjustment is required. |
| No stock available anywhere | Order cannot be completed from available stock. | Keep exception open or mark Short Pick when applicable. Do not force resolve. |

## Extra Taken

Use `Extra Taken` when a unit is taken from inventory to complete the order after the original shortage is confirmed.

Rules:

- Allowed only for Less Pick / Short Pick shortage workflows.
- Allowed when `Actual <= System` at the counted location.
- Not used when `Actual > System`; that case is picker under-pick evidence.
- Requires `Inventory Adjustment = Yes` before the report becomes `Resolved`.

## Borrowed Location

Use `Borrowed Location` when stock is taken from another location to complete the order.

Rules:

- `Borrowed Location` and `Borrowed Qty` must be filled together.
- Requires `Inventory Adjustment = Yes` before the report becomes `Resolved`.
- Do not use borrowed stock without recording the source location.

## Short Pick

Use `Short Picked` only when shipment cannot be completed from available stock.

Rules:

- Confirm original location count first.
- Confirm there is no usable stock to replenish the order.
- Mark `Short Picked` only for Short Pick type reports.

## Responsibility

Admin closes only `Ensolved` reports.

Available responsibility decisions:

- Picker
- Packing/Rebin
- All responsible
- No responsibility


## Closeout Checklist

Before Admin closes:

- Product and picked location are recorded.
- `System Qty` and `Actual` are recorded.
- `Count By USID` is recorded.
- Picker and packing/rebin operator are recorded when applicable.
- Extra Taken or Borrowed Location has inventory adjustment completed if used.
- Short Pick is used only when no replenishment stock is available.
- Responsibility decision matches the verified cause.
