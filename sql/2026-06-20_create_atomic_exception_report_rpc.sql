create or replace function public.create_exception_report_atomic(p_payload jsonb)
returns public.ob_exception_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.ob_exception_reports;
  v_report_date date;
  v_prefix text;
  v_last_sequence integer;
  v_next_sequence integer;
  v_report_number text;
begin
  v_report_date := nullif(p_payload ->> 'report_date', '')::date;
  if v_report_date is null then
    raise exception 'report_date is required';
  end if;

  v_prefix := to_char(v_report_date, 'YYYYMMDD');
  perform pg_advisory_xact_lock(hashtext('ob_exception_reports'), hashtext(v_prefix));

  select coalesce(max(substring(report_number from length(v_prefix) + 1)::integer), 0)
    into v_last_sequence
  from public.ob_exception_reports
  where report_number ~ ('^' || v_prefix || '[0-9]+$');

  v_next_sequence := v_last_sequence + 1;
  if v_next_sequence > 9999 then
    raise exception 'Exception report number limit reached for %', v_report_date;
  end if;

  v_report_number := v_prefix || lpad(v_next_sequence::text, 4, '0');

  insert into public.ob_exception_reports (
    report_date,
    report_number,
    exception_type,
    product_barcode,
    picking_list_number,
    picking_container,
    picking_operator,
    packing_rebin_operator,
    picked_location,
    system_location_qty,
    actual_qty,
    item_rows,
    count_by,
    borrowed_location,
    borrowed_qty,
    short_picked,
    inventory_adjustment,
    submitted_by_lead_id,
    status,
    resolution_note
  )
  values (
    v_report_date,
    v_report_number,
    nullif(p_payload ->> 'exception_type', ''),
    p_payload ->> 'product_barcode',
    p_payload ->> 'picking_list_number',
    nullif(p_payload ->> 'picking_container', ''),
    nullif(p_payload ->> 'picking_operator', ''),
    nullif(p_payload ->> 'packing_rebin_operator', ''),
    nullif(p_payload ->> 'picked_location', ''),
    nullif(p_payload ->> 'system_location_qty', '')::numeric,
    nullif(p_payload ->> 'actual_qty', '')::numeric,
    coalesce(p_payload -> 'item_rows', '[]'::jsonb),
    nullif(p_payload ->> 'count_by', ''),
    nullif(p_payload ->> 'borrowed_location', ''),
    nullif(p_payload ->> 'borrowed_qty', '')::numeric,
    coalesce((p_payload ->> 'short_picked')::boolean, false),
    coalesce((p_payload ->> 'inventory_adjustment')::boolean, false),
    nullif(p_payload ->> 'submitted_by_lead_id', ''),
    coalesce(nullif(p_payload ->> 'status', ''), 'Open'),
    nullif(p_payload ->> 'resolution_note', '')
  )
  returning * into v_report;

  return v_report;
end;
$$;

grant execute on function public.create_exception_report_atomic(jsonb) to service_role;

notify pgrst, 'reload schema';
