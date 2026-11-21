-- Build step 11, PR 3: fixing a day (SRS ATT-11; the owner's decisions of Nov 21, 2026), and
-- clearer location flags (the Nov 22 staging test).
--
--   Staff ask for a fix of one of their days (a forgotten time in or out, or a wrong time),
--   with the real times and a reason; the Owner approves or rejects in Approvals, like voids
--   and returns. The Owner can also fix any day directly, mark a day Absent or Rest day, and
--   set each person's usual rest day. Every change is audit-logged with its reason, and the
--   day is worked out again by the server from the times, with the settings it was first
--   made with (a day with no record yet takes today's settings).
--
--   Location flags: "location not read" (no reading at all) is now told apart from "location
--   not verified" (a reading too poor to trust), and the record keeps the distance and the
--   accuracy, so the Owner sees e.g. "230 m away, accuracy 40 m".

-- ---- Approval requests: the new type ---------------------------------------------------------
alter table public.approval_requests
  drop constraint approval_requests_type_check,
  add constraint approval_requests_type_check
    check (type in ('product_edit', 'stock_adjustment', 'stock_in_correction', 'sale_void',
      'sale_return', 'attendance_fix')),
  drop constraint approval_requests_target_type_check,
  add constraint approval_requests_target_type_check
    check (target_type in ('product', 'stock_receipt', 'sale', 'attendance'));

-- A person's day has a stable id before any record exists (a forgotten time in): one pending
-- fix per person and day.
create function private.day_key(p_user uuid, p_day date)
returns uuid
language sql
immutable
set search_path = ''
as $$ select md5(p_user::text || '/' || p_day::text)::uuid; $$;

-- A store time on a work date, as a moment.
create function private.at_on(p_day date, p_time time)
returns timestamptz
language sql
immutable
set search_path = ''
as $$ select (p_day + p_time) at time zone 'Asia/Manila'; $$;

revoke execute on function private.day_key(uuid, date), private.at_on(date, time)
  from public, anon, authenticated;

-- ---- Applying a fix (the Owner's own, or an approved request) -------------------------------
-- p_in, p_out: the day's times (null keeps what is recorded). Errors: invalid_input,
-- out_before_in, future_day.
create function private.apply_attendance_fix(
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
revoke execute on function private.apply_attendance_fix(uuid, date, time, time, text, text, uuid)
  from public, anon, authenticated;

-- What a person's day holds now, for a request's "before" (outdated when it changes).
create function private.day_now(p_user uuid, p_day date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('kind', a.kind, 'in', a.in_at, 'out', a.out_at)
    from public.attendance a where a.user_id = p_user and a.work_date = p_day
  ), '{}'::jsonb);
$$;
revoke execute on function private.day_now(uuid, date) from public, anon, authenticated;

-- ---- request_attendance_fix: staff, for one of their own days (last 30 days) -----------------
-- Errors: invalid_input, too_old (more than 30 days ago), request_pending.
create function private.request_attendance_fix(
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

-- ---- The Owner, directly ----------------------------------------------------------------------
create function private.fix_attendance(
  p_user uuid,
  p_day date,
  p_in time,
  p_out time,
  p_reason text,
  p_device_tag text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  return private.apply_attendance_fix(p_user, p_day, p_in, p_out, p_reason, p_device_tag, null);
end;
$$;

-- p_kind: absent, rest, or clear (removes the mark). A day with times can't be marked: fix its
-- times instead. Errors: invalid_input, has_times, not_found.
create function private.mark_attendance_day(
  p_user uuid,
  p_day date,
  p_kind text,
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
  v_reason text := private.catalog_text(p_reason, 200, true);
  v_row public.attendance;
  v_name text;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_day is null or p_kind is null or p_kind not in ('absent', 'rest', 'clear') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select pr.display_name into v_name from public.profiles pr where pr.id = p_user and pr.branch_id = v_branch;
  if v_name is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into v_row from public.attendance a where a.user_id = p_user and a.work_date = p_day for update;
  if found and v_row.kind = 'worked' then
    raise exception 'has_times' using errcode = '22023';
  end if;
  if p_kind = 'clear' then
    delete from public.attendance a where a.id = v_row.id;
  elsif found then
    update public.attendance a set kind = p_kind, note = v_reason, updated_at = now() where a.id = v_row.id;
  else
    insert into public.attendance (branch_id, user_id, user_name, work_date, kind, note)
    values (v_branch, p_user, v_name, p_day, p_kind, v_reason);
  end if;
  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_branch, 'attendance.mark', v_uid, private.valid_device_tag(p_device_tag), 'attendance',
    private.day_key(p_user, p_day)::text,
    jsonb_build_object('name', v_name, 'day', p_day, 'kind', p_kind), v_reason
  );
end;
$$;

-- The usual rest day (0 = Sunday … 6 = Saturday, null = none).
create function private.set_rest_weekday(p_user uuid, p_weekday smallint, p_device_tag text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old smallint;
  v_name text;
begin
  if (select auth.uid()) is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_weekday is not null and p_weekday not between 0 and 6 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select pr.rest_weekday, pr.display_name into v_old, v_name from public.profiles pr
  where pr.id = p_user and pr.branch_id = private.current_branch() for update;
  if v_name is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.profiles pr set rest_weekday = p_weekday where pr.id = p_user;
  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
  values (
    private.current_branch(), 'attendance.restDay', (select auth.uid()),
    private.valid_device_tag(p_device_tag), 'user', p_user::text,
    jsonb_build_object('name', v_name, 'weekday', v_old),
    jsonb_build_object('name', v_name, 'weekday', p_weekday)
  );
end;
$$;

-- ---- Location: not read vs not verified --------------------------------------------------------
create or replace function private.check_location(p_branch text, p_lat double precision,
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
    return jsonb_build_object('location', 'not_verified', 'distance', null, 'flag', 'location_not_read');
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

-- ---- Grants and public wrappers ------------------------------------------------------------------
revoke execute on function
  private.request_attendance_fix(date, time, time, text, text),
  private.fix_attendance(uuid, date, time, time, text, text),
  private.mark_attendance_day(uuid, date, text, text, text),
  private.set_rest_weekday(uuid, smallint, text)
from public, anon;
grant execute on function
  private.request_attendance_fix(date, time, time, text, text),
  private.fix_attendance(uuid, date, time, time, text, text),
  private.mark_attendance_day(uuid, date, text, text, text),
  private.set_rest_weekday(uuid, smallint, text)
to authenticated;

create function public.request_attendance_fix(p_day date, p_in time, p_out time, p_reason text,
  p_device_tag text default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.request_attendance_fix(p_day, p_in, p_out, p_reason, p_device_tag); $$;
create function public.fix_attendance(p_user uuid, p_day date, p_in time, p_out time,
  p_reason text, p_device_tag text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.fix_attendance(p_user, p_day, p_in, p_out, p_reason, p_device_tag); $$;
create function public.mark_attendance_day(p_user uuid, p_day date, p_kind text, p_reason text,
  p_device_tag text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.mark_attendance_day(p_user, p_day, p_kind, p_reason, p_device_tag); $$;
create function public.set_rest_weekday(p_user uuid, p_weekday smallint, p_device_tag text default null)
returns void language sql security invoker set search_path = ''
as $$ select private.set_rest_weekday(p_user, p_weekday, p_device_tag); $$;

revoke execute on function
  public.request_attendance_fix(date, time, time, text, text),
  public.fix_attendance(uuid, date, time, time, text, text),
  public.mark_attendance_day(uuid, date, text, text, text),
  public.set_rest_weekday(uuid, smallint, text)
from public, anon;
grant execute on function
  public.request_attendance_fix(date, time, time, text, text),
  public.fix_attendance(uuid, date, time, time, text, text),
  public.mark_attendance_day(uuid, date, text, text, text),
  public.set_rest_weekday(uuid, smallint, text)
to authenticated;


-- ---- log_approval: a day is named by its label ----------------------------------------------
create or replace function private.log_approval(
  p_action text,
  p_request public.approval_requests,
  p_device_tag text
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  select p_request.branch_id, p_action, (select auth.uid()),
    private.valid_device_tag(p_device_tag), 'approval', p_request.id::text,
    jsonb_build_object(
      'type', p_request.type,
      'label', case p_request.target_type
        when 'product' then (select pr.name from public.products pr where pr.id = p_request.target_id)
        when 'sale' then coalesce(
          (select 'sale ' || s.receipt_no from public.sales s where s.id = p_request.target_id),
          'sale'
        )
        when 'attendance' then coalesce(p_request.after ->> 'label', 'attendance')
        else coalesce(
          (select 'stock-in ' || coalesce(r.reference, 'without reference') from public.stock_receipts r where r.id = p_request.target_id),
          'stock-in'
        )
      end,
      'requested_by', p_request.requested_by,
      'changes', p_request.after,
      'before', p_request.before,
      'names', private.names_of(array[
        (p_request.before ->> 'supplier_id')::uuid, (p_request.after ->> 'supplier_id')::uuid,
        (p_request.before ->> 'category_id')::uuid, (p_request.after ->> 'category_id')::uuid
      ])
    )
    || case p_request.target_type
      when 'product' then jsonb_build_object(
        'unit', (select pr.unit from public.products pr where pr.id = p_request.target_id)
      )
      when 'sale' then '{}'::jsonb
      when 'attendance' then '{}'::jsonb
      else jsonb_build_object('products', (
        select coalesce(jsonb_object_agg(l ->> 'product_id', jsonb_build_object('name', l -> 'name', 'unit', l -> 'unit')), '{}')
        from jsonb_array_elements(private.receipt_lines_named(p_request.target_id)) l
      ))
    end,
    case when p_action = 'approval.request' then p_request.reason else p_request.owner_note end;
$$;

-- ---- decide_approval: approving a fix of a day ---------------------------------------------
create or replace function private.decide_approval(
  p_id uuid,
  p_approve boolean,
  p_note text default null,
  p_device_tag text default null,
  p_refund_reference text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_note text := private.catalog_text(p_note, 200, false);
  v_row public.approval_requests;
  v_current jsonb;
  v_key text;
  v_sale public.sales;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_row from public.approval_requests r
  where r.id = p_id and r.branch_id = private.current_branch()
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'request_closed' using errcode = '22023';
  end if;

  if p_approve then
    if v_row.type = 'product_edit' then
      -- Outdated: the product changed since the request. Only rejecting is possible then.
      select to_jsonb(p) into v_current from public.products p
      where p.id = v_row.target_id
      for update;
      for v_key in select jsonb_object_keys(v_row.before) loop
        if (v_current -> v_key) is distinct from (v_row.before -> v_key) then
          raise exception 'request_outdated' using errcode = '22023';
        end if;
      end loop;
      perform private.apply_product_change(
        v_row.target_id, v_row.after, 'approval', p_device_tag, v_row.reason, false
      );
    elsif v_row.type = 'stock_adjustment' then
      perform private.apply_stock_adjustment(
        v_row.target_id, v_row.after ->> 'type', (v_row.after ->> 'qty')::numeric, v_row.reason,
        p_device_tag, v_row.id, false
      );
    elsif v_row.type = 'stock_in_correction' then
      -- Outdated: the stock-in was corrected since the request.
      if exists (select 1 from public.stock_receipts r where r.corrects_receipt_id = v_row.target_id) then
        raise exception 'request_outdated' using errcode = '22023';
      end if;
      perform private.apply_stock_in_correction(
        v_row.target_id, (v_row.after ->> 'supplier_id')::uuid, v_row.after ->> 'reference',
        v_row.after -> 'lines', (v_row.after ->> 'delete')::boolean, v_row.reason,
        p_device_tag, false, v_row.id
      );
    elsif v_row.type = 'sale_void' then
      -- Outdated: the sale was voided or corrected since, or its drawer is no longer open.
      select * into v_sale from public.sales s where s.id = v_row.target_id;
      begin
        perform private.check_voidable(v_sale);
      exception
        when sqlstate '22023' then
          raise exception 'request_outdated' using errcode = '22023';
      end;
      perform private.apply_void(v_row.target_id, v_row.reason, p_refund_reference, p_device_tag, v_row.id);
    elsif v_row.type = 'sale_return' then
      -- Outdated: the sale was voided, or something else was returned from it, since.
      select * into v_sale from public.sales s where s.id = v_row.target_id for update;
      if v_sale.status <> 'completed'
        or private.returned_lines(v_sale.id) is distinct from (v_row.before -> 'returned') then
        raise exception 'request_outdated' using errcode = '22023';
      end if;
      perform private.apply_return(
        v_row.target_id, v_row.after -> 'request', v_row.after ->> 'method', p_refund_reference,
        (v_row.after ->> 'defective')::boolean, v_row.reason, p_device_tag, v_row.id
      );
    elsif v_row.type = 'attendance_fix' then
      -- Outdated: the day changed since the request (clocked, fixed or marked).
      if private.day_now(v_row.requested_by, (v_row.after ->> 'workDate')::date)
        is distinct from (v_row.before -> 'day') then
        raise exception 'request_outdated' using errcode = '22023';
      end if;
      perform private.apply_attendance_fix(
        v_row.requested_by, (v_row.after ->> 'workDate')::date, (v_row.after ->> 'in')::time,
        (v_row.after ->> 'out')::time, v_row.reason, p_device_tag, v_row.id
      );
    end if;
  end if;

  update public.approval_requests r
  set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = v_uid, decided_at = now(), owner_note = v_note
  where r.id = p_id
  returning * into v_row;
  perform private.log_approval(
    case when p_approve then 'approval.approve' else 'approval.reject' end, v_row, p_device_tag
  );
end;
$$;
