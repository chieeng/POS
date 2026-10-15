-- devices (SYS-02): a user writes only their own rows, column by column; the Owner reads the
-- devices of their branch; records are never deleted from a client.
begin;
select * from no_plan();
select tests.fixture();

-- ---- Registering and refreshing your own device ------------------------------------------
select is(
  tests.run(
    caller,
    format(
      $$insert into public.devices (user_id, device_tag, label)
        values (tests.uid(%L), 'A1B2', 'Android phone · Chrome')$$,
      name
    )
  ),
  'ok 1',
  caller || ' registers their own device'
)
from (values ('sales', 'sales'), ('special', 'special'), ('owner', 'owner')) as t (caller, name);

-- What the app sends on every later session: an upsert of the same row.
select is(
  tests.run(
    caller,
    format(
      $$insert into public.devices (user_id, device_tag, label)
        values (tests.uid(%L), 'A1B2', 'Windows PC · Edge')
        on conflict (user_id, device_tag)
        do update set user_id = excluded.user_id, device_tag = excluded.device_tag,
          label = excluded.label$$,
      name
    )
  ),
  'ok 1',
  caller || ' refreshes their own device'
)
from (values ('sales', 'sales'), ('special', 'special'), ('owner', 'owner')) as t (caller, name);

select is(
  tests.rows(
    caller,
    format(
      $$select * from public.devices
        where user_id = tests.uid(%L) and device_tag = 'A1B2' and label = 'Windows PC · Edge'$$,
      name
    )
  ),
  1::bigint,
  caller || ' reads their own device back'
)
from (values ('sales', 'sales'), ('special', 'special'), ('owner', 'owner')) as t (caller, name);

-- ---- Never for someone else --------------------------------------------------------------
select is(
  tests.run(
    'sales',
    $$insert into public.devices (user_id, device_tag, label) values (tests.uid('special'), 'B2C3', 'x')$$
  ),
  '42501',
  'a user cannot register a device for someone else'
);
select is(
  tests.run(
    'owner',
    $$insert into public.devices (user_id, device_tag, label) values (tests.uid('sales'), 'B2C3', 'x')$$
  ),
  '42501',
  'not even the Owner registers a device for someone else'
);
select is(
  tests.run('special', $$update public.devices set label = 'mine now' where device_tag = 'S1S1'$$),
  'ok 0',
  'a user cannot change someone else''s device: no row is visible to update'
);
select is(
  tests.run(
    'sales',
    $$update public.devices set user_id = tests.uid('special') where device_tag = 'S1S1'$$
  ),
  '42501',
  'a user cannot hand their device row to someone else'
);

-- ---- Column by column (SEC-07) -----------------------------------------------------------
select is(
  tests.run('sales', format($$insert into public.devices (user_id, device_tag, label) values (tests.uid('sales'), %L, 'x')$$, tag)),
  '23514',
  'device tag ' || quote_literal(tag) || ' is rejected'
)
from unnest(array['toolong', 'a1b2', 'A1B', 'A1-B', '']) as tag;

select is(
  tests.run(
    'sales',
    format(
      $$insert into public.devices (user_id, device_tag, label) values (tests.uid('sales'), 'C3D4', %L)$$,
      repeat('x', 61)
    )
  ),
  '23514',
  'a label longer than 60 characters is rejected'
);
select is(
  tests.run(
    'sales',
    $$insert into public.devices (user_id, device_tag, label, last_seen_at)
      values (tests.uid('sales'), 'C3D4', 'x', '2000-01-01')$$
  ),
  '42501',
  'the client cannot choose last_seen_at on insert'
);
select is(
  tests.run('sales', $$update public.devices set last_seen_at = '2000-01-01' where device_tag = 'S1S1'$$),
  '42501',
  'the client cannot change last_seen_at'
);
select is(
  tests.run(
    'sales',
    $$insert into public.devices (user_id, device_tag, label, push_subscription)
      values (tests.uid('sales'), 'C3D4', 'x', '{"endpoint":"https://evil.example"}')$$
  ),
  '42501',
  'the client cannot set a push subscription yet'
);
select is(
  tests.run('sales', $$update public.devices set push_subscription = '{}' where device_tag = 'S1S1'$$),
  '42501',
  'the client cannot change a push subscription yet'
);

update public.devices set last_seen_at = '2000-01-01' where device_tag = 'S1S1';
select is(
  tests.run('sales', $$update public.devices set label = 'Android phone · Chrome' where device_tag = 'S1S1'$$),
  'ok 1',
  'a user refreshes their device'
);
select is(
  (select last_seen_at = now() from public.devices where device_tag = 'S1S1'),
  true,
  'last_seen_at is stamped by the server on every write'
);

-- ---- Accounts without access -------------------------------------------------------------
select is(
  tests.run(
    caller,
    format(
      $$insert into public.devices (user_id, device_tag, label) values (tests.uid(%L), 'D4E5', 'x')$$,
      name
    )
  ),
  '42501',
  caller || ' cannot register a device, not even their own'
)
from (
  values
    ('anon', 'sales'),
    ('no_profile', 'nobody'),
    ('deactivated', 'former'),
    ('signed_out', 'gone'),
    ('owner_aal1', 'owner')
) as t (caller, name);

select is(
  tests.rows(caller, 'select * from public.devices'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no device'
)
from unnest(tests.no_access()) as caller;

-- ---- Never deleted from a client ---------------------------------------------------------
select is(
  tests.run(caller, $$delete from public.devices where device_tag = 'S1S1'$$),
  '42501',
  caller || ' cannot delete a device record'
)
from unnest(tests.everyone()) as caller;

-- ---- Reading -----------------------------------------------------------------------------
select is(
  tests.rows('sales', $$select * from public.devices where device_tag = 'S1S1'$$),
  1::bigint,
  'a user reads their own device'
);
select is(
  tests.rows('special', $$select * from public.devices where user_id <> tests.uid('special')$$),
  0::bigint,
  'staff cannot read the devices of others'
);
select is(
  tests.rows('sales', $$select * from public.devices where user_id <> tests.uid('sales')$$),
  0::bigint,
  'sales cannot list devices across users'
);
select is(
  tests.rows('owner', $$select * from public.devices where device_tag = 'S1S1'$$),
  1::bigint,
  'the Owner reads a device of their branch'
);
select is(
  tests.rows('owner', 'select * from public.devices'),
  4::bigint,
  'the Owner lists every device of their branch'
);
select is(
  tests.rows('owner', $$select * from public.devices where device_tag = 'S9S9'$$),
  0::bigint,
  'the Owner reads no device of another branch'
);
select is(
  tests.rows('other_owner', 'select * from public.devices'),
  1::bigint,
  'an Owner of another branch sees only their own branch''s devices'
);

select * from finish();
rollback;
