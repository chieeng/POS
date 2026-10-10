-- Server-side writes for Phase 0: the sign-in log and the Owner's user administration
-- (AUTH-02..04, SEC-04, SEC-13, SYS-03).
--
-- Every function is SECURITY DEFINER with a fixed search_path, validates its input and
-- writes its audit row in the same transaction. Errors use these messages, which the
-- `admin-users` Edge Function turns into readable ones:
--   not_owner, user_not_found, account_off, self_forbidden, user_code_taken, invalid_input

-- ---- Internal helpers --------------------------------------------------------------------

create function private.valid_device_tag(p_device_tag text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_device_tag is null then
    return null;
  end if;
  if p_device_tag !~ '^[A-Z0-9]{4}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return p_device_tag;
end;
$$;

-- The acting Owner's branch. Raises unless the actor is an active Owner right now.
create function private.owner_branch(p_actor uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_branch text;
begin
  select p.branch_id into v_branch
  from public.profiles p
  where p.id = p_actor and p.active and p.role = 'owner';
  if v_branch is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  return v_branch;
end;
$$;

-- Removes every session of a user, which also revokes their refresh tokens.
create function private.end_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user_id;
$$;

revoke execute on function
  private.valid_device_tag(text),
  private.owner_branch(uuid),
  private.end_sessions(uuid)
from public, anon, authenticated;

-- ---- record_sign_in ----------------------------------------------------------------------
-- SYS-03: called by the app right after a sign-in completes. Only an account with an active
-- profile and a live session can log one, and only for itself.
create function public.record_sign_in(p_device_tag text default null)
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
  select p.branch_id into v_branch from public.profiles p where p.id = v_uid;

  insert into public.audit_logs (branch_id, action, actor_id, device_tag, target_type, target_id)
  values (
    v_branch, 'auth.signIn', v_uid, private.valid_device_tag(p_device_tag), 'user', v_uid::text
  );
end;
$$;

revoke execute on function public.record_sign_in(text) from public, anon;
grant execute on function public.record_sign_in(text) to authenticated;

-- ---- Owner administration ----------------------------------------------------------------
-- Called only by the `admin-users` Edge Function with the service role, after it has checked
-- the caller's token, role, active flag and second step. `p_actor` is that verified caller;
-- each function checks again that the actor is an active Owner and stays inside their branch.

-- AUTH-02: the profile of a newly created account, in the Owner's own branch.
create function public.admin_create_profile(
  p_actor uuid,
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_role text,
  p_user_code text,
  p_device_tag text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch text := private.owner_branch(p_actor);
begin
  begin
    insert into public.profiles (id, display_name, email, role, user_code, branch_id, active)
    values (p_user_id, p_display_name, p_email, p_role, p_user_code, v_branch, true);
  exception
    when unique_violation then
      raise exception 'user_code_taken' using errcode = '23505';
    when check_violation then
      raise exception 'invalid_input' using errcode = '22023';
  end;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after)
  values (
    v_branch, 'user.create', p_actor, private.valid_device_tag(p_device_tag), 'user',
    p_user_id::text,
    jsonb_build_object(
      'email', p_email, 'displayName', p_display_name, 'role', p_role, 'userCode', p_user_code
    )
  );
end;
$$;

-- AUTH-02: the Owner edits a user's name and user code. Returns only what changed.
create function public.admin_update_profile(
  p_actor uuid,
  p_user_id uuid,
  p_display_name text default null,
  p_user_code text default null,
  p_device_tag text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch text := private.owner_branch(p_actor);
  v_user public.profiles;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  select * into v_user from public.profiles p
  where p.id = p_user_id and p.branch_id = v_branch
  for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  if p_display_name is not null and p_display_name <> v_user.display_name then
    v_before := v_before || jsonb_build_object('displayName', v_user.display_name);
    v_after := v_after || jsonb_build_object('displayName', p_display_name);
  end if;
  if p_user_code is not null and p_user_code <> v_user.user_code then
    v_before := v_before || jsonb_build_object('userCode', v_user.user_code);
    v_after := v_after || jsonb_build_object('userCode', p_user_code);
  end if;
  if v_after = '{}'::jsonb then
    return v_after;
  end if;

  begin
    update public.profiles p
    set display_name = coalesce(v_after ->> 'displayName', p.display_name),
        user_code = coalesce(v_after ->> 'userCode', p.user_code)
    where p.id = p_user_id;
  exception
    when unique_violation then
      raise exception 'user_code_taken' using errcode = '23505';
    when check_violation then
      raise exception 'invalid_input' using errcode = '22023';
  end;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
  values (
    v_branch, 'user.update', p_actor, private.valid_device_tag(p_device_tag), 'user',
    p_user_id::text, v_before, v_after
  );
  return v_after;
end;
$$;

-- AUTH-03: the role is changed only here. Every device of that user signs in again.
create function public.admin_set_role(
  p_actor uuid,
  p_user_id uuid,
  p_role text,
  p_device_tag text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch text := private.owner_branch(p_actor);
  v_user public.profiles;
begin
  -- The store must never lose its only Owner by accident.
  if p_actor = p_user_id then
    raise exception 'self_forbidden' using errcode = 'P0001';
  end if;
  if p_role is null or p_role not in ('owner', 'special_sales', 'sales') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_user from public.profiles p
  where p.id = p_user_id and p.branch_id = v_branch
  for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if not v_user.active then
    raise exception 'account_off' using errcode = 'P0001';
  end if;
  if v_user.role = p_role then
    return;
  end if;

  update public.profiles p set role = p_role where p.id = p_user_id;
  perform private.end_sessions(p_user_id);

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
  values (
    v_branch, 'user.setRole', p_actor, private.valid_device_tag(p_device_tag), 'user',
    p_user_id::text,
    jsonb_build_object('role', v_user.role), jsonb_build_object('role', p_role)
  );
end;
$$;

-- SEC-04: active = false and every session ended, in one transaction. The Edge Function
-- bans the Auth user in the same call. The profile row stays (AUTH-02).
create function public.admin_deactivate(
  p_actor uuid,
  p_user_id uuid,
  p_reason text default null,
  p_device_tag text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch text := private.owner_branch(p_actor);
  v_user public.profiles;
begin
  if p_actor = p_user_id then
    raise exception 'self_forbidden' using errcode = 'P0001';
  end if;

  select * into v_user from public.profiles p
  where p.id = p_user_id and p.branch_id = v_branch
  for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  update public.profiles p set active = false where p.id = p_user_id;
  perform private.end_sessions(p_user_id);

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, before, after, reason)
  values (
    v_branch, 'user.deactivate', p_actor, private.valid_device_tag(p_device_tag), 'user',
    p_user_id::text,
    jsonb_build_object('active', v_user.active, 'role', v_user.role),
    jsonb_build_object('active', false),
    p_reason
  );
end;
$$;

-- AUTH-04, SEC-13: sign a user out of every device without turning the account off.
create function public.admin_sign_out_everywhere(
  p_actor uuid,
  p_user_id uuid,
  p_device_tag text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch text := private.owner_branch(p_actor);
begin
  if not exists (
    select 1 from public.profiles p where p.id = p_user_id and p.branch_id = v_branch
  ) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  perform private.end_sessions(p_user_id);

  insert into public.audit_logs (branch_id, action, actor_id, device_tag, target_type, target_id)
  values (
    v_branch, 'user.signOutEverywhere', p_actor, private.valid_device_tag(p_device_tag), 'user',
    p_user_id::text
  );
end;
$$;

-- Logs that a one-time password link was made, and returns the email to make it for. The
-- link itself is never stored or logged.
create function public.admin_log_password_reset(
  p_actor uuid,
  p_user_id uuid,
  p_device_tag text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch text := private.owner_branch(p_actor);
  v_user public.profiles;
begin
  select * into v_user from public.profiles p
  where p.id = p_user_id and p.branch_id = v_branch;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if not v_user.active then
    raise exception 'account_off' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (branch_id, action, actor_id, device_tag, target_type, target_id)
  values (
    v_branch, 'user.passwordResetLink', p_actor, private.valid_device_tag(p_device_tag), 'user',
    p_user_id::text
  );
  return v_user.email;
end;
$$;

revoke execute on function
  public.admin_create_profile(uuid, uuid, text, text, text, text, text),
  public.admin_update_profile(uuid, uuid, text, text, text),
  public.admin_set_role(uuid, uuid, text, text),
  public.admin_deactivate(uuid, uuid, text, text),
  public.admin_sign_out_everywhere(uuid, uuid, text),
  public.admin_log_password_reset(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  public.admin_create_profile(uuid, uuid, text, text, text, text, text),
  public.admin_update_profile(uuid, uuid, text, text, text),
  public.admin_set_role(uuid, uuid, text, text),
  public.admin_deactivate(uuid, uuid, text, text),
  public.admin_sign_out_everywhere(uuid, uuid, text),
  public.admin_log_password_reset(uuid, uuid, text)
to service_role;
