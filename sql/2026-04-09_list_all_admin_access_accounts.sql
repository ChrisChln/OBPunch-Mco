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
          module_key,
          coalesce(
            (
              select override_row.access_level
              from public.ob_admin_account_modules as override_row
              where override_row.user_id = account.user_id
                and override_row.module_key = module_key
              limit 1
            ),
            public.default_admin_module_access(account.effective_role, module_key)
          ) as access_level
        from unnest(public.admin_module_keys()) as module_key
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
