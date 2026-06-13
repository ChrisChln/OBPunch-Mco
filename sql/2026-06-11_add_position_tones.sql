alter table public.ob_positions
  add column if not exists tone text not null default 'slate';

alter table public.ob_positions
  drop constraint if exists ob_positions_tone_check;

alter table public.ob_positions
  add constraint ob_positions_tone_check
  check (tone in ('sky', 'cyan', 'teal', 'emerald', 'lime', 'amber', 'orange', 'rose', 'fuchsia', 'violet', 'indigo', 'slate'));

drop function if exists public.list_positions();

create or replace function public.list_positions()
returns table (
  id uuid,
  name text,
  department text,
  tone text,
  is_active boolean,
  display_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_has_module_access('permissions', 'view') then
    raise exception 'Not allowed to list positions';
  end if;

  return query
  select p.id, p.name, p.department, p.tone, p.is_active, p.display_order, p.created_at, p.updated_at
  from public.ob_positions as p
  order by p.display_order, lower(p.name), p.created_at;
end;
$$;

drop function if exists public.save_position(text, integer, boolean, text);
drop function if exists public.save_position(text, integer, boolean, text, text);
drop function if exists public.save_position(text, integer, boolean, text, text, text);

create or replace function public.save_position(
  p_name text,
  p_display_order integer default 0,
  p_is_active boolean default true,
  p_department text default 'OB',
  p_tone text default 'slate',
  p_original_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_original_name text := nullif(btrim(coalesce(p_original_name, '')), '');
  v_department text := upper(btrim(coalesce(p_department, 'OB')));
  v_tone text := lower(btrim(coalesce(p_tone, 'slate')));
  v_row public.ob_positions%rowtype;
begin
  if not public.user_has_module_access('permissions', 'operate') then
    raise exception 'Not allowed to save positions';
  end if;

  if v_name = '' then
    raise exception 'Position name is required';
  end if;

  if v_department not in ('OB', 'IB', 'INV') and lower(v_department) <> 'hidden' then
    v_department := 'OB';
  end if;
  if lower(v_department) = 'hidden' then
    v_department := 'hidden';
  end if;

  if v_tone not in ('sky', 'cyan', 'teal', 'emerald', 'lime', 'amber', 'orange', 'rose', 'fuchsia', 'violet', 'indigo', 'slate') then
    v_tone := 'slate';
  end if;

  if v_original_name is not null then
    update public.ob_positions
    set
      name = v_name,
      department = v_department,
      tone = v_tone,
      display_order = coalesce(p_display_order, 0),
      is_active = coalesce(p_is_active, true),
      updated_at = now()
    where lower(btrim(name)) = lower(v_original_name)
    returning * into v_row;
  end if;

  if v_row.id is null then
    insert into public.ob_positions (name, department, tone, display_order, is_active, created_at, updated_at)
    values (v_name, v_department, v_tone, coalesce(p_display_order, 0), coalesce(p_is_active, true), now(), now())
    on conflict (lower(btrim(name))) do update
      set department = excluded.department,
          tone = excluded.tone,
          display_order = excluded.display_order,
          is_active = excluded.is_active,
          updated_at = now()
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.list_positions() to authenticated;
grant execute on function public.save_position(text, integer, boolean, text, text, text) to authenticated;
