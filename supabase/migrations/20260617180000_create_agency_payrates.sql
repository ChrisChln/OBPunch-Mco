create table if not exists public.ob_agency_payrates (
  staff_id text not null,
  work_date date not null,
  payrate numeric(10, 2) not null check (payrate >= 0 and payrate <= 9999.99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (staff_id, work_date)
);

alter table public.ob_agency_payrates enable row level security;

drop policy if exists ob_agency_payrates_agency_select on public.ob_agency_payrates;
create policy ob_agency_payrates_agency_select
  on public.ob_agency_payrates
  for select
  using (public.user_has_module_access('agency', 'view'));

drop policy if exists ob_agency_payrates_agency_insert on public.ob_agency_payrates;
create policy ob_agency_payrates_agency_insert
  on public.ob_agency_payrates
  for insert
  with check (public.user_has_module_access('agency', 'operate'));

drop policy if exists ob_agency_payrates_agency_update on public.ob_agency_payrates;
create policy ob_agency_payrates_agency_update
  on public.ob_agency_payrates
  for update
  using (public.user_has_module_access('agency', 'operate'))
  with check (public.user_has_module_access('agency', 'operate'));

drop policy if exists ob_agency_payrates_agency_delete on public.ob_agency_payrates;
create policy ob_agency_payrates_agency_delete
  on public.ob_agency_payrates
  for delete
  using (public.user_has_module_access('agency', 'operate'));

grant select, insert, update, delete on public.ob_agency_payrates to authenticated;
grant select, insert, update, delete on public.ob_agency_payrates to service_role;
