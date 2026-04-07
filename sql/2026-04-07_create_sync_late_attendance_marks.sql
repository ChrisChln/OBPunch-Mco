create or replace function public.sync_late_attendance_marks(
  p_range_start date,
  p_range_end date,
  p_staff_ids text[] default array[]::text[],
  p_rows jsonb default '[]'::jsonb,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_upsert_count int := 0;
  v_delete_count int := 0;
  v_staff_count int := 0;
begin
  if p_range_start is null or p_range_end is null or p_range_end < p_range_start then
    raise exception 'Invalid late sync range: % -> %', p_range_start, p_range_end;
  end if;

  perform pg_advisory_xact_lock(284611, hashtext(format('late:%s:%s', p_range_start, p_range_end)));

  create temporary table if not exists tmp_sync_late_staff_ids (
    staff_id text primary key
  ) on commit drop;
  truncate tmp_sync_late_staff_ids;

  insert into tmp_sync_late_staff_ids (staff_id)
  select distinct btrim(value)
  from unnest(coalesce(p_staff_ids, array[]::text[])) as value
  where btrim(coalesce(value, '')) <> ''
  on conflict (staff_id) do nothing;

  create temporary table if not exists tmp_sync_late_rows (
    staff_id text not null,
    work_date date not null,
    source text not null,
    operator text null,
    payload jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (staff_id, work_date)
  ) on commit drop;
  truncate tmp_sync_late_rows;

  insert into tmp_sync_late_rows (
    staff_id,
    work_date,
    source,
    operator,
    payload,
    updated_at
  )
  select distinct on (prepared.staff_id, prepared.work_date)
    prepared.staff_id,
    prepared.work_date,
    'late_auto'::text,
    prepared.operator,
    prepared.payload,
    prepared.updated_at
  from (
    select
      btrim(coalesce(row_data.staff_id, '')) as staff_id,
      (nullif(btrim(coalesce(row_data.work_date, '')), ''))::date as work_date,
      coalesce(nullif(btrim(coalesce(row_data.operator, '')), ''), v_actor) as operator,
      coalesce(row_data.payload, '{}'::jsonb) as payload,
      coalesce(row_data.updated_at, now()) as updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
      staff_id text,
      work_date text,
      source text,
      operator text,
      payload jsonb,
      updated_at timestamptz
    )
  ) as prepared
  where prepared.staff_id <> ''
    and prepared.work_date between p_range_start and p_range_end
    and not exists (
      select 1
      from public.ob_attendance_marks as existing
      where existing.staff_id = prepared.staff_id
        and existing.work_date = prepared.work_date
        and existing.mark_type = 'late'
        and coalesce(nullif(btrim(coalesce(existing.source, '')), ''), 'manual') <> 'late_auto'
    )
  order by prepared.staff_id, prepared.work_date, prepared.updated_at desc;

  insert into tmp_sync_late_staff_ids (staff_id)
  select distinct row.staff_id
  from tmp_sync_late_rows as row
  on conflict (staff_id) do nothing;

  select count(*) into v_staff_count from tmp_sync_late_staff_ids;

  insert into public.ob_attendance_marks (
    staff_id,
    work_date,
    mark_type,
    source,
    operator,
    payload,
    updated_at
  )
  select
    row.staff_id,
    row.work_date,
    'late'::text,
    row.source,
    row.operator,
    row.payload,
    row.updated_at
  from tmp_sync_late_rows as row
  on conflict (staff_id, work_date, mark_type) do update
  set
    source = excluded.source,
    operator = excluded.operator,
    payload = excluded.payload,
    updated_at = excluded.updated_at;
  get diagnostics v_upsert_count = row_count;

  delete from public.ob_attendance_marks as target
  using tmp_sync_late_staff_ids as scope
  where target.staff_id = scope.staff_id
    and target.work_date between p_range_start and p_range_end
    and target.mark_type = 'late'
    and target.source = 'late_auto'
    and not exists (
      select 1
      from tmp_sync_late_rows as next_row
      where next_row.staff_id = target.staff_id
        and next_row.work_date = target.work_date
    );
  get diagnostics v_delete_count = row_count;

  return jsonb_build_object(
    'range_start', p_range_start,
    'range_end', p_range_end,
    'staff_count', v_staff_count,
    'upsert_count', v_upsert_count,
    'delete_count', v_delete_count
  );
end;
$$;

revoke all on function public.sync_late_attendance_marks(date, date, text[], jsonb, text) from public;
grant execute on function public.sync_late_attendance_marks(date, date, text[], jsonb, text) to authenticated;
grant execute on function public.sync_late_attendance_marks(date, date, text[], jsonb, text) to service_role;
