-- Step 10 review (Nov 21, 2026): the sales history marks a sale with returns, so My sales no
-- longer shows a returned sale as if nothing had happened. Same function as
-- 20261114000100_sales_history.sql with one more field per sale: returned ('all', 'some', null).

create or replace function private.sales_history(
  p_from date,
  p_to date,
  p_salesperson uuid default null,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
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
  v_owner boolean;
  v_from date;
  v_to date;
  v_who uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows jsonb;
  v_more boolean;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  v_owner := private.is_owner();
  v_to := least(coalesce(p_to, v_today), v_today);
  v_from := coalesce(p_from, private.history_window(v_today));
  if not v_owner then
    v_from := greatest(v_from, private.history_window(v_today));
    v_who := v_uid;
  else
    v_who := p_salesperson;
  end if;
  if v_from > v_to then
    return jsonb_build_object('sales', '[]'::jsonb, 'days', '[]'::jsonb, 'hasMore', false,
      'from', v_from, 'to', v_to);
  end if;

  with picked as (
    select s.* from public.sales s
    where s.branch_id = v_branch
      and (v_who is null or s.salesperson_id = v_who)
      and s.created_at >= (v_from::timestamp at time zone 'Asia/Manila')
      and s.created_at < ((v_to + 1)::timestamp at time zone 'Asia/Manila')
      and (p_before is null or (s.created_at, s.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by s.created_at desc, s.id desc
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'receiptNo', p.receipt_no, 'madeAt', p.created_at,
      'salesperson', p.salesperson_name, 'total', p.total,
      -- As the customer counts them: whole units by quantity, a weighed line as one item.
      'items', (
        select coalesce(sum(case when i.unit in ('kg', 'L') then 1 else i.qty end), 0)
        from public.sale_items i where i.sale_id = p.id
      ),
      'methods', (
        select coalesce(jsonb_agg(distinct sp.method), '[]'::jsonb)
        from public.sale_payments sp where sp.sale_id = p.id
      ),
      'status', p.status, 'flags', to_jsonb(p.flags), 'madeOffline', p.made_offline,
      -- POS-10: 'all' when every unit came back, 'some' after a partial return, null otherwise.
      'returned', (
        select case when sum(x.back) >= (select sum(i.qty) from public.sale_items i where i.sale_id = p.id)
          then 'all' else 'some' end
        from (
          select (it ->> 'qty')::numeric as back
          from public.returns r, jsonb_array_elements(r.items) it
          where r.sale_id = p.id
        ) x
        having count(*) > 0
      )
    ) order by p.created_at desc, p.id desc) filter (where n <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_rows, v_more
  from (select picked.*, row_number() over (order by created_at desc, id desc) as n from picked) p;

  return jsonb_build_object(
    'sales', v_rows,
    'hasMore', v_more,
    'from', v_from,
    'to', v_to,
    -- Each day's completed sales in the range, for the day headings.
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.count, 'total', d.total) order by d.day desc)
      from (
        select (s.created_at at time zone 'Asia/Manila')::date as day, count(*) as count,
          sum(s.total) as total
        from public.sales s
        where s.branch_id = v_branch and s.status = 'completed'
          and (v_who is null or s.salesperson_id = v_who)
          and s.created_at >= (v_from::timestamp at time zone 'Asia/Manila')
          and s.created_at < ((v_to + 1)::timestamp at time zone 'Asia/Manila')
        group by 1
      ) d
    ), '[]'::jsonb)
  );
end;
$$;

