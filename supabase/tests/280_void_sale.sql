-- Voiding a sale (SRS POS-10, APPR-01..05; the owner's decisions of Nov 13, 2026): staff ask,
-- the Owner voids or approves; only while the sale's drawer is open; stock comes back and the
-- cash leaves the drawer's expected cash; a GCash/Maya refund is recorded with its reference.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, stock_qty, active)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 40, true),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'RICE', 'Rice', '00000000-0000-4000-8000-0000000000c1', 'kg', 99, 20, true);
insert into public.product_costs (product_id, branch_id, cost_price)
values ('00000000-0000-4000-8000-0000000000a1', 'tmain', 30), ('00000000-0000-4000-8000-0000000000a2', 'tmain', 60);

-- Yesterday's drawer, counted and closed; today's, open with ₱1,000.
select is(tests.run('sales', $$select public.open_drawer('{"1": 500}', null, 'A1B2')$$), 'ok 1', 'yesterday''s drawer opens');
update public.drawer_sessions set business_date = business_date - 1, status = 'closed',
  closed_at = now() - interval '1 day', counted_cash = 500, expected_cash = 500, over_short = 0
where branch_id = 'tmain';
select is(tests.run('sales', $$select public.open_drawer('{"1": 1000}', 'test', 'A1B2')$$), 'ok 1', 'today''s drawer opens');

create function pg_temp.drawer(p_today boolean) returns uuid language sql as $$
  select id from public.drawer_sessions where branch_id = 'tmain'
    and (business_date = private.manila_today()) = p_today;
$$;
create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000009' || lpad(p_n::text, 2, '0'))::uuid;
$$;
-- A sale of p_packs chips by p_who in drawer p_session, paid p_cash in cash and p_gcash by GCash.
create function pg_temp.sale(p_n int, p_who text, p_session uuid, p_packs int, p_cash numeric, p_gcash numeric)
returns void language sql as $$
  insert into public.sales (id, branch_id, receipt_no, session_id, salesperson_id, salesperson_name, device_tag, subtotal, total, created_at)
  values (pg_temp.sid(p_n), 'tmain', 'S1-20261119-A1B2-' || p_n, p_session, tests.uid(p_who), initcap(p_who), 'A1B2',
    p_packs * 45, p_packs * 45, now());
  insert into public.sale_items (sale_id, line_no, product_id, name, sku, unit, qty, unit_price, unit_cost, line_total)
  values (pg_temp.sid(p_n), 1, '00000000-0000-4000-8000-0000000000a1', 'Chips Classic', 'CK-12', 'pack', p_packs, 45, 30, p_packs * 45);
  insert into public.sale_payments (sale_id, line_no, branch_id, method, amount, reference)
  select pg_temp.sid(p_n), 1, 'tmain', 'cash', p_cash, null where p_cash > 0
  union all
  select pg_temp.sid(p_n), 2, 'tmain', 'gcash', p_gcash, 'GC-' || p_n || '000' where p_gcash > 0;
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
create function pg_temp.request(p_n int) returns uuid language sql as $$
  select id from public.approval_requests where type = 'sale_void' and target_id = pg_temp.sid(p_n)
  order by (status = 'pending') desc, created_at desc limit 1;
$$;
create function pg_temp.stock() returns numeric language sql as $$
  select stock_qty from public.products where id = '00000000-0000-4000-8000-0000000000a1';
$$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.sale(1, 'sales', pg_temp.drawer(true), 2, 90, 0);
select pg_temp.sale(2, 'sales', pg_temp.drawer(true), 2, 45, 45);
select pg_temp.sale(3, 'special', pg_temp.drawer(false), 1, 45, 0);
select pg_temp.sale(4, 'sales', null, 1, 45, 0);
select pg_temp.sale(5, 'sales', pg_temp.drawer(true), 1, 45, 0);
select pg_temp.sale(6, 'special', pg_temp.drawer(true), 1, 45, 0);

select is(private.drawer_expected(pg_temp.drawer(true)), 1225.00::numeric(12, 2),
  'today''s drawer expects 1,000 + 90 + 45 + 45 + 45 cash');

-- ---- Who may ask, and who may void ---------------------------------------------------------
select is(
  tests.run(caller, format('select public.request_sale_void(%L, %L)', pg_temp.sid(1), 'wrong item')),
  '42501',
  caller || ' cannot ask for a void'
)
from unnest(array['anon', 'no_profile', 'deactivated', 'signed_out', 'owner']) as caller;
select is(
  tests.run(caller, format('select public.void_sale(%L, %L)', pg_temp.sid(1), 'wrong item')),
  '42501',
  caller || ' cannot void directly'
)
from unnest(array['anon', 'deactivated', 'sales', 'special']) as caller;
select is(
  tests.message('special', format('select public.request_sale_void(%L, %L)', pg_temp.sid(1), 'not mine')),
  'not_found',
  'staff ask only for their own sales'
);

-- ---- When a void is possible ------------------------------------------------------------------
select is(pg_temp.detail('sales', 1) ->> 'voidable', 'ok', 'a sale in today''s open drawer can be voided');
select is(pg_temp.detail('sales', 4) ->> 'voidable', 'drawer_waiting', 'a sale still waiting for a drawer cannot yet');
select is(pg_temp.detail('special', 3) ->> 'voidable', 'drawer_closed', 'a sale in a closed drawer cannot: it is a return');
select is(
  tests.message('special', format('select public.request_sale_void(%L, %L)', pg_temp.sid(3), 'late')),
  'drawer_closed',
  'and asking for it is refused'
);
select is(
  tests.message('owner', format('select public.void_sale(%L, %L)', pg_temp.sid(3), 'late')),
  'drawer_closed',
  'the Owner cannot void it either'
);
select is(
  tests.message('sales', format('select public.request_sale_void(%L, %L)', pg_temp.sid(1), '  ')),
  'invalid_input',
  'a reason is required'
);

-- ---- A request changes nothing until approved -------------------------------------------------
select is(
  tests.run('sales', format('select public.request_sale_void(%L, %L, %L)', pg_temp.sid(1), 'Customer changed their mind', 'A1B2')),
  'ok 1',
  'Sales asks to void their cash sale'
);
select is(
  tests.message('sales', format('select public.request_sale_void(%L, %L)', pg_temp.sid(1), 'again')),
  'request_pending',
  'one pending request per sale'
);
select is(
  (select jsonb_build_object('status', r.status, 'reason', r.reason, 'cash', r.after -> 'cash', 'ewallet', r.after -> 'ewallet', 'receipt', r.after ->> 'receiptNo')
   from public.approval_requests r where r.id = pg_temp.request(1)),
  '{"status": "pending", "reason": "Customer changed their mind", "cash": 90.00, "ewallet": 0, "receipt": "S1-20261119-A1B2-1"}'::jsonb,
  'the request keeps the receipt and what would be given back'
);
select is(
  (select jsonb_build_object('status', s.status, 'stock', pg_temp.stock(), 'expected', private.drawer_expected(pg_temp.drawer(true)))
   from public.sales s where s.id = pg_temp.sid(1)),
  '{"status": "completed", "stock": 40, "expected": 1225.00}'::jsonb,
  'nothing changes until the Owner decides'
);
select is(pg_temp.detail('sales', 1) #>> '{pendingVoid,mine}', 'true', 'the sale shows the requester their pending request');
select is(pg_temp.detail('owner', 1) #>> '{pendingVoid,reason}', 'Customer changed their mind', 'and shows the Owner too');
select is(
  (select count(*)::int from public.audit_logs where action = 'approval.request' and after ->> 'label' = 'sale S1-20261119-A1B2-1'),
  1,
  'the request is audit-logged, naming the receipt'
);

-- ---- The Owner approves: stock back, cash out of the expected --------------------------------
select is(
  tests.run('owner', format('select public.decide_approval(%L, true, null, %L)', pg_temp.request(1), 'OWN1')),
  'ok 1',
  'the Owner approves'
);
select is(
  (select jsonb_build_object('status', s.status, 'by', s.voided_by_name, 'reason', s.void_reason, 'request', s.void_request_id = pg_temp.request(1))
   from public.sales s where s.id = pg_temp.sid(1)),
  '{"status": "voided", "by": "Owner", "reason": "Customer changed their mind", "request": true}'::jsonb,
  'the sale is voided, with who and why'
);
select is(pg_temp.stock(), 42::numeric, 'its 2 packs are back in stock');
select is(
  (select jsonb_build_object('type', m.type, 'qty', m.qty_change, 'after', m.stock_after, 'ref', m.ref_id = pg_temp.sid(1)::text)
   from public.stock_movements m where m.type = 'void'),
  '{"type": "void", "qty": 2, "after": 42, "ref": true}'::jsonb,
  'a void stock movement records it'
);
select is(private.drawer_expected(pg_temp.drawer(true)), 1135.00::numeric(12, 2), 'the drawer now expects ₱90 less');
select is(
  (select jsonb_build_object('reason', a.reason, 'cash', a.after -> 'cash', 'receipt', a.after ->> 'receiptNo')
   from public.audit_logs a where a.action = 'sale.void' and a.target_id = pg_temp.sid(1)::text),
  '{"reason": "Customer changed their mind", "cash": 90.00, "receipt": "S1-20261119-A1B2-1"}'::jsonb,
  'the void is audit-logged with its reason'
);
select is(
  (select status from public.approval_requests where id = pg_temp.request(1)),
  'approved',
  'the request is approved'
);
select is(pg_temp.detail('sales', 1) ->> 'voidable', 'sale_not_completed', 'a voided sale cannot be voided again');
select is(
  tests.message('sales', format('select public.request_sale_void(%L, %L)', pg_temp.sid(1), 'again')),
  'sale_not_completed',
  'nor asked for'
);

-- ---- Part paid by GCash: the Owner records the refund's reference ----------------------------
select is(
  tests.run('sales', format('select public.request_sale_void(%L, %L)', pg_temp.sid(2), 'Wrong item')),
  'ok 1',
  'Sales asks to void a cash + GCash sale'
);
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', pg_temp.request(2))),
  'refund_reference_required',
  'approving needs the reference of the GCash sent back'
);
select is(pg_temp.stock(), 42::numeric, 'and a refused approval changes nothing');
select is(
  tests.run('owner', format('select public.decide_approval(%L, true, null, null, %L)', pg_temp.request(2), 'gc 1234 5678')),
  'ok 1',
  'with the reference, it is approved'
);
select is(
  (select s.void_refund_reference from public.sales s where s.id = pg_temp.sid(2)),
  'GC12345678',
  'the reference is kept without spaces, in capitals'
);
select is(private.drawer_expected(pg_temp.drawer(true)), 1090.00::numeric(12, 2), 'only the cash part leaves the drawer');
select is(pg_temp.stock(), 44::numeric, 'and its 2 packs are back');

-- ---- Outdated: the drawer closed before the Owner decided -----------------------------------
select is(
  tests.run('sales', format('select public.request_sale_void(%L, %L)', pg_temp.sid(5), 'Duplicate sale')),
  'ok 1',
  'Sales asks to void another sale'
);
select is(
  tests.run('sales', format('select public.withdraw_request(%L)', pg_temp.request(5))),
  'ok 1',
  'and may withdraw it'
);
select is(
  tests.run('sales', format('select public.request_sale_void(%L, %L)', pg_temp.sid(5), 'Duplicate sale')),
  'ok 1',
  'then ask again'
);

-- ---- The Owner voids directly ------------------------------------------------------------------
select is(
  tests.run('owner', format('select public.void_sale(%L, %L, null, %L)', pg_temp.sid(6), 'Test sale', 'OWN1')),
  'ok 1',
  'the Owner voids a sale directly, with a reason'
);
select is(
  (select jsonb_build_object('status', s.status, 'request', s.void_request_id) from public.sales s where s.id = pg_temp.sid(6)),
  '{"status": "voided", "request": null}'::jsonb,
  'no request is needed'
);
select is(private.drawer_expected(pg_temp.drawer(true)), 1045.00::numeric(12, 2), 'its cash leaves the drawer too');

update public.drawer_sessions set status = 'closed', closed_at = now(), counted_cash = 1090,
  expected_cash = 1090, over_short = 0
where id = pg_temp.drawer(true);
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', pg_temp.request(5))),
  'request_outdated',
  'once the drawer is closed the request is outdated'
);
select is(
  tests.run('owner', format('select public.decide_approval(%L, false, %L)', pg_temp.request(5), 'Make a return')),
  'ok 1',
  'and can only be rejected'
);
select is(
  (select s.status from public.sales s where s.id = pg_temp.sid(5)),
  'completed',
  'the sale stays completed'
);

-- ---- Another branch ------------------------------------------------------------------------------
select is(
  tests.message('other_owner', format('select public.void_sale(%L, %L)', pg_temp.sid(4), 'x')),
  'not_found',
  'another branch''s Owner cannot void it'
);

select * from finish();
rollback;
