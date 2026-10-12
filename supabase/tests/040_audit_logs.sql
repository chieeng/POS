-- audit_logs (SYS-03, NFR-05): the Owner of the branch reads; nobody writes from a client;
-- no API role can ever change or remove an entry.
begin;
select * from no_plan();
select tests.fixture();

select is(
  tests.rows('owner', 'select * from public.audit_logs'),
  1::bigint,
  'the Owner lists the audit log of their branch'
);
select is(
  tests.rows('owner', $$select * from public.audit_logs where branch_id = 'tother'$$),
  0::bigint,
  'the Owner reads no entry of another branch'
);
select is(
  tests.rows('other_owner', $$select * from public.audit_logs where branch_id = 'tmain'$$),
  0::bigint,
  'an Owner of another branch cannot read this branch''s audit log'
);

select is(
  tests.rows(caller, 'select * from public.audit_logs'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' cannot read the audit log'
)
from unnest(tests.no_access() || array['sales', 'special']) as caller;

select is(
  tests.run(
    caller,
    $$insert into public.audit_logs (branch_id, action, actor_id, target_type, target_id)
      values ('tmain', 'user.create', tests.uid('owner'), 'user', 'x')$$
  ),
  '42501',
  caller || ' cannot write an audit entry'
)
from unnest(tests.everyone()) as caller;

select is(
  tests.run(caller, $$update public.audit_logs set action = 'user.edited'$$),
  '42501',
  caller || ' cannot change an audit entry'
)
from unnest(tests.everyone() || array['service']) as caller;

select is(
  tests.run(caller, 'delete from public.audit_logs'),
  '42501',
  caller || ' cannot delete an audit entry'
)
from unnest(tests.everyone() || array['service']) as caller;

select is(
  tests.run('service', 'truncate public.audit_logs'),
  '42501',
  'the service role cannot truncate the audit log'
);

select is((select count(*) from public.audit_logs where branch_id in ('tmain', 'tother')), 2::bigint, 'every entry is still there');

select * from finish();
rollback;
