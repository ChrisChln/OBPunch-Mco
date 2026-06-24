create sequence if not exists public.ob_temp_staff_id_seq
  start with 1
  increment by 1
  minvalue 1;

create or replace function public.next_temp_staff_id()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_used_max bigint := 0;
  v_next bigint := 0;
begin
  if v_user_id is null or coalesce(v_role, '') = '' then
    raise exception 'Unauthorized.';
  end if;

  if to_regclass('public.ob_employees') is not null then
    select greatest(
      v_used_max,
      coalesce(max((substring(staff_id from '^TUS([0-9]{7,})$'))::bigint), 0)
    )
    into v_used_max
    from public.ob_employees;
  end if;

  if to_regclass('public.ob_temp_accounts') is not null then
    select greatest(
      v_used_max,
      coalesce(max((substring(staff_id from '^TUS([0-9]{7,})$'))::bigint), 0)
    )
    into v_used_max
    from public.ob_temp_accounts;
  end if;

  if to_regclass('public.ob_temp_account_assignments') is not null then
    select greatest(
      v_used_max,
      coalesce(max((substring(staff_id from '^TUS([0-9]{7,})$'))::bigint), 0),
      coalesce(max((substring(source_temp_staff_id from '^TUS([0-9]{7,})$'))::bigint), 0)
    )
    into v_used_max
    from public.ob_temp_account_assignments;
  end if;

  if to_regclass('public.ob_punches') is not null then
    select greatest(
      v_used_max,
      coalesce(max((substring(staff_id from '^TUS([0-9]{7,})$'))::bigint), 0)
    )
    into v_used_max
    from public.ob_punches;
  end if;

  if to_regclass('public.ob_audit_logs') is not null then
    select greatest(
      v_used_max,
      coalesce(max((substring(staff_id from '^TUS([0-9]{7,})$'))::bigint), 0)
    )
    into v_used_max
    from public.ob_audit_logs;
  end if;

  v_next := nextval('public.ob_temp_staff_id_seq');
  if v_next <= v_used_max then
    perform setval('public.ob_temp_staff_id_seq', v_used_max, true);
    v_next := nextval('public.ob_temp_staff_id_seq');
  end if;

  return 'TUS' || lpad(v_next::text, 7, '0');
end;
$$;

grant usage, select on sequence public.ob_temp_staff_id_seq to authenticated;
grant usage, select on sequence public.ob_temp_staff_id_seq to service_role;

revoke all on function public.next_temp_staff_id() from public;
grant execute on function public.next_temp_staff_id() to authenticated;
grant execute on function public.next_temp_staff_id() to service_role;
