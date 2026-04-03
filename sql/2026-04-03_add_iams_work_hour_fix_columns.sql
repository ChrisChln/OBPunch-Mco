alter table if exists public.ob_iams_work_hours_imports
  add column if not exists fixed_by text,
  add column if not exists fixed_at timestamptz;

create index if not exists ob_iams_work_hours_imports_fixed_at_idx
  on public.ob_iams_work_hours_imports (fixed_at desc);

comment on column public.ob_iams_work_hours_imports.fixed_by is 'Operator email or name who marked this discrepancy as fixed.';
comment on column public.ob_iams_work_hours_imports.fixed_at is 'Timestamp when discrepancy was marked as fixed.';
