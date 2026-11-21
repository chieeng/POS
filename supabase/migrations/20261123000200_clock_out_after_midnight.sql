-- Step 11, PR 2: a time out just after midnight closes the day it started (a time in at 11:40 PM
-- and out at 12:10 AM was refused as "not clocked in"). Same clock_out, finding the open day:
-- today's, or yesterday's.

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
  -- The day still open (no time out): today's, or yesterday's for a time out after midnight.
  select * into v_row from public.attendance a
  where a.user_id = v_uid and a.kind = 'worked' and a.out_at is null
    and a.work_date between (v_at at time zone 'Asia/Manila')::date - 1
      and (v_at at time zone 'Asia/Manila')::date
  order by a.work_date desc
  limit 1
  for update;
  if not found then
    if exists (
      select 1 from public.attendance a
      where a.user_id = v_uid and a.kind = 'worked'
        and a.work_date = (v_at at time zone 'Asia/Manila')::date
    ) then
      raise exception 'already_clocked_out' using errcode = '23505';
    end if;
    raise exception 'not_clocked_in' using errcode = 'P0002';
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
