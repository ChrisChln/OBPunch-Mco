create table if not exists public.ob_todo_templates (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references auth.users(id) on delete cascade,
  creator_email text not null default '',
  creator_display_name text not null default '',
  delivery_mode text not null check (delivery_mode in ('shared', 'individual')),
  title text not null,
  content text not null default '',
  due_at timestamptz null,
  anchor_instance_date date null,
  recurrence_kind text not null default 'none' check (recurrence_kind in ('none', 'daily', 'weekly', 'monthly')),
  recurrence_rule jsonb not null default '{}'::jsonb,
  assignees jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ob_todo_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ob_todo_templates(id) on delete cascade,
  series_key text not null,
  delivery_key text not null,
  instance_date date null,
  delivery_mode text not null check (delivery_mode in ('shared', 'individual')),
  title text not null,
  content text not null default '',
  due_at timestamptz null,
  creator_user_id uuid not null references auth.users(id) on delete cascade,
  creator_email text not null default '',
  creator_display_name text not null default '',
  status text not null default 'open' check (status in ('open', 'done', 'pending_delete', 'deleted')),
  status_before_delete_request text null check (status_before_delete_request is null or status_before_delete_request in ('open', 'done')),
  completed_at timestamptz null,
  completed_by_user_id uuid null references auth.users(id) on delete set null,
  completed_by_display text null,
  delete_requested_at timestamptz null,
  delete_requested_by_user_id uuid null references auth.users(id) on delete set null,
  delete_requested_by_display text null,
  deleted_at timestamptz null,
  deleted_by_user_id uuid null references auth.users(id) on delete set null,
  deleted_by_display text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ob_todo_items_template_instance_delivery_key_uidx
  on public.ob_todo_items (template_id, coalesce(instance_date, date '2000-01-01'), delivery_key);

create index if not exists ob_todo_items_creator_idx on public.ob_todo_items (creator_user_id, status, created_at desc);
create index if not exists ob_todo_items_template_idx on public.ob_todo_items (template_id, created_at desc);

create table if not exists public.ob_todo_item_assignees (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.ob_todo_items(id) on delete cascade,
  assignee_user_id uuid not null references auth.users(id) on delete cascade,
  assignee_email text not null default '',
  assignee_display_name text not null default '',
  created_at timestamptz not null default now(),
  unique (item_id, assignee_user_id)
);

create index if not exists ob_todo_item_assignees_user_idx on public.ob_todo_item_assignees (assignee_user_id, created_at desc);

create table if not exists public.ob_todo_item_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.ob_todo_items(id) on delete cascade,
  label text not null,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ob_todo_item_links_item_idx on public.ob_todo_item_links (item_id, sort_order asc, created_at asc);

create table if not exists public.ob_todo_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid null references public.ob_todo_items(id) on delete cascade,
  template_id uuid null references public.ob_todo_templates(id) on delete cascade,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_display text not null default '',
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ob_todo_events_item_idx on public.ob_todo_events (item_id, created_at desc);
create index if not exists ob_todo_events_template_idx on public.ob_todo_events (template_id, created_at desc);

alter table public.ob_todo_templates enable row level security;
alter table public.ob_todo_items enable row level security;
alter table public.ob_todo_item_assignees enable row level security;
alter table public.ob_todo_item_links enable row level security;
alter table public.ob_todo_events enable row level security;

drop policy if exists ob_todo_templates_select_access on public.ob_todo_templates;
create policy ob_todo_templates_select_access
  on public.ob_todo_templates
  for select
  to authenticated
  using (
    creator_user_id = auth.uid()
    or exists (
      select 1
      from public.ob_todo_items as item
      join public.ob_todo_item_assignees as assignee on assignee.item_id = item.id
      where item.template_id = ob_todo_templates.id
        and assignee.assignee_user_id = auth.uid()
        and item.status <> 'deleted'
    )
  );

drop policy if exists ob_todo_items_select_access on public.ob_todo_items;
create policy ob_todo_items_select_access
  on public.ob_todo_items
  for select
  to authenticated
  using (
    creator_user_id = auth.uid()
    or exists (
      select 1
      from public.ob_todo_item_assignees as assignee
      where assignee.item_id = ob_todo_items.id
        and assignee.assignee_user_id = auth.uid()
    )
  );

drop policy if exists ob_todo_item_assignees_select_access on public.ob_todo_item_assignees;
create policy ob_todo_item_assignees_select_access
  on public.ob_todo_item_assignees
  for select
  to authenticated
  using (
    assignee_user_id = auth.uid()
    or exists (
      select 1
      from public.ob_todo_items as item
      where item.id = ob_todo_item_assignees.item_id
        and item.creator_user_id = auth.uid()
    )
  );

drop policy if exists ob_todo_item_links_select_access on public.ob_todo_item_links;
create policy ob_todo_item_links_select_access
  on public.ob_todo_item_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ob_todo_items as item
      where item.id = ob_todo_item_links.item_id
        and (
          item.creator_user_id = auth.uid()
          or exists (
            select 1
            from public.ob_todo_item_assignees as assignee
            where assignee.item_id = item.id
              and assignee.assignee_user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists ob_todo_events_select_access on public.ob_todo_events;
create policy ob_todo_events_select_access
  on public.ob_todo_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ob_todo_items as item
      where item.id = ob_todo_events.item_id
        and (
          item.creator_user_id = auth.uid()
          or exists (
            select 1
            from public.ob_todo_item_assignees as assignee
            where assignee.item_id = item.id
              and assignee.assignee_user_id = auth.uid()
          )
        )
    )
    or exists (
      select 1
      from public.ob_todo_templates as template
      where template.id = ob_todo_events.template_id
        and template.creator_user_id = auth.uid()
    )
  );

grant select on public.ob_todo_templates to authenticated;
grant select on public.ob_todo_items to authenticated;
grant select on public.ob_todo_item_assignees to authenticated;
grant select on public.ob_todo_item_links to authenticated;
grant select on public.ob_todo_events to authenticated;

create or replace function public.todo_template_is_creator(
  p_template_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(p_user_id, auth.uid()) is not null
    and exists (
      select 1
      from public.ob_todo_templates
      where id = p_template_id
        and creator_user_id = coalesce(p_user_id, auth.uid())
    );
$$;

create or replace function public.todo_item_is_creator(
  p_item_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(p_user_id, auth.uid()) is not null
    and exists (
      select 1
      from public.ob_todo_items
      where id = p_item_id
        and creator_user_id = coalesce(p_user_id, auth.uid())
    );
$$;

create or replace function public.todo_item_is_assignee(
  p_item_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(p_user_id, auth.uid()) is not null
    and exists (
      select 1
      from public.ob_todo_item_assignees
      where item_id = p_item_id
        and assignee_user_id = coalesce(p_user_id, auth.uid())
    );
$$;

create or replace function public.todo_item_has_access(
  p_item_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    public.todo_item_is_creator(p_item_id, coalesce(p_user_id, auth.uid()))
    or public.todo_item_is_assignee(p_item_id, coalesce(p_user_id, auth.uid()));
$$;

create or replace function public.todo_template_has_access(
  p_template_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    public.todo_template_is_creator(p_template_id, coalesce(p_user_id, auth.uid()))
    or exists (
      select 1
      from public.ob_todo_items as item
      join public.ob_todo_item_assignees as assignee on assignee.item_id = item.id
      where item.template_id = p_template_id
        and assignee.assignee_user_id = coalesce(p_user_id, auth.uid())
        and item.status <> 'deleted'
    );
$$;

drop policy if exists ob_todo_templates_select_access on public.ob_todo_templates;
create policy ob_todo_templates_select_access
  on public.ob_todo_templates
  for select
  to authenticated
  using (public.todo_template_has_access(id));

drop policy if exists ob_todo_items_select_access on public.ob_todo_items;
create policy ob_todo_items_select_access
  on public.ob_todo_items
  for select
  to authenticated
  using (public.todo_item_has_access(id));

drop policy if exists ob_todo_item_assignees_select_access on public.ob_todo_item_assignees;
create policy ob_todo_item_assignees_select_access
  on public.ob_todo_item_assignees
  for select
  to authenticated
  using (
    assignee_user_id = auth.uid()
    or public.todo_item_is_creator(item_id)
  );

drop policy if exists ob_todo_item_links_select_access on public.ob_todo_item_links;
create policy ob_todo_item_links_select_access
  on public.ob_todo_item_links
  for select
  to authenticated
  using (public.todo_item_has_access(item_id));

drop policy if exists ob_todo_events_select_access on public.ob_todo_events;
create policy ob_todo_events_select_access
  on public.ob_todo_events
  for select
  to authenticated
  using (
    (item_id is not null and public.todo_item_has_access(item_id))
    or (template_id is not null and public.todo_template_is_creator(template_id))
  );

create or replace function public.todo_resolve_user_identity(
  p_user_id uuid
)
returns table (
  user_email text,
  display_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_user_profiles boolean := to_regclass('public.ob_user_profiles') is not null;
begin
  if p_user_id is null then
    return;
  end if;

  if v_has_user_profiles then
    return query
    select
      coalesce(
        nullif(btrim(coalesce(profile.user_email, '')), ''),
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        ''
      ) as user_email,
      coalesce(
        nullif(btrim(coalesce(profile.display_name, '')), ''),
        nullif(btrim(coalesce(profile.user_email, '')), ''),
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'display_name', '')), ''),
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', '')), ''),
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        auth_user.id::text
      ) as display_name
    from auth.users as auth_user
    left join public.ob_user_profiles as profile
      on profile.user_id = auth_user.id
    where auth_user.id = p_user_id
    limit 1;
  else
    return query
    select
      coalesce(nullif(btrim(coalesce(auth_user.email, '')), ''), '') as user_email,
      coalesce(
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'display_name', '')), ''),
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', '')), ''),
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        auth_user.id::text
      ) as display_name
    from auth.users as auth_user
    where auth_user.id = p_user_id
    limit 1;
  end if;
end;
$$;

create or replace function public.list_todo_profiles()
returns table (
  user_id uuid,
  user_email text,
  display_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_user_profiles boolean := to_regclass('public.ob_user_profiles') is not null;
begin
  if v_has_user_profiles then
    return query
    select
      auth_user.id as user_id,
      coalesce(
        nullif(btrim(coalesce(profile.user_email, '')), ''),
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        ''
      ) as user_email,
      coalesce(
        nullif(btrim(coalesce(profile.display_name, '')), ''),
        nullif(btrim(coalesce(profile.user_email, '')), ''),
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'display_name', '')), ''),
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', '')), ''),
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        auth_user.id::text
      ) as display_name
    from auth.users as auth_user
    left join public.ob_user_profiles as profile
      on profile.user_id = auth_user.id
    where auth_user.id is not null
      and coalesce(
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        nullif(btrim(coalesce(profile.user_email, '')), '')
      ) is not null
    order by
      coalesce(
        nullif(btrim(coalesce(profile.display_name, '')), ''),
        nullif(btrim(coalesce(profile.user_email, '')), ''),
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'display_name', '')), ''),
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', '')), ''),
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        auth_user.id::text
      ),
      coalesce(
        nullif(btrim(coalesce(profile.user_email, '')), ''),
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        auth_user.id::text
      );
  else
    return query
    select
      auth_user.id as user_id,
      coalesce(nullif(btrim(coalesce(auth_user.email, '')), ''), '') as user_email,
      coalesce(
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'display_name', '')), ''),
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', '')), ''),
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        auth_user.id::text
      ) as display_name
    from auth.users as auth_user
    where auth_user.id is not null
      and nullif(btrim(coalesce(auth_user.email, '')), '') is not null
    order by
      coalesce(
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'display_name', '')), ''),
        nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', '')), ''),
        nullif(btrim(coalesce(auth_user.email, '')), ''),
        auth_user.id::text
      ),
      coalesce(nullif(btrim(coalesce(auth_user.email, '')), ''), auth_user.id::text);
  end if;
end;
$$;

create or replace function public.create_todo_task(
  p_delivery_mode text,
  p_title text,
  p_content text default '',
  p_due_at timestamptz default null,
  p_instance_date date default null,
  p_recurrence_kind text default 'none',
  p_recurrence_rule jsonb default '{}'::jsonb,
  p_assignees jsonb default '[]'::jsonb,
  p_links jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_email text := '';
  v_actor_display text := '';
  v_template_id uuid;
  v_item_id uuid;
  v_item_ids uuid[] := array[]::uuid[];
  v_delivery_mode text := lower(btrim(coalesce(p_delivery_mode, '')));
  v_recurrence_kind text := lower(btrim(coalesce(p_recurrence_kind, 'none')));
  v_title text := btrim(coalesce(p_title, ''));
  v_content text := coalesce(p_content, '');
  v_instance_date date := p_instance_date;
  v_now timestamptz := now();
  v_series_key text;
  v_assignees_json jsonb := '[]'::jsonb;
  v_links_json jsonb := '[]'::jsonb;
  assignee_row record;
begin
  if v_actor_user_id is null then
    raise exception 'Unauthorized.';
  end if;

  select
    coalesce(nullif(btrim(coalesce(identity_row.user_email, '')), ''), ''),
    coalesce(
      nullif(btrim(coalesce(identity_row.display_name, '')), ''),
      nullif(btrim(coalesce(identity_row.user_email, '')), ''),
      v_actor_user_id::text
    )
  into v_actor_email, v_actor_display
  from public.todo_resolve_user_identity(v_actor_user_id) as identity_row
  limit 1;

  if v_title = '' then
    raise exception 'Task title is required.';
  end if;
  if v_delivery_mode not in ('shared', 'individual') then
    raise exception 'Unsupported delivery mode: %', p_delivery_mode;
  end if;
  if v_recurrence_kind not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'Unsupported recurrence kind: %', p_recurrence_kind;
  end if;
  if v_recurrence_kind <> 'none' and v_instance_date is null then
    raise exception 'Recurring tasks require an instance date.';
  end if;

  create temporary table if not exists tmp_todo_assignees (
    user_id uuid primary key,
    user_email text not null,
    display_name text not null
  ) on commit drop;
  truncate tmp_todo_assignees;

  insert into tmp_todo_assignees (user_id, user_email, display_name)
  select distinct
    row_data.user_id,
    coalesce(nullif(btrim(coalesce(row_data.user_email, '')), ''), ''),
    coalesce(nullif(btrim(coalesce(row_data.display_name, '')), ''), nullif(btrim(coalesce(row_data.user_email, '')), ''), row_data.user_id::text)
  from jsonb_to_recordset(coalesce(p_assignees, '[]'::jsonb)) as row_data(
    user_id uuid,
    user_email text,
    display_name text
  )
  where row_data.user_id is not null;

  if not exists (select 1 from tmp_todo_assignees) then
    raise exception 'At least one assignee is required.';
  end if;

  create temporary table if not exists tmp_todo_links (
    label text not null,
    url text not null,
    sort_order int not null
  ) on commit drop;
  truncate tmp_todo_links;

  insert into tmp_todo_links (label, url, sort_order)
  select
    btrim(coalesce(row_data.label, '')),
    btrim(coalesce(row_data.url, '')),
    coalesce(row_data.sort_order, 0)
  from jsonb_to_recordset(coalesce(p_links, '[]'::jsonb)) as row_data(
    label text,
    url text,
    sort_order int
  )
  where btrim(coalesce(row_data.label, '')) <> ''
    and btrim(coalesce(row_data.url, '')) <> '';

  if exists (select 1 from tmp_todo_links where url !~* '^https?://') then
    raise exception 'Todo links must use http or https.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', user_id,
        'user_email', user_email,
        'display_name', display_name
      )
      order by display_name, user_email, user_id::text
    ),
    '[]'::jsonb
  ) into v_assignees_json
  from tmp_todo_assignees;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'label', prepared.label,
        'url', prepared.url,
        'sort_order', prepared.normalized_sort_order
      )
      order by prepared.normalized_sort_order
    ),
    '[]'::jsonb
  ) into v_links_json
  from (
    select
      label,
      url,
      row_number() over (order by sort_order, label, url) - 1 as normalized_sort_order
    from tmp_todo_links
  ) as prepared;

  insert into public.ob_todo_templates (
    creator_user_id,
    creator_email,
    creator_display_name,
    delivery_mode,
    title,
    content,
    due_at,
    anchor_instance_date,
    recurrence_kind,
    recurrence_rule,
    assignees,
    links,
    is_active,
    created_at,
    updated_at
  )
  values (
    v_actor_user_id,
    v_actor_email,
    v_actor_display,
    v_delivery_mode,
    v_title,
    v_content,
    p_due_at,
    v_instance_date,
    v_recurrence_kind,
    coalesce(p_recurrence_rule, '{}'::jsonb),
    v_assignees_json,
    v_links_json,
    true,
    v_now,
    v_now
  )
  returning id into v_template_id;

  v_series_key := v_template_id::text;

  if v_delivery_mode = 'shared' then
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
      v_template_id,
      v_series_key,
      'shared',
      v_instance_date,
      v_delivery_mode,
      v_title,
      v_content,
      p_due_at,
      v_actor_user_id,
      v_actor_email,
      v_actor_display,
      'open',
      v_now,
      v_now
    )
    returning id into v_item_id;

    v_item_ids := array_append(v_item_ids, v_item_id);

    insert into public.ob_todo_item_assignees (item_id, assignee_user_id, assignee_email, assignee_display_name, created_at)
    select v_item_id, user_id, user_email, display_name, v_now
    from tmp_todo_assignees;

    insert into public.ob_todo_item_links (item_id, label, url, sort_order, created_at, updated_at)
    select v_item_id, label, url, row_number() over (order by sort_order, label, url) - 1, v_now, v_now
    from tmp_todo_links
    order by sort_order, label, url;
  else
    for assignee_row in select * from tmp_todo_assignees order by display_name, user_email, user_id::text loop
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
        v_template_id,
        v_series_key,
        assignee_row.user_id::text,
        v_instance_date,
        v_delivery_mode,
        v_title,
        v_content,
        p_due_at,
        v_actor_user_id,
        v_actor_email,
        v_actor_display,
        'open',
        v_now,
        v_now
      )
      returning id into v_item_id;

      v_item_ids := array_append(v_item_ids, v_item_id);

      insert into public.ob_todo_item_assignees (item_id, assignee_user_id, assignee_email, assignee_display_name, created_at)
      values (v_item_id, assignee_row.user_id, assignee_row.user_email, assignee_row.display_name, v_now);

      insert into public.ob_todo_item_links (item_id, label, url, sort_order, created_at, updated_at)
      select v_item_id, label, url, row_number() over (order by sort_order, label, url) - 1, v_now, v_now
      from tmp_todo_links
      order by sort_order, label, url;
    end loop;
  end if;

  insert into public.ob_todo_events (item_id, template_id, actor_user_id, actor_display, event_type, payload, created_at)
  values (
    null,
    v_template_id,
    v_actor_user_id,
    v_actor_display,
    'todo_created',
    jsonb_build_object(
      'title', v_title,
      'delivery_mode', v_delivery_mode,
      'item_count', coalesce(array_length(v_item_ids, 1), 0)
    ),
    v_now
  );

  insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
  values (
    v_actor_display,
    'todo_create',
    null,
    'ob_todo_templates',
    jsonb_build_object(
      'template_id', v_template_id,
      'item_ids', to_jsonb(v_item_ids),
      'delivery_mode', v_delivery_mode,
      'title', v_title
    )
  );

  return jsonb_build_object(
    'template_id', v_template_id,
    'item_ids', to_jsonb(v_item_ids)
  );
end;
$$;

create or replace function public.update_todo_task(
  p_template_id uuid,
  p_title text,
  p_content text default '',
  p_due_at timestamptz default null,
  p_instance_date date default null,
  p_recurrence_kind text default 'none',
  p_recurrence_rule jsonb default '{}'::jsonb,
  p_links jsonb default '[]'::jsonb,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_display text := '';
  v_template public.ob_todo_templates%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_content text := coalesce(p_content, '');
  v_recurrence_kind text := lower(btrim(coalesce(p_recurrence_kind, 'none')));
  v_due_time_local text := null;
  v_links_json jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  item_row record;
begin
  if v_actor_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_title = '' then
    raise exception 'Task title is required.';
  end if;
  if v_recurrence_kind not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'Unsupported recurrence kind: %', p_recurrence_kind;
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_actor_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_actor_user_id) as identity_row
  limit 1;

  select *
  into v_template
  from public.ob_todo_templates
  where id = p_template_id
  for update;

  if not found then
    raise exception 'Todo template not found.';
  end if;
  if v_template.creator_user_id <> v_actor_user_id then
    raise exception 'Only the creator can update this task.';
  end if;

  create temporary table if not exists tmp_todo_links (
    label text not null,
    url text not null,
    sort_order int not null
  ) on commit drop;
  truncate tmp_todo_links;

  insert into tmp_todo_links (label, url, sort_order)
  select
    btrim(coalesce(row_data.label, '')),
    btrim(coalesce(row_data.url, '')),
    coalesce(row_data.sort_order, 0)
  from jsonb_to_recordset(coalesce(p_links, '[]'::jsonb)) as row_data(
    label text,
    url text,
    sort_order int
  )
  where btrim(coalesce(row_data.label, '')) <> ''
    and btrim(coalesce(row_data.url, '')) <> '';

  if exists (select 1 from tmp_todo_links where url !~* '^https?://') then
    raise exception 'Todo links must use http or https.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'label', prepared.label,
        'url', prepared.url,
        'sort_order', prepared.normalized_sort_order
      )
      order by prepared.normalized_sort_order
    ),
    '[]'::jsonb
  ) into v_links_json
  from (
    select
      label,
      url,
      row_number() over (order by sort_order, label, url) - 1 as normalized_sort_order
    from tmp_todo_links
  ) as prepared;

  if p_due_at is not null then
    v_due_time_local := to_char(p_due_at at time zone 'America/New_York', 'HH24:MI:SS');
  end if;

  update public.ob_todo_templates
  set
    title = v_title,
    content = v_content,
    due_at = p_due_at,
    anchor_instance_date = p_instance_date,
    recurrence_kind = v_recurrence_kind,
    recurrence_rule = coalesce(p_recurrence_rule, '{}'::jsonb),
    links = v_links_json,
    is_active = coalesce(p_is_active, true),
    updated_at = v_now
  where id = p_template_id;

  for item_row in
    select id, instance_date
    from public.ob_todo_items
    where template_id = p_template_id
      and status <> 'done'
      and status <> 'deleted'
  loop
    update public.ob_todo_items
    set
      title = v_title,
      content = v_content,
      due_at = case
        when p_due_at is null then null
        when item_row.instance_date is null then p_due_at
        else timezone('America/New_York', ((item_row.instance_date)::text || ' ' || v_due_time_local)::timestamp)
      end,
      updated_at = v_now
    where id = item_row.id;

    delete from public.ob_todo_item_links where item_id = item_row.id;
    insert into public.ob_todo_item_links (item_id, label, url, sort_order, created_at, updated_at)
    select item_row.id, label, url, row_number() over (order by sort_order, label, url) - 1, v_now, v_now
    from tmp_todo_links
    order by sort_order, label, url;
  end loop;

  insert into public.ob_todo_events (item_id, template_id, actor_user_id, actor_display, event_type, payload, created_at)
  values (
    null,
    p_template_id,
    v_actor_user_id,
    v_actor_display,
    'todo_updated',
    jsonb_build_object(
      'title', v_title,
      'is_active', coalesce(p_is_active, true)
    ),
    v_now
  );

  insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
  values (
    v_actor_display,
    'todo_update',
    null,
    'ob_todo_templates',
    jsonb_build_object(
      'template_id', p_template_id,
      'title', v_title,
      'is_active', coalesce(p_is_active, true)
    )
  );

  return jsonb_build_object(
    'template_id', p_template_id,
    'updated_at', v_now
  );
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
  v_actor_display text := '';
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_item public.ob_todo_items%rowtype;
  v_is_creator boolean := false;
  v_is_assignee boolean := false;
  v_next_status text := null;
  v_now timestamptz := now();
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
  into v_actor_display
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
      completed_by_display = v_actor_display,
      updated_at = v_now
    where id = p_item_id;
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
        deleted_by_display = v_actor_display,
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
        delete_requested_by_display = v_actor_display,
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
      deleted_by_display = v_actor_display,
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
    v_actor_display,
    v_action,
    jsonb_build_object(
      'next_status', v_next_status
    ),
    v_now
  );

  insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
  values (
    v_actor_display,
    'todo_' || v_action,
    null,
    'ob_todo_items',
    jsonb_build_object(
      'item_id', p_item_id,
      'template_id', v_item.template_id,
      'next_status', v_next_status
    )
  );

  return jsonb_build_object(
    'item_id', p_item_id,
    'template_id', v_item.template_id,
    'next_status', v_next_status,
    'updated_at', v_now
  );
end;
$$;

revoke all on function public.create_todo_task(text, text, text, timestamptz, date, text, jsonb, jsonb, jsonb) from public;
revoke all on function public.update_todo_task(uuid, text, text, timestamptz, date, text, jsonb, jsonb, boolean) from public;
revoke all on function public.apply_todo_item_action(uuid, text) from public;
revoke all on function public.list_todo_profiles() from public;
revoke all on function public.todo_resolve_user_identity(uuid) from public;
revoke all on function public.todo_template_is_creator(uuid, uuid) from public;
revoke all on function public.todo_item_is_creator(uuid, uuid) from public;
revoke all on function public.todo_item_is_assignee(uuid, uuid) from public;
revoke all on function public.todo_item_has_access(uuid, uuid) from public;
revoke all on function public.todo_template_has_access(uuid, uuid) from public;

grant execute on function public.create_todo_task(text, text, text, timestamptz, date, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.create_todo_task(text, text, text, timestamptz, date, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.update_todo_task(uuid, text, text, timestamptz, date, text, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.update_todo_task(uuid, text, text, timestamptz, date, text, jsonb, jsonb, boolean) to service_role;
grant execute on function public.apply_todo_item_action(uuid, text) to authenticated;
grant execute on function public.apply_todo_item_action(uuid, text) to service_role;
grant execute on function public.list_todo_profiles() to authenticated;
grant execute on function public.list_todo_profiles() to service_role;
grant execute on function public.todo_resolve_user_identity(uuid) to authenticated;
grant execute on function public.todo_resolve_user_identity(uuid) to service_role;
grant execute on function public.todo_template_is_creator(uuid, uuid) to authenticated;
grant execute on function public.todo_template_is_creator(uuid, uuid) to service_role;
grant execute on function public.todo_item_is_creator(uuid, uuid) to authenticated;
grant execute on function public.todo_item_is_creator(uuid, uuid) to service_role;
grant execute on function public.todo_item_is_assignee(uuid, uuid) to authenticated;
grant execute on function public.todo_item_is_assignee(uuid, uuid) to service_role;
grant execute on function public.todo_item_has_access(uuid, uuid) to authenticated;
grant execute on function public.todo_item_has_access(uuid, uuid) to service_role;
grant execute on function public.todo_template_has_access(uuid, uuid) to authenticated;
grant execute on function public.todo_template_has_access(uuid, uuid) to service_role;
