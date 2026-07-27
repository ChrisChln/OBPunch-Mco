begin;

lock table public.ob_employees in access exclusive mode;

do $$
declare
  v_missing_columns text[];
begin
  select array_agg(expected.column_name order by expected.column_name)
  into v_missing_columns
  from (
    values ('Agency'), ('agency'), ('Position'), ('position')
  ) as expected(column_name)
  where not exists (
    select 1
    from information_schema.columns as actual
    where actual.table_schema = 'public'
      and actual.table_name = 'ob_employees'
      and actual.column_name = expected.column_name
  );

  if coalesce(array_length(v_missing_columns, 1), 0) > 0 then
    raise exception 'Employee metadata consolidation requires all four source columns. Missing: %',
      array_to_string(v_missing_columns, ', ');
  end if;

  if to_regclass('public.ob_employee_metadata_column_backup_20260727') is not null then
    raise exception 'Employee metadata backup table already exists.';
  end if;
end
$$;

create table public.ob_employee_metadata_column_backup_20260727 as
select
  staff_id,
  "Agency" as legacy_agency,
  agency as lowercase_agency,
  "Position" as legacy_position,
  position as lowercase_position,
  created_at as employee_created_at,
  updated_at as employee_updated_at,
  clock_timestamp() as backed_up_at
from public.ob_employees;

comment on table public.ob_employee_metadata_column_backup_20260727 is
  'Pre-consolidation backup of duplicate ob_employees Agency and Position fields.';

alter table public.ob_employee_metadata_column_backup_20260727
  enable row level security;

revoke all privileges
  on table public.ob_employee_metadata_column_backup_20260727
  from public, anon, authenticated;

drop trigger if exists require_employee_position_before_write on public.ob_employees;
drop trigger if exists sync_ob_employee_position_columns on public.ob_employees;

alter table public.ob_employees
  drop constraint if exists ob_employees_position_required_check,
  drop constraint if exists ob_employees_position_columns_match;

drop function if exists public.sync_ob_employee_position_columns();

update public.ob_employees as employee
set
  agency = coalesce(nullif(btrim(employee."Agency"), ''), nullif(btrim(employee.agency), '')),
  position = coalesce(nullif(btrim(employee."Position"), ''), nullif(btrim(employee.position), ''));

do $$
declare
  v_blank_position_count bigint;
  v_source_count bigint;
  v_backup_count bigint;
begin
  select count(*)
  into v_blank_position_count
  from public.ob_employees
  where nullif(btrim(position), '') is null;

  if v_blank_position_count > 0 then
    raise exception 'Position consolidation left blank values. Count: %', v_blank_position_count;
  end if;

  select count(*) into v_source_count from public.ob_employees;
  select count(*) into v_backup_count from public.ob_employee_metadata_column_backup_20260727;

  if v_source_count <> v_backup_count then
    raise exception 'Employee metadata backup row count mismatch. Source: %, backup: %',
      v_source_count,
      v_backup_count;
  end if;
end
$$;

alter table public.ob_employees
  drop column "Agency",
  drop column "Position";

alter table public.ob_employees
  add constraint ob_employees_position_required_check
  check (nullif(btrim(position), '') is not null)
  not valid;

alter table public.ob_employees
  validate constraint ob_employees_position_required_check;

create or replace function public.require_employee_position()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_agency text := upper(btrim(coalesce(new.agency, '')));
  v_position text := nullif(btrim(coalesce(new.position, '')), '');
begin
  new.agency := nullif(btrim(coalesce(new.agency, '')), '');

  if v_position is null then
    if v_agency in ('JDL', '自顾') then
      v_position := 'JDL';
    else
      raise exception 'Position is required.';
    end if;
  end if;

  new.position := v_position;
  return new;
end;
$$;

create trigger require_employee_position_before_write
before insert or update of agency, position on public.ob_employees
for each row
execute function public.require_employee_position();

comment on column public.ob_employees.agency is
  'Canonical employee agency.';

comment on column public.ob_employees.position is
  'Canonical required employee position.';

select pg_notify('pgrst', 'reload schema');

commit;
