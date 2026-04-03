create table if not exists public.ob_iams_work_hour_upload_batches (
  id bigserial primary key,
  work_date date not null,
  file_name text not null default '',
  uploaded_by text not null default '',
  source_row_count integer not null default 0,
  matched_row_count integer not null default 0,
  skipped_row_count integer not null default 0,
  replaced_row_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ob_iams_work_hour_upload_batches_work_date_idx
  on public.ob_iams_work_hour_upload_batches (work_date desc, created_at desc);

create table if not exists public.ob_iams_work_hours_imports (
  id bigserial primary key,
  work_date date not null,
  staff_id text not null,
  source_user_code text not null,
  iams_hours numeric(8, 2) not null check (iams_hours >= 0),
  upload_batch_id bigint references public.ob_iams_work_hour_upload_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_date, staff_id)
);

create index if not exists ob_iams_work_hours_imports_work_date_idx
  on public.ob_iams_work_hours_imports (work_date, staff_id);

comment on table public.ob_iams_work_hours_imports is 'Daily iAMS verified work hours imported from attendance files.';
comment on column public.ob_iams_work_hours_imports.source_user_code is 'Raw user code from uploaded file before normalization.';
