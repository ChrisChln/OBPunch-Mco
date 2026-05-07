# ObPunch Project Notes

Use this file as repository-specific context before making changes in this workspace.

## Project Summary

ObPunch is a warehouse operations suite built with React 18, TypeScript, Vite, Tailwind CSS, Supabase JS v2, Vitest, and Playwright.

The product includes:
- A front punch terminal for staff clock IN/OUT flows.
- An operations dashboard.
- An admin back office.
- A device borrow/return workflow.
- An agency-facing scheduling board.
- Forecasting, package metrics, consumables, leave, attendance marks, todo, and work-hour comparison workflows.

## Entry Points

- `index.html` / `src/main.tsx`: main punch app and dashboard route switch.
- `/Dashboard` or `/dashboard`: renders `src/DashboardPage.tsx`.
- `admin.html` / `src/admin/main.tsx`: admin app.
- `device.html` / `src/device/main.tsx`: device app.
- `agency/index.html` / `src/agency/main.tsx`: agency app.

Vite builds multiple HTML inputs through `vite.config.ts`:
- `main`
- `admin`
- `device`
- `agency`

## Main Source Layout

- `src/App.tsx`: punch terminal app.
- `src/DashboardPage.tsx`: operational dashboard.
- `src/admin/`: admin app shell, pages, components, and admin domain logic.
- `src/admin/pages/`: admin feature pages and page-level UI.
- `src/admin/components/`: reusable admin UI components.
- `src/agency/`: agency board UI, API helpers, metrics, and types.
- `src/device/`: device borrow/return app.
- `src/components/`: shared UI components.
- `src/lib/`: generic client utilities such as Supabase client setup, staff ID handling, barcode prompts, label tones, and text search.
- `src/shared/`: shared business logic for admin/device/agency/dashboard domains.
- `api/`: serverless API endpoints and API-only shared code.
- `sql/`: dated Supabase/Postgres migrations.
- `tests/`: Vitest unit tests and Playwright E2E tests.
- `scripts/`: operational scripts and backfills.
- `public/`: static images, sounds, and Lottie animations.

## Important Domains

Core domains currently visible in the repository:
- Punches and operational-day attendance.
- Employees, employee requests, labels, employment status, and audit history.
- Admin access and permissions.
- Weekly schedules, daily lists, leave approvals, late marks, and timecards.
- Device inventory, loans, counting, and overdue state.
- Temporary accounts and account assignment.
- Forecasting, volume history, efficiency templates, and prediction model workflows.
- Package metrics, package staffing, and transfer/import jobs.
- Consumables workspace, snapshots, adjustments, custom items, alerts, and undo flows.
- Agency board rules, schedule-only agency behavior, and agency requests.
- Todo recurring sync and admin todo data.

## API Notes

Serverless API endpoints live in `api/`.

Known endpoints include:
- `POST /api/corrections`
- `POST /api/forecast-run`
- `POST /api/forecast-evaluate`
- `POST /api/forecast-scheduler`
- `POST /api/leave-sync`
- `POST /api/package-metrics-import`
- `POST /api/package-metrics-transfer`
- `POST /api/package-staffing-sync`
- `POST /api/consumable-alert-sync`
- `POST /api/todo-recurring-sync`

API-side environment variables include:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_TOKEN`

Never expose service role keys in frontend code or Vite environment variables.

## Supabase Notes

Frontend Supabase clients are created in `src/lib/supabase.ts`.

Client behavior:
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required for a real client.
- Missing credentials return `null`; callers must handle that.
- Clients are cached by URL, anon key, and session persistence mode.
- Realtime is configured with `eventsPerSecond: 10`.

Optional frontend table/env configuration is documented in `README.md`.

Use typed, validated access patterns where possible. Keep database queries, UI logic, and domain logic separated.

## Staff ID Rules

Staff IDs are normalized with `trim().toUpperCase()`.

Default valid staff ID format:
- `US` followed by 3 to 12 digits.
- Example: `US010454`.

Schedule-only agencies may allow a broader 1 to 64 character uppercase alphanumeric, underscore, or hyphen format through `isValidScheduleStaffId`.

## Build And Test Commands

Package scripts:
- `npm run dev`: start Vite.
- `npm run dev:host`: start Vite on LAN.
- `npm run build`: TypeScript build plus Vite production build.
- `npm run preview`: Vite preview.
- `npm run lint`: ESLint.
- `npm run test`: unit tests.
- `npm run test:unit`: Vitest with coverage.
- `npm run test:unit:watch`: Vitest watch mode.
- `npm run test:e2e`: Playwright E2E.
- `npm run test:e2e:headed`: headed Playwright.
- `npm run test:all`: unit and E2E tests.

Vitest:
- Configured in `vitest.config.ts`.
- Uses `jsdom`.
- Setup file: `tests/setup/vitest.setup.ts`.
- Includes `tests/**/*.test.ts`, `tests/**/*.test.tsx`, `tests/**/*.spec.ts`, and `tests/**/*.spec.tsx`.
- Excludes `tests/e2e/**`.
- Coverage output goes to `coverage/`.

Playwright:
- Configured in `playwright.config.ts`.
- Test directory: `tests/e2e`.
- Base URL: `http://127.0.0.1:4173`.
- Web server command: `npm run dev -- --port 4173 --strictPort`.
- Tests run fully parallel locally.

Some E2E flows auto-skip unless real environment data is provided:
- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_DEVICE_STAFF_ID`
- `E2E_DEVICE_SN`
- `E2E_PUNCH_STAFF_ID`

## Vercel Deployment Notes

`vercel.json`:
- Routes `/api/(.*)` to API functions.
- Lets filesystem routes resolve first.
- Falls back all other routes to `/index.html`.

Configured cron jobs:
- `/api/todo-recurring-sync` at `5 9 * * *`.
- `/api/package-staffing-sync` at `10 10 * * *`.
- `/api/consumable-alert-sync` at `15 16 * * *`.

`vite.config.ts` proxies `/api` to `http://localhost:3000` unless running under Vercel-style dev on port 3000 or `VERCEL=1`.

## Database And Migration Notes

SQL files are dated and stored in `sql/`.

Apply migrations in chronological order for new deployments unless a migration file explicitly says otherwise.

Migration coverage includes:
- Attendance marks.
- Temporary accounts and assignments.
- User profiles and avatars.
- Forecasting and volume forecast tables.
- Efficiency templates.
- Schedule constraints and agency board support.
- Leave requests and leave sync helpers.
- Todo tables and recurring functions.
- Package daily metrics and staffing sync.
- Consumables workspace, snapshots, adjustments, custom items, and undo support.

## UI And Frontend Standards

Maintain a clean, calm, premium, professional interface.

Follow these project UI expectations:
- Use concise labels and short headings.
- Avoid unnecessary subtitles, helper text, explanations, and decorative copy.
- Use disciplined spacing based on 4px or 8px increments.
- Use a cohesive neutral palette with purposeful accents.
- Prefer Lucide or existing icon libraries over custom icons.
- Do not use emoji UI.
- Keep layouts responsive across desktop, tablet, and mobile.
- Avoid horizontal overflow.
- Keep large logic out of UI components; use shared helpers and domain modules.
- Keep cards, buttons, inputs, tables, modals, and charts visually consistent.
- For charts and dashboards, use short titles such as `ITR`, `Inflow`, `Orders`, `Attendance`, `UPH`, or `Errors`.

## Coding Standards

Write production-quality TypeScript.

Expect:
- Explicit, readable types.
- No `any` unless there is no practical alternative.
- Null and undefined safety.
- Input validation for user and external data.
- Error handling and visible failure states where relevant.
- Loading and empty states in UI flows.
- Small, focused functions.
- Business logic separated from UI and data access.
- Tests for important logic, including normal, edge, and failure cases.

Avoid:
- Placeholder logic.
- Mock implementations in production paths.
- Silent failures.
- Large logic blocks directly inside React components.
- Broad refactors unrelated to the task.

## Repository Safety Rules

Follow these safety rules in addition to global instructions:

1. Treat terminal-rendered garbled text as a display issue first, not proof that a source file is corrupted.
2. Prefer `apply_patch` for source edits.
3. Do not use shell scripts or bulk string replacement to rewrite `.tsx`, `.ts`, `.js`, `.jsx`, `.json`, or `.css` files.
4. Avoid copying text from PowerShell output back into source files.
5. For UI work, make small incremental patches:
   - add state
   - add handlers
   - add markup
   - add styles
6. After each substantial source edit, run `npm run build`.
7. If a file contains non-ASCII user-facing text, avoid broad rewrites of existing text blocks unless absolutely necessary.
8. If a scripted edit introduces syntax or encoding risk, revert the affected file immediately and re-apply the change with smaller `apply_patch` edits.

## Generated And Local Artifacts

Do not treat these folders as source unless explicitly requested:
- `node_modules/`
- `dist/`
- `coverage/`
- `playwright-report/`
- `test-results/`
- `.vite-check-dist/`
- `.playwright-mcp/`
- `.vercel/`

Current workspace may contain generated or untracked Playwright logs. Ignore them unless the task is specifically about browser test artifacts.

## Change Verification

Use the smallest verification that proves the change:
- Documentation-only changes normally do not require a build.
- Source changes should run `npm run build` after substantial edits.
- Logic changes should run the relevant Vitest tests.
- User-facing flows should run targeted Playwright tests or an in-browser check when practical.

