do $$
declare
  v_table record;
begin
  for v_table in
    select table_schema, table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'staff_id'
      and data_type in ('text', 'character varying')
    order by table_name
  loop
    if v_table.table_name = 'ob_punches' then
      alter table public.ob_punches disable trigger user;
    end if;

    execute format(
      'update %I.%I as target
          set staff_id = alias.staff_id
         from public.ob_temp_account_assignments as alias
        where target.staff_id = alias.source_temp_staff_id
          and alias.source_temp_staff_id like %L',
      v_table.table_schema,
      v_table.table_name,
      'TEMP%'
    );

    if v_table.table_name = 'ob_punches' then
      alter table public.ob_punches enable trigger user;
    end if;
  end loop;
end $$;
