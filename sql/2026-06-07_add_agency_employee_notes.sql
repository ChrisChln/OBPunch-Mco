create table if not exists public.ob_agency_employee_notes (
  staff_id text primary key references public.ob_employees(staff_id) on update cascade,
  note text not null default '',
  created_by uuid null references auth.users(id),
  updated_by uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ob_agency_employee_notes_length_check check (char_length(note) <= 500)
);

alter table public.ob_agency_employee_notes enable row level security;

revoke all on public.ob_agency_employee_notes from public;
revoke all on public.ob_agency_employee_notes from anon;
revoke all on public.ob_agency_employee_notes from authenticated;

create or replace function public.agency_get_employee_notes()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_managed_agencies text[] := public.current_user_managed_agencies(v_user_id);
  v_notes jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'view', v_user_id) then
    raise exception 'Forbidden.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'staff_id', note_row.staff_id,
        'note', note_row.note
      )
      order by note_row.staff_id
    ),
    '[]'::jsonb
  )
  into v_notes
  from public.ob_agency_employee_notes as note_row
  join public.ob_employees as employee
    on employee.staff_id = note_row.staff_id
  where employee.terminated_at is null
    and btrim(coalesce(note_row.note, '')) <> ''
    and (
      (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
      or public.employee_record_text(to_jsonb(employee), 'agency', 'Agency') = any(coalesce(v_managed_agencies, '{}'::text[]))
    );

  return v_notes;
end;
$$;

create or replace function public.agency_upsert_employee_note(
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
  v_staff_id text := btrim(coalesce(p_staff_id, ''));
  v_note text := left(btrim(coalesce(p_note, '')), 500);
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_staff_id = '' then
    raise exception 'Employee is required.';
  end if;
  if not public.agency_user_can_access_employee(v_staff_id, v_user_id) then
    raise exception 'Employee is out of scope.';
  end if;
  if exists (select 1 from public.ob_employees where staff_id = v_staff_id and terminated_at is not null) then
    raise exception 'Terminated employees cannot be edited.';
  end if;

  insert into public.ob_agency_employee_notes (
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

revoke all on function public.agency_get_employee_notes() from public;
revoke all on function public.agency_upsert_employee_note(text, text) from public;

grant execute on function public.agency_get_employee_notes() to authenticated;
grant execute on function public.agency_upsert_employee_note(text, text) to authenticated;
grant execute on function public.agency_get_employee_notes() to service_role;
grant execute on function public.agency_upsert_employee_note(text, text) to service_role;
