alter table ob_exception_reports
  drop constraint if exists ob_exception_reports_status_check;

alter table ob_exception_reports
  add constraint ob_exception_reports_status_check
  check (status in ('Open', 'Processing', 'Pending Adjustment', 'Resolved', 'Closed'));
