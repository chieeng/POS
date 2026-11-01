-- Decimal quantities (the Owner's decision of Nov 1, 2026): some products are sold by weight
-- or volume, in up to 3 decimals. The unit decides it: kg and L are sold by measure, and every
-- other unit stays whole, enforced here. Stock, stock-ins, adjustments, corrections and their
-- history hold up to 3 decimals, with no trailing zeros, so existing quantities read as before.

-- ---- Columns -----------------------------------------------------------------------------
alter table public.products
  drop constraint products_unit_check,
  add constraint products_unit_check check (
    unit in ('pc', 'pack', 'box', 'bottle', 'can', 'sachet', 'set', 'pair', 'roll', 'kg', 'L')
  ),
  alter column stock_qty type numeric,
  alter column reorder_level type numeric,
  add column sold_by_measure boolean generated always as (unit in ('kg', 'L')) stored,
  add constraint products_qty_scale check (
    stock_qty = round(stock_qty, 3) and abs(stock_qty) < 1000000000
    and reorder_level = round(reorder_level, 3)
  ),
  add constraint products_whole_unless_measure check (
    sold_by_measure
    or (stock_qty = trunc(stock_qty) and reorder_level = trunc(reorder_level))
  );

alter table public.stock_receipt_items
  drop constraint stock_receipt_items_qty_check,
  alter column qty type numeric,
  add constraint stock_receipt_items_qty_check check (qty between 0.001 and 100000 and qty = round(qty, 3));

alter table public.stock_movements
  alter column qty_change type numeric,
  alter column stock_after type numeric,
  add constraint stock_movements_qty_scale check (
    qty_change = round(qty_change, 3) and stock_after = round(stock_after, 3)
  );

alter table public.stock_adjustments
  alter column qty_change type numeric,
  add constraint stock_adjustments_qty_scale check (qty_change = round(qty_change, 3));

-- ---- Shared checks -----------------------------------------------------------------------
-- A quantity this product can hold: at most 3 decimals, and whole unless sold by measure.
create function private.require_qty(p_product public.products, p_qty numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_qty is null or p_qty <> round(p_qty, 3)
    or (not p_product.sold_by_measure and p_qty <> trunc(p_qty)) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function private.require_qty(public.products, numeric)
  from public, anon, authenticated;

drop function private.require_stock(public.products, integer);
create function private.require_stock(p_product public.products, p_change numeric)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_product.stock_qty + p_change < 0 then
    raise exception 'stock_negative' using errcode = '22023',
      detail = jsonb_build_object(
        'product_id', p_product.id,
        'stock', p_product.stock_qty,
        'result', p_product.stock_qty + p_change
      )::text;
  end if;
end;
$$;
revoke execute on function private.require_stock(public.products, numeric)
  from public, anon, authenticated;

-- ---- Same rules as before, with quantities that can hold decimals ------------------------
create or replace function private.create_product(p_fields jsonb, p_device_tag text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_row public.products;
begin
  if v_uid is null or not private.can_add_catalog() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object'
    or exists (
      select 1 from jsonb_object_keys(p_fields) k
      where k not in ('sku', 'name', 'category_id', 'unit', 'sell_price', 'reorder_level')
    ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  perform private.require_active_category((p_fields ->> 'category_id')::uuid, v_branch);

  insert into public.products (branch_id, sku, name, category_id, unit, sell_price, reorder_level)
  values (
    v_branch,
    upper(btrim(p_fields ->> 'sku')),
    private.catalog_text(p_fields ->> 'name', 120, true),
    (p_fields ->> 'category_id')::uuid,
    coalesce(p_fields ->> 'unit', 'pc'),
    (p_fields ->> 'sell_price')::numeric(12, 2),
    coalesce((p_fields ->> 'reorder_level')::numeric, 0)
  )
  returning * into v_row;

  insert into public.price_changes
    (branch_id, product_id, old_price, new_price, source, changed_by, changed_by_name, device_tag)
  select v_branch, v_row.id, null, v_row.sell_price, 'created', v_uid, pr.display_name, v_tag
  from public.profiles pr where pr.id = v_uid;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after)
  values (
    v_branch, 'product.create', v_uid, v_tag, 'product', v_row.id::text,
    jsonb_build_object(
      'sku', v_row.sku, 'name', v_row.name, 'unit', v_row.unit, 'sell_price', v_row.sell_price
    )
  );
  return v_row.id;
exception
  when unique_violation then
    raise exception 'sku_taken' using errcode = '23505';
  when invalid_text_representation or numeric_value_out_of_range or check_violation
    or not_null_violation then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

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
    'sku', 'name', 'category_id', 'unit', 'sell_price', 'reorder_level', 'active', 'photo_key'
  ];
  v_before jsonb;
  v_after public.products;
  v_old jsonb := '{}';
  v_new jsonb := '{}';
  v_key text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'
    or exists (select 1 from jsonb_object_keys(p_changes) k where k <> all (v_keys))
    or (p_changes ? 'active' and jsonb_typeof(p_changes -> 'active') <> 'boolean')
    or (p_changes ? 'photo_key' and jsonb_typeof(p_changes -> 'photo_key') not in ('string', 'null')) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select to_jsonb(p) into v_before from public.products p
  where p.id = p_id and p.branch_id = v_branch
  for update;
  if v_before is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- A product can't stop being sold by weight or volume while it holds a part of a unit.
  if p_changes ->> 'unit' is not null and p_changes ->> 'unit' not in ('kg', 'L')
    and (
      (v_before ->> 'stock_qty')::numeric <> trunc((v_before ->> 'stock_qty')::numeric)
      or (v_before ->> 'reorder_level')::numeric <> trunc((v_before ->> 'reorder_level')::numeric)
    ) then
    raise exception 'stock_fractional' using errcode = '22023';
  end if;

  -- Moving to another category needs an active one; staying in an inactive one is fine.
  if p_changes ? 'category_id'
    and (p_changes ->> 'category_id')::uuid is distinct from (v_before ->> 'category_id')::uuid then
    perform private.require_active_category((p_changes ->> 'category_id')::uuid, v_branch);
  end if;

  if p_changes ->> 'photo_key' is not null
    and p_changes ->> 'photo_key' is distinct from v_before ->> 'photo_key'
    and not private.photo_files_exist(p_id, p_changes ->> 'photo_key') then
    raise exception 'photo_missing' using errcode = '22023';
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
      then (p_changes ->> 'reorder_level')::numeric else p.reorder_level end,
    active = case when p_changes ? 'active'
      then (p_changes ->> 'active')::boolean else p.active end,
    photo_key = case when p_changes ? 'photo_key' then p_changes ->> 'photo_key' else p.photo_key end,
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

create or replace function private.record_stock_in(
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
  v_qty numeric;
  v_cost numeric(12, 2);
  v_avg numeric(14, 4);
  v_new_avg numeric(14, 4);
  v_units numeric := 0;
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

    v_qty := (v_line ->> 'qty')::numeric;
    perform private.require_qty(v_product, v_qty);
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

create or replace function private.apply_stock_in_correction(
  p_receipt_id uuid,
  p_supplier_id uuid,
  p_reference text,
  p_lines jsonb,
  p_delete boolean,
  p_reason text,
  p_device_tag text,
  p_dry_run boolean,
  p_approval_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_reference text := private.catalog_text(p_reference, 60, false);
  v_name text;
  v_original public.stock_receipts;
  v_new uuid;
  v_old record;
  v_line jsonb;
  v_wanted jsonb := '{}';
  v_qty numeric;
  v_cost numeric(12, 2);
  v_product public.products;
  v_avg numeric(14, 4);
  v_onhand numeric;
  v_value numeric;
  v_new_stock numeric;
  v_new_avg numeric(14, 4);
  v_changed boolean := false;
  v_no integer := 0;
  v_before_lines jsonb;
begin
  select * into v_original from public.stock_receipts r
  where r.id = p_receipt_id and r.branch_id = v_branch
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_original.is_deletion then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_receipts r where r.corrects_receipt_id = p_receipt_id) then
    raise exception 'receipt_corrected' using errcode = '22023';
  end if;

  if p_supplier_id is distinct from v_original.supplier_id and p_supplier_id is not null then
    if not exists (
      select 1 from public.suppliers s
      where s.id = p_supplier_id and s.branch_id = v_branch and s.active
    ) then
      raise exception 'supplier_inactive' using errcode = '22023';
    end if;
  end if;

  -- The wanted quantity and cost of every product on the stock-in.
  if coalesce(p_delete, false) then
    select jsonb_object_agg(i.product_id::text, jsonb_build_object('qty', 0, 'unit_cost', i.unit_cost))
    into v_wanted
    from public.stock_receipt_items i where i.receipt_id = p_receipt_id;
  else
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    for v_line in select value from jsonb_array_elements(p_lines) loop
      if jsonb_typeof(v_line) <> 'object'
        or exists (
          select 1 from jsonb_object_keys(v_line) k where k not in ('product_id', 'qty', 'unit_cost')
        )
        or jsonb_typeof(v_line -> 'qty') is distinct from 'number'
        or jsonb_typeof(v_line -> 'unit_cost') is distinct from 'number'
        or v_wanted ? (v_line ->> 'product_id')
        or not exists (
          select 1 from public.stock_receipt_items i
          where i.receipt_id = p_receipt_id and i.product_id::text = v_line ->> 'product_id'
        ) then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_qty := (v_line ->> 'qty')::numeric;
      v_cost := (v_line ->> 'unit_cost')::numeric(12, 2);
      if v_qty not between 0 and 100000 or v_cost not between 0.01 and 1000000 then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_wanted := v_wanted || jsonb_build_object(
        v_line ->> 'product_id', jsonb_build_object('qty', v_qty, 'unit_cost', v_cost)
      );
    end loop;
    if (select count(*) from public.stock_receipt_items i where i.receipt_id = p_receipt_id)
      <> (select count(*) from jsonb_object_keys(v_wanted)) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end if;

  -- Something must change, and nothing may go below zero.
  v_changed := coalesce(p_delete, false)
    or p_supplier_id is distinct from v_original.supplier_id
    or v_reference is distinct from v_original.reference;
  for v_old in
    select i.product_id, i.qty, i.unit_cost from public.stock_receipt_items i
    where i.receipt_id = p_receipt_id order by i.line_no
  loop
    v_qty := (v_wanted -> v_old.product_id::text ->> 'qty')::numeric;
    v_cost := (v_wanted -> v_old.product_id::text ->> 'unit_cost')::numeric(12, 2);
    if v_qty <> v_old.qty or v_cost <> v_old.unit_cost then
      v_changed := true;
    end if;
    select * into v_product from public.products p where p.id = v_old.product_id for update;
    perform private.require_qty(v_product, v_qty);
    perform private.require_stock(v_product, v_qty - v_old.qty);
  end loop;
  if not v_changed then
    raise exception 'no_change' using errcode = '22023';
  end if;

  if p_dry_run then
    raise exception 'dry_run' using errcode = 'P0099', detail = '{}';
  end if;

  v_before_lines := private.receipt_lines_named(p_receipt_id);
  select pr.display_name into v_name from public.profiles pr where pr.id = v_uid;
  insert into public.stock_receipts
    (branch_id, supplier_id, reference, received_by, received_by_name, device_tag,
     corrects_receipt_id, is_deletion, corrected_by, corrected_by_name)
  values (
    v_branch, p_supplier_id, v_reference, v_original.received_by, v_original.received_by_name,
    v_tag, p_receipt_id, coalesce(p_delete, false), v_uid, v_name
  )
  returning id into v_new;

  for v_old in
    select i.product_id, i.qty, i.unit_cost from public.stock_receipt_items i
    where i.receipt_id = p_receipt_id order by i.line_no
  loop
    v_qty := (v_wanted -> v_old.product_id::text ->> 'qty')::numeric;
    v_cost := (v_wanted -> v_old.product_id::text ->> 'unit_cost')::numeric(12, 2);
    select * into v_product from public.products p where p.id = v_old.product_id for update;
    select c.cost_price into v_avg from public.product_costs c where c.product_id = v_product.id;

    -- INV-08 after a correction: revalue only what can still be on hand from this delivery.
    v_onhand := least(v_old.qty, greatest(v_product.stock_qty, 0));
    v_new_stock := v_product.stock_qty + v_qty - v_old.qty;
    v_value := greatest(v_product.stock_qty, 0) * coalesce(v_avg, v_old.unit_cost)
      + v_onhand * (v_cost - v_old.unit_cost)
      + (v_qty - v_old.qty) * v_cost;
    if v_new_stock <= 0 or v_value <= 0 then
      v_new_avg := v_cost;
    else
      v_new_avg := v_value / v_new_stock;
    end if;
    insert into public.product_costs (product_id, branch_id, cost_price, updated_at)
    values (v_product.id, v_branch, v_new_avg, now())
    on conflict (product_id) do update set cost_price = excluded.cost_price, updated_at = now();

    -- The corrected line first, then the reversal, so the history never dips below zero
    -- in between.
    if v_qty > 0 then
      v_no := v_no + 1;
      insert into public.stock_receipt_items (receipt_id, line_no, product_id, qty, unit_cost)
      values (v_new, v_no, v_product.id, v_qty, v_cost);
      insert into public.stock_movements
        (branch_id, product_id, type, qty_change, stock_after, unit_cost, ref_type, ref_id,
         user_id, user_name, device_tag)
      values (
        v_branch, v_product.id, 'stock_in', v_qty, v_product.stock_qty + v_qty, v_cost,
        'stock_receipt', v_new::text, v_uid, v_name, v_tag
      );
    end if;
    insert into public.stock_movements
      (branch_id, product_id, type, qty_change, stock_after, unit_cost, ref_type, ref_id,
       user_id, user_name, device_tag)
    values (
      v_branch, v_product.id, 'stock_in_reversal', -v_old.qty, v_new_stock, v_old.unit_cost,
      'stock_receipt', v_new::text, v_uid, v_name, v_tag
    );
    update public.products p set stock_qty = v_new_stock where p.id = v_product.id;
  end loop;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, before, after, reason)
  values (
    v_branch, 'stock.correct', v_uid, v_tag, 'stock_receipt', v_new::text,
    jsonb_build_object(
      'receipt', p_receipt_id,
      'reference', v_original.reference,
      'supplier_id', v_original.supplier_id,
      'lines', v_before_lines
    ),
    jsonb_build_object(
      'reference', v_reference,
      'supplier_id', p_supplier_id,
      'deleted', coalesce(p_delete, false),
      'lines', v_wanted,
      'names', private.names_of(array[v_original.supplier_id, p_supplier_id])
    )
      || case when p_approval_id is null then '{}'::jsonb else '{"via": "approval"}'::jsonb end,
    private.catalog_text(p_reason, 200, false)
  );
  return v_new;
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation
    or not_null_violation then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

create or replace function private.decide_approval(
  p_id uuid,
  p_approve boolean,
  p_note text default null,
  p_device_tag text default null
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

-- ---- Functions whose signature changes ---------------------------------------------------
drop function public.adjust_stock(uuid, text, integer, text, text);
drop function public.request_stock_adjustment(uuid, text, integer, text, text);
drop function public.product_stock_history(uuid, timestamptz, timestamptz, text, integer);
drop function private.adjust_stock(uuid, text, integer, text, text);
drop function private.request_stock_adjustment(uuid, text, integer, text, text);
drop function private.apply_stock_adjustment(uuid, text, integer, text, text, uuid, boolean);
drop function private.product_stock_history(uuid, timestamptz, timestamptz, text, integer);

create function private.apply_stock_adjustment(
  p_product_id uuid,
  p_type text,
  p_qty numeric,
  p_reason text,
  p_device_tag text,
  p_approval_id uuid,
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
  v_reason text := private.catalog_text(p_reason, 200, true);
  v_product public.products;
  v_cost numeric(14, 4);
  v_name text;
  v_id uuid;
begin
  if p_type is null or p_type not in ('damage', 'loss', 'expiry', 'found', 'store_use', 'other')
    or p_qty is null or p_qty = 0 or p_qty not between -100000 and 100000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into v_product from public.products p
  where p.id = p_product_id and p.branch_id = v_branch
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.require_qty(v_product, p_qty);
  perform private.require_stock(v_product, p_qty);

  if p_dry_run then
    raise exception 'dry_run' using errcode = 'P0099', detail = '{}';
  end if;

  select c.cost_price into v_cost from public.product_costs c where c.product_id = v_product.id;
  select pr.display_name into v_name from public.profiles pr where pr.id = v_uid;

  insert into public.stock_adjustments
    (branch_id, product_id, type, qty_change, reason, unit_cost, created_by, created_by_name,
     approval_id, device_tag)
  values (
    v_branch, v_product.id, p_type, p_qty, v_reason, v_cost, v_uid, v_name, p_approval_id, v_tag
  )
  returning id into v_id;

  update public.products p set stock_qty = p.stock_qty + p_qty where p.id = v_product.id;
  insert into public.stock_movements
    (branch_id, product_id, type, qty_change, stock_after, unit_cost, ref_type, ref_id,
     user_id, user_name, device_tag)
  values (
    v_branch, v_product.id, 'adjustment', p_qty, v_product.stock_qty + p_qty, v_cost,
    'adjustment', v_id::text, v_uid, v_name, v_tag
  );

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_branch, 'stock.adjust', v_uid, v_tag, 'product', v_product.id::text,
    jsonb_build_object(
      'label', v_product.name, 'type', p_type, 'qty', p_qty, 'unit', v_product.unit,
      'stock_after', v_product.stock_qty + p_qty
    )
      || case when p_approval_id is null then '{}'::jsonb else '{"via": "approval"}'::jsonb end,
    v_reason
  );
end;
$$;
revoke execute on function
  private.apply_stock_adjustment(uuid, text, numeric, text, text, uuid, boolean)
  from public, anon, authenticated;

create function private.adjust_stock(
  p_product_id uuid,
  p_type text,
  p_qty numeric,
  p_reason text,
  p_device_tag text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  perform private.apply_stock_adjustment(p_product_id, p_type, p_qty, p_reason, p_device_tag, null, false);
end;
$$;

create function private.request_stock_adjustment(
  p_product_id uuid,
  p_type text,
  p_qty numeric,
  p_reason text,
  p_device_tag text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.approval_requests;
begin
  if v_uid is null or not private.is_special_sales() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  begin
    perform private.apply_stock_adjustment(p_product_id, p_type, p_qty, p_reason, p_device_tag, null, true);
  exception
    when sqlstate 'P0099' then null;
  end;
  begin
    insert into public.approval_requests
      (branch_id, type, target_type, target_id, before, after, reason, requested_by)
    values (
      private.current_branch(), 'stock_adjustment', 'product', p_product_id,
      '{}', jsonb_build_object('type', p_type, 'qty', p_qty),
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
  qty_change numeric,
  stock_after numeric,
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

revoke execute on function
  private.adjust_stock(uuid, text, numeric, text, text),
  private.request_stock_adjustment(uuid, text, numeric, text, text),
  private.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
from public, anon;
grant execute on function
  private.adjust_stock(uuid, text, numeric, text, text),
  private.request_stock_adjustment(uuid, text, numeric, text, text),
  private.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
to authenticated;

create function public.adjust_stock(
  p_product_id uuid, p_type text, p_qty numeric, p_reason text, p_device_tag text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.adjust_stock(p_product_id, p_type, p_qty, p_reason, p_device_tag); $$;

create function public.request_stock_adjustment(
  p_product_id uuid, p_type text, p_qty numeric, p_reason text, p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.request_stock_adjustment(p_product_id, p_type, p_qty, p_reason, p_device_tag); $$;

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
  qty_change numeric,
  stock_after numeric,
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
  public.adjust_stock(uuid, text, numeric, text, text),
  public.request_stock_adjustment(uuid, text, numeric, text, text),
  public.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
from public, anon;
grant execute on function
  public.adjust_stock(uuid, text, numeric, text, text),
  public.request_stock_adjustment(uuid, text, numeric, text, text),
  public.product_stock_history(uuid, timestamptz, timestamptz, text, integer)
to authenticated;
