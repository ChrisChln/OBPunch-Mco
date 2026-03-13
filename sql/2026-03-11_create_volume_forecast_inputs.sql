create table if not exists public.volume_forecast_daily_inputs (
  input_date date primary key,
  weekday int generated always as (extract(isodow from input_date)::int) stored,
  previous_day_backlog int not null default 0,
  current_cumulative_volume_12 int not null default 0,
  inventory_level int not null default 0,
  severe_weather boolean not null default false,
  full_day_capacity int not null default 0,
  yesterday_inflow_00_14 int not null default 0,
  actual_day_shift_plan int null,
  actual_night_shift_plan int null,
  updated_by text null,
  updated_at timestamptz not null default now(),
  constraint volume_forecast_daily_inputs_weekday_chk check (weekday between 1 and 7),
  constraint volume_forecast_daily_inputs_previous_day_backlog_chk check (previous_day_backlog >= 0),
  constraint volume_forecast_daily_inputs_current_cumulative_volume_12_chk check (current_cumulative_volume_12 >= 0),
  constraint volume_forecast_daily_inputs_inventory_level_chk check (inventory_level >= 0),
  constraint volume_forecast_daily_inputs_full_day_capacity_chk check (full_day_capacity >= 0),
  constraint volume_forecast_daily_inputs_yesterday_inflow_00_14_chk check (yesterday_inflow_00_14 >= 0),
  constraint volume_forecast_daily_inputs_actual_day_shift_plan_chk check (actual_day_shift_plan is null or actual_day_shift_plan >= 0),
  constraint volume_forecast_daily_inputs_actual_night_shift_plan_chk check (actual_night_shift_plan is null or actual_night_shift_plan >= 0)
);

create index if not exists volume_forecast_daily_inputs_weekday_date_idx
  on public.volume_forecast_daily_inputs (weekday, input_date desc);

create or replace function public.touch_volume_forecast_daily_inputs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists volume_forecast_daily_inputs_set_updated_at on public.volume_forecast_daily_inputs;

create trigger volume_forecast_daily_inputs_set_updated_at
before update on public.volume_forecast_daily_inputs
for each row
execute function public.touch_volume_forecast_daily_inputs_updated_at();
