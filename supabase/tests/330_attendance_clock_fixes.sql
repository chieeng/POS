-- Clock fixes (found Nov 23, 2026, before step 11 PR 4): a time counts in the minute the clock
-- shows, and a time out can only close the day it belongs to (ATT-01, ATT-06).
begin;
select * from no_plan();
select tests.fixture();

-- ---- The minute the clock shows ------------------------------------------------------------
create function pg_temp.minute_of(p_time text) returns integer language sql as $$
  select private.minutes_on(('2026-11-23 ' || p_time || '+08')::timestamptz, date '2026-11-23');
$$;
create function pg_temp.result(p_in text, p_out text) returns jsonb language sql as $$
  select private.attendance_day(private.attendance_rules('tmain', tests.uid('sales')),
    pg_temp.minute_of(p_in), pg_temp.minute_of(p_out));
$$;
select is(pg_temp.minute_of('08:15:59'), 495, '8:15:59 is in the minute 8:15');
select is(pg_temp.result('08:15:59', '18:00:00') ->> 'lateMinutes', '0',
  '8:15:59 is inside the grace period');
select is(pg_temp.result('08:16:00', '18:00:00') ->> 'lateMinutes', '16',
  '8:16:00 is late by 16 minutes');
select is(pg_temp.result('11:59:59', '18:00:00') ->> 'dayType', 'whole',
  '11:59:59 AM is still a morning start, a whole day');
select is(pg_temp.result('08:00:00', '14:59:59') ->> 'dayType', 'morning_half',
  'out at 2:59:59 PM is still a morning half day');
select is(pg_temp.result('08:00:00', '17:59:59') ->> 'earlyMinutes', '1',
  'out at 5:59:59 PM is still before the earliest time out');

-- ---- A second time out never reaches back to yesterday ----------------------------------------
insert into public.attendance (branch_id, user_id, user_name, work_date, in_at, start_type, rules)
values ('tmain', tests.uid('sales'), 'Sales', private.manila_today() - 1,
  private.at_on(private.manila_today() - 1, '00:01'), 'morning',
  private.attendance_rules('tmain', tests.uid('sales')));
insert into public.attendance
  (branch_id, user_id, user_name, work_date, in_at, out_at, start_type, day_type, day_credit, rules)
values ('tmain', tests.uid('sales'), 'Sales', private.manila_today(),
  private.at_on(private.manila_today(), '00:01'), private.at_on(private.manila_today(), '00:02'),
  'morning', 'morning_half', 0.5, private.attendance_rules('tmain', tests.uid('sales')));
select is(
  tests.message('sales', $$select public.clock_out('{"clientId":"00000000-0000-4000-8000-00000000e001"}')$$),
  'already_clocked_out', 'a second time out today is refused');
select is(
  (select a.out_at is null and a.day_type is null from public.attendance a
   where a.user_id = tests.uid('sales') and a.work_date = private.manila_today() - 1),
  true, 'and yesterday''s forgotten day stays "No time out"');

-- ---- Which day a time out closes ----------------------------------------------------------------
create function pg_temp.closes(p_at text) returns date language sql as $$
  select private.day_to_close(tests.uid('special'), p_at::timestamptz);
$$;
insert into public.attendance (branch_id, user_id, user_name, work_date, in_at, start_type, rules)
values ('tmain', tests.uid('special'), 'Special', '2026-11-20', '2026-11-20 17:00+08', 'afternoon',
  private.attendance_rules('tmain', tests.uid('special')));
select is(pg_temp.closes('2026-11-20 18:05+08'), date '2026-11-20', 'the same day''s time out');
select is(pg_temp.closes('2026-11-21 00:10+08'), date '2026-11-20',
  'just after midnight, the day that started before it');
select is(pg_temp.closes('2026-11-21 03:59:59+08'), date '2026-11-20', 'up to 4:00 AM');
select is(pg_temp.closes('2026-11-21 04:00+08'), null, 'from 4:00 AM the forgotten day is not closed');
select is(pg_temp.closes('2026-11-21 18:05+08'), null,
  'the next evening''s time out never closes yesterday');
select is(pg_temp.closes('2026-11-22 00:10+08'), null, 'and never a day two days back');

insert into public.attendance (branch_id, user_id, user_name, work_date, in_at, start_type, rules)
values ('tmain', tests.uid('special'), 'Special', '2026-11-21', '2026-11-21 01:00+08', 'morning',
  private.attendance_rules('tmain', tests.uid('special')));
select is(pg_temp.closes('2026-11-21 01:30+08'), date '2026-11-21',
  'with a time in today, today is the day to close');

select * from finish();
rollback;
