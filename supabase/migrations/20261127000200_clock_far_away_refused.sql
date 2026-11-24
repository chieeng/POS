-- A clock-in or clock-out clearly outside the store is refused, even with a poor reading
-- (SRS ATT-03, ATT-04; the owner's decision after the Nov 24, 2026 step 11 test: a time in
-- "11,620 m away, accuracy 105 m" was accepted with a flag).
--
-- A reading is a circle: the phone is somewhere within `accuracy` metres of the point. If even
-- the circle's nearest edge is beyond the radius (distance - accuracy > radius), the person is
-- certainly away: refused, showing how far. Only a reading that might still be inside the store
-- is allowed with "location not verified". No reading at all is still allowed and flagged
-- "location not read" (ATT-04). Days already recorded are not changed.

create or replace function private.check_location(p_branch text, p_lat double precision,
  p_lng double precision, p_accuracy double precision)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_b public.branches;
  v_distance integer;
begin
  select * into v_b from public.branches b where b.id = p_branch;
  if v_b.store_lat is null then
    return jsonb_build_object('location', 'not_set', 'distance', null, 'flag', 'store_location_not_set');
  end if;
  if p_lat is null or p_lng is null then
    return jsonb_build_object('location', 'not_verified', 'distance', null, 'flag', 'location_not_read');
  end if;
  v_distance := private.distance_m(v_b.store_lat, v_b.store_lng, p_lat, p_lng);
  -- Certainly outside, however poor the reading.
  if p_accuracy is not null and v_distance - p_accuracy > v_b.radius_m then
    raise exception 'outside_radius' using errcode = 'P0001', detail = v_distance::text;
  end if;
  if p_accuracy is null or p_accuracy > v_b.radius_m then
    return jsonb_build_object('location', 'not_verified', 'distance', v_distance, 'flag', 'location_not_verified');
  end if;
  if v_distance > v_b.radius_m then
    raise exception 'outside_radius' using errcode = 'P0001', detail = v_distance::text;
  end if;
  return jsonb_build_object('location', 'ok', 'distance', v_distance, 'flag', null);
end;
$$;
