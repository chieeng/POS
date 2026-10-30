-- heartbeat() (SRS 2, 7.1): the one function anon may call. It answers with the database
-- clock, reads no table and cannot change anything.
begin;
select * from no_plan();
select tests.fixture();

select is(
  tests.run('anon', 'select public.heartbeat()'),
  'ok 1',
  'anon can call heartbeat() with the publishable key'
);

select tests.as('anon');
select ok(
  public.heartbeat() between now() - interval '5 seconds' and clock_timestamp(),
  'heartbeat() answers with the database clock'
);
select tests.as_admin();

select is(
  (
    select array[p.provolatile::text, p.prosecdef::text, array_to_string(p.proconfig, ',')]
    from pg_proc p
    where p.oid = 'public.heartbeat()'::regprocedure
  ),
  array['s', 'false', 'search_path=""'],
  'heartbeat() is stable, runs with the caller''s rights and has a fixed search_path'
);

select is(
  (select btrim(p.prosrc) from pg_proc p where p.oid = 'public.heartbeat()'::regprocedure),
  'select now();',
  'heartbeat() reads only the clock, no table'
);

-- Why stable is enough to make it read-only: Postgres refuses a write in a stable SQL function.
create function pg_temp.stable_write() returns void language sql stable
as $$ update public.branches set name = name; $$;
select throws_ok(
  'select pg_temp.stable_write()',
  '0A000',
  null,
  'a stable function cannot write'
);

select is(
  has_function_privilege('authenticated', 'public.heartbeat()', 'execute'),
  false,
  'signed-in users have no use for heartbeat() and are not granted it'
);

select * from finish();
rollback;
