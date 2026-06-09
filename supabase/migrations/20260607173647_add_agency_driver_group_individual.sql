create or replace function public.agency_set_driver_group_individual(p_staff_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id text := btrim(coalesce(p_staff_id, ''));
begin
  if v_staff_id = '' then
    raise exception 'Staff ID is required.';
  end if;

  update public.ob_agency_driver_groups as assignment
  set archived_at = now()
  where assignment.staff_id = v_staff_id
    and assignment.archived_at is null;

  return public.agency_get_driver_groups();
end;
$$;

revoke all on function public.agency_set_driver_group_individual(text) from public;
grant execute on function public.agency_set_driver_group_individual(text) to authenticated;
grant execute on function public.agency_set_driver_group_individual(text) to service_role;
