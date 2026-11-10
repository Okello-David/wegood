-- Phase 2: proves room isolation and the request rules for pantry_items,
-- requests and feed_events. Runs in one transaction that is rolled back.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_room_features.sql
-- Local: docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_room_features.sql
-- Success is a final row reading "ALL PHASE 2 RLS CHECKS PASSED".

begin;

-- Alice and Bob share room 1. Dan is in room 1 too (a bystander). Carol is the
-- outsider in room 2.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@test.invalid'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'carol@test.invalid'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'dan@test.invalid');

insert into public.rooms (id, name, invite_code) values
  ('11111111-1111-4111-8111-111111111111', 'Room One', 'AAAAAA'),
  ('22222222-2222-4222-8222-222222222222', 'Room Two', 'BBBBBB');

insert into public.room_members (room_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'member'),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'member'),
  ('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin');

insert into public.pantry_items (id, room_id, name) values
  ('a1a1a1a1-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Sugar'),
  ('c1c1c1c1-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Salt');

-- An errand by Alice, and a visitor note by Alice for Bob.
insert into public.requests (id, room_id, kind, text, created_by, for_user) values
  ('e1e1e1e1-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'errand', 'Buy milk', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null),
  ('e1e1e1e1-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'visitor_note', 'Someone came for you', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- ---- Carol: the outsider ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.pantry_items where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read % pantry items', n; end if;

  select count(*) into n from public.requests where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read % requests', n; end if;

  select count(*) into n from public.feed_events where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read % feed events', n; end if;

  update public.pantry_items set state = 'out' where id = 'a1a1a1a1-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider updated an item'; end if;

  delete from public.pantry_items where id = 'a1a1a1a1-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider deleted an item'; end if;

  delete from public.requests where id = 'e1e1e1e1-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider deleted a request'; end if;

  begin
    insert into public.pantry_items (room_id, name)
    values ('11111111-1111-4111-8111-111111111111', 'Spam');
    raise exception 'FAIL: outsider added an item to our room';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.requests (room_id, kind, text)
    values ('11111111-1111-4111-8111-111111111111', 'other', 'hi');
    raise exception 'FAIL: outsider created a request in our room';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.claim_request('e1e1e1e1-0000-4000-8000-000000000001');
    raise exception 'FAIL: outsider claimed our request';
  exception when raise_exception then
    if sqlerrm <> 'not_found' then raise; end if;
  end;

  begin
    perform public.complete_request('e1e1e1e1-0000-4000-8000-000000000001');
    raise exception 'FAIL: outsider completed our request';
  exception when raise_exception then
    if sqlerrm <> 'not_found' then raise; end if;
  end;

  begin
    perform public.seed_pantry('11111111-1111-4111-8111-111111111111');
    raise exception 'FAIL: outsider seeded our pantry';
  exception when raise_exception then
    if sqlerrm <> 'not_a_member' then raise; end if;
  end;

  if public.is_member_of('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'FAIL: is_member_of revealed another room''s members';
  end if;
end $$;

-- ---- Bob: an ordinary member ------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);

do $$
declare
  n int;
  r public.requests;
begin
  select count(*) into n from public.pantry_items;
  if n <> 1 then raise exception 'FAIL: member saw % items, expected 1', n; end if;

  -- Marking an item out works, stamps Bob as the updater and writes the feed.
  update public.pantry_items set state = 'out' where id = 'a1a1a1a1-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: member could not update an item'; end if;
  select count(*) into n from public.pantry_items
  where id = 'a1a1a1a1-0000-4000-8000-000000000001' and updated_by = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if n <> 1 then raise exception 'FAIL: updated_by was not set by the database'; end if;
  select count(*) into n from public.feed_events where kind = 'item_out';
  if n <> 1 then raise exception 'FAIL: running out did not reach the feed'; end if;

  begin
    update public.pantry_items set room_id = '22222222-2222-4222-8222-222222222222'
    where id = 'a1a1a1a1-0000-4000-8000-000000000001';
    raise exception 'FAIL: member moved an item to another room';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.pantry_items set updated_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    where id = 'a1a1a1a1-0000-4000-8000-000000000001';
    raise exception 'FAIL: member faked updated_by';
  exception when insufficient_privilege then null;
  end;

  -- The feed can't be written by hand.
  begin
    insert into public.feed_events (room_id, kind, message)
    values ('11111111-1111-4111-8111-111111111111', 'item_out', 'fake news');
    raise exception 'FAIL: member wrote a fake feed event';
  exception when insufficient_privilege then null;
  end;

  -- Requests can't be edited directly, only through the functions.
  begin
    update public.requests set claimed_by = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    where id = 'e1e1e1e1-0000-4000-8000-000000000001';
    raise exception 'FAIL: member updated a request directly';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.requests (room_id, kind, text, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'other', 'x', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'FAIL: member faked created_by';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.requests (room_id, kind, text, for_user)
    values ('11111111-1111-4111-8111-111111111111', 'visitor_note', 'x', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    raise exception 'FAIL: visitor note for someone outside the room';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.requests (room_id, kind, text)
    values ('11111111-1111-4111-8111-111111111111', 'visitor_note', 'for nobody');
    raise exception 'FAIL: visitor note without a "for" roommate';
  exception when insufficient_privilege then null;
  end;

  -- Bob can't delete Alice's request.
  delete from public.requests where id = 'e1e1e1e1-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: member deleted someone else''s request'; end if;

  -- Bob claims Alice's errand.
  r := public.claim_request('e1e1e1e1-0000-4000-8000-000000000001');
  if r.claimed_by <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception 'FAIL: claim did not record Bob';
  end if;

  -- Visitor notes are cleared, not claimed. Bob is the target, so he can clear it.
  begin
    perform public.claim_request('e1e1e1e1-0000-4000-8000-000000000002');
    raise exception 'FAIL: visitor note was claimable';
  exception when raise_exception then
    if sqlerrm <> 'cannot_claim_note' then raise; end if;
  end;
  r := public.complete_request('e1e1e1e1-0000-4000-8000-000000000002');
  if r.done_at is null then raise exception 'FAIL: target could not clear the visitor note'; end if;
end $$;

-- ---- Dan: a bystander in the same room --------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}', true);

do $$
declare n int;
begin
  -- Bob already claimed it: Dan loses, and learns who won.
  begin
    perform public.claim_request('e1e1e1e1-0000-4000-8000-000000000001');
    raise exception 'FAIL: second claim succeeded';
  exception when raise_exception then
    if sqlerrm <> 'already_claimed' then raise; end if;
  end;

  -- Dan is neither claimer nor creator.
  begin
    perform public.complete_request('e1e1e1e1-0000-4000-8000-000000000001');
    raise exception 'FAIL: bystander completed a request';
  exception when raise_exception then
    if sqlerrm <> 'not_allowed' then raise; end if;
  end;

  select count(*) into n from public.feed_events
  where kind in ('request_claimed', 'request_done');
  if n <> 2 then raise exception 'FAIL: expected claim + done in the feed, got %', n; end if;
end $$;

-- ---- Alice: the creator ------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

do $$
declare r public.requests;
begin
  r := public.complete_request('e1e1e1e1-0000-4000-8000-000000000001');
  if r.done_at is null then raise exception 'FAIL: creator could not finish the request'; end if;

  begin
    perform public.complete_request('e1e1e1e1-0000-4000-8000-000000000001');
    raise exception 'FAIL: finished twice';
  exception when raise_exception then
    if sqlerrm <> 'already_done' then raise; end if;
  end;

  -- Seeding twice adds nothing new the second time.
  perform public.seed_pantry('11111111-1111-4111-8111-111111111111');
  if public.seed_pantry('11111111-1111-4111-8111-111111111111') <> 0 then
    raise exception 'FAIL: seeding twice added duplicates';
  end if;
end $$;

-- ---- Not signed in ----------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  begin
    perform 1 from public.pantry_items;
    raise exception 'FAIL: anonymous user could query pantry_items';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.requests;
    raise exception 'FAIL: anonymous user could query requests';
  exception when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.feed_events;
    raise exception 'FAIL: anonymous user could query feed_events';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.claim_request('e1e1e1e1-0000-4000-8000-000000000001');
    raise exception 'FAIL: anonymous user could call claim_request';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

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

select 'ALL PHASE 2 RLS CHECKS PASSED' as result;
