-- Cash in and out go into the audit log too (SHIFT-02, the Owner's staging test of Oct 31,
-- 2026): each entry logs drawer.cashIn or drawer.cashOut with the amount, the reason, the
-- note and who made it, next to the drawer's opening and closing. Same signature as before,
-- so the grants and the public wrapper stay as they are.
create or replace function private.record_drawer_entry(
  p_type text,
  p_amount numeric,
  p_reason text,
  p_note text,
  p_device_tag text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_note text := private.catalog_text(p_note, 200, false);
  v_session uuid;
  v_date date;
  v_entry uuid;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('cash_in', 'cash_out')
    or p_amount is null or p_amount < 0.01 or p_amount > 999999.99
    or p_amount <> round(p_amount, 2)
    or p_reason is null
    or p_reason not in ('supplier_payment', 'expense', 'owner_withdrawal', 'change_fund', 'other')
    or (p_reason = 'other' and v_note is null) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select s.id, s.business_date into v_session, v_date from public.drawer_sessions s
  where s.branch_id = v_branch and s.business_date = private.manila_today()
    and s.status = 'open'
  for update;
  if v_session is null then
    raise exception 'drawer_not_open' using errcode = 'P0001';
  end if;

  insert into public.drawer_entries
    (branch_id, session_id, type, amount, reason, note, user_id, user_name, device_tag)
  select v_branch, v_session, p_type, p_amount, p_reason, v_note, v_uid, pr.display_name, v_tag
  from public.profiles pr where pr.id = v_uid
  returning id into v_entry;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after)
  values (
    v_branch,
    case p_type when 'cash_in' then 'drawer.cashIn' else 'drawer.cashOut' end,
    v_uid, v_tag, 'drawer', v_session::text,
    jsonb_build_object(
      'businessDate', v_date, 'entryId', v_entry, 'amount', p_amount,
      'reason', p_reason, 'note', v_note
    )
  );
  return v_entry;
end;
$$;
