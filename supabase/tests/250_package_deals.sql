-- Package deals (SRS POS-03, POS-14, SYS-01; the owner's decisions of Nov 1 and Nov 12, 2026):
-- quantity deals over a mix of chosen products, bundles of specific items, whole units only,
-- as many full sets as the sale holds; complete_sale checks each deal's saving.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, stock_qty, active)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 50, true),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'CK-13', 'Chips Cheese', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 50, true),
  ('00000000-0000-4000-8000-0000000000a3', 'tmain', 'CK-14', 'Chips BBQ', '00000000-0000-4000-8000-0000000000c1', 'pack', 50, 50, true),
  ('00000000-0000-4000-8000-0000000000a4', 'tmain', 'COF-1', 'Coffee', '00000000-0000-4000-8000-0000000000c1', 'sachet', 14, 50, true),
  ('00000000-0000-4000-8000-0000000000a5', 'tmain', 'CRM-1', 'Creamer', '00000000-0000-4000-8000-0000000000c1', 'sachet', 8, 50, true),
  ('00000000-0000-4000-8000-0000000000a6', 'tmain', 'RICE', 'Rice', '00000000-0000-4000-8000-0000000000c1', 'kg', 99, 50, true);

create function pg_temp.p(p_n int) returns text language sql as $$
  select '00000000-0000-4000-8000-0000000000a' || p_n;
$$;
create function pg_temp.deal(p_name text) returns uuid language sql as $$
  select id from public.deals where name = p_name;
$$;
create function pg_temp.create(p_caller text, p_fields jsonb) returns text language sql as $$
  select tests.message(p_caller, format('select public.create_deal(%L)', p_fields));
$$;
create function pg_temp.update(p_caller text, p_id uuid, p_changes jsonb) returns text language sql as $$
  select tests.message(p_caller, format('select public.update_deal(%L, %L)', p_id, p_changes));
$$;
create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000008' || lpad(p_n::text, 2, '0'))::uuid;
$$;
-- One line: product n, qty, price, and its deal and share (or a preset).
create function pg_temp.l(p_n int, p_qty numeric, p_price numeric, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('product_id', pg_temp.p(p_n), 'qty', p_qty, 'unit_price', p_price) || p_extra;
$$;
create function pg_temp.share(p_deal text, p_off numeric) returns jsonb language sql as $$
  select jsonb_build_object('deal_id', pg_temp.deal(p_deal), 'discount', p_off);
$$;
create function pg_temp.sale(p_n int, p_lines jsonb, p_total numeric, p_extra jsonb default '{}')
returns text language sql as $$
  select tests.message(
    'sales',
    format(
      'select public.complete_sale(%L, %L)',
      jsonb_build_object(
        'id', pg_temp.sid(p_n), 'receipt_no', 'S1-20261112-A1B2-' || p_n,
        'made_at', now(), 'offline', false, 'round_cash', true, 'vat_rate', null,
        'total', p_total, 'lines', p_lines,
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', p_total))
      ) || p_extra,
      'A1B2'
    )
  );
$$;
create function pg_temp.totals(p_n int) returns text language sql as $$
  select concat_ws(' | ', subtotal, discount_total, total, array_to_string(flags, ','))
  from public.sales where id = pg_temp.sid(p_n);
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- Who defines them ------------------------------------------------------------------------
select is(
  pg_temp.create(caller, jsonb_build_object('name', 'Chips 3 for 100', 'kind', 'quantity', 'price', 100, 'set_size', 3, 'product_ids', jsonb_build_array(pg_temp.p(1)))),
  'This account has no access.',
  caller || ' cannot define a deal'
)
from unnest(array['no_profile', 'deactivated', 'signed_out', 'owner_aal1', 'sales', 'special']) as caller;
select is(tests.run('anon', $$select public.create_deal('{}')$$), '42501', 'anon cannot call create_deal');

select is(
  pg_temp.create('owner', jsonb_build_object('name', 'Chips 3 for ₱100', 'kind', 'quantity', 'price', 100, 'set_size', 3, 'product_ids', jsonb_build_array(pg_temp.p(1), pg_temp.p(2), pg_temp.p(3), pg_temp.p(1)))),
  'ok',
  'the Owner makes "any 3 chips for ₱100" over three flavours'
);
select is(
  (select concat_ws(' | ', kind, price, set_size, cardinality(product_ids), cardinality(qtys)) from public.deals where name = 'Chips 3 for ₱100'),
  'quantity | 100.00 | 3 | 3 | 0',
  'a product listed twice is kept once'
);
select is(
  pg_temp.create('owner', jsonb_build_object('name', 'Coffee + creamer ₱20', 'kind', 'bundle', 'price', 20, 'product_ids', jsonb_build_array(pg_temp.p(4), pg_temp.p(5)), 'qtys', jsonb_build_array(1, 1))),
  'ok',
  'and a bundle of 1 coffee + 1 creamer for ₱20'
);
select is(
  (select concat_ws(' | ', action, after ->> 'name', after ->> 'kind', after ->> 'price')
   from public.audit_logs where target_id = pg_temp.deal('Coffee + creamer ₱20')::text),
  'deal.create | Coffee + creamer ₱20 | bundle | 20.00',
  'each new deal is in the audit log'
);

select is(pg_temp.create('owner', fields), 'invalid_input', 'refused: ' || label)
from (values
  ('rice is sold by kg (whole units only, Nov 12)', jsonb_build_object('name', 'Rice deal', 'kind', 'quantity', 'price', 180, 'set_size', 2, 'product_ids', jsonb_build_array(pg_temp.p(6)))),
  ('a set of 1', jsonb_build_object('name', 'One', 'kind', 'quantity', 'price', 40, 'set_size', 1, 'product_ids', jsonb_build_array(pg_temp.p(1)))),
  ('no set size', jsonb_build_object('name', 'No size', 'kind', 'quantity', 'price', 40, 'product_ids', jsonb_build_array(pg_temp.p(1)))),
  ('a bundle of one item', jsonb_build_object('name', 'Solo', 'kind', 'bundle', 'price', 10, 'product_ids', jsonb_build_array(pg_temp.p(4)), 'qtys', jsonb_build_array(2))),
  ('a bundle listing an item twice', jsonb_build_object('name', 'Twice', 'kind', 'bundle', 'price', 10, 'product_ids', jsonb_build_array(pg_temp.p(4), pg_temp.p(4)), 'qtys', jsonb_build_array(1, 1))),
  ('a bundle without its counts', jsonb_build_object('name', 'Counts', 'kind', 'bundle', 'price', 10, 'product_ids', jsonb_build_array(pg_temp.p(4), pg_temp.p(5)))),
  ('a count of 1.5', jsonb_build_object('name', 'Half', 'kind', 'bundle', 'price', 10, 'product_ids', jsonb_build_array(pg_temp.p(4), pg_temp.p(5)), 'qtys', jsonb_build_array(1.5, 1))),
  ('a price of 0', jsonb_build_object('name', 'Free', 'kind', 'quantity', 'price', 0, 'set_size', 2, 'product_ids', jsonb_build_array(pg_temp.p(1)))),
  ('another kind', jsonb_build_object('name', 'Other', 'kind', 'bogo', 'price', 10, 'set_size', 2, 'product_ids', jsonb_build_array(pg_temp.p(1))))
) as t (label, fields);
select is(
  pg_temp.create('owner', jsonb_build_object('name', 'chips 3 FOR ₱100', 'kind', 'quantity', 'price', 90, 'set_size', 3, 'product_ids', jsonb_build_array(pg_temp.p(1)))),
  'name_taken',
  'names are unique whatever their case'
);
select is(
  pg_temp.create('other_owner', jsonb_build_object('name', 'Theirs', 'kind', 'quantity', 'price', 90, 'set_size', 3, 'product_ids', jsonb_build_array(pg_temp.p(1)))),
  'not_found',
  'another branch cannot use this branch''s products'
);

select is(tests.rows(caller, 'select 1 from public.deals'), 2::bigint, caller || ' sees the deals')
from unnest(array['sales', 'special', 'owner']) as caller;
select is(tests.rows('other_owner', 'select 1 from public.deals'), 0::bigint, 'another branch sees none');
select is(tests.run('sales', $$update public.deals set price = 1$$), '42501', 'staff cannot change a deal directly');

-- ---- Sales with deals ------------------------------------------------------------------------
-- 2 Classic + 1 Cheese = ₱135 → one set at ₱100: ₱35 off, split 23.34 + 11.66.
select is(
  pg_temp.sale(1, jsonb_build_array(
    pg_temp.l(1, 2, 45, pg_temp.share('Chips 3 for ₱100', 23.34)),
    pg_temp.l(2, 1, 45, pg_temp.share('Chips 3 for ₱100', 11.66))
  ), 100),
  'ok',
  'a mixed set of three flavours'
);
select is(pg_temp.totals(1), '135.00 | 35.00 | 100.00 | ', 'subtotal ₱135, ₱35 off, total ₱100, no flag');
select is(
  (select string_agg(concat_ws(' ', name, discount, coalesce(deal_name, '-'), line_total), ' / ' order by line_no)
   from public.sale_items where sale_id = pg_temp.sid(1)),
  'Chips Classic 23.34 Chips 3 for ₱100 66.66 / Chips Cheese 11.66 Chips 3 for ₱100 33.34',
  'each item stays its own line, with its share and the deal''s name'
);

-- 3 Classic + 3 Cheese at ₱45 and 1 BBQ at ₱50: 2 sets of the 6 dearest (₱275) for ₱200 =
-- ₱75 off; the leftover is a ₱45 pack at the regular price.
select is(
  pg_temp.sale(2, jsonb_build_array(
    pg_temp.l(1, 3, 45, pg_temp.share('Chips 3 for ₱100', 31.64)),
    pg_temp.l(2, 3, 45, pg_temp.share('Chips 3 for ₱100', 31.64)),
    pg_temp.l(3, 1, 50, pg_temp.share('Chips 3 for ₱100', 11.72))
  ), 245),
  'ok',
  'two sets out of seven packs'
);
select is(pg_temp.totals(2), '320.00 | 75.00 | 245.00 | ', '₱320 − ₱75 = ₱245');

-- 2 Coffee + 3 Creamer: 2 bundles (₱44) for ₱40 = ₱4 off; one creamer left at ₱8.
select is(
  pg_temp.sale(3, jsonb_build_array(
    pg_temp.l(4, 2, 14, pg_temp.share('Coffee + creamer ₱20', 2.15)),
    pg_temp.l(5, 3, 8, pg_temp.share('Coffee + creamer ₱20', 1.85))
  ), 48),
  'ok',
  'two bundles, one creamer left over'
);
select is(pg_temp.totals(3), '52.00 | 4.00 | 48.00 | ', '₱52 − ₱4 = ₱48');

-- A line in the deal that is all leftover takes nothing off.
select is(
  pg_temp.sale(4, jsonb_build_array(
    pg_temp.l(1, 3, 45, pg_temp.share('Chips 3 for ₱100', 35)),
    pg_temp.l(2, 1, 45, pg_temp.share('Chips 3 for ₱100', 0))
  ), 145),
  'ok',
  'a leftover line with a share of 0'
);
select is(pg_temp.totals(4), '180.00 | 35.00 | 145.00 | ', 'no flag');

-- ---- Refused, and flagged --------------------------------------------------------------------
select is(
  pg_temp.sale(10, jsonb_build_array(pg_temp.l(1, 3, 45, pg_temp.share('Chips 3 for ₱100', 35) || jsonb_build_object('discount_id', '00000000-0000-4000-8000-000000000999'))), 100),
  'invalid_input',
  'a line cannot have a deal and a preset'
);
select is(
  pg_temp.sale(11, jsonb_build_array(pg_temp.l(1, 3, 45, jsonb_build_object('deal_id', '00000000-0000-4000-8000-000000000999', 'discount', 35))), 100),
  'not_found',
  'an unknown deal is refused'
);
select is(
  pg_temp.sale(12, jsonb_build_array(pg_temp.l(1, 3, 45, pg_temp.share('Chips 3 for ₱100', -1))), 136),
  'invalid_input',
  'a negative share is refused'
);
select is(
  pg_temp.sale(13, jsonb_build_array(pg_temp.l(1, 1, 45, pg_temp.share('Chips 3 for ₱100', 46))), 0),
  'invalid_input',
  'a share larger than its line is refused'
);

-- The device took ₱40 off where the deal now gives ₱35: kept, flagged.
select is(
  pg_temp.sale(14, jsonb_build_array(pg_temp.l(1, 3, 45, pg_temp.share('Chips 3 for ₱100', 40))), 95),
  'ok',
  'a deal that does not add up is kept'
);
select is(pg_temp.totals(14), '135.00 | 40.00 | 95.00 | deal_changed', 'and flagged deal_changed');

-- Not a full set: flagged.
select is(
  pg_temp.sale(15, jsonb_build_array(pg_temp.l(1, 2, 45, pg_temp.share('Chips 3 for ₱100', 10))), 80),
  'ok',
  'two packs are not a set: kept'
);
select is(pg_temp.totals(15), '90.00 | 10.00 | 80.00 | deal_changed', 'and flagged');

-- Switched off, then a sale made offline syncs: kept, flagged (POS-14).
select is(pg_temp.update('owner', pg_temp.deal('Chips 3 for ₱100'), '{"active": false}'), 'ok', 'the Owner switches the chips deal off');
select is(
  pg_temp.sale(16, jsonb_build_array(pg_temp.l(1, 3, 45, pg_temp.share('Chips 3 for ₱100', 35))), 100, '{"offline": true}'),
  'ok',
  'an offline sale that used it is saved'
);
select is(pg_temp.totals(16), '135.00 | 35.00 | 100.00 | deal_changed', 'and flagged');

-- ---- Changing a deal -------------------------------------------------------------------------
select is(pg_temp.update('owner', pg_temp.deal('Coffee + creamer ₱20'), '{"price": 19}'), 'ok', 'the Owner changes the bundle''s price');
select is(
  (select concat_ws(' | ', action, before ->> 'price', after ->> 'price', before ->> 'name') from public.audit_logs where action = 'deal.update' and after ? 'price'),
  'deal.update | 20.00 | 19.00 | Coffee + creamer ₱20',
  'the change is in the audit log with old and new'
);
select is(pg_temp.update('owner', pg_temp.deal('Coffee + creamer ₱20'), jsonb_build_object('product_ids', jsonb_build_array(pg_temp.p(4), pg_temp.p(6)))), 'invalid_input', 'a weighed product cannot join a deal');
select is(pg_temp.update('owner', pg_temp.deal('Coffee + creamer ₱20'), '{"kind": "quantity"}'), 'invalid_input', 'the kind never changes');
select is(pg_temp.update('sales', pg_temp.deal('Coffee + creamer ₱20'), '{"price": 1}'), 'This account has no access.', 'Sales cannot change a deal');
select is(pg_temp.update('owner', '00000000-0000-4000-8000-000000000999', '{"active": true}'), 'not_found', 'an unknown deal is not found');
select is(
  (select deal_name from public.sale_items where sale_id = pg_temp.sid(3) and line_no = 1),
  'Coffee + creamer ₱20',
  'a past sale keeps the deal it had'
);

select * from finish();
rollback;
