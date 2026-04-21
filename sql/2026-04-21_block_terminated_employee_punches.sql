create or replace function public.prevent_terminated_employee_punch()
returns trigger
language plpgsql
as $$
declare
  v_terminated_at timestamptz;
begin
  select e.terminated_at
  into v_terminated_at
  from public.ob_employees as e
  where e.staff_id = new.staff_id
  limit 1;

  if v_terminated_at is not null then
    raise exception 'Terminated employee cannot punch.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists ob_punches_prevent_terminated_employee on public.ob_punches;

create trigger ob_punches_prevent_terminated_employee
before insert or update of staff_id
on public.ob_punches
for each row
execute function public.prevent_terminated_employee_punch();
