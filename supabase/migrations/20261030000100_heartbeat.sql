-- Keeps the Free projects awake (SRS 2, 7.1): the Heartbeat workflow calls this through the
-- REST API with the publishable key every 6 hours.
--
--   Supabase pauses a Free project after a week without "user database activity". A request
--   that Postgres refuses (the old ping read `profiles` as anon and got 42501) runs no query
--   and does not count, so pos-prod was paused although it was pinged every day. This is a
--   real query that anon may run: it reads no table and returns only the database clock.
create function public.heartbeat()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select now(); $$;

comment on function public.heartbeat() is
  'Heartbeat workflow ping: a real, read-only query that keeps the Free project active.';

revoke execute on function public.heartbeat() from public, authenticated;
grant execute on function public.heartbeat() to anon;
