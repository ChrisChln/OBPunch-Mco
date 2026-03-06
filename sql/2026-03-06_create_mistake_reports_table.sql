create table if not exists public.ob_mistake_reports (
  id bigserial primary key,
  position text not null,
  employee_staff_id text not null,
  reason text not null,
  reporter_staff_id text not null,
  operational_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists ob_mistake_reports_operational_date_idx
  on public.ob_mistake_reports (operational_date desc, created_at desc);

create index if not exists ob_mistake_reports_employee_idx
  on public.ob_mistake_reports (employee_staff_id, created_at desc);

create index if not exists ob_mistake_reports_reporter_idx
  on public.ob_mistake_reports (reporter_staff_id, created_at desc);
