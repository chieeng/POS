-- Categories and suppliers (SRS 3.2, 6.1; PROD-03): add by the Owner and Special Sales; change
-- by the Owner only; names unique per branch whatever their case; every change audit-logged.
begin;
select * from no_plan();
select tests.fixture();

-- ---- Who adds a category ---------------------------------------------------------------------
select is(
  tests.message(caller, format('select public.create_category(%L)', 'Snacks of ' || caller)),
  'ok',
  caller || ' adds a category'
)
from unnest(array['owner', 'special']) as caller;

select is(
  tests.run(caller, $$select public.create_category('Hacked')$$),
  '42501',
  caller || ' cannot add a category'
)
from unnest(tests.no_access() || array['sales']) as caller;

-- ---- Names: trimmed, unique per branch whatever their case ------------------------------------
select is(
  tests.message('special', $$select public.create_category('  Drinks  ', 'A1B2')$$),
  'ok',
  'a name is saved trimmed'
);
select is(
  (select count(*) from public.categories where branch_id = 'tmain' and name = 'Drinks'),
  1::bigint,
  'as "Drinks", in the caller''s own branch'
);
select is(
  (
    select actor_id = tests.uid('special') and device_tag = 'A1B2'
    from public.audit_logs where action = 'category.create' and after ->> 'name' = 'Drinks'
  ),
  true,
  'adding a category is audit-logged with who, the device and the name'
);
select is(
  tests.message(caller, format('select public.create_category(%L)', name)),
  'name_taken',
  caller || ' cannot add ' || quote_literal(name) || ' next to "Drinks"'
)
from unnest(array['owner', 'special']) as caller
cross join unnest(array['Drinks', 'drinks', ' DRINKS ']) as name;
select is(
  tests.message('other_owner', $$select public.create_category('Drinks')$$),
  'ok',
  'another branch may use the same name'
);
select is(
  tests.message('owner', format('select public.create_category(%L)', name)),
  'invalid_input',
  'refused: ' || quote_literal(name)
)
from unnest(array['', '   ', repeat('x', 61)]) as name;
select is(
  tests.message('owner', 'select public.create_category(null)'),
  'invalid_input',
  'refused: no name'
);

-- ---- Reading -----------------------------------------------------------------------------------
select is(
  tests.rows(caller, 'select * from public.categories'),
  3::bigint,
  caller || ' reads the branch''s categories'
)
from unnest(array['owner', 'special', 'sales']) as caller;
select is(
  tests.rows('other_owner', $$select * from public.categories where branch_id = 'tmain'$$),
  0::bigint,
  'an Owner of another branch reads none of them'
);
select is(
  tests.rows(caller, 'select * from public.categories'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no category'
)
from unnest(tests.no_access()) as caller;

-- ---- Changing a category: the Owner only -------------------------------------------------------
create function pg_temp.category_id(p_name text) returns uuid language sql as $$
  select id from public.categories where branch_id = 'tmain' and name = p_name;
$$;
grant execute on function pg_temp.category_id(text) to authenticated;

select is(
  tests.message(
    caller,
    format(
      'select public.update_category(%L, %L)',
      pg_temp.category_id('Drinks'), '{"name": "Beverages"}'
    )
  ),
  'This account has no access.',
  caller || ' cannot rename a category'
)
from unnest(array['special', 'sales', 'owner_aal1']) as caller;

select is(
  tests.message(
    'owner',
    format(
      'select public.update_category(%L, %L, %L)',
      pg_temp.category_id('Drinks'), '{"name": " Beverages "}', 'A1B2'
    )
  ),
  'ok',
  'the Owner renames a category'
);
select is(
  (
    select (before ->> 'name') || ' -> ' || (after ->> 'name') || ' (' || (before ->> 'label') || ')'
    from public.audit_logs where action = 'category.update'
  ),
  'Drinks -> Beverages (Drinks)',
  'the rename is audit-logged with the old and new name'
);
select is(
  tests.message(
    'owner',
    format('select public.update_category(%L, %L)', pg_temp.category_id('Beverages'), '{"active": false}')
  ),
  'ok',
  'the Owner deactivates a category'
);
select is(
  (select active from public.categories where branch_id = 'tmain' and name = 'Beverages'),
  false,
  'it is kept, inactive (nothing is ever deleted)'
);
select is(
  tests.message('owner', $$select public.create_category('beverages')$$),
  'name_taken',
  'a deactivated name still counts: reactivate it instead'
);
select is(
  tests.message(
    'owner',
    format('select public.update_category(%L, %L)', pg_temp.category_id('Beverages'), '{"active": true}')
  ),
  'ok',
  'the Owner reactivates it'
);
select is(
  tests.message(
    'owner',
    format('select public.update_category(%L, %L)', pg_temp.category_id('Beverages'), changes)
  ),
  case when changes like '%snacks%' then 'name_taken' else 'invalid_input' end,
  'refused: ' || changes
)
from unnest(array[
  '{}',
  '{"branch_id": "tother"}',
  '{"active": "no"}',
  '{"name": ""}',
  '{"name": "snacks of owner"}'
]) as changes;
select is(
  tests.message('owner', $$select public.update_category(gen_random_uuid(), '{"active": false}')$$),
  'not_found',
  'an unknown category is not found'
);
select is(
  tests.message(
    'other_owner',
    format('select public.update_category(%L, %L)', pg_temp.category_id('Beverages'), '{"active": false}')
  ),
  'not_found',
  'an Owner cannot change another branch''s category'
);

-- ---- Suppliers ---------------------------------------------------------------------------------
select is(
  tests.message(
    caller,
    format('select public.create_supplier(%L)', jsonb_build_object('name', 'Supplier of ' || caller))
  ),
  'ok',
  caller || ' adds a supplier'
)
from unnest(array['owner', 'special']) as caller;
select is(
  tests.run(caller, $$select public.create_supplier('{"name": "Hacked"}')$$),
  '42501',
  caller || ' cannot add a supplier'
)
from unnest(tests.no_access() || array['sales']) as caller;

select is(
  tests.message(
    'special',
    format(
      'select public.create_supplier(%L)',
      '{"name": " ABC Trading ", "contact_person": "Ana", "phone": "0917 123 4567", "address": ""}'
    )
  ),
  'ok',
  'a supplier is saved with its contact details'
);
select is(
  (
    select concat_ws(' | ', name, contact_person, phone, coalesce(address, 'none'))
    from public.suppliers where name = 'ABC Trading'
  ),
  'ABC Trading | Ana | 0917 123 4567 | none',
  'trimmed, with empty fields left empty'
);
select is(
  tests.message('owner', $$select public.create_supplier('{"name": "abc trading"}')$$),
  'name_taken',
  'supplier names are unique per branch whatever their case'
);
select is(
  tests.message('owner', format('select public.create_supplier(%L)', fields)),
  'invalid_input',
  'refused: ' || fields
)
from unnest(array[
  '{}',
  '{"name": ""}',
  '{"name": "X", "active": false}',
  '{"name": "X", "phone": "' || repeat('1', 41) || '"}'
]) as fields;

select is(
  tests.rows(caller, 'select * from public.suppliers'),
  3::bigint,
  caller || ' reads the branch''s suppliers'
)
from unnest(array['owner', 'special']) as caller;
select is(
  tests.rows(caller, 'select * from public.suppliers'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no supplier'
)
from unnest(tests.no_access() || array['sales']) as caller;

create function pg_temp.supplier_id(p_name text) returns uuid language sql as $$
  select id from public.suppliers where branch_id = 'tmain' and name = p_name;
$$;
grant execute on function pg_temp.supplier_id(text) to authenticated;

select is(
  tests.message(
    'special',
    format('select public.update_supplier(%L, %L)', pg_temp.supplier_id('ABC Trading'), '{"phone": "0918"}')
  ),
  'This account has no access.',
  'Special Sales cannot change a supplier'
);
select is(
  tests.message(
    'owner',
    format(
      'select public.update_supplier(%L, %L, %L)',
      pg_temp.supplier_id('ABC Trading'), '{"phone": "0918 765 4321", "active": false}', 'A1B2'
    )
  ),
  'ok',
  'the Owner changes and deactivates a supplier'
);
select is(
  (
    select (before ->> 'phone') || ' -> ' || (after ->> 'phone') || ', active '
      || (before ->> 'active') || ' -> ' || (after ->> 'active') || ' (' || (before ->> 'label') || ')'
    from public.audit_logs where action = 'supplier.update'
  ),
  '0917 123 4567 -> 0918 765 4321, active true -> false (ABC Trading)',
  'the change is audit-logged with old and new values'
);

-- ---- No direct writes --------------------------------------------------------------------------
select is(
  tests.run(caller, statement),
  '42501',
  caller || ': ' || statement
)
from unnest(tests.everyone()) as caller
cross join unnest(array[
  $$insert into public.categories (branch_id, name) values ('tmain', 'Direct')$$,
  'update public.categories set active = false',
  'delete from public.categories',
  $$insert into public.suppliers (branch_id, name) values ('tmain', 'Direct')$$,
  'update public.suppliers set active = false',
  'delete from public.suppliers'
]) as statement;

select * from finish();
rollback;
