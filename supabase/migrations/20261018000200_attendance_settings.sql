-- Attendance settings (ATT-06, ATT-07, ATT-10, ATT-01): shift times, grace, the late
-- deduction, the afternoon-only day and whether the Owner clocks in. All on the branch row,
-- all changed by the Owner through update_branch_settings, every change audit-logged (ATT-09).
-- Attendance itself is not built yet, so no record depends on these values so far.

-- ---- Late deduction ----------------------------------------------------------------------
-- The store owner chooses (SRS ATT-06): none, the pay for the minutes late only, or a flat
-- amount per late day. Lateness itself is always recorded.
alter table public.branches
  add column late_deduction text not null default 'none'
    check (late_deduction in ('none', 'minutes', 'flat')),
  -- For "minutes": daily rate / paid minutes per day x minutes late.
  add column paid_minutes_per_day integer not null default 480
    check (paid_minutes_per_day between 60 and 1440),
  -- ATT-01: the Owner does not clock in unless this is turned on.
  add column owner_clocks_in boolean not null default false;

-- The flat amount is optional and starts at PHP 0 (it was PHP 50 from pos-erag). No Owner
-- could have chosen 50 yet: there was no screen for it.
alter table public.branches alter column late_penalty set default 0;
update public.branches set late_penalty = 0;

-- ATT-10: a day that starts with the afternoon shift is a half day unless the Owner says full.
update public.branches set afternoon_day_credit = 0.5 where afternoon_day_credit is null;
alter table public.branches
  alter column afternoon_day_credit set default 0.5,
  alter column afternoon_day_credit set not null,
  add constraint branches_shift_order check (afternoon_clock_in > morning_clock_in),
  add constraint branches_grace_minutes_max check (grace_minutes <= 120),
  add constraint branches_late_penalty_max check (late_penalty <= 10000);

-- ---- update_branch_settings: the attendance fields join the store fields -------------------
-- Same checks, same audit as before (20261018000100_store_settings.sql); only the list of
-- fields and their casts grow. CREATE OR REPLACE keeps the grants.
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
    'name', 'address', 'contact', 'tin', 'receipt_footer', 'sales_discount_limit',
    'idle_lock_minutes', 'store_lat', 'store_lng', 'radius_m',
    'morning_clock_in', 'afternoon_clock_in', 'grace_minutes', 'late_deduction',
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
    or exists (select 1 from jsonb_object_keys(p_changes) k where k <> all (v_allowed)) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select to_jsonb(b) into v_before from public.branches b where b.id = v_branch for update;

  -- Text fields are trimmed, and empty text clears an optional field. A wrong type (text for a
  -- number) fails the cast; a value out of range fails the table's constraints.
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
    sales_discount_limit = case when p_changes ? 'sales_discount_limit'
      then (p_changes ->> 'sales_discount_limit')::numeric(12, 2) else b.sales_discount_limit end,
    idle_lock_minutes = case when p_changes ? 'idle_lock_minutes'
      then (p_changes ->> 'idle_lock_minutes')::integer else b.idle_lock_minutes end,
    store_lat = case when p_changes ? 'store_lat'
      then (p_changes ->> 'store_lat')::double precision else b.store_lat end,
    store_lng = case when p_changes ? 'store_lng'
      then (p_changes ->> 'store_lng')::double precision else b.store_lng end,
    radius_m = case when p_changes ? 'radius_m'
      then (p_changes ->> 'radius_m')::integer else b.radius_m end,
    -- Whole minutes only: "06:00" or "06:00:00", never seconds that would shift lateness.
    morning_clock_in = case when p_changes ? 'morning_clock_in'
      then date_trunc('minute', (p_changes ->> 'morning_clock_in')::time)::time
      else b.morning_clock_in end,
    afternoon_clock_in = case when p_changes ? 'afternoon_clock_in'
      then date_trunc('minute', (p_changes ->> 'afternoon_clock_in')::time)::time
      else b.afternoon_clock_in end,
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
