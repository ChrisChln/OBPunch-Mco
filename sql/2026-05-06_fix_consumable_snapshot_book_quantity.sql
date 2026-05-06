create or replace function public.save_consumable_snapshot_batch(
  p_snapshot_date date,
  p_items jsonb,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $save_consumable_snapshot_batch$
declare
  v_user_id uuid := auth.uid();
  v_actor_display text := '';
  v_snapshot_date date := (now() at time zone 'America/New_York')::date;
  v_unknown_item_keys text := '';
  v_over_book_item text := '';
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('consumables', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Items payload must be an array.';
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_user_id) as identity_row
  limit 1;

  create temporary table if not exists tmp_consumable_snapshots (
    item_key text primary key,
    remaining_qty numeric(18,2) not null
  ) on commit drop;
  truncate tmp_consumable_snapshots;

  insert into tmp_consumable_snapshots (item_key, remaining_qty)
  select
    lower(btrim(coalesce(row_data.item_key, ''))) as item_key,
    row_data.remaining_qty
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as row_data(item_key text, remaining_qty numeric)
  where row_data.item_key is not null;

  if exists (select 1 from tmp_consumable_snapshots where remaining_qty is null or remaining_qty < 0) then
    raise exception 'Remaining quantity must be zero or greater.';
  end if;

  select string_agg(payload.item_key, ', ' order by payload.item_key)
  into v_unknown_item_keys
  from tmp_consumable_snapshots as payload
  left join public.ob_consumable_items as item on item.item_key = payload.item_key and item.is_active = true
  where item.item_key is null;

  if nullif(v_unknown_item_keys, '') is not null then
    raise exception 'Payload contains unknown consumable item(s): %', v_unknown_item_keys;
  end if;

  with latest_snapshots as (
    select distinct on (snapshot.item_key)
      snapshot.item_key,
      snapshot.snapshot_date,
      snapshot.remaining_qty,
      coalesce(snapshot.updated_at, snapshot.created_at, snapshot.snapshot_date::timestamptz) as cutoff_at
    from public.ob_consumable_snapshots as snapshot
    join tmp_consumable_snapshots as payload on payload.item_key = snapshot.item_key
    where snapshot.snapshot_date <= v_snapshot_date
    order by snapshot.item_key, snapshot.snapshot_date desc, snapshot.updated_at desc, snapshot.created_at desc
  ),
  book_quantities as (
    select
      payload.item_key,
      payload.remaining_qty,
      latest.remaining_qty as latest_remaining_qty,
      coalesce(
        (
          select sum(adjustment.delta_qty)
          from public.ob_consumable_adjustments as adjustment
          where adjustment.item_key = payload.item_key
            and adjustment.reason = 'restock'
            and adjustment.effective_at <= now()
            and (
              (latest.item_key is null)
              or (adjustment.effective_at > latest.cutoff_at)
            )
        ),
        0
      ) as post_snapshot_restock_qty
    from tmp_consumable_snapshots as payload
    left join latest_snapshots as latest on latest.item_key = payload.item_key
  )
  select item_key
  into v_over_book_item
  from book_quantities
  where remaining_qty > coalesce(latest_remaining_qty, 0) + post_snapshot_restock_qty
  order by item_key
  limit 1;

  if nullif(v_over_book_item, '') is not null then
    raise exception 'Snapshot quantity cannot exceed book quantity for %. Use restock adjustment to add inventory.', v_over_book_item;
  end if;

  insert into public.ob_consumable_snapshots (
    snapshot_date,
    item_key,
    remaining_qty,
    note,
    created_by_user_id,
    created_by_display,
    created_at,
    updated_at
  )
  select
    v_snapshot_date,
    payload.item_key,
    payload.remaining_qty,
    coalesce(p_note, ''),
    v_user_id,
    v_actor_display,
    now(),
    now()
  from tmp_consumable_snapshots as payload
  on conflict (snapshot_date, item_key) do update
  set
    remaining_qty = excluded.remaining_qty,
    note = excluded.note,
    created_by_user_id = excluded.created_by_user_id,
    created_by_display = excluded.created_by_display,
    updated_at = now();

  return jsonb_build_object(
    'snapshot_date', v_snapshot_date,
    'item_count', (select count(*) from tmp_consumable_snapshots)
  );
end;
$save_consumable_snapshot_batch$;

revoke all on function public.save_consumable_snapshot_batch(date, jsonb, text) from public;
grant execute on function public.save_consumable_snapshot_batch(date, jsonb, text) to authenticated;
