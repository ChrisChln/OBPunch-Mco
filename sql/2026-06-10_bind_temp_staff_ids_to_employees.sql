alter table public.ob_temp_account_assignments
  add column if not exists source_temp_staff_id text null;

create unique index if not exists ob_temp_account_assignments_source_temp_staff_key
  on public.ob_temp_account_assignments (source_temp_staff_id)
  where source_temp_staff_id is not null;
