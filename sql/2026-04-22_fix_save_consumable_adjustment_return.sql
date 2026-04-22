create or replace function public.save_consumable_adjustment(
  p_item_key text,
  p_effective_at timestamptz,
  p_delta_qty numeric,
  p_reason text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_actor_display text := '';
  v_item_key text := lower(btrim(coalesce(p_item_key, '')));
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('consumables', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_item_key = '' or not exists (
    select 1
    from public.ob_consumable_items as item
    where item.item_key = v_item_key
      and item.is_active = true
  ) then
    raise exception 'Unknown consumable item.';
  end if;
  if p_effective_at is null then
    raise exception 'Effective time is required.';
  end if;
  if p_delta_qty is null or p_delta_qty = 0 then
    raise exception 'Adjustment quantity must be non-zero.';
  end if;
  if v_reason not in ('restock', 'correction', 'damage', 'count_update') then
    raise exception 'Unsupported adjustment reason.';
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_user_id) as identity_row
  limit 1;

  insert into public.ob_consumable_adjustments (
    item_key,
    effective_at,
    delta_qty,
    reason,
    note,
    created_by_user_id,
    created_by_display,
    created_at,
    updated_at
  )
  values (
    v_item_key,
    p_effective_at,
    p_delta_qty,
    v_reason,
    coalesce(p_note, ''),
    v_user_id,
    v_actor_display,
    now(),
    now()
  )
  returning jsonb_build_object(
    'id', id,
    'item_key', item_key,
    'effective_at', effective_at,
    'delta_qty', delta_qty,
    'reason', reason
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.save_consumable_adjustment(text, timestamptz, numeric, text, text) from public;
grant execute on function public.save_consumable_adjustment(text, timestamptz, numeric, text, text) to authenticated;
