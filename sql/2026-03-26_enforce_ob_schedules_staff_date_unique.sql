-- Enforce one schedule row per (staff_id, date) to make upsert(onConflict: 'staff_id,date') deterministic.
-- Keep the newest row by updated_at/created_at/id when duplicates exist.
with ranked as (
  select
    id,
    row_number() over (
      partition by staff_id, date
      order by coalesce(updated_at, created_at) desc, created_at desc, id desc
    ) as rn
  from public.ob_schedules
)
delete from public.ob_schedules s
using ranked r
where s.id = r.id
  and r.rn > 1;

create unique index if not exists ob_schedules_staff_date_uidx
  on public.ob_schedules (staff_id, date);
