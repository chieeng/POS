-- The product History pop-up (SRS INV-06; the owner's request of Nov 27, 2026): the stock
-- history gives the receipt number on sale, void and return rows (with whether the caller may
-- open the sale), the type and reason on adjustments, and damaged write-offs from returns as
-- rows with a stock change of 0. The cost stays the Owner's only.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, stock_qty, active)
values ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 36, true);
insert into public.product_costs (product_id, branch_id, cost_price)
values ('00000000-0000-4000-8000-0000000000a1', 'tmain', 30);

select is(tests.run('sales', $$select public.open_drawer('{"1": 1000}', null, 'A1B2')$$), 'ok 1', 'today''s drawer opens');

create function pg_temp.pid() returns uuid language sql as $$
  select '00000000-0000-4000-8000-0000000000a1'::uuid;
$$;
create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000009' || lpad(p_n::text, 2, '0'))::uuid;
$$;
-- A sale of p_qty chips, its cash payment and its stock movement, p_minutes ago.
create function pg_temp.sale(p_n int, p_who text, p_qty int, p_after int, p_minutes int) returns void language sql as $$
  insert into public.sales (id, branch_id, receipt_no, session_id, salesperson_id, salesperson_name, device_tag, subtotal, total, created_at)
  values (pg_temp.sid(p_n), 'tmain', 'S1-20261128-A1B2-' || p_n,
    (select id from public.drawer_sessions where branch_id = 'tmain' and business_date = private.manila_today()),
    tests.uid(p_who), initcap(p_who), 'A1B2', 45 * p_qty, 45 * p_qty, now() - make_interval(mins => p_minutes));
  insert into public.sale_items (sale_id, line_no, product_id, name, sku, unit, qty, unit_price, unit_cost, line_total)
  values (pg_temp.sid(p_n), 1, pg_temp.pid(), 'Chips Classic', 'CK-12', 'pack', p_qty, 45, 30, 45 * p_qty);
  insert into public.sale_payments (sale_id, line_no, branch_id, method, amount)
  values (pg_temp.sid(p_n), 1, 'tmain', 'cash', 45 * p_qty);
  insert into public.stock_movements
    (branch_id, product_id, type, qty_change, stock_after, unit_cost, ref_type, ref_id, user_id, user_name, device_tag, created_at)
  values ('tmain', pg_temp.pid(), 'sale', -p_qty, p_after, null, 'sale', pg_temp.sid(p_n)::text,
    tests.uid(p_who), initcap(p_who), 'A1B2', now() - make_interval(mins => p_minutes));
$$;
-- The caller's history, one line per row in the order given: type, change, stock after,
-- receipt, may open, adjustment type, reason, damaged quantity, cost.
create function pg_temp.hist(p_caller text, p_type text default null, p_from timestamptz default null)
returns text[] language plpgsql as $$
declare
  v text[];
begin
  perform tests.as(p_caller);
  select array_agg(
    concat_ws(' ', h.type, trim_scale(h.qty_change), trim_scale(h.stock_after), h.receipt_no,
      h.can_open_sale, h.adjustment_type, h.reason, trim_scale(h.damaged_qty), round(h.unit_cost, 2))
    order by h.ordinality)
  into v
  from public.product_stock_history(pg_temp.pid(), p_from, null, p_type) with ordinality as h;
  perform tests.as_admin();
  return coalesce(v, '{}');
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Three sales: Sales sells 2 (an hour ago), Special 1 (50 min), Sales 1 (40 min): 40 -> 36.
select pg_temp.sale(1, 'sales', 2, 38, 60);
select pg_temp.sale(2, 'special', 1, 37, 50);
select pg_temp.sale(3, 'sales', 1, 36, 40);

-- The Owner: 1 pack of sale 1 back as damaged, 1 pack of sale 2 back to stock, 2 packs written
-- off as damage, and sale 3 voided.
select is(
  tests.message('owner', format($$select public.return_sale(%L, '[{"lineNo": 1, "qty": 1, "condition": "damaged"}]', 'cash', 'Torn pack')$$, pg_temp.sid(1))),
  'ok', 'the Owner takes back a torn pack as damaged');
select is(
  tests.message('owner', format($$select public.return_sale(%L, '[{"lineNo": 1, "qty": 1, "condition": "stock"}]', 'cash', 'Wrong flavour')$$, pg_temp.sid(2))),
  'ok', 'the Owner takes back a pack to stock');
select is(
  tests.message('owner', format('select public.adjust_stock(%L, %L, %s, %L)', pg_temp.pid(), 'damage', -2, 'Crushed in delivery')),
  'ok', 'the Owner writes off two crushed packs');
select is(
  tests.message('owner', format('select public.void_sale(%L, %L)', pg_temp.sid(3), 'Rang up twice')),
  'ok', 'the Owner voids sale 3');

-- ---- What each role sees ---------------------------------------------------------------------
select is(
  pg_temp.hist('owner'),
  array[
    'void 1 36 S1-20261128-A1B2-3 t 30.00',
    'adjustment -2 35 f damage Crushed in delivery 30.00',
    'return 1 37 S1-20261128-A1B2-2 t 30.00',
    'damaged 0 S1-20261128-A1B2-1 t Torn pack 1 30.00',
    'sale -1 36 S1-20261128-A1B2-3 t',
    'sale -1 37 S1-20261128-A1B2-2 t',
    'sale -2 38 S1-20261128-A1B2-1 t'
  ],
  'the Owner: newest first, receipt numbers, the adjustment''s type and reason, the damaged pack at stock ±0, costs'
);
select is(
  pg_temp.hist('special'),
  array[
    'void 1 36 S1-20261128-A1B2-3 f',
    'adjustment -2 35 f damage Crushed in delivery',
    'return 1 37 S1-20261128-A1B2-2 t',
    'damaged 0 S1-20261128-A1B2-1 f Torn pack 1',
    'sale -1 36 S1-20261128-A1B2-3 f',
    'sale -1 37 S1-20261128-A1B2-2 t',
    'sale -2 38 S1-20261128-A1B2-1 f'
  ],
  'Special Sales: no cost anywhere, and only their own sale opens'
);
select is(
  tests.run(caller, format('select * from public.product_stock_history(%L)', pg_temp.pid())),
  '42501',
  caller || ' sees no stock history'
)
from unnest(array['anon', 'sales', 'deactivated', 'no_profile']) as caller;

-- ---- Filters ---------------------------------------------------------------------------------
select is(pg_temp.hist('owner', 'damaged'), array['damaged 0 S1-20261128-A1B2-1 t Torn pack 1 30.00'],
  'the damaged filter shows only the damaged write-offs');
select is(cardinality(pg_temp.hist('owner', 'sale')), 3, 'the sale filter leaves the damaged rows out');
select is(pg_temp.hist('owner', null, now() + interval '1 day'), '{}'::text[], 'nothing after tomorrow');
select is(cardinality(pg_temp.hist('owner', null, now() - interval '45 minutes')), 5,
  'a date filter applies to the damaged rows too');

select * from finish();
rollback;
