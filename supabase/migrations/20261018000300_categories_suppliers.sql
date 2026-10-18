-- Product catalog, part 1 (SRS 3.2, 6.1): categories and suppliers.
--   Add: the Owner (with the second step) and Special Sales (PROD-03).
--   Change, rename, deactivate: the Owner only. Special Sales asks the Owner until approval
--   requests exist (build step 3).
--   Read: categories by everyone in the branch (they sell from them); suppliers by the Owner
--   and Special Sales, who do stock-in.
-- Nothing is ever deleted: a deactivated category or supplier stays on existing products and
-- history, but cannot be chosen for new ones (enforced when products arrive, part 2).

-- ---- Helper ------------------------------------------------------------------------------
-- The caller may add catalog entries: an active Owner with the second step, or Special Sales.
create function private.can_add_catalog()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_access()
    and coalesce(private."current_role"() in ('owner', 'special_sales'), false);
$$;

revoke execute on function private.can_add_catalog() from public, anon;
grant execute on function private.can_add_catalog() to authenticated;

-- ---- Tables ------------------------------------------------------------------------------
-- Names are trimmed by the functions and unique per branch whatever their case: "Snacks" and
-- "snacks" are the same category. A deactivated name still counts: reactivate it instead.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_branch_name_key on public.categories (branch_id, lower(name));

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  branch_id text not null references public.branches (id),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 120),
  contact_person text check (char_length(contact_person) between 1 and 80),
  phone text check (char_length(phone) between 1 and 40),
  address text check (char_length(address) between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_branch_name_key on public.suppliers (branch_id, lower(name));

revoke all on table public.categories, public.suppliers from public, anon, authenticated, service_role;
grant select on table public.categories, public.suppliers to authenticated;

alter table public.categories enable row level security;
alter table public.suppliers enable row level security;

create policy categories_select_branch on public.categories
  for select to authenticated
  using ((select private.has_access()) and branch_id = (select private.current_branch()));

create policy suppliers_select_branch on public.suppliers
  for select to authenticated
  using ((select private.can_add_catalog()) and branch_id = (select private.current_branch()));

alter publication supabase_realtime add table public.categories, public.suppliers;

-- ---- Shared checks -----------------------------------------------------------------------
-- Raises the app's error codes: 'invalid_input' (22023), 'name_taken' (23505),
-- 'not_found' (P0002), no access (42501).
create function private.catalog_text(p_value text, p_max integer, p_required boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p_value), '');
begin
  if v is null and p_required then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if char_length(v) > p_max then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke execute on function private.catalog_text(text, integer, boolean) from public, anon, authenticated;

-- ---- Categories --------------------------------------------------------------------------
create function private.create_category(p_name text, p_device_tag text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_row public.categories;
begin
  if v_uid is null or not private.can_add_catalog() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  insert into public.categories (branch_id, name)
  values (v_branch, private.catalog_text(p_name, 60, true))
  returning * into v_row;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after)
  values (
    v_branch, 'category.create', v_uid, private.valid_device_tag(p_device_tag), 'category',
    v_row.id::text, jsonb_build_object('name', v_row.name)
  );
  return v_row.id;
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
end;
$$;

-- p_changes: any of name, active. Owner only.
create function private.update_category(
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

-- ---- Suppliers ---------------------------------------------------------------------------
create function private.create_supplier(p_fields jsonb, p_device_tag text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_row public.suppliers;
begin
  if v_uid is null or not private.can_add_catalog() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object'
    or exists (
      select 1 from jsonb_object_keys(p_fields) k
      where k not in ('name', 'contact_person', 'phone', 'address')
    ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into public.suppliers (branch_id, name, contact_person, phone, address)
  values (
    v_branch,
    private.catalog_text(p_fields ->> 'name', 120, true),
    private.catalog_text(p_fields ->> 'contact_person', 80, false),
    private.catalog_text(p_fields ->> 'phone', 40, false),
    private.catalog_text(p_fields ->> 'address', 200, false)
  )
  returning * into v_row;

  insert into public.audit_logs
    (branch_id, action, actor_id, device_tag, target_type, target_id, after)
  values (
    v_branch, 'supplier.create', v_uid, private.valid_device_tag(p_device_tag), 'supplier',
    v_row.id::text, jsonb_build_object('name', v_row.name)
  );
  return v_row.id;
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
end;
$$;

-- p_changes: any of name, contact_person, phone, address, active. Owner only.
create function private.update_supplier(
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
  v_keys constant text[] := array['name', 'contact_person', 'phone', 'address', 'active'];
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
    or exists (select 1 from jsonb_object_keys(p_changes) k where k <> all (v_keys))
    or (p_changes ? 'active' and jsonb_typeof(p_changes -> 'active') <> 'boolean') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select to_jsonb(s) into v_before from public.suppliers s
  where s.id = p_id and s.branch_id = v_branch
  for update;
  if v_before is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.suppliers s set
    name = case when p_changes ? 'name'
      then private.catalog_text(p_changes ->> 'name', 120, true) else s.name end,
    contact_person = case when p_changes ? 'contact_person'
      then private.catalog_text(p_changes ->> 'contact_person', 80, false) else s.contact_person end,
    phone = case when p_changes ? 'phone'
      then private.catalog_text(p_changes ->> 'phone', 40, false) else s.phone end,
    address = case when p_changes ? 'address'
      then private.catalog_text(p_changes ->> 'address', 200, false) else s.address end,
    active = case when p_changes ? 'active'
      then (p_changes ->> 'active')::boolean else s.active end,
    updated_at = now()
  where s.id = p_id
  returning to_jsonb(s) into v_after;

  foreach v_key in array v_keys loop
    if (v_before -> v_key) is distinct from (v_after -> v_key) then
      v_old := v_old || jsonb_build_object(v_key, v_before -> v_key);
      v_new := v_new || jsonb_build_object(v_key, v_after -> v_key);
    end if;
  end loop;

  if v_new <> '{}' then
    insert into public.audit_logs
      (branch_id, action, actor_id, device_tag, target_type, target_id, before, after)
    values (
      v_branch, 'supplier.update', v_uid, private.valid_device_tag(p_device_tag), 'supplier',
      p_id::text, v_old || jsonb_build_object('label', v_before ->> 'name'), v_new
    );
  end if;
exception
  when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
end;
$$;

-- ---- Grants and API wrappers -------------------------------------------------------------
-- As for record_sign_in: the privileged part lives in `private`, which the API does not
-- expose; the public names are SECURITY INVOKER functions that hand over to it.
revoke execute on function
  private.create_category(text, text),
  private.update_category(uuid, jsonb, text),
  private.create_supplier(jsonb, text),
  private.update_supplier(uuid, jsonb, text)
from public, anon;
grant execute on function
  private.create_category(text, text),
  private.update_category(uuid, jsonb, text),
  private.create_supplier(jsonb, text),
  private.update_supplier(uuid, jsonb, text)
to authenticated;

create function public.create_category(p_name text, p_device_tag text default null)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.create_category(p_name, p_device_tag); $$;

create function public.update_category(p_id uuid, p_changes jsonb, p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.update_category(p_id, p_changes, p_device_tag); $$;

create function public.create_supplier(p_fields jsonb, p_device_tag text default null)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.create_supplier(p_fields, p_device_tag); $$;

create function public.update_supplier(p_id uuid, p_changes jsonb, p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.update_supplier(p_id, p_changes, p_device_tag); $$;

revoke execute on function
  public.create_category(text, text),
  public.update_category(uuid, jsonb, text),
  public.create_supplier(jsonb, text),
  public.update_supplier(uuid, jsonb, text)
from public, anon;
grant execute on function
  public.create_category(text, text),
  public.update_category(uuid, jsonb, text),
  public.create_supplier(jsonb, text),
  public.update_supplier(uuid, jsonb, text)
to authenticated;
