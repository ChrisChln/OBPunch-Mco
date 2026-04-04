create table if not exists public.ob_leave_requests (
  id bigserial primary key,
  source text not null default 'google_form',
  source_row_key text not null,
  submitted_at timestamptz null,
  submitted_at_raw text null,
  employee_name_raw text not null,
  employee_staff_id_raw text null,
  matched_staff_id text null,
  matched_employee_name text null,
  matching_method text null,
  matching_score integer null,
  position_raw text null,
  leave_date date not null,
  leave_type text not null,
  schedule_adjusted boolean not null default false,
  reason text null,
  status text not null default 'pending',
  reviewed_by text null,
  reviewed_at timestamptz null,
  review_note text null,
  raw_payload jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ob_leave_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled'))
);

create unique index if not exists ob_leave_requests_source_row_uidx
  on public.ob_leave_requests (source, source_row_key);

create index if not exists ob_leave_requests_status_date_idx
  on public.ob_leave_requests (status, leave_date desc, created_at desc);

create index if not exists ob_leave_requests_staff_date_idx
  on public.ob_leave_requests (matched_staff_id, leave_date desc);

create index if not exists ob_leave_requests_submitted_at_idx
  on public.ob_leave_requests (submitted_at desc nulls last, created_at desc);

comment on table public.ob_leave_requests is 'Leave request intake and approval workflow records.';
comment on column public.ob_leave_requests.matching_method is 'name_exact | name_compact | name_token | id_exact | unmatched';
