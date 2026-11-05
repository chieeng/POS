-- Payment settings for checkout (SYS-01, POS-03, POS-04, POS-07; the owner's decisions of
-- Nov 1, 2026), all set by the Owner:
--   VAT registered (off by default) and the VAT rate (12% by default). Prices stay
--   VAT-inclusive; the slip shows the VAT part when this is on.
--   "Round cash totals to the nearest peso" (on by default): the drawer is counted in whole
--   pesos. GCash and Maya stay exact.
--   Payment accounts: the store's GCash and Maya numbers, with a label. Deactivated, never
--   deleted, so every sale's copy of the label keeps pointing at a real account.
-- Staff never type a discount any more (POS-03), so the sales discount limit goes. No sale
-- exists yet, so nothing depends on it; old audit entries keep their before/after values.

-- ---- Branch settings ---------------------------------------------------------------------
alter table public.branches
  drop column sales_discount_limit,
  add column vat_registered boolean not null default false,
  add column vat_rate numeric(4, 2) not null default 12
    check (vat_rate between 0.01 and 50),
  add column round_cash boolean not null default true;

-- Same checks and audit as before (20261018000200_attendance_settings.sql); the list of fields
-- changes: the discount limit goes, VAT and cash rounding join. CREATE OR REPLACE keeps the
-- grants.
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
    'vat_registered', 'vat_rate', 'round_cash',
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
    -- The new yes/no settings take true or false only, never "yes" or 1.
    or exists (
      select 1 from unnest(array['vat_registered', 'round_cash']) k
      where p_changes ? k and jsonb_typeof(p_changes -> k) <> 'boolean'
    )
    -- The rate is a number with at most 2 decimals: 12 or 12.5, never "12%".
    or (p_changes ? 'vat_rate' and (
      jsonb_typeof(p_changes -> 'vat_rate') <> 'number'
      or (p_changes ->> 'vat_rate')::numeric <> round((p_changes ->> 'vat_rate')::numeric, 2)
    )) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select to_jsonb(b) into v_before from public.branches b where b.id = v_branch for update;

  -- Text fields are trimmed, and empty text clears an optional field. A wrong type (text for a
  -- number) fails the cast; a value out of range fails the table's constraints.
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
    idle_lock_minutes = case when p_changes ? 'idle_lock_minutes'
      then (p_changes ->> 'idle_lock_minutes')::integer else b.idle_lock_minutes end,
    store_lat = case when p_changes ? 'store_lat'
      then (p_changes ->> 'store_lat')::double precision else b.store_lat end,
    store_lng = case when p_changes ? 'store_lng'
      then (p_changes ->> 'store_lng')::double precision else b.store_lng end,
    radius_m = case when p_changes ? 'radius_m'
      then (p_changes ->> 'radius_m')::integer else b.radius_m end,
    -- Whole minutes only: "06:00" or "06:00:00", never seconds that would shift lateness.
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

-- ---- Payment accounts (POS-04) -------------------------------------------------------------
-- Read by everyone in the branch: staff pick which account the customer paid. The label is
-- unique per branch whatever its case, so staff never see two "Main GCash"; a deactivated one
-- still counts (reactivate it instead). The number is what staff show the customer: digits,
-- with spaces, dashes or a leading + allowed, as people write phone numbers.
create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  provider text not null check (provider in ('gcash', 'maya')),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 40),
  number text not null check (number ~ '^\+?[0-9][0-9 -]{3,22}[0-9]$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payment_accounts_branch_label_key
  on public.payment_accounts (branch_id, lower(label));

revoke all on table public.payment_accounts from public, anon, authenticated, service_role;
grant select on table public.payment_accounts to authenticated;
alter table public.payment_accounts enable row level security;

create policy payment_accounts_select_branch on public.payment_accounts
  for select to authenticated
  using ((select private.has_access()) and branch_id = (select private.current_branch()));

alter publication supabase_realtime add table public.payment_accounts;

-- p_fields: provider, label, number. Owner only. Returns the new account's id.
create function private.create_payment_account(p_fields jsonb, p_device_tag text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_row public.payment_accounts;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object'
    or exists (
      select 1 from jsonb_object_keys(p_fields) k where k not in ('provider', 'label', 'number')
    ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into public.payment_accounts (branch_id, provider, label, number)
  values (
    v_branch,
    p_fields ->> 'provider',
    private.catalog_text(p_fields ->> 'label', 40, true),
    btrim(p_fields ->> 'number')
  )
  returning * into v_row;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after)
  values (
    v_branch, 'payment.accountCreate', v_uid, private.valid_device_tag(p_device_tag),
    'payment_account', v_row.id::text,
    jsonb_build_object('provider', v_row.provider, 'label', v_row.label, 'number', v_row.number)
  );
  return v_row.id;
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
  when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

-- p_changes: any of label, number, active. Owner only. The provider never changes: a GCash
-- account that becomes Maya is a different account (deactivate one, add the other), so past
-- sales keep naming what was really paid.
create function private.update_payment_account(
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
  v_before public.payment_accounts;
  v_after public.payment_accounts;
  v_old jsonb := '{}';
  v_new jsonb := '{}';
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'
    or exists (
      select 1 from jsonb_object_keys(p_changes) k where k not in ('label', 'number', 'active')
    )
    or (p_changes ? 'active' and jsonb_typeof(p_changes -> 'active') <> 'boolean') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_before from public.payment_accounts a
  where a.id = p_id and a.branch_id = v_branch
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.payment_accounts a set
    label = case when p_changes ? 'label'
      then private.catalog_text(p_changes ->> 'label', 40, true) else a.label end,
    number = case when p_changes ? 'number' then btrim(p_changes ->> 'number') else a.number end,
    active = case when p_changes ? 'active'
      then (p_changes ->> 'active')::boolean else a.active end,
    updated_at = now()
  where a.id = p_id
  returning * into v_after;

  if v_after.label is distinct from v_before.label then
    v_old := v_old || jsonb_build_object('label', v_before.label);
    v_new := v_new || jsonb_build_object('label', v_after.label);
  end if;
  if v_after.number is distinct from v_before.number then
    v_old := v_old || jsonb_build_object('number', v_before.number);
    v_new := v_new || jsonb_build_object('number', v_after.number);
  end if;
  if v_after.active is distinct from v_before.active then
    v_old := v_old || jsonb_build_object('active', v_before.active);
    v_new := v_new || jsonb_build_object('active', v_after.active);
  end if;

  if v_new <> '{}' then
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
    values (
      v_branch, 'payment.accountUpdate', v_uid, private.valid_device_tag(p_device_tag),
      'payment_account', p_id::text,
      v_old || jsonb_build_object('label', v_before.label, 'provider', v_before.provider),
      v_new
    );
  end if;
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
  when check_violation or not_null_violation then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

revoke execute on function
  private.create_payment_account(jsonb, text),
  private.update_payment_account(uuid, jsonb, text)
from public, anon;
grant execute on function
  private.create_payment_account(jsonb, text),
  private.update_payment_account(uuid, jsonb, text)
to authenticated;

create function public.create_payment_account(p_fields jsonb, p_device_tag text default null)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.create_payment_account(p_fields, p_device_tag); $$;

create function public.update_payment_account(
  p_id uuid,
  p_changes jsonb,
  p_device_tag text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.update_payment_account(p_id, p_changes, p_device_tag); $$;

revoke execute on function
  public.create_payment_account(jsonb, text),
  public.update_payment_account(uuid, jsonb, text)
from public, anon;
grant execute on function
  public.create_payment_account(jsonb, text),
  public.update_payment_account(uuid, jsonb, text)
to authenticated;
