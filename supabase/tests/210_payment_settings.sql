-- Payment settings (SYS-01, POS-03, POS-04, POS-07): VAT and cash rounding on the branch, the
-- store's GCash and Maya accounts, and no sales discount limit any more.
begin;
select * from no_plan();
select tests.fixture();

-- ---- Defaults ----------------------------------------------------------------------------
select is(
  (select concat_ws(' ', vat_registered, vat_rate, round_cash) from public.branches where id = 'tmain'),
  'f 12.00 t',
  'a new branch: not VAT registered, 12% rate ready, cash totals rounded'
);

select hasnt_column('public', 'branches', 'sales_discount_limit', 'the sales discount limit is gone (POS-03)');

-- ---- VAT and rounding through update_branch_settings --------------------------------------
select is(
  tests.run(caller, $$select public.update_branch_settings('{"vat_registered": true}')$$),
  '42501',
  caller || ' cannot change VAT'
)
from unnest(tests.no_access() || array['sales', 'special']) as caller;

select is(
  tests.run(
    'owner',
    $$select public.update_branch_settings('{"vat_registered": true, "vat_rate": 12.5, "round_cash": false}', 'A1B2')$$
  ),
  'ok 1',
  'the Owner turns VAT on, sets the rate and turns cash rounding off'
);
select is(
  (select concat_ws(' ', vat_registered, vat_rate, round_cash) from public.branches where id = 'tmain'),
  't 12.50 f',
  'and they are saved'
);
select is(
  (
    select concat_ws(' ', before ->> 'vat_registered', after ->> 'vat_registered',
      before ->> 'vat_rate', after ->> 'vat_rate', before ->> 'round_cash', after ->> 'round_cash')
    from public.audit_logs where action = 'branch.update'
  ),
  'false true 12.00 12.50 true false',
  'the change is audit-logged with old and new values'
);
select is(
  (select concat_ws(' ', vat_registered, vat_rate, round_cash) from public.branches where id = 'tother'),
  'f 12.00 t',
  'another branch is never touched'
);

select is(
  tests.message('owner', format('select public.update_branch_settings(%L)', changes)),
  'invalid_input',
  'refused: ' || changes
)
from unnest(array[
  '{"vat_rate": 0}',
  '{"vat_rate": 51}',
  '{"vat_rate": 12.345}',
  '{"vat_rate": "12"}',
  '{"vat_rate": "12%"}',
  '{"vat_rate": null}',
  '{"vat_registered": "yes"}',
  '{"vat_registered": null}',
  '{"round_cash": 1}',
  '{"sales_discount_limit": 50}'
]) as changes;
select is(
  (select concat_ws(' ', vat_registered, vat_rate, round_cash) from public.branches where id = 'tmain'),
  't 12.50 f',
  'none of the refused changes was applied'
);

-- ---- Payment accounts: who adds them --------------------------------------------------------
select is(
  tests.run(
    caller,
    $$select public.create_payment_account('{"provider": "gcash", "label": "Hacked", "number": "09170000000"}')$$
  ),
  '42501',
  caller || ' cannot add a payment account'
)
from unnest(tests.no_access() || array['sales', 'special']) as caller;

select is(
  tests.message(
    'owner',
    $$select public.create_payment_account('{"provider": "gcash", "label": "  Main GCash ", "number": " 0917 123 4567 "}', 'A1B2')$$
  ),
  'ok',
  'the Owner adds a GCash account'
);
select is(
  (select concat_ws(' | ', provider, label, number, active) from public.payment_accounts where branch_id = 'tmain'),
  'gcash | Main GCash | 0917 123 4567 | t',
  'saved trimmed, active, in the Owner''s branch'
);
select is(
  (
    select concat_ws(' ', target_type, device_tag, after ->> 'provider', after ->> 'label', after ->> 'number')
    from public.audit_logs where action = 'payment.accountCreate'
  ),
  'payment_account A1B2 gcash Main GCash 0917 123 4567',
  'adding an account is audit-logged'
);
select is(
  tests.message(
    'owner',
    $$select public.create_payment_account('{"provider": "maya", "label": "Maya", "number": "+63 917 765 4321"}')$$
  ),
  'ok',
  'the Owner adds a Maya account with a +63 number'
);
select is(
  tests.message(
    'owner',
    format('select public.create_payment_account(%L)', jsonb_build_object('provider', 'maya', 'label', label, 'number', '09171111111'))
  ),
  'name_taken',
  'refused: the label ' || quote_literal(label) || ' is already used'
)
from unnest(array['Main GCash', 'main gcash', ' MAYA ']) as label;
select is(
  tests.message('other_owner', $$select public.create_payment_account('{"provider": "gcash", "label": "Main GCash", "number": "09170000000"}')$$),
  'ok',
  'another branch may use the same label'
);

select is(
  tests.message('owner', format('select public.create_payment_account(%L)', fields)),
  'invalid_input',
  'refused: ' || fields
)
from unnest(array[
  '{"provider": "paypal", "label": "X", "number": "09170000000"}',
  '{"provider": "gcash", "label": "", "number": "09170000000"}',
  '{"provider": "gcash", "label": "' || repeat('x', 41) || '", "number": "09170000000"}',
  '{"provider": "gcash", "label": "X"}',
  '{"provider": "gcash", "label": "X", "number": "0917"}',
  '{"provider": "gcash", "label": "X", "number": "call me"}',
  '{"provider": "gcash", "label": "X", "number": "0917-"}',
  '{"label": "X", "number": "09170000000"}',
  '{"provider": "gcash", "label": "X", "number": "09170000000", "active": false}',
  '[]'
]) as fields;

-- ---- Reading: everyone in the branch, nobody else -----------------------------------------
select is(
  tests.rows(caller, 'select * from public.payment_accounts'),
  2::bigint,
  caller || ' reads the branch''s two accounts (staff pick which one was paid)'
)
from unnest(array['owner', 'special', 'sales']) as caller;
select is(
  tests.rows('other_owner', $$select * from public.payment_accounts where branch_id = 'tmain'$$),
  0::bigint,
  'an Owner of another branch reads none of them'
);
select is(
  tests.rows(caller, 'select * from public.payment_accounts'),
  case when caller = 'anon' then -1 else 0 end::bigint,
  caller || ' reads no account'
)
from unnest(tests.no_access()) as caller;

select is(
  tests.run(caller, $$update public.payment_accounts set number = '09999999999'$$),
  '42501',
  caller || ' cannot write the table directly'
)
from unnest(array['owner', 'special', 'sales']) as caller;
select is(
  tests.run(caller, $$delete from public.payment_accounts$$),
  '42501',
  caller || ' cannot delete an account'
)
from unnest(array['owner', 'special', 'sales']) as caller;

-- ---- Changing, deactivating, reactivating ---------------------------------------------------
select is(
  tests.run(
    caller,
    format(
      'select public.update_payment_account(%L, %L)',
      (select id from public.payment_accounts where label = 'Maya' and branch_id = 'tmain'),
      '{"active": false}'
    )
  ),
  '42501',
  caller || ' cannot change an account'
)
from unnest(tests.no_access() || array['sales', 'special']) as caller;

select is(
  tests.run(
    'owner',
    format(
      'select public.update_payment_account(%L, %L, %L)',
      (select id from public.payment_accounts where label = 'Maya' and branch_id = 'tmain'),
      '{"label": "Store Maya", "number": "0917 765 4321", "active": false}',
      'A1B2'
    )
  ),
  'ok 1',
  'the Owner renames, renumbers and deactivates an account'
);
select is(
  (select concat_ws(' | ', provider, label, number, active) from public.payment_accounts where label = 'Store Maya'),
  'maya | Store Maya | 0917 765 4321 | f',
  'the account is kept, inactive'
);
select is(
  (
    select concat_ws(' ', before ->> 'label', '->', after ->> 'label', before ->> 'active', '->',
      after ->> 'active', before ->> 'provider')
    from public.audit_logs where action = 'payment.accountUpdate'
  ),
  'Maya -> Store Maya true -> false maya',
  'the change is audit-logged with old and new values and which provider'
);
select is(
  tests.message(
    'owner',
    $$select public.create_payment_account('{"provider": "maya", "label": "store maya", "number": "09171111111"}')$$
  ),
  'name_taken',
  'a deactivated account''s label still counts: reactivate it instead'
);
select is(
  tests.run(
    'owner',
    format(
      'select public.update_payment_account(%L, %L)',
      (select id from public.payment_accounts where label = 'Store Maya'),
      '{"active": true}'
    )
  ),
  'ok 1',
  'the Owner reactivates it'
);

select is(
  tests.message(
    'owner',
    format(
      'select public.update_payment_account(%L, %L)',
      (select id from public.payment_accounts where label = 'Store Maya'),
      changes
    )
  ),
  'invalid_input',
  'refused: ' || changes
)
from unnest(array[
  '{}',
  '{"provider": "gcash"}',
  '{"active": "no"}',
  '{"label": ""}',
  '{"number": "abc"}',
  '{"number": null}'
]) as changes;
select is(
  tests.message(
    'owner',
    format(
      'select public.update_payment_account(%L, %L)',
      (select id from public.payment_accounts where label = 'Store Maya'),
      '{"label": "MAIN GCASH"}'
    )
  ),
  'name_taken',
  'renaming to a label already used is refused'
);
select is(
  tests.message(
    'owner',
    format(
      'select public.update_payment_account(%L, %L)',
      (select id from public.payment_accounts where branch_id = 'tother'),
      '{"active": false}'
    )
  ),
  'not_found',
  'an account of another branch is not found'
);
select is(
  (select count(*) from public.payment_accounts where branch_id = 'tmain'),
  2::bigint,
  'nothing was ever deleted'
);

select * from finish();
rollback;
