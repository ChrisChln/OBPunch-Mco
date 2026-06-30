alter table if exists public.ob_exception_reports
  add column if not exists report_number text;

create unique index if not exists ob_exception_reports_report_number_key
  on public.ob_exception_reports (report_number)
  where report_number is not null;

create index if not exists ob_exception_reports_report_number_date_idx
  on public.ob_exception_reports (report_date desc, report_number desc);

notify pgrst, 'reload schema';
