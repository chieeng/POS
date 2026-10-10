-- RLS helpers and policies (SRS 6, 6.2, SEC-02, SEC-04, SEC-05).
--
-- Role and active flag are read from `profiles` on every request, so a role change or a
-- deactivation takes effect immediately; nothing here trusts a claim copied into the token.

-- ---- Helpers -----------------------------------------------------------------------------
-- All are SECURITY DEFINER with a fixed search_path so they can read `profiles` and
-- `auth.sessions` whatever the caller's own access is. They only ever answer about the caller.

-- The token's session still exists. "Sign out everywhere" and deactivation delete the
-- sessions, so an access token that has not expired yet stops working at once (SEC-13).
create function private.session_is_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions s
    where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      and s.user_id = (select auth.uid())
  );
$$;

-- SEC-02: an active profile and a live session. No profile, or active = false: no access.
create function private.is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.session_is_live()
    and exists (
      select 1 from public.profiles p where p.id = (select auth.uid()) and p.active
    );
$$;

-- The caller's role, or null without an active profile. `current_role` is also an SQL
-- keyword, so always call it with the schema: private.current_role().
create function private."current_role"()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.active;
$$;

create function private.current_branch()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.branch_id from public.profiles p where p.id = (select auth.uid()) and p.active;
$$;

-- SEC-05: this session passed the authenticator-app step.
create function private.is_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2';
$$;

-- What every policy starts from: active, and an Owner only with the second step.
create function private.has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active()
    and coalesce(private."current_role"() <> 'owner' or private.is_aal2(), false);
$$;

create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active()
    and coalesce(private."current_role"() = 'owner', false)
    and private.is_aal2();
$$;

-- Branch of any user, for "is this row in my branch" checks on tables without a branch_id.
create function private.branch_of(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.branch_id from public.profiles p where p.id = p_user_id;
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.session_is_live(),
  private.is_active(),
  private."current_role"(),
  private.current_branch(),
  private.is_aal2(),
  private.has_access(),
  private.is_owner(),
  private.branch_of(uuid)
to authenticated;

-- ---- branches ----------------------------------------------------------------------------
-- No policy: clients read and write nothing yet. Store settings (SYS-01) open this later.

-- ---- profiles ----------------------------------------------------------------------------
-- Clients never write profiles (AUTH-03): there is no INSERT, UPDATE or DELETE grant.

-- A signed-in user reads their own row, and only that. This is deliberately not tied to the
-- active flag or the second step: the app needs the row to know that an Owner must do the
-- second step, and Realtime can only tell a device "you were just deactivated" if the user
-- can still see their own row.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- The Owner reads the profiles of their own branch, with the second step.
create policy profiles_select_branch_owner on public.profiles
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));

-- ---- devices -----------------------------------------------------------------------------
create policy devices_select_own on public.devices
  for select to authenticated
  using ((select private.has_access()) and user_id = (select auth.uid()));

create policy devices_select_branch_owner on public.devices
  for select to authenticated
  using (
    (select private.is_owner())
    and private.branch_of(user_id) = (select private.current_branch())
  );

create policy devices_insert_own on public.devices
  for insert to authenticated
  with check ((select private.has_access()) and user_id = (select auth.uid()));

create policy devices_update_own on public.devices
  for update to authenticated
  using ((select private.has_access()) and user_id = (select auth.uid()))
  with check ((select private.has_access()) and user_id = (select auth.uid()));

-- ---- audit_logs --------------------------------------------------------------------------
-- Read-only for the Owner of the branch; nobody writes from a client.
create policy audit_logs_select_branch_owner on public.audit_logs
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));

-- ---- Realtime ----------------------------------------------------------------------------
-- Live lists for the Owner, and the "your account changed" signal for every device. Realtime
-- applies the policies above to every change before sending it.
alter publication supabase_realtime add table public.profiles, public.devices, public.audit_logs;
