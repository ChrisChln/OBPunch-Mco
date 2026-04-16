insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile_avatars_public_read'
  ) then
    create policy "profile_avatars_public_read"
    on storage.objects
    for select
    to public
    using (bucket_id = 'profile-avatars');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile_avatars_authenticated_insert'
  ) then
    create policy "profile_avatars_authenticated_insert"
    on storage.objects
    for insert
    to authenticated
    with check (bucket_id = 'profile-avatars');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile_avatars_authenticated_update'
  ) then
    create policy "profile_avatars_authenticated_update"
    on storage.objects
    for update
    to authenticated
    using (bucket_id = 'profile-avatars')
    with check (bucket_id = 'profile-avatars');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'profile_avatars_authenticated_delete'
  ) then
    create policy "profile_avatars_authenticated_delete"
    on storage.objects
    for delete
    to authenticated
    using (bucket_id = 'profile-avatars');
  end if;
end
$$;
