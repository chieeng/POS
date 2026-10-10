-- Database functions: record_sign_in (SYS-03) and the Owner administration behind the
-- `admin-users` Edge Function (AUTH-02..04, SEC-04, SEC-13).
begin;
select * from no_plan();
select tests.fixture();

-- ---- record_sign_in ----------------------------------------------------------------------
select is(
  tests.run(caller, $$select public.record_sign_in('A1B2')$$),
  'ok 1',
  caller || ' logs their own sign-in'
)
from unnest(array['sales', 'special', 'owner', 'owner_aal1']) as caller;

select is(
  (
    select count(*) from public.audit_logs
    where action = 'auth.signIn' and actor_id = tests.uid('sales') and branch_id = 'tmain'
      and device_tag = 'A1B2' and target_type = 'user' and target_id = tests.uid('sales')::text
  ),
  1::bigint,
  'the entry names the user, their branch and the device tag'
);

select is(
  tests.run('sales', 'select public.record_sign_in()'),
  'ok 1',
  'the device tag is optional'
);

select is(
  tests.run(caller, $$select public.record_sign_in('A1B2')$$),
  '42501',
  caller || ' cannot log a sign-in'
)
from unnest(array['anon', 'no_profile', 'deactivated', 'signed_out']) as caller;

select is(
  tests.run('sales', format('select public.record_sign_in(%L)', tag)),
  '22023',
  'record_sign_in rejects device tag ' || quote_literal(tag)
)
from unnest(array['a1b2', 'TOOLONG', '<script>', '']) as tag;

-- ---- admin_* are closed to every client --------------------------------------------------
select is(
  tests.run(
    caller,
    $$select public.admin_set_role(tests.uid('owner'), tests.uid('sales'), 'owner')$$
  ),
  '42501',
  caller || ' cannot call an admin function directly, even naming the Owner as actor'
)
from unnest(tests.everyone()) as caller;

select is(
  tests.run(caller, $$select private.end_sessions(tests.uid('owner'))$$),
  '42501',
  caller || ' cannot end sessions directly'
)
from unnest(tests.everyone()) as caller;

-- ---- The actor must be an active Owner ---------------------------------------------------
select is(
  tests.message(
    'service',
    format($$select public.admin_set_role(tests.uid(%L), tests.uid('special'), 'sales')$$, actor)
  ),
  'not_owner',
  'an actor who is ' || actor || ' is refused'
)
from unnest(array['sales', 'special', 'former', 'nobody']) as actor;

update public.profiles set active = false where id = tests.uid('owner9');
select is(
  tests.message(
    'service',
    $$select public.admin_set_role(tests.uid('owner9'), tests.uid('sales9'), 'special_sales')$$
  ),
  'not_owner',
  'an Owner who was turned off is refused'
);
update public.profiles set active = true where id = tests.uid('owner9');

-- ---- admin_create_profile ----------------------------------------------------------------
select is(
  tests.message(
    'service',
    $$select public.admin_create_profile(
      tests.uid('owner'), tests.uid('nobody'), 'new@tests.pos', 'New Person', 'sales', 'NP', 'A1B2'
    )$$
  ),
  'ok',
  'the Owner creates a profile'
);
select is(
  (select branch_id || ' ' || role || ' ' || user_code || ' ' || active from public.profiles where id = tests.uid('nobody')),
  'tmain sales NP true',
  'the profile is always in the Owner''s own branch'
);
select is(
  (
    select after ->> 'email' || ' ' || (after ->> 'role') || ' ' || device_tag
    from public.audit_logs where action = 'user.create' and target_id = tests.uid('nobody')::text
  ),
  'new@tests.pos sales A1B2',
  'creating a user is logged with the device tag'
);

insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', tests.uid('extra'), 'authenticated', 'authenticated', 'extra@tests.pos');
select is(
  tests.message(
    'service',
    $$select public.admin_create_profile(
      tests.uid('owner'), tests.uid('extra'), 'extra@tests.pos', 'Extra', 'sales', 'S1'
    )$$
  ),
  'user_code_taken',
  'a user code already used in the branch is refused'
);
select is(
  (select count(*) from public.profiles where id = tests.uid('extra')),
  0::bigint,
  'and no profile is left behind'
);
select is(
  tests.message(
    'service',
    $$select public.admin_create_profile(
      tests.uid('owner'), tests.uid('extra'), 'extra@tests.pos', 'Extra', 'admin', 'EX'
    )$$
  ),
  'invalid_input',
  'a role this system does not have is refused'
);

-- ---- admin_update_profile ----------------------------------------------------------------
select is(
  tests.message(
    'service',
    $$select public.admin_update_profile(tests.uid('owner'), tests.uid('sales'), 'Jun R.', 'JRX', 'A1B2')$$
  ),
  'ok',
  'the Owner edits a name and user code'
);
select is(
  (select display_name || ' ' || user_code from public.profiles where id = tests.uid('sales')),
  'Jun R. JRX',
  'both fields changed'
);
select is(
  (
    select (before ->> 'userCode') || ' ' || (after ->> 'userCode') || ' ' || (after ->> 'displayName') || ' ' || device_tag
    from public.audit_logs where action = 'user.update' and target_id = tests.uid('sales')::text
  ),
  'S1 JRX Jun R. A1B2',
  'the edit is logged with before, after and the device tag'
);

select is(
  tests.message(
    'service',
    $$select public.admin_update_profile(tests.uid('owner'), tests.uid('sales'), 'Jun R.', 'JRX')$$
  ),
  'ok',
  'an edit that changes nothing succeeds'
);
select is(
  (select count(*) from public.audit_logs where action = 'user.update'),
  1::bigint,
  'and writes no second audit entry'
);
select is(
  tests.message(
    'service',
    $$select public.admin_update_profile(tests.uid('owner'), tests.uid('sales'), null, 'SP')$$
  ),
  'user_code_taken',
  'a user code that someone else has is refused'
);
select is(
  tests.message(
    'service',
    $$select public.admin_update_profile(tests.uid('owner'), tests.uid('sales9'), 'Hacked', null)$$
  ),
  'user_not_found',
  'a user of another branch looks the same as no user'
);
select is(
  (select role || ' ' || branch_id || ' ' || active from public.profiles where id = tests.uid('sales')),
  'sales tmain true',
  'role, branch and active flag cannot be changed through an edit'
);

-- ---- admin_set_role (AUTH-03) ------------------------------------------------------------
select is(
  tests.message(
    'service',
    $$select public.admin_set_role(tests.uid('owner'), tests.uid('sales'), 'special_sales', 'A1B2')$$
  ),
  'ok',
  'the Owner changes a role'
);
select is(
  (select role from public.profiles where id = tests.uid('sales')),
  'special_sales',
  'the profile has the new role'
);
select is(
  (select count(*) from auth.sessions where user_id = tests.uid('sales')),
  0::bigint,
  'every device of that user must sign in again'
);
select is(
  (
    select (before ->> 'role') || ' ' || (after ->> 'role')
    from public.audit_logs where action = 'user.setRole' and target_id = tests.uid('sales')::text
  ),
  'sales special_sales',
  'the role change is logged with before and after'
);
select is(
  tests.message(
    'service',
    $$select public.admin_set_role(tests.uid('owner'), tests.uid('owner'), 'sales')$$
  ),
  'self_forbidden',
  'the Owner cannot change their own role'
);
select is(
  (select role from public.profiles where id = tests.uid('owner')),
  'owner',
  'and is still the Owner'
);
select is(
  tests.message(
    'service',
    $$select public.admin_set_role(tests.uid('owner'), tests.uid('sales9'), 'owner')$$
  ),
  'user_not_found',
  'a user of another branch cannot be reached'
);
select is(
  tests.message(
    'service',
    $$select public.admin_set_role(tests.uid('owner'), tests.uid('missing'), 'sales')$$
  ),
  'user_not_found',
  'an unknown user is refused'
);
select is(
  tests.message(
    'service',
    $$select public.admin_set_role(tests.uid('owner'), tests.uid('former'), 'sales')$$
  ),
  'account_off',
  'a turned-off account cannot be given a role'
);
select is(
  tests.message(
    'service',
    $$select public.admin_set_role(tests.uid('owner'), tests.uid('special'), 'admin')$$
  ),
  'invalid_input',
  'an unknown role is refused'
);

-- ---- admin_deactivate (SEC-04) -----------------------------------------------------------
select is(
  tests.message(
    'service',
    $$select public.admin_deactivate(tests.uid('owner'), tests.uid('special'), 'Left the store', 'A1B2')$$
  ),
  'ok',
  'the Owner turns an account off'
);
select is(
  (select active from public.profiles where id = tests.uid('special')),
  false,
  'the profile is inactive and still there (AUTH-02)'
);
select is(
  (select count(*) from auth.sessions where user_id = tests.uid('special')),
  0::bigint,
  'every session of that user is ended'
);
select is(
  (
    select reason || ' ' || (before ->> 'active') || ' ' || (after ->> 'active')
    from public.audit_logs where action = 'user.deactivate' and target_id = tests.uid('special')::text
  ),
  'Left the store true false',
  'the deactivation is logged with its reason'
);
select is(
  tests.message('service', $$select public.admin_deactivate(tests.uid('owner'), tests.uid('owner'))$$),
  'self_forbidden',
  'the Owner cannot turn off their own account'
);
select is(
  (select active from public.profiles where id = tests.uid('owner')),
  true,
  'and is still active'
);
select is(
  tests.message('service', $$select public.admin_deactivate(tests.uid('owner'), tests.uid('sales9'))$$),
  'user_not_found',
  'a user of another branch cannot be turned off'
);

-- ---- admin_sign_out_everywhere (AUTH-04, SEC-13) -----------------------------------------
insert into auth.sessions (id, user_id, created_at, updated_at)
values (gen_random_uuid(), tests.uid('sales'), now(), now()), (gen_random_uuid(), tests.uid('sales'), now(), now());
select is(
  tests.message(
    'service',
    $$select public.admin_sign_out_everywhere(tests.uid('owner'), tests.uid('sales'), 'A1B2')$$
  ),
  'ok',
  'the Owner signs a user out everywhere'
);
select is(
  (select count(*) from auth.sessions where user_id = tests.uid('sales')),
  0::bigint,
  'every session of that user is ended'
);
select is(
  (select active from public.profiles where id = tests.uid('sales')),
  true,
  'without turning the account off'
);
select is(
  (select count(*) from public.audit_logs where action = 'user.signOutEverywhere' and target_id = tests.uid('sales')::text),
  1::bigint,
  'and it is logged'
);
select is(
  tests.message(
    'service',
    $$select public.admin_sign_out_everywhere(tests.uid('owner'), tests.uid('sales9'))$$
  ),
  'user_not_found',
  'a user of another branch cannot be signed out'
);

-- ---- admin_log_password_reset ------------------------------------------------------------
set local role service_role;
select is(
  public.admin_log_password_reset(tests.uid('owner'), tests.uid('sales'), 'A1B2'),
  'sales@tests.pos',
  'a reset for an active user returns the email to make the link for'
);
set local role postgres;
select is(
  (select count(*) from public.audit_logs where action = 'user.passwordResetLink' and target_id = tests.uid('sales')::text),
  1::bigint,
  'the action is logged'
);
select is(
  (select count(*) from public.audit_logs where action = 'user.passwordResetLink' and (before is not null or after is not null or reason is not null)),
  0::bigint,
  'and the entry holds no link or other detail'
);
select is(
  tests.message(
    'service',
    $$select public.admin_log_password_reset(tests.uid('owner'), tests.uid('former'))$$
  ),
  'account_off',
  'no link for a turned-off account'
);
select is(
  tests.message(
    'service',
    $$select public.admin_log_password_reset(tests.uid('owner'), tests.uid('sales9'))$$
  ),
  'user_not_found',
  'no link for a user of another branch'
);

select * from finish();
rollback;
