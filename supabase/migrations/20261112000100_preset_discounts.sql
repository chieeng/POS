-- Build step 9: preset discounts (SRS POS-03, POS-14, SYS-01). The owner's decisions of Nov 1
-- and Nov 12, 2026:
--
--   Staff never type a discount. The Owner defines presets: a name, a percent or a fixed peso
--   amount per unit (per kg or L for products sold by weight or volume), and what they apply
--   to: every product, chosen categories or chosen products. Switched on or off; no dates.
--   Staff tap one preset per line; the app never adds one by itself.
--   A percent comes off the line total, rounded to the centavo (half up). A fixed amount is
--   not offered on a product priced at or below it, so a line is never given away.
--   complete_sale works the discount out again from the preset. A sale keeps the discount the
--   device gave (the customer paid it); one that differs from the preset now, or a preset
--   since switched off or changed, is flagged discount_changed for the Owner (POS-14).
--   Package deals follow in the next PR.

-- ---- Presets ----------------------------------------------------------------------------------
create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 40),
  kind text not null check (kind in ('percent', 'fixed')),
  -- percent: 0.01 to 100. fixed: pesos off each unit (each kg or L).
  value numeric(12, 2) not null check (value > 0 and (kind <> 'percent' or value <= 100)),
  applies_to text not null check (applies_to in ('all', 'categories', 'products')),
  category_ids uuid[] not null default '{}' check (cardinality(category_ids) <= 200),
  product_ids uuid[] not null default '{}' check (cardinality(product_ids) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((applies_to = 'categories') = (cardinality(category_ids) > 0)),
  check ((applies_to = 'products') = (cardinality(product_ids) > 0))
);
create unique index discounts_branch_name_key on public.discounts (branch_id, lower(name));

-- Read by everyone in the branch (staff pick from them); written only by the Owner's functions.
revoke all on table public.discounts from public, anon, authenticated, service_role;
grant select on table public.discounts to authenticated;
alter table public.discounts enable row level security;
create policy discounts_select_branch on public.discounts
  for select to authenticated
  using ((select private.has_access()) and branch_id = (select private.current_branch()));

alter publication supabase_realtime add table public.discounts;

-- A JSON list of ids, each a category or product of this branch; anything else is refused.
create function private.discount_targets(p_ids jsonb, p_kind text, p_branch text)
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_ids is null or jsonb_typeof(p_ids) = 'null' then
    return '{}';
  end if;
  if jsonb_typeof(p_ids) <> 'array'
    or exists (select 1 from jsonb_array_elements(p_ids) e where jsonb_typeof(e) <> 'string') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct (e #>> '{}')::uuid), '{}') into v_ids
  from jsonb_array_elements(p_ids) e;
  if p_kind = 'categories' and exists (
    select 1 from unnest(v_ids) i
    where not exists (select 1 from public.categories c where c.id = i and c.branch_id = p_branch)
  ) or p_kind = 'products' and exists (
    select 1 from unnest(v_ids) i
    where not exists (select 1 from public.products p where p.id = i and p.branch_id = p_branch)
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_ids;
end;
$$;
revoke execute on function private.discount_targets(jsonb, text, text)
  from public, anon, authenticated;

create function private.discount_audit(p_row public.discounts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', p_row.name, 'kind', p_row.kind, 'value', p_row.value,
    'appliesTo', p_row.applies_to, 'categoryIds', to_jsonb(p_row.category_ids),
    'productIds', to_jsonb(p_row.product_ids), 'active', p_row.active
  );
$$;
revoke execute on function private.discount_audit(public.discounts)
  from public, anon, authenticated;

-- p_fields: name, kind, value, applies_to, category_ids, product_ids. Owner only.
-- Errors: invalid_input, not_found (a category or product of no branch of the caller),
-- name_taken.
create function private.create_discount(p_fields jsonb, p_device_tag text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_row public.discounts;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object'
    or exists (
      select 1 from jsonb_object_keys(p_fields) k
      where k not in ('name', 'kind', 'value', 'applies_to', 'category_ids', 'product_ids')
    )
    or jsonb_typeof(p_fields -> 'value') is distinct from 'number'
    or (p_fields ->> 'value')::numeric <> round((p_fields ->> 'value')::numeric, 2) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into public.discounts
    (branch_id, name, kind, value, applies_to, category_ids, product_ids)
  values (
    v_branch,
    private.catalog_text(p_fields ->> 'name', 40, true),
    p_fields ->> 'kind',
    (p_fields ->> 'value')::numeric,
    p_fields ->> 'applies_to',
    case when p_fields ->> 'applies_to' = 'categories'
      then private.discount_targets(p_fields -> 'category_ids', 'categories', v_branch)
      else '{}' end,
    case when p_fields ->> 'applies_to' = 'products'
      then private.discount_targets(p_fields -> 'product_ids', 'products', v_branch)
      else '{}' end
  )
  returning * into v_row;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after)
  values (
    v_branch, 'discount.create', v_uid, private.valid_device_tag(p_device_tag), 'discount',
    v_row.id::text, private.discount_audit(v_row)
  );
  return v_row.id;
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
  when check_violation or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

-- p_changes: any of name, kind, value, applies_to, category_ids, product_ids, active.
-- Owner only. A sale already made keeps the discount it had (sale_items copies it).
create function private.update_discount(p_id uuid, p_changes jsonb, p_device_tag text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_before public.discounts;
  v_after public.discounts;
  v_applies text;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_changed_old jsonb := '{}';
  v_changed_new jsonb := '{}';
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'
    or exists (
      select 1 from jsonb_object_keys(p_changes) k
      where k not in ('name', 'kind', 'value', 'applies_to', 'category_ids', 'product_ids', 'active')
    )
    or (p_changes ? 'active' and jsonb_typeof(p_changes -> 'active') <> 'boolean')
    or (p_changes ? 'value' and (
      jsonb_typeof(p_changes -> 'value') <> 'number'
      or (p_changes ->> 'value')::numeric <> round((p_changes ->> 'value')::numeric, 2)
    )) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_before from public.discounts d
  where d.id = p_id and d.branch_id = v_branch
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_applies := coalesce(p_changes ->> 'applies_to', v_before.applies_to);

  update public.discounts d set
    name = case when p_changes ? 'name'
      then private.catalog_text(p_changes ->> 'name', 40, true) else d.name end,
    kind = coalesce(p_changes ->> 'kind', d.kind),
    value = case when p_changes ? 'value' then (p_changes ->> 'value')::numeric else d.value end,
    applies_to = v_applies,
    category_ids = case
      when v_applies <> 'categories' then '{}'
      when p_changes ? 'category_ids'
        then private.discount_targets(p_changes -> 'category_ids', 'categories', v_branch)
      else d.category_ids end,
    product_ids = case
      when v_applies <> 'products' then '{}'
      when p_changes ? 'product_ids'
        then private.discount_targets(p_changes -> 'product_ids', 'products', v_branch)
      else d.product_ids end,
    active = case when p_changes ? 'active'
      then (p_changes ->> 'active')::boolean else d.active end,
    updated_at = now()
  where d.id = p_id
  returning * into v_after;

  v_old := private.discount_audit(v_before);
  v_new := private.discount_audit(v_after);
  for v_key in select jsonb_object_keys(v_new) loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changed_old := v_changed_old || jsonb_build_object(v_key, v_old -> v_key);
      v_changed_new := v_changed_new || jsonb_build_object(v_key, v_new -> v_key);
    end if;
  end loop;

  if v_changed_new <> '{}' then
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
    values (
      v_branch, 'discount.update', v_uid, private.valid_device_tag(p_device_tag), 'discount',
      p_id::text, v_changed_old || jsonb_build_object('name', v_before.name), v_changed_new
    );
  end if;
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
  when check_violation or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

revoke execute on function
  private.create_discount(jsonb, text),
  private.update_discount(uuid, jsonb, text)
from public, anon;
grant execute on function
  private.create_discount(jsonb, text),
  private.update_discount(uuid, jsonb, text)
to authenticated;

create function public.create_discount(p_fields jsonb, p_device_tag text default null)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.create_discount(p_fields, p_device_tag); $$;

create function public.update_discount(p_id uuid, p_changes jsonb, p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.update_discount(p_id, p_changes, p_device_tag); $$;

revoke execute on function
  public.create_discount(jsonb, text),
  public.update_discount(uuid, jsonb, text)
from public, anon;
grant execute on function
  public.create_discount(jsonb, text),
  public.update_discount(uuid, jsonb, text)
to authenticated;

-- ---- What a preset takes off one line ---------------------------------------------------------
-- Null when the preset does not apply to this product at this price now.
create function private.discount_amount(
  p_discount public.discounts,
  p_product public.products,
  p_qty numeric,
  p_price numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when not p_discount.active then null
    when p_discount.applies_to = 'categories'
      and not (p_product.category_id = any (p_discount.category_ids)) then null
    when p_discount.applies_to = 'products' and not (p_product.id = any (p_discount.product_ids))
      then null
    when p_discount.kind = 'fixed' and p_discount.value >= p_price then null
    when p_discount.kind = 'percent'
      then round(round(p_qty * p_price, 2) * p_discount.value / 100, 2)
    else round(p_qty * p_discount.value, 2)
  end;
$$;
revoke execute on function
  private.discount_amount(public.discounts, public.products, numeric, numeric)
  from public, anon, authenticated;

-- ---- Sales keep the preset they used --------------------------------------------------------
alter table public.sale_items
  add column discount_id uuid references public.discounts (id),
  add column discount_name text,
  add constraint sale_items_preset_check check (
    (discount_id is null) = (discount = 0) and (discount_id is null) = (discount_name is null)
    and discount <= round(qty * unit_price, 2)
  );

alter table public.sales drop constraint sales_flags_check;
alter table public.sales add constraint sales_flags_check check (
  flags <@ array[
    'price_changed', 'settings_changed', 'product_inactive', 'stock_negative',
    'duplicate_reference', 'late', 'clock_ahead', 'discount_changed'
  ]::text[]
);

-- p_sale as before; each line may add {discount_id, discount}: the preset the staff member
-- picked and what the device took off for it.
create or replace function private.complete_sale(p_sale jsonb, p_device_tag text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_id uuid;
  v_existing public.sales;
  v_sale public.sales;
  v_profile public.profiles;
  v_settings public.branches;
  v_offline boolean;
  v_round boolean;
  v_rate numeric(4, 2);
  v_made timestamptz;
  v_flags text[] := '{}';
  v_line jsonb;
  v_pay jsonb;
  v_product public.products;
  v_qty numeric;
  v_price numeric(12, 2);
  v_gross numeric(12, 2);
  v_discount public.discounts;
  v_off numeric(12, 2);
  v_expected numeric;
  v_subtotal numeric(12, 2) := 0;
  v_discount_total numeric(12, 2) := 0;
  v_goods numeric(12, 2);
  v_noncash numeric(12, 2) := 0;
  v_cash_part numeric(12, 2);
  v_cash_due numeric(12, 2) := 0;
  v_tendered numeric(12, 2);
  v_rounding numeric(4, 2) := 0;
  v_total numeric(12, 2);
  v_change numeric(12, 2) := 0;
  v_session public.drawer_sessions;
  v_stock numeric;
  v_ref text;
  v_refs text[] := '{}';
  v_account public.payment_accounts;
  v_dupes uuid[] := '{}';
  v_n integer := 0;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_sale is null or jsonb_typeof(p_sale) <> 'object' or v_tag is null
    or jsonb_typeof(p_sale -> 'lines') is distinct from 'array'
    or jsonb_typeof(p_sale -> 'payments') is distinct from 'array'
    or jsonb_array_length(p_sale -> 'lines') not between 1 and 200
    or jsonb_array_length(p_sale -> 'payments') not between 1 and 4
    or jsonb_typeof(p_sale -> 'round_cash') is distinct from 'boolean'
    or jsonb_typeof(p_sale -> 'offline') is distinct from 'boolean'
    or jsonb_typeof(p_sale -> 'total') is distinct from 'number'
    or jsonb_typeof(p_sale -> 'vat_rate') not in ('number', 'null') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_id := (p_sale ->> 'id')::uuid;

  -- POS-06: sent before (a retry after a lost answer): the first result, unchanged.
  select * into v_existing from public.sales s where s.id = v_id;
  if found then
    if v_existing.branch_id <> v_branch or v_existing.salesperson_id <> v_uid then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    return private.sale_result(v_existing);
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid;
  select * into v_settings from public.branches b where b.id = v_branch;
  v_offline := (p_sale ->> 'offline')::boolean;
  v_round := (p_sale ->> 'round_cash')::boolean;
  v_rate := (p_sale ->> 'vat_rate')::numeric(4, 2);

  -- POS-08: the receipt number names this user and this device.
  if p_sale ->> 'receipt_no' !~ ('^' || v_profile.user_code || '-[0-9]{8}-' || v_tag || '-[0-9]{1,6}$') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- When it was made, by the device's clock. A clock far ahead is not believed.
  v_made := (p_sale ->> 'made_at')::timestamptz;
  if v_made is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if v_made > now() + interval '10 minutes' then
    v_made := now();
    v_flags := v_flags || 'clock_ahead'::text;
  end if;

  -- POS-14: the device's settings are kept; that they changed since is only flagged.
  if v_round is distinct from v_settings.round_cash
    or v_rate is distinct from (case when v_settings.vat_registered then v_settings.vat_rate end) then
    v_flags := v_flags || 'settings_changed'::text;
  end if;

  -- The products, locked in one order so two sales of the same items never wait on each other.
  perform 1 from public.products p
  where p.id in (
    select (l ->> 'product_id')::uuid from jsonb_array_elements(p_sale -> 'lines') l
  )
  order by p.id
  for update;

  insert into public.sales (
    id, branch_id, receipt_no, salesperson_id, salesperson_name, device_tag, subtotal,
    total, vat_rate, vat_amount, made_offline, created_at
  )
  values (
    v_id, v_branch, p_sale ->> 'receipt_no', v_uid, v_profile.display_name, v_tag, 0.01,
    0.01, null, null, v_offline, v_made
  );

  -- Lines: the device's price, quantity and discount; the server's names, units and costs.
  for v_line in select * from jsonb_array_elements(p_sale -> 'lines') loop
    v_n := v_n + 1;
    if jsonb_typeof(v_line) <> 'object'
      or jsonb_typeof(v_line -> 'qty') is distinct from 'number'
      or jsonb_typeof(v_line -> 'unit_price') is distinct from 'number' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    select * into v_product from public.products p
    where p.id = (v_line ->> 'product_id')::uuid and p.branch_id = v_branch;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    v_qty := (v_line ->> 'qty')::numeric;
    v_price := (v_line ->> 'unit_price')::numeric;
    if v_qty <= 0 or v_qty > 100000 or v_price <> (v_line ->> 'unit_price')::numeric then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    perform private.require_qty(v_product, v_qty);
    v_gross := round(v_qty * v_price, 2);

    if not v_product.active then
      v_flags := v_flags || 'product_inactive'::text;
    end if;
    if v_price <> v_product.sell_price then
      v_flags := v_flags || 'price_changed'::text;
    end if;

    -- POS-03: a preset discount, as the device gave it. POS-14: one that no longer matches
    -- the preset is kept and flagged.
    v_discount := null;
    v_off := 0;
    if v_line ? 'discount_id' and jsonb_typeof(v_line -> 'discount_id') <> 'null' then
      if jsonb_typeof(v_line -> 'discount') is distinct from 'number' then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_off := (v_line ->> 'discount')::numeric;
      if v_off <= 0 or v_off > v_gross or v_off <> (v_line ->> 'discount')::numeric then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      select * into v_discount from public.discounts d
      where d.id = (v_line ->> 'discount_id')::uuid and d.branch_id = v_branch;
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
      v_expected := private.discount_amount(v_discount, v_product, v_qty, v_price);
      if v_expected is distinct from v_off then
        v_flags := v_flags || 'discount_changed'::text;
      end if;
    elsif v_line ? 'discount' and jsonb_typeof(v_line -> 'discount') <> 'null'
      and (v_line ->> 'discount')::numeric <> 0 then
      -- Staff never type a discount: one without a preset is refused.
      raise exception 'invalid_input' using errcode = '22023';
    end if;

    insert into public.sale_items (
      sale_id, line_no, product_id, name, sku, unit, qty, unit_price, list_price, unit_cost,
      discount, discount_id, discount_name, line_total
    )
    select
      v_id, v_n, v_product.id, v_product.name, v_product.sku, v_product.unit, v_qty, v_price,
      case when v_price <> v_product.sell_price then v_product.sell_price end,
      c.cost_price, v_off, v_discount.id, v_discount.name, v_gross - v_off
    from (select 1) one
    left join public.product_costs c on c.product_id = v_product.id;
    v_subtotal := v_subtotal + v_gross;
    v_discount_total := v_discount_total + v_off;

    -- POS-09: the item is in hand, so stock may go below zero; the sale says so.
    update public.products p set stock_qty = p.stock_qty - v_qty, updated_at = now()
    where p.id = v_product.id
    returning p.stock_qty into v_stock;
    if v_stock < 0 then
      v_flags := v_flags || 'stock_negative'::text;
    end if;
    insert into public.stock_movements
      (branch_id, product_id, type, qty_change, stock_after, unit_cost, ref_type, ref_id,
       user_id, user_name, device_tag, created_at)
    select v_branch, v_product.id, 'sale', -v_qty, v_stock, c.cost_price, 'sale', v_id::text,
      v_uid, v_profile.display_name, v_tag, now()
    from (select 1) one
    left join public.product_costs c on c.product_id = v_product.id;
  end loop;
  v_goods := v_subtotal - v_discount_total;

  -- Payments: GCash and Maya exact; cash covers the rest, rounded to the peso if the device
  -- had rounding on (exactly PHP 0.50 up).
  v_n := 0;
  for v_pay in select * from jsonb_array_elements(p_sale -> 'payments') loop
    if jsonb_typeof(v_pay) <> 'object'
      or jsonb_typeof(v_pay -> 'amount') is distinct from 'number'
      or (v_pay ->> 'amount')::numeric <= 0
      or (v_pay ->> 'amount')::numeric <> round((v_pay ->> 'amount')::numeric, 2) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if v_pay ->> 'method' in ('gcash', 'maya') then
      v_noncash := v_noncash + (v_pay ->> 'amount')::numeric;
    elsif v_pay ->> 'method' = 'cash' then
      if v_tendered is not null then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_tendered := (v_pay ->> 'amount')::numeric;
    else
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end loop;

  if v_noncash > v_goods then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_cash_part := v_goods - v_noncash;
  v_cash_due := case when v_round then round(v_cash_part, 0) else v_cash_part end;
  v_rounding := v_cash_due - v_cash_part;
  if v_cash_due > 0 then
    if v_tendered is null then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if v_tendered < v_cash_due then
      raise exception 'cash_short' using errcode = 'P0001';
    end if;
    v_change := v_tendered - v_cash_due;
  elsif v_tendered is not null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_total := v_goods + v_rounding;

  -- The device showed the same total, or something is wrong with what it sent.
  if (p_sale ->> 'total')::numeric <> v_total then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  for v_pay in select * from jsonb_array_elements(p_sale -> 'payments') loop
    v_n := v_n + 1;
    if v_pay ->> 'method' = 'cash' then
      insert into public.sale_payments (sale_id, line_no, branch_id, method, amount)
      values (v_id, v_n, v_branch, 'cash', v_cash_due);
      continue;
    end if;

    -- A reference as the customer's app shows it, without spaces, in capitals.
    v_ref := upper(regexp_replace(coalesce(v_pay ->> 'reference', ''), '\s', '', 'g'));
    if v_ref !~ '^[A-Z0-9-]{4,40}$' or v_ref = any (v_refs) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_refs := v_refs || v_ref;

    v_account := null;
    if v_pay ? 'account_id' and jsonb_typeof(v_pay -> 'account_id') <> 'null' then
      select * into v_account from public.payment_accounts a
      where a.id = (v_pay ->> 'account_id')::uuid and a.branch_id = v_branch
        and a.provider = v_pay ->> 'method';
      if not found then
        raise exception 'not_found' using errcode = 'P0002';
      end if;
    end if;

    -- POS-13: already on another sale? Refused online; offline, saved and flagged.
    select coalesce(array_agg(distinct p.sale_id), '{}') into v_dupes
    from public.sale_payments p
    where p.branch_id = v_branch and p.method = v_pay ->> 'method' and p.reference = v_ref
      and p.sale_id <> v_id;
    if cardinality(v_dupes) > 0 then
      if not v_offline then
        raise exception 'duplicate_reference' using errcode = 'P0001', detail = v_ref;
      end if;
      if not 'duplicate_reference' = any (v_flags) then
        v_flags := v_flags || 'duplicate_reference'::text;
      end if;
      update public.sales s set flags = s.flags || 'duplicate_reference'::text
      where s.id = any (v_dupes) and not 'duplicate_reference' = any (s.flags);
      insert into public.audit_logs
        (branch_id, action, actor_id, device_tag, target_type, target_id, after)
      values (
        v_branch, 'sale.duplicateReference', v_uid, v_tag, 'sale', v_id::text,
        jsonb_build_object(
          'receiptNo', p_sale ->> 'receipt_no', 'method', v_pay ->> 'method',
          'reference', v_ref, 'amount', (v_pay ->> 'amount')::numeric,
          'others', (select jsonb_agg(s.receipt_no) from public.sales s where s.id = any (v_dupes))
        )
      );
    end if;

    insert into public.sale_payments
      (sale_id, line_no, branch_id, method, amount, reference, account_id, account_label)
    values (
      v_id, v_n, v_branch, v_pay ->> 'method', (v_pay ->> 'amount')::numeric, v_ref,
      v_account.id, v_account.label
    );
  end loop;

  -- POS-14: today's open drawer, or none: the sale waits for the next one to open.
  select * into v_session from public.drawer_sessions s
  where s.branch_id = v_branch and s.status = 'open' and s.business_date = private.manila_today();
  if found and (v_made at time zone 'Asia/Manila')::date < v_session.business_date then
    v_flags := v_flags || 'late'::text;
  end if;

  update public.sales s set
    subtotal = v_subtotal,
    discount_total = v_discount_total,
    rounding = v_rounding,
    total = v_total,
    vat_rate = v_rate,
    vat_amount = case when v_rate is not null
      then round(v_goods * v_rate / (100 + v_rate), 2) end,
    change = v_change,
    session_id = v_session.id,
    flags = (select coalesce(array_agg(distinct f order by f), '{}') from unnest(v_flags) f)
  where s.id = v_id
  returning * into v_sale;

  return private.sale_result(v_sale);
exception
  when unique_violation then
    -- The same sale arriving twice at the same moment: the first one won; return it.
    select * into v_existing from public.sales s where s.id = v_id;
    if found and v_existing.salesperson_id = v_uid then
      return private.sale_result(v_existing);
    end if;
    raise exception 'receipt_taken' using errcode = '23505';
  when invalid_text_representation or numeric_value_out_of_range or check_violation
    or not_null_violation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

-- ---- The drawer report counts the discounts given ---------------------------------------------
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
