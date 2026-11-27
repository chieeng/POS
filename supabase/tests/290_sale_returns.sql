-- Returns and refunds (SRS POS-10, SYS-01, APPR-01..05; the owner's decisions of Nov 13, 2026):
-- partial returns, back to stock or damaged, the refund is what was paid for those units, one
-- method the sale was paid with, cash from today's open drawer, GCash/Maya with a reference,
-- a return window with defective items past it.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, stock_qty, active)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 40, true),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'RICE', 'Rice', '00000000-0000-4000-8000-0000000000c1', 'kg', 55, 20, true);
insert into public.product_costs (product_id, branch_id, cost_price)
values ('00000000-0000-4000-8000-0000000000a1', 'tmain', 30), ('00000000-0000-4000-8000-0000000000a2', 'tmain', 40);

select is(tests.run('sales', $$select public.open_drawer('{"1": 1000}', null, 'A1B2')$$), 'ok 1', 'today''s drawer opens');

create function pg_temp.drawer() returns uuid language sql as $$
  select id from public.drawer_sessions where branch_id = 'tmain' and business_date = private.manila_today();
$$;
create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000009' || lpad(p_n::text, 2, '0'))::uuid;
$$;
create function pg_temp.sale(p_n int, p_who text, p_days int, p_total numeric) returns void language sql as $$
  insert into public.sales (id, branch_id, receipt_no, session_id, salesperson_id, salesperson_name, device_tag, subtotal, total, created_at)
  values (pg_temp.sid(p_n), 'tmain', 'S1-20261120-A1B2-' || p_n, case when p_days = 0 then pg_temp.drawer() end,
    tests.uid(p_who), initcap(p_who), 'A1B2', p_total, p_total, now() - make_interval(days => p_days));
$$;
create function pg_temp.line(p_n int, p_line int, p_product text, p_unit text, p_qty numeric, p_total numeric) returns void language sql as $$
  insert into public.sale_items (sale_id, line_no, product_id, name, sku, unit, qty, unit_price, unit_cost, line_total)
  values (pg_temp.sid(p_n), p_line, ('00000000-0000-4000-8000-0000000000' || p_product)::uuid,
    case p_product when 'a1' then 'Chips Classic' else 'Rice' end, 'X', p_unit, p_qty, round(p_total / p_qty, 2),
    case p_product when 'a1' then 30 else 40 end, p_total);
$$;
create function pg_temp.pay(p_n int, p_line int, p_method text, p_amount numeric) returns void language sql as $$
  insert into public.sale_payments (sale_id, line_no, branch_id, method, amount, reference)
  values (pg_temp.sid(p_n), p_line, 'tmain', p_method, p_amount, case when p_method <> 'cash' then 'REF-' || p_n || p_line || '00' end);
$$;
create function pg_temp.request(p_n int) returns uuid language sql as $$
  select id from public.approval_requests where type = 'sale_return' and target_id = pg_temp.sid(p_n)
  order by (status = 'pending') desc, created_at desc limit 1;
$$;
create function pg_temp.stock(p_product text) returns numeric language sql as $$
  select stock_qty from public.products where id = ('00000000-0000-4000-8000-0000000000' || p_product)::uuid;
$$;
create function pg_temp.detail(p_caller text, p_n int) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform tests.as(p_caller);
  v := public.sale_detail(pg_temp.sid(p_n));
  perform tests.as_admin();
  return v;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Sale 1 (Sales): 3 chips in a "3 for ₱120" deal and 1.25 kg rice (₱68.75), cash ₱189 (rounded).
select pg_temp.sale(1, 'sales', 0, 189);
select pg_temp.line(1, 1, 'a1', 'pack', 3, 120);
select pg_temp.line(1, 2, 'a2', 'kg', 1.25, 68.75);
select pg_temp.pay(1, 1, 'cash', 189);
-- Sale 2 (Special): 2 chips, cash ₱45 + GCash ₱45.
select pg_temp.sale(2, 'special', 0, 90);
select pg_temp.line(2, 1, 'a1', 'pack', 2, 90);
select pg_temp.pay(2, 1, 'cash', 45);
select pg_temp.pay(2, 2, 'gcash', 45);
-- Sale 3 (Sales): 40 days ago, 1 chips cash.
select pg_temp.sale(3, 'sales', 40, 45);
select pg_temp.line(3, 1, 'a1', 'pack', 1, 45);
select pg_temp.pay(3, 1, 'cash', 45);
-- Sale 4 (Sales): today, 2 chips cash.
select pg_temp.sale(4, 'sales', 0, 90);
select pg_temp.line(4, 1, 'a1', 'pack', 2, 90);
select pg_temp.pay(4, 1, 'cash', 90);

select is(private.drawer_expected(pg_temp.drawer()), 1324.00::numeric(12, 2),
  'today''s drawer expects 1,000 + 189 + 45 + 90 cash');

-- ---- Who may ask, and who may return ---------------------------------------------------------
select is(
  tests.run(caller, format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'cash', 'x')$$, pg_temp.sid(1))),
  '42501',
  caller || ' cannot ask for a return'
)
from unnest(array['anon', 'no_profile', 'deactivated', 'signed_out', 'owner']) as caller;
select is(
  tests.run(caller, format($$select public.return_sale(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'cash', 'x')$$, pg_temp.sid(1))),
  '42501',
  caller || ' cannot return directly'
)
from unnest(array['anon', 'deactivated', 'sales', 'special']) as caller;
select is(
  tests.message('special', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'cash', 'x')$$, pg_temp.sid(1))),
  'not_found',
  'staff ask only for their own sales'
);

-- ---- What can be asked -----------------------------------------------------------------------
select is(
  tests.message('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 0, "condition": "stock"}]', 'cash', 'x')$$, pg_temp.sid(1))),
  'invalid_input', 'a quantity of 0 is refused');
select is(
  tests.message('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 0.5, "condition": "stock"}]', 'cash', 'x')$$, pg_temp.sid(1))),
  'invalid_input', 'half a pack is refused');
select is(
  tests.message('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 4, "condition": "stock"}]', 'cash', 'x')$$, pg_temp.sid(1))),
  'return_qty', 'more than was sold is refused');
select is(
  tests.message('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'maya', 'x')$$, pg_temp.sid(1))),
  'refund_method_invalid', 'a refund by a method the sale wasn''t paid with is refused');
select is(
  tests.message('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 1, "condition": "lost"}]', 'cash', 'x')$$, pg_temp.sid(1))),
  'invalid_input', 'each line is back to stock or damaged');
select is(
  tests.message('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'cash', 'Wrong flavour')$$, pg_temp.sid(3))),
  'return_window_passed', 'past the 30-day window, a return is refused');

-- ---- A partial return, approved: one chips from the deal ------------------------------------
select is(
  tests.run('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'cash', 'Wrong flavour', false, 'A1B2')$$, pg_temp.sid(1))),
  'ok 1',
  'Sales asks to return 1 chips from the deal'
);
select is(
  (select jsonb_build_object('refund', r.after -> 'refund', 'cash', r.after -> 'cashRefund', 'method', r.after ->> 'method', 'line', r.after #> '{items,0,refund}')
   from public.approval_requests r where r.id = pg_temp.request(1)),
  '{"refund": 40.00, "cash": 40, "method": "cash", "line": 40.00}'::jsonb,
  'the refund is its share of the deal: ₱120 ÷ 3 = ₱40.00, shown before the Owner decides'
);
select is(
  tests.message('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 2, "qty": 1, "condition": "stock"}]', 'cash', 'x')$$, pg_temp.sid(1))),
  'request_pending', 'one pending return per sale');
select is(
  (select jsonb_build_object('stock', pg_temp.stock('a1'), 'expected', private.drawer_expected(pg_temp.drawer()), 'returns', (select count(*) from public.returns))),
  '{"stock": 40, "expected": 1324.00, "returns": 0}'::jsonb,
  'nothing changes until the Owner decides'
);
select is(pg_temp.detail('sales', 1) #>> '{pendingReturn,mine}', 'true', 'the sale shows the pending return');
select is(
  tests.run('owner', format('select public.decide_approval(%L, true, null, %L)', pg_temp.request(1), 'OWN1')),
  'ok 1', 'the Owner approves');
select is(pg_temp.stock('a1'), 41::numeric, 'the pack is back in stock');
select is(
  (select jsonb_build_object('type', m.type, 'qty', m.qty_change, 'cost', m.unit_cost) from public.stock_movements m where m.type = 'return'),
  '{"type": "return", "qty": 1, "cost": 30.0000}'::jsonb,
  'a return stock movement, at the average cost'
);
select is(private.drawer_expected(pg_temp.drawer()), 1284.00::numeric(12, 2), '₱40 cash leaves today''s drawer');
select is(
  (select jsonb_build_object('reason', a.reason, 'refund', a.after -> 'refund', 'method', a.after ->> 'method', 'receipt', a.after ->> 'receiptNo')
   from public.audit_logs a where a.action = 'sale.return'),
  '{"reason": "Wrong flavour", "refund": 40.00, "method": "cash", "receipt": "S1-20261120-A1B2-1"}'::jsonb,
  'the return is audit-logged with its reason'
);
select is(
  pg_temp.detail('sales', 1) -> 'lines' -> 0 -> 'returnedQty', '1'::jsonb,
  'the sale shows 1 of the 3 returned');
select is(pg_temp.detail('sales', 1) ->> 'voidable', 'sale_has_returns', 'a sale with a return can no longer be voided');

-- ---- The Owner returns the rest directly: 2 chips damaged, the rice back to stock -----------
select is(
  tests.run('owner', format($$select public.return_sale(%L, '[{"lineNo": 1, "qty": 2, "condition": "damaged"}, {"lineNo": 2, "qty": 1.25, "condition": "stock"}]', 'cash', 'Spoiled', false, null, 'OWN1')$$, pg_temp.sid(1))),
  'ok 1', 'the Owner returns the rest');
select is(
  (select jsonb_build_object('refund', r.refund_amount, 'cash', r.cash_refund, 'chips', r.items -> 0 ->> 'refund', 'damaged', r.items -> 0 ->> 'condition', 'cost', r.items -> 0 ->> 'unitCost')
   from public.returns r where r.reason = 'Spoiled'),
  '{"refund": 148.75, "cash": 149.00, "chips": "80.00", "damaged": "damaged", "cost": "30.0000"}'::jsonb,
  'the last 2 chips get exactly what is left (₱80), rice ₱68.75; ₱148.75 rounds to ₱149 cash; damaged kept at cost'
);
select is(pg_temp.stock('a1'), 41::numeric, 'damaged chips don''t come back into stock');
select is(pg_temp.stock('a2'), 21.25::numeric, 'the rice does');
select is(private.drawer_expected(pg_temp.drawer()), 1135.00::numeric(12, 2), '₱149 more leaves the drawer: the whole ₱189 is back');
select is(
  tests.message('owner', format($$select public.return_sale(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'cash', 'again')$$, pg_temp.sid(1))),
  'return_qty', 'nothing is left to return');

-- ---- Split payment: GCash needs the refund's reference, and no more than GCash paid ----------
select is(
  tests.run('special', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'gcash', 'Changed mind')$$, pg_temp.sid(2))),
  'ok 1', 'Special Sales asks for a GCash refund of 1 chips');
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', pg_temp.request(2))),
  'refund_reference_required', 'approving needs the GCash refund''s reference');
select is(
  tests.run('owner', format('select public.decide_approval(%L, true, null, null, %L)', pg_temp.request(2), 'gc 777 888')),
  'ok 1', 'with it, approved');
select is(
  (select jsonb_build_object('ref', r.refund_reference, 'cash', r.cash_refund, 'drawer', r.session_id) from public.returns r where r.sale_id = pg_temp.sid(2)),
  '{"ref": "GC777888", "cash": null, "drawer": null}'::jsonb,
  'the reference is kept; nothing comes out of the drawer');
select is(private.drawer_expected(pg_temp.drawer()), 1135.00::numeric(12, 2), 'the drawer is unchanged');
select is(
  tests.message('special', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'gcash', 'x')$$, pg_temp.sid(2))),
  'refund_too_large', 'GCash was already given back in full');

-- ---- Past the window: only defective, with the Owner's approval -----------------------------
select is(
  tests.run('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 1, "condition": "damaged"}]', 'cash', 'Seal broken inside', true)$$, pg_temp.sid(3))),
  'ok 1', 'a defective item past the window may be asked for');
select is(
  (select jsonb_build_object('late', r.after -> 'late', 'defective', r.after -> 'defective') from public.approval_requests r where r.id = pg_temp.request(3)),
  '{"late": true, "defective": true}'::jsonb,
  'the Owner sees it is late and defective');

-- ---- Outdated: something else was returned since the request --------------------------------
select is(
  tests.run('sales', format($$select public.request_sale_return(%L, '[{"lineNo": 1, "qty": 2, "condition": "stock"}]', 'cash', 'Both wrong')$$, pg_temp.sid(4))),
  'ok 1', 'Sales asks to return both chips');
select is(
  tests.run('owner', format($$select public.return_sale(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'cash', 'One back')$$, pg_temp.sid(4))),
  'ok 1', 'meanwhile the Owner returns one');
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', pg_temp.request(4))),
  'request_outdated', 'the request is outdated');
select is(
  tests.run('owner', format('select public.decide_approval(%L, false, %L)', pg_temp.request(4), 'Already done')),
  'ok 1', 'and can only be rejected');

-- ---- A cash refund needs today's drawer open ---------------------------------------------------
update public.drawer_sessions set status = 'closed', closed_at = now(), counted_cash = 1090,
  expected_cash = 1090, over_short = 0
where id = pg_temp.drawer();
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', pg_temp.request(3))),
  'drawer_not_open', 'with no drawer open, a cash refund waits');
select is(
  (select status from public.approval_requests where id = pg_temp.request(3)),
  'pending', 'and the request stays pending');

-- ---- The return window setting ---------------------------------------------------------------
select is(
  tests.run('owner', $$select public.update_branch_settings('{"return_window_days": 7}')$$),
  'ok 1', 'the Owner sets a 7-day window');
select is((select return_window_days from public.branches where id = 'tmain'), 7, 'it is saved');
select is(
  (select after from public.audit_logs where action = 'branch.update' order by created_at desc limit 1),
  '{"return_window_days": 7}'::jsonb, 'and audit-logged');
select is(
  tests.run('owner', $$select public.update_branch_settings('{"return_window_days": 2.5}')$$),
  '22023', 'whole days only');
select is(
  tests.run('owner', $$select public.update_branch_settings('{"return_window_days": 0}')$$),
  '22023', 'at least 1 day');
select is(
  tests.run('special', $$select public.update_branch_settings('{"return_window_days": 60}')$$),
  '42501', 'only the Owner');

-- ---- Returns are the Owner's to read -----------------------------------------------------------
select is(tests.rows('sales', 'select * from public.returns'), 0::bigint, 'Sales reads no returns directly');
select is(tests.rows('owner', 'select * from public.returns'), 4::bigint, 'the Owner reads them');

-- ---- My sales marks returned sales (review of Nov 21) ---------------------------------------
create function pg_temp.returned(p_n int) returns text language plpgsql as $$
declare
  v jsonb;
begin
  perform tests.as('owner');
  v := public.sales_history(null, null);
  perform tests.as_admin();
  return (select s ->> 'returned' from jsonb_array_elements(v -> 'sales') s
    where s ->> 'receiptNo' = 'S1-20261120-A1B2-' || p_n);
end;
$$;
grant execute on function pg_temp.returned(int) to authenticated;
select is(pg_temp.returned(1), 'all', 'a sale returned in full is marked "all"');
select is(pg_temp.returned(4), 'some', 'a partly returned sale is marked "some"');
select is(pg_temp.returned(2), 'some', 'the split sale with one GCash return is marked "some"');

select * from finish();
rollback;
