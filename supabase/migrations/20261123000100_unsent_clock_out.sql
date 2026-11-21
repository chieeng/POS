-- Build step 11, PR 2: a time out made offline that the server refuses for good is reported to
-- the Owner like a refused sale or time in (NFR-02). Same function, one more kind: clock_out.

create or replace function private.report_unsent(
  p_item_id uuid,
  p_kind text,
  p_error text,
  p_made_at timestamptz,
  p_payload jsonb,
  p_device_tag text default null
)
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
  if p_item_id is null
    or p_kind is null or p_kind not in ('sale', 'clock_in', 'clock_out')
    or p_error is null or char_length(p_error) not between 1 and 200
    or p_made_at is null or p_made_at > now() + interval '1 day'
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 20000
  then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_branch := private.current_branch();

  -- Logged once per item, whoever sends the report again.
  if exists (
    select 1 from public.audit_logs a
    where a.branch_id = v_branch and a.action = 'outbox.rejected'
      and a.target_id = p_item_id::text
  ) then
    return;
  end if;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_branch,
    'outbox.rejected',
    v_uid,
    private.valid_device_tag(p_device_tag),
    p_kind,
    p_item_id::text,
    jsonb_build_object('kind', p_kind, 'madeAt', p_made_at, 'entry', p_payload),
    p_error
  );
end;
$$;
