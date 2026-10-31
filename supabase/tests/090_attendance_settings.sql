-- Attendance settings (ATT-06, ATT-07, ATT-10, ATT-01) through update_branch_settings.
begin;
select * from no_plan();
select tests.fixture();

-- ---- Defaults (SRS decisions of 18 Oct 2026) ------------------------------------------------
select is(
  (
    select concat_ws(' | ', morning_clock_in, afternoon_clock_in, grace_minutes, late_deduction,
      late_penalty, paid_minutes_per_day, afternoon_day_credit, owner_clocks_in)
    from public.branches where id = 'tmain'
  ),
  '06:00:00 | 13:00:00 | 15 | none | 0.00 | 480 | 0.5 | f',
  'defaults: 6:00 AM, 1:00 PM, 15 min grace, no late deduction (flat PHP 0), 8 paid hours, afternoon day = half, Owner does not clock in'
);

-- ---- Who may change them -------------------------------------------------------------------
select is(
  tests.run(caller, $$select public.update_branch_settings('{"late_deduction": "flat", "late_penalty": 100}')$$),
  '42501',
  caller || ' cannot change attendance settings'
)
from unnest(tests.no_access() || array['sales', 'special']) as caller;

-- ---- The Owner changes them, audit-logged ----------------------------------------------------
select is(
  tests.run(
    'owner',
    $$select public.update_branch_settings(
      '{"morning_clock_in": "07:30", "afternoon_clock_in": "14:00:45", "grace_minutes": 10,
        "late_deduction": "minutes", "paid_minutes_per_day": 540,
        "afternoon_day_credit": 1, "owner_clocks_in": true}', 'A1B2')$$
  ),
  'ok 1',
  'the Owner saves the attendance rules'
);

select is(
  (
    select concat_ws(' | ', morning_clock_in, afternoon_clock_in, grace_minutes, late_deduction,
      paid_minutes_per_day, afternoon_day_credit, owner_clocks_in)
    from public.branches where id = 'tmain'
  ),
  '07:30:00 | 14:00:00 | 10 | minutes | 540 | 1.0 | t',
  'they are saved, clock-in times in whole minutes'
);

select is(
  (
    select (before ->> 'late_deduction') || ' -> ' || (after ->> 'late_deduction') || ', '
      || (before ->> 'morning_clock_in') || ' -> ' || (after ->> 'morning_clock_in') || ', '
      || (before ->> 'owner_clocks_in') || ' -> ' || (after ->> 'owner_clocks_in')
    from public.audit_logs where action = 'branch.update'
  ),
  'none -> minutes, 06:00:00 -> 07:30:00, false -> true',
  'the change is audit-logged with old and new values (ATT-09)'
);

select is(
  tests.run('owner', $$select public.update_branch_settings('{"late_deduction": "flat", "late_penalty": 25.50}')$$),
  'ok 1',
  'the Owner can choose a flat amount instead'
);
select is(
  (select late_deduction || ' ' || late_penalty from public.branches where id = 'tmain'),
  'flat 25.50',
  'and it is saved'
);

-- ---- Bad input changes nothing --------------------------------------------------------------
select is(
  tests.message('owner', format('select public.update_branch_settings(%L)', changes)),
  'invalid_input',
  'refused: ' || changes
)
from unnest(array[
  '{"morning_clock_in": "6 am"}',
  '{"morning_clock_in": "25:00"}',
  '{"afternoon_clock_in": "05:00"}',
  '{"morning_clock_in": "15:00"}',
  '{"grace_minutes": -1}',
  '{"grace_minutes": 121}',
  '{"late_deduction": "fine"}',
  '{"late_penalty": -1}',
  '{"late_penalty": 10001}',
  '{"paid_minutes_per_day": 30}',
  '{"afternoon_day_credit": 0.7}',
  '{"afternoon_day_credit": 2}',
  '{"owner_clocks_in": "maybe"}',
  '{"owner_clocks_in": null}'
]) as changes;

select is(
  (
    select concat_ws(' | ', morning_clock_in, afternoon_clock_in, grace_minutes, late_deduction,
      late_penalty, paid_minutes_per_day, afternoon_day_credit, owner_clocks_in)
    from public.branches where id = 'tmain'
  ),
  '07:30:00 | 14:00:00 | 10 | flat | 25.50 | 540 | 1.0 | t',
  'none of the refused changes was applied'
);

select * from finish();
rollback;
