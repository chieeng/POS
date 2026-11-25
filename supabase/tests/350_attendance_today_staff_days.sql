-- Staff see their own days as the Owner's board does (ATT-14, ATT-15; the Nov 24, 2026 step
-- 11 test). "Absent · no time in" starts from each person's own first clock-in, and an Owner's
-- mark never moves it (the owner's answer to Q-ATT-1, Nov 25, 2026).
begin;
select * from no_plan();
select tests.fixture();

create function pg_temp.today(p_caller text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as(p_caller);
  v := public.attendance_today();
  perform tests.as_admin();
  return v;
end;
$$;
create function pg_temp.firsts(p_caller text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as(p_caller);
  select coalesce(jsonb_object_agg(
    case f.user_id when tests.uid('sales') then 'sales' when tests.uid('special') then 'special' else 'other' end,
    f.first_day), '{}') into v
  from public.attendance_first_days() f;
  perform tests.as_admin();
  return v;
end;
$$;
grant execute on function pg_temp.today(text), pg_temp.firsts(text) to authenticated;

select is((pg_temp.today('sales') ->> 'firstIn'), null, 'never clocked in: no first clock-in');

update public.profiles set rest_weekday = 0 where id = tests.uid('sales');
-- The Owner's mark on an early day, and later the first real days.
insert into public.attendance (branch_id, user_id, user_name, work_date, kind, note)
values ('tmain', tests.uid('sales'), 'Sales', private.manila_today() - 9, 'absent', 'x');
insert into public.attendance (branch_id, user_id, user_name, work_date, in_at, start_type, rules)
values
  ('tmain', tests.uid('sales'), 'Sales', private.manila_today() - 5,
   private.at_on(private.manila_today() - 5, '08:00'), 'morning', '{}'),
  ('tmain', tests.uid('special'), 'Special', private.manila_today() - 2,
   private.at_on(private.manila_today() - 2, '08:00'), 'morning', '{}');

select is(
  (select jsonb_build_object('first', t ->> 'firstIn', 'rest', t -> 'restWeekday', 'since', (t ->> 'since') is not null)
   from pg_temp.today('sales') t),
  jsonb_build_object('first', (private.manila_today() - 5)::text, 'rest', 0, 'since', true),
  'Sales gets their own first clock-in (the earlier Absent mark doesn''t count), rest day and start'
);
select is(
  (pg_temp.today('special') -> 'restWeekday'), 'null'::jsonb, 'no usual rest day: null');

select is(
  pg_temp.firsts('owner'),
  jsonb_build_object('sales', (private.manila_today() - 5)::text, 'special', (private.manila_today() - 2)::text),
  'the Owner gets each person''s own first clock-in'
);
select is(
  pg_temp.firsts('sales'),
  jsonb_build_object('sales', (private.manila_today() - 5)::text),
  'staff get only their own'
);
select is(pg_temp.firsts('other_owner'), '{}'::jsonb, 'another store gets none');

select * from finish();
rollback;
