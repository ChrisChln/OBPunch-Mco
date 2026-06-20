alter table if exists public.ob_exception_reports
  drop constraint if exists ob_exception_reports_responsibility_result_check;

alter table if exists public.ob_exception_reports
  add constraint ob_exception_reports_responsibility_result_check
  check (responsibility_result in ('pending', 'responsible', 'picker', 'packer', 'all', 'no_responsibility'));

notify pgrst, 'reload schema';
