-- The owner's decisions D, E and F of Nov 23, 2026 (SRS ATT-11, ATT-12): a tap more than 24
-- hours old is refused, no fix with a time that hasn't happened yet, and a time in replaces
-- an Absent or Rest day mark.
begin;
select * from no_plan();
select tests.fixture();

create function pg_temp.payload(p_client text, p_minutes_ago int) returns text language sql as $$
  select jsonb_build_object('clientId', p_client,
    'deviceAt', case when p_minutes_ago is null then null else (now() - make_interval(mins => p_minutes_ago))::text end,
    'lat', null, 'lng', null, 'accuracy', null)::text;
$$;
create function pg_temp.today_rec(p_user text) returns public.attendance language sql as $$
  select * from public.attendance where user_id = tests.uid(p_user) and work_date = private.manila_today();
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- D: a tap more than 24 hours old -----------------------------------------------------------
select is(
  tests.message('sales', format('select public.clock_in(%L)', pg_temp.payload('00000000-0000-4000-8000-0000000d0001', 24 * 60 + 5))),
  'tap_too_old', 'a time in saved 24 hours and 5 minutes ago is refused');
select is((select count(*)::int from public.attendance), 0, 'and nothing is recorded');
select is(
  tests.message('sales', format('select public.clock_out(%L)', pg_temp.payload('00000000-0000-4000-8000-0000000d0002', 25 * 60))),
  'tap_too_old', 'a time out saved 25 hours ago is refused too');
select is(
  tests.run('sales', format('select public.clock_in(%L)', pg_temp.payload('00000000-0000-4000-8000-0000000d0003', 23 * 60 + 50))),
  'ok 1', 'a tap saved 23 hours and 50 minutes ago still counts');
select is(
  (select a.flags @> array['sent_late'] and a.in_at = a.in_device_at from public.attendance a where a.user_id = tests.uid('sales')),
  true, 'at the phone''s time, flagged sent late');

-- ---- E: no times that haven't happened yet -----------------------------------------------------
-- Late in the evening there may be no later time today; then the checks below use 23:59 and are
-- skipped when even that has passed.
create function pg_temp.later() returns text language sql as $$
  select to_char(case when (now() at time zone 'Asia/Manila')::time < time '22:58'
    then (now() at time zone 'Asia/Manila')::time + interval '1 hour' else time '23:59' end, 'HH24:MI');
$$;
grant execute on function pg_temp.later() to authenticated;
select case when (now() at time zone 'Asia/Manila')::time < time '23:59' then
  is(tests.message('special', format($$select public.request_attendance_fix(%L, %L, null, 'x')$$, private.manila_today(), pg_temp.later())),
    'future_time', 'a request with a time in later today is refused')
  else skip('too late in the day to test a later time', 1) end;
select case when (now() at time zone 'Asia/Manila')::time < time '23:59' then
  is(tests.message('owner', format($$select public.fix_attendance(%L, %L, '00:00', %L, 'x')$$, tests.uid('special'), private.manila_today(), pg_temp.later())),
    'future_time', 'the Owner''s direct fix with a time out later today is refused')
  else skip('too late in the day to test a later time', 1) end;
select is(
  tests.run('special', format($$select public.request_attendance_fix(%L, '00:00', null, 'Forgot')$$, private.manila_today())),
  'ok 1', 'a time that has passed today is fine');
select is(
  tests.run('special', format($$select public.request_attendance_fix(%L, '08:00', '18:00', 'Forgot')$$, private.manila_today() - 1)),
  'ok 1', 'and any time yesterday');
-- An approval rechecks: a request whose time is still ahead (made up here) is refused.
update public.approval_requests set after = after || jsonb_build_object('in', null, 'out', '23:59:59')
where type = 'attendance_fix' and requested_by = tests.uid('special') and after ->> 'workDate' = private.manila_today()::text;
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', (
    select id from public.approval_requests where type = 'attendance_fix' and requested_by = tests.uid('special')
      and after ->> 'workDate' = private.manila_today()::text))),
  'future_time', 'an approval with a time still ahead is refused');

-- ---- F: a time in replaces an Absent or Rest day mark ------------------------------------------
select is(
  tests.run('owner', format($$select public.mark_attendance_day(%L, %L, 'absent', 'Did not show up')$$, tests.uid('special'), private.manila_today())),
  'ok 1', 'the Owner marks Special Sales absent today');
select is(
  tests.run('special', format('select public.clock_in(%L, %L)', pg_temp.payload('00000000-0000-4000-8000-0000000d0004', null), 'S5S5')),
  'ok 1', 'Special Sales still clocks in');
select is(
  (select jsonb_build_object('kind', r.kind, 'in', r.in_at is not null, 'note', r.note) from pg_temp.today_rec('special') r),
  '{"kind": "worked", "in": true, "note": null}'::jsonb,
  'the day is a worked day with the time in; the mark is gone');
select is(
  (select jsonb_build_object('after', a.after - 'name' - 'day', 'before', a.before, 'reason', a.reason, 'by', a.actor_id = tests.uid('special'))
   from public.audit_logs a where a.action = 'attendance.mark' and a.after ->> 'kind' = 'replaced'),
  '{"after": {"kind": "replaced", "was": "absent"}, "before": {"kind": "absent"}, "reason": "Did not show up", "by": true}'::jsonb,
  'the audit log keeps the mark and its reason');
select is(
  tests.message('special', format('select public.clock_in(%L)', pg_temp.payload('00000000-0000-4000-8000-0000000d0005', null))),
  'already_clocked_in', 'a second time in is still refused');

select * from finish();
rollback;
