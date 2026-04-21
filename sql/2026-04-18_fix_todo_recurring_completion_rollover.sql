create or replace function public.todo_build_due_at_for_instance(
  p_template_due_at timestamptz,
  p_instance_date date
)
returns timestamptz
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_template_due_at is null or p_instance_date is null then null
    else make_timestamptz(
      extract(year from p_instance_date)::int,
      extract(month from p_instance_date)::int,
      extract(day from p_instance_date)::int,
      extract(hour from timezone('America/New_York', p_template_due_at))::int,
      extract(minute from timezone('America/New_York', p_template_due_at))::int,
      extract(second from date_trunc('second', timezone('America/New_York', p_template_due_at))),
      'America/New_York'
    )
  end;
$$;

create or replace function public.todo_matches_recurrence_date(
  p_anchor_instance_date date,
  p_recurrence_kind text,
  p_recurrence_rule jsonb,
  p_candidate_date date
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_kind text := lower(btrim(coalesce(p_recurrence_kind, 'none')));
  v_interval_days int := greatest(1, coalesce((p_recurrence_rule ->> 'interval_days')::int, 1));
  v_candidate_weekday int := extract(isodow from p_candidate_date)::int;
  v_candidate_day int := extract(day from p_candidate_date)::int;
  v_month_start date := date_trunc('month', p_candidate_date::timestamp)::date;
  v_month_end date := (date_trunc('month', p_candidate_date::timestamp) + interval '1 month - 1 day')::date;
  v_cursor date;
  v_seen int;
  v_week_entry record;
begin
  if p_anchor_instance_date is null or p_candidate_date is null then
    return false;
  end if;
  if p_candidate_date < p_anchor_instance_date then
    return false;
  end if;

  if v_kind = 'none' then
    return p_candidate_date = p_anchor_instance_date;
  end if;

  if v_kind = 'daily' then
    return mod((p_candidate_date - p_anchor_instance_date), v_interval_days) = 0;
  end if;

  if v_kind = 'weekly' then
    return exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_recurrence_rule -> 'weekdays', '[]'::jsonb)) as weekday_value(value)
      where weekday_value.value ~ '^\d+$'
        and weekday_value.value::int = v_candidate_weekday
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(coalesce(p_recurrence_rule -> 'month_days', '[]'::jsonb)) as month_day_value(value)
    where month_day_value.value ~ '^\d+$'
      and month_day_value.value::int = v_candidate_day
  ) then
    return true;
  end if;

  for v_week_entry in
    select
      row_data.week,
      row_data.weekday
    from jsonb_to_recordset(coalesce(p_recurrence_rule -> 'nth_weekdays', '[]'::jsonb)) as row_data(
      week int,
      weekday int
    )
    where row_data.week in (-1, 1, 2, 3, 4)
      and row_data.weekday between 1 and 7
  loop
    if v_week_entry.week = -1 then
      v_cursor := v_month_end;
      while v_cursor >= v_month_start loop
        if extract(isodow from v_cursor)::int = v_week_entry.weekday then
          exit;
        end if;
        v_cursor := v_cursor - 1;
      end loop;
      if v_cursor = p_candidate_date then
        return true;
      end if;
    else
      v_cursor := v_month_start;
      v_seen := 0;
      while v_cursor <= v_month_end loop
        if extract(isodow from v_cursor)::int = v_week_entry.weekday then
          v_seen := v_seen + 1;
          if v_seen = v_week_entry.week then
            if v_cursor = p_candidate_date then
              return true;
            end if;
            exit;
          end if;
        end if;
        v_cursor := v_cursor + 1;
      end loop;
    end if;
  end loop;

  return false;
end;
$$;

create or replace function public.todo_next_occurrence_date(
  p_anchor_instance_date date,
  p_recurrence_kind text,
  p_recurrence_rule jsonb,
  p_after_instance_date date
)
returns date
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_kind text := lower(btrim(coalesce(p_recurrence_kind, 'none')));
  v_cursor date;
  v_guard int := 0;
begin
  if p_anchor_instance_date is null or p_after_instance_date is null then
    return null;
  end if;
  if v_kind = 'none' then
    return null;
  end if;

  v_cursor := p_after_instance_date + 1;
  while v_guard < 5000 loop
    if public.todo_matches_recurrence_date(
      p_anchor_instance_date,
      v_kind,
      coalesce(p_recurrence_rule, '{}'::jsonb),
      v_cursor
    ) then
      return v_cursor;
    end if;
    v_cursor := v_cursor + 1;
    v_guard := v_guard + 1;
  end loop;

  return null;
end;
$$;

create or replace function public.apply_todo_item_action(
  p_item_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_label text := '';
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_item public.ob_todo_items%rowtype;
  v_template public.ob_todo_templates%rowtype;
  v_is_creator boolean := false;
  v_is_assignee boolean := false;
  v_next_status text := null;
  v_now timestamptz := now();
  v_current_instance_date date := null;
  v_next_instance_date date := null;
  v_spawned_next_item_id uuid := null;
  v_spawned_next_item_ids uuid[] := array[]::uuid[];
  assignee_row record;
begin
  if v_actor_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_action not in ('mark_done', 'mark_open', 'request_delete', 'approve_delete', 'reject_delete') then
    raise exception 'Unsupported todo action: %', p_action;
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_actor_user_id::text
  )
  into v_actor_label
  from public.todo_resolve_user_identity(v_actor_user_id) as identity_row
  limit 1;

  select *
  into v_item
  from public.ob_todo_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'Todo item not found.';
  end if;
  if v_item.status = 'deleted' then
    raise exception 'Deleted task can no longer be modified.';
  end if;

  v_is_creator := v_item.creator_user_id = v_actor_user_id;
  select exists (
    select 1
    from public.ob_todo_item_assignees
    where item_id = p_item_id
      and assignee_user_id = v_actor_user_id
  ) into v_is_assignee;

  if v_action in ('mark_done', 'mark_open') and not v_is_assignee then
    raise exception 'Only assignees can change completion status.';
  end if;
  if v_action = 'request_delete' and not (v_is_creator or v_is_assignee) then
    raise exception 'Only participants can request deletion.';
  end if;
  if v_action in ('approve_delete', 'reject_delete') and not v_is_creator then
    raise exception 'Only the creator can confirm deletion.';
  end if;

  if v_action = 'mark_done' then
    v_next_status := 'done';
    update public.ob_todo_items
    set
      status = 'done',
      completed_at = v_now,
      completed_by_user_id = v_actor_user_id,
      completed_by_display = v_actor_label,
      updated_at = v_now
    where id = p_item_id;

    select *
    into v_template
    from public.ob_todo_templates
    where id = v_item.template_id;

    v_current_instance_date := coalesce(v_item.instance_date, v_template.anchor_instance_date);

    if found
      and v_template.is_active
      and v_template.recurrence_kind <> 'none'
      and v_template.anchor_instance_date is not null
      and v_current_instance_date is not null then
      v_next_instance_date := public.todo_next_occurrence_date(
        v_template.anchor_instance_date,
        v_template.recurrence_kind,
        v_template.recurrence_rule,
        v_current_instance_date
      );

      if v_next_instance_date is not null then
        if v_template.delivery_mode = 'shared' then
          begin
            insert into public.ob_todo_items (
              template_id,
              series_key,
              delivery_key,
              instance_date,
              delivery_mode,
              title,
              content,
              due_at,
              creator_user_id,
              creator_email,
              creator_display_name,
              status,
              created_at,
              updated_at
            )
            values (
              v_template.id,
              v_template.id::text,
              'shared',
              v_next_instance_date,
              v_template.delivery_mode,
              v_template.title,
              v_template.content,
              public.todo_build_due_at_for_instance(v_template.due_at, v_next_instance_date),
              v_template.creator_user_id,
              v_template.creator_email,
              v_template.creator_display_name,
              'open',
              v_now,
              v_now
            )
            returning id into v_spawned_next_item_id;
          exception
            when unique_violation then
              v_spawned_next_item_id := null;
          end;

          if v_spawned_next_item_id is not null then
            v_spawned_next_item_ids := array_append(v_spawned_next_item_ids, v_spawned_next_item_id);

            insert into public.ob_todo_item_assignees (
              item_id,
              assignee_user_id,
              assignee_email,
              assignee_display_name,
              created_at
            )
            select
              v_spawned_next_item_id,
              row_data.user_id,
              coalesce(nullif(btrim(coalesce(row_data.user_email, '')), ''), ''),
              coalesce(
                nullif(btrim(coalesce(row_data.display_name, '')), ''),
                nullif(btrim(coalesce(row_data.user_email, '')), ''),
                row_data.user_id::text
              ),
              v_now
            from jsonb_to_recordset(coalesce(v_template.assignees, '[]'::jsonb)) as row_data(
              user_id uuid,
              user_email text,
              display_name text
            )
            where row_data.user_id is not null;

            insert into public.ob_todo_item_links (
              item_id,
              label,
              url,
              sort_order,
              created_at,
              updated_at
            )
            select
              v_spawned_next_item_id,
              prepared.label,
              prepared.url,
              prepared.normalized_sort_order,
              v_now,
              v_now
            from (
              select
                btrim(coalesce(row_data.label, '')) as label,
                btrim(coalesce(row_data.url, '')) as url,
                row_number() over (
                  order by coalesce(row_data.sort_order, 0), btrim(coalesce(row_data.label, '')), btrim(coalesce(row_data.url, ''))
                ) - 1 as normalized_sort_order
              from jsonb_to_recordset(coalesce(v_template.links, '[]'::jsonb)) as row_data(
                label text,
                url text,
                sort_order int
              )
              where btrim(coalesce(row_data.label, '')) <> ''
                and btrim(coalesce(row_data.url, '')) <> ''
            ) as prepared;
          end if;
        else
          for assignee_row in
            select distinct
              row_data.user_id,
              coalesce(nullif(btrim(coalesce(row_data.user_email, '')), ''), '') as user_email,
              coalesce(
                nullif(btrim(coalesce(row_data.display_name, '')), ''),
                nullif(btrim(coalesce(row_data.user_email, '')), ''),
                row_data.user_id::text
              ) as display_name
            from jsonb_to_recordset(coalesce(v_template.assignees, '[]'::jsonb)) as row_data(
              user_id uuid,
              user_email text,
              display_name text
            )
            where row_data.user_id is not null
            order by
              coalesce(
                nullif(btrim(coalesce(row_data.display_name, '')), ''),
                nullif(btrim(coalesce(row_data.user_email, '')), ''),
                row_data.user_id::text
              ),
              coalesce(nullif(btrim(coalesce(row_data.user_email, '')), ''), ''),
              row_data.user_id::text
          loop
            v_spawned_next_item_id := null;

            begin
              insert into public.ob_todo_items (
                template_id,
                series_key,
                delivery_key,
                instance_date,
                delivery_mode,
                title,
                content,
                due_at,
                creator_user_id,
                creator_email,
                creator_display_name,
                status,
                created_at,
                updated_at
              )
              values (
                v_template.id,
                v_template.id::text,
                assignee_row.user_id::text,
                v_next_instance_date,
                v_template.delivery_mode,
                v_template.title,
                v_template.content,
                public.todo_build_due_at_for_instance(v_template.due_at, v_next_instance_date),
                v_template.creator_user_id,
                v_template.creator_email,
                v_template.creator_display_name,
                'open',
                v_now,
                v_now
              )
              returning id into v_spawned_next_item_id;
            exception
              when unique_violation then
                v_spawned_next_item_id := null;
            end;

            if v_spawned_next_item_id is null then
              continue;
            end if;

            v_spawned_next_item_ids := array_append(v_spawned_next_item_ids, v_spawned_next_item_id);

            insert into public.ob_todo_item_assignees (
              item_id,
              assignee_user_id,
              assignee_email,
              assignee_display_name,
              created_at
            )
            values (
              v_spawned_next_item_id,
              assignee_row.user_id,
              assignee_row.user_email,
              assignee_row.display_name,
              v_now
            );

            insert into public.ob_todo_item_links (
              item_id,
              label,
              url,
              sort_order,
              created_at,
              updated_at
            )
            select
              v_spawned_next_item_id,
              prepared.label,
              prepared.url,
              prepared.normalized_sort_order,
              v_now,
              v_now
            from (
              select
                btrim(coalesce(row_data.label, '')) as label,
                btrim(coalesce(row_data.url, '')) as url,
                row_number() over (
                  order by coalesce(row_data.sort_order, 0), btrim(coalesce(row_data.label, '')), btrim(coalesce(row_data.url, ''))
                ) - 1 as normalized_sort_order
              from jsonb_to_recordset(coalesce(v_template.links, '[]'::jsonb)) as row_data(
                label text,
                url text,
                sort_order int
              )
              where btrim(coalesce(row_data.label, '')) <> ''
                and btrim(coalesce(row_data.url, '')) <> ''
            ) as prepared;
          end loop;
        end if;
      end if;
    end if;
  elsif v_action = 'mark_open' then
    v_next_status := 'open';
    update public.ob_todo_items
    set
      status = 'open',
      completed_at = null,
      completed_by_user_id = null,
      completed_by_display = null,
      updated_at = v_now
    where id = p_item_id;
  elsif v_action = 'request_delete' then
    if v_is_creator then
      v_next_status := 'deleted';
      update public.ob_todo_items
      set
        status = 'deleted',
        deleted_at = v_now,
        deleted_by_user_id = v_actor_user_id,
        deleted_by_display = v_actor_label,
        updated_at = v_now
      where id = p_item_id;
    else
      v_next_status := 'pending_delete';
      update public.ob_todo_items
      set
        status_before_delete_request = case when status in ('open', 'done') then status else status_before_delete_request end,
        status = 'pending_delete',
        delete_requested_at = v_now,
        delete_requested_by_user_id = v_actor_user_id,
        delete_requested_by_display = v_actor_label,
        updated_at = v_now
      where id = p_item_id;
    end if;
  elsif v_action = 'approve_delete' then
    if v_item.status <> 'pending_delete' then
      raise exception 'Only pending delete tasks can be approved.';
    end if;
    v_next_status := 'deleted';
    update public.ob_todo_items
    set
      status = 'deleted',
      deleted_at = v_now,
      deleted_by_user_id = v_actor_user_id,
      deleted_by_display = v_actor_label,
      updated_at = v_now
    where id = p_item_id;
  else
    if v_item.status <> 'pending_delete' then
      raise exception 'Only pending delete tasks can be rejected.';
    end if;
    v_next_status := coalesce(v_item.status_before_delete_request, 'open');
    update public.ob_todo_items
    set
      status = v_next_status,
      status_before_delete_request = null,
      delete_requested_at = null,
      delete_requested_by_user_id = null,
      delete_requested_by_display = null,
      updated_at = v_now
    where id = p_item_id;
  end if;

  insert into public.ob_todo_events (item_id, template_id, actor_user_id, actor_display, event_type, payload, created_at)
  values (
    p_item_id,
    v_item.template_id,
    v_actor_user_id,
    v_actor_label,
    v_action,
    jsonb_strip_nulls(
      jsonb_build_object(
        'next_status', v_next_status,
        'spawned_next_instance_date', v_next_instance_date,
        'spawned_next_item_ids', case
          when coalesce(array_length(v_spawned_next_item_ids, 1), 0) > 0 then to_jsonb(v_spawned_next_item_ids)
          else null
        end
      )
    ),
    v_now
  );

  insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
  values (
    v_actor_label,
    'todo_' || v_action,
    null,
    'ob_todo_items',
    jsonb_strip_nulls(
      jsonb_build_object(
        'item_id', p_item_id,
        'template_id', v_item.template_id,
        'next_status', v_next_status,
        'spawned_next_instance_date', v_next_instance_date,
        'spawned_next_item_ids', case
          when coalesce(array_length(v_spawned_next_item_ids, 1), 0) > 0 then to_jsonb(v_spawned_next_item_ids)
          else null
        end
      )
    )
  );

  return jsonb_strip_nulls(
    jsonb_build_object(
      'item_id', p_item_id,
      'template_id', v_item.template_id,
      'next_status', v_next_status,
      'spawned_next_instance_date', v_next_instance_date,
      'spawned_next_item_ids', case
        when coalesce(array_length(v_spawned_next_item_ids, 1), 0) > 0 then to_jsonb(v_spawned_next_item_ids)
        else null
      end,
      'updated_at', v_now
    )
  );
end;
$$;

revoke all on function public.todo_build_due_at_for_instance(timestamptz, date) from public;
revoke all on function public.todo_matches_recurrence_date(date, text, jsonb, date) from public;
revoke all on function public.todo_next_occurrence_date(date, text, jsonb, date) from public;

grant execute on function public.todo_build_due_at_for_instance(timestamptz, date) to authenticated;
grant execute on function public.todo_build_due_at_for_instance(timestamptz, date) to service_role;
grant execute on function public.todo_matches_recurrence_date(date, text, jsonb, date) to authenticated;
grant execute on function public.todo_matches_recurrence_date(date, text, jsonb, date) to service_role;
grant execute on function public.todo_next_occurrence_date(date, text, jsonb, date) to authenticated;
grant execute on function public.todo_next_occurrence_date(date, text, jsonb, date) to service_role;
