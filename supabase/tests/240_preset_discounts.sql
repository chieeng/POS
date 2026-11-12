-- Preset discounts (SRS POS-03, POS-14, SYS-01; the owner's decisions of Nov 1 and Nov 12, 2026):
-- the Owner defines them, staff pick one per line, complete_sale works the amount out again
-- and flags a sale whose discount no longer matches the preset.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values
  ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks'),
  ('00000000-0000-4000-8000-0000000000c2', 'tmain', 'Grains');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, stock_qty, active)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 20, true),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'RICE', 'Rice', '00000000-0000-4000-8000-0000000000c2', 'kg', 99, 10, true),
  ('00000000-0000-4000-8000-0000000000a3', 'tmain', 'CANDY', 'Candy', '00000000-0000-4000-8000-0000000000c1', 'pc', 5, 50, true);

create function pg_temp.disc(p_name text) returns uuid language sql as $$
  select id from public.discounts where name = p_name;
$$;
create function pg_temp.create(p_caller text, p_fields jsonb) returns text language sql as $$
  select tests.message(p_caller, format('select public.create_discount(%L)', p_fields));
$$;
create function pg_temp.update(p_caller text, p_id uuid, p_changes jsonb) returns text language sql as $$
  select tests.message(p_caller, format('select public.update_discount(%L, %L)', p_id, p_changes));
$$;
create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000007' || lpad(p_n::text, 2, '0'))::uuid;
$$;
-- One line of p_qty of product p_product at p_price, with a preset and what the device took off.
create function pg_temp.sale(
  p_n int, p_product text, p_qty numeric, p_price numeric, p_discount uuid, p_off numeric,
  p_total numeric, p_cash numeric, p_extra jsonb default '{}'
) returns text language sql as $$
  select tests.message(
    'sales',
    format(
      'select public.complete_sale(%L, %L)',
      jsonb_build_object(
        'id', pg_temp.sid(p_n),
        'receipt_no', 'S1-20261112-A1B2-' || p_n,
        'made_at', now(), 'offline', false, 'round_cash', true, 'vat_rate', null,
        'total', p_total,
        'lines', jsonb_build_array(
          jsonb_build_object(
            'product_id', '00000000-0000-4000-8000-0000000000' || p_product,
            'qty', p_qty, 'unit_price', p_price
          ) || case when p_discount is null and p_off is null then '{}'::jsonb
               else jsonb_build_object('discount_id', p_discount, 'discount', p_off) end
        ),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', p_cash))
      ) || p_extra,
      'A1B2'
    )
  );
$$;
create function pg_temp.row(p_n int) returns text language sql as $$
  select concat_ws(' | ', s.subtotal, s.discount_total, s.rounding, s.total,
    coalesce(s.vat_amount::text, '-'), array_to_string(s.flags, ','),
    i.discount, coalesce(i.discount_name, '-'), i.line_total)
  from public.sales s join public.sale_items i on i.sale_id = s.id
  where s.id = pg_temp.sid(p_n);
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- Who defines them ------------------------------------------------------------------------
select is(
  pg_temp.create(caller, '{"name": "Suki 10%", "kind": "percent", "value": 10, "applies_to": "all"}'),
  'This account has no access.',
  caller || ' cannot define a discount'
)
from unnest(array['no_profile', 'deactivated', 'signed_out', 'owner_aal1', 'sales', 'special']) as caller;
select is(
  tests.run('anon', $$select public.create_discount('{}')$$),
  '42501',
  'anon cannot call create_discount'
);

select is(
  pg_temp.create('owner', '{"name": "Suki 10%", "kind": "percent", "value": 10, "applies_to": "all"}'),
  'ok',
  'the Owner defines 10% off every product'
);
select is(
  pg_temp.create('owner', '{"name": "₱5 off chips", "kind": "fixed", "value": 5, "applies_to": "products", "product_ids": ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a3"]}'),
  'ok',
  'and ₱5 off each unit of two products'
);
select is(
  pg_temp.create('owner', '{"name": "Grains ₱10/kg", "kind": "fixed", "value": 10, "applies_to": "categories", "category_ids": ["00000000-0000-4000-8000-0000000000c2"]}'),
  'ok',
  'and ₱10 off each kg of a category'
);
select is(
  (select concat_ws(' | ', kind, value, applies_to, cardinality(product_ids), cardinality(category_ids), active)
   from public.discounts where id = pg_temp.disc('₱5 off chips')),
  'fixed | 5.00 | products | 2 | 0 | t',
  'it is kept with its products'
);
select is(
  (select concat_ws(' | ', action, after ->> 'name', after ->> 'kind', after ->> 'value')
   from public.audit_logs where target_id = pg_temp.disc('Suki 10%')::text),
  'discount.create | Suki 10% | percent | 10.00',
  'each new preset is in the audit log'
);

select is(
  pg_temp.create('owner', fields),
  'invalid_input',
  'refused: ' || fields::text
)
from unnest(array[
  '{"name": "Zero", "kind": "percent", "value": 0, "applies_to": "all"}',
  '{"name": "Too much", "kind": "percent", "value": 100.01, "applies_to": "all"}',
  '{"name": "Thirds", "kind": "fixed", "value": 3.333, "applies_to": "all"}',
  '{"name": "Text", "kind": "fixed", "value": "5", "applies_to": "all"}',
  '{"name": "No products", "kind": "fixed", "value": 5, "applies_to": "products", "product_ids": []}',
  '{"name": "No categories", "kind": "percent", "value": 5, "applies_to": "categories"}',
  '{"name": "Typed", "kind": "manual", "value": 5, "applies_to": "all"}',
  '{"name": "  ", "kind": "percent", "value": 5, "applies_to": "all"}',
  '{"name": "Extra", "kind": "percent", "value": 5, "applies_to": "all", "starts": "2026-12-01"}'
]::jsonb[]) as fields;
select is(
  pg_temp.create('owner', '{"name": "suki 10%", "kind": "percent", "value": 5, "applies_to": "all"}'),
  'name_taken',
  'two presets cannot share a name, whatever its case'
);
select is(
  pg_temp.create('other_owner', '{"name": "Theirs", "kind": "fixed", "value": 1, "applies_to": "products", "product_ids": ["00000000-0000-4000-8000-0000000000a1"]}'),
  'not_found',
  'another branch cannot point a preset at this branch''s products'
);

-- ---- Who reads them --------------------------------------------------------------------------
select is(
  tests.rows(caller, 'select 1 from public.discounts'),
  3::bigint,
  caller || ' sees the presets to pick from'
)
from unnest(array['sales', 'special', 'owner']) as caller;
select is(tests.rows('other_owner', 'select 1 from public.discounts'), 0::bigint, 'another branch sees none');
select is(tests.rows('anon', 'select 1 from public.discounts'), -1::bigint, 'anon is refused');
select is(
  tests.run('sales', $$update public.discounts set value = 90$$),
  '42501',
  'staff cannot change a preset directly'
);

-- ---- Sales with a preset ---------------------------------------------------------------------
-- 3 packs at ₱45 = ₱135.00; 10% = ₱13.50; ₱121.50 charged ₱122.00 in cash (.50 up).
select is(
  pg_temp.sale(1, 'a1', 3, 45, pg_temp.disc('Suki 10%'), 13.50, 122, 122),
  'ok',
  'Sales sells 3 packs with Suki 10%'
);
select is(
  pg_temp.row(1),
  '135.00 | 13.50 | 0.50 | 122.00 | - |  | 13.50 | Suki 10% | 121.50',
  'subtotal ₱135, discount ₱13.50, rounding +₱0.50, total ₱122; the line keeps the preset''s name'
);
select is(
  (select amount from public.sale_payments where sale_id = pg_temp.sid(1)),
  122.00::numeric,
  'the drawer gets ₱122.00'
);

-- 1.25 kg of rice at ₱99 = ₱123.75; ₱10 a kg off = ₱12.50; ₱111.25 charged ₱111.00.
select is(
  pg_temp.sale(2, 'a2', 1.25, 99, pg_temp.disc('Grains ₱10/kg'), 12.50, 111, 111),
  'ok',
  'a per-kg preset on 1.25 kg'
);
select is(
  pg_temp.row(2),
  '123.75 | 12.50 | -0.25 | 111.00 | - |  | 12.50 | Grains ₱10/kg | 111.25',
  '₱12.50 off, rounding −₱0.25, total ₱111'
);

-- VAT is on what the customer pays for the goods: ₱90 − ₱10 = ₱80 at 12% = ₱8.57.
update public.branches set vat_registered = true where id = 'tmain';
select is(
  pg_temp.sale(3, 'a1', 2, 45, pg_temp.disc('₱5 off chips'), 10, 80, 80, '{"vat_rate": 12}'),
  'ok',
  '₱5 off each of 2 packs, VAT registered'
);
select is(
  pg_temp.row(3),
  '90.00 | 10.00 | 0.00 | 80.00 | 8.57 |  | 10.00 | ₱5 off chips | 80.00',
  'VAT ₱8.57 is of the discounted ₱80'
);
update public.branches set vat_registered = false where id = 'tmain';

-- ---- What is refused, and what is flagged ----------------------------------------------------
select is(
  pg_temp.sale(10, 'a1', 1, 45, null, 5, 40, 40),
  'invalid_input',
  'a discount with no preset is refused: staff never type one'
);
select is(
  pg_temp.sale(11, 'a1', 1, 45, '00000000-0000-4000-8000-000000000999', 4.50, 41, 41),
  'not_found',
  'an unknown preset is refused'
);
select is(
  pg_temp.sale(12, 'a1', 1, 45, pg_temp.disc('Suki 10%'), 46, 0, 0),
  'invalid_input',
  'a discount larger than the line is refused'
);
select is(
  pg_temp.sale(13, 'a1', 1, 45, pg_temp.disc('Suki 10%'), 0, 45, 45),
  'invalid_input',
  'a preset with nothing taken off is refused'
);
select is(
  (select count(*) from public.sales where id in (pg_temp.sid(10), pg_temp.sid(11), pg_temp.sid(12), pg_temp.sid(13))),
  0::bigint,
  'none of them was saved'
);

-- The device took ₱5 off but the preset now says ₱4.50: kept, flagged.
select is(
  pg_temp.sale(14, 'a1', 1, 45, pg_temp.disc('Suki 10%'), 5, 40, 40),
  'ok',
  'a discount that does not match the preset is kept'
);
select is(pg_temp.row(14), '45.00 | 5.00 | 0.00 | 40.00 | - | discount_changed | 5.00 | Suki 10% | 40.00', 'and flagged discount_changed');

-- Candy costs ₱5: "₱5 off" is not offered on it (it would be free).
select is(
  pg_temp.sale(15, 'a3', 2, 5, pg_temp.disc('₱5 off chips'), 10, 0, 0),
  'invalid_input',
  'a discount equal to the whole line is not a sale'
);
select is(
  pg_temp.sale(16, 'a3', 2, 5, pg_temp.disc('₱5 off chips'), 4, 6, 6),
  'ok',
  'an offline-changed amount on a product the preset no longer suits is kept'
);
select is(pg_temp.row(16), '10.00 | 4.00 | 0.00 | 6.00 | - | discount_changed | 4.00 | ₱5 off chips | 6.00', 'and flagged');

-- Switched off after the sale was made offline: kept, flagged (POS-14).
select is(pg_temp.update('owner', pg_temp.disc('Suki 10%'), '{"active": false}'), 'ok', 'the Owner switches Suki 10% off');
select is(
  (select concat_ws(' | ', action, before ->> 'active', after ->> 'active', before ->> 'name')
   from public.audit_logs where action = 'discount.update'),
  'discount.update | true | false | Suki 10%',
  'the change is in the audit log with old and new'
);
select is(
  pg_temp.sale(17, 'a1', 1, 45, pg_temp.disc('Suki 10%'), 4.50, 41, 41, '{"offline": true}'),
  'ok',
  'an offline sale that used it is still saved'
);
select is(pg_temp.row(17), '45.00 | 4.50 | 0.50 | 41.00 | - | discount_changed | 4.50 | Suki 10% | 40.50', 'flagged for the Owner');

-- A product on the "products" preset only: rice is not on "₱5 off chips".
select is(
  pg_temp.sale(18, 'a2', 1, 99, pg_temp.disc('₱5 off chips'), 5, 94, 94),
  'ok',
  'a preset used on a product it does not cover is kept'
);
select is(
  (select array_to_string(flags, ',') from public.sales where id = pg_temp.sid(18)),
  'discount_changed',
  'and flagged'
);

-- ---- Changing a preset -----------------------------------------------------------------------
select is(
  pg_temp.update('owner', pg_temp.disc('₱5 off chips'), '{"applies_to": "all"}'),
  'ok',
  'a products preset can become an every-product one'
);
select is(
  (select concat_ws(' | ', applies_to, cardinality(product_ids)) from public.discounts where id = pg_temp.disc('₱5 off chips')),
  'all | 0',
  'its product list is cleared'
);
select is(pg_temp.update('sales', pg_temp.disc('₱5 off chips'), '{"value": 50}'), 'This account has no access.', 'Sales cannot change it');
select is(pg_temp.update('owner', pg_temp.disc('₱5 off chips'), '{"value": -1}'), 'invalid_input', 'a negative amount is refused');
select is(pg_temp.update('owner', pg_temp.disc('₱5 off chips'), '{"name": "Grains ₱10/KG"}'), 'name_taken', 'another preset''s name is refused');
select is(pg_temp.update('owner', '00000000-0000-4000-8000-000000000999', '{"active": true}'), 'not_found', 'an unknown preset is not found');
select is(
  (select discount_name from public.sale_items where sale_id = pg_temp.sid(3)),
  '₱5 off chips',
  'a past sale keeps the discount it had'
);

-- ---- The drawer report counts them -----------------------------------------------------------
select is(tests.run('sales', $$select public.open_drawer(1000, null, 'A1B2')$$), 'ok 1', 'a drawer opens');
select is(
  pg_temp.sale(20, 'a1', 3, 45, pg_temp.disc('Grains ₱10/kg'), 30, 105, 105),
  'ok',
  'one more sale, with a flagged discount, joins it'
);
create function pg_temp.report() returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform tests.as('owner');
  v := public.drawer_sales((select id from public.drawer_sessions where status = 'open'));
  perform tests.as_admin();
  return v;
end;
$$;
select is(
  (select jsonb_build_object('discounts', r -> 'discounts', 'person', r -> 'salespeople' -> 0 -> 'discounts')
   from pg_temp.report() r),
  '{"discounts": 84.50, "person": 84.50}'::jsonb,
  'the report shows the discounts given, in all and by salesperson (the waiting sales joined: 13.50 + 12.50 + 10 + 5 + 4 + 4.50 + 5 + 30)'
);

select * from finish();
rollback;
