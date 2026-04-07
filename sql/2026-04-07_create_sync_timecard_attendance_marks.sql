create or replace function public.sync_timecard_attendance_marks(
  p_range_start date,
  p_range_end date,
  p_rows jsonb default '[]'::jsonb,
  p_late_rows jsonb default '[]'::jsonb,
  p_staff_ids text[] default array[]::text[],
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_non_late_delete_count int := 0;
  v_non_late_upsert_count int := 0;
  v_late_result jsonb := '{}'::jsonb;
begin
  if p_range_start is null or p_range_end is null or p_range_end < p_range_start then
    raise exception 'Invalid timecard sync range: % -> %', p_range_start, p_range_end;
  end if;

  if v_actor is null then
    v_actor := 'SYSTEM';
  end if;

  perform pg_advisory_xact_lock(284613, hashtext(format('timecard:%s:%s', p_range_start, p_range_end)));

  create temporary table if not exists tmp_timecard_attendance_rows (
    staff_id text not null,
    work_date date not null,
    mark_type text not null,
    source text not null,
    operator text null,
    payload jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (staff_id, work_date, mark_type)
  ) on commit drop;
  truncate tmp_timecard_attendance_rows;

  insert into tmp_timecard_attendance_rows (
    staff_id,
    work_date,
    mark_type,
    source,
    operator,
    payload,
    updated_at
  )
  select distinct on (prepared.staff_id, prepared.work_date, prepared.mark_type)
    prepared.staff_id,
    prepared.work_date,
    prepared.mark_type,
    prepared.source,
    prepared.operator,
    prepared.payload,
    prepared.updated_at
  from (
    select
      btrim(coalesce(row_data.staff_id, '')) as staff_id,
      (nullif(btrim(coalesce(row_data.work_date, '')), ''))::date as work_date,
      lower(btrim(coalesce(row_data.mark_type, ''))) as mark_type,
      coalesce(nullif(btrim(coalesce(row_data.source, '')), ''), 'recompute') as source,
      coalesce(nullif(btrim(coalesce(row_data.operator, '')), ''), v_actor) as operator,
      coalesce(row_data.payload, '{}'::jsonb) as payload,
      coalesce(row_data.updated_at, now()) as updated_at
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
      staff_id text,
      work_date text,
      mark_type text,
      source text,
      operator text,
      payload jsonb,
      updated_at timestamptz
    )
  ) as prepared
  where prepared.staff_id <> ''
    and prepared.work_date between p_range_start and p_range_end
    and prepared.mark_type in ('absent', 'excuse', 'temporary_leave')
  order by prepared.staff_id, prepared.work_date, prepared.mark_type, prepared.updated_at desc;

  delete from public.ob_attendance_marks as target
  where target.work_date between p_range_start and p_range_end
    and target.mark_type in ('absent', 'excuse', 'temporary_leave')
    and target.source in ('schedule', 'recompute');
  get diagnostics v_non_late_delete_count = row_count;

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
    row.mark_type,
    row.source,
    row.operator,
    row.payload,
    row.updated_at
  from tmp_timecard_attendance_rows as row
  on conflict (staff_id, work_date, mark_type) do update
  set
    source = excluded.source,
    operator = excluded.operator,
    payload = excluded.payload,
    updated_at = excluded.updated_at;
  get diagnostics v_non_late_upsert_count = row_count;

  v_late_result := public.sync_late_attendance_marks(
    p_range_start,
    p_range_end,
    coalesce(p_staff_ids, array[]::text[]),
    coalesce(p_late_rows, '[]'::jsonb),
    v_actor
  );

  return jsonb_build_object(
    'range_start', p_range_start,
    'range_end', p_range_end,
    'non_late_delete_count', v_non_late_delete_count,
    'non_late_upsert_count', v_non_late_upsert_count,
    'late', coalesce(v_late_result, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.sync_timecard_attendance_marks(date, date, jsonb, jsonb, text[], text) from public;
grant execute on function public.sync_timecard_attendance_marks(date, date, jsonb, jsonb, text[], text) to authenticated;
grant execute on function public.sync_timecard_attendance_marks(date, date, jsonb, jsonb, text[], text) to service_role;
