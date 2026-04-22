create or replace function public.admin_module_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'home',
    'package_metrics',
    'consumables',
    'employees',
    'accounts',
    'permissions',
    'timecard',
    'leave_approval',
    'todo',
    'punches',
    'audit',
    'schedule',
    'devices',
    'forecast',
    'prediction_model',
    'efficiency',
    'agency'
  ]::text[];
$$;

create table if not exists public.ob_consumable_items (
  item_key text primary key,
  item_label text not null,
  warning_days numeric(10,2) not null default 7,
  critical_days numeric(10,2) not null default 3,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ob_consumable_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  item_key text not null references public.ob_consumable_items(item_key) on delete restrict,
  remaining_qty numeric(18,2) not null check (remaining_qty >= 0),
  note text not null default '',
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_by_display text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, item_key)
);

create table if not exists public.ob_consumable_adjustments (
  id uuid primary key default gen_random_uuid(),
  item_key text not null references public.ob_consumable_items(item_key) on delete restrict,
  effective_at timestamptz not null,
  delta_qty numeric(18,2) not null check (delta_qty <> 0),
  reason text not null check (reason in ('restock', 'correction', 'damage', 'count_update')),
  note text not null default '',
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_by_display text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ob_consumable_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_date date not null,
  item_key text null references public.ob_consumable_items(item_key) on delete cascade,
  alert_type text not null check (alert_type in ('missing_snapshot', 'low_stock_warning', 'low_stock_critical')),
  severity text not null check (severity in ('info', 'warning', 'critical')),
  details_json jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved')),
  todo_template_id uuid null references public.ob_todo_templates(id) on delete set null,
  todo_item_id uuid null references public.ob_todo_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ob_consumable_alerts_date_item_type_uidx
  on public.ob_consumable_alerts (alert_date, item_key, alert_type)
  where item_key is not null;

create unique index if not exists ob_consumable_alerts_date_type_null_item_uidx
  on public.ob_consumable_alerts (alert_date, alert_type)
  where item_key is null;

create index if not exists ob_consumable_snapshots_date_idx
  on public.ob_consumable_snapshots (snapshot_date desc, item_key);

create index if not exists ob_consumable_adjustments_item_time_idx
  on public.ob_consumable_adjustments (item_key, effective_at desc);

create index if not exists ob_consumable_alerts_status_idx
  on public.ob_consumable_alerts (status, alert_date desc);

insert into public.ob_consumable_items (item_key, item_label, warning_days, critical_days, sort_order)
values
  ('box_48', 'Box 48', 7, 3, 10),
  ('pm2', 'PM2', 7, 3, 20),
  ('pm5', 'PM5', 7, 3, 30),
  ('pm7', 'PM7', 7, 3, 40),
  ('label_4x6', 'Label 4*6', 7, 3, 50),
  ('label_4x2', 'Label 4*2', 7, 3, 60),
  ('gaylord_48', 'Gaylord 48', 7, 3, 70),
  ('gaylord_72', 'Gaylord 72', 7, 3, 80),
  ('clear_tape', 'Clear Tape', 7, 3, 90),
  ('wrap', 'Wrap', 7, 3, 100)
on conflict (item_key) do update
set
  item_label = excluded.item_label,
  warning_days = excluded.warning_days,
  critical_days = excluded.critical_days,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

alter table public.ob_consumable_items enable row level security;
alter table public.ob_consumable_snapshots enable row level security;
alter table public.ob_consumable_adjustments enable row level security;
alter table public.ob_consumable_alerts enable row level security;

drop policy if exists ob_consumable_items_select_access on public.ob_consumable_items;
create policy ob_consumable_items_select_access
  on public.ob_consumable_items
  for select
  to authenticated
  using (true);

drop policy if exists ob_consumable_snapshots_select_access on public.ob_consumable_snapshots;
create policy ob_consumable_snapshots_select_access
  on public.ob_consumable_snapshots
  for select
  to authenticated
  using (true);

drop policy if exists ob_consumable_adjustments_select_access on public.ob_consumable_adjustments;
create policy ob_consumable_adjustments_select_access
  on public.ob_consumable_adjustments
  for select
  to authenticated
  using (true);

drop policy if exists ob_consumable_alerts_select_access on public.ob_consumable_alerts;
create policy ob_consumable_alerts_select_access
  on public.ob_consumable_alerts
  for select
  to authenticated
  using (true);

grant select on public.ob_consumable_items to authenticated;
grant select on public.ob_consumable_snapshots to authenticated;
grant select on public.ob_consumable_adjustments to authenticated;
grant select on public.ob_consumable_alerts to authenticated;

create or replace function public.list_consumable_dashboard(
  p_metric_date date default null,
  p_range_start date default null,
  p_range_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
              'warning_days', item.warning_days,
              'critical_days', item.critical_days
            )
            order by item.sort_order, item.item_key
          )
          from public.ob_consumable_items as item
          where item.is_active = true
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
$$;

create or replace function public.save_consumable_snapshot_batch(
  p_snapshot_date date,
  p_items jsonb,
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
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('consumables', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if p_snapshot_date is null then
    raise exception 'Snapshot date is required.';
  end if;
  if extract(isodow from p_snapshot_date) not in (1, 4) then
    raise exception 'Snapshot date must be Monday or Thursday.';
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
  if exists (
    select 1
    from tmp_consumable_snapshots as payload
    left join public.ob_consumable_items as item on item.item_key = payload.item_key and item.is_active = true
    where item.item_key is null
  ) then
    raise exception 'Payload contains an unknown consumable item.';
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
    p_snapshot_date,
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
    'snapshot_date', p_snapshot_date,
    'item_count', (select count(*) from tmp_consumable_snapshots)
  );
end;
$$;

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

create or replace function public.sync_consumable_alerts(
  p_today date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := coalesce(p_today, current_date);
  v_created_count int := 0;
  v_has_snapshot boolean := false;
  item_row record;
  latest_snapshot record;
  previous_snapshot record;
  inbound_sum numeric;
  recent_daily_inbound numeric;
  adjustment_sum numeric;
  usage_qty numeric;
  usage_per_order numeric;
  avg_daily_usage numeric;
  estimated_days_left numeric;
  next_alert_type text;
  next_severity text;
begin
  if extract(isodow from v_today) in (1, 4) then
    select exists (
      select 1
      from public.ob_consumable_snapshots as snapshot
      where snapshot.snapshot_date = v_today
    ) into v_has_snapshot;

    if not v_has_snapshot then
      if exists (
        select 1
        from public.ob_consumable_alerts as alert
        where alert.alert_date = v_today
          and alert.alert_type = 'missing_snapshot'
          and alert.item_key is null
      ) then
        update public.ob_consumable_alerts
        set
          severity = 'warning',
          details_json = jsonb_build_object('snapshot_date', v_today),
          status = 'open',
          updated_at = now()
        where alert_date = v_today
          and alert_type = 'missing_snapshot'
          and item_key is null;
      else
        insert into public.ob_consumable_alerts (
          alert_date,
          item_key,
          alert_type,
          severity,
          details_json,
          status,
          created_at,
          updated_at
        )
        values (
          v_today,
          null,
          'missing_snapshot',
          'warning',
          jsonb_build_object('snapshot_date', v_today),
          'open',
          now(),
          now()
        );
      end if;
      v_created_count := v_created_count + 1;
    end if;
  end if;

  for item_row in
    select item_key, item_label, warning_days, critical_days
    from public.ob_consumable_items
    where is_active = true
    order by sort_order, item_key
  loop
    select snapshot_date, remaining_qty
    into latest_snapshot
    from public.ob_consumable_snapshots
    where item_key = item_row.item_key
      and snapshot_date <= v_today
    order by snapshot_date desc
    limit 1;

    if latest_snapshot.snapshot_date is null then
      continue;
    end if;

    select snapshot_date, remaining_qty
    into previous_snapshot
    from public.ob_consumable_snapshots
    where item_key = item_row.item_key
      and snapshot_date < latest_snapshot.snapshot_date
    order by snapshot_date desc
    limit 1;

    next_alert_type := null;
    next_severity := null;
    estimated_days_left := null;
    usage_per_order := null;
    avg_daily_usage := null;

    if previous_snapshot.snapshot_date is not null then
      select coalesce(sum(delta_qty), 0)
      into adjustment_sum
      from public.ob_consumable_adjustments
      where item_key = item_row.item_key
        and effective_at > previous_snapshot.snapshot_date::timestamptz
        and effective_at <= (latest_snapshot.snapshot_date + 1)::timestamptz;

      select coalesce(sum(calendar_inbound_order_count), 0)
      into inbound_sum
      from public.ob_package_daily_metrics
      where metric_date > previous_snapshot.snapshot_date
        and metric_date <= latest_snapshot.snapshot_date;

      usage_qty := greatest(0, previous_snapshot.remaining_qty + adjustment_sum - latest_snapshot.remaining_qty);
      if inbound_sum > 0 then
        usage_per_order := usage_qty / inbound_sum;
      end if;
    end if;

    select avg(calendar_inbound_order_count::numeric)
    into recent_daily_inbound
    from public.ob_package_daily_metrics
    where metric_date between v_today - 27 and v_today;

    if usage_per_order is not null and recent_daily_inbound is not null and recent_daily_inbound > 0 then
      avg_daily_usage := usage_per_order * recent_daily_inbound;
      if avg_daily_usage > 0 then
        estimated_days_left := latest_snapshot.remaining_qty / avg_daily_usage;
      end if;
    end if;

    if latest_snapshot.remaining_qty <= 0 then
      next_alert_type := 'low_stock_critical';
      next_severity := 'critical';
    elsif estimated_days_left is not null and estimated_days_left <= item_row.critical_days then
      next_alert_type := 'low_stock_critical';
      next_severity := 'critical';
    elsif estimated_days_left is not null and estimated_days_left <= item_row.warning_days then
      next_alert_type := 'low_stock_warning';
      next_severity := 'warning';
    end if;

    if next_alert_type is not null then
      insert into public.ob_consumable_alerts (
        alert_date,
        item_key,
        alert_type,
        severity,
        details_json,
        status,
        created_at,
        updated_at
      )
      values (
        v_today,
        item_row.item_key,
        next_alert_type,
        next_severity,
        jsonb_build_object(
          'item_label', item_row.item_label,
          'last_snapshot_date', latest_snapshot.snapshot_date,
          'latest_remaining_qty', latest_snapshot.remaining_qty,
          'estimated_days_left', estimated_days_left,
          'avg_daily_usage', avg_daily_usage,
          'usage_per_order', usage_per_order
        ),
        'open',
        now(),
        now()
      )
      on conflict (alert_date, item_key, alert_type) do update
      set
        severity = excluded.severity,
        details_json = excluded.details_json,
        status = 'open',
        updated_at = now();
      v_created_count := v_created_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'alert_date', v_today,
    'upsert_count', v_created_count
  );
end;
$$;

revoke all on function public.list_consumable_dashboard(date, date, date) from public;
revoke all on function public.save_consumable_snapshot_batch(date, jsonb, text) from public;
revoke all on function public.save_consumable_adjustment(text, timestamptz, numeric, text, text) from public;
revoke all on function public.sync_consumable_alerts(date) from public;

grant execute on function public.list_consumable_dashboard(date, date, date) to authenticated;
grant execute on function public.save_consumable_snapshot_batch(date, jsonb, text) to authenticated;
grant execute on function public.save_consumable_adjustment(text, timestamptz, numeric, text, text) to authenticated;
grant execute on function public.sync_consumable_alerts(date) to service_role;
