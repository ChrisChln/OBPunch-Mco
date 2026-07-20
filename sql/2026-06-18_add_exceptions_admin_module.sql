create or replace function public.admin_module_keys()
returns text[]
language sql
stable
as $$
  select array[
    'home',
    'package_metrics',
    'consumables',
    'employee_upload',
    'employees',
    'accounts',
    'permissions',
    'timecard',
    'leave_approval',
    'work_hour_comparison',
    'todo',
    'punches',
    'audit',
    'schedule',
    'devices',
    'forecast',
    'prediction_model',
    'efficiency',
    'exceptions',
    'agency'
  ];
$$;
