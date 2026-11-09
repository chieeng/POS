-- Build step 9: the drawer report shows the drawer's sales (SRS SHIFT-04, POS-14).
--
--   drawer_sales(session) sums one drawer's sales for the Owner: the count and total, each
--   payment method (cash is what went into the drawer), each salesperson, and the sales the
--   Owner should check (flagged: late, price or settings changed, stock below zero, reused
--   reference, device clock ahead, inactive product). One small answer instead of every sale,
--   so opening the report costs little egress (Free plan).
--   The sales table joins the Realtime publication so the open report follows new sales.
--   Realtime only sends a change to a screen that watches it (the Owner's report, filtered to
--   one drawer), and Row Level Security still decides who may see it.
--
-- Voids, corrections and refunds (step 10) and utang payments (step 12) join later.

create function private.drawer_sales(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch text;
begin
  if (select auth.uid()) is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  select s.branch_id into v_branch
  from public.drawer_sessions s
  where s.id = p_session_id and s.branch_id = private.current_branch();
  if v_branch is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return (
    with sold as (
      select sa.* from public.sales sa
      where sa.session_id = p_session_id and sa.status = 'completed'
    ),
    paid as (
      select p.method, p.sale_id, p.amount
      from sold join public.sale_payments p on p.sale_id = sold.id
    )
    select jsonb_build_object(
      'count', (select count(*) from sold),
      'total', (select coalesce(sum(total), 0) from sold),
      'methods', coalesce((
        select jsonb_agg(m order by m.method)
        from (
          select method, count(distinct sale_id) as count, sum(amount) as amount
          from paid group by method
        ) m
      ), '[]'::jsonb),
      'salespeople', coalesce((
        select jsonb_agg(x order by x.total desc, x.name)
        from (
          select salesperson_name as name, count(*) as count, sum(total) as total
          from sold group by salesperson_id, salesperson_name
        ) x
      ), '[]'::jsonb),
      'flaggedCount', (select count(*) from sold where flags <> '{}'),
      'flagged', coalesce((
        select jsonb_agg(f order by f."madeAt")
        from (
          select id, receipt_no as "receiptNo", salesperson_name as salesperson,
            created_at as "madeAt", synced_at as "syncedAt", total, flags,
            made_offline as "madeOffline"
          from sold where flags <> '{}'
          order by created_at
          limit 200
        ) f
      ), '[]'::jsonb)
    )
  );
end;
$$;

create function public.drawer_sales(p_session_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.drawer_sales(p_session_id); $$;

revoke execute on function private.drawer_sales(uuid) from public, anon;
grant execute on function private.drawer_sales(uuid) to authenticated;
revoke execute on function public.drawer_sales(uuid) from public, anon;
grant execute on function public.drawer_sales(uuid) to authenticated;

alter publication supabase_realtime add table public.sales;
