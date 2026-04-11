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
  v_work_date date := p_work_date;
  v_today date := (timezone('America/New_York', now()))::date;
  v_template_date date := public.agency_target_to_template_date(v_work_date);
  v_requested_state text := lower(btrim(coalesce(p_state, '')));
  v_next_state text := '';
  v_note text := null;
  v_now timestamptz := now();
  v_employee public.ob_employees%rowtype;
  v_schedule public.ob_schedules%rowtype;
  v_pending_leave_request public.ob_leave_requests%rowtype;
  v_current_state text := 'rest';
  v_agency text := '';
  v_position text := '';
  v_leave_request_source text := 'agency_schedule';
  v_leave_request_key text := '';
  v_fixed_work_count int := 0;
  v_open_substitute_slots int := 0;
  v_shift text := '';
  v_cutoff timestamptz := null;
  v_is_worklike_request boolean := false;
  v_is_offlike_request boolean := false;
  v_has_schedule boolean := false;
  v_has_pending_leave_request boolean := false;
  v_cutoff_locked boolean := false;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_staff_id = '' or v_work_date is null or v_template_date is null or v_requested_state = '' then
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
  if v_employee.terminated_at is not null then
    raise exception 'Terminated employee cannot be changed.';
  end if;

  v_agency := public.employee_record_text(to_jsonb(v_employee), 'agency', 'Agency');
  v_position := public.employee_record_text(to_jsonb(v_employee), 'position', 'Position');
  v_leave_request_key := v_staff_id || ':' || v_work_date::text;
  v_is_worklike_request := v_requested_state in ('new', 'work', 'fixed_work', 'temp_work', 'planned_temp_work');
  v_is_offlike_request := v_requested_state in ('rest', 'temp_rest', 'planned_temp_rest');

  if v_requested_state in ('leave', 'planned_leave') then
    v_next_state := 'planned_leave';
  elsif v_requested_state in ('temp_work', 'planned_temp_work') then
    v_next_state := case when v_work_date > v_today then 'planned_temp_work' else 'temp_work' end;
  elsif v_is_offlike_request then
    v_next_state := case when v_work_date > v_today then 'planned_temp_rest' else 'temp_rest' end;
  else
    v_next_state := '';
  end if;

  if not v_is_worklike_request and not v_is_offlike_request and v_next_state not in ('planned_leave', 'temp_work', 'planned_temp_work') then
    raise exception 'Unsupported state.';
  end if;

  v_shift := coalesce(nullif(btrim(coalesce(v_employee.shift, '')), ''), '');
  if v_work_date < v_today then
    v_cutoff_locked := true;
  elsif v_work_date = v_today then
    if v_shift not in ('early', 'late') then
      raise exception 'Employee shift is required.';
    end if;
    if v_shift = 'early' then
      v_cutoff := timezone('America/New_York', (v_work_date::text || ' 10:00:00')::timestamp);
    else
      v_cutoff := timezone('America/New_York', (v_work_date::text || ' 17:00:00')::timestamp);
    end if;
    v_cutoff_locked := v_now > v_cutoff;
  end if;

  if v_cutoff_locked then
    raise exception 'Schedule cutoff has passed.';
  end if;

  if v_next_state = 'planned_leave' and v_work_date = v_today then
    if v_shift not in ('early', 'late') then
      raise exception 'Employee shift is required.';
    end if;
    if v_shift = 'early' then
      v_cutoff := timezone('America/New_York', (v_work_date::text || ' 10:00:00')::timestamp);
    else
      v_cutoff := timezone('America/New_York', (v_work_date::text || ' 17:00:00')::timestamp);
    end if;
    if v_now > v_cutoff then
      raise exception 'Leave cutoff has passed.';
    end if;
  end if;

  select *
  into v_schedule
  from public.ob_schedules
  where staff_id = v_staff_id
    and date = v_template_date
  order by coalesce(updated_at, created_at) desc, id desc
  limit 1;

  v_has_schedule := found;

  if v_has_schedule then
    v_current_state := public.schedule_note_to_state(v_schedule.note);
  end if;

  select *
  into v_pending_leave_request
  from public.ob_leave_requests
  where source = v_leave_request_source
    and source_row_key = v_leave_request_key
    and status = 'pending'
  order by updated_at desc nulls last, created_at desc nulls last, id desc
  limit 1
  for update;

  v_has_pending_leave_request := found;

  if v_has_pending_leave_request and v_is_worklike_request then
    if v_current_state not in ('new', 'work', 'fixed_work', 'temp_work', 'planned_temp_work') then
      raise exception 'Pending leave can only be restored to a working schedule state.';
    end if;
    if v_requested_state <> v_current_state then
      raise exception 'Pending leave can only be restored to the current schedule state.';
    end if;

    update public.ob_leave_requests
    set
      status = 'cancelled',
      reviewed_by = coalesce(auth.jwt() ->> 'email', v_user_id::text),
      reviewed_at = v_now,
      updated_at = v_now,
      review_note = 'Cancelled by agency'
    where id = v_pending_leave_request.id;

    perform public.insert_agency_audit_log(
      'agency_leave_request_cancel',
      v_staff_id,
      jsonb_build_object(
        'agency', v_agency,
        'position', v_position,
        'work_date', v_work_date,
        'template_date', v_template_date,
        'leave_request_id', v_pending_leave_request.id,
        'from_state', 'leave_pending',
        'to_state', v_current_state
      )
    );

    return jsonb_build_object(
      'staff_id', v_staff_id,
      'work_date', v_work_date,
      'template_date', v_template_date,
      'state', v_current_state
    );
  end if;

  if v_is_worklike_request and v_next_state = '' then
    raise exception 'No pending leave request exists for this cell.';
  end if;

  if v_next_state = 'planned_leave' then
    if v_current_state not in ('new', 'work', 'fixed_work', 'temp_work') then
      raise exception 'Only fixed/work/temp states can be changed to planned leave from Agency.';
    end if;

    insert into public.ob_leave_requests (
      source,
      source_row_key,
      submitted_at,
      submitted_at_raw,
      employee_name_raw,
      employee_staff_id_raw,
      matched_staff_id,
      matched_employee_name,
      matching_method,
      matching_score,
      position_raw,
      leave_date,
      leave_type,
      schedule_adjusted,
      reason,
      status,
      reviewed_by,
      reviewed_at,
      review_note,
      raw_payload,
      updated_at
    )
    values (
      v_leave_request_source,
      v_leave_request_key,
      v_now,
      v_now::text,
      coalesce(nullif(btrim(coalesce(v_employee.name, '')), ''), v_staff_id),
      v_staff_id,
      v_staff_id,
      coalesce(nullif(btrim(coalesce(v_employee.name, '')), ''), v_staff_id),
      'id_exact',
      100,
      v_position,
      v_work_date,
      'agency_leave',
      false,
      nullif(btrim(coalesce(p_reason, '')), ''),
      'pending',
      null,
      null,
      null,
      jsonb_build_object(
        'agency', v_agency,
        'position', v_position,
        'shift', v_shift,
        'requested_state', v_next_state
      ),
      v_now
    )
    on conflict (source, source_row_key) do update
    set
      submitted_at = excluded.submitted_at,
      submitted_at_raw = excluded.submitted_at_raw,
      employee_name_raw = excluded.employee_name_raw,
      employee_staff_id_raw = excluded.employee_staff_id_raw,
      matched_staff_id = excluded.matched_staff_id,
      matched_employee_name = excluded.matched_employee_name,
      matching_method = excluded.matching_method,
      matching_score = excluded.matching_score,
      position_raw = excluded.position_raw,
      leave_date = excluded.leave_date,
      leave_type = excluded.leave_type,
      schedule_adjusted = false,
      reason = excluded.reason,
      status = 'pending',
      reviewed_by = null,
      reviewed_at = null,
      review_note = null,
      raw_payload = excluded.raw_payload,
      updated_at = excluded.updated_at;

    perform public.insert_agency_audit_log(
      'agency_leave_request_create',
      v_staff_id,
      jsonb_build_object(
        'agency', v_agency,
        'position', v_position,
        'work_date', v_work_date,
        'template_date', v_template_date,
        'from_state', v_current_state,
        'to_state', 'leave_pending',
        'reason', coalesce(p_reason, '')
      )
    );

    return jsonb_build_object(
      'staff_id', v_staff_id,
      'work_date', v_work_date,
      'template_date', v_template_date,
      'state', 'leave_pending'
    );
  elsif v_next_state in ('temp_work', 'planned_temp_work') then
    if v_current_state not in ('rest', 'temp_rest', 'planned_temp_rest') then
      raise exception 'Only off cells can be changed to substitute from Agency.';
    end if;

    select count(*)
    into v_fixed_work_count
    from public.ob_schedules as s
    where s.staff_id = v_staff_id
      and s.date between (v_work_date - (((extract(isodow from v_work_date)::int) + 6) % 7))
                     and ((v_work_date - (((extract(isodow from v_work_date)::int) + 6) % 7)) + 6)
      and public.schedule_note_to_state(s.note) in ('new', 'work', 'fixed_work', 'temp_work', 'planned_temp_work');

    if v_fixed_work_count >= 5 then
      raise exception 'Substitute weekly work count has reached the limit.';
    end if;

    select public.agency_open_substitute_slots(v_agency, v_position, v_shift, v_work_date, v_template_date)
    into v_open_substitute_slots;

    if coalesce(v_open_substitute_slots, 0) <= 0 then
      raise exception 'No open substitute need remains for this position.';
    end if;
  else
    if v_current_state not in ('temp_work', 'planned_temp_work') then
      raise exception 'Only substitute cells can be changed back to off from Agency.';
    end if;
  end if;

  v_note := public.agency_schedule_state_to_note(v_next_state);
  if v_has_schedule then
    update public.ob_schedules
    set
      position = nullif(public.employee_record_text(to_jsonb(v_employee), 'position', 'Position'), ''),
      note = v_note,
      operator = coalesce(v_employee.name, v_staff_id),
      updated_at = v_now
    where id = v_schedule.id;
  else
    insert into public.ob_schedules (staff_id, date, position, note, operator, created_at, updated_at)
    values (
      v_staff_id,
      v_template_date,
      nullif(public.employee_record_text(to_jsonb(v_employee), 'position', 'Position'), ''),
      v_note,
      coalesce(v_employee.name, v_staff_id),
      v_now,
      v_now
    );
  end if;

  perform public.insert_agency_audit_log(
    'agency_schedule_state_set',
    v_staff_id,
    jsonb_build_object(
      'agency', v_agency,
      'position', v_position,
      'work_date', v_work_date,
      'template_date', v_template_date,
      'from_state', v_current_state,
      'to_state', v_next_state,
      'reason', coalesce(p_reason, '')
    )
  );

  return jsonb_build_object(
    'staff_id', v_staff_id,
    'work_date', v_work_date,
    'template_date', v_template_date,
    'state', v_next_state
  );
end;
$$;
