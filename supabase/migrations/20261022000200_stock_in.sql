-- Build step 4, part 1 (SRS 3.5, INV-01..03, INV-05, INV-08): stock-in, stock movements,
-- weighted-average cost, low stock. Adjustments and stock-in corrections come in part 2.
--
--   Stock-in: the Owner (with the second step) and Special Sales record a delivery; it applies
--   at once (INV-02). Only active products and suppliers; each product once per stock-in;
--   every line has a unit cost of at least PHP 0.01, opening stock included.
--   Every quantity change is an append-only stock movement (INV-01).
--   Cost: weighted average per product, updated on every stock-in (INV-08). Only the Owner
--   reads costs, except that whoever received a stock-in sees the unit costs they typed on it.
--   Stock-ins never take stock below zero (only sales may, POS-09).

-- ---- Approved product changes say so in the audit log ------------------------------------
-- Same function as in 20261022000100_approval_requests.sql; the audit entry of a change
-- applied by an approval now carries "via": "approval" next to the product's name.
create or replace function private.apply_product_change(
  p_id uuid,
  p_changes jsonb,
  p_source text,
  p_device_tag text,
  p_reason text,
  p_dry_run boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_keys constant text[] := array[
    'sku', 'name', 'category_id', 'unit', 'sell_price', 'reorder_level', 'active'
  ];
  v_before jsonb;
  v_after public.products;
  v_old jsonb := '{}';
  v_new jsonb := '{}';
  v_key text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'
    or exists (select 1 from jsonb_object_keys(p_changes) k where k <> all (v_keys))
    or (p_changes ? 'active' and jsonb_typeof(p_changes -> 'active') <> 'boolean') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select to_jsonb(p) into v_before from public.products p
  where p.id = p_id and p.branch_id = v_branch
  for update;
  if v_before is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Moving to another category needs an active one; staying in an inactive one is fine.
  if p_changes ? 'category_id'
    and (p_changes ->> 'category_id')::uuid is distinct from (v_before ->> 'category_id')::uuid then
    perform private.require_active_category((p_changes ->> 'category_id')::uuid, v_branch);
  end if;

  update public.products p set
    sku = case when p_changes ? 'sku' then upper(btrim(p_changes ->> 'sku')) else p.sku end,
    name = case when p_changes ? 'name'
      then private.catalog_text(p_changes ->> 'name', 120, true) else p.name end,
    category_id = case when p_changes ? 'category_id'
      then (p_changes ->> 'category_id')::uuid else p.category_id end,
    unit = case when p_changes ? 'unit' then p_changes ->> 'unit' else p.unit end,
    sell_price = case when p_changes ? 'sell_price'
      then (p_changes ->> 'sell_price')::numeric(12, 2) else p.sell_price end,
    reorder_level = case when p_changes ? 'reorder_level'
      then (p_changes ->> 'reorder_level')::integer else p.reorder_level end,
    active = case when p_changes ? 'active'
      then (p_changes ->> 'active')::boolean else p.active end,
    updated_at = now()
  where p.id = p_id
  returning * into v_after;

  foreach v_key in array v_keys loop
    if (v_before -> v_key) is distinct from (to_jsonb(v_after) -> v_key) then
      v_old := v_old || jsonb_build_object(v_key, v_before -> v_key);
      v_new := v_new || jsonb_build_object(v_key, to_jsonb(v_after) -> v_key);
    end if;
  end loop;

  if p_dry_run then
    raise exception 'dry_run'
      using errcode = 'P0099', detail = jsonb_build_object('before', v_old, 'after', v_new)::text;
  end if;

  if v_new ? 'sell_price' then
    insert into public.price_changes
      (branch_id, product_id, old_price, new_price, source, changed_by, changed_by_name, device_tag)
    select v_branch, p_id, (v_before ->> 'sell_price')::numeric, v_after.sell_price, p_source,
      v_uid, pr.display_name, v_tag
    from public.profiles pr where pr.id = v_uid;
  end if;

  if v_new <> '{}' then
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, before, after, reason)
    values (
      v_branch, 'product.update', v_uid, v_tag, 'product', p_id::text,
      v_old || jsonb_build_object('label', v_before ->> 'name')
        || case when p_source = 'approval' then '{"via": "approval"}'::jsonb else '{}'::jsonb end,
      v_new, p_reason
    );
  end if;
exception
  when unique_violation then
    raise exception 'sku_taken' using errcode = '23505';
  when invalid_text_representation or numeric_value_out_of_range or check_violation
    or not_null_violation then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

-- ---- Tables ------------------------------------------------------------------------------
-- The weighted-average cost of one unit (INV-08). Four decimals, so averaging does not drift;
-- money shown to people is rounded to centavos.
create table public.product_costs (
  product_id uuid primary key references public.products (id),
  branch_id text not null references public.branches (id),
  cost_price numeric(14, 4) not null check (cost_price >= 0),
  updated_at timestamptz not null default now()
);

create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  supplier_id uuid references public.suppliers (id),
  -- DR or invoice number, or "Opening stock" for the stock on the shelves at go-live.
  reference text check (reference = btrim(reference) and char_length(reference) between 1 and 60),
  received_by uuid not null references public.profiles (id),
  -- The name as it was then, so the history reads the same for everyone who may see it.
  received_by_name text not null,
  device_tag text check (device_tag ~ '^[A-Z0-9]{4}$'),
  created_at timestamptz not null default now()
);
create index stock_receipts_branch_created_idx on public.stock_receipts (branch_id, created_at desc);

create table public.stock_receipt_items (
  id bigint generated always as identity primary key,
  receipt_id uuid not null references public.stock_receipts (id),
  line_no integer not null check (line_no between 1 and 100),
  product_id uuid not null references public.products (id),
  qty integer not null check (qty between 1 and 100000),
  unit_cost numeric(12, 2) not null check (unit_cost between 0.01 and 1000000),
  unique (receipt_id, product_id),
  unique (receipt_id, line_no)
);
create index stock_receipt_items_product_idx on public.stock_receipt_items (product_id);

-- INV-01: every quantity change, append-only. Sales, voids, returns and counts write theirs
-- in later build steps; part 2 adds stock_in_reversal and adjustment.
create table public.stock_movements (
  id bigint generated always as identity primary key,
  branch_id text not null references public.branches (id),
  product_id uuid not null references public.products (id),
  type text not null
    check (type in ('stock_in', 'stock_in_reversal', 'adjustment', 'sale', 'void', 'return', 'count')),
  qty_change integer not null check (qty_change <> 0),
  stock_after integer not null,
  -- The cost of one unit this movement was valued at. The Owner reads it; nobody else.
  unit_cost numeric(14, 4),
  ref_type text check (ref_type in ('stock_receipt', 'adjustment', 'sale', 'count')),
  ref_id text,
  user_id uuid not null references public.profiles (id),
  user_name text not null,
  device_tag text check (device_tag ~ '^[A-Z0-9]{4}$'),
  created_at timestamptz not null default now()
);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

revoke all on table
  public.product_costs, public.stock_receipts, public.stock_receipt_items, public.stock_movements
from public, anon, authenticated, service_role;
grant select on table
  public.product_costs, public.stock_receipts, public.stock_receipt_items, public.stock_movements
to authenticated;

alter table public.product_costs enable row level security;
alter table public.stock_receipts enable row level security;
alter table public.stock_receipt_items enable row level security;
alter table public.stock_movements enable row level security;

-- Cost and movements (which carry costs): the Owner only. Special Sales reads a product's
-- stock history through product_stock_history, which leaves the cost out.
create policy product_costs_select_owner on public.product_costs
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));
create policy stock_movements_select_owner on public.stock_movements
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));

-- Stock-ins: the Owner reads all of the branch's; whoever received one reads it, with the
-- unit costs they typed themselves (they hold the delivery receipt anyway).
create policy stock_receipts_select_owner on public.stock_receipts
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));
create policy stock_receipts_select_own on public.stock_receipts
  for select to authenticated
  using ((select private.can_add_catalog()) and received_by = (select auth.uid()));

create function private.can_read_receipt(p_receipt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stock_receipts r
    where r.id = p_receipt_id
      and (
        (private.is_owner() and r.branch_id = private.current_branch())
        or (private.can_add_catalog() and r.received_by = (select auth.uid()))
      )
  );
$$;
revoke execute on function private.can_read_receipt(uuid) from public, anon;
grant execute on function private.can_read_receipt(uuid) to authenticated;

create policy stock_receipt_items_select on public.stock_receipt_items
  for select to authenticated
  using ((select private.can_read_receipt(receipt_id)));

-- A new stock-in shows in the history at once; the Owner's costs stay current.
alter publication supabase_realtime add table public.stock_receipts, public.product_costs;

-- ---- record_stock_in ---------------------------------------------------------------------
-- p_lines: [{"product_id": uuid, "qty": integer, "unit_cost": number}, ...], 1 to 100 lines.
-- Errors, with DETAIL where useful: supplier_inactive; product_inactive (DETAIL: product id);
-- duplicate_product (DETAIL: {"product_id", "line"} of the first line with it); not_found;
-- invalid_input.
create function private.record_stock_in(
  p_supplier_id uuid,
  p_reference text,
  p_lines jsonb,
  p_device_tag text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_reference text := private.catalog_text(p_reference, 60, false);
  v_name text;
  v_supplier public.suppliers;
  v_receipt uuid;
  v_line jsonb;
  v_no integer := 0;
  v_seen jsonb := '{}';
  v_product public.products;
  v_qty integer;
  v_cost numeric(12, 2);
  v_avg numeric(14, 4);
  v_new_avg numeric(14, 4);
  v_units integer := 0;
  v_value numeric(14, 2) := 0;
begin
  if v_uid is null or not private.can_add_catalog() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_supplier_id is not null then
    select * into v_supplier from public.suppliers s
    where s.id = p_supplier_id and s.branch_id = v_branch;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if not v_supplier.active then
      raise exception 'supplier_inactive' using errcode = '22023';
    end if;
  end if;

  select pr.display_name into v_name from public.profiles pr where pr.id = v_uid;
  insert into public.stock_receipts
    (branch_id, supplier_id, reference, received_by, received_by_name, device_tag)
  values (v_branch, p_supplier_id, v_reference, v_uid, v_name, v_tag)
  returning id into v_receipt;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_no := v_no + 1;
    if jsonb_typeof(v_line) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_line) k where k not in ('product_id', 'qty', 'unit_cost')
      )
      or jsonb_typeof(v_line -> 'qty') is distinct from 'number'
      or jsonb_typeof(v_line -> 'unit_cost') is distinct from 'number' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if v_seen ? (v_line ->> 'product_id') then
      raise exception 'duplicate_product' using errcode = '22023',
        detail = jsonb_build_object(
          'product_id', v_line ->> 'product_id',
          'line', v_seen -> (v_line ->> 'product_id')
        )::text;
    end if;
    v_seen := v_seen || jsonb_build_object(v_line ->> 'product_id', v_no);

    select * into v_product from public.products p
    where p.id = (v_line ->> 'product_id')::uuid and p.branch_id = v_branch
    for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if not v_product.active then
      raise exception 'product_inactive' using errcode = '22023', detail = v_product.id::text;
    end if;

    v_qty := (v_line ->> 'qty')::integer;
    v_cost := (v_line ->> 'unit_cost')::numeric(12, 2);
    insert into public.stock_receipt_items (receipt_id, line_no, product_id, qty, unit_cost)
    values (v_receipt, v_no, v_product.id, v_qty, v_cost);

    -- INV-08: weighted average over what is on hand. With nothing (or less) on hand, the new
    -- delivery's cost is the cost.
    select c.cost_price into v_avg from public.product_costs c where c.product_id = v_product.id;
    if v_avg is null or v_product.stock_qty <= 0 then
      v_new_avg := v_cost;
    else
      v_new_avg := (v_product.stock_qty * v_avg + v_qty * v_cost) / (v_product.stock_qty + v_qty);
    end if;
    insert into public.product_costs (product_id, branch_id, cost_price, updated_at)
    values (v_product.id, v_branch, v_new_avg, now())
    on conflict (product_id) do update set cost_price = excluded.cost_price, updated_at = now();

    update public.products p set stock_qty = p.stock_qty + v_qty where p.id = v_product.id;

    insert into public.stock_movements
      (branch_id, product_id, type, qty_change, stock_after, unit_cost, ref_type, ref_id,
       user_id, user_name, device_tag)
    values (
      v_branch, v_product.id, 'stock_in', v_qty, v_product.stock_qty + v_qty, v_cost,
      'stock_receipt', v_receipt::text, v_uid, v_name, v_tag
    );
    v_units := v_units + v_qty;
    v_value := v_value + v_qty * v_cost;
  end loop;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after)
  values (
    v_branch, 'stock.in', v_uid, v_tag, 'stock_receipt', v_receipt::text,
    jsonb_build_object(
      'reference', v_reference,
      'supplier', v_supplier.name,
      'lines', v_no,
      'units', v_units,
      'value', v_value
    )
  );
  return v_receipt;
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation
    or not_null_violation then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

-- ---- product_stock_history (INV-06) ------------------------------------------------------
-- One product's movements, newest first, for the Owner and Special Sales; the cost is left
-- out for anyone but the Owner. Sales see stock levels only.
create function private.product_stock_history(
  p_product_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_type text default null,
  p_limit integer default 100
)
returns table (
  id bigint,
  created_at timestamptz,
  type text,
  qty_change integer,
  stock_after integer,
  unit_cost numeric,
  user_name text,
  ref_type text,
  ref_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner boolean := private.is_owner();
begin
  if (select auth.uid()) is null or not private.can_add_catalog() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  return query
    select m.id, m.created_at, m.type, m.qty_change, m.stock_after,
      case when v_owner then m.unit_cost end, m.user_name, m.ref_type, m.ref_id
    from public.stock_movements m
    where m.product_id = p_product_id
      and m.branch_id = private.current_branch()
      and (p_from is null or m.created_at >= p_from)
      and (p_to is null or m.created_at < p_to)
      and (p_type is null or m.type = p_type)
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 300);
end;
$$;

-- ---- Grants and API wrappers -------------------------------------------------------------
revoke execute on function
  private.record_stock_in(uuid, text, jsonb, text),
  private.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
from public, anon;
grant execute on function
  private.record_stock_in(uuid, text, jsonb, text),
  private.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
to authenticated;

create function public.record_stock_in(
  p_supplier_id uuid,
  p_reference text,
  p_lines jsonb,
  p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.record_stock_in(p_supplier_id, p_reference, p_lines, p_device_tag); $$;

create function public.product_stock_history(
  p_product_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_type text default null,
  p_limit integer default 100
)
returns table (
  id bigint,
  created_at timestamptz,
  type text,
  qty_change integer,
  stock_after integer,
  unit_cost numeric,
  user_name text,
  ref_type text,
  ref_id text
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.product_stock_history(p_product_id, p_from, p_to, p_type, p_limit); $$;

revoke execute on function
  public.record_stock_in(uuid, text, jsonb, text),
  public.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
from public, anon;
grant execute on function
  public.record_stock_in(uuid, text, jsonb, text),
  public.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
to authenticated;
