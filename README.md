# ObPunch

ObPunch is a warehouse operations suite built with Vite + React + Supabase.
It includes punch terminals, dashboarding, device borrow/return, and a full admin back office.

## Page entry points

- Punch app: /
- Dashboard: /Dashboard
- Admin app: /admin.html
- Device app: /device.html

## Full feature map

### 1) Punch app (front terminal)

- Staff ID scan/input with auto action decision (IN/OUT).
- Success and error sound cues with browser audio unlock fallback.
- Animated success overlay for punch result.
- Device return reminder after punch when needed.
- Real-time attendance cards by position and shift (Morning/Night):
  - expected vs present
  - on-clock count
  - rest-worked count
  - scheduled-not-clock-in list
  - hover panels with search
- Punch log panel:
  - position filters
  - recent events with employee and device status
  - manual refresh
- Quick navigation to Admin, Dashboard, and Device pages.
- Log tab and employee profile request tab:
  - employee lookup
  - change request submit flow into employee request table

### 2) Dashboard page

- Operational day dashboard with auto-refresh and realtime listeners.
- Summary cards for Scheduled, On Clock, Absent, Off Worked.
- Attendance cards by position and shift with coverage ratio.
- Staff table with filters:
  - search
  - position
  - shift
  - absent only
  - on clock only
  - off work only
- Mistake tracking:
  - 7-day mistake count per person
  - manual mistake report submit
  - mistake detail modal (manual + auto attendance reasons)
- Punch detail modal for full day punches.
- Temporary account workflow:
  - assign account to staff
  - active/expired usage status
  - account usage modal with filters
- Printing:
  - temp badge print (USID QR)
  - account card print (account/password QR)

### 3) Device app (/device.html)

- Borrow and return scan workflow.
- Staff + SN validation and latest punch checks.
- Active borrow state by SN with overdue highlighting.
- Device counting modal and counted-at marker handling.
- Device search and filters:
  - position
  - type (PDA/CART)
  - borrowed-only toggle
- Sound feedback for device operations.

### 4) Admin app (/admin.html)

#### Home
- Operational overview panel and real-time status blocks.

#### Employees
- Employee search/filter.
- Create, edit, soft-active handling, and delete flows.
- Label and position styling support.
- Badge preview and batch print modals.
- Employee audit modal.

#### Accounts
- Temporary account management and assignment support.

#### Timecard
- Weekly timecard grid (Mon-Sun) with virtualized rendering.
- Cross-night hour calculation and in-progress detection.
- Per-day marks:
  - absent
  - excuse
  - temporary leave
  - late
  - rest/work state
  - terminated state
- Punch count anomaly highlight (expected 4/day).
- Cell drill-down modal (work-hour correction):
  - edit existing punches
  - add IN/OUT pair
  - delete punches
  - drag/swap action aid
  - save-all batch update
- Audit integration per staff/day with recent operation tooltip.
- Attendance mark recompute and late-mark sync logic.

#### Punches
- Recent punch stream and search/filter controls.

#### Audit
- Audit log list and human-readable summary rendering.

#### Schedule
- Weekly schedule board with work/rest/leave/temp states.
- Planned state activation and weekly rollover helpers.
- Daily list and tomorrow list publication workflow.
- New-hire demand modal and schedule support tools.
- Realtime schedule update subscription.

#### Devices
- Admin device inventory and loan management tools.

#### Forecast
- Forecast input and result views.

#### Prediction Model
- Model management UI for forecasting workflows.

#### Efficiency
- Efficiency template editing.
- Daily capacity and volume/forecast bridge workflows.

### 5) Serverless API endpoints

- POST /api/corrections
  - append correction punch row into ob_punches
- POST /api/forecast-run
- POST /api/forecast-evaluate
- POST /api/forecast-scheduler

See [api/README.md](api/README.md) for API-side env details.

## Tech stack

- React 18
- TypeScript 5
- Vite 5
- Tailwind CSS
- Supabase JS v2
- Vitest + Playwright

## Local development

Requirements:

- Node.js 18+
- npm
- Supabase project (or compatible env)

Install and run:

```bash
npm install
npm run dev
```

Host on LAN:

```bash
npm run dev:host
```

Build and preview:

```bash
npm run build
npm run preview
```

## Test commands

Unit tests:

```bash
npm run test:unit
```

E2E tests:

```bash
npm run test:e2e
```

Full suite:

```bash
npm run test:all
```

More test mapping:

- [tests/README.md](tests/README.md)
- [tests/COVERAGE_MATRIX.md](tests/COVERAGE_MATRIX.md)

## Environment variables

Core frontend vars:

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_SUPABASE_SCHEMA (optional, default public)

Primary table vars (all optional if using defaults):

- VITE_EMPLOYEE_TABLE
- VITE_EMPLOYEE_REQUESTS_TABLE
- VITE_AUDIT_TABLE
- VITE_SCHEDULE_TABLE
- VITE_APP_SETTINGS_TABLE
- VITE_USER_PROFILE_TABLE
- VITE_ATTENDANCE_MARKS_TABLE
- VITE_DEVICE_TABLE
- VITE_DEVICE_LOANS_TABLE
- VITE_TEMP_ACCOUNT_TABLE
- VITE_TEMP_ACCOUNT_ASSIGNMENT_TABLE
- VITE_MISTAKE_REPORT_TABLE
- VITE_OBUP_REPORTS_TABLE
- VITE_OBUP_REPORT_DETAILS_TABLE
- VITE_OBUP_UPLOAD_RECORDS_TABLE
- VITE_OBUP_ACCOUNT_LINKS_TABLE

Optional secondary Supabase (OBUP) vars:

- VITE_OBUP_SUPABASE_URL
- VITE_OBUP_SUPABASE_ANON_KEY

Operational time config vars (optional):

- VITE_DAY_CUTOFF_HOUR
- VITE_TIMECARD_ABSENT_VISIBLE_HOUR
- VITE_ATTENDANCE_RESET_HOUR
- VITE_SHIFT_ANALYSIS_DAYS
- VITE_ROSTER_RESET_HOUR

API-side vars (server only):

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ADMIN_TOKEN

## Database and migrations

- SQL migrations are under [sql](sql).
- New deployments should apply these in order.
- Important domains covered by migrations:
  - attendance marks
  - temp accounts and assignments
  - forecasting tables
  - efficiency templates
  - user profiles
  - schedule constraints

## Security notes

- Frontend reads/writes Supabase directly for many flows.
- Use strict RLS policies before production internet exposure.
- Never expose service_role keys in frontend env.

## Operations notes

- Staff ID normalized format is US + digits.
- Employee column casing fallback is supported (agency/position and Agency/Position).
- Timecard and dashboard rely on operational-day cutoffs, not plain calendar-day midnight.
