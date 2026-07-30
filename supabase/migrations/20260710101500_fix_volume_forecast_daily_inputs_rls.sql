alter table public.volume_forecast_daily_inputs enable row level security;

grant select, insert, update on public.volume_forecast_daily_inputs to authenticated;

drop policy if exists volume_forecast_daily_inputs_forecast_select on public.volume_forecast_daily_inputs;
create policy volume_forecast_daily_inputs_forecast_select
  on public.volume_forecast_daily_inputs
  for select
  to authenticated
  using (public.user_has_module_access('forecast', 'view'));

drop policy if exists volume_forecast_daily_inputs_forecast_insert on public.volume_forecast_daily_inputs;
create policy volume_forecast_daily_inputs_forecast_insert
  on public.volume_forecast_daily_inputs
  for insert
  to authenticated
  with check (public.user_has_module_access('forecast', 'operate'));

drop policy if exists volume_forecast_daily_inputs_forecast_update on public.volume_forecast_daily_inputs;
create policy volume_forecast_daily_inputs_forecast_update
  on public.volume_forecast_daily_inputs
  for update
  to authenticated
  using (public.user_has_module_access('forecast', 'operate'))
  with check (public.user_has_module_access('forecast', 'operate'));
