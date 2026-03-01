-- 把本周排班复制到下周
-- Copy schedule "this week bucket" to "next week bucket".
--
-- 本周 bucket: 2000-01-03 ~ 2000-01-09 (Mon~Sun)
-- 下周 bucket: 2000-01-10 ~ 2000-01-16 (Mon~Sun)
--
-- 说明：先清空下周，再将本周数据 +7 天写入下周
-- Note: Purge next week first, then copy this week with date + 7 days.

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
  returning 1
)
insert into public.ob_schedules (staff_id, date, position, note, operator, updated_at)
select
  s.staff_id,
  (s.date + interval '7 day')::date as date,
  s.position,
  s.note,
  'copy_this_week_to_next_week' as operator,
  now() as updated_at
from public.ob_schedules s
cross join params p
where s.date between p.cur_start and p.cur_end
on conflict (staff_id, date) do update
set
  position = excluded.position,
  note = excluded.note,
  operator = excluded.operator,
  updated_at = excluded.updated_at;

commit;
