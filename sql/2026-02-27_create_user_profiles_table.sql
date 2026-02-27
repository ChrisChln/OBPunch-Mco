create table if not exists public.ob_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  user_email text null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ob_user_profiles_email_idx
  on public.ob_user_profiles (user_email);

alter table public.ob_user_profiles enable row level security;

drop policy if exists ob_user_profiles_select_own on public.ob_user_profiles;
create policy ob_user_profiles_select_own
  on public.ob_user_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists ob_user_profiles_insert_own on public.ob_user_profiles;
create policy ob_user_profiles_insert_own
  on public.ob_user_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists ob_user_profiles_update_own on public.ob_user_profiles;
create policy ob_user_profiles_update_own
  on public.ob_user_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

