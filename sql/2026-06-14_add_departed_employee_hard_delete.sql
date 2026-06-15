create or replace function public.admin_hard_delete_departed_employee(p_staff_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_id text := upper(btrim(coalesce(p_staff_id, '')));
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_employee public.ob_employees%rowtype;
  v_deleted_employee_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_role <> 'level1' then
    raise exception 'Only level1 admins can hard delete departed employees.';
  end if;
  if v_staff_id = '' then
    raise exception 'Employee is required.';
  end if;

  select *
  into v_employee
  from public.ob_employees
  where staff_id = v_staff_id
  for update;

  if not found then
    raise exception 'Employee not found.';
  end if;
  if v_employee.terminated_at is null then
    raise exception 'Only departed employees can be hard deleted.';
  end if;

  if to_regclass('public.ob_agency_driver_groups') is not null then
    delete from public.ob_agency_driver_groups where staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_agency_employee_notes') is not null then
    delete from public.ob_agency_employee_notes where staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_employee_termination_requests') is not null then
    delete from public.ob_employee_termination_requests where staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_schedules') is not null then
    delete from public.ob_schedules where staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_attendance_marks') is not null then
    delete from public.ob_attendance_marks where staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_temp_accounts') is not null then
    delete from public.ob_temp_accounts where staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_temp_account_assignments') is not null then
    delete from public.ob_temp_account_assignments
    where staff_id = v_staff_id
       or source_temp_staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_mistake_reports') is not null then
    delete from public.ob_mistake_reports
    where employee_staff_id = v_staff_id
       or reporter_staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_iams_work_hours_imports') is not null then
    delete from public.ob_iams_work_hours_imports where staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_leave_requests') is not null then
    update public.ob_leave_requests
    set matched_staff_id = null
    where matched_staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_punches') is not null then
    delete from public.ob_punches where staff_id = v_staff_id;
  end if;
  if to_regclass('public.ob_audit_logs') is not null then
    delete from public.ob_audit_logs where staff_id = v_staff_id;
  end if;

  delete from public.ob_employees where staff_id = v_staff_id;
  get diagnostics v_deleted_employee_count = row_count;

  return jsonb_build_object(
    'staff_id', v_staff_id,
    'deleted', v_deleted_employee_count = 1
  );
end;
$$;

revoke all on function public.admin_hard_delete_departed_employee(text) from public;
grant execute on function public.admin_hard_delete_departed_employee(text) to authenticated;
grant execute on function public.admin_hard_delete_departed_employee(text) to service_role;
