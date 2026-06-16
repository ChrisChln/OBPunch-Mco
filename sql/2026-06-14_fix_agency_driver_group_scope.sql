create or replace function public.agency_get_driver_groups()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_managed_agencies text[] := public.current_user_managed_agencies(v_user_id);
  v_assignments jsonb := '[]'::jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_next_code integer := 1;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'view', v_user_id) then
    raise exception 'Forbidden.';
  end if;

  perform public.agency_archive_inactive_driver_groups();

  with recursive used_codes(code) as (
    select distinct assignment.group_code::integer
    from public.ob_agency_driver_groups as assignment
    join public.ob_employees as employee
      on employee.staff_id = assignment.staff_id
    where assignment.archived_at is null
      and employee.terminated_at is null
      and assignment.group_code ~ '^[0-9]+$'
      and assignment.group_code::integer > 0
  ),
  candidates(code) as (
    select 1
    union all
    select code + 1
    from candidates
    where code < coalesce((select max(code) + 1 from used_codes), 1)
  )
  select min(candidates.code)
  into v_next_code
  from candidates
  where not exists (
    select 1
    from used_codes
    where used_codes.code = candidates.code
  );

  with scoped_assignments as (
    select
      assignment.staff_id,
      assignment.group_code,
      assignment.role,
      employee.terminated_at
    from public.ob_agency_driver_groups as assignment
    join public.ob_employees as employee
      on employee.staff_id = assignment.staff_id
    where assignment.archived_at is null
      and (
        (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
        or public.employee_record_text(to_jsonb(employee), 'agency', 'Agency') = any(coalesce(v_managed_agencies, '{}'::text[]))
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'staff_id', staff_id,
        'code', group_code,
        'role', role,
        'label', case when role = 'driver' then 'Driver' || group_code else group_code end
      )
      order by group_code, role, staff_id
    ),
    '[]'::jsonb
  )
  into v_assignments
  from scoped_assignments
  where terminated_at is null;

  with scoped_assignments as (
    select
      assignment.staff_id,
      assignment.group_code,
      assignment.role,
      employee.terminated_at
    from public.ob_agency_driver_groups as assignment
    join public.ob_employees as employee
      on employee.staff_id = assignment.staff_id
    where assignment.archived_at is null
      and (
        (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
        or public.employee_record_text(to_jsonb(employee), 'agency', 'Agency') = any(coalesce(v_managed_agencies, '{}'::text[]))
      )
  ),
  group_stats as (
    select
      group_code,
      count(*) filter (where terminated_at is null) as active_member_count,
      count(*) as member_count,
      count(*) filter (where role = 'driver' and terminated_at is null) as driver_count,
      jsonb_agg(case when role = 'driver' then 'Driver' || group_code else group_code end order by role, staff_id) as labels
    from scoped_assignments
    group by group_code
    having count(*) filter (where terminated_at is null) > 0
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', group_code,
        'active_member_count', active_member_count,
        'member_count', member_count,
        'driver_count', driver_count,
        'labels', labels
      )
      order by group_code
    ),
    '[]'::jsonb
  )
  into v_groups
  from group_stats;

  return jsonb_build_object(
    'assignments', v_assignments,
    'groups', v_groups,
    'next_code', coalesce(v_next_code, 1)::text
  );
end;
$$;

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

  if coalesce(array_length(v_member_staff_ids, 1), 0) < 2 then
    raise exception 'Driver group needs at least two employees.';
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

  perform public.agency_archive_inactive_driver_groups();

  if exists (
    select 1
    from public.ob_agency_driver_groups as assignment
    join public.ob_employees as employee
      on employee.staff_id = assignment.staff_id
    where assignment.group_code = v_code
      and assignment.archived_at is null
      and employee.terminated_at is null
      and not public.agency_user_can_access_employee(assignment.staff_id, v_user_id)
  ) then
    raise exception 'Driver group already exists outside scope.';
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
        and public.agency_user_can_access_employee(assignment.staff_id, v_user_id)
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

revoke all on function public.agency_get_driver_groups() from public;
revoke all on function public.agency_upsert_driver_group(text, text, text[]) from public;

grant execute on function public.agency_get_driver_groups() to authenticated;
grant execute on function public.agency_upsert_driver_group(text, text, text[]) to authenticated;
grant execute on function public.agency_get_driver_groups() to service_role;
grant execute on function public.agency_upsert_driver_group(text, text, text[]) to service_role;
