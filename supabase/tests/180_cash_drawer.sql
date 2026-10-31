-- Cash drawer (SRS 3.4, SHIFT-01..03) with the Owner's decisions of Oct 31, 2026: open with
-- a reason when the amount differs from the last count, cash in/out with a reason, a blind
-- count by denomination by the Owner or Special Sales, auto-close of a forgotten drawer, and
-- reopening by the Owner only.
begin;
select * from no_plan();
select tests.fixture();

-- ---- Who may use it ----------------------------------------------------------------------
select is(
  tests.run(caller, 'select public.drawer_today()'),
  '42501',
  caller || ' cannot see the drawer'
)
from unnest(tests.no_access()) as caller;

select is(
  tests.run(caller, 'select public.open_drawer(100)'),
  '42501',
  caller || ' cannot open the drawer'
)
from unnest(tests.no_access()) as caller;

-- ---- Open --------------------------------------------------------------------------------
select tests.as('sales');
select is(public.drawer_today() -> 'session', 'null'::jsonb, 'no drawer is open yet today');
select is(public.drawer_today() -> 'lastCount', 'null'::jsonb, 'and there is no earlier count');
select tests.as_admin();

select is(
  tests.run('sales', $$select public.open_drawer(2000, null, 'A1B2')$$),
  'ok 1',
  'Sales opens today''s drawer; with no earlier count no reason is needed'
);

select is(
  (
    select array[s.status, s.opened_by_name, s.opening_cash::text, s.open_device_tag]
    from public.drawer_sessions s where s.branch_id = 'tmain'
  ),
  array['open', (select display_name from public.profiles where id = tests.uid('sales')), '2000.00', 'A1B2'],
  'the session keeps who opened it, the amount and the device'
);

select is(
  (select count(*) from public.audit_logs where action = 'drawer.open' and branch_id = 'tmain'),
  1::bigint,
  'opening is audit-logged'
);

select is(
  tests.message('special', 'select public.open_drawer(2000)'),
  'already_open',
  'only one drawer a day (SHIFT-01)'
);

select tests.as('special');
select is(
  public.drawer_today() #>> '{session,status}',
  'open',
  'every user sees that today''s drawer is open'
);
select ok(
  not (public.drawer_today()::text ~ 'expected'),
  'drawer_today never tells staff the expected cash (blind count)'
);
select tests.as_admin();

-- ---- Cash in and out ---------------------------------------------------------------------
select is(
  tests.run('sales', $$select public.record_drawer_entry('cash_out', 350, 'expense', 'Ice, 2 sacks', 'A1B2')$$),
  'ok 1',
  'Sales records a cash-out with a reason and a note'
);
select is(
  tests.run('special', $$select public.record_drawer_entry('cash_in', 500, 'change_fund')$$),
  'ok 1',
  'Special Sales records a cash-in; the note is optional'
);

select is(
  (select jsonb_build_object('actor', pr.display_name, 'tag', a.device_tag, 'target', a.target_type)
     || (a.after - 'entryId' - 'businessDate')
   from public.audit_logs a join public.profiles pr on pr.id = a.actor_id
   where a.action = 'drawer.cashOut' and a.branch_id = 'tmain'),
  (select jsonb_build_object('actor', display_name, 'tag', 'A1B2', 'target', 'drawer',
     'amount', 350, 'reason', 'expense', 'note', 'Ice, 2 sacks')
   from public.profiles where id = tests.uid('sales')),
  'a cash-out is in the audit log with the amount, reason, note and who'
);
select is(
  (select a.after ->> 'reason' || ' ' || (a.after ->> 'amount') || ' ' || coalesce(a.after ->> 'note', 'no note')
   from public.audit_logs a where a.action = 'drawer.cashIn' and a.branch_id = 'tmain'
     and a.actor_id = tests.uid('special')),
  'change_fund 500 no note',
  'a cash-in is in the audit log too'
);
select is(
  (select count(*) from public.audit_logs a
   join public.drawer_entries e on e.id = (a.after ->> 'entryId')::uuid
   where a.action in ('drawer.cashIn', 'drawer.cashOut') and a.branch_id = 'tmain'),
  2::bigint,
  'each audit line points at its drawer entry'
);

select is(
  tests.run('sales', format('select public.record_drawer_entry(%L, %s, %L, %L)', kind, amount, reason, note)),
  '22023',
  'record_drawer_entry refuses ' || label
)
from (
  values
    ('cash_out', '10', 'other', null, '"Other" without a note'),
    ('refund', '10', 'expense', null, 'an unknown type'),
    ('cash_out', '0', 'expense', null, 'a zero amount'),
    ('cash_out', '-5', 'expense', null, 'a negative amount'),
    ('cash_out', '1.005', 'expense', null, 'fractions of a centavo'),
    ('cash_out', '10', 'lunch', null, 'an unknown reason'),
    ('cash_out', '10', 'expense', repeat('x', 201), 'a note over 200 characters')
) as bad(kind, amount, reason, note, label);

select is(
  tests.run(caller, $$select public.record_drawer_entry('cash_in', 10, 'change_fund')$$),
  '42501',
  caller || ' cannot record cash in or out'
)
from unnest(tests.no_access()) as caller;

-- ---- Expected cash: the Owner only -------------------------------------------------------
select is(
  tests.run(caller, 'select public.drawer_expected_cash()'),
  '42501',
  caller || ' cannot read expected cash before the count'
)
from unnest(array['sales', 'special', 'owner_aal1']) as caller;

select tests.as('owner');
select is(
  public.drawer_expected_cash(),
  2150.00::numeric,
  'the Owner sees expected cash: opening + cash in - cash out'
);
select tests.as_admin();

select is(
  tests.run(caller, 'select count(*) from public.drawer_sessions where id is not null'),
  'ok 1',
  caller || ' may query drawer_sessions'
)
from unnest(array['sales', 'special']) as caller;
select tests.as('special');
select is(
  (select count(*) from public.drawer_sessions) + (select count(*) from public.drawer_entries),
  0::bigint,
  'but staff read no drawer rows directly'
);
select tests.as('owner');
select is(
  (select count(*) from public.drawer_entries),
  2::bigint,
  'the Owner reads the branch''s cash in and out'
);
select tests.as('other_owner');
select is(
  (select count(*) from public.drawer_sessions) + (select count(*) from public.drawer_entries),
  0::bigint,
  'another branch''s Owner reads nothing of this drawer'
);
select tests.as_admin();

-- ---- Close: blind count by denomination --------------------------------------------------
select is(
  tests.run('sales', $$select public.close_drawer('{"1000": 2}')$$),
  '42501',
  'Sales cannot close the drawer (SHIFT-03)'
);

select is(
  tests.run('special', format('select public.close_drawer(%L)', counts)),
  '22023',
  'close_drawer refuses ' || label
)
from (
  values
    ('{"0.25": 4}', 'a 25-centavo count'),
    ('{"1000": -1}', 'a negative count'),
    ('{"1000": 1.5}', 'half a bill'),
    ('{"1000": "2"}', 'a count that is not a number'),
    ('[1, 2]', 'a list instead of counts')
) as bad(counts, label);

select tests.as('special');
select is(
  public.close_drawer('{"1000": 2, "100": 1, "20": 2}', 'Counted twice', 'C3D4'),
  '{"expected": 2150.00, "counted": 2140.00, "overShort": -10.00}'::jsonb,
  'Special Sales counts by denomination; expected and the exact over/short show only now'
);
select tests.as_admin();

select is(
  (
    select array[s.status, s.counted_cash::text, s.expected_cash::text, s.over_short::text, s.closing_note]
    from public.drawer_sessions s where s.branch_id = 'tmain'
  ),
  array['closed', '2140.00', '2150.00', '-10.00', 'Counted twice'],
  'the closed session keeps the count, expected cash, over/short and the note for the Owner'
);
select is(
  (select count(*) from public.audit_logs where action = 'drawer.close' and branch_id = 'tmain'),
  1::bigint,
  'closing is audit-logged'
);

select is(
  tests.message('sales', $$select public.record_drawer_entry('cash_in', 10, 'change_fund')$$),
  'drawer_not_open',
  'nothing goes into a closed drawer'
);
select is(
  tests.message('sales', 'select public.open_drawer(2140)'),
  'already_closed',
  'and it does not open again the same day'
);

-- ---- Reopen: the Owner only, with a reason -----------------------------------------------
select is(
  tests.run('special', format(
    $$select public.reopen_drawer(%L, 'Late sale')$$,
    (select id from public.drawer_sessions where branch_id = 'tmain')
  )),
  '42501',
  'Special Sales cannot reopen a drawer'
);
select is(
  tests.run('owner', format(
    'select public.reopen_drawer(%L, %L)',
    (select id from public.drawer_sessions where branch_id = 'tmain'), '  '
  )),
  '22023',
  'the Owner needs a reason to reopen'
);
select is(
  tests.run('owner', format(
    $$select public.reopen_drawer(%L, 'A late sale to ring up')$$,
    (select id from public.drawer_sessions where branch_id = 'tmain')
  )),
  'ok 1',
  'the Owner reopens the latest drawer with a reason'
);
select is(
  (
    select array[s.status, coalesce(s.counted_cash::text, 'none')]
    from public.drawer_sessions s where s.branch_id = 'tmain'
  ),
  array['open', 'none'],
  'it is open again, waiting for a new count'
);
select is(
  (
    select a.before ->> 'counted' from public.audit_logs a
    where a.action = 'drawer.reopen' and a.branch_id = 'tmain'
  ),
  '2140.00',
  'the earlier count is kept in the audit log'
);

-- ---- The next day ------------------------------------------------------------------------
-- Count again, then move this session two days back (the next section uses yesterday).
select tests.as('owner');
select public.close_drawer('{"1000": 2, "100": 1, "20": 2}');
select tests.as_admin();
update public.drawer_sessions set business_date = business_date - 2 where branch_id = 'tmain';

select tests.as('sales');
select is(
  public.drawer_today() #>> '{lastCount,amount}',
  '2140.00',
  'the next day, the last closing count is offered as the opening cash'
);
select tests.as_admin();

select is(
  tests.message('sales', 'select public.open_drawer(2000)'),
  'reason_required',
  'an opening cash that differs from the last count needs a reason'
);
select is(
  tests.run('sales', $$select public.open_drawer(2000, 'Owner took 140 for ice', 'A1B2')$$),
  'ok 1',
  'with a reason it opens'
);
select is(
  (
    select array[s.prefill_cash::text, s.prefill_difference::text, s.opening_reason]
    from public.drawer_sessions s
    where s.branch_id = 'tmain' and s.status = 'open'
  ),
  array['2140.00', '-140.00', 'Owner took 140 for ice'],
  'the difference and the reason are kept for the Owner'
);

-- ---- A drawer nobody closed --------------------------------------------------------------
-- Today's drawer stays open overnight: move it to yesterday, then open the next day.
update public.drawer_sessions set business_date = business_date - 1
where branch_id = 'tmain' and status = 'open';

select tests.as('sales');
select is(
  (public.drawer_today() ->> 'staleOpen')::boolean,
  true,
  'a drawer left open on an earlier day is reported'
);
select tests.as_admin();

select is(
  tests.run('sales', $$select public.open_drawer(2140, 'Not counted last night')$$),
  'ok 1',
  'today''s drawer still opens: selling is never blocked'
);
select is(
  (
    select array[s.status, s.expected_cash::text, coalesce(s.counted_cash::text, 'none')]
    from public.drawer_sessions s
    where s.branch_id = 'tmain' and s.business_date = private.manila_today() - 1
  ),
  array['not_counted', '2000.00', 'none'],
  'yesterday''s drawer is closed as not counted, with its expected cash'
);
select is(
  (select count(*) from public.audit_logs where action = 'drawer.notCounted' and branch_id = 'tmain'),
  1::bigint,
  'and flagged for the Owner in the audit log'
);
select is(
  (
    select s.prefill_cash::text from public.drawer_sessions s
    where s.branch_id = 'tmain' and s.status = 'open'
  ),
  '2140.00',
  'the opening is compared with the last real count, not the uncounted day'
);

select * from finish();
rollback;
