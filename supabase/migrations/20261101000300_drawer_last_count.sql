-- A reopen doesn't erase the last real count (the Owner's staging test, Nov 1, 2026). When a
-- reopened drawer ends up not counted, the next opening is pre-filled from the count taken
-- before the reopen, and the reason check applies to it. That count lives in the audit log:
-- reopen_drawer saves it there when it clears the drawer's closing.

-- Reads a drawer's closes and reopens: the Owner's report and the last count below.
create index audit_logs_drawer_idx on public.audit_logs (target_id, created_at)
  where target_type = 'drawer';

-- ---- drawer_last_count -------------------------------------------------------------------
-- The latest real count before a day: a drawer's closing count, or one set aside by a reopen.
-- {amount, counted_by_name, closed_at, business_date, before_reopen}, or null.
create function private.drawer_last_count(p_branch text, p_before date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(c) from (
    select
      s.counted_cash as amount, s.closed_by_name as counted_by_name, s.closed_at,
      s.business_date, false as before_reopen
    from public.drawer_sessions s
    where s.branch_id = p_branch and s.business_date < p_before and s.counted_cash is not null
    union all
    select
      (a.before ->> 'counted')::numeric(12, 2), a.before ->> 'closedBy',
      (a.before ->> 'closedAt')::timestamptz, s.business_date, true
    from public.audit_logs a
    join public.drawer_sessions s on s.id::text = a.target_id
    where a.target_type = 'drawer' and a.action = 'drawer.reopen'
      and a.branch_id = p_branch and s.business_date < p_before
      and a.before ->> 'counted' is not null
    order by business_date desc, closed_at desc
    limit 1
  ) c;
$$;

revoke execute on function private.drawer_last_count(text, date)
  from public, anon, authenticated;

-- ---- drawer_today: same answer, with the last count from above ---------------------------
create or replace function private.drawer_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch text := private.current_branch();
  v_today date := private.manila_today();
begin
  if (select auth.uid()) is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'today', v_today,
    'session', (
      select jsonb_build_object(
        'id', s.id, 'business_date', s.business_date, 'status', s.status,
        'opened_by_name', s.opened_by_name, 'opened_at', s.opened_at,
        'opening_cash', s.opening_cash
      )
      from public.drawer_sessions s
      where s.branch_id = v_branch and s.business_date = v_today
    ),
    'lastCount', private.drawer_last_count(v_branch, v_today),
    'staleOpen', exists (
      select 1 from public.drawer_sessions s
      where s.branch_id = v_branch and s.business_date < v_today and s.status = 'open'
    )
  );
end;
$$;

-- ---- open_drawer: same rules, with the last count from above -----------------------------
create or replace function private.open_drawer(
  p_opening_cash numeric,
  p_reason text,
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
  v_today date := private.manila_today();
  v_reason text := private.catalog_text(p_reason, 200, false);
  v_name text;
  v_existing public.drawer_sessions;
  v_stale public.drawer_sessions;
  v_expected numeric(12, 2);
  v_prefill numeric(12, 2);
  v_session uuid;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash > 9999999.99
    or p_opening_cash <> round(p_opening_cash, 2) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- One at a time per store, so two phones opening together cannot both pass the checks.
  perform 1 from public.branches b where b.id = v_branch for update;

  select * into v_existing from public.drawer_sessions s
  where s.branch_id = v_branch and s.business_date = v_today;
  if found then
    if v_existing.status = 'open' then
      raise exception 'already_open' using errcode = 'P0001';
    end if;
    raise exception 'already_closed' using errcode = 'P0001';
  end if;

  select pr.display_name into v_name from public.profiles pr where pr.id = v_uid;

  -- A drawer left open on an earlier day: closed as not counted, flagged for the Owner.
  for v_stale in
    select * from public.drawer_sessions s
    where s.branch_id = v_branch and s.status = 'open' and s.business_date < v_today
    for update
  loop
    v_expected := private.drawer_expected(v_stale.id);
    update public.drawer_sessions s set
      status = 'not_counted', closed_at = now(), expected_cash = v_expected,
      closed_by = v_uid, closed_by_name = v_name, close_device_tag = v_tag
    where s.id = v_stale.id;
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, after)
    values (
      v_branch, 'drawer.notCounted', v_uid, v_tag, 'drawer', v_stale.id::text,
      jsonb_build_object('businessDate', v_stale.business_date, 'expected', v_expected)
    );
  end loop;

  v_prefill := (private.drawer_last_count(v_branch, v_today) ->> 'amount')::numeric(12, 2);

  if v_prefill is not null and p_opening_cash <> v_prefill and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  insert into public.drawer_sessions (
    branch_id, business_date, opened_by, opened_by_name, open_device_tag, opening_cash,
    prefill_cash, prefill_difference, opening_reason
  )
  values (
    v_branch, v_today, v_uid, v_name, v_tag, p_opening_cash,
    v_prefill, p_opening_cash - v_prefill,
    case when v_prefill is not null and p_opening_cash <> v_prefill then v_reason end
  )
  returning id into v_session;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_branch, 'drawer.open', v_uid, v_tag, 'drawer', v_session::text,
    jsonb_build_object(
      'businessDate', v_today, 'opening', p_opening_cash, 'lastCount', v_prefill,
      'difference', p_opening_cash - v_prefill
    ),
    case when v_prefill is not null and p_opening_cash <> v_prefill then v_reason end
  );
  return v_session;
exception
  -- Another phone opened today's drawer in the same moment.
  when unique_violation then
    raise exception 'already_open' using errcode = 'P0001';
end;
$$;
