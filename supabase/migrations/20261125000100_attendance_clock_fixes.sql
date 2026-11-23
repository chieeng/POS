-- Attendance clock fixes (found Nov 23, 2026, before step 11 PR 4; SRS ATT-01, ATT-06).
--
--   1. A time counts in the minute the clock shows. minutes_on cast to integer, which rounds:
--      11:59:40 AM became 12:00 (an afternoon half day, half the pay) and 8:15:40 became 8:16
--      (late by 16 minutes).
--   2. A time out only closes the day it belongs to. 20261123000200 fell back to yesterday's
--      open day at any hour, so a second tap, or a tap with no time in today, closed a
--      forgotten day with today's time and invented overtime. Now: today's day if there is
--      one; yesterday's only before 4:00 AM, for a time out just after midnight.
--
-- Days already recorded are not changed (staging test data only; production has no attendance).

create or replace function private.minutes_on(p_at timestamptz, p_day date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select floor(extract(epoch from ((p_at at time zone 'Asia/Manila') - p_day::timestamp)) / 60)::integer;
$$;

-- The work date a time out at p_at closes, or null when there is nothing for it to close.
create function private.day_to_close(p_user uuid, p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.attendance a
      where a.user_id = p_user and a.kind = 'worked' and a.work_date = t.day
    ) then t.day
    when t.local_time < time '04:00' and exists (
      select 1 from public.attendance a
      where a.user_id = p_user and a.kind = 'worked' and a.out_at is null
        and a.work_date = t.day - 1
    ) then t.day - 1
  end
  from (
    select (p_at at time zone 'Asia/Manila')::date as day,
      (p_at at time zone 'Asia/Manila')::time as local_time
  ) t;
$$;
revoke execute on function private.day_to_close(uuid, timestamptz) from public, anon, authenticated;

create or replace function private.clock_out(p jsonb, p_device_tag text default null)
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
  where a.user_id = v_uid and a.work_date = private.day_to_close(v_uid, v_at)
  for update;
  if not found then
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
