alter table if exists public.ob_user_profiles
  add column if not exists avatar_url text null;
