-- A reopen doesn't erase the last real count (the Owner's staging test, Nov 1, 2026).
begin;
select * from no_plan();
select tests.fixture();

-- Oct 31 on staging: counted, reopened, nobody recounted, and the next day came.
select tests.as('sales');
select public.open_drawer(1000);
select tests.as('special');
select public.close_drawer('{"1000": 1, "100": 1, "20": 2}');
select tests.as('owner');
select public.reopen_drawer(
  (select id from public.drawer_sessions where branch_id = 'tmain'), 'A late sale'
);
select tests.as_admin();
update public.drawer_sessions set business_date = business_date - 1 where branch_id = 'tmain';

select tests.as('sales');
select is(
  public.drawer_today() -> 'lastCount' ->> 'amount',
  '1140.00',
  'the count taken before the reopen is offered as the opening cash'
);
select is(
  public.drawer_today() -> 'lastCount' ->> 'counted_by_name',
  'Special',
  'with who counted it'
);
select is(
  (public.drawer_today() -> 'lastCount' ->> 'before_reopen')::boolean,
  true,
  'and it says the drawer was reopened after that count'
);
select tests.as_admin();

select is(
  tests.message('sales', 'select public.open_drawer(0)'),
  'reason_required',
  'an opening that differs from that count needs a reason'
);
select is(
  tests.run('sales', 'select public.open_drawer(1140)'),
  'ok 1',
  'the same amount opens without one'
);
select is(
  (
    select array[s.prefill_cash::text, s.prefill_difference::text]
    from public.drawer_sessions s where s.branch_id = 'tmain' and s.status = 'open'
  ),
  array['1140.00', '0.00'],
  'the opening is compared with that count'
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

select tests.as('sales');
select is(
  public.drawer_today() -> 'lastCount' ->> 'amount',
  '1500.00',
  'a recount wins over the count it replaced'
);
select is(
  (public.drawer_today() -> 'lastCount' ->> 'before_reopen')::boolean,
  false,
  'and it is an ordinary closing count'
);
select tests.as_admin();

select * from finish();
rollback;
