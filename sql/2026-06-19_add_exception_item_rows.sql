alter table if exists public.ob_exception_reports
  add column if not exists item_rows jsonb not null default '[]'::jsonb;

alter table if exists public.ob_exception_reports
  drop constraint if exists ob_exception_reports_item_rows_array_chk;

alter table if exists public.ob_exception_reports
  add constraint ob_exception_reports_item_rows_array_chk
  check (jsonb_typeof(item_rows) = 'array');

notify pgrst, 'reload schema';
