create or replace function public.agency_schedule_state_to_note(
  p_state text
)
returns text
language sql
immutable
as $$
  select case coalesce(btrim(lower(p_state)), '')
    when 'new' then '__new__'
    when 'fixed_work' then '__fixed_work__'
    when 'temp_work' then '__temp_work__'
    when 'leave' then '__leave__'
    when 'temp_rest' then '__temp_rest__'
    when 'planned_temp_work' then '__replacement__'
    when 'planned_leave' then '__planned_leave__'
    when 'planned_temp_rest' then '__planned_temp_rest__'
    when 'rest' then '__rest__'
    else null
  end;
$$;

create or replace function public.schedule_note_to_state(
  p_note text
)
returns text
language sql
immutable
as $$
  select case coalesce(btrim(p_note), '')
    when '__new__' then 'new'
    when '__fixed_work__' then 'fixed_work'
    when '__temp_work__' then 'temp_work'
    when '__leave__' then 'leave'
    when '__temp_rest__' then 'temp_rest'
    when '__replacement__' then 'planned_temp_work'
    when '__planned_temp_work__' then 'planned_temp_work'
    when '__planned_leave__' then 'planned_leave'
    when '__planned_temp_rest__' then 'planned_temp_rest'
    when '__rest__' then 'rest'
    else 'work'
  end;
$$;

create or replace function public.agency_get_schedule_week(
  p_work_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_work_date date := coalesce(p_work_date, (timezone('America/New_York', now()))::date);
  v_week_start date := v_work_date - (((extract(isodow from v_work_date)::int) + 6) % 7);
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_managed_agencies text[] := public.current_user_managed_agencies(v_user_id);
  v_week_dates jsonb := '[]'::jsonb;
  v_employees jsonb := '[]'::jsonb;
  v_new_hire_requests jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'view', v_user_id) then
    raise exception 'Forbidden.';
  end if;

  create temporary table if not exists tmp_agency_scope_employees (
    staff_id text primary key,
    name text not null,
    agency text not null,
    position text not null,
    shift text not null,
    start_time text not null,
    label text not null,
    terminated_at timestamptz null
  ) on commit drop;
  truncate tmp_agency_scope_employees;

  insert into tmp_agency_scope_employees (staff_id, name, agency, position, shift, start_time, label, terminated_at)
  select
    e.staff_id,
    coalesce(nullif(btrim(coalesce(e.name, '')), ''), e.staff_id),
    public.employee_record_text(to_jsonb(e), 'agency', 'Agency'),
    public.employee_record_text(to_jsonb(e), 'position', 'Position'),
    coalesce(nullif(btrim(coalesce(e.shift, '')), ''), ''),
    coalesce(nullif(btrim(public.employee_record_text(to_jsonb(e), 'shift_time', 'ShiftTime')), ''), ''),
    public.employee_record_text(to_jsonb(e), 'label', 'Label'),
    e.terminated_at
  from public.ob_employees as e
  where e.staff_id is not null
    and (
      (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
      or public.employee_record_text(to_jsonb(e), 'agency', 'Agency') = any(coalesce(v_managed_agencies, '{}'::text[]))
    );

  create temporary table if not exists tmp_agency_week_days (
    day_index int primary key,
    work_date date not null,
    template_date date not null
  ) on commit drop;
  truncate tmp_agency_week_days;

  insert into tmp_agency_week_days (day_index, work_date, template_date)
  select
    series.idx,
    (v_week_start + series.idx),
    public.agency_target_to_template_date(v_week_start + series.idx)
  from generate_series(0, 6) as series(idx);

  create temporary table if not exists tmp_agency_week_schedule_rows (
    staff_id text not null,
    work_date date not null,
    template_date date not null,
    state text not null,
    primary key (staff_id, work_date)
  ) on commit drop;
  truncate tmp_agency_week_schedule_rows;

  insert into tmp_agency_week_schedule_rows (staff_id, work_date, template_date, state)
  select distinct on (s.staff_id, day_row.work_date)
    s.staff_id,
    day_row.work_date,
    day_row.template_date,
    public.schedule_note_to_state(s.note)
  from tmp_agency_week_days as day_row
  join public.ob_schedules as s on s.date = day_row.template_date
  join tmp_agency_scope_employees as e on e.staff_id = s.staff_id
  order by s.staff_id, day_row.work_date, coalesce(s.updated_at, s.created_at) desc, s.id desc;

  create temporary table if not exists tmp_agency_pending_leave_requests (
    staff_id text not null,
    work_date date not null,
    primary key (staff_id, work_date)
  ) on commit drop;
  truncate tmp_agency_pending_leave_requests;

  insert into tmp_agency_pending_leave_requests (staff_id, work_date)
  select distinct
    request_row.matched_staff_id,
    request_row.leave_date
  from public.ob_leave_requests as request_row
  join tmp_agency_scope_employees as employee on employee.staff_id = request_row.matched_staff_id
  join tmp_agency_week_days as day_row on day_row.work_date = request_row.leave_date
  where request_row.source = 'agency_schedule'
    and request_row.status = 'pending'
    and nullif(btrim(coalesce(request_row.matched_staff_id, '')), '') is not null;

  create temporary table if not exists tmp_agency_week_fixed_counts (
    staff_id text primary key,
    fixed_work_count int not null
  ) on commit drop;
  truncate tmp_agency_week_fixed_counts;

  insert into tmp_agency_week_fixed_counts (staff_id, fixed_work_count)
  select
    employee.staff_id,
    coalesce((
      select count(*)::int
      from (
        select distinct on (schedule_row.date)
          schedule_row.date,
          public.schedule_note_to_state(schedule_row.note) as state
        from public.ob_schedules as schedule_row
        where schedule_row.staff_id = employee.staff_id
          and schedule_row.date between v_week_start and (v_week_start + 6)
        order by schedule_row.date, coalesce(schedule_row.updated_at, schedule_row.created_at) desc, schedule_row.id desc
      ) as latest_schedule_rows
      where latest_schedule_rows.state in ('new', 'work', 'fixed_work', 'temp_work', 'planned_temp_work')
    ), 0)
  from tmp_agency_scope_employees as employee;

  create temporary table if not exists tmp_agency_latest_termination_status (
    staff_id text primary key,
    status text null
  ) on commit drop;
  truncate tmp_agency_latest_termination_status;

  insert into tmp_agency_latest_termination_status (staff_id, status)
  select distinct on (request.staff_id)
    request.staff_id,
    request.status
  from public.ob_employee_termination_requests as request
  join tmp_agency_scope_employees as employee on employee.staff_id = request.staff_id
  order by request.staff_id, request.created_at desc, request.id desc;

  create temporary table if not exists tmp_agency_scope_day_slots (
    agency text not null,
    position text not null,
    shift text not null,
    work_date date not null,
    template_date date not null,
    open_slots int not null,
    primary key (agency, position, shift, work_date)
  ) on commit drop;
  truncate tmp_agency_scope_day_slots;

  insert into tmp_agency_scope_day_slots (agency, position, shift, work_date, template_date, open_slots)
  with scoped_day_groups as (
    select distinct
      employee.agency,
      employee.position,
      lower(coalesce(nullif(btrim(coalesce(employee.shift, '')), ''), '')) as shift,
      day_row.work_date,
      day_row.template_date
    from tmp_agency_scope_employees as employee
    join tmp_agency_week_days as day_row on true
    where employee.terminated_at is null
      and not exists (
        select 1
        from tmp_agency_week_days as generated_day
        where employee.staff_id ~ ('^' || to_char(generated_day.work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$')
      )
  ),
  leave_need as (
    select
      employee.agency,
      employee.position,
      lower(coalesce(nullif(btrim(coalesce(employee.shift, '')), ''), '')) as shift,
      day_row.work_date,
      day_row.template_date,
      count(*)::int as total
    from public.ob_leave_requests as request_row
    join tmp_agency_scope_employees as employee on employee.staff_id = request_row.matched_staff_id
    join tmp_agency_week_days as day_row on day_row.work_date = request_row.leave_date
    left join tmp_agency_week_schedule_rows as schedule_row
      on schedule_row.staff_id = employee.staff_id
     and schedule_row.work_date = day_row.work_date
    where request_row.source = 'agency_schedule'
      and request_row.status in ('pending', 'approved')
      and employee.terminated_at is null
      and (
        request_row.status = 'pending'
        or coalesce(schedule_row.state, 'rest') in ('leave', 'planned_leave')
      )
    group by
      employee.agency,
      employee.position,
      lower(coalesce(nullif(btrim(coalesce(employee.shift, '')), ''), '')),
      day_row.work_date,
      day_row.template_date
  ),
  substitute_cover as (
    select
      employee.agency,
      employee.position,
      lower(coalesce(nullif(btrim(coalesce(employee.shift, '')), ''), '')) as shift,
      schedule_row.work_date,
      schedule_row.template_date,
      count(*)::int as total
    from tmp_agency_scope_employees as employee
    join tmp_agency_week_schedule_rows as schedule_row on schedule_row.staff_id = employee.staff_id
    where employee.terminated_at is null
      and schedule_row.state in ('temp_work', 'planned_temp_work')
    group by
      employee.agency,
      employee.position,
      lower(coalesce(nullif(btrim(coalesce(employee.shift, '')), ''), '')),
      schedule_row.work_date,
      schedule_row.template_date
  ),
  new_hire_cover as (
    select
      employee.agency,
      employee.position,
      lower(coalesce(nullif(btrim(coalesce(employee.shift, '')), ''), '')) as shift,
      day_row.work_date,
      day_row.template_date,
      count(*)::int as total
    from tmp_agency_scope_employees as employee
    join tmp_agency_week_days as day_row
      on employee.staff_id ~ ('^' || to_char(day_row.work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$')
    where employee.terminated_at is null
    group by
      employee.agency,
      employee.position,
      lower(coalesce(nullif(btrim(coalesce(employee.shift, '')), ''), '')),
      day_row.work_date,
      day_row.template_date
  )
  select
    scoped_day_groups.agency,
    scoped_day_groups.position,
    scoped_day_groups.shift,
    scoped_day_groups.work_date,
    scoped_day_groups.template_date,
    greatest(
      coalesce(leave_need.total, 0)
        - coalesce(substitute_cover.total, 0)
        - coalesce(new_hire_cover.total, 0),
      0
    ) as open_slots
  from scoped_day_groups
  left join leave_need
    on leave_need.agency = scoped_day_groups.agency
   and leave_need.position = scoped_day_groups.position
   and leave_need.shift = scoped_day_groups.shift
   and leave_need.work_date = scoped_day_groups.work_date
   and leave_need.template_date = scoped_day_groups.template_date
  left join substitute_cover
    on substitute_cover.agency = scoped_day_groups.agency
   and substitute_cover.position = scoped_day_groups.position
   and substitute_cover.shift = scoped_day_groups.shift
   and substitute_cover.work_date = scoped_day_groups.work_date
   and substitute_cover.template_date = scoped_day_groups.template_date
  left join new_hire_cover
    on new_hire_cover.agency = scoped_day_groups.agency
   and new_hire_cover.position = scoped_day_groups.position
   and new_hire_cover.shift = scoped_day_groups.shift
   and new_hire_cover.work_date = scoped_day_groups.work_date
   and new_hire_cover.template_date = scoped_day_groups.template_date;

  select coalesce(jsonb_agg(to_jsonb(day_row.work_date) order by day_row.day_index), '[]'::jsonb)
  into v_week_dates
  from tmp_agency_week_days as day_row;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'staff_id', employee.staff_id,
        'name', employee.name,
        'agency', employee.agency,
        'position', employee.position,
        'shift', employee.shift,
        'start_time', employee.start_time,
        'label', employee.label,
        'fixed_work_count', coalesce(fixed_counts.fixed_work_count, 0),
        'termination_status', termination_row.status,
        'days',
          (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'work_date', day_row.work_date,
                  'template_date', day_row.template_date,
                  'base_state', coalesce(schedule_row.state, 'rest'),
                  'substitute_open_count', coalesce(slot_row.open_slots, 0),
                  'state',
                    case
                      when pending_leave.staff_id is not null then 'leave_pending'
                      else coalesce(schedule_row.state, 'rest')
                    end
                )
                order by day_row.day_index
              ),
              '[]'::jsonb
            )
            from tmp_agency_week_days as day_row
            left join tmp_agency_week_schedule_rows as schedule_row
              on schedule_row.staff_id = employee.staff_id
             and schedule_row.work_date = day_row.work_date
            left join tmp_agency_pending_leave_requests as pending_leave
              on pending_leave.staff_id = employee.staff_id
             and pending_leave.work_date = day_row.work_date
            left join tmp_agency_scope_day_slots as slot_row
              on slot_row.agency = employee.agency
             and slot_row.position = employee.position
             and slot_row.shift = lower(coalesce(nullif(btrim(coalesce(employee.shift, '')), ''), ''))
             and slot_row.work_date = day_row.work_date
          )
      )
      order by employee.position, employee.name, employee.staff_id
    ),
    '[]'::jsonb
  )
  into v_employees
  from tmp_agency_scope_employees as employee
  left join tmp_agency_week_fixed_counts as fixed_counts on fixed_counts.staff_id = employee.staff_id
  left join tmp_agency_latest_termination_status as termination_row on termination_row.staff_id = employee.staff_id
  where employee.terminated_at is null
    and not exists (
      select 1
      from tmp_agency_week_days as day_row
      where employee.staff_id ~ ('^' || to_char(day_row.work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$')
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'staff_id', employee.staff_id,
        'name', employee.name,
        'agency', employee.agency,
        'position', employee.position,
        'shift', employee.shift,
        'start_time', employee.start_time,
        'label', employee.label,
        'work_date', day_row.work_date,
        'can_delete',
          exists (
            select 1
            from public.ob_schedules as schedule_row
            where schedule_row.staff_id = employee.staff_id
              and schedule_row.date = day_row.template_date
              and coalesce(nullif(btrim(coalesce(schedule_row.operator, '')), ''), '') = 'agency_new_hire'
          )
      )
      order by day_row.day_index, employee.position, employee.staff_id
    ),
    '[]'::jsonb
  )
  into v_new_hire_requests
  from tmp_agency_scope_employees as employee
  join tmp_agency_week_days as day_row
    on employee.staff_id ~ ('^' || to_char(day_row.work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$')
  where employee.terminated_at is null;

  return jsonb_build_object(
    'week_dates', v_week_dates,
    'employees', v_employees,
    'new_hire_requests', v_new_hire_requests
  );
end;
$$;

create or replace function public.agency_assign_substitute(
  p_target_staff_id text,
  p_substitute_staff_id text,
  p_work_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_staff_id text := btrim(coalesce(p_target_staff_id, ''));
  v_substitute_staff_id text := btrim(coalesce(p_substitute_staff_id, ''));
  v_work_date date := p_work_date;
  v_template_date date := public.agency_target_to_template_date(v_work_date);
  v_now timestamptz := now();
  v_target public.ob_employees%rowtype;
  v_substitute public.ob_employees%rowtype;
  v_target_schedule public.ob_schedules%rowtype;
  v_substitute_schedule public.ob_schedules%rowtype;
  v_target_state text := '';
  v_substitute_state text := '';
  v_substitute_fixed_count int := 0;
  v_next_state text := '';
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_target_staff_id = '' or v_substitute_staff_id = '' or v_target_staff_id = v_substitute_staff_id or v_work_date is null or v_template_date is null then
    raise exception 'Invalid substitute request.';
  end if;
  if not public.agency_user_can_access_employee(v_target_staff_id, v_user_id) or not public.agency_user_can_access_employee(v_substitute_staff_id, v_user_id) then
    raise exception 'Employee is out of scope.';
  end if;

  select *
  into v_target
  from public.ob_employees
  where staff_id = v_target_staff_id
  limit 1;

  if not found then
    raise exception 'Target employee not found.';
  end if;

  select *
  into v_substitute
  from public.ob_employees
  where staff_id = v_substitute_staff_id
  limit 1;

  if not found then
    raise exception 'Substitute employee not found.';
  end if;

  if public.employee_record_text(to_jsonb(v_target), 'position', 'Position') <> public.employee_record_text(to_jsonb(v_substitute), 'position', 'Position') then
    raise exception 'Substitute must have the same position.';
  end if;

  select *
  into v_target_schedule
  from public.ob_schedules
  where staff_id = v_target_staff_id
    and date = v_template_date
  order by coalesce(updated_at, created_at) desc, id desc
  limit 1;

  select *
  into v_substitute_schedule
  from public.ob_schedules
  where staff_id = v_substitute_staff_id
    and date = v_template_date
  order by coalesce(updated_at, created_at) desc, id desc
  limit 1;

  v_target_state := case when v_target_schedule.id is null then 'rest' else public.schedule_note_to_state(v_target_schedule.note) end;
  v_substitute_state := case when v_substitute_schedule.id is null then 'rest' else public.schedule_note_to_state(v_substitute_schedule.note) end;

  if v_target_state not in ('leave', 'planned_leave') then
    raise exception 'Target employee must already be on leave or planned leave.';
  end if;
  if v_substitute_state in ('work', 'fixed_work', 'temp_work') then
    raise exception 'Substitute already has working schedule today.';
  end if;

  select count(*)
  into v_substitute_fixed_count
  from (
    select distinct on (s.date)
      s.date,
      public.schedule_note_to_state(s.note) as state
    from public.ob_schedules as s
    where s.staff_id = v_substitute_staff_id
      and s.date between (v_template_date - (((extract(isodow from v_template_date)::int) + 6) % 7))
                     and ((v_template_date - (((extract(isodow from v_template_date)::int) + 6) % 7)) + 6)
    order by s.date, coalesce(s.updated_at, s.created_at) desc, s.id desc
  ) as latest_schedule_rows
  where latest_schedule_rows.state in ('work', 'fixed_work', 'temp_work', 'planned_temp_work');

  if v_substitute_fixed_count >= 5 then
    raise exception 'Substitute weekly work count has reached the limit.';
  end if;

  v_next_state := case
    when v_work_date = (timezone('America/New_York', v_now))::date then 'temp_work'
    else 'planned_temp_work'
  end;

  if v_substitute_schedule.id is not null then
    update public.ob_schedules
    set
      note = public.agency_schedule_state_to_note(v_next_state),
      operator = coalesce(v_substitute.name, v_substitute_staff_id),
      updated_at = v_now
    where id = v_substitute_schedule.id;
  else
    insert into public.ob_schedules (staff_id, date, position, note, operator, created_at, updated_at)
    values (
      v_substitute_staff_id,
      v_template_date,
      nullif(public.employee_record_text(to_jsonb(v_substitute), 'position', 'Position'), ''),
      public.agency_schedule_state_to_note(v_next_state),
      coalesce(v_substitute.name, v_substitute_staff_id),
      v_now,
      v_now
    );
  end if;

  perform public.insert_agency_audit_log(
    'agency_substitute_assign',
    v_target_staff_id,
    jsonb_build_object(
      'agency', public.employee_record_text(to_jsonb(v_target), 'agency', 'Agency'),
      'work_date', v_work_date,
      'template_date', v_template_date,
      'target_staff_id', v_target_staff_id,
      'substitute_staff_id', v_substitute_staff_id,
      'state', v_next_state
    )
  );

  return jsonb_build_object(
    'target_staff_id', v_target_staff_id,
    'substitute_staff_id', v_substitute_staff_id,
    'work_date', v_work_date,
    'template_date', v_template_date,
    'state', v_next_state
  );
end;
$$;

create or replace function public.agency_upsert_new_hire_demand(
  p_staff_id text default null,
  p_work_date date default null,
  p_position text default null,
  p_shift text default null,
  p_agency text default null,
  p_label text default '',
  p_entry_time text default '',
  p_note text default '',
  p_count int default 1,
  p_employee_name text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_id text := nullif(btrim(coalesce(p_staff_id, '')), '');
  v_work_date date := coalesce(p_work_date, (timezone('America/New_York', now()))::date);
  v_template_date date := public.agency_target_to_template_date(v_work_date);
  v_position text := btrim(coalesce(p_position, ''));
  v_shift text := lower(btrim(coalesce(p_shift, '')));
  v_agency text := btrim(coalesce(p_agency, ''));
  v_employee_name text := btrim(coalesce(p_employee_name, ''));
  v_label text := btrim(coalesce(p_label, ''));
  v_entry_time text := btrim(coalesce(p_entry_time, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_count int := greatest(1, least(coalesce(p_count, 1), 200));
  v_now timestamptz := now();
  v_next_seq int := 1;
  v_open_substitute_slots int := 0;
  v_created_ids text[] := '{}'::text[];
  v_existing public.ob_employees%rowtype;
  v_agency_col text := null;
  v_position_col text := null;
  v_label_col text := null;
  v_shift_time_col text := null;
  v_existing_agency text := '';
  v_existing_position text := '';
  v_existing_shift text := '';
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_template_date is null then
    raise exception 'Invalid work date.';
  end if;
  if v_position = '' or v_shift not in ('early', 'late') or v_agency = '' then
    raise exception 'Position, shift, and agency are required.';
  end if;

  select c.column_name
  into v_agency_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'agency'
  order by case when c.column_name = 'agency' then 0 else 1 end
  limit 1;

  select c.column_name
  into v_position_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'position'
  order by case when c.column_name = 'position' then 0 else 1 end
  limit 1;

  select c.column_name
  into v_label_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'label'
  order by case when c.column_name = 'label' then 0 else 1 end
  limit 1;

  select c.column_name
  into v_shift_time_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'shift_time'
  order by case when c.column_name = 'shift_time' then 0 else 1 end
  limit 1;

  if v_agency_col is null or v_position_col is null or v_label_col is null or v_shift_time_col is null then
    raise exception 'Agency/Position/Label/Shift time columns were not found on ob_employees.';
  end if;

  if v_staff_id is not null then
    if not public.agency_user_can_access_employee(v_staff_id, v_user_id) then
      raise exception 'Employee is out of scope.';
    end if;
    if v_staff_id !~ ('^' || to_char(v_work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$') then
      raise exception 'Only NEW rows created in Agency can be edited here.';
    end if;
    if not exists (
      select 1
      from public.ob_schedules as schedule_row
      where schedule_row.staff_id = v_staff_id
        and schedule_row.date = v_template_date
        and coalesce(nullif(btrim(coalesce(schedule_row.operator, '')), ''), '') = 'agency_new_hire'
    ) then
      raise exception 'Only NEW rows created in Agency can be edited here.';
    end if;

    select *
    into v_existing
    from public.ob_employees
    where staff_id = v_staff_id
    limit 1;

    if not found then
      raise exception 'Demand row not found.';
    end if;
    if v_existing.terminated_at is not null then
      raise exception 'Demand row not found.';
    end if;

    v_existing_agency := public.employee_record_text(to_jsonb(v_existing), 'agency', 'Agency');
    v_existing_position := public.employee_record_text(to_jsonb(v_existing), 'position', 'Position');
    v_existing_shift := lower(coalesce(nullif(btrim(coalesce(v_existing.shift, '')), ''), ''));

    if v_existing_agency <> v_agency or v_existing_position <> v_position or v_existing_shift <> v_shift then
      select public.agency_open_substitute_slots(v_agency, v_position, v_shift, v_work_date, v_template_date)
      into v_open_substitute_slots;

      if coalesce(v_open_substitute_slots, 0) <= 0 then
        raise exception 'No open substitute need remains for this position.';
      end if;
    end if;

    execute format(
      'update public.ob_employees
       set
         name = coalesce(nullif($1, ''''), name),
         %1$I = $2,
         %2$I = $3,
         shift = $4,
         %3$I = nullif($5, ''''),
         %4$I = nullif($6, '''')
       where staff_id = $7',
      v_agency_col,
      v_position_col,
      v_label_col,
      v_shift_time_col
    )
    using
      coalesce(nullif(v_employee_name, ''), v_note),
      v_agency,
      v_position,
      v_shift,
      v_label,
      v_entry_time,
      v_staff_id;

    update public.ob_schedules
    set
      position = v_position,
      updated_at = v_now
    where staff_id = v_staff_id
      and date = v_template_date;

    perform public.insert_agency_audit_log(
      'agency_new_hire_update',
      v_staff_id,
      jsonb_build_object(
        'agency', v_agency,
        'work_date', v_work_date,
        'template_date', v_template_date,
        'position', v_position,
        'shift', v_shift,
        'label', v_label,
        'entry_time', v_entry_time,
        'note', v_note
      )
    );

    return jsonb_build_object(
      'staff_ids', jsonb_build_array(v_staff_id),
      'mode', 'update'
    );
  end if;

  select public.agency_open_substitute_slots(v_agency, v_position, v_shift, v_work_date, v_template_date)
  into v_open_substitute_slots;

  if coalesce(v_open_substitute_slots, 0) <= 0 then
    raise exception 'No open substitute need remains for this position.';
  end if;
  if v_count > v_open_substitute_slots then
    raise exception 'Requested new-hire count exceeds the open substitute need.';
  end if;

  select coalesce(max(substring(e.staff_id from '([0-9]{3,})$')::int), 0) + 1
  into v_next_seq
  from public.ob_employees as e
  where e.staff_id like to_char(v_work_date, 'MMDD') || upper(v_position) || '%';

  for i in 0..(v_count - 1) loop
    v_staff_id := to_char(v_work_date, 'MMDD') || upper(v_position) || lpad((v_next_seq + i)::text, 3, '0');

    execute format(
      'insert into public.ob_employees (
         staff_id,
         name,
         %1$I,
         %2$I,
         shift,
         %3$I,
         %4$I,
         created_at
       )
       values ($1, $2, $3, $4, $5, nullif($6, ''''), nullif($7, ''''), $8)
       on conflict (staff_id) do update
       set
         name = excluded.name,
         %1$I = excluded.%1$I,
         %2$I = excluded.%2$I,
         shift = excluded.shift,
         %3$I = excluded.%3$I,
         %4$I = excluded.%4$I',
      v_agency_col,
      v_position_col,
      v_label_col,
      v_shift_time_col
    )
    using
      v_staff_id,
      coalesce(nullif(v_employee_name, ''), 'New Request'),
      v_agency,
      v_position,
      v_shift,
      v_label,
      v_entry_time,
      v_now;

    insert into public.ob_schedules (staff_id, date, position, note, operator, created_at, updated_at)
    values (
      v_staff_id,
      v_template_date,
      v_position,
      '__new__',
      'agency_new_hire',
      v_now,
      v_now
    )
    on conflict (staff_id, date) do update
    set
      position = excluded.position,
      note = excluded.note,
      updated_at = excluded.updated_at;

    v_created_ids := array_append(v_created_ids, v_staff_id);
  end loop;

  perform public.insert_agency_audit_log(
    'agency_new_hire_create',
    null,
    jsonb_build_object(
      'agency', v_agency,
      'work_date', v_work_date,
      'template_date', v_template_date,
      'position', v_position,
      'shift', v_shift,
      'label', v_label,
      'entry_time', v_entry_time,
      'note', v_note,
      'count', v_count,
      'staff_ids', to_jsonb(v_created_ids)
    )
  );

  return jsonb_build_object(
    'staff_ids', to_jsonb(v_created_ids),
    'mode', 'create'
  );
end;
$$;

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
    select public.agency_open_substitute_slots(v_agency, v_position, v_shift, v_work_date, v_template_date)
    into v_open_substitute_slots;

    if coalesce(v_open_substitute_slots, 0) <= 0 then
      raise exception 'Replacement coverage already fills this open need.';
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
    from (
      select distinct on (s.date)
        s.date,
        public.schedule_note_to_state(s.note) as state
      from public.ob_schedules as s
      where s.staff_id = v_staff_id
        and s.date between (v_work_date - (((extract(isodow from v_work_date)::int) + 6) % 7))
                       and ((v_work_date - (((extract(isodow from v_work_date)::int) + 6) % 7)) + 6)
      order by s.date, coalesce(s.updated_at, s.created_at) desc, s.id desc
    ) as latest_schedule_rows
    where latest_schedule_rows.state in ('new', 'work', 'fixed_work', 'temp_work', 'planned_temp_work');

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
