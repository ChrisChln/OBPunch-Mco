alter table public.ob_temp_account_assignments
  add column if not exists source_temp_staff_id text null;

create unique index if not exists ob_temp_account_assignments_source_temp_staff_key
  on public.ob_temp_account_assignments (source_temp_staff_id)
  where source_temp_staff_id is not null;

do $$
declare
  v_table record;
  v_max_tus_number int := 0;
begin
  create temporary table if not exists tmp_unmapped_temp_staff_ids (
    old_staff_id text primary key
  ) on commit drop;

  create temporary table if not exists tmp_temp_staff_id_aliases (
    old_staff_id text primary key,
    new_staff_id text not null unique
  ) on commit drop;

  truncate table tmp_unmapped_temp_staff_ids;
  truncate table tmp_temp_staff_id_aliases;

  for v_table in
    select table_schema, table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'staff_id'
      and data_type in ('text', 'character varying')
    order by table_name
  loop
    execute format(
      'insert into tmp_unmapped_temp_staff_ids (old_staff_id)
       select distinct target.staff_id
       from %I.%I as target
       where target.staff_id like %L
         and not exists (
           select 1
           from public.ob_temp_account_assignments as assignment
           where assignment.source_temp_staff_id = target.staff_id
         )
       on conflict (old_staff_id) do nothing',
      v_table.table_schema,
      v_table.table_name,
      'TEMP%'
    );
  end loop;

  if not exists (select 1 from tmp_unmapped_temp_staff_ids) then
    return;
  end if;

  select coalesce(max(substring(employee.staff_id from 4)::int), 0)
    into v_max_tus_number
  from public.ob_employees as employee
  where employee.staff_id like 'TUS%'
    and substring(employee.staff_id from 4) ~ '^[0-9]+$';

  insert into tmp_temp_staff_id_aliases (old_staff_id, new_staff_id)
  select
    source.old_staff_id,
    'TUS' || lpad((v_max_tus_number + row_number() over (order by source.old_staff_id))::text, 7, '0') as new_staff_id
  from tmp_unmapped_temp_staff_ids as source;

  insert into public.ob_employees (staff_id, name, employment_type, active, created_at, updated_at)
  select alias.new_staff_id, alias.new_staff_id, 'FT', true, now(), now()
  from tmp_temp_staff_id_aliases as alias
  where not exists (
    select 1
    from public.ob_employees as employee
    where employee.staff_id = alias.new_staff_id
  );

  for v_table in
    select table_schema, table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'staff_id'
      and data_type in ('text', 'character varying')
    order by table_name
  loop
    if v_table.table_name = 'ob_punches' then
      alter table public.ob_punches disable trigger user;
    end if;

    execute format(
      'update %I.%I as target
          set staff_id = alias.new_staff_id
         from tmp_temp_staff_id_aliases as alias
        where target.staff_id = alias.old_staff_id',
      v_table.table_schema,
      v_table.table_name
    );

    if v_table.table_name = 'ob_punches' then
      alter table public.ob_punches enable trigger user;
    end if;
  end loop;

  insert into public.ob_temp_account_assignments (
    staff_id,
    work_account,
    source_temp_staff_id,
    window_start,
    window_end,
    is_active,
    released_at,
    release_reason,
    created_at,
    updated_at
  )
  select
    alias.new_staff_id,
    alias.old_staff_id,
    alias.old_staff_id,
    now(),
    timestamp with time zone '9999-12-31 23:59:59+00',
    false,
    now(),
    'legacy_staff_id_alias',
    now(),
    now()
  from tmp_temp_staff_id_aliases as alias
  where not exists (
    select 1
    from public.ob_temp_account_assignments as existing_assignment
    where existing_assignment.source_temp_staff_id = alias.old_staff_id
  );
end $$;
