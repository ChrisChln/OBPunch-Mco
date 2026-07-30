create table if not exists public.ob_admin_employee_notes (
  staff_id text primary key references public.ob_employees(staff_id) on update cascade,
  note text not null default '',
  created_by uuid null references auth.users(id),
  updated_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ob_admin_employee_notes_length_check check (char_length(note) <= 500)
);

alter table public.ob_admin_employee_notes enable row level security;

revoke all on public.ob_admin_employee_notes from public;
revoke all on public.ob_admin_employee_notes from anon;
revoke all on public.ob_admin_employee_notes from authenticated;

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
        'admin_note', coalesce(admin_note.note, '')
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

create or replace function public.admin_upsert_employee_note(
  p_staff_id text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_id text := upper(btrim(coalesce(p_staff_id, '')));
  v_note text := left(btrim(coalesce(p_note, '')), 500);
  v_position text := '';
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_staff_id = '' then
    raise exception 'Employee is required.';
  end if;

  select public.employee_record_text(to_jsonb(employee), 'position', 'Position')
  into v_position
  from public.ob_employees as employee
  where employee.staff_id = v_staff_id
    and employee.terminated_at is null
  limit 1;

  if not found then
    raise exception 'Employee not found or terminated.';
  end if;

  if not (
    public.user_has_position_access('employees', v_position, 'operate', v_user_id)
    or public.user_has_position_access('schedule', v_position, 'operate', v_user_id)
  ) then
    raise exception 'Forbidden.';
  end if;

  insert into public.ob_admin_employee_notes (
    staff_id,
    note,
    created_by,
    updated_by,
    updated_at
  )
  values (
    v_staff_id,
    v_note,
    v_user_id,
    v_user_id,
    now()
  )
  on conflict (staff_id) do update
    set note = excluded.note,
        updated_by = excluded.updated_by,
        updated_at = now();

  return jsonb_build_object(
    'staff_id', v_staff_id,
    'note', v_note
  );
end;
$$;

revoke all on function public.get_employee_notes() from public;
revoke all on function public.admin_upsert_employee_note(text, text) from public;

grant execute on function public.get_employee_notes() to authenticated;
grant execute on function public.admin_upsert_employee_note(text, text) to authenticated;
grant execute on function public.get_employee_notes() to service_role;
grant execute on function public.admin_upsert_employee_note(text, text) to service_role;
