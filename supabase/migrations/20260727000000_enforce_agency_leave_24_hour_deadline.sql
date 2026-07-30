do $migration$
begin
  if to_regprocedure(
    'public.agency_set_schedule_state_without_leave_deadline(text,date,text,text)'
  ) is null then
    execute
      'alter function public.agency_set_schedule_state(text, date, text, text) '
      || 'rename to agency_set_schedule_state_without_leave_deadline';
  end if;
end;
$migration$;

revoke all on function public.agency_set_schedule_state_without_leave_deadline(text, date, text, text)
  from public;
revoke all on function public.agency_set_schedule_state_without_leave_deadline(text, date, text, text)
  from authenticated;
revoke all on function public.agency_set_schedule_state_without_leave_deadline(text, date, text, text)
  from service_role;
revoke all on function public.agency_set_planned_leave(text, date, text)
  from public;
revoke all on function public.agency_set_planned_leave(text, date, text)
  from authenticated;
revoke all on function public.agency_set_planned_leave(text, date, text)
  from service_role;

create or replace function public.agency_set_schedule_state(
  p_staff_id text,
  p_work_date date,
  p_state text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_id text := btrim(coalesce(p_staff_id, ''));
  v_requested_state text := lower(btrim(coalesce(p_state, '')));
  v_now timestamptz := now();
  v_employee public.ob_employees%rowtype;
  v_shift text := '';
  v_shift_time text := '';
  v_shift_start timestamptz := null;
begin
  if v_requested_state in ('leave', 'planned_leave') then
    if v_user_id is null then
      raise exception 'Unauthorized.';
    end if;
    if not public.user_has_module_access('agency', 'operate', v_user_id) then
      raise exception 'Forbidden.';
    end if;
    if v_staff_id = '' or p_work_date is null then
      raise exception 'Invalid schedule update.';
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

    v_shift := lower(btrim(coalesce(v_employee.shift, '')));
    if v_shift not in ('early', 'late') then
      raise exception 'Employee shift is required.';
    end if;

    v_shift_time := btrim(coalesce(to_jsonb(v_employee) ->> 'shift_time', ''));
    if v_shift_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
      v_shift_time := case v_shift
        when 'early' then '07:00'
        when 'late' then '15:00'
        else ''
      end;
    end if;
    if v_shift_time = '' then
      raise exception 'Employee shift start time is required.';
    end if;

    v_shift_start := timezone(
      'America/New_York',
      (p_work_date::text || ' ' || v_shift_time || ':00')::timestamp
    );
    if v_now >= v_shift_start - interval '24 hours' then
      raise exception 'Leave requests must be submitted more than 24 hours before shift start.';
    end if;
  end if;

  return public.agency_set_schedule_state_without_leave_deadline(
    p_staff_id,
    p_work_date,
    p_state,
    p_reason
  );
end;
$$;

revoke all on function public.agency_set_schedule_state(text, date, text, text)
  from public;
grant execute on function public.agency_set_schedule_state(text, date, text, text)
  to authenticated;
grant execute on function public.agency_set_schedule_state(text, date, text, text)
  to service_role;
