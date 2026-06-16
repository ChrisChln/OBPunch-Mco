grant usage on schema public to authenticated;
grant select, insert, update on public.ob_temp_account_assignments to authenticated;
grant usage, select on sequence public.ob_temp_account_assignments_id_seq to authenticated;

alter table public.ob_temp_account_assignments enable row level security;

drop policy if exists ob_temp_account_assignments_select_access on public.ob_temp_account_assignments;
create policy ob_temp_account_assignments_select_access
  on public.ob_temp_account_assignments
  for select
  to authenticated
  using (
    public.user_can_access_staff_position('timecard', staff_id, 'view')
    or public.user_has_position_access('employees', coalesce(nullif(btrim(position), ''), public.position_for_staff(staff_id)), 'view')
  );

drop policy if exists ob_temp_account_assignments_insert_access on public.ob_temp_account_assignments;
create policy ob_temp_account_assignments_insert_access
  on public.ob_temp_account_assignments
  for insert
  to authenticated
  with check (
    public.user_can_access_staff_position('timecard', staff_id, 'operate')
    or public.user_has_position_access('employees', coalesce(nullif(btrim(position), ''), public.position_for_staff(staff_id)), 'operate')
  );

drop policy if exists ob_temp_account_assignments_update_access on public.ob_temp_account_assignments;
create policy ob_temp_account_assignments_update_access
  on public.ob_temp_account_assignments
  for update
  to authenticated
  using (
    public.user_can_access_staff_position('timecard', staff_id, 'operate')
    or public.user_has_position_access('employees', coalesce(nullif(btrim(position), ''), public.position_for_staff(staff_id)), 'operate')
  )
  with check (
    public.user_can_access_staff_position('timecard', staff_id, 'operate')
    or public.user_has_position_access('employees', coalesce(nullif(btrim(position), ''), public.position_for_staff(staff_id)), 'operate')
  );
