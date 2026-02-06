# ObPunch

Warehouse punch (IN/OUT) + admin console powered by Supabase.

## Features

- **Kiosk (Punch UI)**: scan/type staff ID and **auto punch** on Enter (auto decides IN/OUT).
- **Punch log board**: shows recent successful punches (name/agency/position when available).
- **Admin console**:
  - Employee upload (CSV/Excel) with strict `position` validation (`Pick/Pack/Rebin/Preship/Transfer`).
  - Employees page: search/filter, **add** employee, **delete** employee.
  - Timecard (weekly): per-day hours (supports overnight punches), filters, punch-detail modal:
    - Edit/delete/manual-add punches (week total is read-only).
    - Button colors: green=complete, blue=in progress, yellow=manually changed, red=>8 hours.
  - Realtime attendance cards by position (early/late shift split).

## Tech stack

- Vite + React + TypeScript + Tailwind
- Supabase JS v2

## Prerequisites

- Node.js 18+
- A Supabase project (Postgres + Auth)

## Environment

Create `.env` (see `.env.example`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_EMPLOYEE_TABLE=ob_employees
VITE_EMPLOYEE_REQUESTS_TABLE=ob_employee_requests
```

## Supabase tables (minimum)

### `ob_employees`

Used by kiosk + admin.

Required columns:

- `staff_id` (text, unique recommended)
- `name` (text)
- `agency` (text) *(some deployments may use `"Agency"` instead)*
- `position` (text) *(some deployments may use `"Position"` instead)*

### `ob_punches`

Used by kiosk + admin timecard/punch log.

Recommended columns:

- `id` (int/bigint, identity)
- `staff_id` (text)
- `action` (text: `IN` / `OUT`)
- `created_at` (timestamptz)
- `metadata` (jsonb, optional; used to mark manual edits)

## RLS / Policies

This project calls Supabase from the browser. You must either:

- disable RLS for the required tables during internal LAN usage, **or**
- create appropriate RLS policies for reading employees and inserting/reading punches.

## Run locally

Install dependencies:

```
npm install
```

Start dev server:

```
npm run dev
```

Pages:

- Kiosk: `http://localhost:5173/`
- Admin: `http://localhost:5173/admin.html`

## Deploy on LAN

Run dev server on your LAN:

```
npm run dev -- --host 0.0.0.0
```

Then open `http://<your-lan-ip>:5173/` from other devices.

Production build:

```
npm run build
```

## Notes

- Staff ID format: `US` + 3–12 digits (e.g. `US010454`).
- Employee table column casing (`agency/position` vs `"Agency"/"Position"`) is auto-detected at runtime.
