create table if not exists public.ob_admin_access_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requested_role text not null check (requested_role in ('level1', 'level2', 'level3', 'agency')),
  requested_managed_agencies text[] not null default '{}'::text[],
  requested_modules jsonb not null default '[]'::jsonb,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  reviewed_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null
);

create index if not exists ob_admin_access_requests_requester_idx
  on public.ob_admin_access_requests (requester_user_id, status, created_at desc);

create unique index if not exists ob_admin_access_requests_pending_unique_idx
  on public.ob_admin_access_requests (requester_user_id)
  where status = 'pending';

alter table public.ob_admin_access_requests enable row level security;

drop policy if exists ob_admin_access_requests_self_select on public.ob_admin_access_requests;
create policy ob_admin_access_requests_self_select
  on public.ob_admin_access_requests
  for select
  to authenticated
  using (requester_user_id = auth.uid());

grant select on public.ob_admin_access_requests to authenticated;

create or replace function public.admin_module_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'home',
    'employees',
    'accounts',
    'permissions',
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
    when p_role = 'agency' then case when p_module_key in ('agency', 'permissions') then 'view' else 'hidden' end
    else 'hidden'
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

  return v_role = 'level1' and public.user_has_module_access('permissions', 'operate', v_user_id);
end;
$$;

create or replace function public.create_admin_access_request(
  p_requested_role text,
  p_requested_managed_agencies text[] default '{}'::text[],
  p_requested_modules jsonb default '[]'::jsonb,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_actor_display text := '';
  v_requested_role text := lower(btrim(coalesce(p_requested_role, '')));
  v_requested_managed_agencies text[] := '{}'::text[];
  v_requested_modules jsonb := '[]'::jsonb;
  v_request_id uuid := null;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_requested_role not in ('level1', 'level2', 'level3', 'agency') then
    raise exception 'Unsupported role: %', p_requested_role;
  end if;
  if exists (
    select 1
    from public.ob_admin_access_requests as request_row
    where request_row.requester_user_id = v_user_id
      and request_row.status = 'pending'
  ) then
    raise exception 'A pending access request already exists.';
  end if;

  select coalesce(
    array_agg(distinct normalized.agency order by normalized.agency),
    '{}'::text[]
  )
  into v_requested_managed_agencies
  from (
    select nullif(btrim(coalesce(agency, '')), '') as agency
    from unnest(coalesce(p_requested_managed_agencies, '{}'::text[])) as agency
  ) as normalized
  where normalized.agency is not null;

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
  into v_requested_modules
  from (
    select distinct on (module_key)
      lower(btrim(coalesce(module_item ->> 'module_key', ''))) as module_key,
      lower(btrim(coalesce(module_item ->> 'access_level', ''))) as access_level
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_requested_modules, '[]'::jsonb)) = 'array' then coalesce(p_requested_modules, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as module_item
    where jsonb_typeof(module_item) = 'object'
    order by lower(btrim(coalesce(module_item ->> 'module_key', '')))
  ) as prepared
  where prepared.module_key = any(public.admin_module_keys())
    and prepared.access_level in ('hidden', 'view', 'operate');

  insert into public.ob_admin_access_requests (
    requester_user_id,
    requested_role,
    requested_managed_agencies,
    requested_modules,
    reason,
    status,
    created_at
  )
  values (
    v_user_id,
    v_requested_role,
    v_requested_managed_agencies,
    v_requested_modules,
    btrim(coalesce(p_reason, '')),
    'pending',
    now()
  )
  returning id into v_request_id;

  select coalesce(
    nullif(btrim(coalesce(identity_row.display_name, '')), ''),
    nullif(btrim(coalesce(identity_row.user_email, '')), ''),
    v_user_id::text
  )
  into v_actor_display
  from public.todo_resolve_user_identity(v_user_id) as identity_row
  limit 1;

  insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
  values (
    v_actor_display,
    'admin_access_request_create',
    null,
    'ob_admin_access_requests',
    jsonb_build_object(
      'request_id', v_request_id,
      'requested_role', v_requested_role,
      'requested_managed_agencies', to_jsonb(v_requested_managed_agencies),
      'requested_modules', v_requested_modules,
      'reason', btrim(coalesce(p_reason, ''))
    )
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'status', 'pending'
  );
end;
$$;

create or replace function public.list_admin_access_requests(
  p_status text default null
)
returns table (
  id uuid,
  requester_user_id uuid,
  requester_user_email text,
  requester_display_name text,
  requested_role text,
  requested_managed_agencies text[],
  requested_modules jsonb,
  reason text,
  status text,
  review_note text,
  reviewed_by_user_id uuid,
  reviewed_by_display_name text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_can_manage boolean := false;
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if not public.user_has_module_access('permissions', 'view', v_user_id) then
    raise exception 'Forbidden.';
  end if;
  if v_status is not null and v_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Unsupported access request status: %', p_status;
  end if;

  v_can_manage := public.user_can_manage_admin_access(v_user_id);

  return query
  select
    request_row.id,
    request_row.requester_user_id,
    coalesce(
      nullif(btrim(coalesce(requester_identity.user_email, '')), ''),
      nullif(btrim(coalesce(requester_auth.email, '')), ''),
      ''
    ) as requester_user_email,
    coalesce(
      nullif(btrim(coalesce(requester_identity.display_name, '')), ''),
      nullif(btrim(coalesce(requester_identity.user_email, '')), ''),
      nullif(btrim(coalesce(requester_auth.email, '')), ''),
      requester_auth.id::text
    ) as requester_display_name,
    request_row.requested_role,
    coalesce(request_row.requested_managed_agencies, '{}'::text[]) as requested_managed_agencies,
    coalesce(request_row.requested_modules, '[]'::jsonb) as requested_modules,
    request_row.reason,
    request_row.status,
    request_row.review_note,
    request_row.reviewed_by_user_id,
    coalesce(
      nullif(btrim(coalesce(reviewer_identity.display_name, '')), ''),
      nullif(btrim(coalesce(reviewer_identity.user_email, '')), ''),
      nullif(btrim(coalesce(reviewer_auth.email, '')), ''),
      case when reviewer_auth.id is not null then reviewer_auth.id::text else '' end
    ) as reviewed_by_display_name,
    request_row.created_at,
    request_row.reviewed_at
  from public.ob_admin_access_requests as request_row
  join auth.users as requester_auth
    on requester_auth.id = request_row.requester_user_id
  left join auth.users as reviewer_auth
    on reviewer_auth.id = request_row.reviewed_by_user_id
  left join lateral public.todo_resolve_user_identity(request_row.requester_user_id) as requester_identity
    on true
  left join lateral public.todo_resolve_user_identity(request_row.reviewed_by_user_id) as reviewer_identity
    on true
  where (v_status is null or request_row.status = v_status)
    and (v_can_manage or request_row.requester_user_id = v_user_id)
  order by
    case when request_row.status = 'pending' then 0 else 1 end,
    request_row.created_at desc;
end;
$$;

create or replace function public.review_admin_access_request(
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
  v_request public.ob_admin_access_requests%rowtype;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Unauthorized.';
  end if;
  if v_action not in ('approve', 'reject') then
    raise exception 'Unsupported review action: %', p_action;
  end if;
  if not public.user_can_manage_admin_access(v_user_id) then
    raise exception 'Forbidden.';
  end if;

  select *
  into v_request
  from public.ob_admin_access_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Access request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only pending access requests can be reviewed.';
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
    perform public.save_admin_access_account(
      v_request.requester_user_id,
      v_request.requested_role,
      true,
      coalesce(v_request.requested_managed_agencies, '{}'::text[]),
      coalesce(v_request.requested_modules, '[]'::jsonb)
    );

    update public.ob_admin_access_requests
    set
      status = 'approved',
      reviewed_by_user_id = v_user_id,
      review_note = btrim(coalesce(p_review_note, '')),
      reviewed_at = v_now
    where id = p_request_id;

    insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
    values (
      v_actor_display,
      'admin_access_request_approve',
      null,
      'ob_admin_access_requests',
      jsonb_build_object(
        'request_id', p_request_id,
        'requester_user_id', v_request.requester_user_id,
        'requested_role', v_request.requested_role,
        'requested_managed_agencies', to_jsonb(coalesce(v_request.requested_managed_agencies, '{}'::text[])),
        'requested_modules', coalesce(v_request.requested_modules, '[]'::jsonb),
        'review_note', btrim(coalesce(p_review_note, ''))
      )
    );
  else
    update public.ob_admin_access_requests
    set
      status = 'rejected',
      reviewed_by_user_id = v_user_id,
      review_note = btrim(coalesce(p_review_note, '')),
      reviewed_at = v_now
    where id = p_request_id;

    insert into public.ob_audit_logs (actor, action, staff_id, target, payload)
    values (
      v_actor_display,
      'admin_access_request_reject',
      null,
      'ob_admin_access_requests',
      jsonb_build_object(
        'request_id', p_request_id,
        'requester_user_id', v_request.requester_user_id,
        'requested_role', v_request.requested_role,
        'requested_managed_agencies', to_jsonb(coalesce(v_request.requested_managed_agencies, '{}'::text[])),
        'requested_modules', coalesce(v_request.requested_modules, '[]'::jsonb),
        'review_note', btrim(coalesce(p_review_note, ''))
      )
    );
  end if;

  return jsonb_build_object(
    'request_id', p_request_id,
    'requester_user_id', v_request.requester_user_id,
    'status', case when v_action = 'approve' then 'approved' else 'rejected' end,
    'reviewed_at', v_now
  );
end;
$$;

revoke all on function public.create_admin_access_request(text, text[], jsonb, text) from public;
revoke all on function public.list_admin_access_requests(text) from public;
revoke all on function public.review_admin_access_request(uuid, text, text) from public;

grant execute on function public.create_admin_access_request(text, text[], jsonb, text) to authenticated;
grant execute on function public.list_admin_access_requests(text) to authenticated;
grant execute on function public.review_admin_access_request(uuid, text, text) to authenticated;

grant execute on function public.create_admin_access_request(text, text[], jsonb, text) to service_role;
grant execute on function public.list_admin_access_requests(text) to service_role;
grant execute on function public.review_admin_access_request(uuid, text, text) to service_role;
