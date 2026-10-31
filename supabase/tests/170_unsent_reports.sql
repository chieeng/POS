-- report_unsent (NFR-02): a sale or clock-in the server refused for good is reported to the
-- Owner through the audit log, once, by an active user of the branch.
begin;
select * from no_plan();
select tests.fixture();

select is(
  tests.run(caller, format(
    $$select public.report_unsent(%L, 'sale', 'The drawer is closed.', now(), '{"total": 45}', 'A1B2')$$,
    md5(caller)::uuid
  )),
  'ok 1',
  caller || ' reports a sale the server refused'
)
from unnest(array['sales', 'special', 'owner']) as caller;

select is(
  (
    select count(*) from public.audit_logs
    where action = 'outbox.rejected' and actor_id = tests.uid('sales') and branch_id = 'tmain'
      and device_tag = 'A1B2' and target_type = 'sale' and target_id = md5('sales')::uuid::text
      and reason = 'The drawer is closed.' and after -> 'entry' ->> 'total' = '45'
      and after ? 'madeAt' and after ->> 'kind' = 'sale'
  ),
  1::bigint,
  'the report keeps who, which device, why, when it was made and what was entered'
);

select is(
  tests.run('sales', format(
    $$select public.report_unsent(%L, 'sale', 'Again.', now(), '{}')$$, md5('sales')::uuid
  )),
  'ok 1',
  'sending the same report again is not an error'
);

select is(
  (select count(*) from public.audit_logs where target_id = md5('sales')::uuid::text),
  1::bigint,
  'and the item is logged once'
);

select is(
  tests.run(caller, format(
    $$select public.report_unsent(%L, 'sale', 'x', now(), '{}')$$, gen_random_uuid()
  )),
  '42501',
  caller || ' cannot report'
)
from unnest(tests.no_access()) as caller;

select is(
  tests.run('sales', format('select public.report_unsent(%L, %L, %L, %L, %L::jsonb)',
    gen_random_uuid(), kind, error, made_at, payload)),
  '22023',
  'report_unsent refuses ' || label
)
from (
  values
    ('refund', 'x', now(), '{}', 'an unknown kind'),
    ('sale', '', now(), '{}', 'an empty reason'),
    ('sale', repeat('x', 201), now(), '{}', 'a reason over 200 characters'),
    ('sale', 'x', now() + interval '2 days', '{}', 'a time far in the future'),
    ('sale', 'x', now(), '[1]', 'an entry that is not an object'),
    ('sale', 'x', now(),
      jsonb_build_object('note', repeat('x', 20001))::text, 'an entry over 20 KB')
) as bad(kind, error, made_at, payload, label);

select is(
  tests.run('sales', format(
    $$select public.report_unsent(%L, 'sale', 'x', now(), '{}', 'a1b2')$$, gen_random_uuid()
  )),
  '22023',
  'report_unsent rejects a bad device tag'
);

select * from finish();
rollback;
