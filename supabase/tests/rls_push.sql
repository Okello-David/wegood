-- Phase 3: proves that push subscriptions and notification preferences are
-- private to their owner, that the send log is invisible to app users, and
-- that the escalation and expiry jobs behave. Runs in one transaction that is
-- rolled back, so it leaves no data and sends no notifications (pg_net only
-- sends after a commit).
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_push.sql
-- Local: docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_push.sql
-- Success is a final row reading "ALL PHASE 3 RLS CHECKS PASSED".

begin;

-- Alice and Bob share room 1. Carol is the outsider in room 2.
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

insert into public.statuses (user_id, room_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111');

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://push.test.invalid/alice', 'key-a', 'auth-a'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'https://push.test.invalid/carol', 'key-c', 'auth-c');

insert into public.notification_prefs (user_id, food) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

insert into public.notification_log (room_id, sender_id, kind, title, rule) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ping', 'x', 'at_home');

-- An urgent request by Alice that has waited 11 minutes, and a fresh one.
insert into public.requests (id, room_id, kind, text, urgency, created_by, created_at) values
  ('e1e1e1e1-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'errand', 'Old urgent', 'urgent', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now() - interval '11 minutes'),
  ('e1e1e1e1-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'errand', 'New urgent', 'urgent', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now() - interval '2 minutes');

-- ---- Bob: Alice's roommate. Being in the same room gives him nothing here. ---
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);

do $$
declare n int; v_uid uuid; v_ts timestamptz;
begin
  select count(*) into n from public.push_subscriptions;
  if n <> 0 then raise exception 'FAIL: Bob read % subscriptions that are not his', n; end if;

  delete from public.push_subscriptions where endpoint = 'https://push.test.invalid/alice';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Bob deleted Alice''s subscription'; end if;

  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://push.test.invalid/fake', 'k', 'a');
    raise exception 'FAIL: Bob inserted a subscription directly';
  exception when insufficient_privilege then null;
  end;

  select count(*) into n from public.notification_prefs;
  if n <> 0 then raise exception 'FAIL: Bob read Alice''s preferences'; end if;

  update public.notification_prefs set food = true
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Bob changed Alice''s preferences'; end if;

  begin
    insert into public.notification_prefs (user_id, pings)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', false);
    raise exception 'FAIL: Bob created preferences for someone else';
  exception when insufficient_privilege then null;
  end;

  begin
    select count(*) into n from public.notification_log;
    raise exception 'FAIL: Bob read the notification log';
  exception when insufficient_privilege then null;
  end;

  begin
    perform private.send_notify('{}'::jsonb);
    raise exception 'FAIL: Bob called private.send_notify';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.requests set escalated_at = now() where id = 'e1e1e1e1-0000-4000-8000-000000000002';
    raise exception 'FAIL: Bob set escalated_at';
  exception when insufficient_privilege then null;
  end;

  -- What Bob IS allowed to do.
  perform public.save_push_subscription('https://push.test.invalid/bob', 'key-b', 'auth-b', 'test');
  select count(*) into n from public.push_subscriptions;
  if n <> 1 then raise exception 'FAIL: Bob should see exactly his own subscription, saw %', n; end if;

  begin
    perform public.save_push_subscription('http://push.test.invalid/plain', 'k', 'a', 'test');
    raise exception 'FAIL: a plain http endpoint was accepted';
  exception when check_violation then null;
  end;

  insert into public.notification_prefs (user_id, pings) values
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
  update public.notification_prefs set quiet_start = '22:00'
  where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: Bob could not update his own preferences'; end if;

  begin
    update public.notification_prefs set user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'FAIL: Bob moved his preferences to another user';
  exception when insufficient_privilege then null;
  end;

  -- A shared phone: the same browser endpoint now belongs to whoever is signed in.
  perform public.save_push_subscription('https://push.test.invalid/alice', 'key-a2', 'auth-a2', 'test');
  select user_id into v_uid from public.push_subscriptions
  where endpoint = 'https://push.test.invalid/alice';
  if v_uid is distinct from 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' then
    raise exception 'FAIL: re-saving an endpoint did not move it to the caller';
  end if;

  -- expires_at is set by the database, whatever the client sends.
  update public.statuses set bringing = 'Food', expires_at = now() + interval '30 days'
  where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  select expires_at into v_ts from public.statuses where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_ts is distinct from now() + interval '4 hours' then
    raise exception 'FAIL: expires_at was % instead of 4 hours from now', v_ts;
  end if;

  update public.statuses set bringing = null where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  select expires_at into v_ts from public.statuses where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_ts is not null then raise exception 'FAIL: expires_at not cleared with bringing'; end if;
end $$;

-- ---- Anonymous visitors -------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare n int;
begin
  begin
    select count(*) into n from public.push_subscriptions;
    raise exception 'FAIL: anonymous user read subscriptions';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.save_push_subscription('https://push.test.invalid/anon', 'k', 'a', 'test');
    raise exception 'FAIL: anonymous user saved a subscription';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- ---- Scheduled jobs (they run as the database owner) -------------------------
do $$
declare n int; v_before timestamptz; v_after timestamptz; v_bringing text;
begin
  -- Escalation fires once: the first run picks the 11-minute-old request only,
  -- the second run finds nothing.
  select private.escalate_urgent_requests() into n;
  if n <> 1 then raise exception 'FAIL: first escalation run escalated % requests, expected 1', n; end if;
  select private.escalate_urgent_requests() into n;
  if n <> 0 then raise exception 'FAIL: second escalation run escalated % requests, expected 0', n; end if;
  select count(*) into n from public.requests where escalated_at is not null;
  if n <> 1 then raise exception 'FAIL: % requests marked escalated, expected 1', n; end if;

  -- Expiry: give Alice an old "bringing" that expired an hour ago.
  perform set_config('wegood.system_update', '1', true);
  update public.statuses
  set bringing = 'Food', expires_at = now() - interval '1 hour'
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  perform set_config('wegood.system_update', '', true);
  select updated_at into v_before from public.statuses where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  select private.clear_expired_statuses() into n;
  if n <> 1 then raise exception 'FAIL: expiry job cleared % statuses, expected 1', n; end if;
  select bringing, updated_at into v_bringing, v_after
  from public.statuses where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_bringing is not null then raise exception 'FAIL: expired bringing was not cleared'; end if;
  if v_after is distinct from v_before then
    raise exception 'FAIL: the expiry job made an old status look fresh';
  end if;
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

select 'ALL PHASE 3 RLS CHECKS PASSED' as result;
