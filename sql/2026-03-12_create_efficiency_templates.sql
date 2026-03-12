create extension if not exists pgcrypto;

create table if not exists public.efficiency_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists efficiency_templates_updated_at_idx
  on public.efficiency_templates (updated_at desc);

create or replace function public.set_efficiency_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists efficiency_templates_set_updated_at on public.efficiency_templates;

create trigger efficiency_templates_set_updated_at
before update on public.efficiency_templates
for each row
execute function public.set_efficiency_templates_updated_at();
