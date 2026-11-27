-- The drawer report lists voids, returns and damaged items (SRS SHIFT-04, POS-10): the voided
-- sales of the drawer, the returns whose cash left it, and the GCash/Maya returns of its day.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, stock_qty, active)
values ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 40, true);
insert into public.product_costs (product_id, branch_id, cost_price)
values ('00000000-0000-4000-8000-0000000000a1', 'tmain', 30);

select is(tests.run('sales', $$select public.open_drawer('{"1": 1000}', null, 'A1B2')$$), 'ok 1', 'today''s drawer opens');
create function pg_temp.drawer() returns uuid language sql as $$
  select id from public.drawer_sessions where branch_id = 'tmain' and business_date = private.manila_today();
$$;
create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000009' || lpad(p_n::text, 2, '0'))::uuid;
$$;
-- A sale of p_packs chips by Sales in today's drawer, paid p_cash cash and p_gcash GCash.
create function pg_temp.sale(p_n int, p_packs int, p_cash numeric, p_gcash numeric) returns void language sql as $$
  insert into public.sales (id, branch_id, receipt_no, session_id, salesperson_id, salesperson_name, device_tag, subtotal, total, created_at)
  values (pg_temp.sid(p_n), 'tmain', 'S1-20261121-A1B2-' || p_n, pg_temp.drawer(), tests.uid('sales'), 'Sales', 'A1B2',
    p_packs * 45, p_packs * 45, now());
  insert into public.sale_items (sale_id, line_no, product_id, name, sku, unit, qty, unit_price, unit_cost, line_total)
  values (pg_temp.sid(p_n), 1, '00000000-0000-4000-8000-0000000000a1', 'Chips Classic', 'CK-12', 'pack', p_packs, 45, 30, p_packs * 45);
  insert into public.sale_payments (sale_id, line_no, branch_id, method, amount, reference)
  select pg_temp.sid(p_n), 1, 'tmain', 'cash', p_cash, null where p_cash > 0
  union all
  select pg_temp.sid(p_n), 2, 'tmain', 'gcash', p_gcash, 'GC-' || p_n || '000' where p_gcash > 0;
$$;
create function pg_temp.report() returns jsonb language plpgsql as $$
declare
  v jsonb;
  v_id uuid := pg_temp.drawer();
begin
  perform tests.as('owner');
  v := public.drawer_sales(v_id);
  perform tests.as_admin();
  return v;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

select is(
  (select jsonb_build_object('voids', r -> 'voids', 'returns', r -> 'returns') from pg_temp.report() r),
  '{"voids": [], "returns": []}'::jsonb,
  'a drawer with nothing voided or returned lists none'
);

select pg_temp.sale(1, 1, 45, 0);
select pg_temp.sale(2, 2, 45, 45);
select pg_temp.sale(3, 3, 135, 0);

select is(
  tests.run('owner', format('select public.void_sale(%L, %L, %L)', pg_temp.sid(2), 'Rang up twice', 'GCREF01')),
  'ok 1', 'the Owner voids the split sale');
select is(
  tests.run('owner', format($$select public.return_sale(%L, '[{"lineNo": 1, "qty": 2, "condition": "damaged"}]', 'cash', 'Spoiled')$$, pg_temp.sid(3))),
  'ok 1', 'and takes back 2 damaged chips for cash');
select is(
  tests.run('owner', format($$select public.return_sale(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'cash', 'Changed mind')$$, pg_temp.sid(1))),
  'ok 1', 'and 1 back to stock');

select is(
  (select jsonb_build_object('receipt', v ->> 'receiptNo', 'total', v -> 'total', 'cash', v -> 'cash', 'ewallet', v -> 'ewallet', 'ref', v ->> 'refundReference', 'reason', v ->> 'reason', 'by', v ->> 'by')
   from pg_temp.report() r, jsonb_array_elements(r -> 'voids') v),
  '{"receipt": "S1-20261121-A1B2-2", "total": 90.00, "cash": 45.00, "ewallet": 45.00, "ref": "GCREF01", "reason": "Rang up twice", "by": "Owner"}'::jsonb,
  'the void is listed with what went back and why'
);
select is(
  (select jsonb_agg(jsonb_build_object('receipt', x ->> 'receiptNo', 'refund', x -> 'refund', 'cash', x -> 'cashRefund', 'condition', x #>> '{items,0,condition}', 'cost', x #> '{items,0,unitCost}') order by x ->> 'receiptNo')
   from pg_temp.report() r, jsonb_array_elements(r -> 'returns') x),
  '[{"receipt": "S1-20261121-A1B2-1", "refund": 45.00, "cash": 45.00, "condition": "stock", "cost": 30.0000},
    {"receipt": "S1-20261121-A1B2-3", "refund": 90.00, "cash": 90.00, "condition": "damaged", "cost": 30.0000}]'::jsonb,
  'both returns are listed, with each item''s condition and cost'
);
select is((pg_temp.report() -> 'cashRefunds')::numeric, 135::numeric, 'cash refunds total ₱135');
select is(private.drawer_expected(pg_temp.drawer()), 1045.00::numeric(12, 2),
  'expected: 1,000 + 45 + 135 cash sales (the voided one is out) − 135 refunded');

-- A GCash return of the same day is on this day's report though it touches no drawer.
select pg_temp.sale(4, 1, 0, 45);
select is(
  tests.run('owner', format($$select public.return_sale(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'gcash', 'Wrong item', false, 'GCBACK1')$$, pg_temp.sid(4))),
  'ok 1', 'a GCash return is made');
select is(
  (select count(*)::int from pg_temp.report() r, jsonb_array_elements(r -> 'returns') x where x ->> 'method' = 'gcash'),
  1, 'it is on today''s report');
-- Moved to yesterday, it no longer is.
update public.returns set created_at = now() - interval '1 day' where refund_method = 'gcash';
select is(
  (select count(*)::int from pg_temp.report() r, jsonb_array_elements(r -> 'returns') x where x ->> 'method' = 'gcash'),
  0, 'a GCash return of another day is not');

select is(tests.run('special', format('select public.drawer_sales(%L)', pg_temp.drawer())), '42501',
  'only the Owner reads the report');

select * from finish();
rollback;
