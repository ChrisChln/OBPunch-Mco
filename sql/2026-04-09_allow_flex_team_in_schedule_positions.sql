do $$
begin
  if to_regclass('public.ob_schedules') is null then
    return;
  end if;

  update public.ob_schedules
  set position = 'FLEX TEAM'
  where lower(btrim(coalesce(position, ''))) in (
    '兜底组',
    '兜底',
    'wrap-up team',
    'wrap up team',
    'flex team（机动组）',
    'flex team',
    'flexteam',
    'fallback',
    'backup'
  );

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ob_schedules'::regclass
      and conname = 'ob_schedules_position_check'
  ) then
    execute 'alter table public.ob_schedules drop constraint ob_schedules_position_check';
  end if;

  execute $sql$
    alter table public.ob_schedules
    add constraint ob_schedules_position_check
    check (
      position is null
      or btrim(position) = any (
        array['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'FLEX TEAM']::text[]
      )
    )
  $sql$;
end
$$;
