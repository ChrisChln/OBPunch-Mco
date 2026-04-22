alter table public.ob_package_daily_metrics
  add column if not exists calendar_inbound_final_hour_present boolean null;
