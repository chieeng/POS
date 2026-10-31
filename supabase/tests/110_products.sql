-- Products and price history (SRS 3.2, PROD-01..05): add by the Owner and Special Sales; edit by
-- the Owner only; SKUs unique per branch whatever their case; every price logged.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name, active)
values
  ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks', true),
  ('00000000-0000-4000-8000-0000000000c2', 'tmain', 'Drinks', true),
  ('00000000-0000-4000-8000-0000000000c3', 'tmain', 'Old stock', false),
  ('00000000-0000-4000-8000-0000000000c9', 'tother', 'Elsewhere', true);

create function pg_temp.product(p_fields jsonb) returns text language sql as $$
  select format('select public.create_product(%L, %L)', p_fields, 'A1B2');
$$;
create function pg_temp.product_id(p_sku text) returns uuid language sql as $$
  select id from public.products where branch_id = 'tmain' and sku = p_sku;
$$;
grant execute on function pg_temp.product(jsonb), pg_temp.product_id(text) to authenticated;

-- ---- Who adds a product ----------------------------------------------------------------------
select is(
  tests.message(
    'special',
    pg_temp.product(
      '{"sku": " ck-12 ", "name": " Chips Classic ", "category_id": "00000000-0000-4000-8000-0000000000c1",
        "unit": "pack", "sell_price": 45, "reorder_level": 10}'
    )
  ),
  'ok',
  'Special Sales adds a product'
);
select is(
  (
    select concat_ws(' | ', sku, name, unit, sell_price, stock_qty, reorder_level, active)
    from public.products where branch_id = 'tmain'
  ),
  'CK-12 | Chips Classic | pack | 45.00 | 0 | 10 | t',
  'the SKU is saved in capitals, the name trimmed; stock starts at 0'
);
select is(
  (
    select concat_ws(' | ', coalesce(old_price::text, 'none'), new_price, source, device_tag,
      changed_by = tests.uid('special'))
    from public.price_changes
  ),
  'none | 45.00 | created | A1B2 | t',
  'the first price is in the price history'
);
select is(
  (select after ->> 'sku' from public.audit_logs where action = 'product.create'),
  'CK-12',
  'adding a product is audit-logged'
);
select is(
  tests.message(
    'owner',
    pg_temp.product('{"sku": "WATER-500", "name": "Water 500 ml", "category_id": "00000000-0000-4000-8000-0000000000c2", "sell_price": 15}')
  ),
  'ok',
  'the Owner adds a product; the unit defaults to pc'
);
select is(
  (select unit from public.products where sku = 'WATER-500'),
  'pc',
  'pc is the default unit'
);
select is(
  tests.run(caller, pg_temp.product('{"sku": "X1", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1}')),
  '42501',
  caller || ' cannot add a product'
)
from unnest(tests.no_access() || array['sales']) as caller;

-- ---- SKUs and other checks -----------------------------------------------------------------------
select is(
  tests.message('owner', pg_temp.product(format('{"sku": %s, "name": "Copy", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1}', to_json(sku))::jsonb)),
  'sku_taken',
  'refused, same SKU: ' || sku
)
from unnest(array['CK-12', 'ck-12', ' Ck-12 ']) as sku;
select is(
  tests.message('owner', pg_temp.product(fields::jsonb)),
  'invalid_input',
  'refused: ' || fields
)
from unnest(array[
  '{"sku": "", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1}',
  '{"sku": "CK 12", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1}',
  '{"sku": "ABCDEFGHIJKLMNOPQRSTU", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1}',
  '{"sku": "X2", "name": "", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1}',
  '{"sku": "X2", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 0}',
  '{"sku": "X2", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1000001}',
  '{"sku": "X2", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": "free"}',
  '{"sku": "X2", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1, "unit": "kg"}',
  '{"sku": "X2", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1, "reorder_level": -1}',
  '{"sku": "X2", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c1", "sell_price": 1, "stock_qty": 99}',
  '{"sku": "X2", "name": "X", "category_id": "not-a-uuid", "sell_price": 1}'
]) as fields;
select is(
  tests.message('owner', pg_temp.product('{"sku": "X3", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c3", "sell_price": 1}')),
  'category_inactive',
  'an inactive category cannot be chosen for a new product'
);
select is(
  tests.message('owner', pg_temp.product('{"sku": "X4", "name": "X", "category_id": "00000000-0000-4000-8000-0000000000c9", "sell_price": 1}')),
  'not_found',
  'another branch''s category cannot be used'
);

-- ---- Reading -------------------------------------------------------------------------------------
select is(
  tests.rows(caller, 'select * from public.products'),
  2::bigint,
  caller || ' reads the branch''s products'
)
from unnest(array['owner', 'special', 'sales']) as caller;
select is(
  tests.rows(caller, 'select * from public.products'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no product'
)
from unnest(tests.no_access() || array['other_owner']) as caller;
select is(
  tests.rows(caller, 'select * from public.price_changes'),
  2::bigint,
  caller || ' reads the price history'
)
from unnest(array['owner', 'special']) as caller;
select is(
  tests.rows(caller, 'select * from public.price_changes'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no price history'
)
from unnest(tests.no_access() || array['sales']) as caller;

-- ---- Editing: the Owner only ---------------------------------------------------------------------
select is(
  tests.message(caller, format('select public.update_product(%L, %L)', pg_temp.product_id('CK-12'), '{"sell_price": 1}')),
  'This account has no access.',
  caller || ' cannot edit a product'
)
from unnest(array['special', 'sales', 'owner_aal1']) as caller;
select is(
  (select sell_price from public.products where sku = 'CK-12'),
  45.00::numeric,
  'and the price is unchanged'
);

select is(
  tests.message(
    'owner',
    format(
      'select public.update_product(%L, %L, %L)', pg_temp.product_id('CK-12'),
      '{"sell_price": 48.5, "name": "Chips Classic 60 g", "reorder_level": 12}', 'A1B2'
    )
  ),
  'ok',
  'the Owner changes the price, name and reorder level'
);
select is(
  (
    select concat_ws(' | ', old_price, new_price, source, changed_by = tests.uid('owner'),
      changed_by_name = (select display_name from public.profiles where id = tests.uid('owner')))
    from public.price_changes where source = 'owner_edit'
  ),
  '45.00 | 48.50 | owner_edit | t | t',
  'the new price is in the price history with the old one'
);
select is(
  (
    select (before ->> 'sell_price') || ' -> ' || (after ->> 'sell_price') || ', '
      || (before ->> 'name') || ' -> ' || (after ->> 'name') || ' (' || (before ->> 'label') || ')'
    from public.audit_logs where action = 'product.update'
  ),
  '45.00 -> 48.50, Chips Classic -> Chips Classic 60 g (Chips Classic)',
  'the edit is audit-logged with old and new values'
);
select is(
  tests.message('owner', format('select public.update_product(%L, %L)', pg_temp.product_id('CK-12'), '{"name": "Chips Classic 60 g"}')),
  'ok',
  'saving without a change is fine'
);
select is(
  (select count(*) from public.price_changes where product_id = pg_temp.product_id('CK-12')),
  2::bigint,
  'and logs no price'
);
select is(
  tests.message('owner', format('select public.update_product(%L, %L)', pg_temp.product_id('CK-12'), '{"sku": "water-500"}')),
  'sku_taken',
  'an edit cannot take another product''s SKU'
);
select is(
  tests.message('owner', format('select public.update_product(%L, %L)', pg_temp.product_id('CK-12'), changes)),
  'invalid_input',
  'refused: ' || changes
)
from unnest(array['{}', '{"stock_qty": 100}', '{"branch_id": "tother"}', '{"active": "no"}', '{"sell_price": 0}', '{"unit": "kg"}']) as changes;
select is(
  tests.message('owner', format('select public.update_product(%L, %L)', pg_temp.product_id('CK-12'), '{"category_id": "00000000-0000-4000-8000-0000000000c3"}')),
  'category_inactive',
  'a product cannot be moved into an inactive category'
);
select is(
  tests.message('other_owner', format('select public.update_product(%L, %L)', pg_temp.product_id('CK-12'), '{"active": false}')),
  'not_found',
  'an Owner cannot edit another branch''s product'
);

-- ---- Categories with products --------------------------------------------------------------------
select is(
  tests.message('owner', $$select public.update_category('00000000-0000-4000-8000-0000000000c1', '{"active": false}')$$),
  'category_in_use',
  'a category with active products cannot be deactivated'
);
select is(
  tests.run('owner', $$select public.update_category('00000000-0000-4000-8000-0000000000c1', '{"active": false}')$$),
  '23503',
  'with its own error code'
);
create function pg_temp.detail(p_statement text) returns text language plpgsql as $$
declare v text;
begin
  perform tests.as('owner');
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics v = pg_exception_detail;
  end;
  perform tests.as_admin();
  return v;
end;
$$;
select is(
  pg_temp.detail($$select public.update_category('00000000-0000-4000-8000-0000000000c1', '{"active": false}')$$),
  '1',
  'the error says how many active products are in it'
);
select is(
  tests.message('owner', format('select public.update_product(%L, %L)', pg_temp.product_id('CK-12'), '{"active": false}')),
  'ok',
  'the Owner deactivates the product'
);
select is(
  tests.message('owner', $$select public.update_category('00000000-0000-4000-8000-0000000000c1', '{"active": false}')$$),
  'ok',
  'then the category can be deactivated'
);
select is(
  (select category_id from public.products where sku = 'CK-12'),
  '00000000-0000-4000-8000-0000000000c1'::uuid,
  'the product keeps its now inactive category'
);
select is(
  tests.message('owner', format('select public.update_product(%L, %L)', pg_temp.product_id('CK-12'), '{"active": true, "reorder_level": 5}')),
  'ok',
  'and can still be edited in it'
);

-- ---- No direct writes ----------------------------------------------------------------------------
select is(
  tests.run(caller, statement),
  '42501',
  caller || ': ' || statement
)
from unnest(tests.everyone()) as caller
cross join unnest(array[
  $$insert into public.products (branch_id, sku, name, category_id, sell_price) values ('tmain', 'D1', 'Direct', '00000000-0000-4000-8000-0000000000c2', 1)$$,
  'update public.products set stock_qty = 1000',
  'update public.products set sell_price = 0.01',
  'delete from public.products',
  'delete from public.price_changes',
  'update public.price_changes set new_price = 1'
]) as statement;

select * from finish();
rollback;
