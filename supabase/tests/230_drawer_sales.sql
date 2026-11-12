-- The drawer report's sales (SRS SHIFT-04, POS-14): drawer_sales sums one drawer's sales for
-- the Owner only: by payment method, by salesperson, and the flagged sales to check.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Grocery');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, stock_qty, active)
values ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 20, true);

create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000006' || lpad(p_n::text, 2, '0'))::uuid;
$$;
-- p_qty packs of chips at ₱45, paid with p_payments.
create function pg_temp.sale(p_caller text, p_n int, p_qty int, p_payments jsonb) returns text
language sql as $$
  select tests.message(
    p_caller,
    format(
      'select public.complete_sale(%L, %L)',
      jsonb_build_object(
        'id', pg_temp.sid(p_n),
        'receipt_no', (case p_caller when 'special' then 'SP' else 'S1' end) || '-20261108-A1B2-' || p_n,
        'made_at', now(), 'offline', false, 'round_cash', true, 'vat_rate', null,
        'total', 45 * p_qty,
        'lines', jsonb_build_array(jsonb_build_object(
          'product_id', '00000000-0000-4000-8000-0000000000a1', 'qty', p_qty, 'unit_price', 45
        )),
        'payments', p_payments
      ),
      'A1B2'
    )
  );
$$;
create function pg_temp.session() returns uuid language sql as $$
  select id from public.drawer_sessions where branch_id = 'tmain' and status = 'open';
$$;
create function pg_temp.report(p_session uuid) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform tests.as('owner');
  v := public.drawer_sales(p_session);
  perform tests.as_admin();
  return v;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;

select is(tests.run('sales', $$select public.open_drawer(1000, null, 'A1B2')$$), 'ok 1', 'Sales opens the drawer');

-- ---- Who may read it -------------------------------------------------------------------------
select is(
  tests.run(caller, format('select public.drawer_sales(%L)', pg_temp.session())),
  '42501',
  caller || ' cannot read the drawer''s sales'
)
from unnest(array['anon', 'no_profile', 'deactivated', 'signed_out', 'owner_aal1', 'sales', 'special']) as caller;
select is(
  tests.run('other_owner', format('select public.drawer_sales(%L)', pg_temp.session())),
  'P0002',
  'an Owner of another branch finds no such drawer'
);
select is(
  tests.run('owner', $$select public.drawer_sales('00000000-0000-4000-8000-000000000999')$$),
  'P0002',
  'an unknown drawer is not found'
);

-- ---- An empty drawer -------------------------------------------------------------------------
select is(
  pg_temp.report(pg_temp.session()),
  '{"count": 0, "total": 0, "discounts": 0, "flagged": [], "methods": [], "salespeople": [], "flaggedCount": 0}'::jsonb,
  'a drawer with no sales yet: zeros and empty lists'
);

-- ---- Four sales ------------------------------------------------------------------------------
select is(pg_temp.sale('sales', 1, 2, '[{"method": "cash", "amount": 100}]'), 'ok', 'Sales: 2 packs, cash ₱100 (₱90 stays)');
select is(pg_temp.sale('special', 2, 1, '[{"method": "gcash", "amount": 45, "reference": "1012345678"}]'), 'ok', 'Special Sales: 1 pack by GCash');
select is(
  pg_temp.sale('sales', 3, 1, '[{"method": "maya", "amount": 20, "reference": "MY-1001"}, {"method": "cash", "amount": 50}]'),
  'ok',
  'Sales: 1 pack, Maya ₱20 and cash ₱50 (₱25 stays)'
);
select is(pg_temp.sale('sales', 4, 1, '[{"method": "cash", "amount": 45}]'), 'ok', 'Sales: 1 pack, exact cash');
-- As if it had been made offline yesterday and synced today.
update public.sales set flags = '{late}', made_offline = true where id = pg_temp.sid(4);

select is(
  (select jsonb_build_object('count', r -> 'count', 'total', r -> 'total') from pg_temp.report(pg_temp.session()) r),
  '{"count": 4, "total": 225.00}'::jsonb,
  '4 sales, ₱225.00 in all'
);
select is(
  pg_temp.report(pg_temp.session()) -> 'methods',
  '[{"count": 3, "amount": 160.00, "method": "cash"},
    {"count": 1, "amount": 45.00, "method": "gcash"},
    {"count": 1, "amount": 20.00, "method": "maya"}]'::jsonb,
  'by method: cash is what stays in the drawer (₱90 + ₱25 + ₱45); a split counts under both'
);
select is(
  pg_temp.report(pg_temp.session()) -> 'salespeople',
  '[{"name": "Sales", "count": 3, "total": 180.00, "discounts": 0.00}, {"name": "Special", "count": 1, "total": 45.00, "discounts": 0.00}]'::jsonb,
  'by salesperson, the biggest first'
);
select is(
  (select r -> 'flaggedCount' from pg_temp.report(pg_temp.session()) r),
  '1'::jsonb,
  'one sale to check'
);
select is(
  (select jsonb_build_object('receiptNo', f -> 'receiptNo', 'salesperson', f -> 'salesperson', 'total', f -> 'total', 'flags', f -> 'flags', 'madeOffline', f -> 'madeOffline')
   from pg_temp.report(pg_temp.session()) r, jsonb_array_elements(r -> 'flagged') f),
  '{"receiptNo": "S1-20261108-A1B2-4", "salesperson": "Sales", "total": 45.00, "flags": ["late"], "madeOffline": true}'::jsonb,
  'the late sale is listed with its receipt, who sold it, its total and its flags'
);
select is(
  (select (r -> 'flagged' -> 0) ?& array['id', 'madeAt', 'syncedAt'] from pg_temp.report(pg_temp.session()) r),
  true,
  'with when it was made and when it reached the store'
);

-- The drawer's expected cash agrees: ₱1,000 + ₱160 in cash sales.
select is(
  (select private.drawer_expected(pg_temp.session())),
  1160.00::numeric,
  'expected cash matches the cash the report shows'
);

-- A voided sale (step 10) would not count; until then every sale is completed.
update public.sales set status = 'voided' where id = pg_temp.sid(2);
select is(
  (select r -> 'count' from pg_temp.report(pg_temp.session()) r),
  '3'::jsonb,
  'only completed sales count'
);

select * from finish();
rollback;
