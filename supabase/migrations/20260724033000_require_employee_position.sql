do $$
declare
  v_agency_col text;
  v_position_col text;
  v_default_position text := 'JDL';
  v_has_blank_position boolean := false;
begin
  select column_name
  into v_agency_col
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ob_employees'
    and lower(column_name) = 'agency'
  order by case when column_name = 'agency' then 0 else 1 end
  limit 1;

  select column_name
  into v_position_col
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ob_employees'
    and lower(column_name) = 'position'
  order by case when column_name = 'position' then 0 else 1 end
  limit 1;

  if v_agency_col is null or v_position_col is null then
    raise exception 'Agency or position column was not found on public.ob_employees.';
  end if;

  perform set_config('app.allow_jdl_employee_write', 'true', true);

  execute format(
    'update public.ob_employees
     set %1$I = $1
     where upper(btrim(coalesce(%2$I::text, ''''))) in (''JDL'', ''自顾'')
       and btrim(coalesce(%1$I::text, '''')) = ''''',
    v_position_col,
    v_agency_col
  )
  using v_default_position;

  execute 'alter table public.ob_employees drop constraint if exists ob_employees_position_required_check';
  execute format(
    'alter table public.ob_employees
     add constraint ob_employees_position_required_check
     check (btrim(coalesce(%I::text, '''')) <> '''') not valid',
    v_position_col
  );

  execute format(
    'select exists (
       select 1
       from public.ob_employees
       where btrim(coalesce(%I::text, '''')) = ''''
     )',
    v_position_col
  )
  into v_has_blank_position;

  if not v_has_blank_position then
    alter table public.ob_employees
      validate constraint ob_employees_position_required_check;
  end if;
end;
$$;

create or replace function public.require_employee_position()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_agency text := upper(btrim(coalesce(
    to_jsonb(new) ->> 'agency',
    to_jsonb(new) ->> 'Agency',
    ''
  )));
  v_position text := btrim(coalesce(
    to_jsonb(new) ->> 'position',
    to_jsonb(new) ->> 'Position',
    ''
  ));
  v_default_position text := 'JDL';
begin
  if v_position <> '' then
    return new;
  end if;

  if v_agency in ('JDL', '自顾') then
    if to_jsonb(new) ? 'position' then
      new := jsonb_populate_record(new, jsonb_build_object('position', v_default_position));
    elsif to_jsonb(new) ? 'Position' then
      new := jsonb_populate_record(new, jsonb_build_object('Position', v_default_position));
    else
      raise exception 'Position column was not found on public.ob_employees.';
    end if;
    return new;
  end if;

  raise exception 'Position is required.';
end;
$$;

drop trigger if exists require_employee_position_before_write on public.ob_employees;
create trigger require_employee_position_before_write
before insert or update on public.ob_employees
for each row
execute function public.require_employee_position();
