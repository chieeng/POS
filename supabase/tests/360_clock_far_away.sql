-- A clock tap clearly outside the store is refused even with a poor reading (ATT-03, ATT-04;
-- the owner's decision after the Nov 24, 2026 test: "11,620 m away, accuracy 105 m" was
-- accepted). Refused when distance - accuracy > radius; allowed with a flag only when the
-- reading might still be inside.
begin;
select * from no_plan();
select tests.fixture();
update public.branches set store_lat = 14.5862, store_lng = 121.1760, radius_m = 100 where id = 'tmain';

create function pg_temp.where_(p_lat float8, p_acc float8) returns text language plpgsql as $$
begin
  return coalesce(private.check_location('tmain', p_lat, 121.1760, p_acc) ->> 'flag', 'ok');
exception when sqlstate 'P0001' then
  return 'refused ' || sqlerrm;
end;
$$;

-- About 111 m per 0.001 degree of latitude.
select is(pg_temp.where_(14.5862, 10), 'ok', 'at the store, good reading: allowed');
select is(pg_temp.where_(14.5882, 10), 'refused outside_radius', 'about 222 m away, good reading: refused');
select is(pg_temp.where_(14.6907, 105), 'refused outside_radius',
  'about 11.6 km away, accuracy 105 m (the Nov 24 laptop): refused');
select is(pg_temp.where_(14.5882, 250), 'location_not_verified',
  'about 222 m away, accuracy 250 m: might be inside, allowed and flagged');
select is(pg_temp.where_(14.5892, 150), 'refused outside_radius',
  'about 333 m away, accuracy 150 m: 183 m beyond even the reading''s edge, refused');
select is(pg_temp.where_(14.5882, 130), 'location_not_verified',
  'about 222 m away, accuracy 130 m: the edge is 92 m away, inside 100 m, allowed and flagged');
select is(pg_temp.where_(14.5882, null), 'location_not_verified',
  'a position without its accuracy: allowed and flagged, as before');
select is(pg_temp.where_(null, null), 'location_not_read', 'no reading at all: allowed and flagged');

-- Through clock_in: refused, nothing recorded, and the distance is given.
select is(
  tests.message('sales', format('select public.clock_in(%L)', jsonb_build_object(
    'clientId', '00000000-0000-4000-8000-0000000f0001', 'lat', 14.6907, 'lng', 121.1760, 'accuracy', 105)::text)),
  'outside_radius', 'clock_in from 11.6 km away is refused');
select is((select count(*)::int from public.attendance), 0, 'and nothing is recorded');

select * from finish();
rollback;
