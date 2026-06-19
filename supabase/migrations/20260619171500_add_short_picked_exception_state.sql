alter table if exists public.ob_exception_reports
  add column if not exists short_picked boolean not null default false;

alter table if exists public.ob_exception_reports
  drop constraint if exists ob_exception_reports_status_check;

alter table if exists public.ob_exception_reports
  add constraint ob_exception_reports_status_check
  check (status in ('Open', 'Processing', 'Pending Adjustment', 'Short Picked', 'Resolved', 'Closed'));
