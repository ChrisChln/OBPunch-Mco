alter table if exists public.ob_punches
  add column if not exists device text;
