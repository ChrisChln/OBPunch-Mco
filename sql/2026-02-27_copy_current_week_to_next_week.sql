-- Copy schedule "current week bucket" to "next week bucket".
-- Current week bucket: 2000-01-03 ~ 2000-01-09 (Mon~Sun)
-- Next week bucket:    2000-01-10 ~ 2000-01-16 (Mon~Sun)
--
-- Behavior:
-- 1) Delete all rows in next week bucket.
-- 2) Copy all current week rows to next week (+7 days).
-- 3) Keep note/position/shift, refresh operator/updated_at.

begin;

with params as (
  select
    date '2000-01-03' as cur_start,
    date '2000-01-09' as cur_end,
    date '2000-01-10' as next_start,
    date '2000-01-16' as next_end
),
purge as (
  delete from public.ob_schedules s
  using params p
  where s.date between p.next_start and p.next_end
  returning s.staff_id
)
insert into public.ob_schedules (staff_id, date, shift, position, note, operator, updated_at)
select
  s.staff_id,
  (s.date + interval '7 day')::date as date,
  case when lower(coalesce(s.shift, '')) = 'late' then 'late' else 'early' end as shift,
  s.position,
  s.note,
  'manual_copy_current_to_next_week' as operator,
  now() as updated_at
from public.ob_schedules s
cross join params p
where s.date between p.cur_start and p.cur_end;

commit;

