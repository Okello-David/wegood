-- Phase 4: proves room isolation and owner-only writes for activities,
-- energy_checkins and schedule_items; that only admins can set the home
-- point; that set_geo_home only touches your own status and keeps "home"
-- fresh; and that no column could hold a user's coordinates.
-- Runs in one transaction that is rolled back.
--
-- Local: docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_smart.sql
-- Success is a final row reading "ALL PHASE 4 RLS CHECKS PASSED".

begin;

-- Alice (admin) and Bob (member) share room 1. Carol is the outsider in room 2.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@test.invalid'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'carol@test.invalid');

insert into public.rooms (id, name, invite_code) values
  ('11111111-1111-4111-8111-111111111111', 'Room One', 'AAAAAA'),
  ('22222222-2222-4222-8222-222222222222', 'Room Two', 'BBBBBB');

insert into public.room_members (room_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'member'),
  ('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin');

insert into public.statuses (user_id, room_id, location_preset, at_home, at_home_source) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'campus', false, 'manual'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'campus', false, 'manual'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 'unknown', null, null);

-- Alice's energy data and plan.
insert into public.activities (id, user_id, room_id, type, started_at) values
  ('a0a0a0a0-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111', 'gym', now() - interval '1 hour');
insert into public.energy_checkins (id, user_id, room_id, kind) values
  ('a0a0a0a0-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111', 'wake');
insert into public.schedule_items (id, user_id, room_id, title, type, starts_at, ends_at, repeat_days) values
  ('a0a0a0a0-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111', 'Calculus', 'class',
   now(), now() + interval '2 hours', '{1,3}');

-- ---- Carol: the outsider ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.activities where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read % activities', n; end if;
  select count(*) into n from public.energy_checkins where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read % check-ins', n; end if;
  select count(*) into n from public.schedule_items where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read % schedule items', n; end if;

  update public.schedule_items set title = 'Hacked' where id = 'a0a0a0a0-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider updated a schedule item'; end if;
  delete from public.activities where id = 'a0a0a0a0-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider deleted an activity'; end if;

  -- Carol is an admin, but of room 2, not room 1.
  update public.rooms set home_lat = 1, home_lng = 1 where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider moved room 1''s home'; end if;

  begin
    insert into public.activities (room_id, type) values ('11111111-1111-4111-8111-111111111111', 'chill');
    raise exception 'FAIL: outsider added an activity to our room';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.schedule_items (room_id, title, type, starts_at, ends_at)
    values ('11111111-1111-4111-8111-111111111111', 'Spam', 'chill', now(), now() + interval '1 hour');
    raise exception 'FAIL: outsider added a schedule item to our room';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- Bob: a member, not an admin --------------------------------------------
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);

do $$
declare n int;
begin
  -- Roommates can see each other's battery inputs and plans.
  select count(*) into n from public.activities where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if n <> 1 then raise exception 'FAIL: member sees % of Alice''s activities, expected 1', n; end if;
  select count(*) into n from public.schedule_items where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if n <> 1 then raise exception 'FAIL: member sees % of Alice''s schedule items, expected 1', n; end if;

  -- ...but can't change them.
  update public.activities set ended_at = now() + interval '1 minute'
  where id = 'a0a0a0a0-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: member stopped Alice''s activity'; end if;
  update public.schedule_items set title = 'Skipped lol' where id = 'a0a0a0a0-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: member edited Alice''s schedule'; end if;
  delete from public.energy_checkins where id = 'a0a0a0a0-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: member deleted Alice''s check-in'; end if;

  -- Not an admin: can't set the home point.
  update public.rooms set home_lat = 1, home_lng = 1 where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: non-admin set the home point'; end if;

  -- Can't write as someone else (user_id isn't in the insert grant).
  begin
    insert into public.activities (user_id, room_id, type)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'nap');
    raise exception 'FAIL: member logged an activity as Alice';
  exception when insufficient_privilege then null;
  end;
  -- Column grants: activities can only be stopped, check-ins never edited.
  begin
    update public.activities set type = 'nap' where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'FAIL: activity type could be changed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.energy_checkins set feel = 5 where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'FAIL: a check-in could be edited';
  exception when insufficient_privilege then null;
  end;

  -- Own rows work, and user_id is filled in automatically.
  insert into public.activities (room_id, type) values ('11111111-1111-4111-8111-111111111111', 'football');
  insert into public.energy_checkins (room_id, kind, feel) values ('11111111-1111-4111-8111-111111111111', 'feel', 4);
  insert into public.schedule_items (room_id, title, type, starts_at, ends_at)
  values ('11111111-1111-4111-8111-111111111111', 'Football', 'football', now(), now() + interval '90 minutes');
  select count(*) into n from public.activities where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if n <> 1 then raise exception 'FAIL: own activity not saved as Bob'; end if;

  -- Data checks.
  begin
    insert into public.energy_checkins (room_id, kind, feel) values ('11111111-1111-4111-8111-111111111111', 'feel', 6);
    raise exception 'FAIL: feel 6 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.energy_checkins (room_id, kind, feel) values ('11111111-1111-4111-8111-111111111111', 'wake', 3);
    raise exception 'FAIL: wake check-in with a feel value accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.schedule_items (room_id, title, type, starts_at, ends_at, repeat_days)
    values ('11111111-1111-4111-8111-111111111111', 'Bad', 'class', now(), now() + interval '1 hour', '{7}');
    raise exception 'FAIL: weekday 7 accepted';
  exception when check_violation then null;
  end;
end $$;

-- ---- set_geo_home: only true/false, only your own row ------------------------
do $$
declare s public.statuses;
begin
  perform public.set_geo_home(true);
  select * into s from public.statuses where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if not (s.at_home and s.at_home_source = 'geo' and s.location_preset = 'home') then
    raise exception 'FAIL: set_geo_home(true) gave at_home=%, source=%, preset=%',
      s.at_home, s.at_home_source, s.location_preset;
  end if;

  select * into s from public.statuses where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if s.at_home or s.at_home_source <> 'manual' then
    raise exception 'FAIL: set_geo_home changed someone else''s status';
  end if;

  perform public.set_geo_home(false);
  select * into s from public.statuses where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if s.at_home or s.location_preset <> 'unknown' then
    raise exception 'FAIL: leaving home left preset=% at_home=%', s.location_preset, s.at_home;
  end if;
end $$;

reset role;

-- "Still home" must refresh at_home_updated_at (Phase 3 routing ignores a
-- "home" older than 3 hours), but other edits must not. now() is fixed inside
-- a transaction, so make the timestamp old by hand first (trigger off).
alter table public.statuses disable trigger statuses_touch;
update public.statuses set at_home = true, at_home_source = 'geo',
  at_home_updated_at = now() - interval '5 hours'
where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
alter table public.statuses enable trigger statuses_touch;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);

do $$
declare t timestamptz;
begin
  -- A normal edit afterwards (flag must be cleared) leaves it alone...
  update public.statuses set hunger = 2 where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  select at_home_updated_at into t from public.statuses where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if t > now() - interval '4 hours' then raise exception 'FAIL: a hunger change refreshed at_home'; end if;

  -- ...while the geofence saying "still home" refreshes it.
  perform public.set_geo_home(true);
  select at_home_updated_at into t from public.statuses where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if t < now() - interval '1 minute' then raise exception 'FAIL: same-value geo report did not refresh at_home'; end if;

  update public.statuses set hunger = 3 where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if current_setting('wegood.geo_refresh', true) = '1' then
    raise exception 'FAIL: geo_refresh flag left on after set_geo_home';
  end if;
end $$;

-- ---- Alice: the admin -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

do $$
declare n int;
begin
  update public.rooms set home_lat = 0.3476, home_lng = 32.5825, radius_m = 80
  where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin could not set the home point'; end if;

  update public.activities set ended_at = now() + interval '1 minute'
  where id = 'a0a0a0a0-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: owner could not stop own activity'; end if;
end $$;

-- ---- Anonymous visitors -------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  begin
    perform public.set_geo_home(true);
    raise exception 'FAIL: anonymous user could call set_geo_home';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.schedule_items;
    raise exception 'FAIL: anonymous user could read schedules';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- ---- No column anywhere could hold a person's coordinates ---------------------
-- The only coordinates allowed are the ROOM's home point.
do $$
declare t text;
begin
  select string_agg(table_name || '.' || column_name, ', ') into t
  from information_schema.columns
  where table_schema = 'public'
    and column_name ~* '(^|_)(lat|lng|lon|long|latitude|longitude)$|coord|geom|geog|^position$|accuracy'
    and (table_name, column_name) not in (('rooms', 'home_lat'), ('rooms', 'home_lng'));
  if t is not null then raise exception 'FAIL: possible coordinate columns: %', t; end if;
end $$;

-- ---- RLS is switched on for every public table -------------------------------
do $$
declare t text;
begin
  select string_agg(c.relname, ', ') into t
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if t is not null then raise exception 'FAIL: RLS is off for: %', t; end if;
end $$;

rollback;

select 'ALL PHASE 4 RLS CHECKS PASSED' as result;
