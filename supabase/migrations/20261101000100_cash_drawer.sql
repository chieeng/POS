-- Build step 8 (SRS 3.4, SHIFT-01..04): the store's one shared cash drawer, a session per
-- business day (Asia/Manila), with the Owner's decisions of Oct 31, 2026:
--
--   Open: any active staff member enters the opening cash. It is pre-filled from the last
--   closing count; an amount that differs needs a reason, and the difference is kept for the
--   Owner (SHIFT-01). One session per day.
--   A drawer left open on an earlier day is closed as "not counted" when today's opens, and
--   flagged for the Owner; selling is never blocked by a forgotten close.
--   Cash in and out: anyone, with a reason (Supplier payment, Expense, Owner withdrawal,
--   Change fund, Other) and an optional note; Other needs the note. Append-only (SHIFT-02).
--   Close: the Owner or Special Sales counts by denomination (PHP 1,000 down to PHP 1). The
--   count is blind: expected cash is computed and shown only once the count is in, and staff
--   never read expected cash before that (SHIFT-03). Exact over/short, no tolerance.
--   Reopen: never by staff; the Owner may reopen the latest session with a reason.
--
-- Expected cash = opening + cash sales + cash utang payments + cash in - cash refunds -
-- cash out. Sales, utang payments and refunds arrive in steps 9, 12 and 10, which extend
-- private.drawer_expected.

-- ---- Tables ------------------------------------------------------------------------------
create table public.drawer_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  business_date date not null,
  status text not null default 'open' check (status in ('open', 'closed', 'not_counted')),
  opened_by uuid not null references public.profiles (id),
  opened_by_name text not null,
  opened_at timestamptz not null default now(),
  open_device_tag text check (open_device_tag ~ '^[A-Z0-9]{4}$'),
  opening_cash numeric(12, 2) not null check (opening_cash between 0 and 9999999.99),
  -- The last closing count the opening was pre-filled from, and opening minus that count.
  prefill_cash numeric(12, 2),
  prefill_difference numeric(12, 2),
  opening_reason text check (char_length(opening_reason) between 1 and 200),
  closed_by uuid references public.profiles (id),
  closed_by_name text,
  closed_at timestamptz,
  close_device_tag text check (close_device_tag ~ '^[A-Z0-9]{4}$'),
  -- {"1000": 3, "500": 4, ...}: how many of each bill and coin were counted.
  counts jsonb,
  counted_cash numeric(12, 2),
  expected_cash numeric(12, 2),
  over_short numeric(12, 2),
  closing_note text check (char_length(closing_note) between 1 and 200),
  unique (branch_id, business_date),
  check (prefill_difference is null or prefill_difference = 0 or opening_reason is not null),
  check (status = 'open' or closed_at is not null),
  check (status <> 'closed' or counted_cash is not null)
);
-- At most one open drawer per store.
create unique index drawer_sessions_one_open_idx on public.drawer_sessions (branch_id)
  where status = 'open';

create table public.drawer_entries (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  session_id uuid not null references public.drawer_sessions (id),
  type text not null check (type in ('cash_in', 'cash_out')),
  amount numeric(12, 2) not null check (amount between 0.01 and 999999.99),
  reason text not null check (
    reason in ('supplier_payment', 'expense', 'owner_withdrawal', 'change_fund', 'other')
  ),
  note text check (char_length(note) between 1 and 200),
  user_id uuid not null references public.profiles (id),
  user_name text not null,
  device_tag text check (device_tag ~ '^[A-Z0-9]{4}$'),
  created_at timestamptz not null default now(),
  check (reason <> 'other' or note is not null)
);
create index drawer_entries_session_idx on public.drawer_entries (session_id, created_at);

-- Written only by the functions below. The Owner reads both (the drawer report, SHIFT-04);
-- staff read nothing directly: drawer_today tells them what they need, without expected cash.
revoke all on table public.drawer_sessions, public.drawer_entries
  from public, anon, authenticated, service_role;
grant select on table public.drawer_sessions, public.drawer_entries to authenticated;

alter table public.drawer_sessions enable row level security;
alter table public.drawer_entries enable row level security;

create policy drawer_sessions_select_owner on public.drawer_sessions
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));
create policy drawer_entries_select_owner on public.drawer_entries
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));

-- The Owner's drawer report stays current.
alter publication supabase_realtime add table public.drawer_sessions, public.drawer_entries;

-- ---- Helpers -----------------------------------------------------------------------------
create function private.manila_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Manila')::date; $$;

-- Expected cash in the drawer now. Later steps add cash sales (9), refunds (10) and cash
-- utang payments (12).
create function private.drawer_expected(p_session_id uuid)
returns numeric(12, 2)
language sql
stable
set search_path = ''
as $$
  select s.opening_cash
    + coalesce(sum(e.amount) filter (where e.type = 'cash_in'), 0)
    - coalesce(sum(e.amount) filter (where e.type = 'cash_out'), 0)
  from public.drawer_sessions s
  left join public.drawer_entries e on e.session_id = s.id
  where s.id = p_session_id
  group by s.id, s.opening_cash;
$$;

revoke execute on function private.manila_today(), private.drawer_expected(uuid)
  from public, anon, authenticated;

-- ---- drawer_today ------------------------------------------------------------------------
-- What every active user of the branch needs to open, use or close today's drawer, and
-- nothing about expected cash. {
--   "today": "2026-11-01",
--   "session": null | {id, business_date, status, opened_by_name, opened_at, opening_cash},
--   "lastCount": null | {amount, counted_by_name, closed_at, business_date},
--   "staleOpen": true when a drawer from an earlier day is still open
-- }
create function private.drawer_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch text := private.current_branch();
  v_today date := private.manila_today();
begin
  if (select auth.uid()) is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'today', v_today,
    'session', (
      select jsonb_build_object(
        'id', s.id, 'business_date', s.business_date, 'status', s.status,
        'opened_by_name', s.opened_by_name, 'opened_at', s.opened_at,
        'opening_cash', s.opening_cash
      )
      from public.drawer_sessions s
      where s.branch_id = v_branch and s.business_date = v_today
    ),
    'lastCount', (
      select jsonb_build_object(
        'amount', s.counted_cash, 'counted_by_name', s.closed_by_name,
        'closed_at', s.closed_at, 'business_date', s.business_date
      )
      from public.drawer_sessions s
      where s.branch_id = v_branch and s.business_date < v_today and s.counted_cash is not null
      order by s.business_date desc
      limit 1
    ),
    'staleOpen', exists (
      select 1 from public.drawer_sessions s
      where s.branch_id = v_branch and s.business_date < v_today and s.status = 'open'
    )
  );
end;
$$;

-- ---- open_drawer -------------------------------------------------------------------------
-- Errors: already_open, already_closed (today's drawer was opened already), reason_required
-- (the amount differs from the last count and no reason was given), invalid_input.
create function private.open_drawer(
  p_opening_cash numeric,
  p_reason text,
  p_device_tag text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_today date := private.manila_today();
  v_reason text := private.catalog_text(p_reason, 200, false);
  v_name text;
  v_existing public.drawer_sessions;
  v_stale public.drawer_sessions;
  v_expected numeric(12, 2);
  v_prefill numeric(12, 2);
  v_session uuid;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash > 9999999.99
    or p_opening_cash <> round(p_opening_cash, 2) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- One at a time per store, so two phones opening together cannot both pass the checks.
  perform 1 from public.branches b where b.id = v_branch for update;

  select * into v_existing from public.drawer_sessions s
  where s.branch_id = v_branch and s.business_date = v_today;
  if found then
    if v_existing.status = 'open' then
      raise exception 'already_open' using errcode = 'P0001';
    end if;
    raise exception 'already_closed' using errcode = 'P0001';
  end if;

  select pr.display_name into v_name from public.profiles pr where pr.id = v_uid;

  -- A drawer left open on an earlier day: closed as not counted, flagged for the Owner.
  for v_stale in
    select * from public.drawer_sessions s
    where s.branch_id = v_branch and s.status = 'open' and s.business_date < v_today
    for update
  loop
    v_expected := private.drawer_expected(v_stale.id);
    update public.drawer_sessions s set
      status = 'not_counted', closed_at = now(), expected_cash = v_expected,
      closed_by = v_uid, closed_by_name = v_name, close_device_tag = v_tag
    where s.id = v_stale.id;
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, after)
    values (
      v_branch, 'drawer.notCounted', v_uid, v_tag, 'drawer', v_stale.id::text,
      jsonb_build_object('businessDate', v_stale.business_date, 'expected', v_expected)
    );
  end loop;

  select s.counted_cash into v_prefill from public.drawer_sessions s
  where s.branch_id = v_branch and s.business_date < v_today and s.counted_cash is not null
  order by s.business_date desc
  limit 1;

  if v_prefill is not null and p_opening_cash <> v_prefill and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  insert into public.drawer_sessions (
    branch_id, business_date, opened_by, opened_by_name, open_device_tag, opening_cash,
    prefill_cash, prefill_difference, opening_reason
  )
  values (
    v_branch, v_today, v_uid, v_name, v_tag, p_opening_cash,
    v_prefill, p_opening_cash - v_prefill,
    case when v_prefill is not null and p_opening_cash <> v_prefill then v_reason end
  )
  returning id into v_session;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_branch, 'drawer.open', v_uid, v_tag, 'drawer', v_session::text,
    jsonb_build_object(
      'businessDate', v_today, 'opening', p_opening_cash, 'lastCount', v_prefill,
      'difference', p_opening_cash - v_prefill
    ),
    case when v_prefill is not null and p_opening_cash <> v_prefill then v_reason end
  );
  return v_session;
exception
  -- Another phone opened today's drawer in the same moment.
  when unique_violation then
    raise exception 'already_open' using errcode = 'P0001';
end;
$$;

-- ---- record_drawer_entry -----------------------------------------------------------------
-- Cash in or out of today's open drawer. Errors: drawer_not_open, invalid_input.
create function private.record_drawer_entry(
  p_type text,
  p_amount numeric,
  p_reason text,
  p_note text,
  p_device_tag text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_note text := private.catalog_text(p_note, 200, false);
  v_session uuid;
  v_entry uuid;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('cash_in', 'cash_out')
    or p_amount is null or p_amount < 0.01 or p_amount > 999999.99
    or p_amount <> round(p_amount, 2)
    or p_reason is null
    or p_reason not in ('supplier_payment', 'expense', 'owner_withdrawal', 'change_fund', 'other')
    or (p_reason = 'other' and v_note is null) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select s.id into v_session from public.drawer_sessions s
  where s.branch_id = v_branch and s.business_date = private.manila_today()
    and s.status = 'open'
  for update;
  if v_session is null then
    raise exception 'drawer_not_open' using errcode = 'P0001';
  end if;

  insert into public.drawer_entries
    (branch_id, session_id, type, amount, reason, note, user_id, user_name, device_tag)
  select v_branch, v_session, p_type, p_amount, p_reason, v_note, v_uid, pr.display_name, v_tag
  from public.profiles pr where pr.id = v_uid
  returning id into v_entry;
  return v_entry;
end;
$$;

-- ---- drawer_expected_cash ----------------------------------------------------------------
-- The Owner only: expected cash in today's open drawer now ("Expected cash after" on the cash
-- in/out sheet). Null when no drawer is open.
create function private.drawer_expected_cash()
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  return (
    select private.drawer_expected(s.id) from public.drawer_sessions s
    where s.branch_id = private.current_branch() and s.status = 'open'
  );
end;
$$;

-- ---- close_drawer ------------------------------------------------------------------------
-- The Owner or Special Sales closes the open drawer with a count by denomination:
-- p_counts {"1000": 3, "500": 0, ..., "1": 12}; missing bills count as 0. Returns
-- {expected, counted, overShort}: the blind count is revealed only now.
-- Errors: drawer_not_open, invalid_input.
create function private.close_drawer(
  p_counts jsonb,
  p_note text,
  p_device_tag text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_note text := private.catalog_text(p_note, 200, false);
  v_bills constant text[] := array['1000', '500', '200', '100', '50', '20', '10', '5', '1'];
  v_session public.drawer_sessions;
  v_counted numeric(12, 2) := 0;
  v_expected numeric(12, 2);
  v_key text;
  v_value jsonb;
begin
  if v_uid is null or not private.can_add_catalog() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_counts) loop
    if v_key <> all (v_bills) or jsonb_typeof(v_value) <> 'number'
      or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
      or (v_value #>> '{}')::numeric not between 0 and 100000 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_counted := v_counted + v_key::integer * (v_value #>> '{}')::integer;
  end loop;

  select * into v_session from public.drawer_sessions s
  where s.branch_id = v_branch and s.status = 'open'
  for update;
  if not found then
    raise exception 'drawer_not_open' using errcode = 'P0001';
  end if;

  v_expected := private.drawer_expected(v_session.id);
  update public.drawer_sessions s set
    status = 'closed', closed_by = v_uid,
    closed_by_name = (select pr.display_name from public.profiles pr where pr.id = v_uid),
    closed_at = now(), close_device_tag = v_tag, counts = p_counts, counted_cash = v_counted,
    expected_cash = v_expected, over_short = v_counted - v_expected, closing_note = v_note
  where s.id = v_session.id;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_branch, 'drawer.close', v_uid, v_tag, 'drawer', v_session.id::text,
    jsonb_build_object(
      'businessDate', v_session.business_date, 'expected', v_expected, 'counted', v_counted,
      'overShort', v_counted - v_expected
    ),
    v_note
  );
  return jsonb_build_object(
    'expected', v_expected, 'counted', v_counted, 'overShort', v_counted - v_expected
  );
end;
$$;

-- ---- reopen_drawer -----------------------------------------------------------------------
-- The Owner only, with a reason: the store's latest drawer opens again (late sales otherwise
-- go to the next day's drawer). Its closing is kept in the audit log.
-- Errors: not_found (not the latest drawer), already_open, invalid_input.
create function private.reopen_drawer(
  p_session_id uuid,
  p_reason text,
  p_device_tag text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_reason text := private.catalog_text(p_reason, 200, true);
  v_session public.drawer_sessions;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;

  select * into v_session from public.drawer_sessions s
  where s.branch_id = v_branch
  order by s.business_date desc
  limit 1
  for update;
  if not found or v_session.id <> p_session_id then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_session.status = 'open' then
    raise exception 'already_open' using errcode = 'P0001';
  end if;

  update public.drawer_sessions s set
    status = 'open', closed_by = null, closed_by_name = null, closed_at = null,
    close_device_tag = null, counts = null, counted_cash = null, expected_cash = null,
    over_short = null, closing_note = null
  where s.id = v_session.id;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, before, after, reason)
  values (
    v_branch, 'drawer.reopen', v_uid, v_tag, 'drawer', v_session.id::text,
    jsonb_build_object(
      'businessDate', v_session.business_date, 'status', v_session.status,
      'closedBy', v_session.closed_by_name, 'closedAt', v_session.closed_at,
      'counted', v_session.counted_cash, 'expected', v_session.expected_cash,
      'overShort', v_session.over_short
    ),
    jsonb_build_object('status', 'open'),
    v_reason
  );
end;
$$;

-- ---- Grants and API wrappers -------------------------------------------------------------
revoke execute on function
  private.drawer_today(),
  private.open_drawer(numeric, text, text),
  private.record_drawer_entry(text, numeric, text, text, text),
  private.drawer_expected_cash(),
  private.close_drawer(jsonb, text, text),
  private.reopen_drawer(uuid, text, text)
from public, anon;
grant execute on function
  private.drawer_today(),
  private.open_drawer(numeric, text, text),
  private.record_drawer_entry(text, numeric, text, text, text),
  private.drawer_expected_cash(),
  private.close_drawer(jsonb, text, text),
  private.reopen_drawer(uuid, text, text)
to authenticated;

create function public.drawer_today()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.drawer_today(); $$;

create function public.open_drawer(
  p_opening_cash numeric,
  p_reason text default null,
  p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.open_drawer(p_opening_cash, p_reason, p_device_tag); $$;

create function public.record_drawer_entry(
  p_type text,
  p_amount numeric,
  p_reason text,
  p_note text default null,
  p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.record_drawer_entry(p_type, p_amount, p_reason, p_note, p_device_tag); $$;

create function public.drawer_expected_cash()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$ select private.drawer_expected_cash(); $$;

create function public.close_drawer(
  p_counts jsonb,
  p_note text default null,
  p_device_tag text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.close_drawer(p_counts, p_note, p_device_tag); $$;

create function public.reopen_drawer(
  p_session_id uuid,
  p_reason text,
  p_device_tag text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.reopen_drawer(p_session_id, p_reason, p_device_tag); $$;

revoke execute on function
  public.drawer_today(),
  public.open_drawer(numeric, text, text),
  public.record_drawer_entry(text, numeric, text, text, text),
  public.drawer_expected_cash(),
  public.close_drawer(jsonb, text, text),
  public.reopen_drawer(uuid, text, text)
from public, anon;
grant execute on function
  public.drawer_today(),
  public.open_drawer(numeric, text, text),
  public.record_drawer_entry(text, numeric, text, text, text),
  public.drawer_expected_cash(),
  public.close_drawer(jsonb, text, text),
  public.reopen_drawer(uuid, text, text)
to authenticated;
