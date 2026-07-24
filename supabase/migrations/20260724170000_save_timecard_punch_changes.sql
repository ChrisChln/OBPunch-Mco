create or replace function public.save_timecard_punch_changes(
  p_staff_id text,
  p_work_date date,
  p_edits jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb,
  p_delete_ids jsonb default '[]'::jsonb,
  p_operator text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff_id text := upper(btrim(coalesce(p_staff_id, '')));
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_operator text;
  v_item jsonb;
  v_id text;
  v_action text;
  v_created_at timestamptz;
  v_existing record;
  v_seen_ids text[] := array[]::text[];
  v_edited_count integer := 0;
  v_added_count integer := 0;
  v_deleted_count integer := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if v_staff_id = '' then
    raise exception 'Staff ID is required.';
  end if;
  if p_work_date is null then
    raise exception 'Work date is required.';
  end if;

  if not public.user_can_access_staff_position('timecard', v_staff_id, 'operate') then
    raise exception 'No operation access for this employee position.'
      using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_edits, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_additions, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_delete_ids, '[]'::jsonb)) <> 'array'
  then
    raise exception 'Punch changes must be JSON arrays.';
  end if;

  v_range_start :=
    (p_work_date::timestamp without time zone + interval '5 hours')
    at time zone 'America/New_York';
  v_range_end :=
    ((p_work_date + 1)::timestamp without time zone + interval '5 hours')
    at time zone 'America/New_York';
  v_operator := coalesce(
    nullif(btrim(auth.jwt() ->> 'email'), ''),
    nullif(btrim(coalesce(p_operator, '')), '')
  );

  -- Validate and lock every persisted target before applying any mutation.
  for v_item in
    select value from jsonb_array_elements(coalesce(p_edits, '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each punch edit must be an object.';
    end if;
    v_id := btrim(coalesce(v_item ->> 'id', ''));
    if v_id = '' then
      raise exception 'Punch edit ID is required.';
    end if;
    if v_id = any(v_seen_ids) then
      raise exception 'Duplicate punch record ID: %', v_id;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_id);

    select
      p.id::text as id_text,
      p.staff_id,
      upper(btrim(p.action)) as action,
      p.created_at
    into v_existing
    from public.ob_punches as p
    where p.id::text = v_id
    for update;
    if not found then
      raise exception 'Punch record not found: %', v_id;
    end if;
    if upper(btrim(coalesce(v_existing.staff_id, ''))) <> v_staff_id then
      raise exception 'Punch record belongs to another employee: %', v_id;
    end if;

    v_action := upper(btrim(coalesce(v_item ->> 'action', '')));
    if v_action not in ('IN', 'OUT') then
      raise exception 'Punch action must be IN or OUT.';
    end if;
    if nullif(btrim(coalesce(v_item ->> 'created_at', '')), '') is null then
      raise exception 'Invalid punch timestamp.';
    end if;
    begin
      v_created_at := (v_item ->> 'created_at')::timestamptz;
    exception
      when others then
        raise exception 'Invalid punch timestamp.';
    end;
    if v_created_at is null then
      raise exception 'Invalid punch timestamp.';
    end if;
    if v_created_at < v_range_start
      or v_created_at > v_range_end
      or (v_created_at = v_range_end and v_action <> 'OUT')
    then
      raise exception 'Punch timestamp is outside the operational day.';
    end if;
    if v_existing.action = v_action
      and v_existing.created_at = v_created_at
    then
      raise exception 'Punch edit does not change the record: %', v_id;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delete_ids, '[]'::jsonb))
  loop
    v_id := btrim(coalesce(v_item #>> '{}', ''));
    if v_id = '' then
      raise exception 'Punch delete ID is required.';
    end if;
    if v_id = any(v_seen_ids) then
      raise exception 'Duplicate punch record ID: %', v_id;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_id);

    select
      p.id::text as id_text,
      p.staff_id,
      upper(btrim(p.action)) as action,
      p.created_at
    into v_existing
    from public.ob_punches as p
    where p.id::text = v_id
    for update;
    if not found then
      raise exception 'Punch record not found: %', v_id;
    end if;
    if upper(btrim(coalesce(v_existing.staff_id, ''))) <> v_staff_id then
      raise exception 'Punch record belongs to another employee: %', v_id;
    end if;
    if v_existing.created_at is null
      or v_existing.created_at < v_range_start
      or v_existing.created_at > v_range_end
      or (v_existing.created_at = v_range_end and v_existing.action <> 'OUT')
    then
      raise exception 'Punch record is outside the operational day: %', v_id;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_additions, '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each punch addition must be an object.';
    end if;
    v_action := upper(btrim(coalesce(v_item ->> 'action', '')));
    if v_action not in ('IN', 'OUT') then
      raise exception 'Punch action must be IN or OUT.';
    end if;
    if nullif(btrim(coalesce(v_item ->> 'created_at', '')), '') is null then
      raise exception 'Invalid punch timestamp.';
    end if;
    begin
      v_created_at := (v_item ->> 'created_at')::timestamptz;
    exception
      when others then
        raise exception 'Invalid punch timestamp.';
    end;
    if v_created_at is null then
      raise exception 'Invalid punch timestamp.';
    end if;
    if v_created_at < v_range_start
      or v_created_at > v_range_end
      or (v_created_at = v_range_end and v_action <> 'OUT')
    then
      raise exception 'Punch timestamp is outside the operational day.';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_edits, '[]'::jsonb))
  loop
    v_id := btrim(v_item ->> 'id');
    v_action := upper(btrim(v_item ->> 'action'));
    v_created_at := (v_item ->> 'created_at')::timestamptz;

    update public.ob_punches
    set
      action = v_action,
      created_at = v_created_at,
      device = 'admin_console',
      source = 'manual_edit',
      operator = v_operator,
      note = 'manual_edit:' || clock_timestamp()::text
    where id::text = v_id
      and upper(btrim(coalesce(staff_id, ''))) = v_staff_id;
    if not found then
      raise exception 'Punch record was not updated: %', v_id;
    end if;
    v_edited_count := v_edited_count + 1;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_additions, '[]'::jsonb))
  loop
    v_action := upper(btrim(v_item ->> 'action'));
    v_created_at := (v_item ->> 'created_at')::timestamptz;

    insert into public.ob_punches (
      staff_id,
      action,
      created_at,
      device,
      source,
      operator,
      note
    )
    values (
      v_staff_id,
      v_action,
      v_created_at,
      'admin_console',
      'manual_add',
      v_operator,
      'manual_add'
    );
    v_added_count := v_added_count + 1;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_delete_ids, '[]'::jsonb))
  loop
    v_id := btrim(v_item #>> '{}');
    delete from public.ob_punches
    where id::text = v_id
      and upper(btrim(coalesce(staff_id, ''))) = v_staff_id;
    if not found then
      raise exception 'Punch record was not deleted: %', v_id;
    end if;
    v_deleted_count := v_deleted_count + 1;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id::text,
        'staff_id', upper(btrim(p.staff_id)),
        'action', upper(btrim(p.action)),
        'created_at', p.created_at
      )
      order by p.created_at, p.id
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.ob_punches as p
  where upper(btrim(coalesce(p.staff_id, ''))) = v_staff_id
    and (
      (p.created_at >= v_range_start and p.created_at < v_range_end)
      or (
        upper(btrim(coalesce(p.action, ''))) = 'OUT'
        and p.created_at = v_range_end
      )
    );

  return jsonb_build_object(
    'rows', v_rows,
    'edited_count', v_edited_count,
    'added_count', v_added_count,
    'deleted_count', v_deleted_count
  );
end;
$$;

revoke all on function public.save_timecard_punch_changes(text, date, jsonb, jsonb, jsonb, text) from public;
revoke all on function public.save_timecard_punch_changes(text, date, jsonb, jsonb, jsonb, text) from anon;
grant execute on function public.save_timecard_punch_changes(text, date, jsonb, jsonb, jsonb, text) to authenticated;
