alter table public.ob_positions
  add column if not exists department text not null default 'OB';

alter table public.ob_positions
  drop constraint if exists ob_positions_department_check;

alter table public.ob_positions
  add constraint ob_positions_department_check
  check (department in ('OB', 'IB', 'INV', 'hidden'));

update public.ob_positions
set
  department = case
    when lower(btrim(name)) in ('jdl') then 'hidden'
    when lower(btrim(name)) in ('receive', 'receiving', 'putaway') then 'IB'
    when lower(btrim(name)) in ('inventory', 'inv') then 'INV'
    else 'OB'
  end,
  updated_at = now()
where department is null
  or department not in ('OB', 'IB', 'INV', 'hidden')
  or lower(btrim(name)) in ('jdl', 'receive', 'receiving', 'putaway', 'inventory', 'inv');

drop function if exists public.list_positions();

create or replace function public.list_positions()
returns table (
  id uuid,
  name text,
  department text,
  is_active boolean,
  display_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized.';
  end if;

  return query
  select p.id, p.name, p.department, p.is_active, p.display_order, p.created_at, p.updated_at
  from public.ob_positions as p
  order by p.display_order, lower(p.name), p.created_at;
end;
$$;

drop function if exists public.save_position(text, integer, boolean, text);
drop function if exists public.save_position(text, integer, boolean, text, text);

create or replace function public.save_position(
  p_name text,
  p_display_order integer default 0,
  p_is_active boolean default true,
  p_department text default 'OB',
  p_original_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_original text := nullif(btrim(coalesce(p_original_name, '')), '');
  v_department text := case
    when upper(btrim(coalesce(p_department, 'OB'))) in ('OB', 'IB', 'INV') then upper(btrim(coalesce(p_department, 'OB')))
    when lower(btrim(coalesce(p_department, ''))) in ('hidden', 'hide') then 'hidden'
    else 'OB'
  end;
  v_row public.ob_positions%rowtype;
begin
  if v_actor is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_can_manage_admin_access(v_actor) then
    raise exception 'Forbidden.';
  end if;
  if v_name is null then
    raise exception 'Position name is required.';
  end if;

  if v_original is not null then
    update public.ob_positions
    set
      name = v_name,
      department = v_department,
      display_order = coalesce(p_display_order, display_order),
      is_active = coalesce(p_is_active, is_active),
      updated_at = now()
    where lower(btrim(name)) = lower(v_original)
    returning * into v_row;
  end if;

  if v_row.id is null then
    insert into public.ob_positions (name, department, display_order, is_active, created_at, updated_at)
    values (v_name, v_department, coalesce(p_display_order, 0), coalesce(p_is_active, true), now(), now())
    on conflict (lower(btrim(name))) do update
    set
      department = excluded.department,
      display_order = excluded.display_order,
      is_active = excluded.is_active,
      updated_at = now()
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.list_positions() to authenticated;
grant execute on function public.save_position(text, integer, boolean, text, text) to authenticated;
