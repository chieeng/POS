-- Attendance (SRS ATT-01..13; the owner's decisions of Nov 21, 2026): one time in and one time
-- out a day, at the store; the server works out late, half days, early out and overtime from
-- the times and keeps the settings it used.
begin;
select * from no_plan();
select tests.fixture();

update public.branches set store_lat = 14.5862, store_lng = 121.1760, radius_m = 100 where id = 'tmain';

-- ---- The day's rules, from the defaults ------------------------------------------------------
create function pg_temp.rules() returns jsonb language sql as $$
  select private.attendance_rules('tmain', tests.uid('sales'));
$$;
select is(
  (select jsonb_build_object('in', r -> 'latestIn', 'pm', r -> 'afternoonStart', 'grace', r -> 'graceMinutes',
    'line', r -> 'afternoonLine', 'halfOut', r -> 'morningOutLine', 'out', r -> 'earliestOut', 'pmCredit', r -> 'afternoonCredit')
   from pg_temp.rules() r),
  '{"in": 480, "pm": 780, "grace": 15, "line": 720, "halfOut": 900, "out": 1080, "pmCredit": 0.5}'::jsonb,
  'defaults: in by 8:00, afternoon 1:00 PM, grace 15, half-day lines 12:00 noon and 3:00 PM, out 6:00 PM'
);

create function pg_temp.day(p_in int, p_out int) returns jsonb language sql as $$
  select private.attendance_day(pg_temp.rules(), p_in, p_out);
$$;
select is(pg_temp.day(475, 1080), '{"startType": "morning", "lateMinutes": 0, "dayType": "whole", "dayCredit": 1, "earlyMinutes": 0, "overtimeMinutes": 0}'::jsonb,
  '7:55 to 6:00 PM: a whole day, on time');
select is(pg_temp.day(495, 1080) ->> 'lateMinutes', '0', '8:15 is still within the grace period');
select is(pg_temp.day(496, 1080) ->> 'lateMinutes', '16', '8:16 is late by 16 minutes, counted from 8:00');
select is(pg_temp.day(480, 1020), '{"startType": "morning", "lateMinutes": 0, "dayType": "whole", "dayCredit": 1, "earlyMinutes": 60, "overtimeMinutes": 0}'::jsonb,
  'out at 5:00 PM: a whole day, 60 minutes early out');
select is(pg_temp.day(480, 840), '{"startType": "morning", "lateMinutes": 0, "dayType": "morning_half", "dayCredit": 0.5, "earlyMinutes": 0, "overtimeMinutes": 0}'::jsonb,
  'out at 2:00 PM: a morning half day, no early-out minutes');
select is(pg_temp.day(480, 900) ->> 'dayType', 'whole', 'out at exactly 3:00 PM is a whole day');
select is(pg_temp.day(480, 1110) ->> 'overtimeMinutes', '30', 'out at 6:30 PM: 30 minutes overtime');
select is(pg_temp.day(720, 1080), '{"startType": "afternoon", "lateMinutes": 0, "dayType": "afternoon_half", "dayCredit": 0.5, "earlyMinutes": 0, "overtimeMinutes": 0}'::jsonb,
  'in at 12:00 noon: an afternoon half day');
select is(pg_temp.day(716, 1080) ->> 'startType', 'morning', 'in at 11:56 is a (late) morning start');
select is(pg_temp.day(800, 1080) ->> 'lateMinutes', '20', 'afternoon in at 1:20 PM is late by 20 minutes');
select is(pg_temp.day(480, null) ->> 'dayType', null, 'no time out yet: the day is open');

-- A person's own time in replaces 8:00 for them only (ATT-08).
update public.profiles set clock_in_override = '09:00' where id = tests.uid('special');
select is(
  private.attendance_day(private.attendance_rules('tmain', tests.uid('special')), 545, 1080) ->> 'lateMinutes',
  '0', 'with an own time of 9:00, 9:05 is on time');

-- ---- Who may clock in ------------------------------------------------------------------------
create function pg_temp.payload(p_client text, p_minutes_ago int, p_lat float8 default 14.5862, p_acc float8 default 10)
returns text language sql as $$
  select jsonb_build_object('clientId', p_client,
    'deviceAt', case when p_minutes_ago is null then null else (now() - make_interval(mins => p_minutes_ago))::text end,
    'lat', p_lat, 'lng', 121.1760, 'accuracy', p_acc)::text;
$$;
grant execute on all functions in schema pg_temp to authenticated;

select is(
  tests.run(caller, format('select public.clock_in(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c001', null))),
  '42501', caller || ' cannot clock in')
from unnest(array['anon', 'no_profile', 'deactivated', 'signed_out', 'owner']) as caller;

-- ---- Location ----------------------------------------------------------------------------------
select is(
  tests.message('sales', format('select public.clock_in(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c002', null, 14.5962))),
  'outside_radius', 'a good fix about 1.1 km away is refused');
select is((select count(*)::int from public.attendance), 0, 'and nothing is recorded');

-- ---- Clock in ----------------------------------------------------------------------------------
select is(
  tests.run('sales', format('select public.clock_in(%L, %L)', pg_temp.payload('00000000-0000-4000-8000-00000000c003', 4), 'A1B2')),
  'ok 1', 'Sales clocks in at the store');
select is(
  (select jsonb_build_object('location', a.in_location, 'distance', a.in_distance_m, 'flags', a.flags, 'open', a.out_at is null, 'today', a.work_date = private.manila_today())
   from public.attendance a where a.user_id = tests.uid('sales')),
  '{"location": "ok", "distance": 0, "flags": [], "open": true, "today": true}'::jsonb,
  'today''s record: inside the radius, no flags, open');
select is(
  tests.run('sales', format('select public.clock_in(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c003', 4))),
  'ok 1', 'the same clock-in sent again (outbox retry) is accepted');
select is((select count(*)::int from public.attendance), 1, 'and still one record');
select is(
  tests.message('sales', format('select public.clock_in(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c004', null))),
  'already_clocked_in', 'a second time in the same day is refused');

-- ---- Clock out ---------------------------------------------------------------------------------
select is(
  tests.message('special', format('select public.clock_out(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c005', null))),
  'not_clocked_in', 'clocking out without a time in is refused');
select is(
  tests.run('sales', format('select public.clock_out(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c006', null))),
  'ok 1', 'Sales clocks out');
select is(
  (select jsonb_build_object('closed', a.out_at is not null, 'type', a.day_type is not null, 'credit', a.day_credit in (0.5, 1))
   from public.attendance a where a.user_id = tests.uid('sales')),
  '{"closed": true, "type": true, "credit": true}'::jsonb,
  'the day is closed and worked out');
select is(
  tests.message('sales', format('select public.clock_out(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c007', null))),
  'already_clocked_out', 'a second time out is refused');

-- ---- Offline and poor GPS -----------------------------------------------------------------------
select is(
  tests.run('special', format('select public.clock_in(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c008', 30, null))),
  'ok 1', 'Special Sales clocks in from the outbox, 30 minutes late to send, without a location');
select is(
  (select jsonb_build_object('location', a.in_location, 'flags', a.flags, 'devTime', abs(extract(epoch from (a.in_at - a.in_device_at))) < 1)
   from public.attendance a where a.user_id = tests.uid('special')),
  '{"location": "not_verified", "flags": ["location_not_read", "sent_late"], "devTime": true}'::jsonb,
  'it counts at the phone''s time, flagged location not verified and sent late');
select is(
  tests.message('special', format('select public.clock_out(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c009', 40))),
  'out_before_in', 'a time out before the time in is refused');
select is(
  tests.run('special', format('select public.clock_out(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c010', -10, 14.5862, 500))),
  'ok 1', 'a phone clock 10 minutes ahead, with a poor fix, still clocks out');
select is(
  (select a.flags @> array['clock_ahead', 'location_not_verified'] and abs(extract(epoch from (a.out_at - a.out_server_at))) < 1
   from public.attendance a where a.user_id = tests.uid('special')),
  true, 'at the server''s time, flagged clock ahead');

-- ---- A time out after midnight closes the day it started --------------------------------------
insert into public.attendance (branch_id, user_id, user_name, work_date, in_at, in_server_at, start_type, rules)
values ('tmain', tests.uid('owner'), 'Owner', private.manila_today() - 1, now() - interval '20 hours', now(), 'morning',
  private.attendance_rules('tmain', tests.uid('owner')));
update public.branches set owner_clocks_in = true where id = 'tmain';
select is(
  tests.run('owner', format('select public.clock_out(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c011', null))),
  'ok 1', 'an open day from yesterday takes the time out');
select is(
  (select a.out_at is not null and a.day_type is not null from public.attendance a
   where a.user_id = tests.uid('owner') and a.work_date = private.manila_today() - 1),
  true, 'and is closed');
select is(
  tests.message('owner', format('select public.clock_out(%L)', pg_temp.payload('00000000-0000-4000-8000-00000000c012', null))),
  'not_clocked_in', 'with nothing open, a time out is refused');
update public.branches set owner_clocks_in = false where id = 'tmain';
delete from public.attendance where user_id = tests.uid('owner');

-- ---- Who sees what (ATT-14, ATT-15) --------------------------------------------------------------
select is(tests.rows('sales', 'select * from public.attendance'), 1::bigint, 'Sales sees only their own day');
select is(tests.rows('owner', 'select * from public.attendance'), 2::bigint, 'the Owner sees everyone''s');
select is(tests.rows('other_owner', 'select * from public.attendance'), 0::bigint, 'another branch sees none');

create function pg_temp.today(p_caller text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as(p_caller);
  v := public.attendance_today();
  perform tests.as_admin();
  return v;
end;
$$;
grant execute on function pg_temp.today(text) to authenticated;
select is(
  (select jsonb_build_object('can', t -> 'canClock', 'mine', t #>> '{record,user_id}' = tests.uid('sales')::text, 'set', t -> 'storeLocationSet')
   from pg_temp.today('sales') t),
  '{"can": true, "mine": true, "set": true}'::jsonb,
  'the clock screen gets today''s own record');
select is(pg_temp.today('owner') -> 'canClock', 'false'::jsonb, 'the Owner doesn''t clock in by default');

-- ---- Settings -----------------------------------------------------------------------------------
select is(
  tests.run('owner', $$select public.update_branch_settings('{"earliest_out": "17:30", "afternoon_line": "11:30", "morning_out_line": "14:00"}')$$),
  'ok 1', 'the Owner moves the lines');
select is(
  (select jsonb_build_object('out', r -> 'earliestOut', 'line', r -> 'afternoonLine', 'halfOut', r -> 'morningOutLine') from pg_temp.rules() r),
  '{"out": 1050, "line": 690, "halfOut": 840}'::jsonb,
  'and the next clock-in uses them');
select is(
  tests.run('owner', $$select public.update_branch_settings('{"morning_out_line": "10:00"}')$$),
  '22023', 'a morning half day line before the afternoon start is refused');
select is(
  (select r -> 'latestIn' from pg_temp.rules() r), '480'::jsonb, 'latest time in is 8:00 AM by default');

select * from finish();
rollback;
