# Test Scripts

This project now has two test layers:

## 1) Unit tests (Vitest)

- Run: `npm run test:unit`
- Watch: `npm run test:unit:watch`
- Coverage output: `coverage/`

Current baseline includes:
- `src/lib/staffId.ts`
- `src/lib/labelTone.ts`
- `src/lib/supabase.ts`
- `api/corrections.ts` (API behavior baseline)

## 2) E2E scripts (Playwright)

- Run: `npm run test:e2e`
- Headed mode: `npm run test:e2e:headed`
- List cases: `npm run test:e2e -- --list`

Feature mapping:
- `tests/COVERAGE_MATRIX.md`

### Env-gated scenarios

Some flows require real credentials or seed data. When env vars are missing, those tests auto-skip.

- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_DEVICE_STAFF_ID`
- `E2E_DEVICE_SN`
- `E2E_PUNCH_STAFF_ID`

## Full suite

- `npm run test:all`
