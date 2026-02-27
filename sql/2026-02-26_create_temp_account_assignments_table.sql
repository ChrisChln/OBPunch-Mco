create table if not exists public.ob_temp_account_assignments (
  id bigserial primary key,
  staff_id text not null,
  position text null,
  work_account text not null,
  work_password text null,
  source_temp_account_id bigint null,
  source_temp_staff_id text null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  is_active boolean not null default true,
  released_at timestamptz null,
  release_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ob_temp_account_assignments_staff_idx
  on public.ob_temp_account_assignments (staff_id, is_active, window_end desc);

create index if not exists ob_temp_account_assignments_account_idx
  on public.ob_temp_account_assignments (work_account, is_active, window_end desc);

create unique index if not exists ob_temp_account_assignments_staff_active_key
  on public.ob_temp_account_assignments (staff_id)
  where is_active = true;

create unique index if not exists ob_temp_account_assignments_account_active_key
  on public.ob_temp_account_assignments (work_account)
  where is_active = true;
