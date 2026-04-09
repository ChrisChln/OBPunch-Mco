alter table public.ob_employees
  add column if not exists employment_type text;

update public.ob_employees
set employment_type = 'FT'
where coalesce(btrim(employment_type), '') = '';

alter table public.ob_employees
  alter column employment_type set default 'FT';

alter table public.ob_employees
  alter column employment_type set not null;

alter table public.ob_employees
  drop constraint if exists ob_employees_employment_type_check;

alter table public.ob_employees
  add constraint ob_employees_employment_type_check
  check (employment_type in ('FT', 'PT'));
