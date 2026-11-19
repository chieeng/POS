-- Build step 10, PR 3: returns and refunds (SRS POS-10, SYS-01, APPR-01..05, SHIFT-03; the owner's
-- decisions of Nov 13, 2026).
--
--   A return takes back some or all units of some or all lines of a completed sale, any day
--   within the return window (an Owner setting, 30 days by default). Past the window only a
--   defective item, with the Owner's approval and a reason.
--   Each returned line is "Back to stock" (stock comes back, a 'return' stock movement) or
--   "Damaged" (no stock: kept on the return as a write-off at the line's cost, for the report).
--   The refund is what the customer paid for those units after any discount or deal share
--   (the line's total, divided by its quantity); the last units of a line get exactly what is
--   left of it, so a line is never refunded more than it took.
--   One refund method per return, among those the sale was paid with, and never more than was
--   paid that way. Cash comes out of today's open drawer (its expected cash goes down by the
--   cash handed back, rounded to the peso like the sale when cash rounding is on); GCash and
--   Maya are sent by the Owner outside the app and recorded with their reference.
--   Staff ask for their own sales (approval); the Owner returns directly. Both with a reason,
--   audit-logged ('sale.return').
--   A sale with a return can no longer be voided: the rest is returned instead.

-- ---- The return window -------------------------------------------------------------------------
alter table public.branches
  add column return_window_days integer not null default 30
    check (return_window_days between 1 and 365);

-- ---- Returns -------------------------------------------------------------------------------------
create table public.returns (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  sale_id uuid not null references public.sales (id),
  -- [{lineNo, productId, name, unit, qty, refund, condition ('stock' | 'damaged'), unitCost}]
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  -- What the returned units were paid, to the centavo.
  refund_amount numeric(12, 2) not null check (refund_amount >= 0),
  refund_method text not null check (refund_method in ('cash', 'gcash', 'maya')),
  -- Cash handed back from the drawer (refund_amount rounded to the peso when cash rounding is
  -- on); null for GCash and Maya.
  cash_refund numeric(12, 2) check (cash_refund >= 0),
  refund_reference text check (refund_reference ~ '^[A-Z0-9-]{4,40}$'),
  session_id uuid references public.drawer_sessions (id),
  defective boolean not null default false,
  late boolean not null default false,
  reason text not null check (char_length(reason) between 1 and 200),
  approval_id uuid references public.approval_requests (id),
  created_by uuid not null references public.profiles (id),
  created_by_name text not null,
  device_tag text check (device_tag ~ '^[A-Z0-9]{4}$'),
  created_at timestamptz not null default now(),
  check ((refund_method = 'cash') = (cash_refund is not null)),
  check ((refund_method = 'cash') = (session_id is not null)),
  check ((refund_method = 'cash') = (refund_reference is null)),
  check (not late or defective)
);
create index returns_sale_idx on public.returns (sale_id);
create index returns_session_idx on public.returns (session_id) where session_id is not null;
create index returns_branch_idx on public.returns (branch_id, created_at desc);

revoke all on table public.returns from public, anon, authenticated, service_role;
grant select on table public.returns to authenticated;
alter table public.returns enable row level security;
-- The items carry the cost: the Owner reads returns; staff see them through sale_detail.
create policy returns_select_owner on public.returns
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));

-- ---- Approval requests: the new type ---------------------------------------------------------
alter table public.approval_requests
  drop constraint approval_requests_type_check,
  add constraint approval_requests_type_check
    check (type in ('product_edit', 'stock_adjustment', 'stock_in_correction', 'sale_void', 'sale_return'));

-- ---- What each line has given back so far ----------------------------------------------------
-- {lineNo: {qty, refund}} for the sale's earlier returns.
create function private.returned_lines(p_sale_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.line_no, jsonb_build_object('qty', x.qty, 'refund', x.refund)), '{}')
  from (
    select (i ->> 'lineNo')::integer as line_no, sum((i ->> 'qty')::numeric) as qty,
      sum((i ->> 'refund')::numeric) as refund
    from public.returns r, jsonb_array_elements(r.items) i
    where r.sale_id = p_sale_id
    group by 1
  ) x;
$$;

-- ---- Working a return out --------------------------------------------------------------------
-- p_items: [{lineNo, qty, condition}]. Returns {items, refund, cashRefund, late}.
-- Errors: sale_not_completed, invalid_input, return_qty (more than is left on a line),
-- refund_method_invalid (not a way the sale was paid), refund_too_large (more than was paid
-- that way), return_window_passed (past the window and not marked defective).
create function private.plan_return(
  p_sale public.sales,
  p_items jsonb,
  p_refund_method text,
  p_defective boolean
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_done jsonb := private.returned_lines(p_sale.id);
  v_window integer;
  v_round boolean;
  v_late boolean;
  v_item jsonb;
  v_line public.sale_items;
  v_qty numeric;
  v_left numeric;
  v_refund numeric(12, 2);
  v_total numeric(12, 2) := 0;
  v_out jsonb := '[]';
  v_seen integer[] := '{}';
  v_paid numeric(12, 2);
  v_back numeric(12, 2);
begin
  if p_sale.status <> 'completed' then
    raise exception 'sale_not_completed' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 100
    or p_refund_method is null or p_refund_method not in ('cash', 'gcash', 'maya') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'lineNo') <> 'number'
      or jsonb_typeof(v_item -> 'qty') <> 'number'
      or coalesce(v_item ->> 'condition', '') not in ('stock', 'damaged') then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    select * into v_line from public.sale_items i
    where i.sale_id = p_sale.id and i.line_no = (v_item ->> 'lineNo')::integer;
    if not found or v_line.line_no = any (v_seen) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_seen := v_seen || v_line.line_no;
    v_qty := (v_item ->> 'qty')::numeric;
    -- Whole units, or up to 3 decimals for kg and L, like the sale.
    if v_qty <= 0 or v_qty <> round(v_qty, 3)
      or (v_line.unit not in ('kg', 'L') and v_qty <> trunc(v_qty)) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_left := v_line.qty - coalesce((v_done -> v_line.line_no::text ->> 'qty')::numeric, 0);
    if v_qty > v_left then
      raise exception 'return_qty' using errcode = '22023';
    end if;
    -- The last units get exactly what is left of the line, so rounding never adds up to more.
    v_refund := case when v_qty = v_left
      then v_line.line_total - coalesce((v_done -> v_line.line_no::text ->> 'refund')::numeric, 0)
      else round(v_line.line_total * v_qty / v_line.qty, 2) end;
    v_total := v_total + v_refund;
    v_out := v_out || jsonb_build_object(
      'lineNo', v_line.line_no, 'productId', v_line.product_id, 'name', v_line.name,
      'unit', v_line.unit, 'qty', v_qty, 'refund', v_refund,
      'condition', v_item ->> 'condition', 'unitCost', v_line.unit_cost
    );
  end loop;

  -- One method among those the sale was paid with, never more than was paid that way.
  select sum(p.amount) into v_paid from public.sale_payments p
  where p.sale_id = p_sale.id and p.method = p_refund_method;
  if v_paid is null then
    raise exception 'refund_method_invalid' using errcode = '22023';
  end if;
  select coalesce(sum(r.refund_amount), 0) into v_back from public.returns r
  where r.sale_id = p_sale.id and r.refund_method = p_refund_method;
  -- Cash: the drawer took the rounded amount, so allow up to that.
  if p_refund_method = 'cash' then
    v_back := v_back - 0.50;
  end if;
  if v_total > v_paid - v_back then
    raise exception 'refund_too_large' using errcode = '22023';
  end if;

  select b.return_window_days, b.round_cash into v_window, v_round
  from public.branches b where b.id = p_sale.branch_id;
  v_late := private.manila_today() - (p_sale.created_at at time zone 'Asia/Manila')::date > v_window;
  if v_late and not coalesce(p_defective, false) then
    raise exception 'return_window_passed' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', v_out, 'refund', v_total, 'late', v_late,
    'cashRefund', case when p_refund_method <> 'cash' then null
      when v_round then round(v_total, 0) else v_total end
  );
end;
$$;

-- ---- Applying a return (the Owner's own, or an approved request) ------------------------------
-- Errors: not_found, the plan_return errors, drawer_not_open (a cash refund needs today's open
-- drawer), refund_reference_required (GCash/Maya without the reference sent).
create function private.apply_return(
  p_sale_id uuid,
  p_items jsonb,
  p_refund_method text,
  p_refund_reference text,
  p_defective boolean,
  p_reason text,
  p_device_tag text,
  p_request_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tag text := private.valid_device_tag(p_device_tag);
  v_reason text := private.catalog_text(p_reason, 200, true);
  v_ref text := nullif(upper(regexp_replace(coalesce(p_refund_reference, ''), '\s', '', 'g')), '');
  v_name text := (select pr.display_name from public.profiles pr where pr.id = v_uid);
  v_sale public.sales;
  v_plan jsonb;
  v_session uuid;
  v_item jsonb;
  v_stock numeric;
  v_id uuid;
begin
  select * into v_sale from public.sales s
  where s.id = p_sale_id and s.branch_id = private.current_branch()
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_plan := private.plan_return(v_sale, p_items, p_refund_method, p_defective);

  if p_refund_method = 'cash' then
    select d.id into v_session from public.drawer_sessions d
    where d.branch_id = v_sale.branch_id and d.status = 'open'
      and d.business_date = private.manila_today()
    for update;
    if v_session is null then
      raise exception 'drawer_not_open' using errcode = 'P0001';
    end if;
    v_ref := null;
  else
    if v_ref is null then
      raise exception 'refund_reference_required' using errcode = '22023';
    end if;
    if v_ref !~ '^[A-Z0-9-]{4,40}$' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end if;

  insert into public.returns
    (branch_id, sale_id, items, refund_amount, refund_method, cash_refund, refund_reference,
     session_id, defective, late, reason, approval_id, created_by, created_by_name, device_tag)
  values (
    v_sale.branch_id, v_sale.id, v_plan -> 'items', (v_plan ->> 'refund')::numeric,
    p_refund_method, (v_plan ->> 'cashRefund')::numeric, v_ref, v_session,
    coalesce(p_defective, false), (v_plan ->> 'late')::boolean, v_reason, p_request_id, v_uid,
    v_name, v_tag
  )
  returning id into v_id;

  -- "Back to stock" lines come back at today's average cost; damaged ones stay out of stock.
  for v_item in select * from jsonb_array_elements(v_plan -> 'items') loop
    if v_item ->> 'condition' = 'stock' and v_item ->> 'productId' is not null then
      update public.products p set stock_qty = p.stock_qty + (v_item ->> 'qty')::numeric,
        updated_at = now()
      where p.id = (v_item ->> 'productId')::uuid
      returning p.stock_qty into v_stock;
      insert into public.stock_movements
        (branch_id, product_id, type, qty_change, stock_after, unit_cost, ref_type, ref_id,
         user_id, user_name, device_tag, created_at)
      select v_sale.branch_id, (v_item ->> 'productId')::uuid, 'return',
        (v_item ->> 'qty')::numeric, v_stock, c.cost_price, 'sale', v_sale.id::text, v_uid,
        v_name, v_tag, now()
      from (select 1) one
      left join public.product_costs c on c.product_id = (v_item ->> 'productId')::uuid;
    end if;
  end loop;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_sale.branch_id, 'sale.return', v_uid, v_tag, 'sale', v_sale.id::text,
    jsonb_build_object(
      'receiptNo', v_sale.receipt_no, 'salesperson', v_sale.salesperson_name,
      'items', v_plan -> 'items', 'refund', v_plan -> 'refund', 'method', p_refund_method,
      'cashRefund', v_plan -> 'cashRefund', 'refundReference', v_ref,
      'defective', coalesce(p_defective, false), 'late', v_plan -> 'late',
      'requestId', p_request_id, 'returnId', v_id
    ),
    v_reason
  );
  return v_plan || jsonb_build_object('id', v_id);
end;
$$;

revoke execute on function private.returned_lines(uuid) from public, anon, authenticated;
revoke execute on function private.plan_return(public.sales, jsonb, text, boolean)
  from public, anon, authenticated;
revoke execute on function private.apply_return(uuid, jsonb, text, text, boolean, text, text, uuid)
  from public, anon, authenticated;

-- ---- A sale with a return can't be voided any more -------------------------------------------
create or replace function private.check_voidable(p_sale public.sales)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_sale.status <> 'completed' then
    raise exception 'sale_not_completed' using errcode = '22023';
  end if;
  if exists (select 1 from public.returns r where r.sale_id = p_sale.id) then
    raise exception 'sale_has_returns' using errcode = '22023';
  end if;
  if p_sale.session_id is null then
    raise exception 'drawer_waiting' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.drawer_sessions d where d.id = p_sale.session_id and d.status = 'open'
  ) then
    raise exception 'drawer_closed' using errcode = '22023';
  end if;
end;
$$;

-- ---- The drawer's expected cash: less the cash handed back -----------------------------------
create or replace function private.drawer_expected(p_session_id uuid)
returns numeric(12, 2)
language sql
stable
set search_path = ''
as $$
  select s.opening_cash
    + (
        select coalesce(sum(e.amount) filter (where e.type = 'cash_in'), 0)
          - coalesce(sum(e.amount) filter (where e.type = 'cash_out'), 0)
        from public.drawer_entries e where e.session_id = s.id
      )
    + coalesce((
        select sum(p.amount)
        from public.sales sa
        join public.sale_payments p on p.sale_id = sa.id and p.method = 'cash'
        where sa.session_id = s.id and sa.status = 'completed'
      ), 0)
    - coalesce((
        select sum(r.cash_refund) from public.returns r where r.session_id = s.id
      ), 0)
  from public.drawer_sessions s
  where s.id = p_session_id;
$$;

-- ---- drawer_sales: the cash refunds, so the report's expected cash stays right ---------------
create or replace function private.drawer_sales(p_session_id uuid)
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
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ---- return_sale: the Owner, directly ----------------------------------------------------------
create function private.return_sale(
  p_sale_id uuid,
  p_items jsonb,
  p_refund_method text,
  p_reason text,
  p_defective boolean default false,
  p_refund_reference text default null,
  p_device_tag text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  return private.apply_return(
    p_sale_id, p_items, p_refund_method, p_refund_reference, p_defective, p_reason,
    p_device_tag, null
  );
end;
$$;

-- ---- request_sale_return: Special Sales and Sales, for their own sale ------------------------
-- Errors: not_found (not their sale), the plan_return errors, request_pending.
create function private.request_sale_return(
  p_sale_id uuid,
  p_items jsonb,
  p_refund_method text,
  p_reason text,
  p_defective boolean default false,
  p_device_tag text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sale public.sales;
  v_plan jsonb;
  v_row public.approval_requests;
begin
  if v_uid is null or not private.has_access() or private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  select * into v_sale from public.sales s
  where s.id = p_sale_id and s.branch_id = private.current_branch() and s.salesperson_id = v_uid;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_plan := private.plan_return(v_sale, p_items, p_refund_method, p_defective);

  begin
    insert into public.approval_requests
      (branch_id, type, target_type, target_id, before, after, reason, requested_by)
    values (
      v_sale.branch_id, 'sale_return', 'sale', v_sale.id,
      -- What had been returned when asked: if it changes, the request is outdated.
      jsonb_build_object('returned', private.returned_lines(v_sale.id)),
      jsonb_build_object(
        'receiptNo', v_sale.receipt_no, 'total', v_sale.total, 'madeAt', v_sale.created_at,
        'items', v_plan -> 'items', 'refund', v_plan -> 'refund',
        'cashRefund', v_plan -> 'cashRefund', 'method', p_refund_method,
        'defective', coalesce(p_defective, false), 'late', v_plan -> 'late',
        'request', p_items
      ),
      private.catalog_text(p_reason, 200, true), v_uid
    )
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'request_pending' using errcode = '23505';
  end;
  perform private.log_approval('approval.request', v_row, p_device_tag);
  return v_row.id;
end;
$$;

-- ---- decide_approval: approving a return -----------------------------------------------------
create or replace function private.decide_approval(
  p_id uuid,
  p_approve boolean,
  p_note text default null,
  p_device_tag text default null,
  p_refund_reference text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_note text := private.catalog_text(p_note, 200, false);
  v_row public.approval_requests;
  v_current jsonb;
  v_key text;
  v_sale public.sales;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_row from public.approval_requests r
  where r.id = p_id and r.branch_id = private.current_branch()
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'request_closed' using errcode = '22023';
  end if;

  if p_approve then
    if v_row.type = 'product_edit' then
      -- Outdated: the product changed since the request. Only rejecting is possible then.
      select to_jsonb(p) into v_current from public.products p
      where p.id = v_row.target_id
      for update;
      for v_key in select jsonb_object_keys(v_row.before) loop
        if (v_current -> v_key) is distinct from (v_row.before -> v_key) then
          raise exception 'request_outdated' using errcode = '22023';
        end if;
      end loop;
      perform private.apply_product_change(
        v_row.target_id, v_row.after, 'approval', p_device_tag, v_row.reason, false
      );
    elsif v_row.type = 'stock_adjustment' then
      perform private.apply_stock_adjustment(
        v_row.target_id, v_row.after ->> 'type', (v_row.after ->> 'qty')::numeric, v_row.reason,
        p_device_tag, v_row.id, false
      );
    elsif v_row.type = 'stock_in_correction' then
      -- Outdated: the stock-in was corrected since the request.
      if exists (select 1 from public.stock_receipts r where r.corrects_receipt_id = v_row.target_id) then
        raise exception 'request_outdated' using errcode = '22023';
      end if;
      perform private.apply_stock_in_correction(
        v_row.target_id, (v_row.after ->> 'supplier_id')::uuid, v_row.after ->> 'reference',
        v_row.after -> 'lines', (v_row.after ->> 'delete')::boolean, v_row.reason,
        p_device_tag, false, v_row.id
      );
    elsif v_row.type = 'sale_void' then
      -- Outdated: the sale was voided or corrected since, or its drawer is no longer open.
      select * into v_sale from public.sales s where s.id = v_row.target_id;
      begin
        perform private.check_voidable(v_sale);
      exception
        when sqlstate '22023' then
          raise exception 'request_outdated' using errcode = '22023';
      end;
      perform private.apply_void(v_row.target_id, v_row.reason, p_refund_reference, p_device_tag, v_row.id);
    elsif v_row.type = 'sale_return' then
      -- Outdated: the sale was voided, or something else was returned from it, since.
      select * into v_sale from public.sales s where s.id = v_row.target_id for update;
      if v_sale.status <> 'completed'
        or private.returned_lines(v_sale.id) is distinct from (v_row.before -> 'returned') then
        raise exception 'request_outdated' using errcode = '22023';
      end if;
      perform private.apply_return(
        v_row.target_id, v_row.after -> 'request', v_row.after ->> 'method', p_refund_reference,
        (v_row.after ->> 'defective')::boolean, v_row.reason, p_device_tag, v_row.id
      );
    end if;
  end if;

  update public.approval_requests r
  set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = v_uid, decided_at = now(), owner_note = v_note
  where r.id = p_id
  returning * into v_row;
  perform private.log_approval(
    case when p_approve then 'approval.approve' else 'approval.reject' end, v_row, p_device_tag
  );
end;
$$;

-- ---- sale_detail: what can still be returned, and the returns made ----------------------------
create or replace function private.sale_detail(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner boolean := private.is_owner();
  v_sale public.sales;
  v_void text;
  v_done jsonb;
  v_branch public.branches;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  select * into v_sale from public.sales s
  where s.id = p_sale_id and s.branch_id = private.current_branch()
    and (
      v_owner
      or (s.salesperson_id = v_uid
        and (s.created_at at time zone 'Asia/Manila')::date
          >= private.history_window(private.manila_today()))
    );
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into v_branch from public.branches b where b.id = v_sale.branch_id;
  v_done := private.returned_lines(v_sale.id);

  -- 'ok', or why a void can't be asked for now.
  begin
    perform private.check_voidable(v_sale);
    v_void := 'ok';
  exception
    when sqlstate '22023' then v_void := sqlerrm;
  end;

  return jsonb_build_object(
    'id', v_sale.id, 'receiptNo', v_sale.receipt_no, 'madeAt', v_sale.created_at,
    'syncedAt', v_sale.synced_at, 'salesperson', v_sale.salesperson_name,
    'subtotal', v_sale.subtotal, 'discountTotal', v_sale.discount_total,
    'rounding', v_sale.rounding, 'total', v_sale.total, 'vatRate', v_sale.vat_rate,
    'vatAmount', v_sale.vat_amount, 'change', v_sale.change, 'status', v_sale.status,
    'flags', to_jsonb(v_sale.flags), 'madeOffline', v_sale.made_offline,
    'voidable', v_void,
    'void', case when v_sale.status = 'voided' then jsonb_build_object(
      'at', v_sale.voided_at, 'by', v_sale.voided_by_name, 'reason', v_sale.void_reason,
      'refundReference', v_sale.void_refund_reference
    ) end,
    'pendingVoid', (
      select jsonb_build_object('id', r.id, 'mine', r.requested_by = v_uid, 'reason', r.reason)
      from public.approval_requests r
      where r.type = 'sale_void' and r.target_id = v_sale.id and r.status = 'pending'
        and (v_owner or r.requested_by = v_uid)
      order by r.created_at
      limit 1
    ),
    'pendingReturn', (
      select jsonb_build_object('id', r.id, 'mine', r.requested_by = v_uid, 'reason', r.reason,
        'refund', r.after -> 'refund', 'method', r.after -> 'method')
      from public.approval_requests r
      where r.type = 'sale_return' and r.target_id = v_sale.id and r.status = 'pending'
        and (v_owner or r.requested_by = v_uid)
      order by r.created_at
      limit 1
    ),
    'returnWindow', jsonb_build_object(
      'days', v_branch.return_window_days,
      'late', private.manila_today() - (v_sale.created_at at time zone 'Asia/Manila')::date
        > v_branch.return_window_days
    ),
    'roundCash', v_branch.round_cash,
    -- Refunded so far by each method, so a new return can't give back more than was paid.
    'refunded', coalesce((
      select jsonb_object_agg(x.method, x.amount)
      from (
        select r.refund_method as method, sum(r.refund_amount) as amount
        from public.returns r where r.sale_id = v_sale.id group by 1
      ) x
    ), '{}'::jsonb),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', r.created_at, 'by', r.created_by_name, 'reason', r.reason,
        'refund', r.refund_amount, 'cashRefund', r.cash_refund, 'method', r.refund_method,
        'refundReference', r.refund_reference, 'defective', r.defective,
        'items', (
          select jsonb_agg(jsonb_build_object('name', i -> 'name', 'unit', i -> 'unit',
            'qty', i -> 'qty', 'condition', i -> 'condition', 'refund', i -> 'refund'))
          from jsonb_array_elements(r.items) i
        )
      ) order by r.created_at)
      from public.returns r where r.sale_id = v_sale.id
    ), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lineNo', i.line_no, 'name', i.name, 'sku', i.sku, 'unit', i.unit, 'qty', i.qty,
        'unitPrice', i.unit_price, 'discount', i.discount,
        'discountName', coalesce(i.discount_name, i.deal_name), 'lineTotal', i.line_total,
        'returnedQty', coalesce((v_done -> i.line_no::text ->> 'qty')::numeric, 0),
        'refunded', coalesce((v_done -> i.line_no::text ->> 'refund')::numeric, 0)
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

-- ---- update_branch_settings: the return window joins (same checks and audit as before) --------
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
    'name', 'address', 'contact', 'tin', 'receipt_footer',
    'vat_registered', 'vat_rate', 'round_cash', 'return_window_days',
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
    or exists (select 1 from jsonb_object_keys(p_changes) k where k <> all (v_allowed))
    -- The yes/no settings take true or false only, never "yes" or 1.
    or exists (
      select 1 from unnest(array['vat_registered', 'round_cash']) k
      where p_changes ? k and jsonb_typeof(p_changes -> k) <> 'boolean'
    )
    -- The rate is a number with at most 2 decimals: 12 or 12.5, never "12%".
    or (p_changes ? 'vat_rate' and (
      jsonb_typeof(p_changes -> 'vat_rate') <> 'number'
      or (p_changes ->> 'vat_rate')::numeric <> round((p_changes ->> 'vat_rate')::numeric, 2)
    ))
    -- The return window is whole days.
    or (p_changes ? 'return_window_days' and (
      jsonb_typeof(p_changes -> 'return_window_days') <> 'number'
      or (p_changes ->> 'return_window_days')::numeric <> trunc((p_changes ->> 'return_window_days')::numeric)
    )) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select to_jsonb(b) into v_before from public.branches b where b.id = v_branch for update;

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
    vat_registered = case when p_changes ? 'vat_registered'
      then (p_changes ->> 'vat_registered')::boolean else b.vat_registered end,
    vat_rate = case when p_changes ? 'vat_rate'
      then (p_changes ->> 'vat_rate')::numeric(4, 2) else b.vat_rate end,
    round_cash = case when p_changes ? 'round_cash'
      then (p_changes ->> 'round_cash')::boolean else b.round_cash end,
    return_window_days = case when p_changes ? 'return_window_days'
      then (p_changes ->> 'return_window_days')::integer else b.return_window_days end,
    idle_lock_minutes = case when p_changes ? 'idle_lock_minutes'
      then (p_changes ->> 'idle_lock_minutes')::integer else b.idle_lock_minutes end,
    store_lat = case when p_changes ? 'store_lat'
      then (p_changes ->> 'store_lat')::double precision else b.store_lat end,
    store_lng = case when p_changes ? 'store_lng'
      then (p_changes ->> 'store_lng')::double precision else b.store_lng end,
    radius_m = case when p_changes ? 'radius_m'
      then (p_changes ->> 'radius_m')::integer else b.radius_m end,
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

-- ---- Grants and public wrappers ------------------------------------------------------------------
revoke execute on function
  private.return_sale(uuid, jsonb, text, text, boolean, text, text),
  private.request_sale_return(uuid, jsonb, text, text, boolean, text)
from public, anon;
grant execute on function
  private.return_sale(uuid, jsonb, text, text, boolean, text, text),
  private.request_sale_return(uuid, jsonb, text, text, boolean, text)
to authenticated;

create function public.return_sale(
  p_sale_id uuid,
  p_items jsonb,
  p_refund_method text,
  p_reason text,
  p_defective boolean default false,
  p_refund_reference text default null,
  p_device_tag text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.return_sale(p_sale_id, p_items, p_refund_method, p_reason, p_defective,
    p_refund_reference, p_device_tag);
$$;

create function public.request_sale_return(
  p_sale_id uuid,
  p_items jsonb,
  p_refund_method text,
  p_reason text,
  p_defective boolean default false,
  p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.request_sale_return(p_sale_id, p_items, p_refund_method, p_reason,
    p_defective, p_device_tag);
$$;

revoke execute on function
  public.return_sale(uuid, jsonb, text, text, boolean, text, text),
  public.request_sale_return(uuid, jsonb, text, text, boolean, text)
from public, anon;
grant execute on function
  public.return_sale(uuid, jsonb, text, text, boolean, text, text),
  public.request_sale_return(uuid, jsonb, text, text, boolean, text)
to authenticated;
