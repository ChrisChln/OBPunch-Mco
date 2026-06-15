create or replace function public.agency_upsert_driver_group(
  p_code text,
  p_driver_staff_id text,
  p_member_staff_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := btrim(coalesce(p_code, ''));
  v_driver_staff_id text := btrim(coalesce(p_driver_staff_id, ''));
  v_member_staff_ids text[] := '{}';
  v_staff_id text;
  v_target_agency text := '';
  v_distinct_agency_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_code = '' or v_driver_staff_id = '' then
    raise exception 'Driver group is incomplete.';
  end if;

  select array_agg(distinct btrim(staff_id))
  into v_member_staff_ids
  from unnest(coalesce(p_member_staff_ids, '{}')) as input(staff_id)
  where btrim(staff_id) <> '';

  v_member_staff_ids := array_append(coalesce(v_member_staff_ids, '{}'), v_driver_staff_id);

  select array_agg(distinct staff_id)
  into v_member_staff_ids
  from unnest(v_member_staff_ids) as input(staff_id);

  if coalesce(array_length(v_member_staff_ids, 1), 0) < 1 then
    raise exception 'Driver group needs at least one employee.';
  end if;
  if not v_driver_staff_id = any(v_member_staff_ids) then
    raise exception 'Driver must be in the group.';
  end if;

  foreach v_staff_id in array v_member_staff_ids loop
    if not public.agency_user_can_access_employee(v_staff_id, v_user_id) then
      raise exception 'Employee is out of scope.';
    end if;
    if exists (select 1 from public.ob_employees where staff_id = v_staff_id and terminated_at is not null) then
      raise exception 'Terminated employees cannot be assigned to a driver group.';
    end if;
  end loop;

  select
    count(distinct nullif(btrim(public.employee_record_text(to_jsonb(employee), 'agency', 'Agency')), '')),
    min(nullif(btrim(public.employee_record_text(to_jsonb(employee), 'agency', 'Agency')), ''))
  into v_distinct_agency_count, v_target_agency
  from public.ob_employees as employee
  where employee.staff_id = any(v_member_staff_ids);

  if coalesce(v_distinct_agency_count, 0) <> 1 or coalesce(v_target_agency, '') = '' then
    raise exception 'Driver group employees must belong to one agency.';
  end if;

  perform public.agency_archive_inactive_driver_groups();

  if exists (
    select 1
    from public.ob_agency_driver_groups as assignment
    join public.ob_employees as employee
      on employee.staff_id = assignment.staff_id
    where assignment.group_code = v_code
      and assignment.archived_at is null
      and employee.terminated_at is null
      and nullif(btrim(public.employee_record_text(to_jsonb(employee), 'agency', 'Agency')), '') is distinct from v_target_agency
  ) then
    raise exception 'Driver group already belongs to another agency.';
  end if;

  update public.ob_agency_driver_groups as assignment
  set archived_at = now(),
      updated_by = v_user_id,
      updated_at = now()
  where assignment.archived_at is null
    and (
      assignment.staff_id = any(v_member_staff_ids)
      or (
        assignment.group_code = v_code
        and exists (
          select 1
          from public.ob_employees as employee
          where employee.staff_id = assignment.staff_id
            and nullif(btrim(public.employee_record_text(to_jsonb(employee), 'agency', 'Agency')), '') = v_target_agency
        )
      )
    );

  insert into public.ob_agency_driver_groups (
    staff_id,
    group_code,
    role,
    archived_at,
    created_by,
    updated_by,
    updated_at
  )
  select
    staff_id,
    v_code,
    case when staff_id = v_driver_staff_id then 'driver' else 'member' end,
    null,
    v_user_id,
    v_user_id,
    now()
  from unnest(v_member_staff_ids) as input(staff_id)
  on conflict (staff_id) do update
    set group_code = excluded.group_code,
        role = excluded.role,
        archived_at = null,
        updated_by = excluded.updated_by,
        updated_at = now();

  return public.agency_get_driver_groups();
end;
$$;

revoke all on function public.agency_upsert_driver_group(text, text, text[]) from public;
grant execute on function public.agency_upsert_driver_group(text, text, text[]) to authenticated;
grant execute on function public.agency_upsert_driver_group(text, text, text[]) to service_role;
