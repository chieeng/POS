-- Build step 4, part 2 (SRS 3.5, INV-04, INV-08): stock adjustments and stock-in corrections.
--
--   Adjustment: damage, loss, expiry, found, store use (the store's or owner's own use), other;
--   a signed whole quantity and a reason; valued at the current average cost, which it does
--   not change.
--   Correction of a stock-in: its lines' quantity and unit cost, its supplier and reference, or
--   deleting it (every quantity to 0). The original is never edited or deleted: the correction
--   is a new stock-in linked to it (corrects_receipt_id), with new stock_in movements for the
--   corrected lines and stock_in_reversal movements for the original ones.
--   Cost after a correction: units already sold keep the cost recorded with the sale, so past
--   profit never changes. Only the units of that delivery still on hand (at most its original
--   quantity) are revalued from the old to the corrected cost; a change in quantity is added
--   or removed at the corrected cost; with nothing left, or a result that makes no sense, the
--   average becomes the corrected unit cost.
--   Neither may take stock below zero ("stock_negative"); only sales may (POS-09).
--   The Owner applies both directly. Special Sales sends approval requests (types
--   stock_adjustment and stock_in_correction), corrections for their own stock-ins only.

-- ---- Adjustments -------------------------------------------------------------------------
create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  product_id uuid not null references public.products (id),
  type text not null check (type in ('damage', 'loss', 'expiry', 'found', 'store_use', 'other')),
  qty_change integer not null check (qty_change <> 0 and qty_change between -100000 and 100000),
  reason text not null check (reason = btrim(reason) and char_length(reason) between 1 and 200),
  -- The average cost of one unit at the time; the adjustment does not change it.
  unit_cost numeric(14, 4),
  created_by uuid not null references public.profiles (id),
  created_by_name text not null,
  approval_id uuid references public.approval_requests (id),
  device_tag text check (device_tag ~ '^[A-Z0-9]{4}$'),
  created_at timestamptz not null default now()
);
create index stock_adjustments_product_idx on public.stock_adjustments (product_id, created_at desc);

revoke all on table public.stock_adjustments from public, anon, authenticated, service_role;
grant select on table public.stock_adjustments to authenticated;
alter table public.stock_adjustments enable row level security;
create policy stock_adjustments_select_owner on public.stock_adjustments
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));

-- ---- Corrections: a new stock-in that replaces an earlier one -----------------------------
alter table public.stock_receipts
  add column corrects_receipt_id uuid references public.stock_receipts (id),
  add column is_deletion boolean not null default false,
  -- Who corrected it, when it is a correction. received_by stays the original receiver, so
  -- they keep seeing their own stock-in in its corrected form.
  add column corrected_by uuid references public.profiles (id),
  add column corrected_by_name text,
  add constraint stock_receipts_correction_complete
    check ((corrects_receipt_id is null) = (corrected_by is null)),
  add constraint stock_receipts_deletion_is_correction
    check (not is_deletion or corrects_receipt_id is not null);
-- A stock-in is corrected at most once; a later fix corrects the correction.
create unique index stock_receipts_corrects_key on public.stock_receipts (corrects_receipt_id);

-- ---- Approval requests: the two new types ------------------------------------------------
alter table public.approval_requests
  drop constraint approval_requests_type_check,
  add constraint approval_requests_type_check
    check (type in ('product_edit', 'stock_adjustment', 'stock_in_correction')),
  drop constraint approval_requests_target_type_check,
  add constraint approval_requests_target_type_check
    check (target_type in ('product', 'stock_receipt'));
-- One pending request per type, item and requester: a product can have a pending edit and a
-- pending adjustment from the same person.
drop index public.approval_requests_one_pending;
create unique index approval_requests_one_pending
  on public.approval_requests (type, target_id, requested_by) where status = 'pending';

-- ---- Shared: refuse a negative result ------------------------------------------------------
create function private.require_stock(p_product public.products, p_change integer)
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
revoke execute on function private.require_stock(public.products, integer) from public, anon, authenticated;

-- ---- apply_stock_adjustment ----------------------------------------------------------------
-- The checks and writes of one adjustment; the caller checks who may. A dry run makes every
-- check, then raises P0099 (as apply_product_change does) so a request holds only what would
-- work.
create function private.apply_stock_adjustment(
  p_product_id uuid,
  p_type text,
  p_qty integer,
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
revoke execute on function private.apply_stock_adjustment(uuid, text, integer, text, text, uuid, boolean)
  from public, anon, authenticated;

-- ---- apply_stock_in_correction -------------------------------------------------------------
-- p_lines: every product of the stock-in exactly once, [{"product_id", "qty", "unit_cost"}];
-- qty 0 takes the product off. p_delete: every quantity to 0 (p_lines is then ignored). The
-- supplier may stay as it was even if it is inactive now; a different one must be active.
create function private.apply_stock_in_correction(
  p_receipt_id uuid,
  p_supplier_id uuid,
  p_reference text,
  p_lines jsonb,
  p_delete boolean,
  p_reason text,
  p_device_tag text,
  p_dry_run boolean
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
  v_qty integer;
  v_cost numeric(12, 2);
  v_product public.products;
  v_avg numeric(14, 4);
  v_onhand integer;
  v_value numeric;
  v_new_stock integer;
  v_new_avg numeric(14, 4);
  v_changed boolean := false;
  v_no integer := 0;
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
      v_qty := (v_line ->> 'qty')::integer;
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
    v_qty := (v_wanted -> v_old.product_id::text ->> 'qty')::integer;
    v_cost := (v_wanted -> v_old.product_id::text ->> 'unit_cost')::numeric(12, 2);
    if v_qty <> v_old.qty or v_cost <> v_old.unit_cost then
      v_changed := true;
    end if;
    select * into v_product from public.products p where p.id = v_old.product_id for update;
    perform private.require_stock(v_product, v_qty - v_old.qty);
  end loop;
  if not v_changed then
    raise exception 'no_change' using errcode = '22023';
  end if;

  if p_dry_run then
    raise exception 'dry_run' using errcode = 'P0099', detail = '{}';
  end if;

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
    v_qty := (v_wanted -> v_old.product_id::text ->> 'qty')::integer;
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
      'lines', (
        select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.qty, 'unit_cost', i.unit_cost) order by i.line_no)
        from public.stock_receipt_items i where i.receipt_id = p_receipt_id
      )
    ),
    jsonb_build_object(
      'reference', v_reference,
      'supplier_id', p_supplier_id,
      'deleted', coalesce(p_delete, false),
      'lines', v_wanted
    ),
    private.catalog_text(p_reason, 200, false)
  );
  return v_new;
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation
    or not_null_violation then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;
revoke execute on function
  private.apply_stock_in_correction(uuid, uuid, text, jsonb, boolean, text, text, boolean)
  from public, anon, authenticated;

-- ---- The Owner, directly -------------------------------------------------------------------
create function private.adjust_stock(
  p_product_id uuid,
  p_type text,
  p_qty integer,
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

create function private.correct_stock_in(
  p_receipt_id uuid,
  p_supplier_id uuid,
  p_reference text,
  p_lines jsonb,
  p_delete boolean,
  p_reason text default null,
  p_device_tag text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  return private.apply_stock_in_correction(
    p_receipt_id, p_supplier_id, p_reference, p_lines, p_delete, p_reason, p_device_tag, false
  );
end;
$$;

-- ---- Special Sales, through requests -------------------------------------------------------
create function private.is_special_sales()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_access() and coalesce(private."current_role"() = 'special_sales', false);
$$;
revoke execute on function private.is_special_sales() from public, anon, authenticated;

create function private.request_stock_adjustment(
  p_product_id uuid,
  p_type text,
  p_qty integer,
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

create function private.request_stock_in_correction(
  p_receipt_id uuid,
  p_supplier_id uuid,
  p_reference text,
  p_lines jsonb,
  p_delete boolean,
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
  v_original public.stock_receipts;
  v_row public.approval_requests;
begin
  if v_uid is null or not private.is_special_sales() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  -- Their own stock-ins only (the one they received, or its earlier corrected form).
  select * into v_original from public.stock_receipts r
  where r.id = p_receipt_id and r.branch_id = private.current_branch() and r.received_by = v_uid;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  begin
    perform private.apply_stock_in_correction(
      p_receipt_id, p_supplier_id, p_reference, p_lines, p_delete, p_reason, p_device_tag, true
    );
  exception
    when sqlstate 'P0099' then null;
  end;
  begin
    insert into public.approval_requests
      (branch_id, type, target_type, target_id, before, after, reason, requested_by)
    values (
      private.current_branch(), 'stock_in_correction', 'stock_receipt', p_receipt_id,
      jsonb_build_object(
        'supplier_id', v_original.supplier_id,
        'reference', v_original.reference,
        'lines', (
          select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.qty, 'unit_cost', i.unit_cost) order by i.line_no)
          from public.stock_receipt_items i where i.receipt_id = p_receipt_id
        )
      ),
      jsonb_build_object(
        'supplier_id', p_supplier_id,
        'reference', private.catalog_text(p_reference, 60, false),
        'delete', coalesce(p_delete, false),
        'lines', case when coalesce(p_delete, false) then '[]'::jsonb else p_lines end
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

-- ---- log_approval: name the item for every type --------------------------------------------
create or replace function private.log_approval(
  p_action text,
  p_request public.approval_requests,
  p_device_tag text
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  select p_request.branch_id, p_action, (select auth.uid()),
    private.valid_device_tag(p_device_tag), 'approval', p_request.id::text,
    jsonb_build_object(
      'type', p_request.type,
      'label', case p_request.target_type
        when 'product' then (select pr.name from public.products pr where pr.id = p_request.target_id)
        else coalesce(
          (select 'stock-in ' || coalesce(r.reference, 'without reference') from public.stock_receipts r where r.id = p_request.target_id),
          'stock-in'
        )
      end,
      'requested_by', p_request.requested_by,
      'changes', p_request.after
    ),
    case when p_action = 'approval.request' then p_request.reason else p_request.owner_note end;
$$;

-- ---- decide_approval: every type -----------------------------------------------------------
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
        v_row.target_id, v_row.after ->> 'type', (v_row.after ->> 'qty')::integer, v_row.reason,
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
        p_device_tag, false
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

-- ---- Grants and API wrappers -------------------------------------------------------------
revoke execute on function
  private.adjust_stock(uuid, text, integer, text, text),
  private.correct_stock_in(uuid, uuid, text, jsonb, boolean, text, text),
  private.request_stock_adjustment(uuid, text, integer, text, text),
  private.request_stock_in_correction(uuid, uuid, text, jsonb, boolean, text, text)
from public, anon;
grant execute on function
  private.adjust_stock(uuid, text, integer, text, text),
  private.correct_stock_in(uuid, uuid, text, jsonb, boolean, text, text),
  private.request_stock_adjustment(uuid, text, integer, text, text),
  private.request_stock_in_correction(uuid, uuid, text, jsonb, boolean, text, text)
to authenticated;

create function public.adjust_stock(
  p_product_id uuid, p_type text, p_qty integer, p_reason text, p_device_tag text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.adjust_stock(p_product_id, p_type, p_qty, p_reason, p_device_tag); $$;

create function public.correct_stock_in(
  p_receipt_id uuid, p_supplier_id uuid, p_reference text, p_lines jsonb, p_delete boolean,
  p_reason text default null, p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.correct_stock_in(
    p_receipt_id, p_supplier_id, p_reference, p_lines, p_delete, p_reason, p_device_tag
  );
$$;

create function public.request_stock_adjustment(
  p_product_id uuid, p_type text, p_qty integer, p_reason text, p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.request_stock_adjustment(p_product_id, p_type, p_qty, p_reason, p_device_tag); $$;

create function public.request_stock_in_correction(
  p_receipt_id uuid, p_supplier_id uuid, p_reference text, p_lines jsonb, p_delete boolean,
  p_reason text, p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.request_stock_in_correction(
    p_receipt_id, p_supplier_id, p_reference, p_lines, p_delete, p_reason, p_device_tag
  );
$$;

revoke execute on function
  public.adjust_stock(uuid, text, integer, text, text),
  public.correct_stock_in(uuid, uuid, text, jsonb, boolean, text, text),
  public.request_stock_adjustment(uuid, text, integer, text, text),
  public.request_stock_in_correction(uuid, uuid, text, jsonb, boolean, text, text)
from public, anon;
grant execute on function
  public.adjust_stock(uuid, text, integer, text, text),
  public.correct_stock_in(uuid, uuid, text, jsonb, boolean, text, text),
  public.request_stock_adjustment(uuid, text, integer, text, text),
  public.request_stock_in_correction(uuid, uuid, text, jsonb, boolean, text, text)
to authenticated;
