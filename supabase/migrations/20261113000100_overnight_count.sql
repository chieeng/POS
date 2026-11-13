-- Counting a drawer left open overnight (SRS SHIFT-01, SHIFT-03; the owner's decision of Nov 13,
-- 2026): before today's drawer opens, the Owner or a Special Sales may count and close an
-- earlier drawer that was never closed, with the same blind count. Opening today's drawer
-- still closes it as "not counted" when nobody has counted it.
--
--   close_drawer takes the drawer's id, so a count meant for yesterday's drawer can never close
--   today's (someone may open today's in the same moment): it is refused instead.
--   A late count also returns the cash of today's sales already made and waiting for today's
--   drawer: if that cash went into the drawer, it explains an overage.
--   drawer_today names the earlier open drawer, so the Drawer screen can offer the count.

drop function public.close_drawer(jsonb, text, text);
drop function private.close_drawer(jsonb, text, text);

-- p_counts {"1000": 3, ..., "1": 12}; p_session_id: the drawer being counted (null: the open
-- drawer, as before). Returns {expected, counted, overShort, late, waitingCash}.
-- Errors: drawer_not_open (none open, or that one is no longer open), invalid_input.
create function private.close_drawer(
  p_counts jsonb,
  p_note text,
  p_device_tag text default null,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_note text := private.catalog_text(p_note, 200, false);
  v_bills constant text[] := array['1000', '500', '200', '100', '50', '20', '10', '5', '1'];
  v_today date := private.manila_today();
  v_session public.drawer_sessions;
  v_counted numeric(12, 2) := 0;
  v_expected numeric(12, 2);
  v_late boolean;
  v_waiting numeric(12, 2) := 0;
  v_key text;
  v_value jsonb;
begin
  if v_uid is null or not private.can_add_catalog() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_counts) loop
    if v_key <> all (v_bills) or jsonb_typeof(v_value) <> 'number'
      or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
      or (v_value #>> '{}')::numeric not between 0 and 100000 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_counted := v_counted + v_key::integer * (v_value #>> '{}')::integer;
  end loop;

  select * into v_session from public.drawer_sessions s
  where s.branch_id = v_branch and s.status = 'open'
    and (p_session_id is null or s.id = p_session_id)
  for update;
  if not found then
    raise exception 'drawer_not_open' using errcode = 'P0001';
  end if;

  v_expected := private.drawer_expected(v_session.id);
  v_late := v_session.business_date < v_today;
  if v_late then
    -- Today's cash sales made before this count, waiting for today's drawer.
    select coalesce(sum(p.amount), 0) into v_waiting
    from public.sales sa
    join public.sale_payments p on p.sale_id = sa.id and p.method = 'cash'
    where sa.branch_id = v_branch and sa.session_id is null and sa.status = 'completed'
      and (sa.created_at at time zone 'Asia/Manila')::date = v_today;
  end if;

  update public.drawer_sessions s set
    status = 'closed', closed_by = v_uid,
    closed_by_name = (select pr.display_name from public.profiles pr where pr.id = v_uid),
    closed_at = now(), close_device_tag = v_tag, counts = p_counts, counted_cash = v_counted,
    expected_cash = v_expected, over_short = v_counted - v_expected, closing_note = v_note
  where s.id = v_session.id;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_branch, 'drawer.close', v_uid, v_tag, 'drawer', v_session.id::text,
    jsonb_build_object(
      'businessDate', v_session.business_date, 'expected', v_expected, 'counted', v_counted,
      'overShort', v_counted - v_expected
    ) || case when v_late
      then jsonb_build_object('countedOn', v_today, 'waitingCash', v_waiting)
      else '{}'::jsonb end,
    v_note
  );
  return jsonb_build_object(
    'expected', v_expected, 'counted', v_counted, 'overShort', v_counted - v_expected,
    'late', v_late, 'waitingCash', v_waiting
  );
end;
$$;

create function public.close_drawer(
  p_counts jsonb,
  p_note text default null,
  p_device_tag text default null,
  p_session_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.close_drawer(p_counts, p_note, p_device_tag, p_session_id); $$;

revoke execute on function private.close_drawer(jsonb, text, text, uuid) from public, anon;
grant execute on function private.close_drawer(jsonb, text, text, uuid) to authenticated;
revoke execute on function public.close_drawer(jsonb, text, text, uuid) from public, anon;
grant execute on function public.close_drawer(jsonb, text, text, uuid) to authenticated;

-- ---- drawer_today: also names an earlier drawer still open --------------------------------
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
