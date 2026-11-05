-- Checkout on the server (SRS 5.2; POS-04, POS-06, POS-08, POS-09, POS-13, POS-14): one call
-- records the sale, its lines, payments, stock and movements; cash rounds to the peso with
-- PHP 0.50 up; a sale made offline is never refused for what changed while it waited.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Grocery');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, stock_qty, active)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 20, true),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'RICE', 'Rice', '00000000-0000-4000-8000-0000000000c1', 'kg', 99, 10, true),
  ('00000000-0000-4000-8000-0000000000a3', 'tmain', 'OLD-1', 'Old candy', '00000000-0000-4000-8000-0000000000c1', 'pc', 5, 5, false),
  ('00000000-0000-4000-8000-0000000000a4', 'tmain', 'WATER', 'Water', '00000000-0000-4000-8000-0000000000c1', 'pc', 15, 1, true);
insert into public.product_costs (product_id, branch_id, cost_price)
values ('00000000-0000-4000-8000-0000000000a1', 'tmain', 30.5);
insert into public.payment_accounts (id, branch_id, provider, label, number)
values
  ('00000000-0000-4000-8000-0000000000b1', 'tmain', 'gcash', 'Main GCash', '0917 123 4567'),
  ('00000000-0000-4000-8000-0000000000b2', 'tmain', 'maya', 'Store Maya', '0917 765 4321');

create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000005' || lpad(p_n::text, 2, '0'))::uuid;
$$;
create function pg_temp.l(p_product text, p_qty numeric, p_price numeric) returns jsonb language sql as $$
  select jsonb_build_object(
    'product_id', '00000000-0000-4000-8000-0000000000' || p_product, 'qty', p_qty, 'unit_price', p_price
  );
$$;
create function pg_temp.body(p_caller text, p_n int, p_lines jsonb, p_payments jsonb, p_total numeric, p_extra jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', pg_temp.sid(p_n),
    'receipt_no', (case p_caller when 'owner' then 'OW' when 'special' then 'SP' else 'S1' end)
      || '-20261106-A1B2-' || p_n,
    'made_at', now(), 'offline', false, 'round_cash', true, 'vat_rate', null,
    'total', p_total, 'lines', p_lines, 'payments', p_payments
  ) || p_extra;
$$;
create function pg_temp.sale(
  p_caller text, p_n int, p_lines jsonb, p_payments jsonb, p_total numeric,
  p_extra jsonb default '{}'
) returns text language sql as $$
  select tests.message(
    p_caller,
    format('select public.complete_sale(%L, %L)', pg_temp.body(p_caller, p_n, p_lines, p_payments, p_total, p_extra), 'A1B2')
  );
$$;
create function pg_temp.cash(p_amount numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', p_amount));
$$;
create function pg_temp.row(p_n int) returns text language sql as $$
  select concat_ws(' | ', subtotal, rounding, total, change, coalesce(vat_amount::text, '-'),
    array_to_string(flags, ','), coalesce(session_id::text, 'waiting'))
  from public.sales where id = pg_temp.sid(p_n);
$$;
create function pg_temp.stock(p_product text) returns numeric language sql as $$
  select stock_qty from public.products where id = ('00000000-0000-4000-8000-0000000000' || p_product)::uuid;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- Who sells -------------------------------------------------------------------------------
select is(
  pg_temp.sale(caller, 1, jsonb_build_array(pg_temp.l('a1', 1, 45)), pg_temp.cash(45), 45),
  'This account has no access.',
  caller || ' cannot record a sale'
)
from unnest(array['no_profile', 'deactivated', 'signed_out', 'owner_aal1']) as caller;
select is(
  tests.run('anon', $$select public.complete_sale('{}', 'A1B2')$$),
  '42501',
  'anon cannot call complete_sale'
);

-- ---- A plain cash sale, with no drawer open --------------------------------------------------
select is(
  pg_temp.sale('sales', 1, jsonb_build_array(pg_temp.l('a1', 2, 45)), pg_temp.cash(100), 90),
  'ok',
  'Sales records a cash sale with no drawer open (allowed, POS-14)'
);
select is(pg_temp.row(1), '90.00 | 0.00 | 90.00 | 10.00 | - |  | waiting', 'total ₱90, change ₱10, waiting for a drawer');
select is(
  (select concat_ws(' | ', salesperson_name, device_tag, receipt_no, made_offline) from public.sales where id = pg_temp.sid(1)),
  'Sales | A1B2 | S1-20261106-A1B2-1 | f',
  'it names who sold it, on which device, with its receipt number'
);
select is(
  (select concat_ws(' | ', line_no, name, sku, unit, qty, unit_price, coalesce(list_price::text, '-'), unit_cost, line_total)
   from public.sale_items where sale_id = pg_temp.sid(1)),
  '1 | Chips Classic | CK-12 | pack | 2 | 45.00 | - | 30.5000 | 90.00',
  'the line copies the product as sold, with its cost'
);
select is(
  (select concat_ws(' | ', method, amount, coalesce(reference, '-')) from public.sale_payments where sale_id = pg_temp.sid(1)),
  'cash | 90.00 | -',
  'the cash payment is what stays in the drawer (tendered minus change)'
);
select is(pg_temp.stock('a1'), 18::numeric, 'stock goes from 20 to 18');
select is(
  (select concat_ws(' | ', type, qty_change, stock_after, unit_cost, ref_type, user_name)
   from public.stock_movements where ref_id = pg_temp.sid(1)::text),
  'sale | -2 | 18 | 30.5000 | sale | Sales',
  'a stock movement is written for the line'
);
select is(
  (select count(*) from public.audit_logs where target_id = pg_temp.sid(1)::text),
  0::bigint,
  'no audit line per sale: the sale is the record'
);

-- POS-06: sending it again returns the same sale and changes nothing.
select is(
  pg_temp.sale('sales', 1, jsonb_build_array(pg_temp.l('a1', 2, 45)), pg_temp.cash(100), 90),
  'ok',
  'the same sale sent again is accepted'
);
select is(
  (select count(*)::text || ' ' || pg_temp.stock('a1') from public.sales where id = pg_temp.sid(1)),
  '1 18',
  'and is still one sale, with the stock taken out once'
);
create function pg_temp.repeat_receipt() returns text language plpgsql as $$
declare
  v text;
begin
  perform tests.as('sales');
  v := public.complete_sale(
    pg_temp.body('sales', 1, jsonb_build_array(pg_temp.l('a1', 9, 45)), pg_temp.cash(1), 0, '{}'),
    'A1B2'
  ) ->> 'receiptNo';
  perform tests.as_admin();
  return v;
end;
$$;
grant execute on all functions in schema pg_temp to authenticated;
select is(
  pg_temp.repeat_receipt(),
  'S1-20261106-A1B2-1',
  'a repeat returns the first result, whatever the rest says'
);
select is(pg_temp.stock('a1'), 18::numeric, 'and takes no stock out');
select is(
  pg_temp.sale('special', 1, jsonb_build_array(pg_temp.l('a1', 1, 45)), pg_temp.cash(45), 45),
  'invalid_input',
  'another user cannot reuse a sale id'
);

-- ---- Cash rounding to the peso, PHP 0.50 up (POS-04) -----------------------------------------
select is(
  pg_temp.sale('sales', 2, jsonb_build_array(pg_temp.l('a2', 1.25, 99)), pg_temp.cash(200), 124),
  'ok',
  '1.25 kg of rice at ₱99.00 (₱123.75) paid in cash'
);
select is(pg_temp.row(2), '123.75 | 0.25 | 124.00 | 76.00 | - |  | waiting', 'is charged ₱124.00: rounding +₱0.25, change ₱76.00');
select is(pg_temp.stock('a2'), 8.75::numeric, 'and 8.75 kg of rice are left');
select is(
  pg_temp.sale('sales', 3, jsonb_build_array(pg_temp.l('a2', 0.5, 247)), pg_temp.cash(124), 124),
  'ok',
  '₱123.50 in cash'
);
select is(pg_temp.row(3), '123.50 | 0.50 | 124.00 | 0.00 | - | price_changed | waiting', 'exactly ₱0.50 rounds up to ₱124.00 (the made-up price is flagged)');
select is(
  pg_temp.sale('sales', 4, jsonb_build_array(pg_temp.l('a2', 0.49, 252)), pg_temp.cash(123), 123),
  'ok',
  '₱123.48 in cash'
);
select is(pg_temp.row(4), '123.48 | -0.48 | 123.00 | 0.00 | - | price_changed | waiting', 'rounds down to ₱123.00');
select is(
  pg_temp.sale('sales', 5, jsonb_build_array(pg_temp.l('a2', 1.25, 99)), '[{"method": "gcash", "amount": 123.75, "reference": "1012 345 678"}]', 123.75),
  'ok',
  '₱123.75 by GCash'
);
select is(pg_temp.row(5), '123.75 | 0.00 | 123.75 | 0.00 | - |  | waiting', 'GCash stays exact');
select is(
  (select concat_ws(' | ', method, amount, reference, coalesce(account_label, '-')) from public.sale_payments where sale_id = pg_temp.sid(5)),
  'gcash | 123.75 | 1012345678 | -',
  'the reference is kept without spaces; no account was chosen'
);
select is(
  pg_temp.sale(
    'sales', 6, jsonb_build_array(pg_temp.l('a2', 1.25, 99)),
    '[{"method": "maya", "amount": 50, "reference": "MY-7788", "account_id": "00000000-0000-4000-8000-0000000000b2"}, {"method": "cash", "amount": 100}]',
    124
  ),
  'ok',
  'a split: ₱50.00 by Maya, the rest (₱73.75) in cash'
);
select is(pg_temp.row(6), '123.75 | 0.25 | 124.00 | 26.00 | - |  | waiting', 'only the cash part is rounded: ₱74.00 cash, change ₱26.00');
select is(
  (select string_agg(concat_ws(' ', method, amount, coalesce(account_label, '-')), ', ' order by line_no) from public.sale_payments where sale_id = pg_temp.sid(6)),
  'maya 50.00 Store Maya, cash 74.00 -',
  'each payment is kept, Maya with a copy of the account''s label'
);
select is(
  pg_temp.sale('sales', 7, jsonb_build_array(pg_temp.l('a2', 1.25, 99)), pg_temp.cash(123.75), 123.75, '{"round_cash": false}'),
  'ok',
  'a device with rounding off charges the exact ₱123.75'
);
select is(pg_temp.row(7), '123.75 | 0.00 | 123.75 | 0.00 | - | settings_changed | waiting', 'kept exact, flagged because the store rounds now');

-- ---- Refused: what the device sent does not add up -------------------------------------------
select is(
  pg_temp.sale('sales', 8, jsonb_build_array(pg_temp.l('a1', 1, 45)), p_payments, p_total),
  p_expected,
  'refused: ' || p_case
)
from (values
  (pg_temp.cash(40), 45::numeric, 'cash_short', 'less cash than due'),
  (pg_temp.cash(50), 50::numeric, 'invalid_input', 'a total that is not what the lines add up to'),
  ('[{"method": "gcash", "amount": 40, "reference": "1234"}]'::jsonb, 45::numeric, 'invalid_input', 'GCash short with no cash for the rest'),
  ('[{"method": "gcash", "amount": 50, "reference": "1234"}]'::jsonb, 45::numeric, 'invalid_input', 'more by GCash than the sale'),
  ('[{"method": "gcash", "amount": 45}]'::jsonb, 45::numeric, 'invalid_input', 'GCash without a reference'),
  ('[{"method": "gcash", "amount": 45, "reference": "12"}]'::jsonb, 45::numeric, 'invalid_input', 'a reference too short'),
  ('[{"method": "credit", "amount": 45}]'::jsonb, 45::numeric, 'invalid_input', 'utang (not until step 12)'),
  ('[{"method": "cash", "amount": 20}, {"method": "cash", "amount": 30}]'::jsonb, 45::numeric, 'invalid_input', 'two cash payments'),
  ('[{"method": "gcash", "amount": 20, "reference": "1234"}, {"method": "maya", "amount": 25, "reference": "1234"}, {"method": "cash", "amount": 0}]'::jsonb, 45::numeric, 'invalid_input', 'a payment of ₱0'),
  ('[{"method": "gcash", "amount": 20, "reference": "AB12"}, {"method": "gcash", "amount": 25, "reference": "ab 12"}]'::jsonb, 45::numeric, 'invalid_input', 'the same reference twice in one sale'),
  ('[{"method": "gcash", "amount": 45, "reference": "1234", "account_id": "00000000-0000-4000-8000-0000000000b2"}]'::jsonb, 45::numeric, 'not_found', 'a GCash payment to the Maya account')
) as t (p_payments, p_total, p_expected, p_case);

select is(
  pg_temp.sale('sales', 8, p_lines, pg_temp.cash(100), 45, p_extra),
  p_expected,
  'refused: ' || p_case
)
from (values
  (jsonb_build_array(pg_temp.l('a1', 1.5, 30)), '{}'::jsonb, 'invalid_input', 'part of a pack (only kg and L take decimals)'),
  (jsonb_build_array(pg_temp.l('a1', 0, 45)), '{}'::jsonb, 'invalid_input', 'a quantity of 0'),
  (jsonb_build_array(pg_temp.l('a1', 1, 45.005)), '{}'::jsonb, 'invalid_input', 'a price with three decimals'),
  (jsonb_build_array(pg_temp.l('99', 1, 45)), '{}'::jsonb, 'not_found', 'a product that does not exist'),
  ('[]'::jsonb, '{}'::jsonb, 'invalid_input', 'no lines'),
  (jsonb_build_array(pg_temp.l('a1', 1, 45)), '{"receipt_no": "SP-20261106-A1B2-8"}'::jsonb, 'invalid_input', 'a receipt number with another user''s code'),
  (jsonb_build_array(pg_temp.l('a1', 1, 45)), '{"receipt_no": "S1-20261106-ZZZZ-8"}'::jsonb, 'invalid_input', 'a receipt number with another device''s tag'),
  (jsonb_build_array(pg_temp.l('a1', 1, 45)), '{"receipt_no": "S1-20261106-A1B2-1"}'::jsonb, 'receipt_taken', 'a receipt number already used'),
  (jsonb_build_array(pg_temp.l('a1', 1, 45)), '{"made_at": null}'::jsonb, 'invalid_input', 'no time it was made'),
  (jsonb_build_array(pg_temp.l('a1', 1, 45)), '{"offline": "no"}'::jsonb, 'invalid_input', 'a malformed offline flag')
) as t (p_lines, p_extra, p_expected, p_case);
select is(
  (select count(*) from public.sales where id = pg_temp.sid(8)),
  0::bigint,
  'none of the refused sales was saved'
);
select is(pg_temp.stock('a1'), 18::numeric, 'and no stock moved');

-- ---- POS-13: a reused GCash/Maya reference ---------------------------------------------------
select is(
  pg_temp.sale('special', 9, jsonb_build_array(pg_temp.l('a1', 1, 45)), '[{"method": "gcash", "amount": 45, "reference": "1012345678"}]', 45),
  'duplicate_reference',
  'online, a GCash reference already used is refused'
);
select is(
  pg_temp.sale('special', 9, jsonb_build_array(pg_temp.l('a1', 1, 45)), '[{"method": "maya", "amount": 45, "reference": "1012345678"}]', 45),
  'ok',
  'the same number on Maya is a different reference'
);
select is(
  pg_temp.sale('special', 10, jsonb_build_array(pg_temp.l('a1', 1, 45)), '[{"method": "gcash", "amount": 45, "reference": "1012 345 678"}]', 45, '{"offline": true}'),
  'ok',
  'made offline, the sale with the reused reference is saved'
);
select is(
  (select string_agg(receipt_no || ':' || array_to_string(flags, ','), ' ' order by receipt_no) from public.sales where id in (pg_temp.sid(5), pg_temp.sid(10))),
  'S1-20261106-A1B2-5:duplicate_reference SP-20261106-A1B2-10:duplicate_reference',
  'and both sales are flagged'
);
select is(
  (select concat_ws(' | ', after ->> 'reference', after ->> 'method', after -> 'others' ->> 0) from public.audit_logs where action = 'sale.duplicateReference'),
  '1012345678 | gcash | S1-20261106-A1B2-5',
  'the reuse is in the audit log for the Owner'
);

-- ---- POS-14 and POS-09: kept and flagged, never refused --------------------------------------
select is(
  pg_temp.sale('sales', 11, jsonb_build_array(pg_temp.l('a1', 1, 40), pg_temp.l('a3', 2, 5), pg_temp.l('a4', 3, 15)), pg_temp.cash(95), 95, '{"offline": true}'),
  'ok',
  'an offline sale at an old price, with an inactive product and more water than in stock'
);
select is(
  (select array_to_string(flags, ',') || ' | ' || made_offline from public.sales where id = pg_temp.sid(11)),
  'price_changed,product_inactive,stock_negative | true',
  'is saved with all three flags'
);
select is(
  (select string_agg(concat_ws(' ', sku, unit_price, coalesce(list_price::text, '-')), ', ' order by line_no) from public.sale_items where sale_id = pg_temp.sid(11)),
  'CK-12 40.00 45.00, OLD-1 5.00 -, WATER 15.00 -',
  'the customer keeps the ₱40.00 they paid; the ₱45.00 price now is kept beside it'
);
select is(pg_temp.stock('a4'), -2::numeric, 'water stock goes below zero (POS-09)');
select is(
  pg_temp.sale('sales', 12, jsonb_build_array(pg_temp.l('a1', 1, 45)), pg_temp.cash(45), 45, jsonb_build_object('made_at', now() + interval '2 hours')),
  'ok',
  'a device clock two hours ahead'
);
select is(
  (select array_to_string(flags, ',') || ' ' || (created_at = now()) from public.sales where id = pg_temp.sid(12)),
  'clock_ahead true',
  'is not believed: the sale takes the server''s time, flagged'
);
select is(
  pg_temp.sale('sales', 13, jsonb_build_array(pg_temp.l('a1', 1, 112)), pg_temp.cash(112), 112, '{"vat_rate": 12}'),
  'ok',
  'a sale made with VAT on at 12%'
);
select is(pg_temp.row(13), '112.00 | 0.00 | 112.00 | 0.00 | 12.00 | price_changed,settings_changed | waiting', 'keeps its rate and ₱12.00 VAT part (POS-07)');

-- ---- The drawer --------------------------------------------------------------------------------
select is(
  (select count(*) from public.sales where session_id is null),
  12::bigint,
  'every sale so far waits for a drawer'
);
select is(tests.run('sales', $$select public.open_drawer(1000, null, 'A1B2')$$), 'ok 1', 'Sales opens the drawer with ₱1,000');
select is(
  (select count(*) from public.sales where session_id is null),
  0::bigint,
  'the waiting sales join it'
);
select is(
  (select count(*) from public.sales where 'late' = any (flags)),
  0::bigint,
  'made today, they are not late'
);
select is(
  (select private.drawer_expected(id) from public.drawer_sessions where branch_id = 'tmain'),
  1000 + 90 + 124 + 124 + 123 + 74 + 123.75 + 95 + 45 + 112::numeric,
  'expected cash = opening + the cash part of every sale (not GCash or Maya)'
);
select is(
  pg_temp.sale('sales', 14, jsonb_build_array(pg_temp.l('a1', 1, 45)), pg_temp.cash(50), 45),
  'ok',
  'a sale with the drawer open'
);
select is(
  (select (session_id is not null)::text || ' ' || array_to_string(flags, ',') from public.sales where id = pg_temp.sid(14)),
  'true ',
  'joins it at once'
);
select is(
  pg_temp.sale('sales', 15, jsonb_build_array(pg_temp.l('a1', 1, 45)), pg_temp.cash(45), 45, jsonb_build_object('offline', true, 'made_at', now() - interval '1 day')),
  'ok',
  'a sale made offline yesterday syncs today'
);
select is(
  (select (session_id is not null)::text || ' ' || array_to_string(flags, ',') from public.sales where id = pg_temp.sid(15)),
  'true late',
  'joins today''s drawer, flagged late (its cash may be in yesterday''s count)'
);

-- A sale made yesterday that waits for a drawer is flagged late when one opens.
update public.drawer_sessions set status = 'closed', closed_at = now(), counted_cash = 1000 where branch_id = 'tmain';
select is(
  pg_temp.sale('sales', 16, jsonb_build_array(pg_temp.l('a1', 1, 45)), pg_temp.cash(45), 45, jsonb_build_object('offline', true, 'made_at', now() - interval '1 day')),
  'ok',
  'after the close, another of yesterday''s offline sales syncs'
);
select is(pg_temp.row(16), '45.00 | 0.00 | 45.00 | 0.00 | - |  | waiting', 'a closed drawer takes no more sales: it waits');
select lives_ok(
  $$select private.attach_waiting_sales('tmain', (select id from public.drawer_sessions where branch_id = 'tmain'), private.manila_today() + 1)$$,
  'tomorrow''s drawer opens'
);
select is(
  (select array_to_string(flags, ',') from public.sales where id = pg_temp.sid(16)),
  'late',
  'and the waiting sale joins it, flagged late'
);

-- ---- Who reads sales ---------------------------------------------------------------------------
select is(tests.rows('owner', 'select * from public.sales'), 15::bigint, 'the Owner reads every sale of the branch');
select is(tests.rows('special', 'select * from public.sales'), 2::bigint, 'Special Sales reads only their own sales');
select is(tests.rows('sales', 'select * from public.sales'), 13::bigint, 'Sales reads only their own sales');
select is(tests.rows('other_owner', 'select * from public.sales'), 0::bigint, 'an Owner of another branch reads none');
select is(tests.rows('owner', 'select * from public.sale_items'), 17::bigint, 'the Owner reads the lines (with their cost)');
select is(
  tests.rows(caller, 'select * from public.' || t),
  0::bigint,
  caller || ' reads no ' || t
)
from unnest(array['sales', 'special']) as caller
cross join unnest(array['sale_items', 'sale_payments']) as t;
select is(
  tests.rows(caller, 'select * from public.sales'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no sale'
)
from unnest(tests.no_access()) as caller;
select is(
  tests.run(caller, format($$update public.sales set total = 1 where id = %L$$, pg_temp.sid(1))),
  '42501',
  caller || ' cannot change a sale directly'
)
from unnest(array['owner', 'sales']) as caller;
select is(
  tests.run('owner', format($$delete from public.sales where id = %L$$, pg_temp.sid(1))),
  '42501',
  'the Owner cannot delete a sale'
);

select * from finish();
rollback;
