alter table public.ob_exception_reports
  drop constraint if exists ob_exception_reports_borrowed_pair_chk;

alter table public.ob_exception_reports
  add constraint ob_exception_reports_borrowed_pair_chk
  check (
    (borrowed_location is null and borrowed_qty is null)
    or (borrowed_location is not null and borrowed_qty is not null)
    or (
      borrowed_location is null
      and borrowed_qty is not null
      and exception_type in ('over_pick', 'short_pick')
    )
  );

notify pgrst, 'reload schema';
