do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ob_employees'
      and column_name = 'Agency'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ob_employees'
      and column_name = 'agency'
  ) then
    alter table public.ob_employees
      add column agency text generated always as ("Agency") stored;

    comment on column public.ob_employees.agency is
      'Lowercase compatibility alias for the legacy "Agency" column.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ob_employees'
      and column_name = 'Position'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ob_employees'
      and column_name = 'position'
  ) then
    alter table public.ob_employees
      add column position text generated always as ("Position") stored;

    comment on column public.ob_employees.position is
      'Lowercase compatibility alias for the legacy "Position" column.';
  end if;
end
$$;
