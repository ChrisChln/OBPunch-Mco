alter table public.ob_consumable_items
  add column if not exists group_key text null,
  add column if not exists is_custom boolean not null default true,
  add column if not exists deleted_at timestamptz null;

alter table public.ob_consumable_items
  drop constraint if exists ob_consumable_items_group_key_check;

alter table public.ob_consumable_items
  add constraint ob_consumable_items_group_key_check
  check (group_key is null or group_key in ('packing', 'last_mile', 'transfer'));

create index if not exists ob_consumable_items_active_group_idx
  on public.ob_consumable_items (is_active, deleted_at, group_key, sort_order, item_key);

update public.ob_consumable_items
set is_custom = true
where is_custom is distinct from true;

create or replace function public.list_consumable_dashboard(
  p_metric_date date default null,
  p_range_start date default null,
  p_range_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $list_consumable_dashboard$
declare
  v_user_id uuid := auth.uid();
  v_start date := coalesce(p_range_start, current_date - 42);
  v_end date := coalesce(p_range_end, current_date);
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('consumables', 'view', v_user_id) then
    raise exception 'Forbidden.';
  end if;

  return jsonb_build_object(
    'metric_date', p_metric_date,
    'items',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'item_key', item.item_key,
              'item_label', item.item_label,
              'group_key', item.group_key,
              'warning_days', item.warning_days,
              'critical_days', item.critical_days,
              'sort_order', item.sort_order,
              'is_active', item.is_active,
              'is_custom', item.is_custom
            )
            order by item.sort_order, item.item_key
          )
          from public.ob_consumable_items as item
          where item.is_active = true
            and item.deleted_at is null
        ),
        '[]'::jsonb
      ),
    'snapshots',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'item_key', snapshot.item_key,
              'snapshot_date', snapshot.snapshot_date,
              'remaining_qty', snapshot.remaining_qty,
              'note', snapshot.note,
              'created_at', snapshot.created_at,
              'created_by_display', snapshot.created_by_display
            )
            order by snapshot.snapshot_date desc, snapshot.item_key
          )
          from public.ob_consumable_snapshots as snapshot
          where snapshot.snapshot_date between v_start and v_end
        ),
        '[]'::jsonb
      ),
    'adjustments',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', adjustment.id,
              'item_key', adjustment.item_key,
              'effective_at', adjustment.effective_at,
              'delta_qty', adjustment.delta_qty,
              'reason', adjustment.reason,
              'note', adjustment.note,
              'created_at', adjustment.created_at,
              'created_by_display', adjustment.created_by_display
            )
            order by adjustment.effective_at desc, adjustment.id desc
          )
          from public.ob_consumable_adjustments as adjustment
          where adjustment.effective_at >= v_start::timestamptz
            and adjustment.effective_at < (v_end + 1)::timestamptz
        ),
        '[]'::jsonb
      ),
    'alerts',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', alert.id,
              'alert_date', alert.alert_date,
              'item_key', alert.item_key,
              'alert_type', alert.alert_type,
              'severity', alert.severity,
              'status', alert.status,
              'details_json', alert.details_json,
              'created_at', alert.created_at
            )
            order by alert.alert_date desc, alert.created_at desc
          )
          from public.ob_consumable_alerts as alert
          where alert.alert_date between greatest(v_start, v_end - 30) and v_end
            and alert.status = 'open'
        ),
        '[]'::jsonb
      ),
    'inbound_orders_by_date',
      coalesce(
        (
          select jsonb_object_agg(metric.metric_date::text, coalesce(metric.calendar_inbound_order_count, 0))
          from public.ob_package_daily_metrics as metric
          where metric.metric_date between greatest(v_start, v_end - 90) and v_end
        ),
        '{}'::jsonb
      )
  );
end;
$list_consumable_dashboard$;

create or replace function public.save_consumable_item(
  p_item_key text,
  p_item_label text,
  p_group_key text,
  p_warning_days numeric,
  p_critical_days numeric,
  p_sort_order int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $save_consumable_item$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_item_label text := btrim(coalesce(p_item_label, ''));
  v_group_key text := nullif(lower(btrim(coalesce(p_group_key, ''))), '');
  v_item_key text := lower(btrim(coalesce(p_item_key, '')));
  v_base_key text;
  v_candidate_key text;
  v_suffix int := 1;
  v_warning_days numeric := coalesce(p_warning_days, 7);
  v_critical_days numeric := coalesce(p_critical_days, 3);
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_role <> 'level1' then
    raise exception 'Forbidden.';
  end if;
  if v_item_label = '' then
    raise exception 'Item name is required.';
  end if;
  if v_group_key is not null and v_group_key not in ('packing', 'last_mile', 'transfer') then
    raise exception 'Unsupported consumable group.';
  end if;
  if v_warning_days < 0 or v_critical_days < 0 or v_critical_days > v_warning_days then
    raise exception 'Alert days are invalid.';
  end if;

  if v_item_key = '' then
    v_base_key := regexp_replace(lower(v_item_label), '[^a-z0-9]+', '_', 'g');
    v_base_key := trim(both '_' from v_base_key);
    if v_base_key = '' then
      v_base_key := 'custom_item';
    end if;
    v_candidate_key := v_base_key;
    while exists (select 1 from public.ob_consumable_items where item_key = v_candidate_key) loop
      v_suffix := v_suffix + 1;
      v_candidate_key := v_base_key || '_' || v_suffix::text;
    end loop;
    v_item_key := v_candidate_key;
  end if;

  insert into public.ob_consumable_items (
    item_key,
    item_label,
    group_key,
    warning_days,
    critical_days,
    sort_order,
    is_active,
    is_custom,
    deleted_at,
    created_at,
    updated_at
  )
  values (
    v_item_key,
    v_item_label,
    v_group_key,
    v_warning_days,
    v_critical_days,
    coalesce(p_sort_order, 0),
    true,
    true,
    null,
    now(),
    now()
  )
  on conflict (item_key) do update
  set
    item_label = excluded.item_label,
    group_key = excluded.group_key,
    warning_days = excluded.warning_days,
    critical_days = excluded.critical_days,
    sort_order = excluded.sort_order,
    is_active = true,
    is_custom = true,
    deleted_at = null,
    updated_at = now()
  returning jsonb_build_object(
    'item_key', item_key,
    'item_label', item_label,
    'group_key', group_key,
    'warning_days', warning_days,
    'critical_days', critical_days,
    'sort_order', sort_order,
    'is_active', is_active,
    'is_custom', is_custom
  ) into v_result;

  return v_result;
end;
$save_consumable_item$;

create or replace function public.delete_consumable_item(
  p_item_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $delete_consumable_item$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_item_key text := lower(btrim(coalesce(p_item_key, '')));
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_role <> 'level1' then
    raise exception 'Forbidden.';
  end if;
  if v_item_key = '' then
    raise exception 'Item key is required.';
  end if;

  update public.ob_consumable_items
  set
    is_active = false,
    deleted_at = now(),
    updated_at = now()
  where item_key = v_item_key
  returning jsonb_build_object(
    'item_key', item_key,
    'is_active', is_active,
    'deleted_at', deleted_at
  ) into v_result;

  if v_result is null then
    raise exception 'Unknown consumable item.';
  end if;

  return v_result;
end;
$delete_consumable_item$;

revoke all on function public.list_consumable_dashboard(date, date, date) from public;
revoke all on function public.save_consumable_item(text, text, text, numeric, numeric, int) from public;
revoke all on function public.delete_consumable_item(text) from public;

grant execute on function public.list_consumable_dashboard(date, date, date) to authenticated;
grant execute on function public.save_consumable_item(text, text, text, numeric, numeric, int) to authenticated;
grant execute on function public.delete_consumable_item(text) to authenticated;
