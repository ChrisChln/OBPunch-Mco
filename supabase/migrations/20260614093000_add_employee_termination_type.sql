alter table public.ob_employees
  add column if not exists termination_type text null;

alter table public.ob_employees
  drop constraint if exists ob_employees_termination_type_check;

alter table public.ob_employees
  add constraint ob_employees_termination_type_check
  check (termination_type is null or termination_type in ('normal', 'blacklist'));

update public.ob_employees
set termination_type = 'normal'
where terminated_at is not null
  and nullif(btrim(coalesce(termination_type, '')), '') is null;

create or replace function public.review_employee_termination_request(
  p_request_id uuid,
  p_action text,
  p_review_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_actor_display text := '';
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_request public.ob_employee_termination_requests%rowtype;
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_managed_agencies text[] := public.current_user_managed_agencies(v_user_id);
  v_deleted_schedule_count int := 0;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_action not in ('approve', 'reject') then
    raise exception 'Unsupported review action: %', p_action;
  end if;
  if not public.user_can_review_termination_requests(v_user_id) then
    raise exception 'Forbidden.';
  end if;

  select *
  into v_request
  from public.ob_employee_termination_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Termination request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only pending requests can be reviewed.';
  end if;
  if not (
    (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
    or v_request.employee_user_scope_agency = any(coalesce(v_managed_agencies, '{}'::text[]))
  ) then
    raise exception 'Request is out of scope.';
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_user_id) as identity_row
  limit 1;

  if v_action = 'approve' then
    delete from public.ob_schedules
    where staff_id = v_request.staff_id;
    get diagnostics v_deleted_schedule_count = row_count;

    update public.ob_employees
    set
      active = false,
      terminated_at = v_now,
      termination_type = 'normal'
    where staff_id = v_request.staff_id;

    update public.ob_employee_termination_requests
    set
      status = 'approved',
      reviewed_by_user_id = v_user_id,
      review_note = btrim(coalesce(p_review_note, '')),
      reviewed_at = v_now
    where id = p_request_id;

    insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
    values (
      v_actor_display,
      'employee_termination_approve',
      v_request.staff_id,
      'ob_employee_termination_requests',
      jsonb_build_object(
        'request_id', p_request_id,
        'agency', v_request.employee_user_scope_agency,
        'review_note', btrim(coalesce(p_review_note, '')),
        'deleted_schedule_rows', v_deleted_schedule_count,
        'termination_type', 'normal'
      )
    );
  else
    update public.ob_employee_termination_requests
    set
      status = 'rejected',
      reviewed_by_user_id = v_user_id,
      review_note = btrim(coalesce(p_review_note, '')),
      reviewed_at = v_now
    where id = p_request_id;

    insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
    values (
      v_actor_display,
      'employee_termination_reject',
      v_request.staff_id,
      'ob_employee_termination_requests',
      jsonb_build_object(
        'request_id', p_request_id,
        'agency', v_request.employee_user_scope_agency,
        'review_note', btrim(coalesce(p_review_note, ''))
      )
    );
  end if;

  return jsonb_build_object(
    'request_id', p_request_id,
    'staff_id', v_request.staff_id,
    'status', case when v_action = 'approve' then 'approved' else 'rejected' end,
    'reviewed_at', v_now
  );
end;
$$;

revoke all on function public.review_employee_termination_request(uuid, text, text) from public;
grant execute on function public.review_employee_termination_request(uuid, text, text) to authenticated;
grant execute on function public.review_employee_termination_request(uuid, text, text) to service_role;
