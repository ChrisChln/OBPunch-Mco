create table if not exists public.ob_exception_reports (
  id bigserial primary key,
  report_date date not null,
  exception_type text check (exception_type is null or exception_type in ('over_pick', 'short_pick', 'wrong_pick', 'short_shipment')),
  product_barcode text not null,
  picking_list_number text not null,
  picking_container text,
  picking_operator text,
  packing_rebin_operator text,
  picked_location text,
  system_location_qty numeric check (system_location_qty is null or system_location_qty >= 0),
  actual_qty numeric check (actual_qty is null or actual_qty >= 0),
  count_by text,
  borrowed_location text,
  borrowed_qty numeric check (borrowed_qty is null or borrowed_qty >= 0),
  inventory_adjustment boolean not null default false,
  submitted_by_lead_id text,
  status text not null default 'Open' check (status in ('Open', 'Processing', 'Resolved', 'Closed')),
  resolution_note text,
  responsible_staff_id text,
  responsibility_result text not null default 'pending' check (responsibility_result in ('pending', 'responsible', 'no_responsibility')),
  mistake_report_id bigint references public.ob_mistake_reports(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  constraint ob_exception_reports_borrowed_pair_chk check (
    (borrowed_location is null and borrowed_qty is null)
    or (borrowed_location is not null and borrowed_qty is not null)
  )
);

create index if not exists ob_exception_reports_report_date_idx
  on public.ob_exception_reports (report_date desc, created_at desc);

create index if not exists ob_exception_reports_status_idx
  on public.ob_exception_reports (status, report_date desc);

create index if not exists ob_exception_reports_product_barcode_idx
  on public.ob_exception_reports (product_barcode, report_date desc);

create index if not exists ob_exception_reports_responsible_staff_idx
  on public.ob_exception_reports (responsible_staff_id, closed_at desc);

alter table public.ob_exception_reports enable row level security;

drop policy if exists ob_exception_reports_no_direct_client_access on public.ob_exception_reports;
create policy ob_exception_reports_no_direct_client_access
  on public.ob_exception_reports
  for select
  to authenticated
  using (false);

create or replace function public.set_ob_exception_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ob_exception_reports_updated_at on public.ob_exception_reports;
create trigger set_ob_exception_reports_updated_at
  before update on public.ob_exception_reports
  for each row
  execute function public.set_ob_exception_reports_updated_at();

grant select, insert, update on public.ob_exception_reports to service_role;
grant usage, select on sequence public.ob_exception_reports_id_seq to service_role;
