-- Stock adjustments and stock-in corrections (SRS 3.5: INV-04, INV-08), directly by the Owner and
-- through approval requests by Special Sales.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks');
insert into public.suppliers (id, branch_id, name, active)
values
  ('00000000-0000-4000-8000-0000000000e1', 'tmain', 'ABC Trading', true),
  ('00000000-0000-4000-8000-0000000000e2', 'tmain', 'Old Supplier', false),
  ('00000000-0000-4000-8000-0000000000e3', 'tmain', 'XYZ Foods', true);
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'WATER-500', 'Water 500 ml', '00000000-0000-4000-8000-0000000000c1', 'pc', 15);

create function pg_temp.pid(p text) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000000' || p)::uuid;
$$;
create function pg_temp.stock(p_product text) returns text language sql as $$
  select p.stock_qty || ' @ ' || coalesce(round(c.cost_price, 2)::text, 'none')
  from public.products p left join public.product_costs c on c.product_id = p.id
  where p.id = pg_temp.pid(p_product);
$$;
create function pg_temp.receive(p_caller text, p_lines text, p_reference text default 'DR 1')
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as(p_caller);
  v := public.record_stock_in('00000000-0000-4000-8000-0000000000e1', p_reference, p_lines::jsonb);
  perform tests.as_admin();
  return v;
end;
$$;
create function pg_temp.sell(p_product text, p_qty int) returns void language sql as $$
  -- A stand-in for a sale (build step 9): stock goes down, the cost stays.
  update public.products set stock_qty = stock_qty - p_qty where id = pg_temp.pid(p_product);
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- Adjustments by the Owner ----------------------------------------------------------------
select pg_temp.receive('owner', '[{"product_id": "00000000-0000-4000-8000-0000000000a1", "qty": 10, "unit_cost": 30}]');
select is(pg_temp.stock('a1'), '10 @ 30.00', 'ten packs at ₱30');

select is(
  tests.message('owner', format('select public.adjust_stock(%L, %L, %s, %L, %L)', pg_temp.pid('a1'), 'damage', -2, 'Crushed in delivery', 'A1B2')),
  'ok',
  'the Owner writes off two damaged packs'
);
select is(pg_temp.stock('a1'), '8 @ 30.00', 'stock down by two; the average cost is unchanged');
select is(
  (
    select concat_ws(' | ', a.type, a.qty_change, round(a.unit_cost, 2), a.reason, m.type, m.qty_change, m.stock_after)
    from public.stock_adjustments a join public.stock_movements m on m.ref_id = a.id::text
  ),
  'damage | -2 | 30.00 | Crushed in delivery | adjustment | -2 | 8',
  'kept as an adjustment, valued at the average cost, with its movement'
);
select is(
  (select after ->> 'type' || ' ' || (after ->> 'qty') || ' · ' || reason from public.audit_logs where action = 'stock.adjust'),
  'damage -2 · Crushed in delivery',
  'and audit-logged with the reason'
);
select is(
  tests.message('owner', format('select public.adjust_stock(%L, %L, %s, %L)', pg_temp.pid('a1'), 'found', 3, 'Found in the back room')),
  'ok',
  'found items add to stock'
);
select is(
  tests.message('owner', format('select public.adjust_stock(%L, %L, %s, %L)', pg_temp.pid('a1'), 'store_use', -1, 'Snack for the meeting')),
  'ok',
  'store use takes from stock'
);
select is(pg_temp.stock('a1'), '10 @ 30.00', '8 + 3 - 1');
select is(
  tests.message('owner', format('select public.adjust_stock(%L, %L, %s, %L)', pg_temp.pid('a1'), 'loss', -11, 'Missing')),
  'stock_negative',
  'an adjustment cannot take stock below zero'
);
select is(
  tests.message('owner', format('select public.adjust_stock(%L, %L, %s, %L)', pg_temp.pid('a1'), type, qty, reason)),
  'invalid_input',
  format('refused: %s, %s, %L', type, qty, reason)
)
from (values ('theft', -1, 'x'), ('loss', 0, 'x'), ('loss', -1, ''), ('loss', -1, null)) as t (type, qty, reason);
select is(
  tests.message(caller, format('select public.adjust_stock(%L, %L, %s, %L)', pg_temp.pid('a1'), 'loss', -1, 'x')),
  'This account has no access.',
  caller || ' cannot adjust stock directly'
)
from unnest(array['special', 'sales', 'owner_aal1']) as caller;

-- ---- Correcting a stock-in: the cost rule ---------------------------------------------------
-- Ten received at a mistyped ₱30 (really ₱20); eight already sold; two left.
create temp table r (name text primary key, id uuid);
grant all on r to authenticated;
insert into r select 'typo30', pg_temp.receive('owner', '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 10, "unit_cost": 30}]', 'DR 30');
select pg_temp.sell('a2', 8);
select is(pg_temp.stock('a2'), '2 @ 30.00', 'two left at ₱30');
select is(
  tests.message(
    'owner',
    format(
      'select public.correct_stock_in(%L, %L, %L, %L, false, %L)',
      (select id from r where name = 'typo30'), '00000000-0000-4000-8000-0000000000e1', 'DR 30',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 10, "unit_cost": 20}]', 'Typo'
    )
  ),
  'ok',
  'the Owner corrects the cost to ₱20'
);
select is(pg_temp.stock('a2'), '2 @ 20.00', 'the two left are revalued at ₱20; stock unchanged');
select is(
  (
    select string_agg(concat_ws(' ', type, qty_change, stock_after), ', ' order by id)
    from public.stock_movements where product_id = pg_temp.pid('a2')
  ),
  'stock_in 10 10, stock_in 10 12, stock_in_reversal -10 2',
  'the corrected line is posted, then the original is reversed: never below zero in between'
);
select is(
  (
    select concat_ws(' | ', c.reference, c.corrects_receipt_id = (select id from r where name = 'typo30'),
      c.received_by = tests.uid('owner'), c.corrected_by = tests.uid('owner'), c.is_deletion)
    from public.stock_receipts c where c.corrects_receipt_id is not null
  ),
  'DR 30 | t | t | t | f',
  'the correction is a new stock-in linked to the original, which stays as it was'
);
select is(
  (select count(*) from public.stock_receipt_items where receipt_id = (select id from r where name = 'typo30') and unit_cost = 30),
  1::bigint,
  'the original line is unchanged'
);
select is(
  tests.message(
    'owner',
    format(
      'select public.correct_stock_in(%L, null, null, %L, false)',
      (select id from r where name = 'typo30'),
      '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 10, "unit_cost": 25}]'
    )
  ),
  'receipt_corrected',
  'a stock-in is corrected once; the correction is what can be corrected next'
);

-- The other way round: ₱20 typed, ₱30 real.
update public.products set stock_qty = 0 where id = pg_temp.pid('a2');
insert into r select 'typo20', pg_temp.receive('owner', '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 10, "unit_cost": 20}]', 'DR 20');
select pg_temp.sell('a2', 8);
select is(
  tests.message(
    'owner',
    format(
      'select public.correct_stock_in(%L, %L, %L, %L, false)',
      (select id from r where name = 'typo20'), '00000000-0000-4000-8000-0000000000e1', 'DR 20',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 10, "unit_cost": 30}]'
    )
  ),
  'ok',
  'correcting ₱20 to ₱30'
);
select is(pg_temp.stock('a2'), '2 @ 30.00', 'the two left are revalued at ₱30');

-- Quantity: 12 received, written as 10.
update public.products set stock_qty = 0 where id = pg_temp.pid('a2');
insert into r select 'qty', pg_temp.receive('owner', '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 10, "unit_cost": 10}]', 'DR Q');
select is(
  tests.message(
    'owner',
    format(
      'select public.correct_stock_in(%L, %L, %L, %L, false)',
      (select id from r where name = 'qty'), '00000000-0000-4000-8000-0000000000e3', 'DR Q2',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 12, "unit_cost": 10}]'
    )
  ),
  'ok',
  'correcting the quantity, the supplier and the reference'
);
select is(pg_temp.stock('a2'), '12 @ 10.00', 'twelve on hand at the same cost');

-- Refusals.
insert into r select 'q2', (select id from public.stock_receipts where reference = 'DR Q2');
select is(
  tests.message(
    'owner',
    format('select public.correct_stock_in(%L, %L, %L, %L, false)',
      (select id from r where name = 'q2'), '00000000-0000-4000-8000-0000000000e3', 'DR Q2',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 12, "unit_cost": 10}]')
  ),
  'no_change',
  'a correction must change something'
);
select is(
  tests.message(
    'owner',
    format('select public.correct_stock_in(%L, %L, %L, %L, false)',
      (select id from r where name = 'q2'), '00000000-0000-4000-8000-0000000000e2', 'DR Q2',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 12, "unit_cost": 10}]')
  ),
  'supplier_inactive',
  'a different supplier must be active'
);
select is(
  tests.message(
    'owner',
    format('select public.correct_stock_in(%L, %L, %L, %L, false)',
      (select id from r where name = 'q2'), '00000000-0000-4000-8000-0000000000e3', 'DR Q2', lines)
  ),
  'invalid_input',
  'refused lines: ' || lines
)
from unnest(array[
  '[]',
  '[{"product_id": "00000000-0000-4000-8000-0000000000a1", "qty": 1, "unit_cost": 10}]',
  '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": -1, "unit_cost": 10}]',
  '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 1, "unit_cost": 0}]',
  '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 1, "unit_cost": 10}, {"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 1, "unit_cost": 10}]'
]) as lines;
select pg_temp.sell('a2', 11);
select is(
  tests.message(
    'owner',
    format('select public.correct_stock_in(%L, %L, %L, %L, false)',
      (select id from r where name = 'q2'), '00000000-0000-4000-8000-0000000000e3', 'DR Q2',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 5, "unit_cost": 10}]')
  ),
  'stock_negative',
  'a correction cannot take stock below zero (1 on hand, 7 fewer received)'
);

-- Deleting a stock-in: every quantity to 0.
update public.products set stock_qty = 12 where id = pg_temp.pid('a2');
select is(
  tests.message('owner', format('select public.correct_stock_in(%L, null, null, null, true, %L)', (select id from r where name = 'q2'), 'Entered twice')),
  'ok',
  'the Owner deletes a stock-in'
);
select is(pg_temp.stock('a2'), '0 @ 10.00', 'its quantity is taken back out');
select is(
  (
    select is_deletion and not exists (select 1 from public.stock_receipt_items i where i.receipt_id = c.id)
    from public.stock_receipts c where c.corrects_receipt_id = (select id from r where name = 'q2')
  ),
  true,
  'kept as a deletion with no lines'
);
select is(
  (select after ->> 'deleted' || ' · ' || reason from public.audit_logs where action = 'stock.correct' and (after ->> 'deleted')::boolean),
  'true · Entered twice',
  'audit-logged with the reason'
);

-- ---- Special Sales: requests -------------------------------------------------------------------
insert into r select 'mine', pg_temp.receive('special', '[{"product_id": "00000000-0000-4000-8000-0000000000a1", "qty": 5, "unit_cost": 31}]', 'DR S1');
select is(
  tests.message('special', format('select public.request_stock_adjustment(%L, %L, %s, %L)', pg_temp.pid('a1'), 'expiry', -2, 'Expired 20 Oct')),
  'ok',
  'Special Sales requests an adjustment'
);
select is(pg_temp.stock('a1') like '15 @%', true, 'nothing changes until the Owner decides');
select is(
  tests.message('special', format('select public.request_stock_adjustment(%L, %L, %s, %L)', pg_temp.pid('a1'), 'loss', -9, 'Missing')),
  'request_pending',
  'one pending adjustment per product per requester'
);
select is(
  tests.message('special', format('select public.request_stock_adjustment(%L, %L, %s, %L)', pg_temp.pid('a2'), 'loss', -1, 'x')),
  'stock_negative',
  'a request that would go below zero is refused straight away'
);
select is(
  tests.message('special', format('select public.request_product_change(%L, %L, %L)', pg_temp.pid('a1'), '{"sell_price": 46}', 'Price up')),
  'ok',
  'a product edit can be pending next to the adjustment'
);
select is(
  tests.message(
    'special',
    format('select public.request_stock_in_correction(%L, %L, %L, %L, false, %L)',
      (select id from r where name = 'typo30'), '00000000-0000-4000-8000-0000000000e1', 'DR 30',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a2", "qty": 10, "unit_cost": 21}]', 'Wrong cost')
  ),
  'not_found',
  'Special Sales cannot ask to correct someone else''s stock-in'
);
select is(
  tests.message(
    'special',
    format('select public.request_stock_in_correction(%L, %L, %L, %L, false, %L)',
      (select id from r where name = 'mine'), '00000000-0000-4000-8000-0000000000e1', 'DR S1',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a1", "qty": 6, "unit_cost": 31}]', 'One more pack')
  ),
  'ok',
  'Special Sales asks to correct their own stock-in'
);
select is(
  tests.message(caller, format('select public.request_stock_adjustment(%L, %L, %s, %L)', pg_temp.pid('a1'), 'loss', -1, 'x')),
  'This account has no access.',
  caller || ' cannot make a stock request'
)
from unnest(array['owner', 'sales', 'owner_aal1']) as caller;
select is(
  (select count(*) from public.approval_requests where status = 'pending'),
  3::bigint,
  'three requests wait for the Owner'
);

-- ---- The Owner decides -------------------------------------------------------------------------
select is(
  tests.message('owner', format('select public.decide_approval(%L, true, %L)', (select id from public.approval_requests where type = 'stock_adjustment'), 'OK')),
  'ok',
  'the Owner approves the adjustment'
);
select is(pg_temp.stock('a1') like '13 @%', true, 'it is applied: two packs fewer');
select is(
  (select approval_id is not null and created_by = tests.uid('owner') from public.stock_adjustments where type = 'expiry'),
  true,
  'recorded as approved, by the Owner who applied it'
);
select is(
  (select after ->> 'via' from public.audit_logs where action = 'stock.adjust' and after ->> 'type' = 'expiry'),
  'approval',
  'and the audit log says it came from a request'
);

-- Outdated: the Owner corrects the stock-in directly before deciding the request on it.
select is(
  tests.message(
    'owner',
    format('select public.correct_stock_in(%L, %L, %L, %L, false)',
      (select id from r where name = 'mine'), '00000000-0000-4000-8000-0000000000e1', 'DR S1',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a1", "qty": 5, "unit_cost": 32}]')
  ),
  'ok',
  'the Owner corrects the stock-in directly'
);
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', (select id from public.approval_requests where type = 'stock_in_correction'))),
  'request_outdated',
  'the request on it is outdated and cannot be approved'
);
select is(
  tests.message('owner', format('select public.decide_approval(%L, false, %L)', (select id from public.approval_requests where type = 'stock_in_correction'), 'Done already')),
  'ok',
  'it can be rejected'
);
select is(
  tests.rows('special', 'select * from public.stock_receipts'),
  2::bigint,
  'Special Sales still sees their stock-in and its correction (made by the Owner)'
);

-- An approved correction.
select is(
  tests.message(
    'special',
    format('select public.request_stock_in_correction(%L, %L, %L, %L, false, %L)',
      (select id from public.stock_receipts where corrects_receipt_id = (select id from r where name = 'mine')),
      '00000000-0000-4000-8000-0000000000e1', 'DR S1',
      '[{"product_id": "00000000-0000-4000-8000-0000000000a1", "qty": 6, "unit_cost": 32}]', 'One more pack')
  ),
  'ok',
  'Special Sales asks again, on the corrected stock-in'
);
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', (select id from public.approval_requests where type = 'stock_in_correction' and status = 'pending'))),
  'ok',
  'the Owner approves it'
);
select is(pg_temp.stock('a1') like '14 @%', true, 'one more pack is in stock');

-- ---- Reading -----------------------------------------------------------------------------------
select is(tests.rows('owner', 'select * from public.stock_adjustments'), 4::bigint, 'the Owner reads adjustments');
select is(
  tests.rows(caller, 'select * from public.stock_adjustments'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no adjustment directly'
)
from unnest(array['anon', 'special', 'sales', 'owner_aal1']) as caller;
select is(
  tests.rows('special', format('select * from public.product_stock_history(%L) where type = %L', pg_temp.pid('a1'), 'adjustment')),
  4::bigint,
  'adjustments show in the stock history Special Sales reads'
);

-- ---- No direct writes ----------------------------------------------------------------------------
select is(
  tests.run(caller, statement),
  '42501',
  caller || ': ' || statement
)
from unnest(tests.everyone()) as caller
cross join unnest(array[
  $$insert into public.stock_adjustments (branch_id, product_id, type, qty_change, reason, created_by, created_by_name) values ('tmain', '00000000-0000-4000-8000-0000000000a1', 'found', 100, 'x', gen_random_uuid(), 'x')$$,
  'update public.stock_adjustments set qty_change = 1',
  'delete from public.stock_adjustments',
  'update public.stock_receipts set is_deletion = true'
]) as statement;

select * from finish();
rollback;
