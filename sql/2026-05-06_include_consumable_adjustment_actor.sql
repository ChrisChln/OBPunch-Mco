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
              'created_by_user_id', adjustment.created_by_user_id,
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

revoke all on function public.list_consumable_dashboard(date, date, date) from public;
grant execute on function public.list_consumable_dashboard(date, date, date) to authenticated;
