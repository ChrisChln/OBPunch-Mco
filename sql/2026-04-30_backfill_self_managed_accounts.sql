do $$
declare
  v_agency_col text := null;
  v_active_col text := null;
  v_created_at_col text := null;
  v_updated_at_col text := null;
  v_insert_columns text;
  v_select_columns text;
  v_update_set text;
begin
  select c.column_name
  into v_agency_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'agency'
  order by case when c.column_name = 'agency' then 0 else 1 end
  limit 1;

  select c.column_name
  into v_active_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'active'
  order by case when c.column_name = 'active' then 0 else 1 end
  limit 1;

  select c.column_name
  into v_created_at_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'created_at'
  order by case when c.column_name = 'created_at' then 0 else 1 end
  limit 1;

  select c.column_name
  into v_updated_at_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'updated_at'
  order by case when c.column_name = 'updated_at' then 0 else 1 end
  limit 1;

  if v_agency_col is null then
    raise exception 'Agency column was not found on public.ob_employees.';
  end if;

  create temporary table if not exists tmp_self_managed_account_employees (
    staff_id text primary key,
    display_name text not null
  ) on commit drop;
  truncate tmp_self_managed_account_employees;

  execute format(
    $sql$
      insert into tmp_self_managed_account_employees (staff_id, display_name)
      with source_accounts as (
        select
          auth_user.id as user_id,
          nullif(btrim(coalesce(auth_user.email, '')), '') as email,
          coalesce(public.resolve_admin_role_for_user(auth_user.id), 'level3') as effective_role
        from auth.users as auth_user
      ),
      prepared as (
        select
          source_accounts.user_id,
          source_accounts.email,
          coalesce(
            nullif(upper(regexp_replace(split_part(source_accounts.email, '@', 1), '[^A-Za-z0-9]', '', 'g')), ''),
            'USER' || upper(left(replace(source_accounts.user_id::text, '-', ''), 8))
          ) as base_staff_id,
          coalesce(
            nullif(btrim(coalesce(profile.display_name, '')), ''),
            nullif(btrim(source_accounts.email), ''),
            source_accounts.user_id::text
          ) as display_name,
          row_number() over (
            partition by coalesce(
              nullif(upper(regexp_replace(split_part(source_accounts.email, '@', 1), '[^A-Za-z0-9]', '', 'g')), ''),
              'USER' || upper(left(replace(source_accounts.user_id::text, '-', ''), 8))
            )
            order by coalesce(source_accounts.email, source_accounts.user_id::text), source_accounts.user_id
          ) as base_rank
        from source_accounts
        left join public.ob_user_profiles as profile
          on profile.user_id = source_accounts.user_id
        where source_accounts.effective_role <> 'agency'
      ),
      resolved as (
        select
          case
            when prepared.base_rank = 1
              and not exists (
                select 1
                from public.ob_employees as employee_row
                where employee_row.staff_id = prepared.base_staff_id
                  and coalesce(nullif(btrim(employee_row.%I), ''), '') not in ('JDL', '自顾')
              )
            then prepared.base_staff_id
            else prepared.base_staff_id || upper(left(replace(prepared.user_id::text, '-', ''), 8))
          end as staff_id,
          prepared.display_name
        from prepared
      )
      select distinct on (resolved.staff_id)
        resolved.staff_id,
        resolved.display_name
      from resolved
      where resolved.staff_id <> ''
      order by resolved.staff_id, resolved.display_name
    $sql$,
    v_agency_col
  );

  v_insert_columns := 'staff_id, name, ' || quote_ident(v_agency_col);
  v_select_columns := 'staff_id, display_name, ''JDL''';
  v_update_set := format('%I = excluded.%I', v_agency_col, v_agency_col);

  if v_active_col is not null then
    v_insert_columns := v_insert_columns || ', ' || quote_ident(v_active_col);
    v_select_columns := v_select_columns || ', true';
    v_update_set := v_update_set || format(', %I = true', v_active_col);
  end if;

  if v_created_at_col is not null then
    v_insert_columns := v_insert_columns || ', ' || quote_ident(v_created_at_col);
    v_select_columns := v_select_columns || ', now()';
  end if;

  if v_updated_at_col is not null then
    v_insert_columns := v_insert_columns || ', ' || quote_ident(v_updated_at_col);
    v_select_columns := v_select_columns || ', now()';
    v_update_set := v_update_set || format(', %I = now()', v_updated_at_col);
  end if;

  perform set_config('app.allow_jdl_employee_write', 'true', true);

  execute format(
    'insert into public.ob_employees (%s)
     select %s
     from tmp_self_managed_account_employees
     on conflict (staff_id) do update
     set %s',
    v_insert_columns,
    v_select_columns,
    v_update_set
  );
end;
$$;

create or replace function public.ensure_jdl_employee_for_admin_user(
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency_col text := null;
  v_active_col text := null;
  v_created_at_col text := null;
  v_updated_at_col text := null;
  v_insert_columns text;
  v_select_values text;
  v_update_set text;
  v_email text := '';
  v_display_name text := '';
  v_effective_role text := '';
  v_base_staff_id text := '';
  v_staff_id text := '';
begin
  if p_user_id is null then
    return null;
  end if;

  select c.column_name
  into v_agency_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'agency'
  order by case when c.column_name = 'agency' then 0 else 1 end
  limit 1;

  if v_agency_col is null then
    raise exception 'Agency column was not found on public.ob_employees.';
  end if;

  select c.column_name
  into v_active_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'active'
  order by case when c.column_name = 'active' then 0 else 1 end
  limit 1;

  select c.column_name
  into v_created_at_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'created_at'
  order by case when c.column_name = 'created_at' then 0 else 1 end
  limit 1;

  select c.column_name
  into v_updated_at_col
  from information_schema.columns as c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'updated_at'
  order by case when c.column_name = 'updated_at' then 0 else 1 end
  limit 1;

  select
    nullif(btrim(coalesce(auth_user.email, '')), ''),
    coalesce(public.resolve_admin_role_for_user(auth_user.id), 'level3')
  into v_email, v_effective_role
  from auth.users as auth_user
  where auth_user.id = p_user_id
  limit 1;

  if v_email is null and v_effective_role is null then
    return null;
  end if;
  if v_effective_role = 'agency' then
    return null;
  end if;

  select coalesce(
    nullif(btrim(coalesce(profile.display_name, '')), ''),
    nullif(btrim(coalesce(v_email, '')), ''),
    p_user_id::text
  )
  into v_display_name
  from public.ob_user_profiles as profile
  where profile.user_id = p_user_id
  limit 1;

  v_display_name := coalesce(nullif(v_display_name, ''), nullif(v_email, ''), p_user_id::text);
  v_base_staff_id := coalesce(
    nullif(upper(regexp_replace(split_part(v_email, '@', 1), '[^A-Za-z0-9]', '', 'g')), ''),
    'USER' || upper(left(replace(p_user_id::text, '-', ''), 8))
  );

  execute format(
    'select case
       when not exists (
         select 1
         from public.ob_employees as employee_row
         where employee_row.staff_id = $1
           and coalesce(nullif(btrim(employee_row.%I), ''''), '''') not in (''JDL'', ''自顾'')
       )
       then $1
       else $1 || upper(left(replace($2::text, ''-'', ''''), 8))
     end',
    v_agency_col
  )
  using v_base_staff_id, p_user_id
  into v_staff_id;

  v_insert_columns := 'staff_id, name, ' || quote_ident(v_agency_col);
  v_select_values := '$1, $2, ''JDL''';
  v_update_set := format('%I = excluded.%I', v_agency_col, v_agency_col);

  if v_active_col is not null then
    v_insert_columns := v_insert_columns || ', ' || quote_ident(v_active_col);
    v_select_values := v_select_values || ', true';
    v_update_set := v_update_set || format(', %I = true', v_active_col);
  end if;

  if v_created_at_col is not null then
    v_insert_columns := v_insert_columns || ', ' || quote_ident(v_created_at_col);
    v_select_values := v_select_values || ', now()';
  end if;

  if v_updated_at_col is not null then
    v_insert_columns := v_insert_columns || ', ' || quote_ident(v_updated_at_col);
    v_select_values := v_select_values || ', now()';
    v_update_set := v_update_set || format(', %I = now()', v_updated_at_col);
  end if;

  perform set_config('app.allow_jdl_employee_write', 'true', true);

  execute format(
    'insert into public.ob_employees (%s)
     values (%s)
     on conflict (staff_id) do update
     set %s',
    v_insert_columns,
    v_select_values,
    v_update_set
  )
  using v_staff_id, v_display_name;

  return v_staff_id;
end;
$$;

create or replace function public.sync_jdl_employee_after_auth_user_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.ensure_jdl_employee_for_admin_user(new.id);
  return new;
end;
$$;

drop trigger if exists sync_jdl_employee_after_auth_user_insert on auth.users;
create trigger sync_jdl_employee_after_auth_user_insert
after insert on auth.users
for each row
execute function public.sync_jdl_employee_after_auth_user_insert();

create or replace function public.protect_jdl_employee_records()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_agency text := coalesce(
    nullif(btrim(coalesce(to_jsonb(old) ->> 'agency', '')), ''),
    nullif(btrim(coalesce(to_jsonb(old) ->> 'Agency', '')), ''),
    ''
  );
  v_new_agency text := '';
  v_new_active text := '';
  v_old_terminated_at text := '';
  v_new_terminated_at text := '';
begin
  if tg_op = 'INSERT' then
    v_new_agency := coalesce(
      nullif(btrim(coalesce(to_jsonb(new) ->> 'agency', '')), ''),
      nullif(btrim(coalesce(to_jsonb(new) ->> 'Agency', '')), ''),
      ''
    );
    if v_new_agency in ('JDL', '自顾')
      and coalesce(current_setting('app.allow_jdl_employee_write', true), '') <> 'true'
    then
      raise exception 'JDL employee records can only be created by auth registration.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_old_agency in ('JDL', '自顾') then
      raise exception 'JDL employee records cannot be deleted.';
    end if;
    return old;
  end if;

  v_new_agency := coalesce(
    nullif(btrim(coalesce(to_jsonb(new) ->> 'agency', '')), ''),
    nullif(btrim(coalesce(to_jsonb(new) ->> 'Agency', '')), ''),
    ''
  );
  v_new_active := lower(btrim(coalesce(to_jsonb(new) ->> 'active', to_jsonb(new) ->> 'Active', '')));
  v_old_terminated_at := btrim(coalesce(to_jsonb(old) ->> 'terminated_at', to_jsonb(old) ->> 'TerminatedAt', ''));
  v_new_terminated_at := btrim(coalesce(to_jsonb(new) ->> 'terminated_at', to_jsonb(new) ->> 'TerminatedAt', ''));

  if v_old_agency not in ('JDL', '自顾')
    and v_new_agency in ('JDL', '自顾')
    and coalesce(current_setting('app.allow_jdl_employee_write', true), '') <> 'true'
  then
    raise exception 'JDL employee records can only be created by auth registration.';
  end if;

  if v_old_agency = 'JDL' and v_new_agency <> 'JDL' then
    raise exception 'JDL employee agency cannot be changed.';
  end if;

  if v_old_agency = '自顾' and v_new_agency not in ('JDL', '自顾') then
    raise exception 'JDL employee agency cannot be changed.';
  end if;

  if v_old_agency in ('JDL', '自顾')
    and (
      v_new_active in ('false', 'f', '0', 'no')
      or (v_new_terminated_at <> '' and v_new_terminated_at <> v_old_terminated_at)
    )
  then
    raise exception 'JDL employee records cannot be deleted.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_jdl_employee_records on public.ob_employees;
create trigger protect_jdl_employee_records
before insert or update or delete on public.ob_employees
for each row
execute function public.protect_jdl_employee_records();
