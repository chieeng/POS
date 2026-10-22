-- Structure-level guarantees (SRS 6.2, SEC-01, SEC-07, SEC-09): RLS on every table, nothing
-- for anon, append-only audit log, safe functions, constraints, closed storage.
begin;
select * from no_plan();
select tests.fixture();

-- ---- RLS on every table ------------------------------------------------------------------
select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  ),
  0::bigint,
  'every table in public has Row Level Security enabled'
);

select tables_are(
  'public',
  array['branches', 'profiles', 'devices', 'audit_logs', 'backup_log', 'categories', 'suppliers', 'products', 'price_changes', 'approval_requests', 'product_costs', 'stock_receipts', 'stock_receipt_items', 'stock_movements'],
  'public holds exactly the expected tables'
);

-- ---- Nothing for anon --------------------------------------------------------------------
select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
  ),
  0::bigint,
  'anon has no privilege on any table in public'
);

select is(
  (
    select count(*)
    from information_schema.role_column_grants
    where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
  ),
  0::bigint,
  'anon has no column privilege in public'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and 'anon' = any (roles)),
  0::bigint,
  'no policy in public applies to anon'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and 'public' = any (roles)),
  0::bigint,
  'no policy in public applies to every role'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (has_function_privilege('anon', p.oid, 'execute'))
  ),
  0::bigint,
  'anon can execute no function in public or private'
);

-- ---- What a signed-in user is granted -----------------------------------------------------
select is(
  (
    select coalesce(string_agg(table_name || ':' || privilege_type, ' ' order by table_name, privilege_type), '')
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
  ),
  'approval_requests:SELECT audit_logs:SELECT backup_log:SELECT branches:SELECT categories:SELECT devices:SELECT price_changes:SELECT product_costs:SELECT products:SELECT profiles:SELECT stock_movements:SELECT stock_receipt_items:SELECT stock_receipts:SELECT suppliers:SELECT',
  'authenticated has table-wide SELECT on fourteen tables and nothing else'
);

select is(
  (
    select string_agg(column_name || ':' || privilege_type, ' ' order by column_name, privilege_type)
    from information_schema.role_column_grants
    where table_schema = 'public' and table_name = 'devices' and grantee = 'authenticated'
      and privilege_type <> 'SELECT'
  ),
  'device_tag:INSERT device_tag:UPDATE label:INSERT label:UPDATE user_id:INSERT user_id:UPDATE',
  'authenticated writes devices column by column: never last_seen_at or push_subscription'
);

select is(
  (
    select string_agg(p.proname, ' ' order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  'create_category create_product create_supplier decide_approval product_stock_history record_account_event record_sign_in record_stock_in request_product_change update_branch_settings update_category update_product update_supplier withdraw_request',
  'only the API functions in public are callable by a signed-in user'
);

select is(
  (
    select string_agg(table_name || ':' || privilege_type, ' ' order by table_name, privilege_type)
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'service_role'
  ),
  'audit_logs:INSERT audit_logs:SELECT'
    || ' branches:DELETE branches:INSERT branches:SELECT branches:UPDATE'
    || ' devices:DELETE devices:INSERT devices:SELECT devices:UPDATE'
    || ' profiles:DELETE profiles:INSERT profiles:SELECT profiles:UPDATE',
  'the service role is granted explicitly, and only what the server code needs'
);

-- Security Advisor: no SECURITY DEFINER function in an API schema is callable by a client.
select is(
  (
    select coalesce(string_agg(p.proname, ' '), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  ),
  '',
  'no SECURITY DEFINER function in public is executable by anon or authenticated'
);

select is(
  has_function_privilege('authenticated', 'private.record_sign_in(text)', 'execute')
    and not has_function_privilege('anon', 'private.record_sign_in(text)', 'execute'),
  true,
  'the privileged part of record_sign_in is callable by a signed-in user only'
);

select is(
  has_function_privilege('authenticated', 'private.record_account_event(text, text)', 'execute')
    and not has_function_privilege('anon', 'private.record_account_event(text, text)', 'execute'),
  true,
  'the privileged part of record_account_event is callable by a signed-in user only'
);

-- ---- Append-only audit log (SYS-03, NFR-05) -----------------------------------------------
select is(
  (
    select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'audit_logs'
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
  ),
  0::bigint,
  'no API role may UPDATE, DELETE or TRUNCATE audit_logs'
);

-- ---- Functions (SRS 6.2) -----------------------------------------------------------------
select is(
  (
    select coalesce(string_agg(p.proname, ' '), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  ),
  '',
  'every SECURITY DEFINER function sets a fixed search_path'
);

select is(
  (
    select coalesce(string_agg(p.proname, ' '), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_%'
      and (
        has_function_privilege('authenticated', p.oid, 'execute')
        or not has_function_privilege('service_role', p.oid, 'execute')
      )
  ),
  '',
  'admin_* functions are executable by the service role only'
);

select is(
  (
    select coalesce(string_agg(p.proname, ' '), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('end_sessions', 'owner_branch', 'valid_device_tag')
      and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  '',
  'internal helpers are not executable by a signed-in user'
);

-- ---- Constraints (SEC-07) ----------------------------------------------------------------
select is(
  tests.run('service', $$update public.profiles set role = 'admin' where id = tests.uid('sales')$$),
  '23514',
  'a role this system does not have is rejected'
);

select is(
  tests.run('service', format($$update public.profiles set user_code = %L where id = tests.uid('sales')$$, code)),
  '23514',
  'user code ' || quote_literal(code) || ' is rejected'
)
from unnest(array['', 'J', 'TOOLONG7', 'J-R', 'J R', 'jr']) as code;

select is(
  tests.run('service', $$update public.profiles set user_code = 'OW' where id = tests.uid('sales')$$),
  '23505',
  'a user code is unique inside a branch'
);

select is(
  tests.run('service', $$update public.profiles set user_code = 'S9' where id = tests.uid('sales')$$),
  'ok 1',
  'the same user code may exist in another branch'
);

select is(
  tests.run('service', $$update public.profiles set display_name = '  ' where id = tests.uid('sales')$$),
  '23514',
  'an empty name is rejected'
);

select throws_ok(
  $$delete from auth.users where id = tests.uid('former')$$,
  '23503',
  null,
  'an account with a profile cannot be hard-deleted (AUTH-02)'
);

select throws_ok(
  $$delete from public.profiles where id = tests.uid('sales')$$,
  '23503',
  null,
  'a profile that devices or audit rows point to cannot be hard-deleted (AUTH-02)'
);

-- ---- Storage is closed until product photos are built (SEC-09) ---------------------------
select is((select count(*) from storage.buckets), 0::bigint, 'there is no storage bucket yet');

select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  0::bigint,
  'storage.objects has no policy, so nobody can read or upload'
);

select is(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  true,
  'storage.objects has Row Level Security enabled'
);

select is(
  tests.rows(caller, 'select * from storage.objects'),
  0::bigint,
  caller || ' reads nothing from storage'
)
from unnest(tests.everyone()) as caller;

select * from finish();
rollback;
