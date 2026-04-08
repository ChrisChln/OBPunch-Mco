create or replace function public.apply_leave_request_decision(
  p_leave_request_id text,
  p_decision text,
  p_actor text default null,
  p_operational_date date default null,
  p_editable_start date default null,
  p_editable_end date default null,
  p_reviewed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_reviewed_at timestamptz := coalesce(p_reviewed_at, now());
  v_leave_row public.ob_leave_requests%rowtype;
  v_next_status text;
  v_is_past_leave_date boolean := false;
  v_template_offset int := 0;
  v_template_date date := null;
  v_template_date_text text := null;
  v_next_note text := null;
  v_schedule_action text := null;
  v_leave_audit_action text := null;
  v_existing_note text := null;
  v_existing_state text := 'work';
  v_saved_note text := null;
  v_should_apply_leave boolean := false;
  v_existing_excuse_state boolean := false;
  v_position text := null;
  v_weekday int := null;
  v_absent_count int := 0;
  v_excuse_count int := 0;
begin
  if nullif(btrim(coalesce(p_leave_request_id, '')), '') is null then
    raise exception 'Missing leave request id.';
  end if;
  if v_decision not in ('approved', 'rejected') then
    raise exception 'Unsupported leave decision: %', p_decision;
  end if;
  if p_operational_date is null or p_editable_start is null or p_editable_end is null then
    raise exception 'Leave decision window is required.';
  end if;

  if v_actor is null then
    v_actor := 'SYSTEM';
  end if;

  perform pg_advisory_xact_lock(284612, hashtext(format('leave:%s', p_leave_request_id)));

  select *
  into v_leave_row
  from public.ob_leave_requests
  where id::text = p_leave_request_id
  for update;

  if not found then
    raise exception 'Leave request % not found.', p_leave_request_id;
  end if;

  v_next_status := v_decision;

  if v_decision = 'approved' then
    if nullif(btrim(coalesce(v_leave_row.matched_staff_id, '')), '') is null then
      raise exception 'This leave request is unmatched.';
    end if;

    if v_leave_row.leave_date < p_editable_start then
      v_next_status := 'expired';
    elsif v_leave_row.leave_date > p_editable_end then
      raise exception 'Approval is only allowed for this week and next week (% to %).', p_editable_start, p_editable_end;
    else
      v_is_past_leave_date := v_leave_row.leave_date < p_operational_date;
      v_template_offset := v_leave_row.leave_date - p_editable_start;
      if v_template_offset < 0 or v_template_offset > 13 then
        raise exception 'Could not map leave date % into schedule bucket.', v_leave_row.leave_date;
      end if;

      v_template_date := date '2000-01-03' + v_template_offset;
      v_template_date_text := v_template_date::text;
      v_next_note := case when v_is_past_leave_date then '__leave__' else '__planned_leave__' end;
      v_schedule_action := case when v_is_past_leave_date then 'schedule_leave' else 'schedule_planned_leave' end;

      select
        coalesce(
          nullif(btrim(coalesce(to_jsonb(employee_row) ->> 'position', '')), ''),
          nullif(btrim(coalesce(to_jsonb(employee_row) ->> 'Position', '')), ''),
          nullif(btrim(coalesce(v_leave_row.position_raw, '')), ''),
          'Pick'
        )
      into v_position
      from public.ob_employees as employee_row
      where staff_id = v_leave_row.matched_staff_id
      limit 1;

      v_position := coalesce(v_position, nullif(btrim(coalesce(v_leave_row.position_raw, '')), ''), 'Pick');

      select s.note
      into v_existing_note
      from public.ob_schedules as s
      where s.staff_id = v_leave_row.matched_staff_id
        and s.date::text = v_template_date_text
      limit 1;

      v_existing_state := case
        when v_existing_note = '__fixed_work__' then 'fixed_work'
        when v_existing_note = '__temp_work__' then 'temp_work'
        when v_existing_note = '__leave__' then 'leave'
        when v_existing_note = '__temp_rest__' then 'temp_rest'
        when v_existing_note = '__planned_temp_work__' then 'planned_temp_work'
        when v_existing_note = '__planned_leave__' then 'planned_leave'
        when v_existing_note = '__planned_temp_rest__' then 'planned_temp_rest'
        when v_existing_note = '__rest__' then 'rest'
        else 'work'
      end;

      v_should_apply_leave := v_existing_state in ('work', 'fixed_work', 'temp_work', 'planned_temp_work');
      v_existing_excuse_state := v_existing_state in ('leave', 'planned_leave');

      if v_should_apply_leave then
        insert into public.ob_schedules (
          staff_id,
          date,
          position,
          note,
          operator,
          updated_at
        )
        values (
          v_leave_row.matched_staff_id,
          v_template_date,
          v_position,
          v_next_note,
          v_actor,
          v_reviewed_at
        )
        on conflict (staff_id, date) do update
        set
          position = excluded.position,
          note = excluded.note,
          operator = excluded.operator,
          updated_at = excluded.updated_at;

        if v_is_past_leave_date then
          delete from public.ob_attendance_marks
          where staff_id = v_leave_row.matched_staff_id
            and work_date = v_leave_row.leave_date
            and mark_type = 'absent';

          insert into public.ob_attendance_marks (
            staff_id,
            work_date,
            mark_type,
            source,
            operator,
            payload,
            updated_at
          )
          values (
            v_leave_row.matched_staff_id,
            v_leave_row.leave_date,
            'excuse',
            'leave_request',
            v_actor,
            jsonb_build_object(
              'leave_request_id', v_leave_row.id,
              'leave_type', v_leave_row.leave_type
            ),
            v_reviewed_at
          )
          on conflict (staff_id, work_date, mark_type) do update
          set
            source = excluded.source,
            operator = excluded.operator,
            payload = excluded.payload,
            updated_at = excluded.updated_at;
        end if;

        select s.note
        into v_saved_note
        from public.ob_schedules as s
        where s.staff_id = v_leave_row.matched_staff_id
          and s.date::text = v_template_date_text
        limit 1;

        if coalesce(v_saved_note, '') <> coalesce(v_next_note, '') then
          if v_is_past_leave_date then
            raise exception 'Schedule was not updated to leave. Approval was blocked.';
          end if;
          raise exception 'Schedule was not updated to planned leave. Approval was blocked.';
        end if;

        if v_is_past_leave_date then
          select count(*)
          into v_absent_count
          from public.ob_attendance_marks
          where staff_id = v_leave_row.matched_staff_id
            and work_date = v_leave_row.leave_date
            and mark_type = 'absent';
          if v_absent_count > 0 then
            raise exception 'Absent mark still exists after leave approval. Approval was blocked.';
          end if;

          select count(*)
          into v_excuse_count
          from public.ob_attendance_marks
          where staff_id = v_leave_row.matched_staff_id
            and work_date = v_leave_row.leave_date
            and mark_type = 'excuse';
          if v_excuse_count = 0 then
            raise exception 'Excuse mark was not created after leave approval. Approval was blocked.';
          end if;
        end if;

        v_weekday := extract(isodow from v_leave_row.leave_date);

        insert into public.ob_audit_logs (
          actor,
          action,
          staff_id,
          target,
          payload
        )
        values (
          v_actor,
          v_schedule_action,
          v_leave_row.matched_staff_id,
          'ob_schedules',
          jsonb_build_object(
            'template_date', v_template_date_text,
            'actual_date', v_leave_row.leave_date,
            'weekday', v_weekday,
            'state', case when v_is_past_leave_date then 'leave' else 'planned_leave' end,
            'to_state', case when v_is_past_leave_date then 'leave' else 'planned_leave' end,
            'from_state', v_existing_state,
            'position', v_position,
            'leave_request_id', v_leave_row.id,
            'leave_type', v_leave_row.leave_type
          )
        );
      else
        if v_is_past_leave_date and v_existing_excuse_state then
          select count(*)
          into v_excuse_count
          from public.ob_attendance_marks
          where staff_id = v_leave_row.matched_staff_id
            and work_date = v_leave_row.leave_date
            and mark_type = 'excuse';

          if v_excuse_count = 0 then
            insert into public.ob_attendance_marks (
              staff_id,
              work_date,
              mark_type,
              source,
              operator,
              payload,
              updated_at
            )
            values (
              v_leave_row.matched_staff_id,
              v_leave_row.leave_date,
              'excuse',
              'leave_request',
              v_actor,
              jsonb_build_object(
                'leave_request_id', v_leave_row.id,
                'leave_type', v_leave_row.leave_type
              ),
              v_reviewed_at
            )
            on conflict (staff_id, work_date, mark_type) do update
            set
              source = excluded.source,
              operator = excluded.operator,
              payload = excluded.payload,
              updated_at = excluded.updated_at;
          end if;
        end if;

        if v_is_past_leave_date and v_existing_state = 'leave' then
          delete from public.ob_attendance_marks
          where staff_id = v_leave_row.matched_staff_id
            and work_date = v_leave_row.leave_date
            and mark_type = 'absent';
        end if;
      end if;
    end if;
  end if;

  update public.ob_leave_requests
  set
    status = v_next_status,
    reviewed_by = v_actor,
    reviewed_at = v_reviewed_at,
    updated_at = v_reviewed_at
  where id::text = p_leave_request_id;

  v_leave_audit_action := case
    when v_next_status = 'approved' then 'leave_request_approve'
    when v_next_status = 'expired' then 'leave_request_expire'
    else 'leave_request_reject'
  end;

  insert into public.ob_audit_logs (
    actor,
    action,
    staff_id,
    target,
    payload
  )
  values (
    v_actor,
    v_leave_audit_action,
    nullif(btrim(coalesce(v_leave_row.matched_staff_id, '')), ''),
    'ob_leave_requests',
    jsonb_build_object(
      'leave_request_id', v_leave_row.id,
      'leave_date', v_leave_row.leave_date,
      'leave_type', v_leave_row.leave_type,
      'source', v_leave_row.source,
      'status', v_next_status
    )
  );

  return jsonb_build_object(
    'leave_request_id', v_leave_row.id::text,
    'next_status', v_next_status,
    'reviewed_by', v_actor,
    'reviewed_at', v_reviewed_at,
    'matched_staff_id', nullif(btrim(coalesce(v_leave_row.matched_staff_id, '')), ''),
    'template_date', v_template_date_text,
    'actual_date', v_leave_row.leave_date,
    'from_state', v_existing_state,
    'to_state', case when v_next_status in ('approved', 'expired') then case when v_is_past_leave_date then 'leave' else 'planned_leave' end else null end,
    'position', v_position,
    'schedule_action', v_schedule_action,
    'leave_action', v_leave_audit_action
  );
end;
$$;

revoke all on function public.apply_leave_request_decision(text, text, text, date, date, date, timestamptz) from public;
grant execute on function public.apply_leave_request_decision(text, text, text, date, date, date, timestamptz) to authenticated;
grant execute on function public.apply_leave_request_decision(text, text, text, date, date, date, timestamptz) to service_role;
