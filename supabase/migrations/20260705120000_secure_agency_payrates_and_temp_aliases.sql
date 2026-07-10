create or replace function public.save_agency_payrates(
  p_staff_ids text[],
  p_work_date date,
  p_payrate numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_ids text[];
  v_saved_count integer := 0;
  v_deleted_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Agency operate access required.';
  end if;

  select coalesce(array_agg(distinct staff_id), '{}'::text[])
    into v_staff_ids
  from (
    select upper(trim(staff_id)) as staff_id
    from unnest(coalesce(p_staff_ids, '{}'::text[])) as input(staff_id)
  ) normalized
  where staff_id <> '';

  if array_length(v_staff_ids, 1) is null then
    raise exception 'At least one staff ID is required.';
  end if;

  if p_work_date is null then
    raise exception 'Work date is required.';
  end if;

  if p_payrate is not null and (p_payrate < 0 or p_payrate > 9999.99) then
    raise exception 'Payrate is out of range.';
  end if;

  if exists (
    select 1
    from unnest(v_staff_ids) as staff(staff_id)
    where not public.agency_user_can_access_employee(staff.staff_id, v_user_id)
  ) then
    raise exception 'Forbidden agency payrate scope.';
  end if;

  if p_payrate is null then
    delete from public.ob_agency_payrates
    where staff_id = any(v_staff_ids)
      and work_date = p_work_date;
    get diagnostics v_deleted_count = row_count;

    return jsonb_build_object(
      'staff_ids', v_staff_ids,
      'work_date', p_work_date,
      'deleted_count', v_deleted_count
    );
  end if;

  insert into public.ob_agency_payrates (staff_id, work_date, payrate, updated_at)
  select staff_id, p_work_date, round(p_payrate, 2), now()
  from unnest(v_staff_ids) as staff(staff_id)
  on conflict (staff_id, work_date) do update
    set payrate = excluded.payrate,
        updated_at = now();
  get diagnostics v_saved_count = row_count;

  return jsonb_build_object(
    'staff_ids', v_staff_ids,
    'work_date', p_work_date,
    'saved_count', v_saved_count
  );
end;
$$;

revoke all on function public.save_agency_payrates(text[], date, numeric) from public;
grant execute on function public.save_agency_payrates(text[], date, numeric) to authenticated;
grant execute on function public.save_agency_payrates(text[], date, numeric) to service_role;

drop policy if exists ob_agency_payrates_agency_select on public.ob_agency_payrates;
create policy ob_agency_payrates_agency_select
  on public.ob_agency_payrates
  for select
  using (
    public.user_has_module_access('agency', 'view')
    and public.agency_user_can_access_employee(staff_id)
  );

drop policy if exists ob_agency_payrates_agency_insert on public.ob_agency_payrates;
create policy ob_agency_payrates_agency_insert
  on public.ob_agency_payrates
  for insert
  with check (
    public.user_has_module_access('agency', 'operate')
    and public.agency_user_can_access_employee(staff_id)
  );

drop policy if exists ob_agency_payrates_agency_update on public.ob_agency_payrates;
create policy ob_agency_payrates_agency_update
  on public.ob_agency_payrates
  for update
  using (
    public.user_has_module_access('agency', 'operate')
    and public.agency_user_can_access_employee(staff_id)
  )
  with check (
    public.user_has_module_access('agency', 'operate')
    and public.agency_user_can_access_employee(staff_id)
  );

drop policy if exists ob_agency_payrates_agency_delete on public.ob_agency_payrates;
create policy ob_agency_payrates_agency_delete
  on public.ob_agency_payrates
  for delete
  using (
    public.user_has_module_access('agency', 'operate')
    and public.agency_user_can_access_employee(staff_id)
  );

create or replace function public.resolve_temp_staff_alias(
  p_source_temp_staff_id text
)
returns table (
  staff_id text,
  source_temp_staff_id text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_temp_staff_id text := upper(trim(coalesce(p_source_temp_staff_id, '')));
begin
  if v_source_temp_staff_id = '' then
    return;
  end if;

  return query
  select assignment.staff_id, assignment.source_temp_staff_id, assignment.created_at
  from public.ob_temp_account_assignments assignment
  where assignment.source_temp_staff_id = v_source_temp_staff_id
  order by assignment.created_at desc
  limit 1;
end;
$$;

revoke all on function public.resolve_temp_staff_alias(text) from public;
grant execute on function public.resolve_temp_staff_alias(text) to anon;
grant execute on function public.resolve_temp_staff_alias(text) to authenticated;
grant execute on function public.resolve_temp_staff_alias(text) to service_role;

drop policy if exists ob_temp_account_assignments_alias_select_anon on public.ob_temp_account_assignments;
revoke select (staff_id, source_temp_staff_id, created_at)
  on public.ob_temp_account_assignments
  from anon;
