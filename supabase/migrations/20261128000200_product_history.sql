-- The product History pop-up (the owner's request of Nov 27, 2026; SRS INV-06, PROD-05).
--
-- The stock history now also gives, read-only:
-- - the receipt number on sale, void and return rows, and whether the caller may open that
--   sale (the Owner, or the salesperson who made it: the sales table's own rule);
-- - the adjustment's type and reason on adjustment rows;
-- - damaged write-offs (POS-10): returned units marked "Damaged" never move stock, so they are
--   not stock movements; they come from the returns, as "damaged" rows with a stock change of
--   0, the damaged quantity, the sale's receipt number and the return's reason.
--
-- The row id becomes text, because a damaged row has no stock movement id. The cost stays the
-- Owner's only, on damaged rows too. Who may call it is unchanged (Owner and Special Sales).

drop function public.product_stock_history(uuid, timestamptz, timestamptz, text, integer);
drop function private.product_stock_history(uuid, timestamptz, timestamptz, text, integer);

create function private.product_stock_history(
  p_product_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_type text default null,
  p_limit integer default 100
)
returns table (
  id text,
  created_at timestamptz,
  type text,
  qty_change numeric,
  stock_after numeric,
  unit_cost numeric,
  user_name text,
  ref_type text,
  ref_id text,
  receipt_no text,
  can_open_sale boolean,
  adjustment_type text,
  reason text,
  damaged_qty numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner boolean := private.is_owner();
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
begin
  if v_uid is null or not private.can_add_catalog() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  return query
    select h.row_id, h.at, h.kind, h.qty, h.after_qty, h.cost, h.by_name, h.rtype, h.rid,
      h.receipt, h.can_open, h.adj_type, h.why, h.damaged
    from (
      select m.id as seq, m.id::text as row_id, m.created_at as at, m.type as kind, m.qty_change as qty,
        m.stock_after as after_qty, case when v_owner then m.unit_cost end as cost,
        m.user_name as by_name, m.ref_type as rtype, m.ref_id as rid, s.receipt_no as receipt,
        coalesce(s.id is not null and (v_owner or s.salesperson_id = v_uid), false) as can_open,
        a.type as adj_type, a.reason as why, null::numeric as damaged
      from public.stock_movements m
      left join public.sales s
        on m.ref_type = 'sale' and s.id::text = m.ref_id and s.branch_id = m.branch_id
      left join public.stock_adjustments a
        on m.ref_type = 'adjustment' and a.id::text = m.ref_id and a.branch_id = m.branch_id
      where m.product_id = p_product_id
        and m.branch_id = v_branch
        and (p_from is null or m.created_at >= p_from)
        and (p_to is null or m.created_at < p_to)
        and (p_type is null or m.type = p_type)
      union all
      -- A damaged row lists below a return movement of the same instant (the same return).
      select 0::bigint, 'damaged:' || r.id::text || ':' || coalesce(i.item ->> 'lineNo', '0'), r.created_at,
        'damaged', 0::numeric, null::numeric,
        case when v_owner then (i.item ->> 'unitCost')::numeric end,
        r.created_by_name, 'sale', r.sale_id::text, s.receipt_no,
        v_owner or s.salesperson_id = v_uid,
        null::text, r.reason, (i.item ->> 'qty')::numeric
      from public.returns r
      join public.sales s on s.id = r.sale_id
      cross join lateral jsonb_array_elements(r.items) as i(item)
      where r.branch_id = v_branch
        and i.item ->> 'condition' = 'damaged'
        and i.item ->> 'productId' = p_product_id::text
        and (p_from is null or r.created_at >= p_from)
        and (p_to is null or r.created_at < p_to)
        and (p_type is null or p_type = 'damaged')
    ) h
    order by h.at desc, h.seq desc, h.row_id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 300);
end;
$$;

create function public.product_stock_history(
  p_product_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_type text default null,
  p_limit integer default 100
)
returns table (
  id text,
  created_at timestamptz,
  type text,
  qty_change numeric,
  stock_after numeric,
  unit_cost numeric,
  user_name text,
  ref_type text,
  ref_id text,
  receipt_no text,
  can_open_sale boolean,
  adjustment_type text,
  reason text,
  damaged_qty numeric
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.product_stock_history(p_product_id, p_from, p_to, p_type, p_limit); $$;

revoke execute on function
  private.product_stock_history(uuid, timestamptz, timestamptz, text, integer),
  public.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
from public, anon;
grant execute on function
  private.product_stock_history(uuid, timestamptz, timestamptz, text, integer),
  public.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
to authenticated;
