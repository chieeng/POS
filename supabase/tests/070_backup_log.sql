-- backup_log (SYS-04): written only by the Backup workflow over the database connection;
-- read by an Owner with the second step; no API role can write, change or remove a row.
begin;
select * from no_plan();
select tests.fixture();

insert into public.backup_log (kind, file_name, size_bytes, sha256, run_url, expires_at)
values (
  'manual', 'pos-prod-2026-10-17-0930.tar.gz.age', 16377, repeat('a', 64),
  'https://github.com/chieeng/POS/actions/runs/1', now() + interval '1 day'
);

select is(
  tests.rows(caller, 'select * from public.backup_log'),
  1::bigint,
  caller || ' sees the last backups'
)
from unnest(array['owner', 'other_owner']) as caller;

select is(
  tests.rows(caller, 'select * from public.backup_log'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' sees no backup'
)
from unnest(tests.no_access() || array['sales', 'special']) as caller;

select is(
  tests.run(
    caller,
    $$insert into public.backup_log (kind, file_name, size_bytes, sha256, run_url, expires_at)
      values ('manual', 'pos-prod-2026-10-18.tar.gz.age', 1, repeat('b', 64),
              'https://github.com/x/y/actions/runs/2', now())$$
  ),
  '42501',
  caller || ' cannot record a backup'
)
from unnest(tests.everyone() || array['service']) as caller;

select is(
  tests.run(caller, $$update public.backup_log set kind = 'nightly'$$),
  '42501',
  caller || ' cannot change a backup entry'
)
from unnest(tests.everyone() || array['service']) as caller;

select is(
  tests.run(caller, 'delete from public.backup_log'),
  '42501',
  caller || ' cannot remove a backup entry'
)
from unnest(tests.everyone() || array['service']) as caller;

select throws_ok(
  $$insert into public.backup_log (kind, file_name, size_bytes, sha256, run_url, expires_at)
    values ('weekly', 'pos-prod-2026-10-18.tar.gz.age', 1, repeat('b', 64),
            'https://github.com/x/y/actions/runs/2', now())$$,
  '23514',
  null,
  'only manual and nightly backups exist'
);

select throws_ok(
  $$insert into public.backup_log (kind, file_name, size_bytes, sha256, run_url, expires_at)
    values ('manual', 'data.sql', 1, repeat('b', 64), 'https://github.com/x/y/actions/runs/2', now())$$,
  '23514',
  null,
  'the file name must be an encrypted backup''s'
);

select * from finish();
rollback;
