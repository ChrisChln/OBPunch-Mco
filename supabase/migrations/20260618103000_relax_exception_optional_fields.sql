alter table if exists public.ob_exception_reports
  alter column exception_type drop not null,
  alter column picking_container drop not null,
  alter column picking_operator drop not null,
  alter column picked_location drop not null,
  alter column count_by drop not null,
  alter column submitted_by_lead_id drop not null;

alter table if exists public.ob_exception_reports
  drop constraint if exists ob_exception_reports_exception_type_check;

alter table if exists public.ob_exception_reports
  add constraint ob_exception_reports_exception_type_check
  check (exception_type is null or exception_type in ('over_pick', 'short_pick', 'wrong_pick', 'short_shipment'));
