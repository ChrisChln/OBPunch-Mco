alter table public.volume_history enable row level security;

grant select, insert, update on public.volume_history to authenticated;

drop policy if exists volume_history_forecast_select on public.volume_history;
create policy volume_history_forecast_select
  on public.volume_history
  for select
  to authenticated
  using (public.user_has_module_access('forecast', 'view'));

drop policy if exists volume_history_forecast_insert on public.volume_history;
create policy volume_history_forecast_insert
  on public.volume_history
  for insert
  to authenticated
  with check (public.user_has_module_access('forecast', 'operate'));

drop policy if exists volume_history_forecast_update on public.volume_history;
create policy volume_history_forecast_update
  on public.volume_history
  for update
  to authenticated
  using (public.user_has_module_access('forecast', 'operate'))
  with check (public.user_has_module_access('forecast', 'operate'));

