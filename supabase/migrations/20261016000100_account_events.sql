-- Audit log entries for the user's own account (SYS-03): sign-in, password set, two-step on.

-- ---- record_sign_in: an Owner is signed in only after the second step ---------------------
-- Before, an Owner's password-only (aal1) session could log a sign-in. Now the same rule as
-- every policy applies: active, and an Owner only with the authenticator-app step (SEC-05).
create or replace function private.record_sign_in(p_device_tag text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  select p.branch_id into v_branch from public.profiles p where p.id = v_uid;

  insert into public.audit_logs (branch_id, action, actor_id, device_tag, target_type, target_id)
  values (
    v_branch, 'auth.signIn', v_uid, private.valid_device_tag(p_device_tag), 'user', v_uid::text
  );
end;
$$;

-- ---- record_account_event ----------------------------------------------------------------
-- Same shape as record_sign_in: the privileged part lives in `private`, which the API does not
-- expose, and the public name is a SECURITY INVOKER function that hands over to it.
--   auth.passwordSet  the user chose a password from a one-time link. A new Owner does this
--                     before having an authenticator app, so an active profile is enough.
--   auth.twoStepOn    the user turned on the authenticator-app step; only an aal2 session
--                     can say so, which proves the step was just passed.
create function private.record_account_event(p_action text, p_device_tag text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text;
begin
  if v_uid is null or not private.is_active() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('auth.passwordSet', 'auth.twoStepOn') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_action = 'auth.twoStepOn' and not private.is_aal2() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  select p.branch_id into v_branch from public.profiles p where p.id = v_uid;

  insert into public.audit_logs (branch_id, action, actor_id, device_tag, target_type, target_id)
  values (
    v_branch, p_action, v_uid, private.valid_device_tag(p_device_tag), 'user', v_uid::text
  );
end;
$$;

revoke execute on function private.record_account_event(text, text) from public, anon;
grant execute on function private.record_account_event(text, text) to authenticated;

create function public.record_account_event(p_action text, p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.record_account_event(p_action, p_device_tag);
$$;

revoke execute on function public.record_account_event(text, text) from public, anon;
grant execute on function public.record_account_event(text, text) to authenticated;
