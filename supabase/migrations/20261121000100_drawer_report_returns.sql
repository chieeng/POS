-- Build step 10, PR 4: the drawer report lists voids, returns and damaged items (SRS SHIFT-04,
-- POS-10; the owner's decisions of Nov 13 and Nov 19, 2026).
--
--   drawer_sales also returns, for one drawer:
--     voids: the sales of this drawer that were voided, with what went back and why;
--     returns: the returns whose cash came out of this drawer, and the GCash/Maya returns made
--       on its day (they touch no drawer, but belong to the day's report), each with its items,
--       whether back to stock or damaged, and each item's cost (the report is the Owner's only).
--   At most 200 of each, newest last; a store that busy would page them in a later update.

create or replace function private.drawer_sales(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch text;
  v_day date;
begin
  if (select auth.uid()) is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  select s.branch_id, s.business_date into v_branch, v_day
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
    ),
    voided as (
      select sa.* from public.sales sa
      where sa.session_id = p_session_id and sa.status = 'voided'
    ),
    returned as (
      select r.*, sa.receipt_no, sa.salesperson_name
      from public.returns r
      join public.sales sa on sa.id = r.sale_id
      where r.branch_id = v_branch
        and (r.session_id = p_session_id
          or (r.session_id is null and (r.created_at at time zone 'Asia/Manila')::date = v_day))
    )
    select jsonb_build_object(
      'count', (select count(*) from sold),
      'total', (select coalesce(sum(total), 0) from sold),
      'discounts', (select coalesce(sum(discount_total), 0) from sold),
      'cashRefunds', (
        select coalesce(sum(r.cash_refund), 0) from public.returns r where r.session_id = p_session_id
      ),
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
          select salesperson_name as name, count(*) as count, sum(total) as total,
            sum(discount_total) as discounts
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
      ), '[]'::jsonb),
      'voids', coalesce((
        select jsonb_agg(v order by v.at)
        from (
          select vo.id, vo.receipt_no as "receiptNo", vo.salesperson_name as salesperson,
            vo.total, vo.voided_at as at, vo.voided_by_name as by, vo.void_reason as reason,
            vo.void_refund_reference as "refundReference",
            (select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0)
             from public.sale_payments p where p.sale_id = vo.id) as cash,
            (select coalesce(sum(p.amount) filter (where p.method <> 'cash'), 0)
             from public.sale_payments p where p.sale_id = vo.id) as ewallet
          from voided vo
          order by vo.voided_at
          limit 200
        ) v
      ), '[]'::jsonb),
      'returns', coalesce((
        select jsonb_agg(x order by x.at)
        from (
          select re.id, re.receipt_no as "receiptNo", re.salesperson_name as salesperson,
            re.created_at as at, re.created_by_name as by, re.reason, re.refund_amount as refund,
            re.refund_method as method, re.cash_refund as "cashRefund",
            re.refund_reference as "refundReference", re.defective, re.items
          from returned re
          order by re.created_at
          limit 200
        ) x
      ), '[]'::jsonb)
    )
  );
end;
$$;
