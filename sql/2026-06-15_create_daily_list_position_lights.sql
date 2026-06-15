create table if not exists public.ob_daily_list_position_lights (
  work_date date not null,
  position text not null,
  enabled boolean not null default false,
  operator text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (work_date, position)
);

create index if not exists ob_daily_list_position_lights_date_idx
  on public.ob_daily_list_position_lights (work_date);

alter table public.ob_daily_list_position_lights enable row level security;

grant select, insert, update on public.ob_daily_list_position_lights to authenticated;

drop policy if exists ob_daily_list_position_lights_authenticated_select on public.ob_daily_list_position_lights;
create policy ob_daily_list_position_lights_authenticated_select
  on public.ob_daily_list_position_lights
  for select
  to authenticated
  using (true);

drop policy if exists ob_daily_list_position_lights_schedule_operate_write on public.ob_daily_list_position_lights;
create policy ob_daily_list_position_lights_schedule_operate_write
  on public.ob_daily_list_position_lights
  for insert
  to authenticated
  with check (public.user_has_module_access('schedule', 'operate'));

drop policy if exists ob_daily_list_position_lights_schedule_operate_update on public.ob_daily_list_position_lights;
create policy ob_daily_list_position_lights_schedule_operate_update
  on public.ob_daily_list_position_lights
  for update
  to authenticated
  using (public.user_has_module_access('schedule', 'operate'))
  with check (public.user_has_module_access('schedule', 'operate'));

do $$
begin
  if to_regclass('public.ob_app_settings') is not null then
    insert into public.ob_daily_list_position_lights (work_date, position, enabled, operator, updated_at)
    select
      date_key::date,
      position_entry.key,
      case
        when jsonb_typeof(position_entry.value) = 'boolean' then (position_entry.value #>> '{}')::boolean
        else false
      end,
      nullif(public.ob_app_settings.value ->> 'operator', ''),
      coalesce((public.ob_app_settings.value ->> 'updated_at')::timestamptz, now())
    from public.ob_app_settings
    cross join lateral jsonb_each(public.ob_app_settings.value -> 'selected_by_date') as date_entry(date_key, flags)
    cross join lateral jsonb_each(date_entry.flags) as position_entry(key, value)
    where public.ob_app_settings.key = 'daily_list_position_lights'
      and jsonb_typeof(public.ob_app_settings.value -> 'selected_by_date') = 'object'
    on conflict (work_date, position) do update
    set
      enabled = excluded.enabled,
      operator = excluded.operator,
      updated_at = excluded.updated_at;
  end if;
end
$$;
