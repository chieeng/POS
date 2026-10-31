-- Audit log wording (fixes from the #46 test): stock-in corrections and approval entries carry
-- the names they need to read as plain words, and a correction applied through an approval
-- says so ("via": "approval"), as adjustments and product changes already do.

-- ---- Names for the audit log ---------------------------------------------------------------
-- A stock-in's lines with each product's name and unit: [{product_id, name, unit, qty, unit_cost}].
create function private.receipt_lines_named(p_receipt_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'product_id', i.product_id, 'name', p.name, 'unit', p.unit, 'qty', i.qty,
      'unit_cost', i.unit_cost
    ) order by i.line_no
  ), '[]')
  from public.stock_receipt_items i join public.products p on p.id = i.product_id
  where i.receipt_id = p_receipt_id;
$$;
revoke execute on function private.receipt_lines_named(uuid) from public, anon, authenticated;

-- {id: name} for the given suppliers and categories (nulls skipped).
create function private.names_of(p_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(n.id, n.name), '{}')
  from (
    select s.id, s.name from public.suppliers s where s.id = any(p_ids)
    union all
    select c.id, c.name from public.categories c where c.id = any(p_ids)
  ) n;
$$;
revoke execute on function private.names_of(uuid[]) from public, anon, authenticated;

-- ---- apply_stock_in_correction: names in the audit row, and the approval marker ----------
-- Same checks and writes as before (20261022000300); p_approval_id is new and last, so the
-- existing callers keep working.
drop function private.apply_stock_in_correction(uuid, uuid, text, jsonb, boolean, text, text, boolean);
create function private.apply_stock_in_correction(
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
revoke execute on function
  private.apply_stock_in_correction(uuid, uuid, text, jsonb, boolean, text, text, boolean, uuid)
  from public, anon, authenticated;

-- ---- log_approval: what the request asks, with the names to say it -------------------------
-- after: type, label, requested_by, changes (the request's after), and for plain wording:
-- before (the request's before), unit (an adjustment's product unit), products ({id: {name,
-- unit}} of a stock-in's lines) and names ({id: name} of suppliers and categories).
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
      'changes', p_request.after,
      'before', p_request.before,
      'names', private.names_of(array[
        (p_request.before ->> 'supplier_id')::uuid, (p_request.after ->> 'supplier_id')::uuid,
        (p_request.before ->> 'category_id')::uuid, (p_request.after ->> 'category_id')::uuid
      ])
    )
    || case p_request.target_type
      when 'product' then jsonb_build_object(
        'unit', (select pr.unit from public.products pr where pr.id = p_request.target_id)
      )
      else jsonb_build_object('products', (
        select coalesce(jsonb_object_agg(l ->> 'product_id', jsonb_build_object('name', l -> 'name', 'unit', l -> 'unit')), '{}')
        from jsonb_array_elements(private.receipt_lines_named(p_request.target_id)) l
      ))
    end,
    case when p_action = 'approval.request' then p_request.reason else p_request.owner_note end;
$$;

-- ---- decide_approval: pass the approval on to a correction ----------------------------------
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
