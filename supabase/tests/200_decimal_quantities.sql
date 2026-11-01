-- Decimal quantities (the Owner's decision of Nov 1, 2026): kg and L hold up to 3 decimals,
-- every other unit stays whole, through stock-in, adjustments, corrections and approvals.
begin;
select * from no_plan();
select tests.fixture();

select tests.as_admin();
create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-00000000dec1', 'tmain', 'Decimal tests');

select tests.as('owner');
insert into ids select 'rice', public.create_product(jsonb_build_object(
  'sku', 'RICE-1', 'name', 'Rice loose', 'category_id', '00000000-0000-4000-8000-00000000dec1',
  'unit', 'kg', 'sell_price', 62.5, 'reorder_level', 2.5
));
insert into ids select 'soap', public.create_product(jsonb_build_object(
  'sku', 'SOAP-1', 'name', 'Soap bar', 'category_id', '00000000-0000-4000-8000-00000000dec1',
  'sell_price', 38
));
select tests.as_admin();

select is(
  (select array[sold_by_measure::text, reorder_level::text] from public.products p
   join ids on ids.id = p.id where ids.name = 'rice'),
  array['true', '2.5'],
  'a kg product is sold by measure and can have a part-unit reorder level'
);
select is(
  (select sold_by_measure from public.products p join ids on ids.id = p.id where ids.name = 'soap'),
  false,
  'a pc product stays whole'
);
select is(
  tests.message('owner', format(
    $$select public.create_product(%L::jsonb)$$,
    jsonb_build_object('sku', 'SOAP-2', 'name', 'Soap two',
      'category_id', '00000000-0000-4000-8000-00000000dec1', 'sell_price', 38, 'reorder_level', 1.5)
  )),
  'invalid_input',
  'a whole-unit product refuses a part-unit reorder level'
);

-- ---- Stock-in ----------------------------------------------------------------------------
select is(
  tests.run('owner', format(
    $$select public.record_stock_in(null, 'D1', %L::jsonb)$$,
    jsonb_build_array(jsonb_build_object(
      'product_id', (select id from ids where name = 'rice'), 'qty', 12.5, 'unit_cost', 40))
  )),
  'ok 1',
  'a kg product takes in 12.5'
);
select is(
  (select stock_qty from public.products p join ids on ids.id = p.id where ids.name = 'rice'),
  12.5,
  'and holds exactly 12.5'
);
select is(
  (select array[m.qty_change::text, m.stock_after::text] from public.stock_movements m
   join ids on ids.id = m.product_id where ids.name = 'rice'),
  array['12.5', '12.5'],
  'the movement keeps the decimals (INV-01)'
);
select is(
  tests.run('owner', format(
    $$select public.record_stock_in(null, 'D2', %L::jsonb)$$,
    jsonb_build_array(jsonb_build_object(
      'product_id', (select id from ids where name = 'rice'), 'qty', 2.5, 'unit_cost', 46))
  )),
  'ok 1',
  'a second delivery of 2.5 at 46'
);
select is(
  (select c.cost_price from public.product_costs c join ids on ids.id = c.product_id
   where ids.name = 'rice'),
  41.0000,
  'the average cost is weighted by the decimals: (12.5 x 40 + 2.5 x 46) / 15 = 41'
);
select is(
  tests.message('owner', format(
    $$select public.record_stock_in(null, 'D3', %L::jsonb)$$,
    jsonb_build_array(jsonb_build_object(
      'product_id', (select id from ids where name = 'rice'), 'qty', 1.0005, 'unit_cost', 40))
  )),
  'invalid_input',
  'more than 3 decimals is refused, not rounded'
);
select is(
  tests.message('owner', format(
    $$select public.record_stock_in(null, 'D4', %L::jsonb)$$,
    jsonb_build_array(jsonb_build_object(
      'product_id', (select id from ids where name = 'soap'), 'qty', 1.5, 'unit_cost', 20))
  )),
  'invalid_input',
  'a whole-unit product refuses 1.5 on a stock-in'
);
select is(
  (select count(*) from public.stock_receipts r where r.reference in ('D3', 'D4')),
  0::bigint,
  'a refused stock-in leaves nothing behind'
);

-- ---- Adjustments -------------------------------------------------------------------------
select is(
  tests.run('owner', format(
    $$select public.adjust_stock(%L, 'damage', -0.25, 'Spilled')$$,
    (select id from ids where name = 'rice')
  )),
  'ok 1',
  'the Owner adjusts a kg product by -0.25'
);
select is(
  (select stock_qty from public.products p join ids on ids.id = p.id where ids.name = 'rice'),
  14.75,
  'stock follows exactly'
);
select is(
  tests.message('owner', format(
    $$select public.adjust_stock(%L, 'damage', -15, 'Too much')$$,
    (select id from ids where name = 'rice')
  )),
  'stock_negative',
  'an adjustment still can''t go below zero'
);
select is(
  tests.message('owner', format(
    $$select public.adjust_stock(%L, 'found', 0.5, 'Half a bar')$$,
    (select id from ids where name = 'soap')
  )),
  'invalid_input',
  'a whole-unit product refuses a part-unit adjustment'
);

-- ---- Through an approval -----------------------------------------------------------------
select is(
  tests.run('special', format(
    $$select public.request_stock_adjustment(%L, 'loss', -0.75, 'Weighed short')$$,
    (select id from ids where name = 'rice')
  )),
  'ok 1',
  'Special Sales requests a part-unit adjustment'
);
select is(
  tests.message('special', format(
    $$select public.request_stock_adjustment(%L, 'found', 0.5, 'Half a bar')$$,
    (select id from ids where name = 'soap')
  )),
  'invalid_input',
  'and can''t request a part unit of a whole-unit product'
);
select is(
  tests.run('owner', format(
    $$select public.decide_approval(%L, true)$$,
    (select id from public.approval_requests where type = 'stock_adjustment' and branch_id = 'tmain')
  )),
  'ok 1',
  'the Owner approves it'
);
select is(
  (select stock_qty from public.products p join ids on ids.id = p.id where ids.name = 'rice'),
  14.00,
  'the approved quantity applies with its decimals'
);

-- ---- Corrections -------------------------------------------------------------------------
select is(
  tests.run('owner', format(
    $$select public.correct_stock_in(%L, null, 'D2', %L::jsonb, false, 'Weighed again')$$,
    (select id from public.stock_receipts where reference = 'D2' and branch_id = 'tmain'),
    jsonb_build_array(jsonb_build_object(
      'product_id', (select id from ids where name = 'rice'), 'qty', 2.25, 'unit_cost', 46))
  )),
  'ok 1',
  'a stock-in is corrected from 2.5 to 2.25'
);
select is(
  (select stock_qty from public.products p join ids on ids.id = p.id where ids.name = 'rice'),
  13.75,
  'stock moves by the difference'
);

-- ---- Changing the unit -------------------------------------------------------------------
select is(
  tests.message('owner', format(
    $$select public.update_product(%L, '{"unit": "pack"}'::jsonb)$$,
    (select id from ids where name = 'rice')
  )),
  'stock_fractional',
  'a product holding a part unit can''t stop being sold by measure'
);
select is(
  tests.run('owner', format(
    $$select public.update_product(%L, '{"unit": "L"}'::jsonb)$$,
    (select id from ids where name = 'rice')
  )),
  'ok 1',
  'it can move from kg to L'
);
select is(
  tests.run('owner', format(
    $$select public.update_product(%L, '{"unit": "kg"}'::jsonb)$$,
    (select id from ids where name = 'soap')
  )),
  'ok 1',
  'a whole-unit product can start being sold by measure'
);
select is(
  (select sold_by_measure from public.products p join ids on ids.id = p.id where ids.name = 'soap'),
  true,
  'and the option follows its unit'
);

-- ---- History -----------------------------------------------------------------------------
select tests.as('owner');
select is(
  (select h.stock_after from public.product_stock_history((select id from ids where name = 'rice')) h
   limit 1),
  13.75,
  'the stock history reads the decimals'
);
select tests.as_admin();

select * from finish();
rollback;
