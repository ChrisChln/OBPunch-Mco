create table if not exists public.ob_temp_accounts (
  id bigserial primary key,
  staff_id text not null,
  name text null,
  agency text null,
  position text null,
  work_account text null,
  work_password text null,
  note text null,
  operator text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ob_temp_accounts_staff_id_key
  on public.ob_temp_accounts (staff_id);

create index if not exists ob_temp_accounts_updated_at_idx
  on public.ob_temp_accounts (updated_at desc);
