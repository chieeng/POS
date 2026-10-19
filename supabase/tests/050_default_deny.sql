-- Default deny (SRS 6.2): what has no policy and no grant gives every caller nothing.
-- `branches` is readable by the branch's own active users (SYS-01) and writable by nobody
-- directly: the Owner changes it through update_branch_settings (080_store_settings.sql).
begin;
select * from no_plan();
select tests.fixture();

select is(
  tests.rows(caller, 'select * from public.branches'),
  1::bigint,
  caller || ' reads exactly one branch: their own'
)
from unnest(array['sales', 'special', 'owner', 'other_owner']) as caller;

select is(
  tests.rows('sales', $$select * from public.branches where id = 'tother'$$),
  0::bigint,
  'a user cannot read another branch'
);

select is(
  tests.rows(caller, 'select * from public.branches'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' cannot read branches'
)
from unnest(tests.no_access()) as caller;

select is(
  tests.run(caller, $$insert into public.branches (id, name) values ('hacked', 'Hacked')$$),
  '42501',
  caller || ' cannot create a branch'
)
from unnest(tests.everyone()) as caller;

select is(
  tests.run(caller, $$update public.branches set name = 'Hacked'$$),
  '42501',
  caller || ' cannot change a branch directly'
)
from unnest(tests.everyone()) as caller;

select is(
  tests.run(caller, 'delete from public.branches'),
  '42501',
  caller || ' cannot delete a branch'
)
from unnest(tests.everyone()) as caller;

-- Tables that do not exist yet answer the same way as tables that are closed.
select is(
  tests.run(caller, 'select * from public.' || quote_ident(missing)),
  '42P01',
  caller || ' finds no table called ' || missing
)
from unnest(array['anon', 'sales', 'owner']) as caller
cross join unnest(array['stock_movements', 'sales', 'pay_rates']) as missing;

-- Nothing new is ever open by accident: a table created later starts with no API access.
create table public.later_table (id int primary key);
select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'later_table'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  0::bigint,
  'a table created later is granted to no client role by default'
);

create function public.later_function() returns int language sql as 'select 1';
select is(
  has_function_privilege('anon', 'public.later_function()', 'execute')
    or has_function_privilege('authenticated', 'public.later_function()', 'execute'),
  false,
  'a function created later is executable by no client role by default'
);

select * from finish();
rollback;
