-- Counting a drawer left open overnight (SRS SHIFT-01, SHIFT-03; the owner's decision of Nov 13,
-- 2026): before today's opens, the Owner or Special Sales may count and close it, blind, and
-- the count can never close today's drawer by mistake.
begin;
select * from no_plan();
select tests.fixture();

-- Yesterday's drawer, opened with ₱1,000 and never closed.
select is(tests.run('sales', $$select public.open_drawer(1000, null, 'A1B2')$$), 'ok 1', 'a drawer opens');
update public.drawer_sessions set business_date = business_date - 1 where branch_id = 'tmain';
create function pg_temp.stale() returns uuid language sql as $$
  select id from public.drawer_sessions where branch_id = 'tmain' and status = 'open'
    and business_date < private.manila_today();
$$;
create function pg_temp.today_json() returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform tests.as('sales');
  v := public.drawer_today();
  perform tests.as_admin();
  return v;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

select is(
  (select jsonb_build_object('staleOpen', j -> 'staleOpen', 'opening', j #> '{stale,opening_cash}', 'session', j -> 'session') from pg_temp.today_json() j),
  '{"staleOpen": true, "opening": 1000.00, "session": null}'::jsonb,
  'drawer_today names the earlier drawer still open, and no drawer today'
);
select is(
  (pg_temp.today_json() #>> '{stale,id}')::uuid,
  pg_temp.stale(),
  'with its id, so the screen can count that drawer'
);

-- This morning, before any count: a ₱45 cash sale, waiting for today's drawer.
insert into public.sales (id, branch_id, receipt_no, salesperson_id, salesperson_name, device_tag, subtotal, total, created_at)
values ('00000000-0000-4000-8000-000000000901', 'tmain', 'S1-20261113-A1B2-1', tests.uid('sales'), 'Sales', 'A1B2', 45, 45, now());
insert into public.sale_payments (sale_id, line_no, branch_id, method, amount)
values ('00000000-0000-4000-8000-000000000901', 1, 'tmain', 'cash', 45);

-- ---- Who counts ------------------------------------------------------------------------------
select is(
  tests.run('sales', format('select public.close_drawer(%L, null, %L, %L)', '{"1000": 1}', 'A1B2', pg_temp.stale())),
  '42501',
  'Sales cannot count a drawer (SHIFT-03)'
);

-- ---- Special Sales counts it the next morning ------------------------------------------------
create function pg_temp.count(p_counts jsonb, p_session uuid) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform tests.as('special');
  v := public.close_drawer(p_counts, 'Counted in the morning', 'A1B2', p_session);
  perform tests.as_admin();
  return v;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;
select is(
  pg_temp.count('{"1000": 1, "20": 2, "5": 1}', pg_temp.stale()),
  '{"expected": 1000.00, "counted": 1045.00, "overShort": 45.00, "late": true, "waitingCash": 45.00}'::jsonb,
  '₱1,045 counted against ₱1,000: over ₱45, with this morning''s ₱45 cash sale named'
);
select is(
  (select array[s.status, s.counted_cash::text, s.closed_by_name] from public.drawer_sessions s where s.branch_id = 'tmain' and s.business_date = private.manila_today() - 1),
  array['closed', '1045.00', 'Special'],
  'yesterday''s drawer is closed with the count, not "not counted"'
);
select is(
  (select concat_ws(' | ', after ->> 'countedOn', after ->> 'waitingCash', reason) from public.audit_logs where action = 'drawer.close' and branch_id = 'tmain'),
  private.manila_today()::text || ' | 45.00 | Counted in the morning',
  'the audit log says it was counted on a later day'
);
select is(
  (select count(*) from public.sales where session_id is not null and branch_id = 'tmain'),
  0::bigint,
  'this morning''s sale did not join yesterday''s drawer'
);

-- ---- Today's drawer then opens from that count -----------------------------------------------
select is(
  tests.run('sales', $$select public.open_drawer(1045, null, 'A1B2')$$),
  'ok 1',
  'today''s drawer opens with the counted ₱1,045 and needs no reason'
);
select is(
  (select array[s.prefill_cash::text, coalesce(s.opening_reason, '-')] from public.drawer_sessions s where s.branch_id = 'tmain' and s.business_date = private.manila_today()),
  array['1045.00', '-'],
  'pre-filled from the morning count'
);
select is(
  (select count(*) from public.audit_logs where action = 'drawer.notCounted' and branch_id = 'tmain'),
  0::bigint,
  'nothing was closed as not counted'
);
select is(
  (select count(*) from public.sales where session_id is not null and branch_id = 'tmain'),
  1::bigint,
  'the morning''s sale joined today''s drawer'
);

-- ---- A count meant for yesterday never closes today's ----------------------------------------
select is(
  tests.message('special', format('select public.close_drawer(%L, null, %L, %L)', '{"1000": 1}', 'A1B2', '00000000-0000-4000-8000-000000000999')),
  'drawer_not_open',
  'counting a drawer that is not open is refused'
);
select is(
  tests.message('special', format('select public.close_drawer(%L, null, %L, %L)', '{"1000": 1}', 'A1B2', (select id from public.drawer_sessions where branch_id = 'tmain' and business_date = private.manila_today() - 1))),
  'drawer_not_open',
  'once today''s drawer is open, yesterday''s (closed) can no longer be counted'
);
select is(
  (select status from public.drawer_sessions where branch_id = 'tmain' and business_date = private.manila_today()),
  'open',
  'and today''s drawer is still open'
);

select * from finish();
rollback;
