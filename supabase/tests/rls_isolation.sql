-- Proves room isolation. Everything happens in one transaction that is rolled
-- back, so it leaves no data behind. Any failed check raises an error.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
-- Or paste it into the Supabase SQL Editor.
-- Success is a final row reading "ALL RLS CHECKS PASSED".

begin;

-- Alice (admin) and Bob are in room 1. Carol is the outsider, in room 2.
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

insert into public.statuses (user_id, room_id, hunger) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 1),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 2),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 3);

-- ---- Carol: the outsider ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.statuses where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read % statuses', n; end if;

  select count(*) into n from public.rooms where id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read the room'; end if;

  select count(*) into n from public.room_members where room_id = '11111111-1111-4111-8111-111111111111';
  if n <> 0 then raise exception 'FAIL: outsider read % members', n; end if;

  select count(*) into n from public.profiles where id <> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if n <> 0 then raise exception 'FAIL: outsider read % profiles', n; end if;

  update public.statuses set hunger = 0 where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider updated a status'; end if;

  update public.profiles set display_name = 'hacked' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: outsider updated a profile'; end if;

  begin
    update public.statuses set room_id = '11111111-1111-4111-8111-111111111111'
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    raise exception 'FAIL: outsider moved their status into our room';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.statuses (user_id, room_id)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111');
    raise exception 'FAIL: outsider posted into our room';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.room_members (room_id, user_id, role)
    values ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'admin');
    raise exception 'FAIL: outsider added themselves to our room';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.join_room('AAAAAA');
    raise exception 'FAIL: user joined a second room';
  exception when raise_exception then
    if sqlerrm <> 'already_in_room' then raise; end if;
  end;
end $$;

-- ---- Bob: an ordinary member ------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.statuses;
  if n <> 2 then raise exception 'FAIL: member saw % statuses, expected 2', n; end if;

  select count(*) into n from public.profiles;
  if n <> 2 then raise exception 'FAIL: member saw % profiles, expected 2', n; end if;

  update public.statuses set hunger = 3 where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: member could not update own status'; end if;

  update public.statuses set hunger = 0 where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: member updated a roommate''s status'; end if;

  update public.rooms set name = 'Bob rules' where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: non-admin edited room settings'; end if;

  begin
    update public.room_members set role = 'admin'
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'FAIL: member promoted themselves';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- Alice: the admin -------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

do $$
declare n int;
begin
  update public.rooms set radius_m = 80 where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin could not edit own room'; end if;

  update public.rooms set radius_m = 80 where id = '22222222-2222-4222-8222-222222222222';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: admin edited another room'; end if;

  begin
    update public.rooms set invite_code = 'CCCCCC' where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'FAIL: invite code was directly editable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- Not signed in ----------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  begin
    perform 1 from public.statuses;
    raise exception 'FAIL: anonymous user could query statuses';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.join_room('AAAAAA');
    raise exception 'FAIL: anonymous user could call join_room';
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

select 'ALL RLS CHECKS PASSED' as result;
