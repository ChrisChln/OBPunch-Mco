alter table if exists public.ob_exception_reports
  alter column system_location_qty drop not null,
  alter column actual_qty drop not null;

