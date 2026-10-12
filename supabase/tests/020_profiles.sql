-- profiles (AUTH-03, SEC-02, SEC-05): a user reads their own row; the Owner reads their
-- branch with the second step; nobody writes from a client.
begin;
select * from no_plan();
select tests.fixture();

-- ---- Reading your own profile ------------------------------------------------------------
select is(
  tests.rows(caller, format('select * from public.profiles where id = tests.uid(%L)', name)),
  1::bigint,
  caller || ' reads their own profile'
)
from (values ('sales', 'sales'), ('special', 'special'), ('owner', 'owner')) as t (caller, name);

-- The app needs these three to read their own row: to route the Owner to the second step,
-- and to tell a device its account was turned off. They still read nothing else.
select is(
  tests.rows(caller, 'select * from public.profiles'),
  1::bigint,
  caller || ' sees their own profile row and no other'
)
from unnest(array['owner_aal1', 'deactivated', 'signed_out']) as caller;

select is(
  tests.rows('deactivated', $$select * from public.profiles where id = tests.uid('former') and not active$$),
  1::bigint,
  'a deactivated user can see that their own account is off'
);

select is(tests.rows('anon', 'select * from public.profiles'), -1::bigint, 'anon is refused outright');
select is(
  tests.rows('no_profile', 'select * from public.profiles'),
  0::bigint,
  'an account without a profile reads no profile'
);

-- ---- Reading someone else ----------------------------------------------------------------
select is(
  tests.rows(caller, format('select * from public.profiles where id = tests.uid(%L)', target)),
  0::bigint,
  caller || ' cannot read the profile of ' || target
)
from unnest(tests.no_access() || array['sales', 'special']) as caller
cross join unnest(array['owner', 'former', 'sales9']) as target
where caller <> 'anon'
  and not (caller = 'owner_aal1' and target = 'owner')
  and not (caller = 'deactivated' and target = 'former');

select is(
  tests.rows(caller, 'select * from public.profiles'),
  1::bigint,
  caller || ' cannot list users: only their own row comes back'
)
from unnest(array['sales', 'special']) as caller;

-- ---- The Owner ---------------------------------------------------------------------------
select is(
  tests.rows('owner', 'select * from public.profiles'),
  5::bigint,
  'the Owner lists every profile of their branch, deactivated ones included'
);
select is(
  tests.rows('owner', $$select * from public.profiles where branch_id <> 'tmain'$$),
  0::bigint,
  'the Owner reads no profile of another branch'
);
select is(
  tests.rows('owner', $$select * from public.profiles where id = tests.uid('sales9')$$),
  0::bigint,
  'the Owner cannot read a user of another branch by id'
);
select is(
  tests.rows('other_owner', $$select * from public.profiles where id = tests.uid('sales')$$),
  0::bigint,
  'an Owner of another branch cannot read this branch'
);
select is(
  tests.rows('other_owner', 'select * from public.profiles'),
  2::bigint,
  'an Owner of another branch sees only their own branch'
);

-- A demotion takes effect on the very next request: nothing is cached in the token.
update public.profiles set role = 'sales' where id = tests.uid('owner');
select is(
  tests.rows('owner', 'select * from public.profiles'),
  1::bigint,
  'an Owner token stops listing users the moment the profile says sales'
);
update public.profiles set role = 'owner' where id = tests.uid('owner');

update public.profiles set active = false where id = tests.uid('owner');
select is(
  tests.rows('owner', 'select * from public.profiles'),
  1::bigint,
  'an Owner token stops listing users the moment the profile is turned off'
);
update public.profiles set active = true where id = tests.uid('owner');

delete from auth.sessions where user_id = tests.uid('owner');
select is(
  tests.rows('owner', 'select * from public.profiles'),
  1::bigint,
  'an Owner token stops listing users the moment its session is ended'
);

-- ---- Nobody writes profiles from a client (AUTH-03) --------------------------------------
select is(
  tests.run(
    caller,
    $$insert into public.profiles (id, display_name, email, role, user_code, branch_id)
      values (tests.uid('nobody'), 'New', 'n@tests.pos', 'owner', 'NW', 'tmain')$$
  ),
  '42501',
  caller || ' cannot create a profile'
)
from unnest(tests.everyone()) as caller;

select is(
  tests.run(caller, format('update public.profiles set %s where id = tests.uid(%L)', change, target)),
  '42501',
  caller || ' cannot set ' || change || ' on ' || target
)
from unnest(tests.everyone()) as caller
cross join (
  values
    ($$role = 'owner'$$, 'sales'),
    ('active = true', 'former'),
    ($$display_name = 'x'$$, 'owner'),
    ($$branch_id = 'tother'$$, 'sales')
) as t (change, target);

select is(
  tests.run(caller, $$delete from public.profiles where id = tests.uid('sales')$$),
  '42501',
  caller || ' cannot delete a profile'
)
from unnest(tests.everyone()) as caller;

select * from finish();
rollback;
