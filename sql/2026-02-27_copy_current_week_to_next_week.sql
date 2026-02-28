-- Copy schedule "current week bucket" to "next week bucket".
-- Current week bucket: 2000-01-03 ~ 2000-01-09 (Mon~Sun)
-- Next week bucket:    2000-01-10 ~ 2000-01-16 (Mon~Sun)
--
-- IMPORTANT:
-- - ob_schedules.shift has been removed; this script does NOT write shift.
-- - This script fully replaces next week with current week (+7 days).

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
  'manual_copy_current_to_next_week' as operator,
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
