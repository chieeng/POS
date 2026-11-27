-- A reopen doesn't erase the last real count (the Owner's staging test, Nov 1, 2026). Since
-- Nov 27, 2026 the opening is a blind count by denomination: the last count is told only
-- after the count, when the two differ (SRS SHIFT-01).
begin;
select * from no_plan();
select tests.fixture();

-- Oct 31 on staging: counted, reopened, nobody recounted, and the next day came.
select tests.as('sales');
select public.open_drawer('{"1": 1000}');
select tests.as('special');
select public.close_drawer('{"1000": 1, "100": 1, "20": 2}');
select tests.as('owner');
select public.reopen_drawer(
  (select id from public.drawer_sessions where branch_id = 'tmain'), 'A late sale'
);
select tests.as_admin();
update public.drawer_sessions set business_date = business_date - 1 where branch_id = 'tmain';

select tests.as('sales');
select ok(not public.drawer_today() ? 'lastCount', 'nothing about the last count before counting');
select tests.as_admin();

select is(
  tests.message('sales', 'select public.open_drawer(''{"1": 0}'')'),
  'reason_required',
  'an opening that differs from that count needs a reason'
);
select is(
  (select jsonb_build_object(
     'amount', d #> '{lastCount,amount}', 'by', d #> '{lastCount,counted_by_name}',
     'beforeReopen', d #> '{lastCount,before_reopen}', 'difference', d -> 'difference')
   from tests.detail('sales', $$select public.open_drawer('{"1000": 1}')$$) d),
  '{"amount": 1140.00, "by": "Special", "beforeReopen": true, "difference": -140.00}'::jsonb,
  'after the count: compared with the count taken before the reopen, by Special, and it says so'
);
select is(
  tests.run('sales', $$select public.open_drawer('{"1000": 1, "100": 1, "20": 2}')$$),
  'ok 1',
  'the same amount opens without a reason'
);
select is(
  (
    select array[s.prefill_cash::text, s.prefill_difference::text, s.opening_cash::text, s.opening_counts::text]
    from public.drawer_sessions s where s.branch_id = 'tmain' and s.status = 'open'
  ),
  array['1140.00', '0.00', '1140.00', '{"20": 2, "100": 1, "1000": 1}'],
  'the opening is compared with that count, and each denomination is kept'
);
select is(
  (
    select s.status from public.drawer_sessions s
    where s.branch_id = 'tmain' and s.business_date = private.manila_today() - 1
  ),
  'not_counted',
  'the reopened drawer itself still reads as not counted'
);

-- Counted, reopened, then counted again: the newer count wins.
select tests.as('special');
select public.close_drawer('{"1000": 1}');
select tests.as('owner');
select public.reopen_drawer(
  (select id from public.drawer_sessions where branch_id = 'tmain' and status = 'closed'),
  'Recount'
);
select tests.as('special');
select public.close_drawer('{"1000": 1, "500": 1}');
select tests.as_admin();
update public.drawer_sessions set business_date = business_date - 2 where branch_id = 'tmain';

select is(
  (select jsonb_build_object('amount', d #> '{lastCount,amount}', 'beforeReopen', d #> '{lastCount,before_reopen}')
   from tests.detail('sales', $$select public.open_drawer('{"1000": 1}')$$) d),
  '{"amount": 1500.00, "beforeReopen": false}'::jsonb,
  'a recount wins over the count it replaced, as an ordinary closing count'
);

-- ---- What a count may hold ---------------------------------------------------------------
select is(
  tests.message('sales', format('select public.open_drawer(%L)', c)),
  'invalid_input',
  'refused: ' || c
)
from unnest(array['[]', '{"25": 1}', '{"1000": -1}', '{"1000": 1.5}', '{"1000": "2"}', '{"1": 100001}']) as c;

select * from finish();
rollback;
