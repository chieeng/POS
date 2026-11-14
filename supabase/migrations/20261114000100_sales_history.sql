-- Build step 10, PR 1: sales history (SRS 6.1 role table, POS-10 to POS-12; the owner's decisions
-- of Nov 13, 2026): staff see their own sales for the last 30 days; the Owner sees every sale.
--
--   sales_history(from, to, salesperson, before, before_id, limit): one page of sales, newest
--   first (keyset paging), with each day's count and total for the range. Staff are held to
--   their own sales and to the last 30 days whatever they ask for.
--   sale_detail(id): one sale's lines and payments, never its cost, for the Owner or for the
--   salesperson within the same 30 days (lines and payments are otherwise Owner-only).
--   Read-only: voids, returns and corrections arrive in the next PRs.

create function private.history_window(p_today date)
returns date
language sql
immutable
set search_path = ''
as $$ select p_today - 29; $$;
revoke execute on function private.history_window(date) from public, anon, authenticated;

-- p_from, p_to: business days (Asia/Manila), both included. Returns
-- {sales: [{id, receiptNo, madeAt, salesperson, total, items, methods, status, flags,
--   madeOffline}], days: [{day, count, total}], hasMore, from, to}.
create function private.sales_history(
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
      'status', p.status, 'flags', to_jsonb(p.flags), 'madeOffline', p.made_offline
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

-- One sale with its lines (never the cost) and payments.
-- Errors: not_found (no such sale for this caller, or a staff member's sale older than 30 days).
create function private.sale_detail(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sale public.sales;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  select * into v_sale from public.sales s
  where s.id = p_sale_id and s.branch_id = private.current_branch()
    and (
      private.is_owner()
      or (s.salesperson_id = v_uid
        and (s.created_at at time zone 'Asia/Manila')::date
          >= private.history_window(private.manila_today()))
    );
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_sale.id, 'receiptNo', v_sale.receipt_no, 'madeAt', v_sale.created_at,
    'syncedAt', v_sale.synced_at, 'salesperson', v_sale.salesperson_name,
    'subtotal', v_sale.subtotal, 'discountTotal', v_sale.discount_total,
    'rounding', v_sale.rounding, 'total', v_sale.total, 'vatRate', v_sale.vat_rate,
    'vatAmount', v_sale.vat_amount, 'change', v_sale.change, 'status', v_sale.status,
    'flags', to_jsonb(v_sale.flags), 'madeOffline', v_sale.made_offline,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lineNo', i.line_no, 'name', i.name, 'sku', i.sku, 'unit', i.unit, 'qty', i.qty,
        'unitPrice', i.unit_price, 'discount', i.discount,
        'discountName', coalesce(i.discount_name, i.deal_name), 'lineTotal', i.line_total
      ) order by i.line_no)
      from public.sale_items i where i.sale_id = v_sale.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'method', p.method, 'amount', p.amount, 'reference', p.reference,
        'accountLabel', p.account_label
      ) order by p.line_no)
      from public.sale_payments p where p.sale_id = v_sale.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function
  private.sales_history(date, date, uuid, timestamptz, uuid, integer),
  private.sale_detail(uuid)
from public, anon;
grant execute on function
  private.sales_history(date, date, uuid, timestamptz, uuid, integer),
  private.sale_detail(uuid)
to authenticated;

create function public.sales_history(
  p_from date,
  p_to date,
  p_salesperson uuid default null,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.sales_history(p_from, p_to, p_salesperson, p_before, p_before_id, p_limit); $$;

create function public.sale_detail(p_sale_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.sale_detail(p_sale_id); $$;

revoke execute on function
  public.sales_history(date, date, uuid, timestamptz, uuid, integer),
  public.sale_detail(uuid)
from public, anon;
grant execute on function
  public.sales_history(date, date, uuid, timestamptz, uuid, integer),
  public.sale_detail(uuid)
to authenticated;
