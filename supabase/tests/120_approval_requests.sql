-- Owner approval requests (SRS 3.9, APPR-01..05; PROD-04): Special Sales asks, the Owner decides.
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name, active)
values
  ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks', true),
  ('00000000-0000-4000-8000-0000000000c2', 'tmain', 'Drinks', true),
  ('00000000-0000-4000-8000-0000000000c3', 'tmain', 'Old stock', false);
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price, reorder_level)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic',
   '00000000-0000-4000-8000-0000000000c1', 'pack', 45, 10),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'WATER-500', 'Water 500 ml',
   '00000000-0000-4000-8000-0000000000c2', 'pc', 15, 0);

create function pg_temp.ask(p_caller text, p_changes text, p_reason text default 'Price went up')
returns text language sql as $$
  select tests.message(
    p_caller,
    format(
      'select public.request_product_change(%L, %L, %L, %L)',
      '00000000-0000-4000-8000-0000000000a1', p_changes, p_reason, 'A1B2'
    )
  );
$$;
create function pg_temp.request_id(p_status text default 'pending') returns uuid language sql as $$
  select id from public.approval_requests
  where target_id = '00000000-0000-4000-8000-0000000000a1' and status = p_status
  order by created_at desc limit 1;
$$;
create function pg_temp.decide(p_caller text, p_approve boolean, p_note text default null)
returns text language sql as $$
  select tests.message(
    p_caller,
    format('select public.decide_approval(%L, %L, %L, %L)', pg_temp.request_id(), p_approve, p_note, 'A1B2')
  );
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---- Who may ask -------------------------------------------------------------------------------
select is(
  pg_temp.ask(caller, '{"sell_price": 50}'),
  'This account has no access.',
  caller || ' cannot make a product request (the Owner edits directly; Sales does not edit)'
)
from unnest(array['owner', 'sales', 'owner_aal1', 'deactivated', 'signed_out']) as caller;

-- ---- A request changes nothing until decided (APPR-02) ------------------------------------------
select is(pg_temp.ask('special', '{"sell_price": 48.5, "name": "Chips Classic"}'), 'ok', 'Special Sales asks for a new price');
select is(
  (select sell_price from public.products where sku = 'CK-12'),
  45.00::numeric,
  'nothing changes until the Owner decides'
);
select is(
  (
    select concat_ws(' | ', type, status, before, after, reason, requested_by = tests.uid('special'))
    from public.approval_requests
  ),
  'product_edit | pending | {"sell_price": 45.00} | {"sell_price": 48.50} | Price went up | t',
  'the request keeps only what changes: the value then and the value asked for, with the reason'
);
select is(
  (select after ->> 'label' from public.audit_logs where action = 'approval.request'),
  'Chips Classic',
  'asking is audit-logged'
);

-- ---- Checks on the request -----------------------------------------------------------------------
select is(pg_temp.ask('special', '{"reorder_level": 20}'), 'request_pending', 'one pending request per product per requester');
select is(pg_temp.ask('special', '{"sell_price": 45}', 'x'), 'no_change', 'asking for the current value is refused as no change');
select is(
  tests.message(
    'special',
    format(
      'select public.request_product_change(%L, %L, %L)',
      '00000000-0000-4000-8000-0000000000a2', '{"sell_price": 15}', 'same'
    )
  ),
  'no_change',
  'a request must change something'
);
select is(
  tests.message(
    'special',
    format(
      'select public.request_product_change(%L, %L, %L)',
      '00000000-0000-4000-8000-0000000000a2', changes, 'reason'
    )
  ),
  expected,
  'refused like the Owner''s edit would be: ' || changes
)
from (values
  ('{"sku": "ck-12"}', 'sku_taken'),
  ('{"sku": "CK 12"}', 'invalid_input'),
  ('{"sell_price": 0}', 'invalid_input'),
  ('{"category_id": "00000000-0000-4000-8000-0000000000c3"}', 'category_inactive'),
  ('{"stock_qty": 100}', 'invalid_input')
) as t (changes, expected);
select is(
  tests.message(
    'special',
    format(
      'select public.request_product_change(%L, %L, %L)',
      '00000000-0000-4000-8000-0000000000a2', '{"sell_price": 16}', reason
    )
  ),
  'invalid_input',
  'a reason is required: ' || coalesce(quote_literal(reason), 'null')
)
from unnest(array['', '   ', null, repeat('x', 201)]) as reason;
select is(
  (select count(*) from public.products where sku = 'WATER-500' and sell_price = 15),
  1::bigint,
  'trying a refused request changed nothing'
);

-- ---- Who sees requests (APPR-03, APPR-05) -------------------------------------------------------
select is(tests.rows('owner', 'select * from public.approval_requests'), 1::bigint, 'the Owner sees the branch''s requests');
select is(tests.rows('special', 'select * from public.approval_requests'), 1::bigint, 'the requester sees their own');
select is(
  tests.rows(caller, 'select * from public.approval_requests'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' sees no request'
)
from unnest(tests.no_access() || array['sales', 'other_owner']) as caller;

-- ---- Deciding --------------------------------------------------------------------------------------
select is(
  pg_temp.decide(caller, true),
  'This account has no access.',
  caller || ' cannot decide a request'
)
from unnest(array['special', 'sales', 'owner_aal1']) as caller;
select is(
  tests.message('other_owner', format('select public.decide_approval(%L, true)', pg_temp.request_id())),
  'not_found',
  'an Owner of another branch cannot decide it'
);

select is(pg_temp.decide('owner', true, 'OK, supplier price'), 'ok', 'the Owner approves (APPR-04)');
select is(
  (select sell_price from public.products where sku = 'CK-12'),
  48.50::numeric,
  'the change is applied'
);
select is(
  (
    select concat_ws(' | ', status, owner_note, decided_by = tests.uid('owner'), decided_at is not null)
    from public.approval_requests where id = pg_temp.request_id('approved')
  ),
  'approved | OK, supplier price | t | t',
  'the request records the decision and the note'
);
select is(
  (select concat_ws(' | ', old_price, new_price, source, changed_by = tests.uid('owner')) from public.price_changes),
  '45.00 | 48.50 | approval | t',
  'the new price is in the price history as an approved request'
);
select is(
  (select reason from public.audit_logs where action = 'product.update'),
  'Price went up',
  'the product change is audit-logged with the request''s reason'
);
select is(
  (select reason from public.audit_logs where action = 'approval.approve'),
  'OK, supplier price',
  'approving is audit-logged with the Owner''s note'
);
select is(
  tests.message('owner', format('select public.decide_approval(%L, false)', pg_temp.request_id('approved'))),
  'request_closed',
  'a decided request cannot be decided again'
);

-- ---- Rejecting -----------------------------------------------------------------------------------
select is(pg_temp.ask('special', '{"active": false}', 'Discontinued'), 'ok', 'Special Sales asks to deactivate it');
select is(pg_temp.decide('owner', false, 'Still selling'), 'ok', 'the Owner rejects');
select is(
  (select active from public.products where sku = 'CK-12'),
  true,
  'a rejected request changes nothing'
);
select is(
  (select status || ' | ' || owner_note from public.approval_requests where status = 'rejected'),
  'rejected | Still selling',
  'with the Owner''s note for the requester'
);

-- ---- Withdrawing -----------------------------------------------------------------------------------
select is(pg_temp.ask('special', '{"reorder_level": 20}', 'Sells fast'), 'ok', 'a new request after the last one closed');
select is(
  tests.message('owner', format('select public.withdraw_request(%L)', pg_temp.request_id())),
  'not_found',
  'only the requester can withdraw it'
);
select is(
  tests.message('special', format('select public.withdraw_request(%L, %L)', pg_temp.request_id(), 'A1B2')),
  'ok',
  'the requester withdraws it while pending'
);
select is(
  (
    select concat_ws(' | ', status, decided_by = tests.uid('special'))
    from public.approval_requests where status = 'withdrawn'
  ),
  'withdrawn | t',
  'it is marked withdrawn'
);
select is(
  (select count(*) from public.audit_logs where action = 'approval.withdraw'),
  1::bigint,
  'withdrawing is audit-logged'
);
select is(
  tests.message('special', format('select public.withdraw_request(%L)', (select id from public.approval_requests where status = 'withdrawn'))),
  'request_closed',
  'a closed request cannot be withdrawn'
);

-- ---- Outdated -------------------------------------------------------------------------------------
select is(pg_temp.ask('special', '{"sell_price": 50}', 'New supplier price'), 'ok', 'a request for ₱50');
select is(
  tests.message('owner', format('select public.update_product(%L, %L)', '00000000-0000-4000-8000-0000000000a1', '{"sell_price": 49}')),
  'ok',
  'the Owner changes the price directly in the meantime'
);
select is(pg_temp.decide('owner', true), 'request_outdated', 'the outdated request cannot be approved');
select is(
  (select sell_price from public.products where sku = 'CK-12'),
  49.00::numeric,
  'and the price stays as the Owner set it'
);
select is(pg_temp.decide('owner', false, 'Already changed'), 'ok', 'it can still be rejected');

select is(pg_temp.ask('special', '{"name": "Chips Classic 60 g"}', 'Clearer name'), 'ok', 'a request for a new name');
select is(
  tests.message('owner', format('select public.update_product(%L, %L)', '00000000-0000-4000-8000-0000000000a1', '{"reorder_level": 30}')),
  'ok',
  'the Owner changes another field'
);
select is(pg_temp.decide('owner', true), 'ok', 'a change to other fields does not make it outdated');

-- ---- No direct writes ---------------------------------------------------------------------------
select is(
  tests.run(caller, statement),
  '42501',
  caller || ': ' || statement
)
from unnest(tests.everyone()) as caller
cross join unnest(array[
  $$insert into public.approval_requests (branch_id, type, target_type, target_id, before, after, reason, requested_by) values ('tmain', 'product_edit', 'product', gen_random_uuid(), '{}', '{"x": 1}', 'r', gen_random_uuid())$$,
  $$update public.approval_requests set status = 'approved'$$,
  'delete from public.approval_requests'
]) as statement;

select * from finish();
rollback;
