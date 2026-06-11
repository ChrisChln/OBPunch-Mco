grant usage on schema public to anon;
grant select (staff_id, source_temp_staff_id, created_at)
  on public.ob_temp_account_assignments
  to anon;

drop policy if exists ob_temp_account_assignments_alias_select_anon on public.ob_temp_account_assignments;
create policy ob_temp_account_assignments_alias_select_anon
  on public.ob_temp_account_assignments
  for select
  to anon
  using (source_temp_staff_id is not null);
