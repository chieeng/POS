-- Staff see their own days the way the Owner's board does (SRS ATT-14, ATT-15; the Nov 24,
-- 2026 step 11 test: a day the Owner's board called "Absent" showed "No record" on the staff
-- member's own list).
--
-- The board works a day out from the person's usual rest day, when their account was made,
-- and the store's first day with attendance. Staff can read only their own rows and profile,
-- so the clock screen's answer now carries these three values too. Nothing is stored or
-- changed; days already recorded stay as they are.

create or replace function private.attendance_today()
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
    'storeLocationSet', exists (select 1 from public.branches b where b.id = v_branch and b.store_lat is not null),
    -- The store's first day with attendance: no day before it is anyone's "absent".
    'firstDay', (select min(a.work_date) from public.attendance a where a.branch_id = v_branch),
    'restWeekday', (select pr.rest_weekday from public.profiles pr where pr.id = v_uid),
    'since', (select (pr.created_at at time zone 'Asia/Manila')::date from public.profiles pr where pr.id = v_uid)
  );
end;
$$;
