create table if not exists public.ob_schedule_label_tones (
  label text primary key,
  tone text not null,
  operator text,
  updated_at timestamptz not null default now(),
  constraint ob_schedule_label_tones_label_not_blank check (btrim(label) <> ''),
  constraint ob_schedule_label_tones_tone_check check (
    tone in ('sky', 'cyan', 'teal', 'emerald', 'lime', 'amber', 'orange', 'rose', 'fuchsia', 'violet', 'indigo', 'slate')
  )
);

alter table public.ob_schedule_label_tones enable row level security;

grant select, insert, update on public.ob_schedule_label_tones to authenticated;

drop policy if exists ob_schedule_label_tones_authenticated_select on public.ob_schedule_label_tones;
create policy ob_schedule_label_tones_authenticated_select
  on public.ob_schedule_label_tones
  for select
  to authenticated
  using (true);

drop policy if exists ob_schedule_label_tones_schedule_operate_insert on public.ob_schedule_label_tones;
create policy ob_schedule_label_tones_schedule_operate_insert
  on public.ob_schedule_label_tones
  for insert
  to authenticated
  with check (public.has_admin_access(auth.uid(), 'schedule', 'operate'));

drop policy if exists ob_schedule_label_tones_schedule_operate_update on public.ob_schedule_label_tones;
create policy ob_schedule_label_tones_schedule_operate_update
  on public.ob_schedule_label_tones
  for update
  to authenticated
  using (public.has_admin_access(auth.uid(), 'schedule', 'operate'))
  with check (public.has_admin_access(auth.uid(), 'schedule', 'operate'));

do $$
begin
  if to_regclass('public.ob_app_settings') is not null then
    insert into public.ob_schedule_label_tones (label, tone, operator, updated_at)
    select
      lower(btrim(tone_entry.key)),
      tone_entry.value #>> '{}',
      nullif(public.ob_app_settings.value ->> 'operator', ''),
      coalesce((public.ob_app_settings.value ->> 'updated_at')::timestamptz, public.ob_app_settings.updated_at, now())
    from public.ob_app_settings
    cross join lateral jsonb_each(public.ob_app_settings.value -> 'tones') as tone_entry(key, value)
    where public.ob_app_settings.key = 'schedule_label_tones_v1'
      and jsonb_typeof(public.ob_app_settings.value -> 'tones') = 'object'
      and btrim(tone_entry.key) <> ''
      and tone_entry.value #>> '{}' in ('sky', 'cyan', 'teal', 'emerald', 'lime', 'amber', 'orange', 'rose', 'fuchsia', 'violet', 'indigo', 'slate')
    on conflict (label) do update set
      tone = excluded.tone,
      operator = excluded.operator,
      updated_at = excluded.updated_at;
  end if;
end $$;
