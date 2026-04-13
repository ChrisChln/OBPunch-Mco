alter table public.ob_employee_termination_requests
  drop constraint if exists ob_employee_termination_requests_status_check;

alter table public.ob_employee_termination_requests
  add constraint ob_employee_termination_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

create or replace function public.user_can_review_termination_requests(
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_role text := public.resolve_admin_role_for_user(v_user_id);
begin
  if v_user_id is null then
    return false;
  end if;
  if not public.user_has_module_access('schedule', 'operate', v_user_id) then
    return false;
  end if;

  return v_role in ('level1', 'level2');
end;
$$;

create or replace function public.list_employee_termination_requests(
  p_status text default 'pending'
)
returns table (
  id uuid,
  staff_id text,
  agency text,
  requested_by_display text,
  reason text,
  status text,
  review_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid,
  employee_snapshot jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_managed_agencies text[] := public.current_user_managed_agencies(v_user_id);
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('schedule', 'view', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_status is not null and v_status not in ('pending', 'approved', 'rejected', 'cancelled') then
    raise exception 'Unsupported termination status: %', p_status;
  end if;

  return query
  select
    request_row.id,
    request_row.staff_id,
    request_row.employee_user_scope_agency as agency,
    request_row.requested_by_display,
    request_row.reason,
    request_row.status,
    request_row.review_note,
    request_row.created_at,
    request_row.reviewed_at,
    request_row.reviewed_by_user_id,
    request_row.employee_snapshot
  from public.ob_employee_termination_requests as request_row
  where (v_status is null or request_row.status = v_status)
    and (
      (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
      or request_row.employee_user_scope_agency = any(coalesce(v_managed_agencies, '{}'::text[]))
    )
  order by
    case when request_row.status = 'pending' then 0 else 1 end,
    request_row.created_at desc;
end;
$$;

create or replace function public.agency_cancel_termination_request(
  p_staff_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_id text := btrim(coalesce(p_staff_id, ''));
  v_request public.ob_employee_termination_requests%rowtype;
  v_employee public.ob_employees%rowtype;
  v_actor_display text := '';
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_staff_id = '' then
    raise exception 'Employee is required.';
  end if;
  if not public.agency_user_can_access_employee(v_staff_id, v_user_id) then
    raise exception 'Employee is out of scope.';
  end if;

  select *
  into v_employee
  from public.ob_employees
  where staff_id = v_staff_id
  limit 1;

  if not found then
    raise exception 'Employee not found.';
  end if;

  select *
  into v_request
  from public.ob_employee_termination_requests
  where staff_id = v_staff_id
    and status = 'pending'
  order by created_at desc, id desc
  limit 1
  for update;

  if not found then
    raise exception 'Pending termination request not found.';
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_user_id) as identity_row
  limit 1;

  update public.ob_employee_termination_requests
  set
    status = 'cancelled',
    reviewed_by_user_id = v_user_id,
    review_note = 'Cancelled by agency',
    reviewed_at = v_now
  where id = v_request.id;

  perform public.insert_agency_audit_log(
    'agency_termination_request_cancel',
    v_staff_id,
    jsonb_build_object(
      'agency', public.employee_record_text(to_jsonb(v_employee), 'agency', 'Agency'),
      'request_id', v_request.id,
      'reason', v_request.reason
    )
  );

  insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
  values (
    v_actor_display,
    'employee_termination_cancel',
    v_staff_id,
    'ob_employee_termination_requests',
    jsonb_build_object(
      'request_id', v_request.id,
      'agency', v_request.employee_user_scope_agency,
      'review_note', 'Cancelled by agency'
    )
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'staff_id', v_staff_id,
    'status', 'cancelled'
  );
end;
$$;

revoke all on function public.agency_cancel_termination_request(text) from public;

grant execute on function public.agency_cancel_termination_request(text) to authenticated;
grant execute on function public.agency_cancel_termination_request(text) to service_role;
