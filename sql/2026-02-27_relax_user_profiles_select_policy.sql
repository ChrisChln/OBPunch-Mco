drop policy if exists ob_user_profiles_select_own on public.ob_user_profiles;
drop policy if exists ob_user_profiles_select_authenticated on public.ob_user_profiles;

create policy ob_user_profiles_select_authenticated
  on public.ob_user_profiles
  for select
  to authenticated
  using (true);

