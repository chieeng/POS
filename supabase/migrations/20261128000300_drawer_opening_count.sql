-- The opening count (SRS SHIFT-01; the owner's decisions of Nov 27, 2026).
--
-- The opening cash is no longer pre-filled from the last count and typed as one amount: the
-- first staff member of the day counts the drawer by denomination (PHP 1,000 down to PHP 1),
-- like the closing count. The count is blind for everyone, the Owner too: drawer_today no longer
-- sends the last count. open_drawer compares the count with the last real count (a closing
-- count, a count taken before a reopen, or an earlier drawer counted later, the overnight
-- count) and, when they differ and no reason was given, refuses with reason_required and only
-- then tells the difference and which count it was compared with. A difference still needs a
-- reason and is flagged for the Owner, as before. Each denomination is kept on the drawer
-- (opening_counts) for the drawer report and its CSV.

alter table public.drawer_sessions add column opening_counts jsonb;
comment on column public.drawer_sessions.prefill_cash is
  'The last real count the opening was compared with (until Nov 27, 2026: pre-filled from).';

-- ---- count_total: a count by denomination, checked, and its total ---------------------------
-- p_counts {"1000": 3, ..., "1": 12}: whole numbers from 0 to 100,000 of each bill and coin.
create function private.count_total(p_counts jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bills constant text[] := array['1000', '500', '200', '100', '50', '20', '10', '5', '1'];
  v_total numeric(12, 2) := 0;
  v_key text;
  v_value jsonb;
begin
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_counts) loop
    if v_key <> all (v_bills) or jsonb_typeof(v_value) <> 'number'
      or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
      or (v_value #>> '{}')::numeric not between 0 and 100000 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_total := v_total + v_key::integer * (v_value #>> '{}')::integer;
  end loop;
  if v_total > 9999999.99 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return v_total;
end;
$$;
revoke execute on function private.count_total(jsonb) from public, anon, authenticated;

-- ---- open_drawer: a blind count by denomination ---------------------------------------------
drop function public.open_drawer(numeric, text, text);
drop function private.open_drawer(numeric, text, text);

-- Errors: already_open, already_closed, invalid_input, and reason_required, whose detail is
-- {"counted", "lastCount": {amount, counted_by_name, closed_at, business_date, before_reopen},
--  "difference"}: told only after the count.
create function private.open_drawer(
  p_counts jsonb,
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
  v_counted numeric(12, 2);
  v_name text;
  v_existing public.drawer_sessions;
  v_stale public.drawer_sessions;
  v_expected numeric(12, 2);
  v_last jsonb;
  v_prefill numeric(12, 2);
  v_session uuid;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  v_counted := private.count_total(p_counts);

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

  -- The last real count, before an earlier drawer still open is closed as not counted (that
  -- one has no count, so it never changes the answer).
  v_last := private.drawer_last_count(v_branch, v_today);
  v_prefill := (v_last ->> 'amount')::numeric(12, 2);
  if v_prefill is not null and v_counted <> v_prefill and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001',
      detail = jsonb_build_object(
        'counted', v_counted, 'lastCount', v_last, 'difference', v_counted - v_prefill
      )::text;
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

  insert into public.drawer_sessions (
    branch_id, business_date, opened_by, opened_by_name, open_device_tag, opening_cash,
    opening_counts, prefill_cash, prefill_difference, opening_reason
  )
  values (
    v_branch, v_today, v_uid, v_name, v_tag, v_counted, p_counts,
    v_prefill, v_counted - v_prefill,
    case when v_prefill is not null and v_counted <> v_prefill then v_reason end
  )
  returning id into v_session;

  perform private.attach_waiting_sales(v_branch, v_session, v_today);

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_branch, 'drawer.open', v_uid, v_tag, 'drawer', v_session::text,
    jsonb_build_object(
      'businessDate', v_today, 'opening', v_counted, 'counts', p_counts,
      'lastCount', v_prefill, 'difference', v_counted - v_prefill,
      'beforeReopen', (v_last ->> 'before_reopen')::boolean
    ),
    case when v_prefill is not null and v_counted <> v_prefill then v_reason end
  );
  return v_session;
exception
  -- Another phone opened today's drawer in the same moment.
  when unique_violation then
    raise exception 'already_open' using errcode = 'P0001';
end;
$$;

create function public.open_drawer(
  p_counts jsonb,
  p_reason text default null,
  p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.open_drawer(p_counts, p_reason, p_device_tag); $$;

revoke execute on function private.open_drawer(jsonb, text, text) from public, anon;
grant execute on function private.open_drawer(jsonb, text, text) to authenticated;
revoke execute on function public.open_drawer(jsonb, text, text) from public, anon;
grant execute on function public.open_drawer(jsonb, text, text) to authenticated;

-- ---- drawer_today: no last count any more (the opening count is blind) ---------------------
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
    'staleOpen', exists (
      select 1 from public.drawer_sessions s
      where s.branch_id = v_branch and s.business_date < v_today and s.status = 'open'
    ),
    'stale', (
      select jsonb_build_object(
        'id', s.id, 'business_date', s.business_date,
        'opened_by_name', s.opened_by_name, 'opening_cash', s.opening_cash
      )
      from public.drawer_sessions s
      where s.branch_id = v_branch and s.business_date < v_today and s.status = 'open'
      order by s.business_date desc
      limit 1
    )
  );
end;
$$;
