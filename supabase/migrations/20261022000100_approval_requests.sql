-- Owner approval requests (SRS 3.9, APPR-01..05), first request type: a product edit or
-- deactivation by Special Sales (PROD-04). Later build steps add their own types (stock
-- adjustments, voids, returns, discounts, credit) to the same table and functions.
--
--   Special Sales requests a change with a reason; nothing changes until the Owner decides.
--   The requester may withdraw it while it is pending. At most one pending request per
--   product per requester.
--   The Owner approves it exactly as requested, or rejects it, with an optional note.
--   A request is outdated when the product changed after it was made (any requested field
--   differs from the snapshot taken then): it cannot be approved, only rejected, and the
--   requester makes a new one.
--   Everything is audit-logged. An approved price goes into price_changes as 'approval'.

-- ---- One product change, for the Owner's edit and for approved requests --------------------
-- The body of update_product (20261018000400_products.sql), moved here unchanged except for
-- three parameters: the price_changes source, an audit reason, and a dry run. A dry run makes
-- every check and the update, then raises P0099 with {"before", "after"} (the fields that
-- would change) in DETAIL; the caller catches it, so the update is rolled back. That way a
-- request can only hold a change the Owner's edit would accept.
create function private.apply_product_change(
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
      v_old || jsonb_build_object('label', v_before ->> 'name'), v_new, p_reason
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

revoke execute on function private.apply_product_change(uuid, jsonb, text, text, text, boolean)
  from public, anon, authenticated;

-- The Owner's direct edit (PROD-04) keeps its name, arguments and behaviour.
create or replace function private.update_product(
  p_id uuid,
  p_changes jsonb,
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
  perform private.apply_product_change(p_id, p_changes, 'owner_edit', p_device_tag, null, false);
end;
$$;

-- ---- approval_requests -------------------------------------------------------------------
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  type text not null check (type in ('product_edit')),
  target_type text not null check (target_type in ('product')),
  target_id uuid not null,
  -- The requested fields as they were when the request was made, and as requested.
  before jsonb not null check (jsonb_typeof(before) = 'object'),
  after jsonb not null check (jsonb_typeof(after) = 'object' and after <> '{}'),
  reason text not null check (reason = btrim(reason) and char_length(reason) between 1 and 200),
  requested_by uuid not null references public.profiles (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  -- The Owner who approved or rejected, or the requester who withdrew.
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  owner_note text check (char_length(owner_note) between 1 and 200),
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'pending') = (decided_by is null))
);

create unique index approval_requests_one_pending
  on public.approval_requests (target_id, requested_by) where status = 'pending';
create index approval_requests_status_idx
  on public.approval_requests (branch_id, status, created_at desc);
create index approval_requests_requester_idx
  on public.approval_requests (requested_by, created_at desc);

revoke all on table public.approval_requests from public, anon, authenticated, service_role;
grant select on table public.approval_requests to authenticated;
alter table public.approval_requests enable row level security;

-- APPR-03: the Owner sees every request of the branch. APPR-05: a requester sees their own.
create policy approval_requests_select_owner on public.approval_requests
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));
create policy approval_requests_select_own on public.approval_requests
  for select to authenticated
  using ((select private.has_access()) and requested_by = (select auth.uid()));

-- The Owner's pending count and the requester's status update without a reload.
alter publication supabase_realtime add table public.approval_requests;

-- ---- Audit helper ------------------------------------------------------------------------
create function private.log_approval(
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
      'label', (select pr.name from public.products pr where pr.id = p_request.target_id),
      'requested_by', p_request.requested_by,
      'changes', p_request.after
    ),
    case when p_action = 'approval.request' then p_request.reason else p_request.owner_note end;
$$;

revoke execute on function private.log_approval(text, public.approval_requests, text)
  from public, anon, authenticated;

-- ---- request_product_change: Special Sales ----------------------------------------------
create function private.request_product_change(
  p_product_id uuid,
  p_changes jsonb,
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
  v_detail text;
  v_diff jsonb;
  v_reason text;
  v_row public.approval_requests;
begin
  -- The Owner edits directly; Sales do not edit products (SRS 6.1).
  if v_uid is null or not private.has_access()
    or private."current_role"() is distinct from 'special_sales' then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  v_reason := private.catalog_text(p_reason, 200, true);

  -- Try the change the way the Owner's edit would make it, then undo it.
  begin
    perform private.apply_product_change(p_product_id, p_changes, 'approval', p_device_tag, null, true);
  exception
    when sqlstate 'P0099' then
      get stacked diagnostics v_detail = pg_exception_detail;
  end;
  v_diff := v_detail::jsonb;
  if v_diff -> 'after' = '{}' then
    raise exception 'no_change' using errcode = '22023';
  end if;

  begin
    insert into public.approval_requests
      (branch_id, type, target_type, target_id, before, after, reason, requested_by)
    values (
      private.current_branch(), 'product_edit', 'product', p_product_id,
      v_diff -> 'before', v_diff -> 'after', v_reason, v_uid
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

-- ---- withdraw_request: the requester, while pending ---------------------------------------
create function private.withdraw_request(p_id uuid, p_device_tag text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.approval_requests;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  select * into v_row from public.approval_requests r
  where r.id = p_id and r.requested_by = v_uid
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'request_closed' using errcode = '22023';
  end if;

  update public.approval_requests r
  set status = 'withdrawn', decided_by = v_uid, decided_at = now()
  where r.id = p_id
  returning * into v_row;
  perform private.log_approval('approval.withdraw', v_row, p_device_tag);
end;
$$;

-- ---- decide_approval: the Owner approves or rejects (APPR-04) ------------------------------
create function private.decide_approval(
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
  private.request_product_change(uuid, jsonb, text, text),
  private.withdraw_request(uuid, text),
  private.decide_approval(uuid, boolean, text, text)
from public, anon;
grant execute on function
  private.request_product_change(uuid, jsonb, text, text),
  private.withdraw_request(uuid, text),
  private.decide_approval(uuid, boolean, text, text)
to authenticated;

create function public.request_product_change(
  p_product_id uuid,
  p_changes jsonb,
  p_reason text,
  p_device_tag text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.request_product_change(p_product_id, p_changes, p_reason, p_device_tag); $$;

create function public.withdraw_request(p_id uuid, p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.withdraw_request(p_id, p_device_tag); $$;

create function public.decide_approval(
  p_id uuid,
  p_approve boolean,
  p_note text default null,
  p_device_tag text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.decide_approval(p_id, p_approve, p_note, p_device_tag); $$;

revoke execute on function
  public.request_product_change(uuid, jsonb, text, text),
  public.withdraw_request(uuid, text),
  public.decide_approval(uuid, boolean, text, text)
from public, anon;
grant execute on function
  public.request_product_change(uuid, jsonb, text, text),
  public.withdraw_request(uuid, text),
  public.decide_approval(uuid, boolean, text, text)
to authenticated;
