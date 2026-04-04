alter table public.ob_leave_requests
  drop constraint if exists ob_leave_requests_status_check;

alter table public.ob_leave_requests
  add constraint ob_leave_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired'));
