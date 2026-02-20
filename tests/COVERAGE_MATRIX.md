# E2E Coverage Matrix (Feature -> Script)

## Punch (Front App)
- Punch shell render: `tests/e2e/punch.features.spec.ts` -> `punch page shell`
- Punch scan success animation: `tests/e2e/punch.features.spec.ts` -> `scan punch script`
- Punch log filters visible: `tests/e2e/punch.features.spec.ts` -> `punch list filter buttons visible`

## Device Borrow/Return App
- Device shell render: `tests/e2e/device.features.spec.ts` -> `device page main controls`
- Borrow flow: `tests/e2e/device.features.spec.ts` -> `borrow flow script`
- Return SN-only flow: `tests/e2e/device.features.spec.ts` -> `return flow uses SN only script`
- Counting modal: `tests/e2e/device.features.spec.ts` -> `counting modal open/close`

## Admin - Navigation
- Main tab routing: `tests/e2e/admin.features.spec.ts` -> `navigation tabs are reachable`

## Admin - Employees
- Employees page + new columns: `tests/e2e/admin.features.spec.ts` -> `employees table includes new columns`
- Create/Edit/Delete flow: `tests/e2e/admin.employees.crud.spec.ts` -> `create -> edit -> delete employee`

## Admin - Timecard
- Timecard controls and weekly grid: `tests/e2e/admin.timecard.spec.ts`

## Admin - Schedule
- Weekly schedule controls: `tests/e2e/admin.features.spec.ts` -> `schedule page controls exist`
- Daily list open + date change: `tests/e2e/admin.schedule.spec.ts` -> `open daily list and change date`
- New-hire demand modal fields: `tests/e2e/admin.schedule.spec.ts` -> `new-hire demand modal opens with required fields`

## Admin - Audit
- Audit page render: `tests/e2e/admin.features.spec.ts` + `tests/e2e/admin.audit.spec.ts`
- Payload line removed: `tests/e2e/admin.audit.spec.ts` -> `payload fallback line is hidden`
- Arrow split summary rendering: `tests/e2e/admin.audit.spec.ts` -> `summary arrow style exists as split blocks`

## Admin - Device Management
- Device management controls + card data: `tests/e2e/admin.devices.spec.ts`

## Admin - Employee Upload
- Upload page + template download control: `tests/e2e/admin.employee-upload.spec.ts`

## Admin - Printing
- Schedule sign-in print control: `tests/e2e/admin.printing.spec.ts`
- Employee badge print control: `tests/e2e/admin.printing.spec.ts`

## Smoke
- Entry pages: `tests/e2e/shell.smoke.spec.ts`

---

## Env-gated flows (auto-skip if missing)
- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_DEVICE_STAFF_ID`
- `E2E_DEVICE_SN`
- `E2E_PUNCH_STAFF_ID`

