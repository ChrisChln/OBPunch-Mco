grant usage on schema public to authenticated;
grant select, update on public.ob_leave_requests to authenticated;
grant usage, select on sequence public.ob_leave_requests_id_seq to authenticated;

alter table public.ob_leave_requests enable row level security;

drop policy if exists ob_leave_requests_leave_approval_select on public.ob_leave_requests;
create policy ob_leave_requests_leave_approval_select
  on public.ob_leave_requests
  for select
  to authenticated
  using (public.user_has_module_access('leave_approval', 'view', auth.uid()));

drop policy if exists ob_leave_requests_leave_approval_update on public.ob_leave_requests;
create policy ob_leave_requests_leave_approval_update
  on public.ob_leave_requests
  for update
  to authenticated
  using (public.user_has_module_access('leave_approval', 'operate', auth.uid()))
  with check (public.user_has_module_access('leave_approval', 'operate', auth.uid()));
