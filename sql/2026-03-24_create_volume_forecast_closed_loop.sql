create table if not exists public.volume_forecast_runs (
  id bigint generated always as identity primary key,
  run_type text not null default 'official',
  target_date date not null,
  cutoff_mode text not null default 'preopen',
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  code_version text null,
  training_window_start date null,
  training_window_end date null,
  recommendation_json jsonb not null default '{}'::jsonb,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint volume_forecast_runs_run_type_chk check (run_type in ('official', 'manual', 'backfill')),
  constraint volume_forecast_runs_cutoff_mode_chk check (cutoff_mode in ('preopen')),
  constraint volume_forecast_runs_status_chk check (status in ('running', 'succeeded', 'failed'))
);

create index if not exists volume_forecast_runs_target_date_idx
  on public.volume_forecast_runs (target_date desc, cutoff_mode, status);

create table if not exists public.volume_forecast_feature_snapshots (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.volume_forecast_runs(id) on delete cascade,
  target_date date not null,
  cutoff_mode text not null default 'preopen',
  snapshot_at timestamptz not null default now(),
  feature_version text not null,
  raw_inputs_json jsonb not null default '{}'::jsonb,
  features_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint volume_forecast_feature_snapshots_cutoff_mode_chk check (cutoff_mode in ('preopen')),
  constraint volume_forecast_feature_snapshots_run_target_uniq unique (run_id, target_date, cutoff_mode)
);

create index if not exists volume_forecast_feature_snapshots_target_date_idx
  on public.volume_forecast_feature_snapshots (target_date desc, cutoff_mode);

create table if not exists public.volume_forecast_predictions (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.volume_forecast_runs(id) on delete cascade,
  target_date date not null,
  cutoff_mode text not null default 'preopen',
  candidate_scope text not null,
  candidate_key text not null,
  candidate_label text not null,
  forecast_value numeric(14, 2) not null,
  training_samples int not null default 0,
  metrics_json jsonb not null default '{}'::jsonb,
  is_recommended boolean not null default false,
  created_at timestamptz not null default now(),
  constraint volume_forecast_predictions_cutoff_mode_chk check (cutoff_mode in ('preopen')),
  constraint volume_forecast_predictions_scope_chk check (candidate_scope in ('model', 'version')),
  constraint volume_forecast_predictions_run_candidate_uniq unique (run_id, candidate_scope, candidate_key)
);

create index if not exists volume_forecast_predictions_target_date_idx
  on public.volume_forecast_predictions (target_date desc, cutoff_mode, candidate_scope);

create table if not exists public.volume_forecast_evaluations (
  id bigint generated always as identity primary key,
  prediction_id bigint not null references public.volume_forecast_predictions(id) on delete cascade,
  actual_value numeric(14, 2) not null,
  abs_error numeric(14, 2) not null,
  variance_pct numeric(12, 6) null,
  ape numeric(12, 6) null,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint volume_forecast_evaluations_prediction_uniq unique (prediction_id)
);

create index if not exists volume_forecast_evaluations_evaluated_at_idx
  on public.volume_forecast_evaluations (evaluated_at desc);

create table if not exists public.volume_forecast_publications (
  id bigint generated always as identity primary key,
  target_date date not null,
  cutoff_mode text not null default 'preopen',
  run_id bigint null references public.volume_forecast_runs(id) on delete set null,
  recommended_prediction_id bigint null references public.volume_forecast_predictions(id) on delete set null,
  selected_prediction_id bigint null references public.volume_forecast_predictions(id) on delete set null,
  recommended_forecast numeric(14, 2) null,
  published_forecast numeric(14, 2) null,
  is_manual_override boolean not null default false,
  override_reason text null,
  published_by text null,
  published_at timestamptz null,
  status text not null default 'pending_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint volume_forecast_publications_cutoff_mode_chk check (cutoff_mode in ('preopen')),
  constraint volume_forecast_publications_status_chk check (status in ('pending_review', 'published', 'superseded', 'cancelled')),
  constraint volume_forecast_publications_target_cutoff_uniq unique (target_date, cutoff_mode)
);

create index if not exists volume_forecast_publications_status_idx
  on public.volume_forecast_publications (status, target_date desc);

create table if not exists public.volume_forecast_alerts (
  id bigint generated always as identity primary key,
  alert_date date not null,
  target_date date not null,
  alert_type text not null,
  severity text not null default 'warning',
  details_json jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint volume_forecast_alerts_severity_chk check (severity in ('info', 'warning', 'critical')),
  constraint volume_forecast_alerts_status_chk check (status in ('open', 'acknowledged', 'resolved')),
  constraint volume_forecast_alerts_dedupe_uniq unique (alert_date, target_date, alert_type)
);

create index if not exists volume_forecast_alerts_status_idx
  on public.volume_forecast_alerts (status, alert_date desc);

do $$
begin
  if to_regclass('public.ob_app_settings') is not null then
    insert into public.ob_app_settings (key, value)
    values
      ('forecast_official_run_time', '{"timezone":"America/New_York","time":"21:30"}'::jsonb),
      ('forecast_actual_backfill_time', '{"timezone":"America/New_York","time":"00:20"}'::jsonb),
      ('forecast_review_deadline', '{"timezone":"America/New_York","time":"23:30"}'::jsonb),
      ('forecast_metric_thresholds', '{"recent14_wape":0.08,"p90_abs_variance":0.10,"within3_floor":0.60,"worst_day":0.15}'::jsonb),
      ('forecast_enabled_models', '["v0","v1","v2","v3","v4","v4_ensemble","v5","v6","v7","v8","v9"]'::jsonb)
    on conflict (key) do update
    set value = excluded.value;
  end if;
end
$$;
