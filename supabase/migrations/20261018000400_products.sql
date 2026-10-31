-- Product catalog, part 2 (SRS 3.2, PROD-01..05): products and their price history.
--   Add: the Owner (with the second step) and Special Sales (PROD-02, PROD-03).
--   Edit, change price, deactivate: the Owner only. Special Sales asks the Owner until
--   approval requests exist (build step 3, PROD-04).
--   Read: products by everyone in the branch; price history by the Owner and Special Sales.
-- stock_qty starts at 0 and changes only through stock functions (build step 4). Cost
-- (product_costs) comes with stock-in; photos with build step 5.

-- ---- Tables ------------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  -- Typed by staff (PROD-02), saved in capitals, so unique per branch whatever the case.
  sku text not null check (sku ~ '^[A-Z0-9-]{1,20}$'),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 120),
  category_id uuid not null references public.categories (id),
  -- The price and every quantity are per this unit; quantities are whole numbers.
  unit text not null default 'pc'
    check (unit in ('pc', 'pack', 'box', 'bottle', 'can', 'sachet', 'set', 'pair', 'roll')),
  sell_price numeric(12, 2) not null check (sell_price between 0.01 and 1000000),
  stock_qty integer not null default 0,
  reorder_level integer not null default 0 check (reorder_level between 0 and 1000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, sku)
);
create index products_branch_name_idx on public.products (branch_id, lower(name));
create index products_category_idx on public.products (category_id);

-- PROD-05: every price a product has had, written only by the functions below, in the same
-- transaction as the change. Append-only, like the audit log.
create table public.price_changes (
  id bigint generated always as identity primary key,
  branch_id text not null references public.branches (id),
  product_id uuid not null references public.products (id),
  old_price numeric(12, 2),
  new_price numeric(12, 2) not null,
  -- created: the first price; owner_edit; approval (build step 3); import (build step 5).
  source text not null check (source in ('created', 'owner_edit', 'approval', 'import')),
  changed_by uuid not null references public.profiles (id),
  -- The name as it was then, so the history reads the same for everyone who may see it.
  changed_by_name text not null,
  device_tag text check (device_tag ~ '^[A-Z0-9]{4}$'),
  created_at timestamptz not null default now(),
  check ((source = 'created') = (old_price is null))
);
create index price_changes_product_idx on public.price_changes (product_id, created_at desc);

revoke all on table public.products, public.price_changes
  from public, anon, authenticated, service_role;
grant select on table public.products, public.price_changes to authenticated;

alter table public.products enable row level security;
alter table public.price_changes enable row level security;

create policy products_select_branch on public.products
  for select to authenticated
  using ((select private.has_access()) and branch_id = (select private.current_branch()));

create policy price_changes_select_branch on public.price_changes
  for select to authenticated
  using ((select private.can_add_catalog()) and branch_id = (select private.current_branch()));

alter publication supabase_realtime add table public.products, public.price_changes;

-- ---- Shared checks -----------------------------------------------------------------------
-- An active category of the caller's branch, for a new product or a change of category.
create function private.require_active_category(p_category_id uuid, p_branch text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_active boolean;
begin
  select c.active into v_active from public.categories c
  where c.id = p_category_id and c.branch_id = p_branch;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not v_active then
    raise exception 'category_inactive' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function private.require_active_category(uuid, text) from public, anon, authenticated;

-- ---- create_product ----------------------------------------------------------------------
create function private.create_product(p_fields jsonb, p_device_tag text default null)
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
    coalesce((p_fields ->> 'reorder_level')::integer, 0)
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

-- ---- update_product ----------------------------------------------------------------------
-- p_changes: any of sku, name, category_id, unit, sell_price, reorder_level, active.
-- The Owner only (PROD-04). A new price is logged in price_changes (PROD-05).
create function private.update_product(
  p_id uuid,
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
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
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

  if v_new ? 'sell_price' then
    insert into public.price_changes
      (branch_id, product_id, old_price, new_price, source, changed_by, changed_by_name, device_tag)
    select v_branch, p_id, (v_before ->> 'sell_price')::numeric, v_after.sell_price, 'owner_edit',
      v_uid, pr.display_name, v_tag
    from public.profiles pr where pr.id = v_uid;
  end if;

  if v_new <> '{}' then
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
    values (
      v_branch, 'product.update', v_uid, v_tag, 'product', p_id::text,
      v_old || jsonb_build_object('label', v_before ->> 'name'), v_new
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

-- ---- update_category: refuse to deactivate a category that still has active products ----
create or replace function private.update_category(
  p_id uuid,
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
  v_before public.categories;
  v_after public.categories;
  v_old jsonb := '{}';
  v_new jsonb := '{}';
  v_in_use integer;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'
    or exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('name', 'active'))
    or (p_changes ? 'active' and jsonb_typeof(p_changes -> 'active') <> 'boolean') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_before from public.categories c
  where c.id = p_id and c.branch_id = v_branch
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- The Owner moves or deactivates the products first; the count tells them how many.
  if p_changes ? 'active' and not (p_changes ->> 'active')::boolean and v_before.active then
    select count(*) into v_in_use from public.products p
    where p.category_id = p_id and p.active;
    if v_in_use > 0 then
      raise exception 'category_in_use' using errcode = '23503', detail = v_in_use::text;
    end if;
  end if;

  update public.categories c set
    name = case when p_changes ? 'name'
      then private.catalog_text(p_changes ->> 'name', 60, true) else c.name end,
    active = case when p_changes ? 'active'
      then (p_changes ->> 'active')::boolean else c.active end,
    updated_at = now()
  where c.id = p_id
  returning * into v_after;

  if v_after.name is distinct from v_before.name then
    v_old := v_old || jsonb_build_object('name', v_before.name);
    v_new := v_new || jsonb_build_object('name', v_after.name);
  end if;
  if v_after.active is distinct from v_before.active then
    v_old := v_old || jsonb_build_object('active', v_before.active);
    v_new := v_new || jsonb_build_object('active', v_after.active);
  end if;

  if v_new <> '{}' then
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
    values (
      v_branch, 'category.update', v_uid, private.valid_device_tag(p_device_tag), 'category',
      p_id::text, v_old || jsonb_build_object('label', v_before.name), v_new
    );
  end if;
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
end;
$$;

-- ---- Grants and API wrappers -------------------------------------------------------------
revoke execute on function
  private.create_product(jsonb, text),
  private.update_product(uuid, jsonb, text)
from public, anon;
grant execute on function
  private.create_product(jsonb, text),
  private.update_product(uuid, jsonb, text)
to authenticated;

create function public.create_product(p_fields jsonb, p_device_tag text default null)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.create_product(p_fields, p_device_tag); $$;

create function public.update_product(p_id uuid, p_changes jsonb, p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.update_product(p_id, p_changes, p_device_tag); $$;

revoke execute on function
  public.create_product(jsonb, text),
  public.update_product(uuid, jsonb, text)
from public, anon;
grant execute on function
  public.create_product(jsonb, text),
  public.update_product(uuid, jsonb, text)
to authenticated;
