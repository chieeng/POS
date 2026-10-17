-- Store settings (SYS-01, ATT-02): update_branch_settings is the only way to change a branch.
-- The Owner with the second step changes their own branch; every change is audit-logged with
-- old and new values; bad input changes nothing.
begin;
select * from no_plan();
select tests.fixture();

-- ---- Defaults ----------------------------------------------------------------------------
select is(
  (select radius_m || ' ' || coalesce(store_lat::text, 'none') from public.branches where id = 'tmain'),
  '100 none',
  'a new branch has a 100 m radius and no location yet (location check off)'
);

-- ---- Who may change settings -------------------------------------------------------------
select is(
  tests.run(caller, $$select public.update_branch_settings('{"name": "Hacked"}')$$),
  '42501',
  caller || ' cannot change store settings'
)
from unnest(tests.no_access() || array['sales', 'special']) as caller;

select is(
  (select name from public.branches where id = 'tmain'),
  'Test Store',
  'and nothing was changed'
);

-- ---- The Owner changes their own branch ----------------------------------------------------
select is(
  tests.run(
    'owner',
    $$select public.update_branch_settings(
      '{"name": "  Eragon Store ", "address": "12 Rizal St.", "tin": "123-456-789-000",
        "sales_discount_limit": 50, "idle_lock_minutes": 10,
        "store_lat": 14.5995, "store_lng": 120.9842, "radius_m": 150}', 'A1B2')$$
  ),
  'ok 1',
  'the Owner saves store details and the location'
);

select is(
  (
    select concat_ws(' | ', name, address, tin, sales_discount_limit, idle_lock_minutes,
      store_lat, store_lng, radius_m)
    from public.branches where id = 'tmain'
  ),
  'Eragon Store | 12 Rizal St. | 123-456-789-000 | 50.00 | 10 | 14.5995 | 120.9842 | 150',
  'the values are saved, with text trimmed'
);

select is(
  (select name from public.branches where id = 'tother'),
  'Other Store',
  'another branch is never touched'
);

select is(
  (
    select action || ' ' || target_type || ' ' || target_id || ' ' || device_tag || ' '
      || (before ->> 'name') || ' -> ' || (after ->> 'name') || ' radius '
      || (before ->> 'radius_m') || ' -> ' || (after ->> 'radius_m')
    from public.audit_logs where action = 'branch.update'
  ),
  'branch.update branch tmain A1B2 Test Store -> Eragon Store radius 100 -> 150',
  'the change is audit-logged with old and new values'
);

select is(
  (select array_length(array(select jsonb_object_keys(after)), 1)
   from public.audit_logs where action = 'branch.update'),
  8,
  'the audit entry lists only the fields that changed'
);

select is(
  tests.run('owner', $$select public.update_branch_settings('{"radius_m": 150}')$$),
  'ok 1',
  'saving an unchanged value is fine'
);
select is(
  (select count(*) from public.audit_logs where action = 'branch.update'),
  1::bigint,
  'and adds no audit entry'
);

-- Clearing: empty text clears an optional field; null clears the location (check off again).
select is(
  tests.run(
    'owner',
    $$select public.update_branch_settings('{"address": "", "store_lat": null, "store_lng": null}')$$
  ),
  'ok 1',
  'the Owner can clear the address and the location'
);
select is(
  (select coalesce(address, 'none') || ' ' || coalesce(store_lat::text, 'none') from public.branches where id = 'tmain'),
  'none none',
  'both are cleared'
);

-- ---- Bad input changes nothing -------------------------------------------------------------
select is(
  tests.message('owner', format('select public.update_branch_settings(%L)', changes)),
  'invalid_input',
  'refused: ' || changes
)
from unnest(array[
  '{}',
  '[]',
  '{"id": "other"}',
  '{"created_at": "2020-01-01"}',
  '{"name": ""}',
  '{"name": null}',
  '{"radius_m": 5}',
  '{"radius_m": 5000}',
  '{"radius_m": "far"}',
  '{"store_lat": 14.6}',
  '{"store_lat": 91, "store_lng": 120}',
  '{"idle_lock_minutes": 0}',
  '{"sales_discount_limit": -1}',
  '{"tin": "12345"}',
  '{"receipt_footer": "' || repeat('x', 301) || '"}'
]) as changes;

select is(
  (select concat_ws(' | ', name, radius_m, idle_lock_minutes) from public.branches where id = 'tmain'),
  'Eragon Store | 150 | 10',
  'none of the refused changes was applied'
);

select is(
  tests.message('owner', $$select public.update_branch_settings('{"name": "X"}', 'bad')$$),
  'invalid_input',
  'a bad device tag is refused'
);

select * from finish();
rollback;
