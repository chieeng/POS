-- Attendance: the owner's decisions D, E and F of Nov 23, 2026 (SRS ATT-11, ATT-12).
--
--   D. A clock tap saved offline more than 24 hours before it reaches the server is refused
--      (tap_too_old): it would land on the wrong day. Before, it counted at the server's time,
--      on the day it was sent. The phone keeps it as "needs attention" and reports it to the
--      audit log (outbox.rejected); the day is fixed by a fix request.
--   E. A fix request, an approval or the Owner's direct fix with a time that hasn't happened
--      yet is refused (future_time).
--   F. A time in on a day marked Absent or Rest day replaces the mark; the audit log keeps it.
--
-- G (the 4:00 AM limit) and H (no Clock out after midnight, on the clock screen) need no
-- database change. Days already recorded are not changed.

-- ---- D: a tap more than 24 hours old ---------------------------------------------------------
create or replace function private.event_time(p_device_at timestamptz)
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
    raise exception 'tap_too_old' using errcode = '22023';
  end if;
  return jsonb_build_object('at', p_device_at,
    'flag', case when p_device_at < v_now - interval '5 minutes' then 'sent_late' end);
end;
$$;

-- ---- F: a time in replaces an Absent or Rest day mark -----------------------------------------
create or replace function private.clock_in(p jsonb, p_device_tag text default null)
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
  v_mark public.attendance;
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
  select * into v_mark from public.attendance a
  where a.user_id = v_uid and a.work_date = v_day
  for update;
  if found and v_mark.kind = 'worked' then
    raise exception 'already_clocked_in' using errcode = '23505';
  end if;
  v_loc := private.check_location(v_branch, (p ->> 'lat')::double precision,
    (p ->> 'lng')::double precision, (p ->> 'accuracy')::double precision);
  v_rules := private.attendance_rules(v_branch, v_uid);
  v_result := private.attendance_day(v_rules, private.minutes_on(v_at, v_day), null);
  if v_loc ->> 'flag' is not null then v_flags := v_flags || (v_loc ->> 'flag'); end if;
  if v_time ->> 'flag' is not null then v_flags := v_flags || (v_time ->> 'flag'); end if;

  if v_mark.id is not null then
    -- Marked Absent or Rest day: the time in replaces the mark, which stays in the audit log.
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, before, after, reason)
    values (
      v_branch, 'attendance.mark', v_uid, private.valid_device_tag(p_device_tag), 'attendance',
      private.day_key(v_uid, v_day)::text,
      jsonb_build_object('kind', v_mark.kind),
      jsonb_build_object('name', v_mark.user_name, 'day', v_day, 'kind', 'replaced', 'was', v_mark.kind),
      v_mark.note
    );
    delete from public.attendance a where a.id = v_mark.id;
  end if;

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

-- ---- E: no times that haven't happened yet ----------------------------------------------------
-- True when a time on a work date is later than now (store time).
create function private.is_future(p_day date, p_time time)
returns boolean
language sql
stable
set search_path = ''
as $$ select p_time is not null and private.at_on(p_day, p_time) > now(); $$;
revoke execute on function private.is_future(date, time) from public, anon, authenticated;

-- The Owner's direct fix and an approved request both come through here.
create or replace function private.apply_attendance_fix(
  p_user uuid,
  p_day date,
  p_in time,
  p_out time,
  p_reason text,
  p_device_tag text,
  p_request_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_reason text := private.catalog_text(p_reason, 200, true);
  v_row public.attendance;
  v_before jsonb;
  v_rules jsonb;
  v_in timestamptz;
  v_out timestamptz;
  v_result jsonb;
begin
  if p_day is null or p_day > private.manila_today() or (p_in is null and p_out is null) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if private.is_future(p_day, p_in) or private.is_future(p_day, p_out) then
    raise exception 'future_time' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = p_user and pr.branch_id = v_branch) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into v_row from public.attendance a where a.user_id = p_user and a.work_date = p_day for update;
  v_before := case when found then jsonb_build_object('kind', v_row.kind, 'in', v_row.in_at, 'out', v_row.out_at) end;
  v_rules := case when found and v_row.rules <> '{}' then v_row.rules
    else private.attendance_rules(v_branch, p_user) end;
  v_in := coalesce(private.at_on(p_day, p_in), case when v_row.kind = 'worked' then v_row.in_at end);
  v_out := coalesce(private.at_on(p_day, p_out), case when v_row.kind = 'worked' then v_row.out_at end);
  if v_in is null then
    -- A time out alone needs a time in to go with it.
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_out is not null and v_out <= v_in then
    raise exception 'out_before_in' using errcode = '22023';
  end if;
  v_result := private.attendance_day(v_rules, private.minutes_on(v_in, p_day),
    case when v_out is null then null else private.minutes_on(v_out, p_day) end);

  if v_row.id is null then
    insert into public.attendance
      (branch_id, user_id, user_name, work_date, kind, in_at, out_at, start_type, late_minutes,
       day_type, day_credit, early_minutes, overtime_minutes, flags, rules, note)
    values (
      v_branch, p_user, (select pr.display_name from public.profiles pr where pr.id = p_user), p_day,
      'worked', v_in, v_out, v_result ->> 'startType', (v_result ->> 'lateMinutes')::integer,
      v_result ->> 'dayType', (v_result ->> 'dayCredit')::numeric,
      (v_result ->> 'earlyMinutes')::integer, (v_result ->> 'overtimeMinutes')::integer,
      array['edited'], v_rules, v_reason
    )
    returning * into v_row;
  else
    update public.attendance a set
      kind = 'worked', in_at = v_in, out_at = v_out, start_type = v_result ->> 'startType',
      late_minutes = (v_result ->> 'lateMinutes')::integer, day_type = v_result ->> 'dayType',
      day_credit = (v_result ->> 'dayCredit')::numeric,
      early_minutes = (v_result ->> 'earlyMinutes')::integer,
      overtime_minutes = (v_result ->> 'overtimeMinutes')::integer,
      flags = case when 'edited' = any (a.flags) then a.flags else a.flags || 'edited'::text end,
      rules = v_rules, note = v_reason, updated_at = now()
    where a.id = v_row.id
    returning * into v_row;
  end if;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, before, after, reason)
  values (
    v_branch, 'attendance.fix', v_uid, private.valid_device_tag(p_device_tag), 'attendance',
    v_row.id::text, v_before,
    jsonb_build_object('name', v_row.user_name, 'day', p_day, 'in', v_row.in_at, 'out', v_row.out_at,
      'dayType', v_row.day_type, 'lateMinutes', v_row.late_minutes, 'requestId', p_request_id),
    v_reason
  );
  return to_jsonb(v_row);
end;
$$;

create or replace function private.request_attendance_fix(
  p_day date,
  p_in time,
  p_out time,
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
  v_row public.approval_requests;
  v_now jsonb;
  v_in timestamptz;
  v_out timestamptz;
begin
  if v_uid is null or not private.can_clock() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_day is null or p_day > private.manila_today() or (p_in is null and p_out is null) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_day < private.manila_today() - 30 then
    raise exception 'too_old' using errcode = '22023';
  end if;
  if private.is_future(p_day, p_in) or private.is_future(p_day, p_out) then
    raise exception 'future_time' using errcode = '22023';
  end if;
  v_now := private.day_now(v_uid, p_day);
  v_in := coalesce(private.at_on(p_day, p_in), (v_now ->> 'in')::timestamptz);
  v_out := coalesce(private.at_on(p_day, p_out), (v_now ->> 'out')::timestamptz);
  if v_in is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_out is not null and v_out <= v_in then
    raise exception 'out_before_in' using errcode = '22023';
  end if;
  begin
    insert into public.approval_requests
      (branch_id, type, target_type, target_id, before, after, reason, requested_by)
    values (
      private.current_branch(), 'attendance_fix', 'attendance', private.day_key(v_uid, p_day),
      jsonb_build_object('day', v_now),
      jsonb_build_object(
        'workDate', p_day, 'in', p_in, 'out', p_out,
        'label', (select pr.display_name from public.profiles pr where pr.id = v_uid) || ', '
          || to_char(p_day, 'Mon FMDD')
      ),
      private.catalog_text(p_reason, 200, true), v_uid
    )
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'request_pending' using errcode = '23505';
  end;
  perform private.log_approval('approval.request', v_row, p_device_tag);
  return v_row.id;
end;
$$;
