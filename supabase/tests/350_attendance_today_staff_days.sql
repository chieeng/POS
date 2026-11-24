-- Staff see their own days as the Owner's board does (ATT-14, ATT-15; the Nov 24, 2026 step
-- 11 test): the clock's answer carries the store's first attendance day, the person's usual
-- rest day and the day their account was made.
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
grant execute on function pg_temp.today(text) to authenticated;

select is((pg_temp.today('sales') ->> 'firstDay'), null, 'no attendance yet: no first day');

update public.profiles set rest_weekday = 0 where id = tests.uid('sales');
insert into public.attendance (branch_id, user_id, user_name, work_date, kind, note)
values ('tmain', tests.uid('special'), 'Special', private.manila_today() - 5, 'absent', 'x');

select is(
  (select jsonb_build_object('first', t ->> 'firstDay', 'rest', t -> 'restWeekday', 'since', (t ->> 'since') is not null)
   from pg_temp.today('sales') t),
  jsonb_build_object('first', (private.manila_today() - 5)::text, 'rest', 0, 'since', true),
  'Sales gets the store''s first day (from another person''s row), their own rest day and start'
);
select is(
  (pg_temp.today('special') -> 'restWeekday'), 'null'::jsonb, 'no usual rest day: null');

select * from finish();
rollback;
