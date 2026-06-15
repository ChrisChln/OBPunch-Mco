create or replace function public.user_has_module_access(
  p_module_key text,
  p_required_access text default 'view',
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_role text := null;
  v_access text := 'hidden';
begin
  if v_user_id is null then
    return false;
  end if;

  v_role := public.resolve_admin_role_for_user(v_user_id);
  v_access := coalesce(public.default_admin_module_access(v_role, p_module_key), 'hidden');

  select coalesce(
    (
      select override_row.access_level
      from public.ob_admin_account_modules as override_row
      where override_row.user_id = v_user_id
        and override_row.module_key = p_module_key
      limit 1
    ),
    v_access
  )
  into v_access;

  return case
    when p_required_access = 'operate' then v_access = 'operate'
    when p_required_access = 'view' then v_access in ('view', 'operate')
    else v_access <> 'hidden'
  end;
end;
$$;

grant execute on function public.user_has_module_access(text, text, uuid) to authenticated;
grant execute on function public.user_has_module_access(text, text, uuid) to service_role;
