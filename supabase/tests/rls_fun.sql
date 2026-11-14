-- Phase 5: proves that points can't be written by app users (only by the
-- database's own triggers), that the point rules hold (no points for your own
-- request, one payout per request, restock guards), that outsiders see
-- nothing, that auto-messages go out at most once per day per person, and
-- that the weekly MVP job is safe to run twice and handles ties.
-- Runs in one transaction that is rolled back.
--
-- Counts are limited to the test rooms: the local database may hold real
-- rooms that the jobs also act on (all rolled back at the end).
--
-- Note: now() is frozen for a whole transaction, so "3 hours ago" is set up by
-- moving timestamps back as the database owner, not by waiting.
--
-- Local: docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_fun.sql
-- Success is a final row reading "ALL PHASE 5 RLS CHECKS PASSED".

begin;

-- Room 1: Alice (admin), Bob, Dan. Room 2: Carol, the outsider.
-- Room 3: Erin and Fay, who have gone quiet.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@test.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@test.invalid'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'carol@test.invalid'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'dan@test.invalid'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'erin@test.invalid'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'fay@test.invalid');

insert into public.rooms (id, name, invite_code) values
  ('11111111-1111-4111-8111-111111111111', 'Room One', 'AAAAAA'),
  ('22222222-2222-4222-8222-222222222222', 'Room Two', 'BBBBBB'),
  ('33333333-3333-4333-8333-333333333333', 'Room Three', 'CCCCCC');

insert into public.room_members (room_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'),
  ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'member'),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'member'),
  ('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin'),
  ('33333333-3333-4333-8333-333333333333', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'admin'),
  ('33333333-3333-4333-8333-333333333333', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'member');

insert into public.statuses (user_id, room_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '33333333-3333-4333-8333-333333333333'),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', '33333333-3333-4333-8333-333333333333');

-- Alice asks for four things (one urgent) and leaves two visitor notes for Bob.
insert into public.requests (id, room_id, kind, text, urgency, created_by, for_user) values
  ('a1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'errand', 'Buy bread', 'normal', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null),
  ('a1000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'errand', 'Buy water', 'urgent', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null),
  ('a1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'clothes', 'Pick my clothes', 'normal', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null),
  ('a1000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'other', 'Nobody claims this', 'normal', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null),
  ('a1000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'visitor_note', 'Cleared by Alice', 'normal', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('a1000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'visitor_note', 'Bob says got it', 'normal', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- Two groceries that ran out an hour ago, and one that ran out just now.
insert into public.pantry_items (id, room_id, name, state) values
  ('b1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Sugar', 'out'),
  ('b1000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Salt', 'out'),
  ('b1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Rice', 'out');
alter table public.pantry_items disable trigger pantry_items_touch;
update public.pantry_items set updated_at = now() - interval '1 hour'
where id in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002');
alter table public.pantry_items enable trigger pantry_items_touch;

-- ---- Bob: the acceptance test. Points can't be inserted from the app --------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);

do $$
begin
  begin
    insert into public.point_events (room_id, user_id, points, reason)
    values ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 100, 'restock');
    raise exception 'FAIL: a member inserted points for themselves';
  exception when insufficient_privilege then
    raise notice 'ok: insert into point_events refused (permission denied)';
  end;

  begin
    update public.point_events set points = 100;
    raise exception 'FAIL: a member updated points';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.point_events;
    raise exception 'FAIL: a member deleted points';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.weekly_mvps (room_id, week_start, user_id, points)
    values ('11111111-1111-4111-8111-111111111111', current_date, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 999);
    raise exception 'FAIL: a member crowned themselves MVP';
  exception when insufficient_privilege then null;
  end;

  begin
    perform private.award_points('11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 100, 'restock', null);
    raise exception 'FAIL: a member called award_points';
  exception when insufficient_privilege then null;
  end;

  begin
    perform private.run_auto_messages();
    raise exception 'FAIL: a member ran the auto-message job';
  exception when insufficient_privilege then null;
  end;

  begin
    perform count(*) from public.auto_message_log;
    raise exception 'FAIL: a member read auto_message_log';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- Earning points through the real app paths ------------------------------
-- Bob claims and finishes request 1 (+10) and claims the urgent one (+15 when
-- Alice, the creator, marks it done). He restocks Sugar (+5) and Rice (too
-- quick: it only just ran out). He acknowledges note 6 (+3 for Alice).
select public.claim_request('a1000000-0000-4000-8000-000000000001');
select public.complete_request('a1000000-0000-4000-8000-000000000001');
select public.claim_request('a1000000-0000-4000-8000-000000000002');
update public.pantry_items set state = 'have' where id = 'b1000000-0000-4000-8000-000000000001';
update public.pantry_items set state = 'have' where id = 'b1000000-0000-4000-8000-000000000003';
select public.complete_request('a1000000-0000-4000-8000-000000000006');

-- Bob tries to fake an old "starving since" time. The trigger overwrites it.
update public.statuses set hunger = 3 where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.statuses set hunger_updated_at = now() - interval '5 hours'
where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare t timestamptz;
begin
  select hunger_updated_at into t from public.statuses where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if t < now() then raise exception 'FAIL: hunger_updated_at was faked to %', t; end if;
end $$;

-- ---- Alice -------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select public.complete_request('a1000000-0000-4000-8000-000000000002'); -- Bob claimed it: +15 to Bob
select public.claim_request('a1000000-0000-4000-8000-000000000003');    -- her own request...
select public.complete_request('a1000000-0000-4000-8000-000000000003'); -- ...pays nothing
select public.complete_request('a1000000-0000-4000-8000-000000000004'); -- unclaimed: nothing
select public.complete_request('a1000000-0000-4000-8000-000000000005'); -- her own note: nothing
-- Alice restocks Salt (out for an hour): +5.
update public.pantry_items set state = 'have' where id = 'b1000000-0000-4000-8000-000000000002';

do $$
declare n int; p int;
begin
  select coalesce(sum(points), 0) into p from public.point_events
  where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if p <> 30 then raise exception 'FAIL: Bob should have 10 + 15 + 5 = 30 points, has %', p; end if;

  select coalesce(sum(points), 0) into p from public.point_events
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if p <> 8 then raise exception 'FAIL: Alice should have 3 (note) + 5 (salt) = 8 points, has %', p; end if;

  select count(*) into n from public.point_events
  where source_id in ('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004',
                      'a1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000003');
  if n <> 0 then raise exception 'FAIL: % points for own requests, own note or a quick restock', n; end if;

  -- The leaderboard function agrees.
  select points into p from public.week_leaderboard('11111111-1111-4111-8111-111111111111')
  where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if p <> 30 then raise exception 'FAIL: leaderboard shows % for Bob', p; end if;
end $$;

-- ---- Carol: the outsider -----------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.point_events where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read % point events', n; end if;
  select count(*) into n from public.week_leaderboard('11111111-1111-4111-8111-111111111111');
  if n <> 0 then raise exception 'FAIL: outsider read the leaderboard (% rows)', n; end if;
end $$;

-- ---- Anonymous visitors: nothing ------------------------------------------------
reset role;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.point_events;
    raise exception 'FAIL: anon read point_events';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---- One payout per request, even if something calls award_points twice ------
do $$
declare n int;
begin
  perform private.award_points('11111111-1111-4111-8111-111111111111',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 10, 'request_done', 'a1000000-0000-4000-8000-000000000001');
  select count(*) into n from public.point_events where source_id = 'a1000000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL: request 1 paid out % times', n; end if;
end $$;

-- ---- Restock: at most once per item every 12 hours ---------------------------
-- Sugar runs out again and sits for an hour; Bob restocks again: no points.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);
update public.pantry_items set state = 'out' where id = 'b1000000-0000-4000-8000-000000000001';
reset role;
alter table public.pantry_items disable trigger pantry_items_touch;
update public.pantry_items set updated_at = now() - interval '1 hour' where id = 'b1000000-0000-4000-8000-000000000001';
alter table public.pantry_items enable trigger pantry_items_touch;
set local role authenticated;
update public.pantry_items set state = 'have' where id = 'b1000000-0000-4000-8000-000000000001';
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.point_events where source_id = 'b1000000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL: Sugar paid % times within 12 hours', n; end if;
end $$;

-- ---- Auto-messages -------------------------------------------------------------
-- Bob has been starving for 4 hours, Dan for 1 hour, Carol for 13 hours
-- (forgotten). Room 1 is all home with the ready food finished. Room 3 went
-- quiet 13 hours ago. (Owner + trigger off, to move the clocks back.)
alter table public.statuses disable trigger statuses_touch;
update public.statuses set hunger = 3, hunger_updated_at = now() - interval '4 hours'
where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.statuses set hunger = 3, hunger_updated_at = now() - interval '1 hour'
where user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
update public.statuses set hunger = 3, hunger_updated_at = now() - interval '13 hours'
where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
update public.statuses set at_home = true, at_home_source = 'geo', at_home_updated_at = now()
where room_id = '11111111-1111-4111-8111-111111111111';
update public.statuses set updated_at = now() - interval '13 hours'
where room_id = '33333333-3333-4333-8333-333333333333';
alter table public.statuses enable trigger statuses_touch;
insert into public.pantry_items (room_id, name, kind, state) values
  ('11111111-1111-4111-8111-111111111111', 'Pilau', 'ready_food', 'out');

do $$
declare n int; msg text;
begin
  perform private.run_auto_messages();

  select count(*) into n from public.auto_message_log where kind = 'starving' and room_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
  if n <> 1 then raise exception 'FAIL: expected 1 starving message (Bob only), got %', n; end if;
  select message into msg from public.feed_events
  where kind = 'auto' and actor_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if msg is distinct from 'bob has been starving for 4 hours. Someone check on bob 👀' then
    raise exception 'FAIL: starving message was %', msg;
  end if;

  select count(*) into n from public.feed_events
  where kind = 'auto' and message = 'Is anyone alive in this room? 🦗' and room_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
  if n <> 1 then raise exception 'FAIL: expected 1 ghost-town message (room 3), got %', n; end if;

  select count(*) into n from public.feed_events
  where kind = 'auto' and room_id = '11111111-1111-4111-8111-111111111111'
    and message = '3 people, 0 food. Emergency meeting. 🚨';
  if n <> 1 then raise exception 'FAIL: expected 1 no-food message in room 1, got %', n; end if;

  -- Acceptance: running again (as cron does every 30 min) adds nothing.
  perform private.run_auto_messages();
  perform private.run_auto_messages();
  select count(*) into n from public.feed_events where kind = 'auto' and room_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
  if n <> 3 then raise exception 'FAIL: repeat runs added messages (% total)', n; end if;

  -- 25 hours later Bob is (still, apparently) starving: one more is allowed.
  update public.auto_message_log set created_at = now() - interval '25 hours'
  where kind = 'starving' and room_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
  perform private.run_auto_messages();
  select count(*) into n from public.auto_message_log where kind = 'starving' and room_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
  if n <> 2 then raise exception 'FAIL: expected a new starving message after 24 h, got % total', n; end if;
end $$;

-- ---- Weekly MVP ------------------------------------------------------------------
-- Last week in room 1: Alice 20, Bob 20 (a tie), Dan 5. Room 3: nothing.
insert into public.point_events (room_id, user_id, points, reason, created_at)
select '11111111-1111-4111-8111-111111111111', u, p, 'restock',
  (date_trunc('week', now() at time zone 'Africa/Kampala') at time zone 'Africa/Kampala') - interval '3 days'
from (values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 20),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 15),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 5),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, 5)
) as v(u, p);
-- An old crowning that never got its push (e.g. the job was down for weeks).
insert into public.weekly_mvps (room_id, week_start, user_id, points) values
  ('33333333-3333-4333-8333-333333333333', current_date - 30, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 3);

do $$
declare n int; msg text; v_week date;
begin
  v_week := date_trunc('week', now() at time zone 'Africa/Kampala')::date - 7;
  perform private.weekly_mvp_job();

  select count(*) into n from public.weekly_mvps
  where room_id = '11111111-1111-4111-8111-111111111111' and week_start = v_week and points = 20;
  if n <> 2 then raise exception 'FAIL: expected 2 co-MVPs with 20 points, got %', n; end if;

  select message into msg from public.feed_events where kind = 'mvp' and room_id = '11111111-1111-4111-8111-111111111111';
  if msg is distinct from '🏆 alice and bob are Room MVPs of the week with 20 points each!' then
    raise exception 'FAIL: MVP message was %', msg;
  end if;

  select count(*) into n from public.weekly_mvps
  where room_id = '33333333-3333-4333-8333-333333333333' and week_start = v_week;
  if n <> 0 then raise exception 'FAIL: a 0-point week got an MVP'; end if;

  -- The weeks-old crowning is marked done (too late to push).
  select count(*) into n from public.weekly_mvps
  where room_id = '33333333-3333-4333-8333-333333333333' and pushed_at is null;
  if n <> 0 then raise exception 'FAIL: an old MVP push is still pending'; end if;

  -- Safe to run again.
  perform private.weekly_mvp_job();
  select count(*) into n from public.feed_events where kind = 'mvp' and room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 1 then raise exception 'FAIL: running the MVP job twice posted % messages', n; end if;
  select count(*) into n from public.weekly_mvps where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 2 then raise exception 'FAIL: running the MVP job twice gave % rows', n; end if;
end $$;

-- Members can read the MVP rows; the outsider can't.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.weekly_mvps where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 2 then raise exception 'FAIL: member sees % MVP rows', n; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.weekly_mvps where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider sees % MVP rows', n; end if;
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

-- ---- Both jobs are scheduled ---------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from cron.job where jobname in ('wegood-auto-messages', 'wegood-weekly-mvp');
  if n <> 2 then raise exception 'FAIL: % of 2 Phase 5 cron jobs found', n; end if;
end $$;

rollback;

select 'ALL PHASE 5 RLS CHECKS PASSED' as result;
