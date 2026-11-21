-- Build step 11, PR 1: attendance rules, clock-in and clock-out (SRS ATT-01..13; the owner's
-- decisions of Nov 21, 2026, which change ATT-01: staff now clock in AND out).
--
--   Store hours 8:00 AM to 6:00 PM. One time in and one time out per person per day, from
--   their own phone, at the store (GPS radius). Nothing about the day is typed by staff: the
--   server works it out from the two times and the Owner's settings, and keeps the settings
--   it used on the record (ATT-09), so payroll (step 14) only multiplies by the daily rate.
--
--   Time in before the "afternoon half day" line (12:00 noon)  -> a morning start;
--     late after "latest time in" (8:00 AM, or the person's own time) + grace.
--   Time in at or after that line -> an afternoon half day;
--     late after the afternoon start (1:00 PM) + grace.
--   A morning start that clocks out before the "morning half day" line (3:00 PM) -> a morning
--     half day; otherwise a whole day.
--   Before "earliest time out" (6:00 PM): early out, minutes recorded (no deduction: only
--   marked). After it: overtime minutes, recorded for payroll to decide.
--   No time out yet: the day is open and counts for nothing until fixed.
--
--   Location: inside the radius, allowed. Outside it with a good fix, refused (shows how far).
--   No fix or a poor one: allowed and flagged "location not verified". Store location not set:
--   allowed, flagged "store location not set". Offline: the phone's time is used when it is
--   believable, and the record says it was sent late (ATT-12).

-- ---- Settings ------------------------------------------------------------------------------
alter table public.branches
  add column earliest_out time not null default '18:00',
  add column afternoon_line time not null default '12:00',
  add column morning_out_line time not null default '15:00';
alter table public.branches alter column morning_clock_in set default '08:00';
-- The store opens at 8:00 (the owner, Nov 21): the old 6:00 default becomes 8:00.
update public.branches set morning_clock_in = '08:00' where morning_clock_in = '06:00';
alter table public.branches
  add constraint branches_attendance_lines check (
    morning_clock_in < afternoon_line and afternoon_line <= afternoon_clock_in
    and afternoon_clock_in < morning_out_line and morning_out_line <= earliest_out
  );

-- A person's usual rest day (0 = Sunday … 6 = Saturday), shown instead of "not in yet".
alter table public.profiles
  add column rest_weekday smallint check (rest_weekday between 0 and 6);

-- ---- Attendance ------------------------------------------------------------------------------
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  user_id uuid not null references public.profiles (id),
  user_name text not null,
  work_date date not null,
  -- worked: clocked in. absent / rest: marked by the Owner (PR 3), no times.
  kind text not null default 'worked' check (kind in ('worked', 'absent', 'rest')),
  in_at timestamptz,
  in_device_at timestamptz,
  in_server_at timestamptz,
  in_client_id uuid,
  in_lat double precision,
  in_lng double precision,
  in_accuracy_m double precision,
  in_distance_m integer,
  in_location text check (in_location in ('ok', 'not_verified', 'not_set')),
  out_at timestamptz,
  out_device_at timestamptz,
  out_server_at timestamptz,
  out_client_id uuid,
  out_lat double precision,
  out_lng double precision,
  out_accuracy_m double precision,
  out_distance_m integer,
  out_location text check (out_location in ('ok', 'not_verified', 'not_set')),
  start_type text check (start_type in ('morning', 'afternoon')),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  -- Null while the day has no time out.
  day_type text check (day_type in ('whole', 'morning_half', 'afternoon_half')),
  day_credit numeric(2, 1) check (day_credit in (0.5, 1)),
  early_minutes integer not null default 0 check (early_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  -- location_not_verified, store_location_not_set, sent_late, clock_ahead, edited
  flags text[] not null default '{}',
  -- The settings used for this day (ATT-09).
  rules jsonb not null default '{}',
  note text check (char_length(note) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date),
  check ((kind = 'worked') = (in_at is not null)),
  check (out_at is null or in_at is not null),
  check ((out_at is null) = (day_type is null)),
  check ((day_type is null) = (day_credit is null))
);
create index attendance_branch_date_idx on public.attendance (branch_id, work_date);

revoke all on table public.attendance from public, anon, authenticated, service_role;
grant select on table public.attendance to authenticated;
alter table public.attendance enable row level security;
-- ATT-14: the Owner sees everyone; ATT-15: staff see their own.
create policy attendance_select_owner on public.attendance
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));
create policy attendance_select_own on public.attendance
  for select to authenticated
  using ((select private.has_access()) and user_id = (select auth.uid()));
-- The Owner's board updates without a reload.
alter publication supabase_realtime add table public.attendance;

-- ---- Rules and the day's result --------------------------------------------------------------
-- Minutes after midnight (store time) of a moment on a given work date.
create function private.minutes_on(p_at timestamptz, p_day date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (extract(epoch from ((p_at at time zone 'Asia/Manila') - p_day::timestamp)) / 60)::integer;
$$;

create function private.minutes_of(p_time time)
returns integer
language sql
immutable
set search_path = ''
as $$ select (extract(hour from p_time) * 60 + extract(minute from p_time))::integer; $$;

-- The settings that apply to one person now, as kept on each record.
create function private.attendance_rules(p_branch text, p_user uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'latestIn', private.minutes_of(coalesce(pr.clock_in_override, b.morning_clock_in)),
    'ownTime', pr.clock_in_override is not null,
    'afternoonStart', private.minutes_of(b.afternoon_clock_in),
    'graceMinutes', b.grace_minutes,
    'afternoonLine', private.minutes_of(b.afternoon_line),
    'morningOutLine', private.minutes_of(b.morning_out_line),
    'earliestOut', private.minutes_of(b.earliest_out),
    'afternoonCredit', b.afternoon_day_credit,
    'lateRule', b.late_deduction,
    'lateFlat', b.late_penalty,
    'paidMinutesPerDay', b.paid_minutes_per_day
  )
  from public.branches b
  join public.profiles pr on pr.id = p_user
  where b.id = p_branch;
$$;

-- p_in, p_out: minutes after midnight. Returns the day: {startType, lateMinutes, dayType,
-- dayCredit, earlyMinutes, overtimeMinutes}; dayType and dayCredit are null with no time out.
create function private.attendance_day(p_rules jsonb, p_in integer, p_out integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_afternoon boolean := p_in >= (p_rules ->> 'afternoonLine')::integer;
  v_shift integer := case when v_afternoon then (p_rules ->> 'afternoonStart')::integer
    else (p_rules ->> 'latestIn')::integer end;
  v_late integer := 0;
  v_type text;
  v_credit numeric;
  v_early integer := 0;
  v_over integer := 0;
  v_out_line integer := (p_rules ->> 'earliestOut')::integer;
begin
  -- Late only past the grace period, counted from the time in that applies (ATT-06).
  if p_in > v_shift + (p_rules ->> 'graceMinutes')::integer then
    v_late := p_in - v_shift;
  end if;
  if p_out is not null then
    if v_afternoon then
      v_type := 'afternoon_half';
      v_credit := (p_rules ->> 'afternoonCredit')::numeric;
    elsif p_out < (p_rules ->> 'morningOutLine')::integer then
      v_type := 'morning_half';
      v_credit := 0.5;
    else
      v_type := 'whole';
      v_credit := 1;
    end if;
    -- A morning half day leaves early on purpose: no early-out minutes for it.
    if v_type <> 'morning_half' then
      v_early := greatest(0, v_out_line - p_out);
    end if;
    v_over := greatest(0, p_out - v_out_line);
  end if;
  return jsonb_build_object(
    'startType', case when v_afternoon then 'afternoon' else 'morning' end,
    'lateMinutes', v_late, 'dayType', v_type, 'dayCredit', v_credit,
    'earlyMinutes', v_early, 'overtimeMinutes', v_over
  );
end;
$$;

-- Metres between two points (haversine).
create function private.distance_m(p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision)
returns integer
language sql
immutable
set search_path = ''
as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  )))::integer;
$$;

-- The location check (ATT-02..04). Returns {location, distance, flag}; raises outside_radius
-- (with the distance in the message detail) when a good fix is outside the radius.
create function private.check_location(p_branch text, p_lat double precision,
  p_lng double precision, p_accuracy double precision)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_b public.branches;
  v_distance integer;
begin
  select * into v_b from public.branches b where b.id = p_branch;
  if v_b.store_lat is null then
    return jsonb_build_object('location', 'not_set', 'distance', null, 'flag', 'store_location_not_set');
  end if;
  if p_lat is null or p_lng is null then
    return jsonb_build_object('location', 'not_verified', 'distance', null, 'flag', 'location_not_verified');
  end if;
  v_distance := private.distance_m(v_b.store_lat, v_b.store_lng, p_lat, p_lng);
  if p_accuracy is null or p_accuracy > v_b.radius_m then
    return jsonb_build_object('location', 'not_verified', 'distance', v_distance, 'flag', 'location_not_verified');
  end if;
  if v_distance > v_b.radius_m then
    raise exception 'outside_radius' using errcode = 'P0001', detail = v_distance::text;
  end if;
  return jsonb_build_object('location', 'ok', 'distance', v_distance, 'flag', null);
end;
$$;

-- The time a clock event counts at: the phone's time when it is believable (sent from the
-- outbox, not in the future, within the last 24 hours), otherwise the server's. Flags:
-- sent_late (more than 5 minutes behind) and clock_ahead (the phone was ahead).
create function private.event_time(p_device_at timestamptz)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if p_device_at is null then
    return jsonb_build_object('at', v_now, 'flag', null);
  end if;
  if p_device_at > v_now + interval '2 minutes' then
    return jsonb_build_object('at', v_now, 'flag', 'clock_ahead');
  end if;
  if p_device_at < v_now - interval '24 hours' then
    return jsonb_build_object('at', v_now, 'flag', 'sent_late');
  end if;
  return jsonb_build_object('at', p_device_at,
    'flag', case when p_device_at < v_now - interval '5 minutes' then 'sent_late' end);
end;
$$;

revoke execute on function
  private.minutes_on(timestamptz, date), private.minutes_of(time),
  private.attendance_rules(text, uuid), private.attendance_day(jsonb, integer, integer),
  private.distance_m(double precision, double precision, double precision, double precision),
  private.check_location(text, double precision, double precision, double precision),
  private.event_time(timestamptz)
from public, anon, authenticated;

-- Who clocks in: Special Sales and Sales; the Owner only with "Owner clocks in too".
create function private.can_clock()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_access() and (
    not private.is_owner()
    or exists (select 1 from public.branches b where b.id = private.current_branch() and b.owner_clocks_in)
  );
$$;
revoke execute on function private.can_clock() from public, anon, authenticated;

-- ---- clock_in --------------------------------------------------------------------------------
-- p: {clientId, deviceAt (sent from the outbox, else null), lat, lng, accuracy}. Returns the
-- day's record. Errors: outside_radius, already_clocked_in (another time in today), invalid_input.
create function private.clock_in(p jsonb, p_device_tag text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_client uuid;
  v_time jsonb;
  v_at timestamptz;
  v_day date;
  v_loc jsonb;
  v_rules jsonb;
  v_result jsonb;
  v_flags text[] := '{}';
  v_row public.attendance;
begin
  if v_uid is null or not private.can_clock() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  begin
    v_client := (p ->> 'clientId')::uuid;
  exception when others then
    raise exception 'invalid_input' using errcode = '22023';
  end;
  if v_client is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  -- The same clock-in sent twice (outbox retry): the record as it is.
  select * into v_row from public.attendance a where a.user_id = v_uid and a.in_client_id = v_client;
  if found then
    return to_jsonb(v_row);
  end if;

  v_time := private.event_time(nullif(p ->> 'deviceAt', '')::timestamptz);
  v_at := (v_time ->> 'at')::timestamptz;
  v_day := (v_at at time zone 'Asia/Manila')::date;
  if exists (select 1 from public.attendance a where a.user_id = v_uid and a.work_date = v_day) then
    raise exception 'already_clocked_in' using errcode = '23505';
  end if;
  v_loc := private.check_location(v_branch, (p ->> 'lat')::double precision,
    (p ->> 'lng')::double precision, (p ->> 'accuracy')::double precision);
  v_rules := private.attendance_rules(v_branch, v_uid);
  v_result := private.attendance_day(v_rules, private.minutes_on(v_at, v_day), null);
  if v_loc ->> 'flag' is not null then v_flags := v_flags || (v_loc ->> 'flag'); end if;
  if v_time ->> 'flag' is not null then v_flags := v_flags || (v_time ->> 'flag'); end if;

  insert into public.attendance
    (branch_id, user_id, user_name, work_date, in_at, in_device_at, in_server_at, in_client_id,
     in_lat, in_lng, in_accuracy_m, in_distance_m, in_location, start_type, late_minutes,
     flags, rules)
  values (
    v_branch, v_uid, (select pr.display_name from public.profiles pr where pr.id = v_uid), v_day,
    v_at, nullif(p ->> 'deviceAt', '')::timestamptz, now(), v_client,
    (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
    (p ->> 'accuracy')::double precision, (v_loc ->> 'distance')::integer, v_loc ->> 'location',
    v_result ->> 'startType', (v_result ->> 'lateMinutes')::integer, v_flags, v_rules
  )
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- ---- clock_out -------------------------------------------------------------------------------
-- Same payload. Closes the day the time out falls on. Errors: outside_radius, not_clocked_in,
-- already_clocked_out, out_before_in, invalid_input.
create function private.clock_out(p jsonb, p_device_tag text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_client uuid;
  v_time jsonb;
  v_at timestamptz;
  v_loc jsonb;
  v_result jsonb;
  v_flags text[];
  v_row public.attendance;
begin
  if v_uid is null or not private.can_clock() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  begin
    v_client := (p ->> 'clientId')::uuid;
  exception when others then
    raise exception 'invalid_input' using errcode = '22023';
  end;
  if v_client is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_row from public.attendance a where a.user_id = v_uid and a.out_client_id = v_client;
  if found then
    return to_jsonb(v_row);
  end if;

  v_time := private.event_time(nullif(p ->> 'deviceAt', '')::timestamptz);
  v_at := (v_time ->> 'at')::timestamptz;
  select * into v_row from public.attendance a
  where a.user_id = v_uid and a.work_date = (v_at at time zone 'Asia/Manila')::date
  for update;
  if not found or v_row.kind <> 'worked' then
    raise exception 'not_clocked_in' using errcode = 'P0002';
  end if;
  if v_row.out_at is not null then
    raise exception 'already_clocked_out' using errcode = '23505';
  end if;
  if v_at <= v_row.in_at then
    raise exception 'out_before_in' using errcode = '22023';
  end if;
  v_loc := private.check_location(v_branch, (p ->> 'lat')::double precision,
    (p ->> 'lng')::double precision, (p ->> 'accuracy')::double precision);
  v_result := private.attendance_day(v_row.rules,
    private.minutes_on(v_row.in_at, v_row.work_date), private.minutes_on(v_at, v_row.work_date));
  v_flags := v_row.flags;
  if v_loc ->> 'flag' is not null and not (v_loc ->> 'flag' = any (v_flags)) then
    v_flags := v_flags || (v_loc ->> 'flag');
  end if;
  if v_time ->> 'flag' is not null and not (v_time ->> 'flag' = any (v_flags)) then
    v_flags := v_flags || (v_time ->> 'flag');
  end if;

  update public.attendance a set
    out_at = v_at, out_device_at = nullif(p ->> 'deviceAt', '')::timestamptz,
    out_server_at = now(), out_client_id = v_client,
    out_lat = (p ->> 'lat')::double precision, out_lng = (p ->> 'lng')::double precision,
    out_accuracy_m = (p ->> 'accuracy')::double precision,
    out_distance_m = (v_loc ->> 'distance')::integer, out_location = v_loc ->> 'location',
    day_type = v_result ->> 'dayType', day_credit = (v_result ->> 'dayCredit')::numeric,
    early_minutes = (v_result ->> 'earlyMinutes')::integer,
    overtime_minutes = (v_result ->> 'overtimeMinutes')::integer,
    flags = v_flags, updated_at = now()
  where a.id = v_row.id
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- ---- attendance_today: the clock screen's state ----------------------------------------------
-- {today, canClock, record (own, today, or null), rules (in minutes), storeLocationSet}.
create function private.attendance_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_today date := private.manila_today();
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'today', v_today,
    'canClock', private.can_clock(),
    'record', (select to_jsonb(a) from public.attendance a where a.user_id = v_uid and a.work_date = v_today),
    'rules', private.attendance_rules(v_branch, v_uid),
    'storeLocationSet', exists (select 1 from public.branches b where b.id = v_branch and b.store_lat is not null)
  );
end;
$$;

revoke execute on function
  private.clock_in(jsonb, text), private.clock_out(jsonb, text), private.attendance_today()
from public, anon;
grant execute on function
  private.clock_in(jsonb, text), private.clock_out(jsonb, text), private.attendance_today()
to authenticated;

create function public.clock_in(p jsonb, p_device_tag text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.clock_in(p, p_device_tag); $$;
create function public.clock_out(p jsonb, p_device_tag text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.clock_out(p, p_device_tag); $$;
create function public.attendance_today()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.attendance_today(); $$;

revoke execute on function
  public.clock_in(jsonb, text), public.clock_out(jsonb, text), public.attendance_today()
from public, anon;
grant execute on function
  public.clock_in(jsonb, text), public.clock_out(jsonb, text), public.attendance_today()
to authenticated;


-- ---- update_branch_settings: the three new attendance times join (same checks and audit) ----
create or replace function private.update_branch_settings(
  p_changes jsonb,
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
  v_allowed constant text[] := array[
    'name', 'address', 'contact', 'tin', 'receipt_footer',
    'vat_registered', 'vat_rate', 'round_cash', 'return_window_days',
    'idle_lock_minutes', 'store_lat', 'store_lng', 'radius_m',
    'morning_clock_in', 'afternoon_clock_in', 'afternoon_line', 'morning_out_line', 'earliest_out',
    'grace_minutes', 'late_deduction',
    'late_penalty', 'paid_minutes_per_day', 'afternoon_day_credit', 'owner_clocks_in'
  ];
  v_before jsonb;
  v_after jsonb;
  v_old jsonb := '{}';
  v_new jsonb := '{}';
  v_key text;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'
    or exists (select 1 from jsonb_object_keys(p_changes) k where k <> all (v_allowed))
    -- The yes/no settings take true or false only, never "yes" or 1.
    or exists (
      select 1 from unnest(array['vat_registered', 'round_cash']) k
      where p_changes ? k and jsonb_typeof(p_changes -> k) <> 'boolean'
    )
    -- The rate is a number with at most 2 decimals: 12 or 12.5, never "12%".
    or (p_changes ? 'vat_rate' and (
      jsonb_typeof(p_changes -> 'vat_rate') <> 'number'
      or (p_changes ->> 'vat_rate')::numeric <> round((p_changes ->> 'vat_rate')::numeric, 2)
    ))
    -- The return window is whole days.
    or (p_changes ? 'return_window_days' and (
      jsonb_typeof(p_changes -> 'return_window_days') <> 'number'
      or (p_changes ->> 'return_window_days')::numeric <> trunc((p_changes ->> 'return_window_days')::numeric)
    )) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select to_jsonb(b) into v_before from public.branches b where b.id = v_branch for update;

  update public.branches b set
    name = case when p_changes ? 'name' then btrim(p_changes ->> 'name') else b.name end,
    address = case when p_changes ? 'address'
      then nullif(btrim(p_changes ->> 'address'), '') else b.address end,
    contact = case when p_changes ? 'contact'
      then nullif(btrim(p_changes ->> 'contact'), '') else b.contact end,
    tin = case when p_changes ? 'tin'
      then nullif(btrim(p_changes ->> 'tin'), '') else b.tin end,
    receipt_footer = case when p_changes ? 'receipt_footer'
      then nullif(btrim(p_changes ->> 'receipt_footer'), '') else b.receipt_footer end,
    vat_registered = case when p_changes ? 'vat_registered'
      then (p_changes ->> 'vat_registered')::boolean else b.vat_registered end,
    vat_rate = case when p_changes ? 'vat_rate'
      then (p_changes ->> 'vat_rate')::numeric(4, 2) else b.vat_rate end,
    round_cash = case when p_changes ? 'round_cash'
      then (p_changes ->> 'round_cash')::boolean else b.round_cash end,
    return_window_days = case when p_changes ? 'return_window_days'
      then (p_changes ->> 'return_window_days')::integer else b.return_window_days end,
    idle_lock_minutes = case when p_changes ? 'idle_lock_minutes'
      then (p_changes ->> 'idle_lock_minutes')::integer else b.idle_lock_minutes end,
    store_lat = case when p_changes ? 'store_lat'
      then (p_changes ->> 'store_lat')::double precision else b.store_lat end,
    store_lng = case when p_changes ? 'store_lng'
      then (p_changes ->> 'store_lng')::double precision else b.store_lng end,
    radius_m = case when p_changes ? 'radius_m'
      then (p_changes ->> 'radius_m')::integer else b.radius_m end,
    morning_clock_in = case when p_changes ? 'morning_clock_in'
      then date_trunc('minute', (p_changes ->> 'morning_clock_in')::time)::time
      else b.morning_clock_in end,
    afternoon_clock_in = case when p_changes ? 'afternoon_clock_in'
      then date_trunc('minute', (p_changes ->> 'afternoon_clock_in')::time)::time
      else b.afternoon_clock_in end,
    afternoon_line = case when p_changes ? 'afternoon_line'
      then date_trunc('minute', (p_changes ->> 'afternoon_line')::time)::time
      else b.afternoon_line end,
    morning_out_line = case when p_changes ? 'morning_out_line'
      then date_trunc('minute', (p_changes ->> 'morning_out_line')::time)::time
      else b.morning_out_line end,
    earliest_out = case when p_changes ? 'earliest_out'
      then date_trunc('minute', (p_changes ->> 'earliest_out')::time)::time
      else b.earliest_out end,
    grace_minutes = case when p_changes ? 'grace_minutes'
      then (p_changes ->> 'grace_minutes')::integer else b.grace_minutes end,
    late_deduction = case when p_changes ? 'late_deduction'
      then p_changes ->> 'late_deduction' else b.late_deduction end,
    late_penalty = case when p_changes ? 'late_penalty'
      then (p_changes ->> 'late_penalty')::numeric(12, 2) else b.late_penalty end,
    paid_minutes_per_day = case when p_changes ? 'paid_minutes_per_day'
      then (p_changes ->> 'paid_minutes_per_day')::integer else b.paid_minutes_per_day end,
    afternoon_day_credit = case when p_changes ? 'afternoon_day_credit'
      then (p_changes ->> 'afternoon_day_credit')::numeric(2, 1) else b.afternoon_day_credit end,
    owner_clocks_in = case when p_changes ? 'owner_clocks_in'
      then (p_changes ->> 'owner_clocks_in')::boolean else b.owner_clocks_in end
  where b.id = v_branch
  returning to_jsonb(b) into v_after;

  foreach v_key in array v_allowed loop
    if (v_before -> v_key) is distinct from (v_after -> v_key) then
      v_old := v_old || jsonb_build_object(v_key, v_before -> v_key);
      v_new := v_new || jsonb_build_object(v_key, v_after -> v_key);
    end if;
  end loop;

  if v_new <> '{}' then
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
    values (
      v_branch, 'branch.update', v_uid, private.valid_device_tag(p_device_tag), 'branch',
      v_branch, v_old, v_new
    );
  end if;
exception
  -- A malformed value or one a constraint refuses is bad input, like any other: one error
  -- code for the app to explain. Nothing was changed.
  when invalid_text_representation or numeric_value_out_of_range or check_violation
    or not_null_violation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;
