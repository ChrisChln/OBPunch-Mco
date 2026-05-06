create or replace function public.undo_consumable_adjustment(
  p_adjustment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $undo_consumable_adjustment$
declare
  v_user_id uuid := auth.uid();
  v_actor_display text := '';
  v_original public.ob_consumable_adjustments%rowtype;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('consumables', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;

  select *
  into v_original
  from public.ob_consumable_adjustments
  where id = p_adjustment_id;

  if v_original.id is null then
    raise exception 'Unknown adjustment.';
  end if;
  if v_original.created_by_user_id is distinct from v_user_id then
    raise exception 'Only the original operator can undo this adjustment.';
  end if;
  if v_original.reason <> 'restock' or v_original.delta_qty <= 0 then
    raise exception 'Only positive restock adjustments can be undone.';
  end if;
  if exists (
    select 1
    from public.ob_consumable_adjustments as undo_row
    where undo_row.note = 'undo_consumable_adjustment:' || v_original.id::text
  ) then
    raise exception 'Adjustment has already been undone.';
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
    v_original.item_key,
    now(),
    -v_original.delta_qty,
    'restock',
    'undo_consumable_adjustment:' || v_original.id::text,
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
    'reason', reason,
    'note', note,
    'created_by_user_id', created_by_user_id,
    'created_by_display', created_by_display
  ) into v_result;

  return v_result;
end;
$undo_consumable_adjustment$;

revoke all on function public.undo_consumable_adjustment(uuid) from public;
grant execute on function public.undo_consumable_adjustment(uuid) to authenticated;
