alter table public.volume_forecast_daily_inputs
  add column if not exists actual_day_shift_plan int null;

alter table public.volume_forecast_daily_inputs
  add column if not exists actual_night_shift_plan int null;

alter table public.volume_forecast_daily_inputs
  drop constraint if exists volume_forecast_daily_inputs_actual_day_shift_plan_chk;

alter table public.volume_forecast_daily_inputs
  add constraint volume_forecast_daily_inputs_actual_day_shift_plan_chk
  check (actual_day_shift_plan is null or actual_day_shift_plan >= 0);

alter table public.volume_forecast_daily_inputs
  drop constraint if exists volume_forecast_daily_inputs_actual_night_shift_plan_chk;

alter table public.volume_forecast_daily_inputs
  add constraint volume_forecast_daily_inputs_actual_night_shift_plan_chk
  check (actual_night_shift_plan is null or actual_night_shift_plan >= 0);
