create table if not exists public.ob_schedule_job_runs (
  job_key text not null,
  period_key text not null,
  status text not null default 'running',
  operator text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (job_key, period_key),
  constraint ob_schedule_job_runs_status_check check (status in ('running', 'done', 'failed'))
);

alter table public.ob_schedule_job_runs enable row level security;

grant select, insert, update on public.ob_schedule_job_runs to authenticated;

drop policy if exists ob_schedule_job_runs_authenticated_select on public.ob_schedule_job_runs;
create policy ob_schedule_job_runs_authenticated_select
  on public.ob_schedule_job_runs
  for select
  to authenticated
  using (true);

drop policy if exists ob_schedule_job_runs_schedule_operate_insert on public.ob_schedule_job_runs;
create policy ob_schedule_job_runs_schedule_operate_insert
  on public.ob_schedule_job_runs
  for insert
  to authenticated
  with check (public.user_has_module_access('schedule', 'operate'));

drop policy if exists ob_schedule_job_runs_schedule_operate_update on public.ob_schedule_job_runs;
create policy ob_schedule_job_runs_schedule_operate_update
  on public.ob_schedule_job_runs
  for update
  to authenticated
  using (public.user_has_module_access('schedule', 'operate'))
  with check (public.user_has_module_access('schedule', 'operate'));

do $$
begin
  if to_regclass('public.ob_app_settings') is not null then
    insert into public.ob_schedule_job_runs (job_key, period_key, status, operator, completed_at, updated_at)
    select
      'schedule_week_reset',
      value ->> 'week_start',
      'done',
      nullif(value ->> 'operator', ''),
      coalesce((value ->> 'updated_at')::timestamptz, updated_at, now()),
      coalesce((value ->> 'updated_at')::timestamptz, updated_at, now())
    from public.ob_app_settings
    where key = 'schedule_transient_reset_week'
      and nullif(value ->> 'week_start', '') is not null
    on conflict (job_key, period_key) do nothing;

    insert into public.ob_schedule_job_runs (job_key, period_key, status, operator, completed_at, updated_at)
    select
      'schedule_week_rollover',
      value ->> 'week_start',
      'done',
      nullif(value ->> 'operator', ''),
      coalesce((value ->> 'rolled_at')::timestamptz, updated_at, now()),
      coalesce((value ->> 'rolled_at')::timestamptz, updated_at, now())
    from public.ob_app_settings
    where key = 'schedule_week_rollover_marker'
      and nullif(value ->> 'week_start', '') is not null
    on conflict (job_key, period_key) do nothing;

    insert into public.ob_schedule_job_runs (job_key, period_key, status, operator, completed_at, updated_at)
    select
      'schedule_daily_plan_activation',
      value ->> 'date',
      case when value ->> 'status' = 'done' then 'done' else 'failed' end,
      nullif(value ->> 'operator', ''),
      coalesce((value ->> 'updated_at')::timestamptz, updated_at, now()),
      coalesce((value ->> 'updated_at')::timestamptz, updated_at, now())
    from public.ob_app_settings
    where key = 'schedule_daily_plan_activation_marker'
      and nullif(value ->> 'date', '') is not null
    on conflict (job_key, period_key) do nothing;
  end if;
end
$$;
