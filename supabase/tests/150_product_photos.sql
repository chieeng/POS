-- Product photos (SRS PROD-01, PROD-07, SEC-09): the bucket, who uploads and deletes, who sets
-- a product's photo, and the CSV export record (PROD-06).
begin;
select * from no_plan();
select tests.fixture();

insert into public.categories (id, branch_id, name)
values ('00000000-0000-4000-8000-0000000000c1', 'tmain', 'Snacks'),
  ('00000000-0000-4000-8000-0000000000c9', 'tother', 'Snacks');
insert into public.products (id, branch_id, sku, name, category_id, unit, sell_price)
values
  ('00000000-0000-4000-8000-0000000000a1', 'tmain', 'CK-12', 'Chips Classic', '00000000-0000-4000-8000-0000000000c1', 'pack', 45),
  ('00000000-0000-4000-8000-0000000000a2', 'tmain', 'WATER-500', 'Water 500 ml', '00000000-0000-4000-8000-0000000000c1', 'pc', 15),
  ('00000000-0000-4000-8000-0000000000a9', 'tother', 'CK-12', 'Chips Elsewhere', '00000000-0000-4000-8000-0000000000c9', 'pack', 45);

-- A photo's file path, and an upload of it (the Storage API inserts the row as the caller).
create function pg_temp.path(p_product text, p_key text, p_size text default '200') returns text
language sql as $$
  select 'products/00000000-0000-4000-8000-0000000000' || p_product || '/' || p_key || '-' || p_size || '.jpg';
$$;
create function pg_temp.upload(p_caller text, p_name text) returns text language sql as $$
  select tests.run(
    p_caller,
    format(
      'insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)',
      'product-images', p_name, (select auth.uid())
    )
  );
$$;
create function pg_temp.upload_both(p_caller text, p_product text, p_key text) returns text
language plpgsql as $$
declare
  v_uid text := tests.uid(case p_caller when 'special' then 'special' else 'owner' end)::text;
  v_a text;
  v_b text;
begin
  v_a := tests.run(p_caller, format(
    'insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)',
    'product-images', pg_temp.path(p_product, p_key, '200'), v_uid));
  v_b := tests.run(p_caller, format(
    'insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)',
    'product-images', pg_temp.path(p_product, p_key, '800'), v_uid));
  return v_a || ' / ' || v_b;
end;
$$;
create function pg_temp.remove(p_caller text, p_name text) returns text language plpgsql as $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  return tests.run(p_caller, format('delete from storage.objects where name = %L', p_name));
end;
$$;
create function pg_temp.photo(p_product text) returns text language sql as $$
  select coalesce(photo_key, 'none') from public.products
  where id = ('00000000-0000-4000-8000-0000000000' || p_product)::uuid;
$$;

-- ---- Bucket ------------------------------------------------------------------------------
select is(
  (select public::text || ' · ' || file_size_limit || ' · ' || array_to_string(allowed_mime_types, ',')
   from storage.buckets where id = 'product-images'),
  'true · 1048576 · image/jpeg',
  'one public bucket for JPEG product photos up to 1 MB'
);
select is((select count(*) from storage.buckets), 1::bigint, 'and no other bucket');

-- ---- Uploads -----------------------------------------------------------------------------
select is(
  pg_temp.upload_both('owner', 'a1', '11111111-1111-4111-8111-111111111111'),
  'ok 1 / ok 1',
  'the Owner uploads both sizes of a photo'
);
select is(
  pg_temp.upload_both('special', 'a2', '22222222-2222-4222-8222-222222222222'),
  'ok 1 / ok 1',
  'Special Sales uploads too'
);
select is(
  pg_temp.upload(caller, pg_temp.path('a1', '33333333-3333-4333-8333-333333333333')),
  case when caller = 'anon' then '42501' else '42501' end,
  caller || ' cannot upload'
)
from unnest(tests.no_access() || array['sales', 'other_owner']) as caller;
select is(
  pg_temp.upload('owner', 'products/00000000-0000-4000-8000-0000000000a1/photo.png'),
  '42501',
  'only a well-formed path'
);
select is(
  pg_temp.upload('owner', pg_temp.path('a9', '33333333-3333-4333-8333-333333333333')),
  '42501',
  'only for a product of their branch'
);
select is(
  tests.run('owner', format(
    'update storage.objects set name = %L where name = %L',
    pg_temp.path('a1', '44444444-4444-4444-8444-444444444444'),
    pg_temp.path('a1', '11111111-1111-4111-8111-111111111111'))),
  'ok 0',
  'files are never renamed or overwritten'
);

-- ---- Setting the photo -------------------------------------------------------------------
select is(
  tests.message('owner', format('select public.set_product_photo(%L, %L)',
    '00000000-0000-4000-8000-0000000000a1', '55555555-5555-4555-8555-555555555555')),
  'photo_missing',
  'a photo whose files were not uploaded is refused'
);
select is(
  tests.message('owner', format('select public.set_product_photo(%L, %L)',
    '00000000-0000-4000-8000-0000000000a1', 'not-a-key')),
  'photo_missing',
  'so is a malformed key'
);
select is(
  tests.message('owner', format('select public.set_product_photo(%L, %L)',
    '00000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111')),
  'ok',
  'the Owner sets a photo'
);
select is(pg_temp.photo('a1'), '11111111-1111-4111-8111-111111111111', 'the product shows it');
select is(
  (select (after ->> 'photo_key') || ' · ' || (before ->> 'label') from public.audit_logs
   where action = 'product.update' and after ? 'photo_key'),
  '11111111-1111-4111-8111-111111111111 · Chips Classic',
  'and it is in the audit log'
);
select is(
  tests.message('special', format('select public.set_product_photo(%L, %L)',
    '00000000-0000-4000-8000-0000000000a2', '22222222-2222-4222-8222-222222222222')),
  'ok',
  'Special Sales adds the first photo of a product without one'
);
select is(
  pg_temp.upload_both('special', 'a2', '66666666-6666-4666-8666-666666666666'),
  'ok 1 / ok 1',
  'Special Sales uploads a replacement'
);
select is(
  tests.message('special', format('select public.set_product_photo(%L, %L)',
    '00000000-0000-4000-8000-0000000000a2', '66666666-6666-4666-8666-666666666666')),
  'This account has no access.',
  'but cannot replace a photo directly'
);
select is(
  tests.message('special', format('select public.set_product_photo(%L, null)',
    '00000000-0000-4000-8000-0000000000a2')),
  'This account has no access.',
  'or remove one'
);
select is(
  tests.message('sales', format('select public.set_product_photo(%L, %L)',
    '00000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111')),
  'This account has no access.',
  'Sales cannot set photos'
);
select is(
  tests.run('owner', format('update public.products set photo_key = null where id = %L',
    '00000000-0000-4000-8000-0000000000a1')),
  '42501',
  'no direct writes to photo_key'
);

-- ---- A replacement through a request ----------------------------------------------------
select is(
  tests.message('special', format('select public.request_product_change(%L, %L, %L)',
    '00000000-0000-4000-8000-0000000000a2', '{"photo_key": "66666666-6666-4666-8666-666666666666"}', 'Better photo')),
  'ok',
  'Special Sales asks for the replacement'
);
select is(
  (select (before ->> 'photo_key') || ' → ' || (after ->> 'photo_key') from public.approval_requests where status = 'pending'),
  '22222222-2222-4222-8222-222222222222 → 66666666-6666-4666-8666-666666666666',
  'the request holds the current and the new photo'
);
select is(
  pg_temp.remove('special', pg_temp.path('a2', '66666666-6666-4666-8666-666666666666')),
  'ok 0',
  'a file a pending request asks for cannot be deleted'
);
select is(
  tests.message('owner', format('select public.decide_approval(%L, true)', (select id from public.approval_requests where status = 'pending'))),
  'ok',
  'the Owner approves it'
);
select is(pg_temp.photo('a2'), '66666666-6666-4666-8666-666666666666', 'the new photo shows');

-- ---- Deleting files ----------------------------------------------------------------------
select is(
  pg_temp.remove('owner', pg_temp.path('a2', '66666666-6666-4666-8666-666666666666')),
  'ok 0',
  'a photo a product shows cannot be deleted, even by the Owner'
);
select is(
  pg_temp.remove('sales', pg_temp.path('a2', '22222222-2222-4222-8222-222222222222')),
  'ok 0',
  'Sales cannot delete files'
);
select is(
  pg_temp.remove('special', pg_temp.path('a2', '22222222-2222-4222-8222-222222222222')),
  'ok 1',
  'the uploader deletes their replaced file'
);
select is(
  pg_temp.remove('special', pg_temp.path('a1', '11111111-1111-4111-8111-111111111111', '800')),
  'ok 0',
  'but not files of others'
);
select is(
  tests.message('owner', format('select public.set_product_photo(%L, null)', '00000000-0000-4000-8000-0000000000a1')),
  'ok',
  'the Owner removes a photo'
);
select is(pg_temp.photo('a1'), 'none', 'the product has no photo');
select is(
  pg_temp.remove('owner', pg_temp.path('a1', '11111111-1111-4111-8111-111111111111', '800')),
  'ok 1',
  'then the Owner deletes its file'
);

-- ---- Reading -----------------------------------------------------------------------------
select is(
  tests.rows(caller, 'select * from storage.objects'),
  case when caller in ('sales', 'special', 'owner') then 4 when caller = 'anon' then 0 else 0 end::bigint,
  caller || ' lists photo files only with access'
)
from unnest(tests.everyone()) as caller;

-- ---- CSV export record -------------------------------------------------------------------
select is(
  tests.message('owner', 'select public.record_product_export(2)'),
  'ok',
  'the Owner''s export is recorded'
);
select is(
  (select after ->> 'rows' from public.audit_logs where action = 'products.export'),
  '2',
  'with the number of products'
);
select is(
  tests.message(caller, 'select public.record_product_export(2)'),
  case when caller = 'anon' then 'permission denied for function record_product_export' else 'This account has no access.' end,
  caller || ' cannot export'
)
from unnest(array['anon', 'sales', 'special', 'owner_aal1']) as caller;

select * from finish();
rollback;
