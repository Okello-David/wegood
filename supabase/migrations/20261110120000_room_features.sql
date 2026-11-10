-- Phase 2: pantry items, requests, and the activity feed.
--
-- Pattern used throughout: clients may only change the columns that a person
-- would really choose (an item's state, a request's text). Who did it and when
-- is filled in by the database, so nobody can fake it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.pantry_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  kind text not null default 'grocery' check (kind in ('grocery', 'ready_food')),
  state text not null default 'have' check (state in ('have', 'low', 'out')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
-- One "Sugar" per room, whatever the capitals or spaces. Also serves as the
-- room_id index.
create unique index pantry_items_room_name_key
  on public.pantry_items (room_id, lower(btrim(name)));

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  kind text not null check (kind in ('errand', 'clothes', 'visitor_note', 'other')),
  text text not null check (char_length(btrim(text)) between 1 and 200),
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent')),
  -- Defaults to the caller; the insert policy also refuses anyone else.
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  for_user uuid references auth.users (id) on delete set null,
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index requests_room_created_idx on public.requests (room_id, created_at desc);

create table public.feed_events (
  -- A plain counter keeps events in exact order even within the same instant.
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  kind text not null check (kind in ('item_out', 'request_created', 'request_claimed', 'request_done')),
  message text not null,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index feed_events_room_created_idx on public.feed_events (room_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- "Is that person in this room?" Only answers for rooms the caller is in, so it
-- can't be used to probe other rooms.
create function public.is_member_of(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_room_member(p_room_id) and exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = p_user_id
  );
$$;

create function public.my_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select display_name from public.profiles where id = (select auth.uid())),
    'Someone'
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.touch_pantry_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger pantry_items_touch
  before insert or update on public.pantry_items
  for each row execute function public.touch_pantry_item();

-- Feed triggers run as the table owner (security definer) because clients have
-- no insert rights on feed_events. That is what keeps the feed trustworthy.
create function public.feed_pantry_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'out' and old.state <> 'out' then
    insert into public.feed_events (room_id, kind, message, actor_id)
    values (
      new.room_id, 'item_out',
      '🚨 ' || new.name || ' ran out, says ' || public.my_display_name(),
      auth.uid()
    );
  end if;
  return null;
end;
$$;

create trigger pantry_items_feed
  after update of state on public.pantry_items
  for each row execute function public.feed_pantry_item();

create function public.feed_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := public.my_display_name();
  v_text text := left(new.text, 80);
  v_for text;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'visitor_note' then
      select display_name into v_for from public.profiles where id = new.for_user;
      insert into public.feed_events (room_id, kind, message, actor_id)
      values (new.room_id, 'request_created',
        '📬 Note for ' || coalesce(v_for, 'someone') || ': ' || v_text, auth.uid());
    else
      insert into public.feed_events (room_id, kind, message, actor_id)
      values (new.room_id, 'request_created',
        case when new.urgency = 'urgent' then '🔥 ' else '🙋 ' end
          || v_name || ' asked: ' || v_text,
        auth.uid());
    end if;
  elsif new.claimed_by is not null and old.claimed_by is null then
    insert into public.feed_events (room_id, kind, message, actor_id)
    values (new.room_id, 'request_claimed', '🙌 ' || v_name || ' is on it: ' || v_text, auth.uid());
  elsif new.done_at is not null and old.done_at is null then
    insert into public.feed_events (room_id, kind, message, actor_id)
    values (new.room_id, 'request_done', '✅ Done: ' || v_text || ' (' || v_name || ')', auth.uid());
  end if;
  return null;
end;
$$;

create trigger requests_feed
  after insert or update on public.requests
  for each row execute function public.feed_request();

-- ---------------------------------------------------------------------------
-- Claiming and finishing requests
-- ---------------------------------------------------------------------------
-- Clients can't update requests directly. These functions are the only way to
-- change one, so the rules live in one place.
--
-- Why claiming is race-safe: UPDATE locks the row. If two people claim at the
-- same moment, the second UPDATE waits for the first to commit, then re-checks
-- "claimed_by is null", which is now false, so it changes nothing. Exactly one
-- person wins; the loser gets 'already_claimed' with the winner's name.

create function public.claim_request(p_id uuid)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.requests;
  v_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.requests
  set claimed_by = v_uid, claimed_at = now()
  where id = p_id
    and claimed_by is null
    and done_at is null
    and kind <> 'visitor_note'
    and public.is_room_member(room_id)
  returning * into v_req;
  if found then
    return v_req;
  end if;

  -- Nothing changed. Work out why, for a friendly message.
  select * into v_req from public.requests
  where id = p_id and public.is_room_member(room_id);
  if not found then
    raise exception 'not_found';
  elsif v_req.done_at is not null then
    raise exception 'already_done';
  elsif v_req.kind = 'visitor_note' then
    raise exception 'cannot_claim_note';
  end if;
  select display_name into v_name from public.profiles where id = v_req.claimed_by;
  raise exception 'already_claimed' using detail = coalesce(v_name, 'Someone');
end;
$$;

-- The claimer or the creator can finish a request. A visitor note can also be
-- cleared by the person it is for ("Got it").
create function public.complete_request(p_id uuid)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.requests;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.requests
  set done_at = now()
  where id = p_id
    and done_at is null
    and public.is_room_member(room_id)
    and (
      claimed_by = v_uid
      or created_by = v_uid
      or (kind = 'visitor_note' and for_user = v_uid)
    )
  returning * into v_req;
  if found then
    return v_req;
  end if;

  select * into v_req from public.requests
  where id = p_id and public.is_room_member(room_id);
  if not found then
    raise exception 'not_found';
  elsif v_req.done_at is not null then
    raise exception 'already_done';
  end if;
  raise exception 'not_allowed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Starter pantry
-- ---------------------------------------------------------------------------
-- Security invoker: it runs with the caller's own rights, so the normal RLS
-- policies decide whether they may add items to this room.
create function public.seed_pantry(p_room_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_room_member(p_room_id) then
    raise exception 'not_a_member';
  end if;

  insert into public.pantry_items (room_id, name, kind)
  select p_room_id, item, 'grocery'
  from unnest(array[
    'Sugar', 'Salt', 'Rice', 'Posho', 'Beans', 'Cooking oil',
    'Bread', 'Tea leaves', 'Water', 'Charcoal/gas'
  ]) as item
  on conflict (room_id, lower(btrim(name))) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Same as Phase 1, plus a starter pantry for every new room.
create or replace function public.create_room(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_code text;
  v_bytes bytea;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if exists (select 1 from public.room_members where user_id = v_user_id) then
    raise exception 'already_in_room';
  end if;

  for attempt in 1..10 loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;

    begin
      insert into public.rooms (name, invite_code)
      values (btrim(p_name), v_code)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_room_id := null;
    end;
  end loop;

  if v_room_id is null then
    raise exception 'invite_code_failed';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, v_user_id, 'admin');
  insert into public.statuses (user_id, room_id) values (v_user_id, v_room_id);
  perform public.seed_pantry(v_room_id);

  return v_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function permissions
-- ---------------------------------------------------------------------------

revoke all on function public.touch_pantry_item() from public, anon, authenticated;
revoke all on function public.feed_pantry_item() from public, anon, authenticated;
revoke all on function public.feed_request() from public, anon, authenticated;
revoke all on function public.is_member_of(uuid, uuid) from public, anon;
revoke all on function public.my_display_name() from public, anon;
revoke all on function public.claim_request(uuid) from public, anon;
revoke all on function public.complete_request(uuid) from public, anon;
revoke all on function public.seed_pantry(uuid) from public, anon;
revoke all on function public.create_room(text) from public, anon;
grant execute on function public.is_member_of(uuid, uuid) to authenticated;
grant execute on function public.my_display_name() to authenticated;
grant execute on function public.claim_request(uuid) to authenticated;
grant execute on function public.complete_request(uuid) to authenticated;
grant execute on function public.seed_pantry(uuid) to authenticated;
grant execute on function public.create_room(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.pantry_items enable row level security;
alter table public.requests enable row level security;
alter table public.feed_events enable row level security;

revoke all on public.pantry_items, public.requests, public.feed_events
  from anon, authenticated;

-- Pantry: any member can manage their room's items. room_id can be set when
-- adding but never changed afterwards (not in the update grant).
grant select, delete on public.pantry_items to authenticated;
grant insert (room_id, name, kind, state) on public.pantry_items to authenticated;
grant update (name, kind, state) on public.pantry_items to authenticated;

create policy "Members can read their room's items"
  on public.pantry_items for select to authenticated
  using (public.is_room_member(room_id));

create policy "Members can add items to their room"
  on public.pantry_items for insert to authenticated
  with check (public.is_room_member(room_id));

create policy "Members can update their room's items"
  on public.pantry_items for update to authenticated
  using (public.is_room_member(room_id))
  with check (public.is_room_member(room_id));

create policy "Members can delete their room's items"
  on public.pantry_items for delete to authenticated
  using (public.is_room_member(room_id));

-- Requests: insert and delete only. Claiming and finishing go through the
-- functions above, so there is no update grant at all.
grant select, delete on public.requests to authenticated;
grant insert (room_id, kind, text, urgency, for_user) on public.requests to authenticated;

create policy "Members can read their room's requests"
  on public.requests for select to authenticated
  using (public.is_room_member(room_id));

create policy "Members can create requests in their room"
  on public.requests for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_room_member(room_id)
    and (for_user is null or public.is_member_of(room_id, for_user))
    and (kind <> 'visitor_note' or for_user is not null)
  );

create policy "Creators can delete their open requests"
  on public.requests for delete to authenticated
  using (created_by = (select auth.uid()) and done_at is null);

-- Feed: read-only for clients; only the triggers above write to it.
grant select on public.feed_events to authenticated;

create policy "Members can read their room's feed"
  on public.feed_events for select to authenticated
  using (public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Inserts and updates are checked against the SELECT policies per subscriber.
-- Deletes can't be (the row is gone), so Realtime sends only the deleted id.
alter publication supabase_realtime add table
  public.pantry_items, public.requests, public.feed_events;
