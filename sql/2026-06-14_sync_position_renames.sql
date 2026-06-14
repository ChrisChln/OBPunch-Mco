create or replace function public.rename_admin_position_scope_entries(
  p_position_scopes jsonb,
  p_original_name text,
  p_name text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_original_name text := nullif(btrim(coalesce(p_original_name, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_result jsonb := case
    when jsonb_typeof(coalesce(p_position_scopes, '{}'::jsonb)) = 'object' then coalesce(p_position_scopes, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_module text;
  v_positions jsonb;
begin
  if v_original_name is null or v_name is null then
    return public.normalize_admin_position_scopes(v_result);
  end if;

  foreach v_module in array array['employees', 'schedule', 'timecard'] loop
    select coalesce(
      jsonb_agg(
        case
          when lower(btrim(coalesce(item ->> 'position', item ->> 'name', ''))) = lower(v_original_name)
            then jsonb_build_object(
              'position', v_name,
              'access_level', case when lower(btrim(coalesce(item ->> 'access_level', ''))) = 'operate' then 'operate' else 'view' end
            )
          else item
        end
        order by ordinality
      ),
      '[]'::jsonb
    )
    into v_positions
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(v_result -> v_module -> 'positions', '[]'::jsonb)) = 'array'
          then coalesce(v_result -> v_module -> 'positions', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) with ordinality as scope_item(item, ordinality);

    v_result := jsonb_set(v_result, array[v_module, 'positions'], v_positions, true);
  end loop;

  return public.normalize_admin_position_scopes(v_result);
end;
$$;

create or replace function public.sync_position_rename_references(
  p_original_name text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original_name text := nullif(btrim(coalesce(p_original_name, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_employee_position_col text;
begin
  if not public.user_has_module_access('permissions', 'operate') then
    raise exception 'Not allowed to save positions';
  end if;

  if v_original_name is null or v_name is null or lower(v_original_name) = lower(v_name) then
    return;
  end if;

  select c.column_name
  into v_employee_position_col
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'position'
  order by case when c.column_name = 'position' then 0 else 1 end
  limit 1;

  if v_employee_position_col is not null then
    execute format(
      'update public.ob_employees set %1$I = $1 where lower(btrim(coalesce(%1$I::text, ''''))) = lower($2)',
      v_employee_position_col
    )
    using v_name, v_original_name;
  end if;

  if to_regclass('public.ob_schedules') is not null then
    update public.ob_schedules
    set position = v_name,
        updated_at = now()
    where lower(btrim(coalesce(position, ''))) = lower(v_original_name);
  end if;

  if to_regclass('public.ob_temp_accounts') is not null then
    update public.ob_temp_accounts
    set position = v_name
    where lower(btrim(coalesce(position, ''))) = lower(v_original_name);
  end if;

  if to_regclass('public.ob_temp_account_assignments') is not null then
    update public.ob_temp_account_assignments
    set position = v_name
    where lower(btrim(coalesce(position, ''))) = lower(v_original_name);
  end if;

  if to_regclass('public.ob_admin_accounts') is not null then
    update public.ob_admin_accounts
    set position_scopes = public.rename_admin_position_scope_entries(position_scopes, v_original_name, v_name)
    where position_scopes is not null;
  end if;
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

    if v_row.id is not null then
      perform public.sync_position_rename_references(v_original_name, v_name);
    end if;
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

grant execute on function public.rename_admin_position_scope_entries(jsonb, text, text) to authenticated;
grant execute on function public.sync_position_rename_references(text, text) to authenticated;
grant execute on function public.save_position(text, integer, boolean, text, text, text) to authenticated;
