-- Build step 5 (SRS PROD-01, PROD-07, SEC-09): product photos.
--
--   Each photo is two JPEG files, resized in the browser: products/<product id>/<key>-200.jpg
--   (lists) and <key>-800.jpg (the product page). The key is a new random UUID for every
--   photo, so a path never changes and phones can cache it for a year.
--   The bucket is public to read (photos are not sensitive, and fixed links keep egress low).
--   The Owner and Special Sales upload; nothing shows until products.photo_key points at it.
--   Who sets it: the Owner adds, replaces and removes; Special Sales adds a photo to a product
--   without one, and asks for a replacement or removal through a product_edit request.
--   Files nothing points at any more are deleted by the app (the Owner, or the uploader for
--   their own), never one a product or a pending request still uses.

-- ---- Column ------------------------------------------------------------------------------
alter table public.products
  add column photo_key text check (photo_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- ---- Bucket ------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 1048576, array['image/jpeg']);

-- products/<product uuid>/<key uuid>-200.jpg or -800.jpg -> (product id, key), or nulls.
create function private.photo_path_parts(p_name text, out product_id uuid, out photo_key text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_match text[];
begin
  v_match := regexp_match(
    p_name,
    '^products/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(200|800)\.jpg$'
  );
  if v_match is not null then
    product_id := v_match[1]::uuid;
    photo_key := v_match[2];
  end if;
end;
$$;
revoke execute on function private.photo_path_parts(text) from public, anon, authenticated;

-- A well-formed path of one of the caller's branch's products, for an active user.
create function private.photo_in_branch(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_access() and exists (
    select 1 from public.products p
    where p.id = (private.photo_path_parts(p_name)).product_id
      and p.branch_id = private.current_branch()
  );
$$;

-- Upload: the Owner or Special Sales.
create function private.can_upload_photo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_add_catalog() and private.photo_in_branch(p_name);
$$;

-- Delete: the Owner any photo file, Special Sales the ones they uploaded; never a file that a
-- product shows or a pending request asks for.
create function private.can_delete_photo(p_name text, p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with parts as (select * from private.photo_path_parts(p_name))
  select (private.is_owner() or (private.is_special_sales() and p_owner_id = (select auth.uid())::text))
    and private.photo_in_branch(p_name)
    and not exists (
      select 1 from parts join public.products p on p.id = parts.product_id
      where p.photo_key = parts.photo_key
    )
    and not exists (
      select 1 from parts join public.approval_requests r on r.target_id = parts.product_id
      where r.status = 'pending' and r.after ->> 'photo_key' = parts.photo_key
    );
$$;

revoke execute on function
  private.photo_in_branch(text), private.can_upload_photo(text), private.can_delete_photo(text, text)
from public, anon;
grant execute on function
  private.photo_in_branch(text), private.can_upload_photo(text), private.can_delete_photo(text, text)
to authenticated;

-- Reading through the API (the Storage API needs it to delete); the public link needs none.
create policy product_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and private.photo_in_branch(name));
create policy product_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and private.can_upload_photo(name));
create policy product_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and private.can_delete_photo(name, owner_id));
-- No update policy: a photo is replaced by a new key, never overwritten.

-- Both files of a photo are uploaded.
create function private.photo_files_exist(p_product_id uuid, p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select count(*) = 2 from storage.objects o
  where o.bucket_id = 'product-images'
    and o.name in (
      'products/' || p_product_id || '/' || p_key || '-200.jpg',
      'products/' || p_product_id || '/' || p_key || '-800.jpg'
    );
$$;
revoke execute on function private.photo_files_exist(uuid, text) from public, anon, authenticated;

-- ---- apply_product_change: the photo is one more field -------------------------------------
-- Same function as in 20261022000200_stock_in.sql, with photo_key added: a new key needs both
-- files uploaded; null removes the photo.
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
      then (p_changes ->> 'reorder_level')::integer else p.reorder_level end,
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

-- ---- set_product_photo -------------------------------------------------------------------
-- The Owner sets, replaces or (with null) removes a photo. Special Sales sets the first photo
-- of a product without one; anything else from them is a request.
create function private.set_product_photo(
  p_product_id uuid,
  p_photo_key text,
  p_device_tag text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.can_add_catalog() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if not private.is_owner() and (
    p_photo_key is null
    or exists (
      select 1 from public.products p
      where p.id = p_product_id and p.branch_id = private.current_branch() and p.photo_key is not null
    )
  ) then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  perform private.apply_product_change(
    p_product_id, jsonb_build_object('photo_key', p_photo_key),
    'owner_edit', p_device_tag, null, false
  );
end;
$$;

-- ---- export_products: the Owner's CSV, logged ----------------------------------------------
-- The file is built in the browser from what the Owner can already read; this only records it.
create function private.record_product_export(p_rows integer, p_device_tag text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_owner() then
    raise exception 'This account has no access.' using errcode = '42501';
  end if;
  if p_rows is null or p_rows < 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  insert into public.audit_logs (branch_id, action, actor_id, device_tag, target_type, target_id, after)
  values (
    private.current_branch(), 'products.export', (select auth.uid()),
    private.valid_device_tag(p_device_tag), 'branch', private.current_branch(),
    jsonb_build_object('rows', p_rows)
  );
end;
$$;

revoke execute on function
  private.set_product_photo(uuid, text, text),
  private.record_product_export(integer, text)
from public, anon;
grant execute on function
  private.set_product_photo(uuid, text, text),
  private.record_product_export(integer, text)
to authenticated;

create function public.set_product_photo(p_product_id uuid, p_photo_key text, p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.set_product_photo(p_product_id, p_photo_key, p_device_tag); $$;

create function public.record_product_export(p_rows integer, p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.record_product_export(p_rows, p_device_tag); $$;

revoke execute on function
  public.set_product_photo(uuid, text, text),
  public.record_product_export(integer, text)
from public, anon;
grant execute on function
  public.set_product_photo(uuid, text, text),
  public.record_product_export(integer, text)
to authenticated;
