create or replace function public.admin_module_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'home',
    'employees',
    'accounts',
    'permissions',
    'timecard',
    'leave_approval',
    'todo',
    'punches',
    'audit',
    'schedule',
    'devices',
    'forecast',
    'prediction_model',
    'efficiency',
    'agency'
  ]::text[];
$$;

create or replace function public.default_admin_module_access(
  p_role text,
  p_module_key text
)
returns text
language sql
immutable
as $$
  select case
    when p_role in ('level1', 'level2') then 'operate'
    when p_role = 'level3' then 'view'
    when p_role = 'agency' then case when p_module_key in ('agency', 'permissions') then 'view' else 'hidden' end
    else 'hidden'
  end;
$$;

create or replace function public.save_admin_access_account(
  p_user_id uuid,
  p_role text,
  p_is_active boolean default true,
  p_managed_agencies text[] default '{}'::text[],
  p_modules jsonb default '[]'::jsonb
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
    created_at,
    updated_at
  )
  values (
    p_user_id,
    v_role,
    v_is_active,
    v_managed_agencies,
    now(),
    now()
  )
  on conflict (user_id) do update
  set
    role = excluded.role,
    is_active = excluded.is_active,
    managed_agencies = excluded.managed_agencies,
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
      'modules', coalesce(p_modules, '[]'::jsonb)
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'role', v_role,
    'is_active', v_is_active,
    'managed_agencies', to_jsonb(v_managed_agencies)
  );
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
  v_modules jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;

  v_role := public.resolve_admin_role_for_user(v_user_id);

  select coalesce(account.managed_agencies, '{}'::text[])
  into v_managed_agencies
  from public.ob_admin_accounts as account
  where account.user_id = v_user_id
    and account.is_active = true
  limit 1;

  select coalesce(account.is_active, false)
  into v_is_active
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
    'modules', v_modules
  );
end;
$$;

create or replace function public.list_admin_access_accounts()
returns table (
  user_id uuid,
  user_email text,
  display_name text,
  role text,
  is_active boolean,
  managed_agencies text[],
  modules jsonb
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
    ) as modules
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
