-- Fixing a day (SRS ATT-11; the owner's decisions of Nov 21, 2026): staff ask with the real
-- times and a reason, the Owner approves; the Owner fixes or marks a day directly; the day is
-- worked out again from the times.
begin;
select * from no_plan();
select tests.fixture();

create function pg_temp.day(p_days_ago int) returns date language sql as $$
  select private.manila_today() - p_days_ago;
$$;
create function pg_temp.req(p_user text) returns uuid language sql as $$
  select id from public.approval_requests where type = 'attendance_fix' and requested_by = tests.uid(p_user)
  order by (status = 'pending') desc, created_at desc limit 1;
$$;
create function pg_temp.rec(p_user text, p_days_ago int) returns public.attendance language sql as $$
  select * from public.attendance where user_id = tests.uid(p_user) and work_date = pg_temp.day(p_days_ago);
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- Who may ask ----------------------------------------------------------------------------
select is(
  tests.run(caller, format($$select public.request_attendance_fix(%L, '07:55', '18:00', 'Forgot')$$, pg_temp.day(1))),
  '42501', caller || ' cannot ask for a fix')
from unnest(array['anon', 'deactivated', 'signed_out', 'owner']) as caller;
select is(
  tests.message('sales', format($$select public.request_attendance_fix(%L, '07:55', null, 'x')$$, pg_temp.day(31))),
  'too_old', 'more than 30 days back is refused');
select is(
  tests.message('sales', format($$select public.request_attendance_fix(%L, null, null, 'x')$$, pg_temp.day(1))),
  'invalid_input', 'a time is needed');
select is(
  tests.message('sales', format($$select public.request_attendance_fix(%L, null, '18:00', 'x')$$, pg_temp.day(1))),
  'invalid_input', 'a time out alone, with no time in recorded, is refused');
select is(
  tests.message('sales', format($$select public.request_attendance_fix(%L, '18:00', '07:55', 'x')$$, pg_temp.day(1))),
  'out_before_in', 'out before in is refused');

-- ---- A forgotten day, asked and approved ------------------------------------------------------
select is(
  tests.run('sales', format($$select public.request_attendance_fix(%L, '08:20', '17:30', 'Forgot to clock in and out', 'A1B2')$$, pg_temp.day(1))),
  'ok 1', 'Sales asks for yesterday: in 8:20 AM, out 5:30 PM');
select is(
  tests.message('sales', format($$select public.request_attendance_fix(%L, '08:00', null, 'again')$$, pg_temp.day(1))),
  'request_pending', 'one pending fix per day');
select is((select count(*)::int from public.attendance), 0, 'nothing changes until the Owner decides');
select is(
  (select after ->> 'label' like '%, %' from public.approval_requests where id = pg_temp.req('sales')),
  true, 'the request names the person and the day');
select is(
  tests.run('owner', format('select public.decide_approval(%L, true, null, %L)', pg_temp.req('sales'), 'OWN1')),
  'ok 1', 'the Owner approves');
select is(
  (select jsonb_build_object('type', r.day_type, 'late', r.late_minutes, 'early', r.early_minutes, 'edited', 'edited' = any (r.flags), 'note', r.note)
   from pg_temp.rec('sales', 1) r),
  '{"type": "whole", "late": 20, "early": 30, "edited": true, "note": "Forgot to clock in and out"}'::jsonb,
  'the day is worked out: whole day, 20 min late, 30 min early out, marked edited');
select is(
  (select count(*)::int from public.audit_logs where action = 'attendance.fix'),
  1, 'the fix is audit-logged');

-- ---- A forgotten time out, on a day already clocked in ----------------------------------------
insert into public.attendance (branch_id, user_id, user_name, work_date, in_at, start_type, rules)
values ('tmain', tests.uid('special'), 'Special', pg_temp.day(2), private.at_on(pg_temp.day(2), '07:50'), 'morning',
  private.attendance_rules('tmain', tests.uid('special')));
select is(
  tests.run('special', format($$select public.request_attendance_fix(%L, null, '13:30', 'Forgot to clock out')$$, pg_temp.day(2))),
  'ok 1', 'Special Sales asks for the missing time out only');
-- Meanwhile the Owner fixes that day directly: the request is outdated.
select is(
  tests.run('owner', format($$select public.fix_attendance(%L, %L, null, '14:00', 'Saw her leave')$$, tests.uid('special'), pg_temp.day(2))),
  'ok 1', 'the Owner fixes the day directly');
select is((pg_temp.rec('special', 2)).day_type, 'morning_half', 'out at 2:00 PM: a morning half day');
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', pg_temp.req('special'))),
  'request_outdated', 'the request made before the Owner''s fix is outdated');
select is(
  tests.run('owner', format('select public.decide_approval(%L, false, %L)', pg_temp.req('special'), 'Already fixed')),
  'ok 1', 'and can be rejected');

-- ---- Absent and rest days --------------------------------------------------------------------
select is(
  tests.run('owner', format($$select public.mark_attendance_day(%L, %L, 'absent', 'Sick')$$, tests.uid('sales'), pg_temp.day(3))),
  'ok 1', 'the Owner marks a day absent');
select is((pg_temp.rec('sales', 3)).kind, 'absent', 'it is recorded');
select is(
  tests.run('owner', format($$select public.mark_attendance_day(%L, %L, 'rest', 'Swapped')$$, tests.uid('sales'), pg_temp.day(3))),
  'ok 1', 'and changes it to a rest day');
select is(
  tests.message('owner', format($$select public.mark_attendance_day(%L, %L, 'absent', 'x')$$, tests.uid('sales'), pg_temp.day(1))),
  'has_times', 'a day with times can''t be marked absent');
select is(
  tests.run('owner', format($$select public.mark_attendance_day(%L, %L, 'clear', 'Mistake')$$, tests.uid('sales'), pg_temp.day(3))),
  'ok 1', 'a mark can be cleared');
select is((select count(*)::int from public.attendance where work_date = pg_temp.day(3)), 0, 'and is gone');
select is(
  tests.run('sales', format($$select public.mark_attendance_day(%L, %L, 'absent', 'x')$$, tests.uid('sales'), pg_temp.day(3))),
  '42501', 'staff can''t mark days');
select is(
  tests.run('owner', format('select public.set_rest_weekday(%L, 0::smallint)', tests.uid('sales'))),
  'ok 1', 'the Owner sets Sunday as the usual rest day');
select is((select rest_weekday from public.profiles where id = tests.uid('sales')), 0::smallint, 'it is saved');
select is(
  tests.run('owner', format('select public.set_rest_weekday(%L, 7::smallint)', tests.uid('sales'))),
  '22023', 'only 0 to 6');

-- ---- Location flags: not read vs not verified ---------------------------------------------------
update public.branches set store_lat = 14.5862, store_lng = 121.1760, radius_m = 100 where id = 'tmain';
select is(
  private.check_location('tmain', null, null, null) ->> 'flag', 'location_not_read',
  'no reading at all: "location not read"');
select is(
  (select jsonb_build_object('flag', l -> 'flag', 'distance', l -> 'distance')
   from private.check_location('tmain', 14.5882, 121.1760, 250) l),
  '{"flag": "location_not_verified", "distance": 222}'::jsonb,
  'a poor reading: "not verified", with its distance kept');

select * from finish();
rollback;
