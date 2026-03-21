alter table public.volume_forecast_daily_inputs
  add column if not exists major_promotion boolean not null default false;

comment on column public.volume_forecast_daily_inputs.major_promotion is 'Whether the date is a major promotion day.';
