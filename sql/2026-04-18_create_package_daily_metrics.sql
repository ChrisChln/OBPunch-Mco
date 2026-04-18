create table if not exists public.ob_package_daily_metrics (
  metric_date date primary key,
  assessment_single_order_count bigint not null default 0,
  assessment_multi_order_count bigint not null default 0,
  assessment_multi_order_ratio numeric(12,6) not null default 0,
  assessment_total_order_count bigint not null default 0,
  assessment_unfinished_order_count bigint not null default 0,
  calendar_inbound_order_count bigint not null default 0,
  assessment_single_item_qty bigint not null default 0,
  assessment_multi_item_qty bigint not null default 0,
  assessment_multi_item_ratio numeric(12,6) not null default 0,
  assessment_total_item_qty bigint not null default 0,
  calendar_inbound_item_qty bigint not null default 0,
  inventory_qty numeric(18,2) null,
  inventory_conversion_ratio numeric(12,6) null,
  assessment_unfinished_item_qty bigint not null default 0,
  assessment_completed_order_count bigint not null default 0,
  assessment_completed_item_qty bigint not null default 0,
  calendar_completed_order_count bigint not null default 0,
  calendar_completed_item_qty bigint not null default 0,
  calendar_backlog_order_count bigint not null default 0,
  calendar_backlog_item_qty bigint not null default 0,
  source_filename text not null default '',
  source_row_count bigint not null default 0,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ob_package_import_runs (
  id uuid primary key default gen_random_uuid(),
  metric_date date not null,
  source_filename text not null default '',
  source_row_count bigint not null default 0,
  status text not null check (status in ('running', 'success', 'failed')),
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists ob_package_import_runs_metric_date_idx
  on public.ob_package_import_runs (metric_date, created_at desc);

alter table public.ob_package_daily_metrics enable row level security;
alter table public.ob_package_import_runs enable row level security;

drop policy if exists ob_package_daily_metrics_select_access on public.ob_package_daily_metrics;
create policy ob_package_daily_metrics_select_access
  on public.ob_package_daily_metrics
  for select
  to authenticated
  using (true);

drop policy if exists ob_package_import_runs_select_access on public.ob_package_import_runs;
create policy ob_package_import_runs_select_access
  on public.ob_package_import_runs
  for select
  to authenticated
  using (true);

grant select on public.ob_package_daily_metrics to authenticated;
grant select on public.ob_package_import_runs to authenticated;
