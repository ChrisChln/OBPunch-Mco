create or replace function public.prevent_terminated_employee_punch()
returns trigger
language plpgsql
as $$
declare
  v_terminated_at timestamptz;
  v_source text;
  v_device text;
begin
  select e.terminated_at
  into v_terminated_at
  from public.ob_employees as e
  where e.staff_id = new.staff_id
  limit 1;

  if v_terminated_at is null then
    return new;
  end if;

  v_source := coalesce(nullif(btrim(new.source), ''), '');
  v_device := coalesce(nullif(btrim(new.device), ''), '');

  if v_source in ('correction', 'manual_add', 'manual_edit')
    and v_device in ('admin_api', 'admin_console')
  then
    return new;
  end if;

  raise exception 'Terminated employee cannot punch.'
    using errcode = 'P0001';
end;
$$;
