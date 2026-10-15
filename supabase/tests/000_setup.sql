-- Shared helpers for the pgTAP tests. `supabase test db` runs the files in name order, so this
-- one runs first and leaves a `tests` schema behind in the LOCAL database for the others.
-- Each later file builds its fixture inside its own transaction and rolls it back.
--
-- The callers every policy must handle (SEC-16):
--   anon          someone with only the public URL and anon key
--   no_profile    a signed-in account that was never given a profile
--   deactivated   a profile with active = false, holding a token that has not expired yet
--   signed_out    an active account whose sessions were ended ("sign out everywhere")
--   owner_aal1    the Owner, signed in without the authenticator-app step (SEC-05)
--   sales, special, owner (aal2)
--   other_owner   a real Owner with the second step, but of a different branch
--   service       the service role, as used by the Edge Function
create extension if not exists pgtap with schema extensions;

drop schema if exists tests cascade;
create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

create function tests.uid(p_name text)
returns uuid
language sql
immutable
as $$ select md5('pos-test-user-' || p_name)::uuid; $$;

create function tests.session_id(p_name text)
returns uuid
language sql
immutable
as $$ select md5('pos-test-session-' || p_name)::uuid; $$;

create function tests.no_access()
returns text[]
language sql
immutable
as $$ select array['anon', 'no_profile', 'deactivated', 'signed_out', 'owner_aal1']; $$;

create function tests.everyone()
returns text[]
language sql
immutable
as $$ select tests.no_access() || array['sales', 'special', 'owner', 'other_owner']; $$;

-- Two branches with users, one device each for a Sales user, and one audit row each.
create function tests.fixture()
returns void
language plpgsql
as $$
declare
  v record;
begin
  insert into public.branches (id, name) values ('tmain', 'Test Store'), ('tother', 'Other Store');

  for v in
    select *
    from (
      values
        ('owner', 'owner', 'tmain', 'OW', true, true),
        ('sales', 'sales', 'tmain', 'S1', true, true),
        ('special', 'special_sales', 'tmain', 'SP', true, true),
        ('former', 'sales', 'tmain', 'FM', false, true),
        ('gone', 'sales', 'tmain', 'GN', true, false),
        ('nobody', null, null, null, null, true),
        ('owner9', 'owner', 'tother', 'OW', true, true),
        ('sales9', 'sales', 'tother', 'S9', true, true)
    ) as t (name, role, branch_id, user_code, active, has_session)
  loop
    insert into auth.users (instance_id, id, aud, role, email)
    values (
      '00000000-0000-0000-0000-000000000000', tests.uid(v.name), 'authenticated',
      'authenticated', v.name || '@tests.pos'
    );
    if v.has_session then
      insert into auth.sessions (id, user_id, created_at, updated_at)
      values (tests.session_id(v.name), tests.uid(v.name), now(), now());
    end if;
    if v.role is not null then
      insert into public.profiles (id, display_name, email, role, user_code, branch_id, active)
      values (
        tests.uid(v.name), initcap(v.name), v.name || '@tests.pos', v.role, v.user_code,
        v.branch_id, v.active
      );
    end if;
  end loop;

  insert into public.devices (user_id, device_tag, label)
  values
    (tests.uid('sales'), 'S1S1', 'Android phone · Chrome'),
    (tests.uid('sales9'), 'S9S9', 'Android phone · Chrome');

  insert into public.audit_logs (branch_id, action, actor_id, target_type, target_id)
  values
    ('tmain', 'user.create', tests.uid('owner'), 'user', tests.uid('sales')::text),
    ('tother', 'user.create', tests.uid('owner9'), 'user', tests.uid('sales9')::text);
end;
$$;

-- Becomes one of the callers for the rest of the transaction, or until tests.as_admin().
create function tests.as(p_caller text)
returns void
language plpgsql
as $$
declare
  v_user text;
  v_aal text := 'aal1';
begin
  if p_caller = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
    return;
  end if;
  if p_caller = 'service' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('role', 'service_role', true);
    return;
  end if;

  case p_caller
    when 'no_profile' then v_user := 'nobody';
    when 'deactivated' then v_user := 'former';
    when 'signed_out' then v_user := 'gone';
    when 'owner_aal1' then v_user := 'owner';
    when 'owner' then v_user := 'owner'; v_aal := 'aal2';
    when 'other_owner' then v_user := 'owner9'; v_aal := 'aal2';
    when 'sales' then v_user := 'sales';
    when 'special' then v_user := 'special';
    when 'sales9' then v_user := 'sales9';
    else raise exception 'unknown test caller %', p_caller;
  end case;

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', tests.uid(v_user),
      'role', 'authenticated',
      'aal', v_aal,
      'session_id', tests.session_id(v_user)
    )::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end;
$$;

create function tests.as_admin()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- How many rows the caller gets from a query. -1 means the request was refused outright
-- (no privilege); 0 means Row Level Security showed nothing.
create function tests.rows(p_caller text, p_query text)
returns bigint
language plpgsql
as $$
declare
  v_count bigint;
begin
  begin
    perform tests.as(p_caller);
    execute format('select count(*) from (%s) q', p_query) into v_count;
  exception
    when insufficient_privilege then
      v_count := -1;
  end;
  perform tests.as_admin();
  return v_count;
end;
$$;

-- Runs a statement as the caller. Returns 'ok <rows affected>' or the SQLSTATE it failed with:
--   42501  refused (no privilege, or the row fails a policy)
--   23514  a CHECK constraint, 23505 a unique constraint, 22023 invalid input
create function tests.run(p_caller text, p_statement text)
returns text
language plpgsql
as $$
declare
  v_rows bigint;
  v_result text;
begin
  begin
    perform tests.as(p_caller);
    execute p_statement;
    get diagnostics v_rows = row_count;
    v_result := 'ok ' || v_rows;
  exception
    when others then
      v_result := sqlstate;
  end;
  perform tests.as_admin();
  return v_result;
end;
$$;

-- Like tests.run, but returns the error message, for functions that report by message.
create function tests.message(p_caller text, p_statement text)
returns text
language plpgsql
as $$
declare
  v_result text := 'ok';
begin
  begin
    perform tests.as(p_caller);
    execute p_statement;
  exception
    when others then
      v_result := sqlerrm;
  end;
  perform tests.as_admin();
  return v_result;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

begin;
select plan(1);
select has_schema('tests', 'test helpers are installed');
select * from finish();
rollback;
