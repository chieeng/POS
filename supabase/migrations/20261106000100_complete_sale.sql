-- Build step 9, checkout on the server (SRS 5.2; POS-04, POS-06, POS-08, POS-09, POS-13,
-- POS-14): complete_sale records a sale in one transaction, from the device's outbox, online
-- or long after it was made offline. The owner's decisions of Nov 1 and Nov 4, 2026:
--
--   One call: the sale, its lines and payments, the stock taken out and its movements. The
--   drawer's expected cash follows from the cash payments (private.drawer_expected).
--   The device's id makes a second send return the first result (POS-06).
--   A sale keeps the price and settings the device used (the customer paid them); anything
--   that differs from the server now is flagged for the Owner, never refused (POS-14).
--   Cash is rounded to the peso when the device had the setting on, exactly PHP 0.50 up;
--   GCash and Maya stay exact (POS-04). Each sale keeps its VAT rate (POS-07).
--   A reused GCash/Maya reference is refused online; a sale made offline is saved and the
--   reuse flagged on both sales and in the audit log (POS-13).
--   Stock may go below zero (the item is in hand): the sale is flagged (POS-09).
--   A sale joins today's open drawer. With none open, it waits and joins the next drawer that
--   opens; one made on an earlier day is flagged "late" (POS-14). Selling never needs a drawer.
--   No audit line per sale: the sale is the record (SRS 7.1, archive plan).
--
-- Not yet: discounts and package deals (later step 9 PRs fill sale_items.discount), utang
-- (step 12), voids and corrections (step 10), the clock-in check (step 11).

-- ---- Tables ------------------------------------------------------------------------------
create table public.sales (
  -- Made on the device (POS-06): sending it again finds the same row.
  id uuid primary key,
  branch_id text not null references public.branches (id),
  -- POS-08: <user code>-<YYYYMMDD>-<device tag>-<sequence on the device>.
  receipt_no text not null check (receipt_no ~ '^[A-Z0-9]{2,6}-[0-9]{8}-[A-Z0-9]{4}-[0-9]{1,6}$'),
  -- The drawer it counts in; null while it waits for one to open.
  session_id uuid references public.drawer_sessions (id),
  salesperson_id uuid not null references public.profiles (id),
  salesperson_name text not null,
  device_tag text not null check (device_tag ~ '^[A-Z0-9]{4}$'),
  -- subtotal - discount_total + rounding = total, what the customer paid.
  subtotal numeric(12, 2) not null check (subtotal > 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  rounding numeric(4, 2) not null default 0 check (rounding between -0.5 and 0.5),
  total numeric(12, 2) not null check (total >= 0),
  -- POS-07: null when the store was not VAT registered on the device; the VAT part is of the
  -- goods (subtotal - discount_total), never of the cash rounding.
  vat_rate numeric(4, 2) check (vat_rate between 0.01 and 50),
  vat_amount numeric(12, 2),
  change numeric(12, 2) not null default 0 check (change >= 0),
  status text not null default 'completed' check (status in ('completed', 'voided', 'corrected')),
  flags text[] not null default '{}' check (
    flags <@ array[
      'price_changed', 'settings_changed', 'product_inactive', 'stock_negative',
      'duplicate_reference', 'late', 'clock_ahead'
    ]::text[]
  ),
  made_offline boolean not null default false,
  -- When it was made (the device's clock) and when the server got it.
  created_at timestamptz not null,
  synced_at timestamptz not null default now(),
  unique (branch_id, receipt_no),
  check (total = subtotal - discount_total + rounding),
  check ((vat_rate is null) = (vat_amount is null))
);
create index sales_branch_created_idx on public.sales (branch_id, created_at desc);
create index sales_salesperson_created_idx on public.sales (salesperson_id, created_at desc);
create index sales_session_idx on public.sales (session_id);
-- The sales still waiting for a drawer: few or none.
create index sales_waiting_idx on public.sales (branch_id) where session_id is null;

-- Each line copies the product as sold, so later edits never change a past sale.
create table public.sale_items (
  sale_id uuid not null references public.sales (id),
  line_no smallint not null check (line_no between 1 and 200),
  product_id uuid not null references public.products (id),
  name text not null,
  sku text not null,
  unit text not null,
  qty numeric not null check (qty > 0 and qty = round(qty, 3) and qty <= 100000),
  -- What the customer paid per unit. list_price: the server's price at the time it synced,
  -- kept only when it differs (the sale is flagged price_changed).
  unit_price numeric(12, 2) not null check (unit_price between 0.01 and 1000000),
  list_price numeric(12, 2),
  -- The weighted-average cost when it synced (INV-08); null for a product never stocked in.
  unit_cost numeric(12, 4),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  primary key (sale_id, line_no)
);

create table public.sale_payments (
  sale_id uuid not null references public.sales (id),
  line_no smallint not null check (line_no between 1 and 4),
  branch_id text not null references public.branches (id),
  method text not null check (method in ('cash', 'gcash', 'maya')),
  -- Cash: what went into the drawer (tendered - change). GCash and Maya: the exact amount.
  amount numeric(12, 2) not null check (amount > 0),
  reference text check (reference ~ '^[A-Z0-9-]{4,40}$'),
  account_id uuid references public.payment_accounts (id),
  -- The account's label as it was (POS-04).
  account_label text,
  primary key (sale_id, line_no),
  check ((method = 'cash') = (reference is null)),
  check (method <> 'cash' or account_id is null)
);
-- POS-13: is this reference already on another sale?
create index sale_payments_reference_idx on public.sale_payments (branch_id, method, reference)
  where reference is not null;

-- Written only by complete_sale (and, later, the approval functions). The Owner reads all of
-- the branch's sales; staff read only their own sales' totals. Lines (they carry the cost) and
-- payments: the Owner only, until Sales history needs more (step 10).
revoke all on table public.sales, public.sale_items, public.sale_payments
  from public, anon, authenticated, service_role;
grant select on table public.sales, public.sale_items, public.sale_payments to authenticated;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;

create policy sales_select on public.sales
  for select to authenticated
  using (
    (select private.has_access()) and branch_id = (select private.current_branch())
    and ((select private.is_owner()) or salesperson_id = (select auth.uid()))
  );
create policy sale_items_select_owner on public.sale_items
  for select to authenticated
  using (
    (select private.is_owner())
    and exists (
      select 1 from public.sales s
      where s.id = sale_id and s.branch_id = (select private.current_branch())
    )
  );
create policy sale_payments_select_owner on public.sale_payments
  for select to authenticated
  using ((select private.is_owner()) and branch_id = (select private.current_branch()));

-- ---- Expected cash now counts cash sales -----------------------------------------------------
-- Opening + cash sales + cash in - cash out. Refunds (step 10) and cash utang payments (step
-- 12) join later.
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
  from public.drawer_sessions s
  where s.id = p_session_id;
$$;

-- ---- Attaching sales to a drawer -----------------------------------------------------------
-- Every sale of the branch that waits for a drawer joins this one; a sale made on an earlier
-- day is flagged late, because its cash may already be in an earlier count (POS-14).
create function private.attach_waiting_sales(p_branch text, p_session uuid, p_date date)
returns void
language sql
set search_path = ''
as $$
  update public.sales s set
    session_id = p_session,
    flags = case
      when (s.created_at at time zone 'Asia/Manila')::date < p_date and not 'late' = any (s.flags)
        then s.flags || 'late'::text
      else s.flags
    end
  where s.branch_id = p_branch and s.session_id is null;
$$;
revoke execute on function private.attach_waiting_sales(text, uuid, date)
  from public, anon, authenticated;

-- open_drawer as in 20261101000300_drawer_last_count.sql, plus: the sales that waited for a
-- drawer join the new one.
create or replace function private.open_drawer(
  p_opening_cash numeric,
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
  v_branch text := private.current_branch();
  v_tag text := private.valid_device_tag(p_device_tag);
  v_today date := private.manila_today();
  v_reason text := private.catalog_text(p_reason, 200, false);
  v_name text;
  v_existing public.drawer_sessions;
  v_stale public.drawer_sessions;
  v_expected numeric(12, 2);
  v_prefill numeric(12, 2);
  v_session uuid;
begin
  if v_uid is null or not private.has_access() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash > 9999999.99
    or p_opening_cash <> round(p_opening_cash, 2) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- One at a time per store, so two phones opening together cannot both pass the checks.
  perform 1 from public.branches b where b.id = v_branch for update;

  select * into v_existing from public.drawer_sessions s
  where s.branch_id = v_branch and s.business_date = v_today;
  if found then
    if v_existing.status = 'open' then
      raise exception 'already_open' using errcode = 'P0001';
    end if;
    raise exception 'already_closed' using errcode = 'P0001';
  end if;

  select pr.display_name into v_name from public.profiles pr where pr.id = v_uid;

  -- A drawer left open on an earlier day: closed as not counted, flagged for the Owner.
  for v_stale in
    select * from public.drawer_sessions s
    where s.branch_id = v_branch and s.status = 'open' and s.business_date < v_today
    for update
  loop
    v_expected := private.drawer_expected(v_stale.id);
    update public.drawer_sessions s set
      status = 'not_counted', closed_at = now(), expected_cash = v_expected,
      closed_by = v_uid, closed_by_name = v_name, close_device_tag = v_tag
    where s.id = v_stale.id;
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, after)
    values (
      v_branch, 'drawer.notCounted', v_uid, v_tag, 'drawer', v_stale.id::text,
      jsonb_build_object('businessDate', v_stale.business_date, 'expected', v_expected)
    );
  end loop;

  v_prefill := (private.drawer_last_count(v_branch, v_today) ->> 'amount')::numeric(12, 2);

  if v_prefill is not null and p_opening_cash <> v_prefill and v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  insert into public.drawer_sessions (
    branch_id, business_date, opened_by, opened_by_name, open_device_tag, opening_cash,
    prefill_cash, prefill_difference, opening_reason
  )
  values (
    v_branch, v_today, v_uid, v_name, v_tag, p_opening_cash,
    v_prefill, p_opening_cash - v_prefill,
    case when v_prefill is not null and p_opening_cash <> v_prefill then v_reason end
  )
  returning id into v_session;

  perform private.attach_waiting_sales(v_branch, v_session, v_today);

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after, reason)
  values (
    v_branch, 'drawer.open', v_uid, v_tag, 'drawer', v_session::text,
    jsonb_build_object(
      'businessDate', v_today, 'opening', p_opening_cash, 'lastCount', v_prefill,
      'difference', p_opening_cash - v_prefill
    ),
    case when v_prefill is not null and p_opening_cash <> v_prefill then v_reason end
  );
  return v_session;
exception
  -- Another phone opened today's drawer in the same moment.
  when unique_violation then
    raise exception 'already_open' using errcode = 'P0001';
end;
$$;

-- ---- complete_sale -------------------------------------------------------------------------
-- What an already-recorded sale returns, the first time and every time after.
create function private.sale_result(p_sale public.sales)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_sale.id, 'receiptNo', p_sale.receipt_no, 'subtotal', p_sale.subtotal,
    'rounding', p_sale.rounding, 'total', p_sale.total, 'change', p_sale.change,
    'vatRate', p_sale.vat_rate, 'vatAmount', p_sale.vat_amount, 'flags', to_jsonb(p_sale.flags),
    'attached', p_sale.session_id is not null
  );
$$;
revoke execute on function private.sale_result(public.sales) from public, anon, authenticated;

-- p_sale: {
--   id, receipt_no, made_at (ISO time on the device), offline (made or first sent offline),
--   round_cash, vat_rate (null when not VAT registered), total (what the device showed),
--   lines: [{product_id, qty, unit_price}],
--   payments: [{method: cash, amount: tendered} | {method: gcash|maya, amount, reference,
--               account_id?}]
-- }
-- Errors: invalid_input, not_found (a product or account of no branch of the caller),
-- cash_short (less cash than due), duplicate_reference (online only), receipt_taken.
create function private.complete_sale(p_sale jsonb, p_device_tag text)
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
  v_subtotal numeric(12, 2) := 0;
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

  -- Lines: the device's price and quantity, the server's names, units and costs.
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

    if not v_product.active then
      v_flags := v_flags || 'product_inactive'::text;
    end if;
    if v_price <> v_product.sell_price then
      v_flags := v_flags || 'price_changed'::text;
    end if;

    insert into public.sale_items (
      sale_id, line_no, product_id, name, sku, unit, qty, unit_price, list_price, unit_cost,
      line_total
    )
    select
      v_id, v_n, v_product.id, v_product.name, v_product.sku, v_product.unit, v_qty, v_price,
      case when v_price <> v_product.sell_price then v_product.sell_price end,
      c.cost_price, round(v_qty * v_price, 2)
    from (select 1) one
    left join public.product_costs c on c.product_id = v_product.id;
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);

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

  if v_noncash > v_subtotal then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_cash_part := v_subtotal - v_noncash;
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
  v_total := v_subtotal + v_rounding;

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
    rounding = v_rounding,
    total = v_total,
    vat_rate = v_rate,
    vat_amount = case when v_rate is not null
      then round(v_subtotal * v_rate / (100 + v_rate), 2) end,
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

revoke execute on function private.complete_sale(jsonb, text) from public, anon;
grant execute on function private.complete_sale(jsonb, text) to authenticated;

create function public.complete_sale(p_sale jsonb, p_device_tag text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.complete_sale(p_sale, p_device_tag); $$;

revoke execute on function public.complete_sale(jsonb, text) from public, anon;
grant execute on function public.complete_sale(jsonb, text) to authenticated;
