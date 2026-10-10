-- LOCAL DEVELOPMENT ONLY (SEC-11). Loaded by `supabase start` and `supabase db reset` on your
-- own machine and in CI. `supabase db push` never runs this file, so none of these accounts
-- can exist in staging or production.
--
-- Every account's password is: password1234
--
--   owner@pos.test     Owner          (sets up two-step sign-in at first sign-in)
--   special@pos.test   Special Sales
--   sales@pos.test     Sales
--   off@pos.test       Sales, deactivated (cannot sign in)

insert into public.branches (id, name, address)
values ('main', 'Local Test Store', '123 Rizal St., Sample City');

with seed (id, email, display_name, role, user_code, active) as (
  values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'owner@pos.test', 'Rosario Santos', 'owner', 'RS', true),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'special@pos.test', 'Maria Cruz', 'special_sales', 'MC', true),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'sales@pos.test', 'Jun Reyes', 'sales', 'JR', true),
    ('00000000-0000-4000-8000-000000000004'::uuid, 'off@pos.test', 'Ricky Flores', 'sales', 'RF', false)
),
users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, banned_until,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('password1234', extensions.gen_salt('bf')), now(),
    case when active then null else 'infinity'::timestamptz end,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  from seed
  returning id, email
),
identities as (
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  select
    gen_random_uuid(), id, id::text,
    jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
    'email', now(), now(), now()
  from users
)
insert into public.profiles (id, display_name, email, role, user_code, branch_id, active)
select seed.id, seed.display_name, seed.email, seed.role, seed.user_code, 'main', seed.active
from seed
join users using (id);
