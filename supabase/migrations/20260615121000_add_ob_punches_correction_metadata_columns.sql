alter table if exists public.ob_punches
  add column if not exists source text,
  add column if not exists operator text,
  add column if not exists note text;
