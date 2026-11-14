-- Sales history (SRS 6.1, POS-10 to POS-12; the owner's decisions of Nov 13, 2026): staff see their
-- own sales for the last 30 days, the Owner every sale; a sale's lines never show its cost.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, stock_qty, active)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 50, true),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'RICE', 'Rice', '00000000-0000-4000-8000-0000000000c1', 'kg', 99, 50, true);

-- Sales at noon Manila time, n days ago.
create function pg_temp.at(p_days int) returns timestamptz language sql as $$
  select ((private.manila_today() - p_days)::timestamp + interval '12 hours') at time zone 'Asia/Manila';
$$;
create function pg_temp.sale(p_n int, p_who text, p_days int, p_total numeric, p_method text) returns void language sql as $$
  insert into public.sales (id, branch_id, receipt_no, salesperson_id, salesperson_name, device_tag, subtotal, total, created_at)
  values (('00000000-0000-4000-8000-0000000009' || lpad(p_n::text, 2, '0'))::uuid, 'tmain',
    (case p_who when 'special' then 'SP' else 'S1' end) || '-20261114-A1B2-' || p_n,
    tests.uid(p_who), initcap(p_who), 'A1B2', p_total, p_total, pg_temp.at(p_days));
  insert into public.sale_payments (sale_id, line_no, branch_id, method, amount, reference)
  values (('00000000-0000-4000-8000-0000000009' || lpad(p_n::text, 2, '0'))::uuid, 1, 'tmain', p_method, p_total,
    case when p_method = 'cash' then null else 'REF-' || p_n end);
$$;
create function pg_temp.sid(p_n int) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-0000000009' || lpad(p_n::text, 2, '0'))::uuid;
$$;

select pg_temp.sale(1, 'sales', 0, 213.75, 'cash');
insert into public.sale_items (sale_id, line_no, product_id, name, sku, unit, qty, unit_price, unit_cost, line_total)
values
  (pg_temp.sid(1), 1, '00000000-0000-4000-8000-0000000000a1', 'Chips Classic', 'CK-12', 'pack', 2, 45, 30, 90),
  (pg_temp.sid(1), 2, '00000000-0000-4000-8000-0000000000a2', 'Rice', 'RICE', 'kg', 1.25, 99, 60, 123.75);
select pg_temp.sale(2, 'sales', 1, 45, 'gcash');
select pg_temp.sale(3, 'sales', 35, 90, 'cash');
select pg_temp.sale(4, 'special', 0, 45, 'maya');

create function pg_temp.history(p_caller text, p_args text default 'null, null') returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform tests.as(p_caller);
  execute format('select public.sales_history(%s)', p_args) into v;
  perform tests.as_admin();
  return v;
end;
$$;
create function pg_temp.receipts(p_json jsonb) returns text language sql as $$
  select string_agg(s ->> 'receiptNo', ' ' order by n)
  from jsonb_array_elements(p_json -> 'sales') with ordinality as t (s, n);
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- Who may read it -------------------------------------------------------------------------
select is(
  tests.run(caller, 'select public.sales_history(null, null)'),
  '42501',
  caller || ' cannot read sales history'
)
from unnest(array['anon', 'no_profile', 'deactivated', 'signed_out']) as caller;

-- ---- Staff: own sales, last 30 days ----------------------------------------------------------
select is(
  pg_temp.receipts(pg_temp.history('sales')),
  'S1-20261114-A1B2-1 S1-20261114-A1B2-2',
  'Sales sees their own sales of the last 30 days, newest first (not the 35-day-old one, not Special''s)'
);
select is(
  pg_temp.receipts(pg_temp.history('sales', format('%L, null, %L', private.manila_today() - 60, tests.uid('special')))),
  'S1-20261114-A1B2-1 S1-20261114-A1B2-2',
  'asking for 60 days or for someone else changes nothing'
);
select is(
  (pg_temp.history('sales', format('%L, null', private.manila_today() - 60)) ->> 'from')::date,
  private.manila_today() - 29,
  'and the range says so: it starts 29 days back'
);
select is(
  (select jsonb_build_object('items', s -> 'items', 'methods', s -> 'methods', 'total', s -> 'total', 'status', s -> 'status')
   from jsonb_array_elements(pg_temp.history('sales') -> 'sales') s where s ->> 'receiptNo' = 'S1-20261114-A1B2-1'),
  '{"items": 3, "methods": ["cash"], "total": 213.75, "status": "completed"}'::jsonb,
  '2 packs and a weighed line are 3 items; paid in cash'
);
select is(
  pg_temp.history('sales') -> 'days',
  format('[{"day": "%s", "count": 1, "total": 213.75}, {"day": "%s", "count": 1, "total": 45.00}]',
    private.manila_today(), private.manila_today() - 1)::jsonb,
  'each day''s count and total, for the day headings'
);
select is(
  pg_temp.receipts(pg_temp.history('special')),
  'SP-20261114-A1B2-4',
  'Special Sales also sees only their own'
);

-- ---- The Owner: every sale -------------------------------------------------------------------
select is(
  pg_temp.receipts(pg_temp.history('owner', format('%L, null', private.manila_today() - 60))),
  'SP-20261114-A1B2-4 S1-20261114-A1B2-1 S1-20261114-A1B2-2 S1-20261114-A1B2-3',
  'the Owner sees everyone''s sales, older ones too'
);
select is(
  pg_temp.receipts(pg_temp.history('owner', format('%L, null, %L', private.manila_today() - 60, tests.uid('special')))),
  'SP-20261114-A1B2-4',
  'and can pick one salesperson'
);
select is(
  pg_temp.receipts(pg_temp.history('other_owner')),
  null,
  'another branch''s Owner sees none of them'
);

-- ---- Paging ----------------------------------------------------------------------------------
select is(
  (select jsonb_build_object('first', pg_temp.receipts(h), 'more', h -> 'hasMore') from pg_temp.history('sales', 'null, null, null, null, null, 1') h),
  '{"first": "S1-20261114-A1B2-1", "more": true}'::jsonb,
  'a page of one says there is more'
);
select is(
  pg_temp.receipts(pg_temp.history('sales', format('null, null, null, %L, %L, 1', pg_temp.at(0), pg_temp.sid(1)))),
  'S1-20261114-A1B2-2',
  'the next page starts after the last one shown'
);

-- ---- One sale's detail -----------------------------------------------------------------------
create function pg_temp.detail(p_caller text, p_n int) returns text language sql as $$
  select tests.message(p_caller, format('select public.sale_detail(%L)', pg_temp.sid(p_n)));
$$;
create function pg_temp.detail_json(p_caller text, p_n int) returns jsonb language plpgsql as $$
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

select is(pg_temp.detail('sales', 1), 'ok', 'Sales opens their own sale');
select is(
  pg_temp.detail_json('sales', 1) -> 'lines',
  '[{"lineNo": 1, "name": "Chips Classic", "sku": "CK-12", "unit": "pack", "qty": 2, "unitPrice": 45.00, "discount": 0.00, "discountName": null, "lineTotal": 90.00},
    {"lineNo": 2, "name": "Rice", "sku": "RICE", "unit": "kg", "qty": 1.25, "unitPrice": 99.00, "discount": 0.00, "discountName": null, "lineTotal": 123.75}]'::jsonb,
  'with its lines, and never the cost'
);
select is(
  pg_temp.detail_json('sales', 2) -> 'payments',
  '[{"method": "gcash", "amount": 45.00, "reference": "REF-2", "accountLabel": null}]'::jsonb,
  'and its payments'
);
select is(pg_temp.detail('sales', 3), 'not_found', 'a sale older than 30 days is not shown to staff');
select is(pg_temp.detail('sales', 4), 'not_found', 'nor someone else''s sale');
select is(pg_temp.detail('owner', 3), 'ok', 'the Owner opens any sale');
select is(pg_temp.detail('other_owner', 1), 'not_found', 'but not another branch''s');
select is(tests.run('anon', format('select public.sale_detail(%L)', pg_temp.sid(1))), '42501', 'anon is refused');

select * from finish();
rollback;
