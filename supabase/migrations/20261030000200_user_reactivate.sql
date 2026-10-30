-- AUTH-02, SEC-04: the Owner turns a deactivated account back on. The user keeps their role,
-- user code, history and password; the Edge Function lifts the Auth ban in the same call.
--
-- This step comes first, so the branch check runs before the ban is lifted. Like
-- admin_deactivate it also runs for an account that is already on, so a call whose ban step
-- failed can simply be repeated.
create function public.admin_reactivate(
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

  update public.profiles p set active = true where p.id = p_user_id;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
  values (
    v_branch, 'user.reactivate', p_actor, private.valid_device_tag(p_device_tag), 'user',
    p_user_id::text,
    jsonb_build_object('active', v_user.active, 'role', v_user.role),
    jsonb_build_object('active', true)
  );
end;
$$;

revoke execute on function public.admin_reactivate(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.admin_reactivate(uuid, uuid, text) to service_role;
