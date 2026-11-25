-- "Absent · no time in" starts from each person's own first clock-in (SRS ATT-14; the owner's
-- answer to Q-ATT-1 of Nov 25, 2026). Before, it started from the store's first attendance
-- record of any kind, so an Owner's Absent mark on an early day made everyone absent on the
-- days after it. Now:
--
-- - each person's start is their first worked day (a day with a time in, clocked or fixed);
-- - an Owner's Absent or Rest day mark still shows on its own day but never moves a start;
-- - a person who never clocked in has no "no time in" days.
--
-- The Owner's board, history, summary and CSV read attendance_first_days(); a staff member's
-- own list reads firstIn from attendance_today(). Nothing stored changes.

-- Each person's first worked day. Row Level Security decides whose: the Owner gets the
-- store's people, staff only themselves.
create function public.attendance_first_days()
returns table (user_id uuid, first_day date)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.user_id, min(a.work_date)
  from public.attendance a
  where a.kind = 'worked'
  group by a.user_id;
$$;
revoke execute on function public.attendance_first_days() from public, anon;
grant execute on function public.attendance_first_days() to authenticated;

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
    -- The person's own first worked day: no day before it is their "absent".
    'firstIn', (select min(a.work_date) from public.attendance a where a.user_id = v_uid and a.kind = 'worked'),
    'restWeekday', (select pr.rest_weekday from public.profiles pr where pr.id = v_uid),
    'since', (select (pr.created_at at time zone 'Asia/Manila')::date from public.profiles pr where pr.id = v_uid)
  );
end;
$$;
