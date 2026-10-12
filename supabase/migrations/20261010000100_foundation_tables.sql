-- Phase 0 tables (SRS 5.1): branches, profiles, devices, audit_logs.
--
-- The Supabase URL and anon key are public, so anyone can call the API without the app
-- (SRS 6.3). Everything here assumes a hostile client: a table is unreachable until a GRANT
-- and a policy open it.

-- ---- Default deny for everything created later (SRS 6.2) ---------------------------------
-- Supabase grants new tables and functions in `public` to the API roles automatically.
-- Turn that off, so a forgotten GRANT means "no access" instead of "open".
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;

-- SEC-07: GraphQL is not used.
drop extension if exists pg_graphql;

-- Helpers used by policies live here. The schema is not exposed through the API.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---- branches ----------------------------------------------------------------------------
create table public.branches (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,30}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  address text,
  contact text,
  tin text,
  receipt_footer text,
  sales_discount_limit numeric(12, 2) check (sales_discount_limit >= 0),
  idle_lock_minutes integer not null default 15 check (idle_lock_minutes between 1 and 240),
  store_lat double precision check (store_lat between -90 and 90),
  store_lng double precision check (store_lng between -180 and 180),
  radius_m integer check (radius_m > 0),
  morning_clock_in time not null default '06:00',
  afternoon_clock_in time not null default '13:00',
  grace_minutes integer not null default 15 check (grace_minutes >= 0),
  late_penalty numeric(12, 2) not null default 50 check (late_penalty >= 0),
  -- Full day (1) or half day (0.5) for a day that starts with the afternoon shift (ATT-10).
  -- Still an open question in the SRS, so it has no default.
  afternoon_day_credit numeric(2, 1) check (afternoon_day_credit in (0.5, 1)),
  created_at timestamptz not null default now()
);

-- ---- profiles ----------------------------------------------------------------------------
-- One row per account (AUTH-03). Role and active flag live here and are read live by RLS.
-- Written only by the server: the `admin-users` Edge Function and the bootstrap script.
create table public.profiles (
  -- AUTH-02: users are never hard-deleted, so the auth user cannot be deleted either.
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  email text not null check (char_length(email) between 3 and 254),
  role text not null check (role in ('owner', 'special_sales', 'sales')),
  -- Prefixes this person's receipt numbers (POS-08).
  user_code text not null check (user_code ~ '^[A-Z0-9]{2,6}$'),
  branch_id text not null references public.branches (id),
  active boolean not null default true,
  clock_in_override time,
  created_at timestamptz not null default now(),
  constraint profiles_branch_user_code_key unique (branch_id, user_code)
);

-- ---- devices -----------------------------------------------------------------------------
-- SYS-02: each browser registers its own short tag under the signed-in user.
create table public.devices (
  user_id uuid not null references public.profiles (id),
  device_tag text not null check (device_tag ~ '^[A-Z0-9]{4}$'),
  label text not null default '' check (char_length(label) <= 60),
  push_subscription jsonb,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_tag)
);

-- The client never chooses the time it was last seen.
create function private.stamp_device_last_seen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.last_seen_at := now();
  return new;
end;
$$;

create trigger devices_stamp_last_seen
before insert or update on public.devices
for each row execute function private.stamp_device_last_seen();

-- ---- audit_logs --------------------------------------------------------------------------
-- SYS-03, NFR-06: append-only. Written by functions only.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  action text not null check (action ~ '^[a-z]+\.[A-Za-z]+$'),
  actor_id uuid not null references public.profiles (id),
  device_tag text check (device_tag ~ '^[A-Z0-9]{4}$'),
  target_type text not null check (char_length(target_type) between 1 and 40),
  target_id text not null check (char_length(target_id) between 1 and 128),
  before jsonb,
  after jsonb,
  reason text check (char_length(reason) between 1 and 200),
  created_at timestamptz not null default now()
);

create index audit_logs_branch_created_at_idx
  on public.audit_logs (branch_id, created_at desc);

-- ---- Privileges --------------------------------------------------------------------------
-- Start from nothing, then grant only what a policy will also allow.
revoke all on table public.branches, public.profiles, public.devices, public.audit_logs
  from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.audit_logs to authenticated;

-- A user manages their own device rows, column by column: never `push_subscription` (Phase 1)
-- and never `last_seen_at` (set by the trigger). No DELETE.
grant select on table public.devices to authenticated;
grant insert (user_id, device_tag, label) on table public.devices to authenticated;
grant update (user_id, device_tag, label) on table public.devices to authenticated;

-- The service role (the `admin-users` Edge Function and the bootstrap script) is granted
-- explicitly as well, so nothing depends on the project's "automatically expose new tables"
-- setting. It never gets UPDATE, DELETE or TRUNCATE on the audit log: append-only for every
-- API role (SRS 6.2).
revoke all on table public.branches, public.profiles, public.devices, public.audit_logs
  from service_role;
grant select, insert, update, delete on table public.branches, public.profiles, public.devices
  to service_role;
grant select, insert on table public.audit_logs to service_role;

-- Row Level Security on every table. Policies are in the next migration; until a policy
-- opens something, nothing is readable or writable.
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.audit_logs enable row level security;
