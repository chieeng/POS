-- Stock-in, stock movements and weighted-average cost (SRS 3.5: INV-01, INV-02, INV-06, INV-08).
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks');
insert into public.suppliers (id, branch_id, name, active)
values
  ('00000000-0000-4000-8000-0000000000e1', 'tmain', 'ABC Trading', true),
  ('00000000-0000-4000-8000-0000000000e2', 'tmain', 'Old Supplier', false);
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, reorder_level, active)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 10, true),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'WATER-500', 'Water 500 ml', '00000000-0000-4000-8000-0000000000c1', 'pc', 15, 0, true),
  ('00000000-0000-4000-8000-0000000000a3', 'tmain', 'OLD-1', 'Old candy', '00000000-0000-4000-8000-0000000000c1', 'pc', 5, 0, false);

create function pg_temp.stock_in(p_caller text, p_supplier text, p_reference text, p_lines text)
returns text language sql as $$
  select tests.message(
    p_caller,
    format('select public.record_stock_in(%L, %L, %L, %L)', p_supplier, p_reference, p_lines, 'A1B2')
  );
$$;
create function pg_temp.line(p_product text, p_qty numeric, p_cost numeric) returns text language sql as $$
  select format('{"product_id": "00000000-0000-4000-8000-0000000000%s", "qty": %s, "unit_cost": %s}', p_product, p_qty, p_cost);
$$;
create function pg_temp.stock(p_product text) returns text language sql as $$
  select p.stock_qty || ' @ ' || coalesce(round(c.cost_price, 4)::text, 'none')
  from public.products p left join public.product_costs c on c.product_id = p.id
  where p.id = ('00000000-0000-4000-8000-0000000000' || p_product)::uuid;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- Who records a stock-in ------------------------------------------------------------------
select is(
  pg_temp.stock_in(caller, null, null, '[' || pg_temp.line('a1', 1, 30) || ']'),
  'This account has no access.',
  caller || ' cannot record a stock-in'
)
from unnest(array['sales', 'owner_aal1', 'deactivated', 'signed_out', 'no_profile']) as caller;
select is(
  tests.run('anon', $$select public.record_stock_in(null, null, '[]')$$),
  '42501',
  'anon cannot either'
);

-- ---- Opening stock: no supplier, a reference, a cost ---------------------------------------
select is(
  pg_temp.stock_in('owner', null, ' Opening stock ', '[' || pg_temp.line('a1', 10, 30) || ',' || pg_temp.line('a2', 24, 8.5) || ']'),
  'ok',
  'the Owner records opening stock'
);
select is(pg_temp.stock('a1'), '10 @ 30.0000', 'stock and cost set from the first stock-in');
select is(pg_temp.stock('a2'), '24 @ 8.5000', 'every line counts');
select is(
  (select concat_ws(' | ', reference, supplier_id is null, received_by = tests.uid('owner'), device_tag) from public.stock_receipts),
  'Opening stock | t | t | A1B2',
  'the stock-in is kept with its reference, trimmed, and who made it'
);
select is(
  (
    select string_agg(concat_ws(' ', type, qty_change, stock_after, unit_cost, ref_type), ', ' order by product_id)
    from public.stock_movements
  ),
  'stock_in 10 10 30.0000 stock_receipt, stock_in 24 24 8.5000 stock_receipt',
  'each line writes a stock movement (INV-01)'
);
select is(
  (select after ->> 'units' || ' units, ' || (after ->> 'lines') || ' lines' from public.audit_logs where action = 'stock.in'),
  '34 units, 2 lines',
  'the stock-in is audit-logged'
);

-- ---- Weighted average (INV-08) ---------------------------------------------------------------
select is(
  pg_temp.stock_in('special', '00000000-0000-4000-8000-0000000000e1', 'DR 1234', '[' || pg_temp.line('a1', 30, 34) || ']'),
  'ok',
  'Special Sales records a delivery from a supplier'
);
select is(pg_temp.stock('a1'), '40 @ 33.0000', '(10 x 30 + 30 x 34) / 40 = 33');
update public.products set stock_qty = 0 where sku = 'WATER-500';
select is(pg_temp.stock_in('owner', null, 'x', '[' || pg_temp.line('a2', 12, 9) || ']'), 'ok', 'a delivery when none is on hand');
select is(pg_temp.stock('a2'), '12 @ 9.0000', 'with nothing on hand, the delivery''s cost is the cost');
update public.products set stock_qty = -3 where sku = 'WATER-500';
select is(pg_temp.stock_in('owner', null, 'x', '[' || pg_temp.line('a2', 10, 10) || ']'), 'ok', 'a delivery after sales went below zero');
select is(pg_temp.stock('a2'), '7 @ 10.0000', 'stock goes up from -3; the cost is the delivery''s');

-- ---- Refusals ----------------------------------------------------------------------------------
select is(
  pg_temp.stock_in('owner', null, null, '[' || pg_temp.line('a1', 1, 30) || ',' || pg_temp.line('a2', 1, 9) || ',' || pg_temp.line('a1', 2, 30) || ']'),
  'duplicate_product',
  'a product can be on one line only'
);
select is(
  pg_temp.stock_in('owner', null, null, '[' || pg_temp.line('a3', 1, 5) || ']'),
  'product_inactive',
  'an inactive product cannot be stocked in'
);
select is(
  pg_temp.stock_in('owner', '00000000-0000-4000-8000-0000000000e2', null, '[' || pg_temp.line('a1', 1, 30) || ']'),
  'supplier_inactive',
  'an inactive supplier cannot be chosen'
);
select is(
  pg_temp.stock_in('owner', null, null, lines),
  'invalid_input',
  'refused: ' || lines
)
from unnest(array[
  '[]',
  '{}',
  '[' || pg_temp.line('a1', 0, 30) || ']',
  '[' || pg_temp.line('a1', -5, 30) || ']',
  '[' || pg_temp.line('a1', 1, 0) || ']',
  '[' || pg_temp.line('a1', 1.5, 30) || ']',
  '[{"product_id": "00000000-0000-4000-8000-0000000000a1", "qty": 1}]',
  '[{"product_id": "00000000-0000-4000-8000-0000000000a1", "qty": "1", "unit_cost": 1}]',
  '[{"product_id": "00000000-0000-4000-8000-0000000000a1", "qty": 1, "unit_cost": 1, "stock_qty": 9}]'
]) as lines;
select is(
  pg_temp.stock_in('owner', null, repeat('x', 61), '[' || pg_temp.line('a1', 1, 30) || ']'),
  'invalid_input',
  'a reference is at most 60 characters'
);
select is(
  pg_temp.stock_in('owner', null, null, '[{"product_id": "00000000-0000-4000-8000-000000000999", "qty": 1, "unit_cost": 1}]'),
  'not_found',
  'an unknown product is not found'
);
select is(pg_temp.stock('a1'), '40 @ 33.0000', 'no refused stock-in changed stock or cost');
select is((select count(*) from public.stock_receipts), 4::bigint, 'and no refused stock-in was kept');

-- ---- Who reads what (cost only for the Owner and on one's own stock-ins) ----------------------
select is(tests.rows('owner', 'select * from public.stock_receipts'), 4::bigint, 'the Owner reads every stock-in');
select is(tests.rows('special', 'select * from public.stock_receipts'), 1::bigint, 'Special Sales reads only their own');
select is(
  tests.rows('special', 'select unit_cost from public.stock_receipt_items'),
  1::bigint,
  'with the unit costs they typed'
);
select is(
  tests.rows(caller, 'select * from public.stock_receipts'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no stock-in'
)
from unnest(tests.no_access() || array['sales', 'other_owner']) as caller;
select is(tests.rows('owner', 'select * from public.product_costs'), 2::bigint, 'the Owner reads costs');
select is(
  tests.rows(caller, 'select * from public.product_costs'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no cost'
)
from unnest(array['anon', 'special', 'sales', 'owner_aal1']) as caller;
select is(
  tests.rows(caller, 'select * from public.stock_movements'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no stock movement directly'
)
from unnest(array['anon', 'special', 'sales', 'owner_aal1']) as caller;

-- ---- Stock history (INV-06) --------------------------------------------------------------------
select is(
  tests.rows('owner', $$select * from public.product_stock_history('00000000-0000-4000-8000-0000000000a1')$$),
  2::bigint,
  'the Owner reads a product''s stock history'
);
select is(
  tests.rows('owner', $$select * from public.product_stock_history('00000000-0000-4000-8000-0000000000a1') where unit_cost is not null$$),
  2::bigint,
  'with costs'
);
select is(
  tests.rows('special', $$select * from public.product_stock_history('00000000-0000-4000-8000-0000000000a1') where unit_cost is null and user_name is not null$$),
  2::bigint,
  'Special Sales reads it without costs'
);
select is(
  tests.rows('owner', $$select * from public.product_stock_history('00000000-0000-4000-8000-0000000000a2', p_type => 'stock_in', p_from => now() - interval '1 day', p_limit => 2)$$),
  2::bigint,
  'filtered by type and date, limited'
);
select is(
  tests.run(caller, $$select * from public.product_stock_history('00000000-0000-4000-8000-0000000000a1')$$),
  '42501',
  caller || ' cannot read stock history'
)
from unnest(array['anon', 'sales', 'owner_aal1', 'deactivated']) as caller;

-- ---- Approved product changes are marked in the audit log --------------------------------------
select is(
  tests.message('special', $$select public.request_product_change('00000000-0000-4000-8000-0000000000a1', '{"sell_price": 46}', 'New price')$$),
  'ok',
  'a change request'
);
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', (select id from public.approval_requests))),
  'ok',
  'approved'
);
select is(
  (select before ->> 'via' from public.audit_logs where action = 'product.update'),
  'approval',
  'the product change it applied is marked as an approved request'
);
select is(
  tests.message('owner', $$select public.update_product('00000000-0000-4000-8000-0000000000a1', '{"sell_price": 47}')$$),
  'ok',
  'the Owner''s own edit'
);
select is(
  (select count(*) from public.audit_logs where action = 'product.update' and before ? 'via'),
  1::bigint,
  'is not marked'
);

-- ---- No direct writes ----------------------------------------------------------------------------
select is(
  tests.run(caller, statement),
  '42501',
  caller || ': ' || statement
)
from unnest(tests.everyone()) as caller
cross join unnest(array[
  'update public.products set stock_qty = 999',
  'delete from public.stock_movements',
  'update public.stock_movements set qty_change = 1',
  'delete from public.stock_receipts',
  'update public.stock_receipt_items set unit_cost = 1',
  'update public.product_costs set cost_price = 1'
]) as statement;

select * from finish();
rollback;
