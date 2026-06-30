create or replace function public.cancel_pending_employee_termination_requests(
  p_staff_id text,
  p_review_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_id text := btrim(coalesce(p_staff_id, ''));
  v_actor_display text := '';
  v_review_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  v_now timestamptz := now();
  v_cancelled_count integer := 0;
  v_request_ids jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_staff_id = '' then
    raise exception 'Employee is required.';
  end if;
  if not exists (
    select 1
    from public.ob_employees
    where staff_id = v_staff_id
  ) then
    raise exception 'Employee not found.';
  end if;
  if not (
    public.user_can_access_staff_position('employees', v_staff_id, 'operate', v_user_id)
    or public.user_can_review_termination_requests(v_user_id)
  ) then
    raise exception 'Forbidden.';
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_user_id) as identity_row
  limit 1;

  with updated as (
    update public.ob_employee_termination_requests
    set
      status = 'cancelled',
      reviewed_by_user_id = v_user_id,
      review_note = coalesce(v_review_note, 'Cancelled automatically after direct departure.'),
      reviewed_at = v_now
    where staff_id = v_staff_id
      and status = 'pending'
    returning id
  )
  select count(*), coalesce(jsonb_agg(id), '[]'::jsonb)
  into v_cancelled_count, v_request_ids
  from updated;

  if v_cancelled_count > 0 then
    insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
    values (
      v_actor_display,
      'employee_termination_auto_cancel_pending',
      v_staff_id,
      'ob_employee_termination_requests',
      jsonb_build_object(
        'request_ids', v_request_ids,
        'cancelled_count', v_cancelled_count,
        'review_note', coalesce(v_review_note, 'Cancelled automatically after direct departure.')
      )
    );
  end if;

  return jsonb_build_object(
    'staff_id', v_staff_id,
    'cancelled_count', v_cancelled_count
  );
end;
$$;

revoke all on function public.cancel_pending_employee_termination_requests(text, text) from public;
grant execute on function public.cancel_pending_employee_termination_requests(text, text) to authenticated;
grant execute on function public.cancel_pending_employee_termination_requests(text, text) to service_role;
