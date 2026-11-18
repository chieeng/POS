-- Build step 10, PR 2: voiding a sale (SRS POS-10, APPR-01..05, SYS-03; the owner's decisions of
-- Nov 13, 2026).
--
--   A completed sale can be voided only while its drawer is still open; after that it is a
--   return (next PR). A sale still waiting for a drawer (POS-14) has none open yet, so it can
--   be voided once one opens.
--   Staff (Special Sales, Sales) send a void request for their own sale with a reason; the
--   Owner voids directly, also with a reason, or approves the request.
--   A void restores each line's stock (a 'void' stock movement) and marks the sale 'voided'.
--   Its cash leaves the drawer's expected cash (drawer_expected counts completed sales only).
--   A GCash or Maya part is sent back by the Owner outside the app; the void records that
--   refund's reference, which the Owner types when voiding or approving.
--   Every void is audit-logged ('sale.void') with its reason.

-- ---- The sale remembers its void ---------------------------------------------------------------
alter table public.sales
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles (id),
  add column voided_by_name text,
  add column void_reason text check (char_length(void_reason) between 1 and 200),
  add column void_refund_reference text check (void_refund_reference ~ '^[A-Z0-9-]{4,40}$'),
  add column void_request_id uuid references public.approval_requests (id),
  add constraint sales_void_complete check ((status = 'voided') = (voided_at is not null));

-- ---- Approval requests: the new type ---------------------------------------------------------
alter table public.approval_requests
  drop constraint approval_requests_type_check,
  add constraint approval_requests_type_check
    check (type in ('product_edit', 'stock_adjustment', 'stock_in_correction', 'sale_void')),
  drop constraint approval_requests_target_type_check,
  add constraint approval_requests_target_type_check
    check (target_type in ('product', 'stock_receipt', 'sale'));

-- ---- The audit line of a request names the sale by its receipt -------------------------------
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
        when 'sale' then coalesce(
          (select 'sale ' || s.receipt_no from public.sales s where s.id = p_request.target_id),
          'sale'
        )
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
      when 'sale' then '{}'::jsonb
      else jsonb_build_object('products', (
        select coalesce(jsonb_object_agg(l ->> 'product_id', jsonb_build_object('name', l -> 'name', 'unit', l -> 'unit')), '{}')
        from jsonb_array_elements(private.receipt_lines_named(p_request.target_id)) l
      ))
    end,
    case when p_action = 'approval.request' then p_request.reason else p_request.owner_note end;
$$;

-- ---- Can this sale be voided now? ------------------------------------------------------------
-- Errors: sale_not_completed (already voided or corrected), drawer_waiting (no drawer yet),
-- drawer_closed (its drawer was counted or closed: make a return instead).
create function private.check_voidable(p_sale public.sales)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_sale.status <> 'completed' then
    raise exception 'sale_not_completed' using errcode = '22023';
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

-- What the void gives back: cash from the drawer, and GCash/Maya sent back by the Owner.
create function private.void_amounts(p_sale_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'cash', coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
    'ewallet', coalesce(sum(p.amount) filter (where p.method <> 'cash'), 0)
  )
  from public.sale_payments p where p.sale_id = p_sale_id;
$$;

-- ---- Applying a void (the Owner's own, or an approved request) --------------------------------
-- Errors: not_found, the check_voidable errors, refund_reference_required (part was paid by
-- GCash or Maya and no reference was given), invalid_input.
create function private.apply_void(
  p_sale_id uuid,
  p_reason text,
  p_refund_reference text,
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
  v_amounts jsonb;
  v_line record;
  v_stock numeric;
begin
  select * into v_sale from public.sales s
  where s.id = p_sale_id and s.branch_id = private.current_branch()
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.check_voidable(v_sale);

  v_amounts := private.void_amounts(v_sale.id);
  if (v_amounts ->> 'ewallet')::numeric > 0 then
    if v_ref is null then
      raise exception 'refund_reference_required' using errcode = '22023';
    end if;
    if v_ref !~ '^[A-Z0-9-]{4,40}$' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  else
    v_ref := null;
  end if;

  update public.sales s set
    status = 'voided', voided_at = now(), voided_by = v_uid, voided_by_name = v_name,
    void_reason = v_reason, void_refund_reference = v_ref, void_request_id = p_request_id
  where s.id = v_sale.id;

  -- Each line's stock comes back, at today's average cost.
  for v_line in
    select i.product_id, i.qty from public.sale_items i
    where i.sale_id = v_sale.id and i.product_id is not null
    order by i.line_no
  loop
    update public.products p set stock_qty = p.stock_qty + v_line.qty, updated_at = now()
    where p.id = v_line.product_id
    returning p.stock_qty into v_stock;
    insert into public.stock_movements
      (branch_id, product_id, type, qty_change, stock_after, unit_cost, ref_type, ref_id,
       user_id, user_name, device_tag, created_at)
    select v_sale.branch_id, v_line.product_id, 'void', v_line.qty, v_stock, c.cost_price,
      'sale', v_sale.id::text, v_uid, v_name, v_tag, now()
    from (select 1) one
    left join public.product_costs c on c.product_id = v_line.product_id;
  end loop;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_sale.branch_id, 'sale.void', v_uid, v_tag, 'sale', v_sale.id::text,
    jsonb_build_object(
      'receiptNo', v_sale.receipt_no, 'salesperson', v_sale.salesperson_name,
      'total', v_sale.total, 'cash', v_amounts -> 'cash', 'ewallet', v_amounts -> 'ewallet',
      'refundReference', v_ref, 'requestId', p_request_id
    ),
    v_reason
  );
  return v_amounts || jsonb_build_object('refundReference', v_ref);
end;
$$;

revoke execute on function private.check_voidable(public.sales) from public, anon, authenticated;
revoke execute on function private.void_amounts(uuid) from public, anon, authenticated;
revoke execute on function private.apply_void(uuid, text, text, text, uuid)
  from public, anon, authenticated;

-- ---- void_sale: the Owner, directly ------------------------------------------------------------
create function private.void_sale(
  p_sale_id uuid,
  p_reason text,
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
  return private.apply_void(p_sale_id, p_reason, p_refund_reference, p_device_tag, null);
end;
$$;

-- ---- request_sale_void: Special Sales and Sales, for their own sale --------------------------
-- Errors: not_found (not their sale), the check_voidable errors, request_pending.
create function private.request_sale_void(
  p_sale_id uuid,
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
  v_sale public.sales;
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
  perform private.check_voidable(v_sale);

  begin
    insert into public.approval_requests
      (branch_id, type, target_type, target_id, before, after, reason, requested_by)
    values (
      v_sale.branch_id, 'sale_void', 'sale', v_sale.id,
      jsonb_build_object('status', v_sale.status),
      jsonb_build_object(
        'status', 'voided', 'receiptNo', v_sale.receipt_no, 'total', v_sale.total,
        'madeAt', v_sale.created_at
      ) || private.void_amounts(v_sale.id),
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

-- ---- decide_approval: approving a void needs the refund reference when GCash/Maya was paid ----
drop function public.decide_approval(uuid, boolean, text, text);
drop function private.decide_approval(uuid, boolean, text, text);

create function private.decide_approval(
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

-- ---- sale_detail: the void, and whether one can be asked for now ------------------------------
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
    -- A pending void request on this sale: the caller's own, or anyone's for the Owner.
    'pendingVoid', (
      select jsonb_build_object('id', r.id, 'mine', r.requested_by = v_uid, 'reason', r.reason)
      from public.approval_requests r
      where r.type = 'sale_void' and r.target_id = v_sale.id and r.status = 'pending'
        and (v_owner or r.requested_by = v_uid)
      order by r.created_at
      limit 1
    ),
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

-- ---- Grants and public wrappers ------------------------------------------------------------------
revoke execute on function
  private.void_sale(uuid, text, text, text),
  private.request_sale_void(uuid, text, text),
  private.decide_approval(uuid, boolean, text, text, text)
from public, anon;
grant execute on function
  private.void_sale(uuid, text, text, text),
  private.request_sale_void(uuid, text, text),
  private.decide_approval(uuid, boolean, text, text, text)
to authenticated;

create function public.void_sale(
  p_sale_id uuid,
  p_reason text,
  p_refund_reference text default null,
  p_device_tag text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.void_sale(p_sale_id, p_reason, p_refund_reference, p_device_tag); $$;

create function public.request_sale_void(
  p_sale_id uuid,
  p_reason text,
  p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.request_sale_void(p_sale_id, p_reason, p_device_tag); $$;

create function public.decide_approval(
  p_id uuid,
  p_approve boolean,
  p_note text default null,
  p_device_tag text default null,
  p_refund_reference text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.decide_approval(p_id, p_approve, p_note, p_device_tag, p_refund_reference); $$;

revoke execute on function
  public.void_sale(uuid, text, text, text),
  public.request_sale_void(uuid, text, text),
  public.decide_approval(uuid, boolean, text, text, text)
from public, anon;
grant execute on function
  public.void_sale(uuid, text, text, text),
  public.request_sale_void(uuid, text, text),
  public.decide_approval(uuid, boolean, text, text, text)
to authenticated;
