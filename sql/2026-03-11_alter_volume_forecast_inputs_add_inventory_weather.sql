alter table public.volume_forecast_daily_inputs
  add column if not exists inventory_level int not null default 0;

alter table public.volume_forecast_daily_inputs
  add column if not exists severe_weather boolean not null default false;

alter table public.volume_forecast_daily_inputs
  drop constraint if exists volume_forecast_daily_inputs_inventory_level_chk;

alter table public.volume_forecast_daily_inputs
  add constraint volume_forecast_daily_inputs_inventory_level_chk
  check (inventory_level >= 0);
