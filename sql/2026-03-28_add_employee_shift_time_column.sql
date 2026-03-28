alter table if exists ob_employees
  add column if not exists shift_time text;

do $$
declare
  v_position_col text;
  v_shift_col text;
begin
  select c.column_name
  into v_position_col
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'position'
  order by case when c.column_name = 'position' then 0 else 1 end
  limit 1;

  select c.column_name
  into v_shift_col
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'ob_employees'
    and lower(c.column_name) = 'shift'
  order by case when c.column_name = 'shift' then 0 else 1 end
  limit 1;

  if v_shift_col is null then
    raise exception 'Column shift/Shift not found on ob_employees';
  end if;

  if v_position_col is null then
    execute format(
      $sql$
      update ob_employees
      set shift_time = case
        when lower(coalesce(%1$I::text, '')) = 'early' then '08:00'
        when lower(coalesce(%1$I::text, '')) = 'late' then '16:30'
        else shift_time
      end
      where coalesce(trim(shift_time), '') = ''
      $sql$,
      v_shift_col
    );
  else
    execute format(
      $sql$
      update ob_employees
      set shift_time = case
        when lower(coalesce(%1$I::text, '')) = 'early' and lower(coalesce(%2$I::text, '')) = 'pick' then '07:00'
        when lower(coalesce(%1$I::text, '')) = 'late' and lower(coalesce(%2$I::text, '')) = 'pick' then '15:30'
        when lower(coalesce(%1$I::text, '')) = 'early' then '08:00'
        when lower(coalesce(%1$I::text, '')) = 'late' then '16:30'
        else shift_time
      end
      where coalesce(trim(shift_time), '') = ''
      $sql$,
      v_shift_col,
      v_position_col
    );
  end if;
end
$$;

comment on column ob_employees.shift_time is 'Employee shift start time in HH:MM, used as primary baseline for late checks.';
