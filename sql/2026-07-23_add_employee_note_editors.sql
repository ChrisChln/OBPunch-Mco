create or replace function public.get_employee_notes()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_notes jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;

  if not (
    public.user_has_module_access('employees', 'view', v_user_id)
    or public.user_has_module_access('schedule', 'view', v_user_id)
    or public.user_has_module_access('agency', 'view', v_user_id)
  ) then
    raise exception 'Forbidden.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'staff_id', employee.staff_id,
        'agency_note', coalesce(agency_note.note, ''),
        'admin_note', coalesce(admin_note.note, ''),
        'agency_note_updated_by',
          case
            when btrim(coalesce(agency_note.note, '')) = '' then ''
            else coalesce(
              nullif(btrim(coalesce(agency_editor_profile.display_name, '')), ''),
              nullif(btrim(coalesce(agency_editor_user.raw_user_meta_data ->> 'display_name', '')), ''),
              nullif(btrim(coalesce(agency_editor_user.raw_user_meta_data ->> 'full_name', '')), ''),
              nullif(btrim(coalesce(agency_editor_user.email, '')), ''),
              ''
            )
          end,
        'admin_note_updated_by',
          case
            when btrim(coalesce(admin_note.note, '')) = '' then ''
            else coalesce(
              nullif(btrim(coalesce(admin_editor_profile.display_name, '')), ''),
              nullif(btrim(coalesce(admin_editor_user.raw_user_meta_data ->> 'display_name', '')), ''),
              nullif(btrim(coalesce(admin_editor_user.raw_user_meta_data ->> 'full_name', '')), ''),
              nullif(btrim(coalesce(admin_editor_user.email, '')), ''),
              ''
            )
          end
      )
      order by employee.staff_id
    ),
    '[]'::jsonb
  )
  into v_notes
  from public.ob_employees as employee
  left join public.ob_agency_employee_notes as agency_note
    on agency_note.staff_id = employee.staff_id
  left join public.ob_admin_employee_notes as admin_note
    on admin_note.staff_id = employee.staff_id
  left join public.ob_user_profiles as agency_editor_profile
    on agency_editor_profile.user_id = agency_note.updated_by
  left join auth.users as agency_editor_user
    on agency_editor_user.id = agency_note.updated_by
  left join public.ob_user_profiles as admin_editor_profile
    on admin_editor_profile.user_id = admin_note.updated_by
  left join auth.users as admin_editor_user
    on admin_editor_user.id = admin_note.updated_by
  where employee.terminated_at is null
    and (
      btrim(coalesce(agency_note.note, '')) <> ''
      or btrim(coalesce(admin_note.note, '')) <> ''
    )
    and (
      public.user_has_position_access(
        'employees',
        public.employee_record_text(to_jsonb(employee), 'position', 'Position'),
        'view',
        v_user_id
      )
      or public.user_has_position_access(
        'schedule',
        public.employee_record_text(to_jsonb(employee), 'position', 'Position'),
        'view',
        v_user_id
      )
      or (
        public.user_has_module_access('agency', 'view', v_user_id)
        and public.agency_user_can_access_employee(employee.staff_id, v_user_id)
      )
    );

  return v_notes;
end;
$$;

revoke all on function public.get_employee_notes() from public;
grant execute on function public.get_employee_notes() to authenticated;
grant execute on function public.get_employee_notes() to service_role;
