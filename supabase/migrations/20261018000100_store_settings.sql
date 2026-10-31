-- Store settings (SYS-01): the Owner edits the branch's details, idle lock time, and the
-- store's location and clock-in radius (ATT-02). Attendance rules come in a later migration.

-- ---- Location and limits -----------------------------------------------------------------
-- The radius always has a value (default 100 m); the location is either fully set or not set.
-- While it is not set, the location check at clock-in is off (ATT-02).
update public.branches set radius_m = 100 where radius_m is null;
alter table public.branches
  alter column radius_m set default 100,
  alter column radius_m set not null,
  add constraint branches_radius_m_range check (radius_m between 10 and 2000),
  add constraint branches_location_complete check ((store_lat is null) = (store_lng is null)),
  add constraint branches_address_length check (char_length(address) between 1 and 200),
  add constraint branches_contact_length check (char_length(contact) between 1 and 80),
  -- BIR TIN: 9 digits, optionally followed by a 3- to 5-digit branch code, with or without dashes.
  add constraint branches_tin_format check (tin ~ '^[0-9]{3}-?[0-9]{3}-?[0-9]{3}(-?[0-9]{3,5})?$'),
  add constraint branches_receipt_footer_length check (char_length(receipt_footer) between 1 and 300),
  add constraint branches_sales_discount_limit_max check (sales_discount_limit <= 1000000);

-- ---- Who can read it ---------------------------------------------------------------------
-- Every active user of the branch reads its row: the idle lock time applies to everyone, and
-- the name, address and discount limit will be on every sale. Nothing in it is secret within
-- the branch. Nobody writes it directly: the Owner goes through update_branch_settings.
grant select on table public.branches to authenticated;

create policy branches_select_own on public.branches
  for select to authenticated
  using ((select private.has_access()) and id = (select private.current_branch()));

-- A change shows on every open screen without a reload (idle lock time, store name).
alter publication supabase_realtime add table public.branches;

-- ---- update_branch_settings --------------------------------------------------------------
-- The Owner (with the second step) changes some of their branch's settings. p_changes holds
-- only the fields to change; unknown fields are refused. The audit log gets the old and new
-- value of every field that actually changed (SYS-01, ATT-09). Same shape as record_sign_in:
-- the privileged part lives in `private`, which the API does not expose.
create function private.update_branch_settings(p_changes jsonb, p_device_tag text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_branch text := private.current_branch();
  v_allowed constant text[] := array[
    'name', 'address', 'contact', 'tin', 'receipt_footer', 'sales_discount_limit',
    'idle_lock_minutes', 'store_lat', 'store_lng', 'radius_m'
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
    or exists (select 1 from jsonb_object_keys(p_changes) k where k <> all (v_allowed)) then
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
    sales_discount_limit = case when p_changes ? 'sales_discount_limit'
      then (p_changes ->> 'sales_discount_limit')::numeric(12, 2) else b.sales_discount_limit end,
    idle_lock_minutes = case when p_changes ? 'idle_lock_minutes'
      then (p_changes ->> 'idle_lock_minutes')::integer else b.idle_lock_minutes end,
    store_lat = case when p_changes ? 'store_lat'
      then (p_changes ->> 'store_lat')::double precision else b.store_lat end,
    store_lng = case when p_changes ? 'store_lng'
      then (p_changes ->> 'store_lng')::double precision else b.store_lng end,
    radius_m = case when p_changes ? 'radius_m'
      then (p_changes ->> 'radius_m')::integer else b.radius_m end
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
  -- A malformed number or a value a constraint refuses is bad input, like any other: one
  -- error code for the app to explain. Nothing was changed.
  when invalid_text_representation or numeric_value_out_of_range or check_violation
    or not_null_violation then
    raise exception 'invalid_input' using errcode = '22023';
end;
$$;

revoke execute on function private.update_branch_settings(jsonb, text) from public, anon;
grant execute on function private.update_branch_settings(jsonb, text) to authenticated;

create function public.update_branch_settings(p_changes jsonb, p_device_tag text default null)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_branch_settings(p_changes, p_device_tag);
$$;

revoke execute on function public.update_branch_settings(jsonb, text) from public, anon;
grant execute on function public.update_branch_settings(jsonb, text) to authenticated;
