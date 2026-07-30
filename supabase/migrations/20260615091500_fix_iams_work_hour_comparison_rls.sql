grant usage on schema public to authenticated;

grant select, insert on public.ob_iams_work_hour_upload_batches to authenticated;
grant select, insert, update on public.ob_iams_work_hours_imports to authenticated;

grant usage, select on sequence public.ob_iams_work_hour_upload_batches_id_seq to authenticated;
grant usage, select on sequence public.ob_iams_work_hours_imports_id_seq to authenticated;

alter table public.ob_iams_work_hour_upload_batches enable row level security;
alter table public.ob_iams_work_hours_imports enable row level security;

drop policy if exists ob_iams_work_hour_upload_batches_select_access
  on public.ob_iams_work_hour_upload_batches;
create policy ob_iams_work_hour_upload_batches_select_access
  on public.ob_iams_work_hour_upload_batches
  for select
  to authenticated
  using (public.user_has_module_access('work_hour_comparison', 'view', auth.uid()));

drop policy if exists ob_iams_work_hour_upload_batches_insert_access
  on public.ob_iams_work_hour_upload_batches;
create policy ob_iams_work_hour_upload_batches_insert_access
  on public.ob_iams_work_hour_upload_batches
  for insert
  to authenticated
  with check (public.user_has_module_access('work_hour_comparison', 'operate', auth.uid()));

drop policy if exists ob_iams_work_hours_imports_select_access
  on public.ob_iams_work_hours_imports;
create policy ob_iams_work_hours_imports_select_access
  on public.ob_iams_work_hours_imports
  for select
  to authenticated
  using (public.user_has_module_access('work_hour_comparison', 'view', auth.uid()));

drop policy if exists ob_iams_work_hours_imports_insert_access
  on public.ob_iams_work_hours_imports;
create policy ob_iams_work_hours_imports_insert_access
  on public.ob_iams_work_hours_imports
  for insert
  to authenticated
  with check (public.user_has_module_access('work_hour_comparison', 'operate', auth.uid()));

drop policy if exists ob_iams_work_hours_imports_update_access
  on public.ob_iams_work_hours_imports;
create policy ob_iams_work_hours_imports_update_access
  on public.ob_iams_work_hours_imports
  for update
  to authenticated
  using (public.user_has_module_access('work_hour_comparison', 'operate', auth.uid()))
  with check (public.user_has_module_access('work_hour_comparison', 'operate', auth.uid()));
