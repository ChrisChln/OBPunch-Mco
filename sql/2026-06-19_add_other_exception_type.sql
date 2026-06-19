alter table if exists public.ob_exception_reports
  drop constraint if exists ob_exception_reports_exception_type_check;

alter table if exists public.ob_exception_reports
  add constraint ob_exception_reports_exception_type_check
  check (exception_type is null or exception_type in ('over_pick', 'short_pick', 'wrong_pick', 'short_shipment', 'other'));
