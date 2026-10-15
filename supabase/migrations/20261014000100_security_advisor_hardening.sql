-- Security Advisor findings on the hosted projects (SEC-16).

-- ---- record_sign_in: the privileged part moves out of the API --------------------------
-- The Advisor warns about any SECURITY DEFINER function a signed-in user can call through
-- the Data API. The function body, its checks and its grants stay exactly the same; only the
-- privileged part now lives in `private`, which the API does not expose. The public name
-- the app calls is a plain SECURITY INVOKER function that hands over to it.

create function private.record_sign_in(p_device_tag text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text;
begin
  -- Only an account with an active profile and a live session, and only for itself.
  if v_uid is null or not private.is_active() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  select p.branch_id into v_branch from public.profiles p where p.id = v_uid;

  insert into public.audit_logs (branch_id, action, actor_id, device_tag, target_type, target_id)
  values (
    v_branch, 'auth.signIn', v_uid, private.valid_device_tag(p_device_tag), 'user', v_uid::text
  );
end;
$$;

revoke execute on function private.record_sign_in(text) from public, anon;
grant execute on function private.record_sign_in(text) to authenticated;

create or replace function public.record_sign_in(p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.record_sign_in(p_device_tag);
$$;

revoke execute on function public.record_sign_in(text) from public, anon;
grant execute on function public.record_sign_in(text) to authenticated;

-- ---- rls_auto_enable: created by the dashboard, not by these migrations ------------------
-- Turning on "Enable automatic RLS" when a project is created adds an event trigger whose
-- function, public.rls_auto_enable(), is executable by everyone. Postgres runs an event
-- trigger's function itself, without checking EXECUTE, so nobody needs to call it directly.
-- The function does not exist on the local stack or in CI; then this does nothing.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is null then
    return;
  end if;

  revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

  -- A REVOKE by a role that does not own the function changes nothing and only warns, so
  -- check the result and say so in the deploy log instead of failing the deploy.
  if has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')
    or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute') then
    raise warning 'public.rls_auto_enable() is still executable by anon or authenticated. Its owner must revoke EXECUTE.';
  end if;
end;
$$;
