create table if not exists public.ob_dashboard_attendance_snapshots (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift text not null,
  position text not null,
  department text not null default 'OB',
  expected integer not null default 0,
  present integer not null default 0,
  on_clock integer not null default 0,
  off_worked integer not null default 0,
  work_hours numeric(10, 2) not null default 0,
  snapshot_status text not null default 'expected',
  expected_captured_at timestamptz null,
  actual_captured_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint ob_dashboard_attendance_snapshots_shift_check check (shift in ('early', 'late')),
  constraint ob_dashboard_attendance_snapshots_department_check check (department in ('OB', 'IB', 'INV', 'hidden')),
  constraint ob_dashboard_attendance_snapshots_status_check check (snapshot_status in ('expected', 'actual')),
  constraint ob_dashboard_attendance_snapshots_counts_check check (
    expected >= 0 and present >= 0 and on_clock >= 0 and off_worked >= 0 and work_hours >= 0
  ),
  constraint ob_dashboard_attendance_snapshots_position_not_blank check (btrim(position) <> ''),
  constraint ob_dashboard_attendance_snapshots_work_date_shift_position_key unique (work_date, shift, position)
);

create index if not exists ob_dashboard_attendance_snapshots_work_date_idx
  on public.ob_dashboard_attendance_snapshots (work_date desc, shift, position);

alter table public.ob_dashboard_attendance_snapshots enable row level security;

grant select on public.ob_dashboard_attendance_snapshots to authenticated;

drop policy if exists ob_dashboard_attendance_snapshots_authenticated_select
  on public.ob_dashboard_attendance_snapshots;
create policy ob_dashboard_attendance_snapshots_authenticated_select
  on public.ob_dashboard_attendance_snapshots
  for select
  to authenticated
  using (true);
