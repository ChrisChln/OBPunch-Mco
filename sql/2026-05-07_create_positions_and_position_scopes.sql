create table if not exists public.ob_positions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ob_positions_name_lower_uidx
  on public.ob_positions (lower(btrim(name)));

alter table public.ob_positions enable row level security;

grant select on public.ob_positions to authenticated;

drop policy if exists ob_positions_authenticated_select on public.ob_positions;
create policy ob_positions_authenticated_select
  on public.ob_positions
  for select
  to authenticated
  using (auth.uid() is not null);

insert into public.ob_positions (name, is_active, display_order)
select seed.name, true, seed.display_order
from (
  values
    ('Pick', 10),
    ('Pack', 20),
    ('Rebin', 30),
    ('Preship', 40),
    ('Transfer', 50),
    ('FLEX TEAM', 60)
) as seed(name, display_order)
on conflict (lower(btrim(name))) do update
set
  is_active = true,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.ob_positions (name, is_active, display_order)
select distinct position_name, true, 1000
from (
  select nullif(btrim(public.employee_record_text(to_jsonb(e), 'position', 'Position')), '') as position_name
  from public.ob_employees as e
  where to_regclass('public.ob_employees') is not null
  union
  select nullif(btrim(s.position), '') as position_name
  from public.ob_schedules as s
  where to_regclass('public.ob_schedules') is not null
) as existing
where position_name is not null
on conflict (lower(btrim(name))) do nothing;

do $$
begin
  if to_regclass('public.ob_schedules') is not null and exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ob_schedules'::regclass
      and conname = 'ob_schedules_position_check'
  ) then
    alter table public.ob_schedules drop constraint ob_schedules_position_check;
  end if;
end
$$;

create or replace function public.default_admin_position_scopes()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'employees', jsonb_build_object('mode', 'all', 'positions', '[]'::jsonb),
    'schedule', jsonb_build_object('mode', 'all', 'positions', '[]'::jsonb),
    'timecard', jsonb_build_object('mode', 'all', 'positions', '[]'::jsonb)
  );
$$;

alter table public.ob_admin_accounts
  add column if not exists position_scopes jsonb not null default public.default_admin_position_scopes();

create or replace function public.normalize_admin_position_scopes(
  p_scopes jsonb default public.default_admin_position_scopes()
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_source jsonb := case
    when jsonb_typeof(coalesce(p_scopes, '{}'::jsonb)) = 'object' then coalesce(p_scopes, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_result jsonb := public.default_admin_position_scopes();
  v_module text;
  v_scope jsonb;
  v_positions jsonb;
begin
  foreach v_module in array array['employees', 'schedule', 'timecard'] loop
    v_scope := coalesce(v_source -> v_module, '{}'::jsonb);

    if jsonb_typeof(v_scope) = 'object'
      and lower(btrim(coalesce(v_scope ->> 'mode', ''))) = 'selected'
      and jsonb_typeof(coalesce(v_scope -> 'positions', '[]'::jsonb)) = 'array' then

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'position', prepared.position,
            'access_level', prepared.access_level
          )
          order by prepared.position
        ),
        '[]'::jsonb
      )
      into v_positions
      from (
        select distinct on (lower(btrim(coalesce(item ->> 'position', item ->> 'name', ''))))
          btrim(coalesce(item ->> 'position', item ->> 'name', '')) as position,
          case when lower(btrim(coalesce(item ->> 'access_level', ''))) = 'operate' then 'operate' else 'view' end as access_level
        from jsonb_array_elements(v_scope -> 'positions') as item
        where jsonb_typeof(item) = 'object'
          and nullif(btrim(coalesce(item ->> 'position', item ->> 'name', '')), '') is not null
        order by lower(btrim(coalesce(item ->> 'position', item ->> 'name', '')))
      ) as prepared;

      if jsonb_array_length(v_positions) > 0 then
        v_result := jsonb_set(
          v_result,
          array[v_module],
          jsonb_build_object('mode', 'selected', 'positions', v_positions),
          true
        );
      end if;
    end if;
  end loop;

  return v_result;
end;
$$;

create or replace function public.list_positions()
returns table (
  id uuid,
  name text,
  is_active boolean,
  display_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  return query
  select p.id, p.name, p.is_active, p.display_order, p.created_at, p.updated_at
  from public.ob_positions as p
  order by p.display_order, lower(p.name), p.created_at;
end;
$$;

create or replace function public.save_position(
  p_name text,
  p_display_order integer default 0,
  p_is_active boolean default true,
  p_original_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_original text := nullif(btrim(coalesce(p_original_name, '')), '');
  v_row public.ob_positions%rowtype;
begin
  if v_actor is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_can_manage_admin_access(v_actor) then
    raise exception 'Forbidden.';
  end if;
  if v_name is null then
    raise exception 'Position name is required.';
  end if;

  if v_original is not null then
    update public.ob_positions
    set
      name = v_name,
      display_order = coalesce(p_display_order, display_order),
      is_active = coalesce(p_is_active, is_active),
      updated_at = now()
    where lower(btrim(name)) = lower(v_original)
    returning * into v_row;
  end if;

  if v_row.id is null then
    insert into public.ob_positions (name, display_order, is_active, created_at, updated_at)
    values (v_name, coalesce(p_display_order, 0), coalesce(p_is_active, true), now(), now())
    on conflict (lower(btrim(name))) do update
    set
      display_order = excluded.display_order,
      is_active = excluded.is_active,
      updated_at = now()
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.position_for_staff(
  p_staff_id text
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.employee_record_text(to_jsonb(e), 'position', 'Position')
  from public.ob_employees as e
  where e.staff_id = p_staff_id
  limit 1;
$$;

create or replace function public.user_has_position_access(
  p_module_key text,
  p_position text,
  p_required_access text default 'view',
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_module text := lower(btrim(coalesce(p_module_key, '')));
  v_position text := lower(btrim(coalesce(p_position, '')));
  v_required text := lower(btrim(coalesce(p_required_access, 'view')));
  v_scopes jsonb := public.default_admin_position_scopes();
  v_scope jsonb;
  v_scope_mode text := 'all';
  v_entry_access text := null;
begin
  if v_user_id is null then
    return false;
  end if;
  if v_module not in ('employees', 'schedule', 'timecard') then
    return false;
  end if;
  if v_required not in ('view', 'operate') then
    v_required := 'view';
  end if;
  if not public.user_has_module_access(v_module, v_required, v_user_id) then
    return false;
  end if;

  select public.normalize_admin_position_scopes(account.position_scopes)
  into v_scopes
  from public.ob_admin_accounts as account
  where account.user_id = v_user_id
    and account.is_active = true
  limit 1;

  v_scope := coalesce(v_scopes -> v_module, jsonb_build_object('mode', 'all', 'positions', '[]'::jsonb));
  v_scope_mode := lower(btrim(coalesce(v_scope ->> 'mode', 'all')));
  if v_scope_mode <> 'selected' then
    return true;
  end if;
  if v_position = '' then
    return false;
  end if;

  select lower(btrim(coalesce(item ->> 'access_level', 'view')))
  into v_entry_access
  from jsonb_array_elements(coalesce(v_scope -> 'positions', '[]'::jsonb)) as item
  where lower(btrim(coalesce(item ->> 'position', ''))) = v_position
  limit 1;

  if v_entry_access is null then
    return false;
  end if;
  if v_required = 'operate' then
    return v_entry_access = 'operate';
  end if;
  return v_entry_access in ('view', 'operate');
end;
$$;

create or replace function public.user_can_access_staff_position(
  p_module_key text,
  p_staff_id text,
  p_required_access text default 'view',
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_position text := public.position_for_staff(p_staff_id);
begin
  return public.user_has_position_access(p_module_key, v_position, p_required_access, p_user_id);
end;
$$;

create or replace function public.get_admin_access_context()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := null;
  v_is_active boolean := false;
  v_managed_agencies text[] := '{}'::text[];
  v_position_scopes jsonb := public.default_admin_position_scopes();
  v_modules jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;

  v_role := public.resolve_admin_role_for_user(v_user_id);

  select
    coalesce(account.is_active, false),
    coalesce(account.managed_agencies, '{}'::text[]),
    public.normalize_admin_position_scopes(account.position_scopes)
  into v_is_active, v_managed_agencies, v_position_scopes
  from public.ob_admin_accounts as account
  where account.user_id = v_user_id
  limit 1;

  if v_is_active then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'module_key', prepared.module_key,
          'access_level', prepared.access_level
        )
        order by prepared.module_key
      ),
      '[]'::jsonb
    )
    into v_modules
    from (
      select
        allowed.module_key,
        coalesce(
          (
            select override_row.access_level
            from public.ob_admin_account_modules as override_row
            where override_row.user_id = v_user_id
              and override_row.module_key = allowed.module_key
            limit 1
          ),
          public.default_admin_module_access(v_role, allowed.module_key)
        ) as access_level
      from unnest(public.admin_module_keys()) as allowed(module_key)
    ) as prepared;
  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'module_key', allowed.module_key,
          'access_level', 'hidden'
        )
        order by allowed.module_key
      ),
      '[]'::jsonb
    )
    into v_modules
    from unnest(public.admin_module_keys()) as allowed(module_key);
  end if;

  return jsonb_build_object(
    'user_id', v_user_id,
    'role', coalesce(v_role, 'level3'),
    'is_active', v_is_active,
    'managed_agencies', to_jsonb(v_managed_agencies),
    'modules', v_modules,
    'position_scopes', coalesce(v_position_scopes, public.default_admin_position_scopes())
  );
end;
$$;

drop function if exists public.list_admin_access_accounts();

create or replace function public.list_admin_access_accounts()
returns table (
  user_id uuid,
  user_email text,
  display_name text,
  role text,
  is_active boolean,
  managed_agencies text[],
  modules jsonb,
  position_scopes jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_can_manage_admin_access(v_user_id) then
    raise exception 'Forbidden.';
  end if;

  return query
  with effective_accounts as (
    select
      auth_user.id as user_id,
      account.role as explicit_role,
      account.is_active as explicit_is_active,
      coalesce(account.managed_agencies, '{}'::text[]) as managed_agencies,
      public.normalize_admin_position_scopes(account.position_scopes) as position_scopes,
      coalesce(account.created_at, auth_user.created_at, now()) as sort_created_at,
      public.resolve_admin_role_for_user(auth_user.id) as effective_role
    from auth.users as auth_user
    left join public.ob_admin_accounts as account
      on account.user_id = auth_user.id
  )
  select
    account.user_id,
    coalesce(
      nullif(btrim(coalesce(identity_row.user_email, '')), ''),
      nullif(btrim(coalesce(auth_user.email, '')), ''),
      ''
    ) as user_email,
    coalesce(
      nullif(btrim(coalesce(identity_row.display_name, '')), ''),
      nullif(btrim(coalesce(identity_row.user_email, '')), ''),
      nullif(btrim(coalesce(auth_user.email, '')), ''),
      auth_user.id::text
    ) as display_name,
    account.effective_role as role,
    coalesce(account.explicit_is_active, true) as is_active,
    account.managed_agencies,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'module_key', prepared.module_key,
            'access_level', prepared.access_level
          )
          order by prepared.module_key
        ),
        '[]'::jsonb
      )
      from (
        select
          allowed.module_key,
          coalesce(
            (
              select override_row.access_level
              from public.ob_admin_account_modules as override_row
              where override_row.user_id = account.user_id
                and override_row.module_key = allowed.module_key
              limit 1
            ),
            public.default_admin_module_access(account.effective_role, allowed.module_key)
          ) as access_level
        from unnest(public.admin_module_keys()) as allowed(module_key)
      ) as prepared
    ) as modules,
    coalesce(account.position_scopes, public.default_admin_position_scopes()) as position_scopes
  from effective_accounts as account
  join auth.users as auth_user
    on auth_user.id = account.user_id
  left join lateral public.todo_resolve_user_identity(account.user_id) as identity_row
    on true
  order by
    coalesce(
      nullif(btrim(coalesce(identity_row.display_name, '')), ''),
      nullif(btrim(coalesce(identity_row.user_email, '')), ''),
      nullif(btrim(coalesce(auth_user.email, '')), ''),
      auth_user.id::text
    ),
    account.sort_created_at desc;
end;
$$;

drop function if exists public.save_admin_access_account(uuid, text, boolean, text[], jsonb);

create or replace function public.save_admin_access_account(
  p_user_id uuid,
  p_role text,
  p_is_active boolean default true,
  p_managed_agencies text[] default '{}'::text[],
  p_modules jsonb default '[]'::jsonb,
  p_position_scopes jsonb default public.default_admin_position_scopes()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_display text := '';
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_is_active boolean := coalesce(p_is_active, true);
  v_managed_agencies text[] := '{}'::text[];
  v_position_scopes jsonb := public.normalize_admin_position_scopes(p_position_scopes);
begin
  if v_actor_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_can_manage_admin_access(v_actor_user_id) then
    raise exception 'Forbidden.';
  end if;
  if p_user_id is null then
    raise exception 'User is required.';
  end if;
  if v_role not in ('level1', 'level2', 'level3', 'agency') then
    raise exception 'Unsupported role: %', p_role;
  end if;
  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
  ) then
    raise exception 'Target user not found.';
  end if;

  select coalesce(
    array_agg(distinct normalized.agency order by normalized.agency),
    '{}'::text[]
  )
  into v_managed_agencies
  from (
    select nullif(btrim(coalesce(agency, '')), '') as agency
    from unnest(coalesce(p_managed_agencies, '{}'::text[])) as agency
  ) as normalized
  where normalized.agency is not null;

  insert into public.ob_admin_accounts (
    user_id,
    role,
    is_active,
    managed_agencies,
    position_scopes,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    v_role,
    v_is_active,
    v_managed_agencies,
    v_position_scopes,
    now(),
    now()
  )
  on conflict (user_id) do update
  set
    role = excluded.role,
    is_active = excluded.is_active,
    managed_agencies = excluded.managed_agencies,
    position_scopes = excluded.position_scopes,
    updated_at = now();

  delete from public.ob_admin_account_modules
  where user_id = p_user_id;

  insert into public.ob_admin_account_modules (
    user_id,
    module_key,
    access_level,
    created_at,
    updated_at
  )
  select
    p_user_id,
    module_key,
    access_level,
    now(),
    now()
  from (
    select
      allowed.module_key,
      coalesce(
        (
          select prepared.access_level
          from (
            select distinct on (lower(btrim(coalesce(module_item ->> 'module_key', ''))))
              lower(btrim(coalesce(module_item ->> 'module_key', ''))) as module_key,
              lower(btrim(coalesce(module_item ->> 'access_level', ''))) as access_level
            from jsonb_array_elements(
              case
                when jsonb_typeof(coalesce(p_modules, '[]'::jsonb)) = 'array' then coalesce(p_modules, '[]'::jsonb)
                else '[]'::jsonb
              end
            ) as module_item
            where jsonb_typeof(module_item) = 'object'
            order by lower(btrim(coalesce(module_item ->> 'module_key', '')))
          ) as prepared
          where prepared.module_key = allowed.module_key
            and prepared.access_level in ('hidden', 'view', 'operate')
          limit 1
        ),
        public.default_admin_module_access(v_role, allowed.module_key)
      ) as access_level
    from unnest(public.admin_module_keys()) as allowed(module_key)
  ) as normalized_modules;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_actor_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_actor_user_id) as identity_row
  limit 1;

  insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
  values (
    v_actor_display,
    'admin_access_save',
    null,
    'ob_admin_accounts',
    jsonb_build_object(
      'user_id', p_user_id,
      'role', v_role,
      'is_active', v_is_active,
      'managed_agencies', to_jsonb(v_managed_agencies),
      'modules', coalesce(p_modules, '[]'::jsonb),
      'position_scopes', v_position_scopes
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'role', v_role,
    'is_active', v_is_active,
    'managed_agencies', to_jsonb(v_managed_agencies),
    'position_scopes', v_position_scopes
  );
end;
$$;

do $$
begin
  if to_regclass('public.ob_employees') is not null then
    alter table public.ob_employees enable row level security;

    drop policy if exists ob_employees_position_select on public.ob_employees;
    create policy ob_employees_position_select
      on public.ob_employees
      for select
      to authenticated
      using (public.user_has_position_access('employees', public.employee_record_text(to_jsonb(ob_employees), 'position', 'Position'), 'view'));

    drop policy if exists ob_employees_position_insert on public.ob_employees;
    create policy ob_employees_position_insert
      on public.ob_employees
      for insert
      to authenticated
      with check (public.user_has_position_access('employees', public.employee_record_text(to_jsonb(ob_employees), 'position', 'Position'), 'operate'));

    drop policy if exists ob_employees_position_update on public.ob_employees;
    create policy ob_employees_position_update
      on public.ob_employees
      for update
      to authenticated
      using (public.user_has_position_access('employees', public.employee_record_text(to_jsonb(ob_employees), 'position', 'Position'), 'operate'))
      with check (public.user_has_position_access('employees', public.employee_record_text(to_jsonb(ob_employees), 'position', 'Position'), 'operate'));

    drop policy if exists ob_employees_position_delete on public.ob_employees;
    create policy ob_employees_position_delete
      on public.ob_employees
      for delete
      to authenticated
      using (public.user_has_position_access('employees', public.employee_record_text(to_jsonb(ob_employees), 'position', 'Position'), 'operate'));
  end if;

  if to_regclass('public.ob_schedules') is not null then
    alter table public.ob_schedules enable row level security;

    drop policy if exists ob_schedules_position_select on public.ob_schedules;
    create policy ob_schedules_position_select
      on public.ob_schedules
      for select
      to authenticated
      using (public.user_has_position_access('schedule', coalesce(nullif(btrim(position), ''), public.position_for_staff(staff_id)), 'view'));

    drop policy if exists ob_schedules_position_insert on public.ob_schedules;
    create policy ob_schedules_position_insert
      on public.ob_schedules
      for insert
      to authenticated
      with check (public.user_has_position_access('schedule', coalesce(nullif(btrim(position), ''), public.position_for_staff(staff_id)), 'operate'));

    drop policy if exists ob_schedules_position_update on public.ob_schedules;
    create policy ob_schedules_position_update
      on public.ob_schedules
      for update
      to authenticated
      using (public.user_has_position_access('schedule', coalesce(nullif(btrim(position), ''), public.position_for_staff(staff_id)), 'operate'))
      with check (public.user_has_position_access('schedule', coalesce(nullif(btrim(position), ''), public.position_for_staff(staff_id)), 'operate'));

    drop policy if exists ob_schedules_position_delete on public.ob_schedules;
    create policy ob_schedules_position_delete
      on public.ob_schedules
      for delete
      to authenticated
      using (public.user_has_position_access('schedule', coalesce(nullif(btrim(position), ''), public.position_for_staff(staff_id)), 'operate'));
  end if;

  if to_regclass('public.ob_attendance_marks') is not null then
    alter table public.ob_attendance_marks enable row level security;

    drop policy if exists ob_attendance_marks_timecard_select on public.ob_attendance_marks;
    create policy ob_attendance_marks_timecard_select
      on public.ob_attendance_marks
      for select
      to authenticated
      using (public.user_can_access_staff_position('timecard', staff_id, 'view'));

    drop policy if exists ob_attendance_marks_timecard_write on public.ob_attendance_marks;
    create policy ob_attendance_marks_timecard_write
      on public.ob_attendance_marks
      for all
      to authenticated
      using (public.user_can_access_staff_position('timecard', staff_id, 'operate'))
      with check (public.user_can_access_staff_position('timecard', staff_id, 'operate'));
  end if;

  if to_regclass('public.ob_punches') is not null then
    alter table public.ob_punches enable row level security;

    drop policy if exists ob_punches_timecard_select on public.ob_punches;
    create policy ob_punches_timecard_select
      on public.ob_punches
      for select
      to authenticated
      using (public.user_can_access_staff_position('timecard', staff_id, 'view'));

    drop policy if exists ob_punches_timecard_write on public.ob_punches;
    create policy ob_punches_timecard_write
      on public.ob_punches
      for all
      to authenticated
      using (public.user_can_access_staff_position('timecard', staff_id, 'operate'))
      with check (public.user_can_access_staff_position('timecard', staff_id, 'operate'));
  end if;
end
$$;

grant execute on function public.default_admin_position_scopes() to authenticated;
grant execute on function public.normalize_admin_position_scopes(jsonb) to authenticated;
grant execute on function public.list_positions() to authenticated;
grant execute on function public.save_position(text, integer, boolean, text) to authenticated;
grant execute on function public.position_for_staff(text) to authenticated;
grant execute on function public.user_has_position_access(text, text, text, uuid) to authenticated;
grant execute on function public.user_can_access_staff_position(text, text, text, uuid) to authenticated;
