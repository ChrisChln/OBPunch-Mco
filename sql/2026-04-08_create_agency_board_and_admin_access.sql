create table if not exists public.ob_admin_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('level1', 'level2', 'level3', 'agency')),
  is_active boolean not null default true,
  managed_agencies text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ob_admin_account_modules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_key text not null,
  access_level text not null check (access_level in ('hidden', 'view', 'operate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, module_key)
);

create index if not exists ob_admin_account_modules_user_idx
  on public.ob_admin_account_modules (user_id, module_key);

create table if not exists public.ob_employee_termination_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null,
  employee_user_scope_agency text not null default '',
  requested_by_user_id uuid not null references auth.users(id) on delete cascade,
  requested_by_display text not null default '',
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  review_note text not null default '',
  employee_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null
);

create index if not exists ob_employee_termination_requests_staff_idx
  on public.ob_employee_termination_requests (staff_id, status, created_at desc);

alter table public.ob_admin_accounts enable row level security;
alter table public.ob_admin_account_modules enable row level security;
alter table public.ob_employee_termination_requests enable row level security;

drop policy if exists ob_admin_accounts_self_select on public.ob_admin_accounts;
create policy ob_admin_accounts_self_select
  on public.ob_admin_accounts
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists ob_admin_account_modules_self_select on public.ob_admin_account_modules;
create policy ob_admin_account_modules_self_select
  on public.ob_admin_account_modules
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists ob_employee_termination_requests_self_select on public.ob_employee_termination_requests;
create policy ob_employee_termination_requests_self_select
  on public.ob_employee_termination_requests
  for select
  to authenticated
  using (requested_by_user_id = auth.uid());

grant select on public.ob_admin_accounts to authenticated;
grant select on public.ob_admin_account_modules to authenticated;
grant select on public.ob_employee_termination_requests to authenticated;

create or replace function public.admin_module_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'home',
    'employees',
    'accounts',
    'timecard',
    'leave_approval',
    'todo',
    'punches',
    'audit',
    'schedule',
    'devices',
    'forecast',
    'prediction_model',
    'efficiency',
    'agency'
  ]::text[];
$$;

create or replace function public.resolve_admin_role_for_user(
  p_user_id uuid default auth.uid()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_role text := null;
  v_email text := '';
begin
  if v_user_id is null then
    return null;
  end if;

  select account.role
  into v_role
  from public.ob_admin_accounts as account
  where account.user_id = v_user_id
    and account.is_active = true
  limit 1;

  if v_role is not null then
    return v_role;
  end if;

  select lower(coalesce(auth_user.email, ''))
  into v_email
  from auth.users as auth_user
  where auth_user.id = v_user_id
  limit 1;

  if v_email = 'lnchen4201@gmail.com' then
    return 'level1';
  end if;

  return null;
end;
$$;

create or replace function public.default_admin_module_access(
  p_role text,
  p_module_key text
)
returns text
language sql
immutable
as $$
  select case
    when p_role in ('level1', 'level2') then 'operate'
    when p_role = 'level3' then 'view'
    when p_role = 'agency' then case when p_module_key = 'agency' then 'view' else 'hidden' end
    else 'hidden'
  end;
$$;

create or replace function public.get_admin_access_context()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := null;
  v_managed_agencies text[] := '{}'::text[];
  v_modules jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;

  v_role := public.resolve_admin_role_for_user(v_user_id);

  select coalesce(account.managed_agencies, '{}'::text[])
  into v_managed_agencies
  from public.ob_admin_accounts as account
  where account.user_id = v_user_id
    and account.is_active = true
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'module_key', prepared.module_key,
        'access_level', prepared.access_level
      )
      order by prepared.module_key
    ),
    '[]'::jsonb
  )
  into v_modules
  from (
    select
      module_key,
      coalesce(
        (
          select override_row.access_level
          from public.ob_admin_account_modules as override_row
          where override_row.user_id = v_user_id
            and override_row.module_key = module_key
          limit 1
        ),
        public.default_admin_module_access(v_role, module_key)
      ) as access_level
    from unnest(public.admin_module_keys()) as module_key
  ) as prepared;

  return jsonb_build_object(
    'user_id', v_user_id,
    'role', coalesce(v_role, 'agency'),
    'managed_agencies', to_jsonb(v_managed_agencies),
    'modules', v_modules
  );
end;
$$;

create or replace function public.current_user_managed_agencies(
  p_user_id uuid default auth.uid()
)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_role text := null;
  v_managed_agencies text[] := '{}'::text[];
begin
  if v_user_id is null then
    return '{}'::text[];
  end if;

  v_role := public.resolve_admin_role_for_user(v_user_id);

  select coalesce(account.managed_agencies, '{}'::text[])
  into v_managed_agencies
  from public.ob_admin_accounts as account
  where account.user_id = v_user_id
    and account.is_active = true
  limit 1;

  if v_role in ('level1', 'level2', 'level3') and coalesce(array_length(v_managed_agencies, 1), 0) = 0 then
    return null;
  end if;

  return v_managed_agencies;
end;
$$;

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
  v_access := public.default_admin_module_access(v_role, p_module_key);

  select override_row.access_level
  into v_access
  from public.ob_admin_account_modules as override_row
  where override_row.user_id = v_user_id
    and override_row.module_key = p_module_key
  limit 1;

  return case
    when p_required_access = 'operate' then v_access = 'operate'
    when p_required_access = 'view' then v_access in ('view', 'operate')
    else v_access <> 'hidden'
  end;
end;
$$;

create or replace function public.user_can_manage_admin_access(
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_role text := public.resolve_admin_role_for_user(v_user_id);
begin
  if v_user_id is null then
    return false;
  end if;

  return v_role = 'level1' and public.user_has_module_access('accounts', 'operate', v_user_id);
end;
$$;

create or replace function public.user_can_review_termination_requests(
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_role text := public.resolve_admin_role_for_user(v_user_id);
begin
  if v_user_id is null then
    return false;
  end if;
  if not public.user_has_module_access('schedule', 'operate', v_user_id) then
    return false;
  end if;

  return v_role in ('level1', 'level2', 'level3');
end;
$$;

create or replace function public.agency_target_to_template_date(
  p_work_date date,
  p_today date default (timezone('America/New_York', now()))::date
)
returns date
language plpgsql
immutable
as $$
declare
  v_base_week_start date;
  v_target_week_start date;
  v_week_offset int;
  v_day_index int;
begin
  if p_work_date is null or p_today is null then
    return null;
  end if;

  v_base_week_start := p_today - (((extract(isodow from p_today)::int) + 6) % 7);
  v_target_week_start := p_work_date - (((extract(isodow from p_work_date)::int) + 6) % 7);
  v_week_offset := ((v_target_week_start - v_base_week_start) / 7);
  if v_week_offset < 0 then
    v_week_offset := 0;
  elsif v_week_offset > 1 then
    v_week_offset := 1;
  end if;

  v_day_index := ((extract(isodow from p_work_date)::int) + 6) % 7;
  return date '2000-01-03' + (v_week_offset * 7) + v_day_index;
end;
$$;

create or replace function public.schedule_note_to_state(
  p_note text
)
returns text
language sql
immutable
as $$
  select case coalesce(btrim(p_note), '')
    when '__fixed_work__' then 'fixed_work'
    when '__temp_work__' then 'temp_work'
    when '__leave__' then 'leave'
    when '__temp_rest__' then 'temp_rest'
    when '__planned_temp_work__' then 'planned_temp_work'
    when '__planned_leave__' then 'planned_leave'
    when '__planned_temp_rest__' then 'planned_temp_rest'
    when '__rest__' then 'rest'
    else 'work'
  end;
$$;

create or replace function public.employee_record_text(
  p_employee jsonb,
  p_lower_key text,
  p_cased_key text default null
)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(btrim(coalesce(p_employee ->> p_lower_key, '')), ''),
    nullif(btrim(coalesce(p_employee ->> coalesce(p_cased_key, initcap(p_lower_key)), '')), ''),
    ''
  );
$$;

create or replace function public.list_admin_access_accounts()
returns table (
  user_id uuid,
  user_email text,
  display_name text,
  role text,
  is_active boolean,
  managed_agencies text[],
  modules jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_can_manage_admin_access(v_user_id) then
    raise exception 'Forbidden.';
  end if;

  return query
  select
    account.user_id,
    coalesce(
      nullif(btrim(coalesce(identity_row.user_email, '')), ''),
      nullif(btrim(coalesce(auth_user.email, '')), ''),
      ''
    ) as user_email,
    coalesce(
      nullif(btrim(coalesce(identity_row.display_name, '')), ''),
      nullif(btrim(coalesce(identity_row.user_email, '')), ''),
      nullif(btrim(coalesce(auth_user.email, '')), ''),
      auth_user.id::text
    ) as display_name,
    account.role,
    account.is_active,
    coalesce(account.managed_agencies, '{}'::text[]) as managed_agencies,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'module_key', prepared.module_key,
            'access_level', prepared.access_level
          )
          order by prepared.module_key
        ),
        '[]'::jsonb
      )
      from (
        select
          module_key,
          coalesce(
            (
              select override_row.access_level
              from public.ob_admin_account_modules as override_row
              where override_row.user_id = account.user_id
                and override_row.module_key = module_key
              limit 1
            ),
            public.default_admin_module_access(account.role, module_key)
          ) as access_level
        from unnest(public.admin_module_keys()) as module_key
      ) as prepared
    ) as modules
  from public.ob_admin_accounts as account
  join auth.users as auth_user
    on auth_user.id = account.user_id
  left join lateral public.todo_resolve_user_identity(account.user_id) as identity_row
    on true
  order by
    coalesce(
      nullif(btrim(coalesce(identity_row.display_name, '')), ''),
      nullif(btrim(coalesce(identity_row.user_email, '')), ''),
      nullif(btrim(coalesce(auth_user.email, '')), ''),
      auth_user.id::text
    ),
    account.created_at desc;
end;
$$;

create or replace function public.save_admin_access_account(
  p_user_id uuid,
  p_role text,
  p_is_active boolean default true,
  p_managed_agencies text[] default '{}'::text[],
  p_modules jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_display text := '';
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_is_active boolean := coalesce(p_is_active, true);
  v_managed_agencies text[] := '{}'::text[];
begin
  if v_actor_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_can_manage_admin_access(v_actor_user_id) then
    raise exception 'Forbidden.';
  end if;
  if p_user_id is null then
    raise exception 'User is required.';
  end if;
  if v_role not in ('level1', 'level2', 'level3', 'agency') then
    raise exception 'Unsupported role: %', p_role;
  end if;
  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
  ) then
    raise exception 'Target user not found.';
  end if;

  select coalesce(
    array_agg(distinct normalized.agency order by normalized.agency),
    '{}'::text[]
  )
  into v_managed_agencies
  from (
    select nullif(btrim(coalesce(agency, '')), '') as agency
    from unnest(coalesce(p_managed_agencies, '{}'::text[])) as agency
  ) as normalized
  where normalized.agency is not null;

  insert into public.ob_admin_accounts (
    user_id,
    role,
    is_active,
    managed_agencies,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    v_role,
    v_is_active,
    v_managed_agencies,
    now(),
    now()
  )
  on conflict (user_id) do update
  set
    role = excluded.role,
    is_active = excluded.is_active,
    managed_agencies = excluded.managed_agencies,
    updated_at = now();

  delete from public.ob_admin_account_modules
  where user_id = p_user_id;

  insert into public.ob_admin_account_modules (
    user_id,
    module_key,
    access_level,
    created_at,
    updated_at
  )
  select
    p_user_id,
    prepared.module_key,
    prepared.access_level,
    now(),
    now()
  from (
    select distinct on (module_key)
      lower(btrim(coalesce(module_item ->> 'module_key', ''))) as module_key,
      lower(btrim(coalesce(module_item ->> 'access_level', ''))) as access_level
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_modules, '[]'::jsonb)) = 'array' then coalesce(p_modules, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as module_item
    where jsonb_typeof(module_item) = 'object'
    order by lower(btrim(coalesce(module_item ->> 'module_key', '')))
  ) as prepared
  where prepared.module_key = any(public.admin_module_keys())
    and prepared.access_level in ('hidden', 'view', 'operate')
    and prepared.access_level <> public.default_admin_module_access(v_role, prepared.module_key);

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_actor_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_actor_user_id) as identity_row
  limit 1;

  insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
  values (
    v_actor_display,
    'admin_access_save',
    null,
    'ob_admin_accounts',
    jsonb_build_object(
      'user_id', p_user_id,
      'role', v_role,
      'is_active', v_is_active,
      'managed_agencies', to_jsonb(v_managed_agencies),
      'modules', coalesce(p_modules, '[]'::jsonb)
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'role', v_role,
    'is_active', v_is_active,
    'managed_agencies', to_jsonb(v_managed_agencies)
  );
end;
$$;

create or replace function public.list_employee_termination_requests(
  p_status text default 'pending'
)
returns table (
  id uuid,
  staff_id text,
  agency text,
  requested_by_display text,
  reason text,
  status text,
  review_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid,
  employee_snapshot jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_managed_agencies text[] := public.current_user_managed_agencies(v_user_id);
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('schedule', 'view', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_status is not null and v_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Unsupported termination status: %', p_status;
  end if;

  return query
  select
    request_row.id,
    request_row.staff_id,
    request_row.employee_user_scope_agency as agency,
    request_row.requested_by_display,
    request_row.reason,
    request_row.status,
    request_row.review_note,
    request_row.created_at,
    request_row.reviewed_at,
    request_row.reviewed_by_user_id,
    request_row.employee_snapshot
  from public.ob_employee_termination_requests as request_row
  where (v_status is null or request_row.status = v_status)
    and (
      (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
      or request_row.employee_user_scope_agency = any(coalesce(v_managed_agencies, '{}'::text[]))
    )
  order by
    case when request_row.status = 'pending' then 0 else 1 end,
    request_row.created_at desc;
end;
$$;

create or replace function public.review_employee_termination_request(
  p_request_id uuid,
  p_action text,
  p_review_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_actor_display text := '';
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_request public.ob_employee_termination_requests%rowtype;
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_managed_agencies text[] := public.current_user_managed_agencies(v_user_id);
  v_deleted_schedule_count int := 0;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_action not in ('approve', 'reject') then
    raise exception 'Unsupported review action: %', p_action;
  end if;
  if not public.user_can_review_termination_requests(v_user_id) then
    raise exception 'Forbidden.';
  end if;

  select *
  into v_request
  from public.ob_employee_termination_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Termination request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only pending requests can be reviewed.';
  end if;
  if not (
    (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
    or v_request.employee_user_scope_agency = any(coalesce(v_managed_agencies, '{}'::text[]))
  ) then
    raise exception 'Request is out of scope.';
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_user_id) as identity_row
  limit 1;

  if v_action = 'approve' then
    delete from public.ob_schedules
    where staff_id = v_request.staff_id;
    get diagnostics v_deleted_schedule_count = row_count;

    update public.ob_employees
    set
      active = false,
      terminated_at = v_now
    where staff_id = v_request.staff_id;

    update public.ob_employee_termination_requests
    set
      status = 'approved',
      reviewed_by_user_id = v_user_id,
      review_note = btrim(coalesce(p_review_note, '')),
      reviewed_at = v_now
    where id = p_request_id;

    insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
    values (
      v_actor_display,
      'employee_termination_approve',
      v_request.staff_id,
      'ob_employee_termination_requests',
      jsonb_build_object(
        'request_id', p_request_id,
        'agency', v_request.employee_user_scope_agency,
        'review_note', btrim(coalesce(p_review_note, '')),
        'deleted_schedule_rows', v_deleted_schedule_count
      )
    );
  else
    update public.ob_employee_termination_requests
    set
      status = 'rejected',
      reviewed_by_user_id = v_user_id,
      review_note = btrim(coalesce(p_review_note, '')),
      reviewed_at = v_now
    where id = p_request_id;

    insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
    values (
      v_actor_display,
      'employee_termination_reject',
      v_request.staff_id,
      'ob_employee_termination_requests',
      jsonb_build_object(
        'request_id', p_request_id,
        'agency', v_request.employee_user_scope_agency,
        'review_note', btrim(coalesce(p_review_note, ''))
      )
    );
  end if;

  return jsonb_build_object(
    'request_id', p_request_id,
    'staff_id', v_request.staff_id,
    'status', case when v_action = 'approve' then 'approved' else 'rejected' end,
    'reviewed_at', v_now
  );
end;
$$;

create or replace function public.agency_user_can_access_employee(
  p_staff_id text,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_managed_agencies text[] := public.current_user_managed_agencies(v_user_id);
  v_role text := public.resolve_admin_role_for_user(v_user_id);
begin
  if v_user_id is null then
    return false;
  end if;

  if not public.user_has_module_access('agency', 'view', v_user_id) then
    return false;
  end if;

  if v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null then
    return exists (
      select 1
      from public.ob_employees
      where staff_id = p_staff_id
    );
  end if;

  return exists (
    select 1
    from public.ob_employees
    where staff_id = p_staff_id
      and public.employee_record_text(to_jsonb(ob_employees), 'agency', 'Agency') = any(coalesce(v_managed_agencies, '{}'::text[]))
  );
end;
$$;

create or replace function public.insert_agency_audit_log(
  p_action text,
  p_staff_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_display text := '';
begin
  if v_actor_user_id is null then
    raise exception 'Unauthorized.';
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_actor_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_actor_user_id) as identity_row
  limit 1;

  insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
  values (
    v_actor_display,
    p_action,
    nullif(btrim(coalesce(p_staff_id, '')), ''),
    'agency',
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

create or replace function public.agency_get_board(
  p_work_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_work_date date := coalesce(p_work_date, (timezone('America/New_York', now()))::date);
  v_template_date date := public.agency_target_to_template_date(v_work_date);
  v_role text := public.resolve_admin_role_for_user(v_user_id);
  v_managed_agencies text[] := public.current_user_managed_agencies(v_user_id);
  v_summary_cards jsonb := '[]'::jsonb;
  v_attendance_cards jsonb := '[]'::jsonb;
  v_employees jsonb := '[]'::jsonb;
  v_new_hire_requests jsonb := '[]'::jsonb;
  v_logs jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'view', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_template_date is null then
    raise exception 'Invalid work date.';
  end if;

  create temporary table if not exists tmp_agency_scope_employees (
    staff_id text primary key,
    name text not null,
    agency text not null,
    position text not null,
    shift text not null,
    label text not null,
    terminated_at timestamptz null
  ) on commit drop;
  truncate tmp_agency_scope_employees;

  insert into tmp_agency_scope_employees (staff_id, name, agency, position, shift, label, terminated_at)
  select
    e.staff_id,
    coalesce(nullif(btrim(coalesce(e.name, '')), ''), e.staff_id),
    public.employee_record_text(to_jsonb(e), 'agency', 'Agency'),
    public.employee_record_text(to_jsonb(e), 'position', 'Position'),
    coalesce(nullif(btrim(coalesce(e.shift, '')), ''), ''),
    public.employee_record_text(to_jsonb(e), 'label', 'Label'),
    e.terminated_at
  from public.ob_employees as e
  where e.staff_id is not null
    and (
      (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
      or public.employee_record_text(to_jsonb(e), 'agency', 'Agency') = any(coalesce(v_managed_agencies, '{}'::text[]))
    );

  create temporary table if not exists tmp_agency_schedule_rows (
    staff_id text primary key,
    position text not null,
    note text null,
    state text not null
  ) on commit drop;
  truncate tmp_agency_schedule_rows;

  insert into tmp_agency_schedule_rows (staff_id, position, note, state)
  select distinct on (s.staff_id)
    s.staff_id,
    coalesce(nullif(btrim(coalesce(s.position, '')), ''), ''),
    s.note,
    public.schedule_note_to_state(s.note)
  from public.ob_schedules as s
  join tmp_agency_scope_employees as e on e.staff_id = s.staff_id
  where s.date = v_template_date
  order by s.staff_id, coalesce(s.updated_at, s.created_at) desc, s.id desc;

  create temporary table if not exists tmp_agency_employee_rows (
    staff_id text primary key,
    name text not null,
    agency text not null,
    position text not null,
    shift text not null,
    label text not null,
    state text not null,
    fixed_work_count int not null,
    has_absent boolean not null,
    has_late boolean not null,
    termination_status text null
  ) on commit drop;
  truncate tmp_agency_employee_rows;

  insert into tmp_agency_employee_rows (
    staff_id,
    name,
    agency,
    position,
    shift,
    label,
    state,
    fixed_work_count,
    has_absent,
    has_late,
    termination_status
  )
  select
    e.staff_id,
    e.name,
    public.employee_record_text(to_jsonb(e), 'agency', 'Agency'),
    coalesce(nullif(btrim(coalesce(s.position, '')), ''), public.employee_record_text(to_jsonb(e), 'position', 'Position')),
    e.shift,
    public.employee_record_text(to_jsonb(e), 'label', 'Label'),
    coalesce(s.state, 'rest'),
    (
      select count(*)
      from public.ob_schedules as s2
      where s2.staff_id = e.staff_id
        and s2.date between (v_template_date - (((extract(isodow from v_template_date)::int) + 6) % 7)) and ((v_template_date - (((extract(isodow from v_template_date)::int) + 6) % 7)) + 6)
        and public.schedule_note_to_state(s2.note) = 'fixed_work'
    ) as fixed_work_count,
    exists (
      select 1
      from public.ob_attendance_marks as mark
      where mark.staff_id = e.staff_id
        and mark.work_date = v_work_date
        and mark.mark_type = 'absent'
    ) as has_absent,
    exists (
      select 1
      from public.ob_attendance_marks as mark
      where mark.staff_id = e.staff_id
        and mark.work_date = v_work_date
        and mark.mark_type = 'late'
    ) as has_late,
    (
      select termination_request.status
      from public.ob_employee_termination_requests as termination_request
      where termination_request.staff_id = e.staff_id
      order by termination_request.created_at desc
      limit 1
    ) as termination_status
  from tmp_agency_scope_employees as e
  left join tmp_agency_schedule_rows as s on s.staff_id = e.staff_id
  where e.terminated_at is null;

  select jsonb_build_array(
    jsonb_build_object('key', 'required', 'label', 'Required', 'value',
      (
        select count(*)
        from tmp_agency_employee_rows
        where state in ('work', 'fixed_work', 'temp_work', 'planned_temp_work', 'leave', 'planned_leave')
      ) + (
        select count(*)
        from tmp_agency_employee_rows
        where staff_id ~ ('^' || to_char(v_work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$')
      )
    ),
    jsonb_build_object('key', 'scheduled', 'label', 'Scheduled', 'value',
      (
        select count(*)
        from tmp_agency_employee_rows
        where state in ('work', 'fixed_work', 'temp_work', 'planned_temp_work')
      )
    ),
    jsonb_build_object('key', 'new_requests', 'label', 'New Requests', 'value',
      (
        select count(*)
        from tmp_agency_employee_rows
        where staff_id ~ ('^' || to_char(v_work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$')
      )
    ),
    jsonb_build_object('key', 'gap', 'label', 'Gap', 'value',
      (
        select count(*)
        from tmp_agency_employee_rows
        where state in ('leave', 'planned_leave')
      ) + (
        select count(*)
        from tmp_agency_employee_rows
        where staff_id ~ ('^' || to_char(v_work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$')
      )
    )
  )
  into v_summary_cards;

  select jsonb_build_array(
    jsonb_build_object('key', 'present', 'label', 'Present', 'value',
      (
        select count(*)
        from tmp_agency_employee_rows
        where state in ('work', 'fixed_work', 'temp_work', 'planned_temp_work')
          and has_absent = false
          and has_late = false
      )
    ),
    jsonb_build_object('key', 'absent', 'label', 'Absent', 'value',
      (
        select count(*)
        from tmp_agency_employee_rows
        where has_absent = true
      )
    ),
    jsonb_build_object('key', 'late', 'label', 'Late', 'value',
      (
        select count(*)
        from tmp_agency_employee_rows
        where has_late = true
      )
    )
  )
  into v_attendance_cards;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'staff_id', row.staff_id,
        'name', row.name,
        'agency', row.agency,
        'position', row.position,
        'shift', row.shift,
        'label', row.label,
        'state', row.state,
        'fixed_work_count', row.fixed_work_count,
        'has_absent', row.has_absent,
        'has_late', row.has_late,
        'termination_status', row.termination_status
      )
      order by row.position, row.name, row.staff_id
    ),
    '[]'::jsonb
  )
  into v_employees
  from tmp_agency_employee_rows as row
  where row.staff_id !~ ('^' || to_char(v_work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'staff_id', row.staff_id,
        'name', row.name,
        'agency', row.agency,
        'position', row.position,
        'shift', row.shift,
        'label', row.label,
        'state', row.state
      )
      order by row.position, row.staff_id
    ),
    '[]'::jsonb
  )
  into v_new_hire_requests
  from tmp_agency_employee_rows as row
  where row.staff_id ~ ('^' || to_char(v_work_date, 'MMDD') || '[A-Z]+[0-9]{3,}$');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', audit.id,
        'created_at', audit.created_at,
        'actor', audit.actor,
        'action', audit.action,
        'staff_id', audit.staff_id,
        'payload', audit.payload
      )
      order by audit.created_at desc
    ),
    '[]'::jsonb
  )
  into v_logs
  from (
    select log.id, log.created_at, log.actor, log.action, log.staff_id, log.payload
    from public.ob_audit_logs as log
    where log.target = 'agency'
      and (
        (v_role in ('level1', 'level2', 'level3') and v_managed_agencies is null)
        or coalesce(nullif(btrim(coalesce(log.payload ->> 'agency', '')), ''), '') = any(coalesce(v_managed_agencies, '{}'::text[]))
      )
    order by log.created_at desc
    limit 100
  ) as audit;

  return jsonb_build_object(
    'work_date', v_work_date,
    'template_date', v_template_date,
    'role', coalesce(v_role, 'agency'),
    'managed_agencies', to_jsonb(coalesce(v_managed_agencies, '{}'::text[])),
    'summary_cards', v_summary_cards,
    'attendance_cards', v_attendance_cards,
    'employees', v_employees,
    'new_hire_requests', v_new_hire_requests,
    'logs', v_logs
  );
end;
$$;

create or replace function public.agency_set_planned_leave(
  p_staff_id text,
  p_work_date date,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_id text := btrim(coalesce(p_staff_id, ''));
  v_work_date date := p_work_date;
  v_template_date date := public.agency_target_to_template_date(v_work_date);
  v_now timestamptz := now();
  v_employee public.ob_employees%rowtype;
  v_schedule public.ob_schedules%rowtype;
  v_current_state text := null;
  v_shift text := '';
  v_cutoff timestamptz := null;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_staff_id = '' or v_work_date is null or v_template_date is null then
    raise exception 'Invalid leave request.';
  end if;
  if not public.agency_user_can_access_employee(v_staff_id, v_user_id) then
    raise exception 'Employee is out of scope.';
  end if;

  select *
  into v_employee
  from public.ob_employees
  where staff_id = v_staff_id
  limit 1;

  if not found then
    raise exception 'Employee not found.';
  end if;
  if v_employee.terminated_at is not null then
    raise exception 'Terminated employee cannot be changed.';
  end if;

  v_shift := coalesce(nullif(btrim(coalesce(v_employee.shift, '')), ''), '');
  if v_shift not in ('early', 'late') then
    raise exception 'Employee shift is required.';
  end if;

  if v_work_date = (timezone('America/New_York', v_now))::date then
    if v_shift = 'early' then
      v_cutoff := timezone('America/New_York', (v_work_date::text || ' 10:00:00')::timestamp);
    else
      v_cutoff := timezone('America/New_York', (v_work_date::text || ' 17:00:00')::timestamp);
    end if;
    if v_now > v_cutoff then
      raise exception 'Leave cutoff has passed.';
    end if;
  end if;

  select *
  into v_schedule
  from public.ob_schedules
  where staff_id = v_staff_id
    and date = v_template_date
  order by coalesce(updated_at, created_at) desc, id desc
  limit 1;

  if found then
    v_current_state := public.schedule_note_to_state(v_schedule.note);
  else
    v_current_state := 'rest';
  end if;

  if v_current_state not in ('work', 'fixed_work', 'temp_work', 'planned_temp_work') then
    raise exception 'Only fixed/work/temp states can be changed to planned leave.';
  end if;

  if found then
    update public.ob_schedules
    set
      note = '__planned_leave__',
      operator = coalesce(v_employee.name, v_staff_id),
      updated_at = v_now
    where id = v_schedule.id;
  else
    insert into public.ob_schedules (staff_id, date, position, note, operator, created_at, updated_at)
    values (
      v_staff_id,
      v_template_date,
      nullif(public.employee_record_text(to_jsonb(v_employee), 'position', 'Position'), ''),
      '__planned_leave__',
      coalesce(v_employee.name, v_staff_id),
      v_now,
      v_now
    );
  end if;

  perform public.insert_agency_audit_log(
    'agency_planned_leave',
    v_staff_id,
    jsonb_build_object(
      'agency', public.employee_record_text(to_jsonb(v_employee), 'agency', 'Agency'),
      'work_date', v_work_date,
      'template_date', v_template_date,
      'reason', coalesce(p_reason, ''),
      'from_state', v_current_state,
      'to_state', 'planned_leave'
    )
  );

  return jsonb_build_object(
    'staff_id', v_staff_id,
    'work_date', v_work_date,
    'template_date', v_template_date,
    'state', 'planned_leave'
  );
end;
$$;

create or replace function public.agency_assign_substitute(
  p_target_staff_id text,
  p_substitute_staff_id text,
  p_work_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_staff_id text := btrim(coalesce(p_target_staff_id, ''));
  v_substitute_staff_id text := btrim(coalesce(p_substitute_staff_id, ''));
  v_work_date date := p_work_date;
  v_template_date date := public.agency_target_to_template_date(v_work_date);
  v_now timestamptz := now();
  v_target public.ob_employees%rowtype;
  v_substitute public.ob_employees%rowtype;
  v_target_schedule public.ob_schedules%rowtype;
  v_substitute_schedule public.ob_schedules%rowtype;
  v_target_state text := '';
  v_substitute_state text := '';
  v_substitute_fixed_count int := 0;
  v_next_state text := '';
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_target_staff_id = '' or v_substitute_staff_id = '' or v_target_staff_id = v_substitute_staff_id or v_work_date is null or v_template_date is null then
    raise exception 'Invalid substitute request.';
  end if;
  if not public.agency_user_can_access_employee(v_target_staff_id, v_user_id) or not public.agency_user_can_access_employee(v_substitute_staff_id, v_user_id) then
    raise exception 'Employee is out of scope.';
  end if;

  select * into v_target from public.ob_employees where staff_id = v_target_staff_id limit 1;
  select * into v_substitute from public.ob_employees where staff_id = v_substitute_staff_id limit 1;
  if not found then
    raise exception 'Employee not found.';
  end if;
  if public.employee_record_text(to_jsonb(v_target), 'position', 'Position') <> public.employee_record_text(to_jsonb(v_substitute), 'position', 'Position') then
    raise exception 'Substitute must have the same position.';
  end if;

  select *
  into v_target_schedule
  from public.ob_schedules
  where staff_id = v_target_staff_id
    and date = v_template_date
  order by coalesce(updated_at, created_at) desc, id desc
  limit 1;

  select *
  into v_substitute_schedule
  from public.ob_schedules
  where staff_id = v_substitute_staff_id
    and date = v_template_date
  order by coalesce(updated_at, created_at) desc, id desc
  limit 1;

  v_target_state := case when v_target_schedule.id is null then 'rest' else public.schedule_note_to_state(v_target_schedule.note) end;
  v_substitute_state := case when v_substitute_schedule.id is null then 'rest' else public.schedule_note_to_state(v_substitute_schedule.note) end;

  if v_target_state not in ('leave', 'planned_leave') then
    raise exception 'Target employee must already be on leave or planned leave.';
  end if;
  if v_substitute_state in ('work', 'fixed_work', 'temp_work') then
    raise exception 'Substitute already has working schedule today.';
  end if;

  select count(*)
  into v_substitute_fixed_count
  from public.ob_schedules as s
  where s.staff_id = v_substitute_staff_id
    and s.date between (v_template_date - (((extract(isodow from v_template_date)::int) + 6) % 7)) and ((v_template_date - (((extract(isodow from v_template_date)::int) + 6) % 7)) + 6)
    and public.schedule_note_to_state(s.note) = 'fixed_work';

  if v_substitute_fixed_count >= 5 then
    raise exception 'Substitute fixed-work count has reached the weekly limit.';
  end if;

  v_next_state := case
    when v_work_date = (timezone('America/New_York', v_now))::date then 'temp_work'
    else 'planned_temp_work'
  end;

  if v_substitute_schedule.id is not null then
    update public.ob_schedules
    set
      note = case when v_next_state = 'temp_work' then '__temp_work__' else '__planned_temp_work__' end,
      operator = coalesce(v_substitute.name, v_substitute_staff_id),
      updated_at = v_now
    where id = v_substitute_schedule.id;
  else
    insert into public.ob_schedules (staff_id, date, position, note, operator, created_at, updated_at)
    values (
      v_substitute_staff_id,
      v_template_date,
      nullif(public.employee_record_text(to_jsonb(v_substitute), 'position', 'Position'), ''),
      case when v_next_state = 'temp_work' then '__temp_work__' else '__planned_temp_work__' end,
      coalesce(v_substitute.name, v_substitute_staff_id),
      v_now,
      v_now
    );
  end if;

  perform public.insert_agency_audit_log(
    'agency_substitute_assign',
    v_target_staff_id,
    jsonb_build_object(
      'agency', public.employee_record_text(to_jsonb(v_target), 'agency', 'Agency'),
      'work_date', v_work_date,
      'template_date', v_template_date,
      'target_staff_id', v_target_staff_id,
      'substitute_staff_id', v_substitute_staff_id,
      'state', v_next_state
    )
  );

  return jsonb_build_object(
    'target_staff_id', v_target_staff_id,
    'substitute_staff_id', v_substitute_staff_id,
    'work_date', v_work_date,
    'template_date', v_template_date,
    'state', v_next_state
  );
end;
$$;

create or replace function public.agency_upsert_new_hire_demand(
  p_staff_id text default null,
  p_work_date date default null,
  p_position text default null,
  p_shift text default null,
  p_agency text default null,
  p_label text default '',
  p_entry_time text default '',
  p_note text default '',
  p_count int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_id text := nullif(btrim(coalesce(p_staff_id, '')), '');
  v_work_date date := coalesce(p_work_date, (timezone('America/New_York', now()))::date);
  v_template_date date := public.agency_target_to_template_date(v_work_date);
  v_position text := btrim(coalesce(p_position, ''));
  v_shift text := lower(btrim(coalesce(p_shift, '')));
  v_agency text := btrim(coalesce(p_agency, ''));
  v_label text := btrim(coalesce(p_label, ''));
  v_entry_time text := btrim(coalesce(p_entry_time, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_count int := greatest(1, least(coalesce(p_count, 1), 200));
  v_now timestamptz := now();
  v_next_seq int := 1;
  v_created_ids text[] := '{}'::text[];
  v_existing public.ob_employees%rowtype;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_template_date is null then
    raise exception 'Invalid work date.';
  end if;
  if v_position = '' or v_shift not in ('early', 'late') or v_agency = '' then
    raise exception 'Position, shift, and agency are required.';
  end if;

  if v_staff_id is not null then
    if not public.agency_user_can_access_employee(v_staff_id, v_user_id) then
      raise exception 'Employee is out of scope.';
    end if;

    select *
    into v_existing
    from public.ob_employees
    where staff_id = v_staff_id
    limit 1;

    if not found then
      raise exception 'Demand row not found.';
    end if;

    update public.ob_employees
    set
      name = coalesce(nullif(v_note, ''), name),
      agency = v_agency,
      position = v_position,
      shift = v_shift,
      label = nullif(v_label, '')
    where staff_id = v_staff_id;

    update public.ob_schedules
    set
      position = v_position,
      updated_at = v_now
    where staff_id = v_staff_id
      and date = v_template_date;

    perform public.insert_agency_audit_log(
      'agency_new_hire_update',
      v_staff_id,
      jsonb_build_object(
        'agency', v_agency,
        'work_date', v_work_date,
        'template_date', v_template_date,
        'position', v_position,
        'shift', v_shift,
        'label', v_label,
        'entry_time', v_entry_time,
        'note', v_note
      )
    );

    return jsonb_build_object(
      'staff_ids', jsonb_build_array(v_staff_id),
      'mode', 'update'
    );
  end if;

  select coalesce(max(substring(e.staff_id from '([0-9]{3,})$')::int), 0) + 1
  into v_next_seq
  from public.ob_employees as e
  where e.staff_id like to_char(v_work_date, 'MMDD') || upper(v_position) || '%';

  for i in 0..(v_count - 1) loop
    v_staff_id := to_char(v_work_date, 'MMDD') || upper(v_position) || lpad((v_next_seq + i)::text, 3, '0');

    insert into public.ob_employees (
      staff_id,
      name,
      agency,
      position,
      shift,
      label,
      created_at
    )
    values (
      v_staff_id,
      coalesce(nullif(v_note, ''), 'New Request'),
      v_agency,
      v_position,
      v_shift,
      nullif(v_label, ''),
      v_now
    )
    on conflict (staff_id) do update
    set
      name = excluded.name,
      agency = excluded.agency,
      position = excluded.position,
      shift = excluded.shift,
      label = excluded.label;

    insert into public.ob_schedules (staff_id, date, position, note, operator, created_at, updated_at)
    values (
      v_staff_id,
      v_template_date,
      v_position,
      null,
      'agency_new_hire',
      v_now,
      v_now
    )
    on conflict (staff_id, date) do update
    set
      position = excluded.position,
      updated_at = excluded.updated_at;

    v_created_ids := array_append(v_created_ids, v_staff_id);
  end loop;

  perform public.insert_agency_audit_log(
    'agency_new_hire_create',
    null,
    jsonb_build_object(
      'agency', v_agency,
      'work_date', v_work_date,
      'template_date', v_template_date,
      'position', v_position,
      'shift', v_shift,
      'label', v_label,
      'entry_time', v_entry_time,
      'note', v_note,
      'count', v_count,
      'staff_ids', to_jsonb(v_created_ids)
    )
  );

  return jsonb_build_object(
    'staff_ids', to_jsonb(v_created_ids),
    'mode', 'create'
  );
end;
$$;

create or replace function public.agency_create_termination_request(
  p_staff_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_staff_id text := btrim(coalesce(p_staff_id, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_employee public.ob_employees%rowtype;
  v_actor_display text := '';
  v_request_id uuid := null;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('agency', 'operate', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_staff_id = '' or v_reason = '' then
    raise exception 'Employee and reason are required.';
  end if;
  if not public.agency_user_can_access_employee(v_staff_id, v_user_id) then
    raise exception 'Employee is out of scope.';
  end if;

  select *
  into v_employee
  from public.ob_employees
  where staff_id = v_staff_id
  limit 1;

  if not found then
    raise exception 'Employee not found.';
  end if;

  if exists (
    select 1
    from public.ob_employee_termination_requests as request_row
    where request_row.staff_id = v_staff_id
      and request_row.status = 'pending'
  ) then
    raise exception 'A pending termination request already exists.';
  end if;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_user_id) as identity_row
  limit 1;

  insert into public.ob_employee_termination_requests (
    staff_id,
    employee_user_scope_agency,
    requested_by_user_id,
    requested_by_display,
    reason,
    status,
    employee_snapshot,
    created_at
  )
  values (
    v_staff_id,
    public.employee_record_text(to_jsonb(v_employee), 'agency', 'Agency'),
    v_user_id,
    v_actor_display,
    v_reason,
    'pending',
    jsonb_build_object(
      'staff_id', v_employee.staff_id,
      'name', v_employee.name,
      'agency', public.employee_record_text(to_jsonb(v_employee), 'agency', 'Agency'),
      'position', public.employee_record_text(to_jsonb(v_employee), 'position', 'Position'),
      'shift', v_employee.shift,
      'label', public.employee_record_text(to_jsonb(v_employee), 'label', 'Label')
    ),
    now()
  )
  returning id into v_request_id;

  perform public.insert_agency_audit_log(
    'agency_termination_request',
    v_staff_id,
    jsonb_build_object(
      'agency', public.employee_record_text(to_jsonb(v_employee), 'agency', 'Agency'),
      'request_id', v_request_id,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'staff_id', v_staff_id,
    'status', 'pending'
  );
end;
$$;

insert into public.ob_admin_accounts (user_id, role, is_active, managed_agencies)
select auth_user.id, 'level1', true, '{}'::text[]
from auth.users as auth_user
where lower(coalesce(auth_user.email, '')) = 'lnchen4201@gmail.com'
on conflict (user_id) do update
set
  role = excluded.role,
  is_active = true,
  updated_at = now();

revoke all on function public.admin_module_keys() from public;
revoke all on function public.resolve_admin_role_for_user(uuid) from public;
revoke all on function public.default_admin_module_access(text, text) from public;
revoke all on function public.get_admin_access_context() from public;
revoke all on function public.current_user_managed_agencies(uuid) from public;
revoke all on function public.user_has_module_access(text, text, uuid) from public;
revoke all on function public.user_can_manage_admin_access(uuid) from public;
revoke all on function public.user_can_review_termination_requests(uuid) from public;
revoke all on function public.agency_target_to_template_date(date, date) from public;
revoke all on function public.schedule_note_to_state(text) from public;
revoke all on function public.employee_record_text(jsonb, text, text) from public;
revoke all on function public.list_admin_access_accounts() from public;
revoke all on function public.save_admin_access_account(uuid, text, boolean, text[], jsonb) from public;
revoke all on function public.agency_user_can_access_employee(text, uuid) from public;
revoke all on function public.insert_agency_audit_log(text, text, jsonb) from public;
revoke all on function public.agency_get_board(date) from public;
revoke all on function public.agency_set_planned_leave(text, date, text) from public;
revoke all on function public.agency_assign_substitute(text, text, date) from public;
revoke all on function public.agency_upsert_new_hire_demand(text, date, text, text, text, text, text, text, int) from public;
revoke all on function public.agency_create_termination_request(text, text) from public;
revoke all on function public.list_employee_termination_requests(text) from public;
revoke all on function public.review_employee_termination_request(uuid, text, text) from public;

grant execute on function public.admin_module_keys() to authenticated;
grant execute on function public.resolve_admin_role_for_user(uuid) to authenticated;
grant execute on function public.default_admin_module_access(text, text) to authenticated;
grant execute on function public.get_admin_access_context() to authenticated;
grant execute on function public.current_user_managed_agencies(uuid) to authenticated;
grant execute on function public.user_has_module_access(text, text, uuid) to authenticated;
grant execute on function public.user_can_manage_admin_access(uuid) to authenticated;
grant execute on function public.user_can_review_termination_requests(uuid) to authenticated;
grant execute on function public.agency_target_to_template_date(date, date) to authenticated;
grant execute on function public.schedule_note_to_state(text) to authenticated;
grant execute on function public.employee_record_text(jsonb, text, text) to authenticated;
grant execute on function public.list_admin_access_accounts() to authenticated;
grant execute on function public.save_admin_access_account(uuid, text, boolean, text[], jsonb) to authenticated;
grant execute on function public.agency_user_can_access_employee(text, uuid) to authenticated;
grant execute on function public.insert_agency_audit_log(text, text, jsonb) to authenticated;
grant execute on function public.agency_get_board(date) to authenticated;
grant execute on function public.agency_set_planned_leave(text, date, text) to authenticated;
grant execute on function public.agency_assign_substitute(text, text, date) to authenticated;
grant execute on function public.agency_upsert_new_hire_demand(text, date, text, text, text, text, text, text, int) to authenticated;
grant execute on function public.agency_create_termination_request(text, text) to authenticated;
grant execute on function public.list_employee_termination_requests(text) to authenticated;
grant execute on function public.review_employee_termination_request(uuid, text, text) to authenticated;

grant execute on function public.admin_module_keys() to service_role;
grant execute on function public.resolve_admin_role_for_user(uuid) to service_role;
grant execute on function public.default_admin_module_access(text, text) to service_role;
grant execute on function public.get_admin_access_context() to service_role;
grant execute on function public.current_user_managed_agencies(uuid) to service_role;
grant execute on function public.user_has_module_access(text, text, uuid) to service_role;
grant execute on function public.user_can_manage_admin_access(uuid) to service_role;
grant execute on function public.user_can_review_termination_requests(uuid) to service_role;
grant execute on function public.agency_target_to_template_date(date, date) to service_role;
grant execute on function public.schedule_note_to_state(text) to service_role;
grant execute on function public.employee_record_text(jsonb, text, text) to service_role;
grant execute on function public.list_admin_access_accounts() to service_role;
grant execute on function public.save_admin_access_account(uuid, text, boolean, text[], jsonb) to service_role;
grant execute on function public.agency_user_can_access_employee(text, uuid) to service_role;
grant execute on function public.insert_agency_audit_log(text, text, jsonb) to service_role;
grant execute on function public.agency_get_board(date) to service_role;
grant execute on function public.agency_set_planned_leave(text, date, text) to service_role;
grant execute on function public.agency_assign_substitute(text, text, date) to service_role;
grant execute on function public.agency_upsert_new_hire_demand(text, date, text, text, text, text, text, text, int) to service_role;
grant execute on function public.agency_create_termination_request(text, text) to service_role;
grant execute on function public.list_employee_termination_requests(text) to service_role;
grant execute on function public.review_employee_termination_request(uuid, text, text) to service_role;
