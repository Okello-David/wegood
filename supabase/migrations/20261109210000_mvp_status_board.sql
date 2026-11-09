-- Phase 1: rooms, members, profiles, statuses, and the security around them.

create type public.location_preset as enum
  ('home', 'campus', 'town', 'work', 'travelling', 'sleeping', 'unknown');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- 32-character alphabet without look-alikes such as 0/O and 1/I.
  invite_code text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  -- The room's home point, set by an admin in Phase 4. Never a user's position.
  home_lat double precision check (home_lat between -90 and 90),
  home_lng double precision check (home_lng between -180 and 180),
  radius_m integer not null default 60 check (radius_m between 10 and 1000),
  created_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
-- The primary key indexes room_id first; policies also look up by user_id.
create index room_members_user_id_idx on public.room_members (user_id);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 30),
  -- Up to 16 characters because one emoji can be several code points.
  avatar_emoji text not null default '🙂' check (char_length(avatar_emoji) between 1 and 16),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

create table public.statuses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  location_preset public.location_preset not null default 'unknown',
  at_home boolean,
  at_home_source text check (at_home_source in ('manual', 'geo')),
  at_home_updated_at timestamptz,
  hunger smallint not null default 0 check (hunger between 0 and 3),
  bringing text check (char_length(bringing) <= 80),
  mood_text text check (char_length(mood_text) <= 80),
  eta timestamptz,
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  -- A status can only exist for a real membership; leaving a room removes it.
  foreign key (room_id, user_id) references public.room_members (room_id, user_id) on delete cascade
);
create index statuses_room_id_idx on public.statuses (room_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Timestamps are set here, not by clients, so nobody can fake a fresh status.
create function public.touch_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.at_home_updated_at := case when new.at_home is null then null else now() end;
  elsif new.at_home is distinct from old.at_home
     or new.at_home_source is distinct from old.at_home_source then
    new.at_home_updated_at := now();
  else
    new.at_home_updated_at := old.at_home_updated_at;
  end if;
  return new;
end;
$$;

create trigger statuses_touch
  before insert or update on public.statuses
  for each row execute function public.touch_status();

-- Security definer because the signup process has no rights on public.profiles.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(split_part(new.email, '@', 1)), ''), 'Roommate'), 30)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts created before this migration need a profile too.
insert into public.profiles (id, display_name)
select id, left(coalesce(nullif(btrim(split_part(email, '@', 1)), ''), 'Roommate'), 30)
from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Policy helpers
-- ---------------------------------------------------------------------------
-- Security definer lets these read room_members without triggering its own
-- policies, which would otherwise recurse forever. The empty search_path stops
-- anyone hijacking them with look-alike tables. They only answer questions
-- about the signed-in user.

create function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = (select auth.uid())
  );
$$;

create function public.is_room_admin(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create function public.shares_room(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Creating and joining rooms
-- ---------------------------------------------------------------------------
-- Clients have no write access to room_members, so nobody can add themselves
-- to a room or promote themselves. These two functions are the only way in.
-- statuses.user_id is a primary key, so a user can have only one room for now;
-- it also makes two simultaneous requests fail safely.

create function public.create_room(p_name text)
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

  -- Retry in the very unlikely case a generated code is already taken.
  for attempt in 1..10 loop
    -- The first 6 bytes of a v4 UUID are random. 32 letters means each byte
    -- mod 32 picks a letter evenly.
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

  return v_room_id;
end;
$$;

create function public.join_room(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if exists (select 1 from public.room_members where user_id = v_user_id) then
    raise exception 'already_in_room';
  end if;

  select id into v_room_id from public.rooms where invite_code = upper(btrim(p_code));
  if v_room_id is null then
    raise exception 'invalid_code';
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_room_id, v_user_id, 'member');
  insert into public.statuses (user_id, room_id) values (v_user_id, v_room_id);

  return v_room_id;
end;
$$;

-- Functions are executable by everyone by default, so lock them down.
revoke all on function public.touch_status() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_room_member(uuid) from public, anon;
revoke all on function public.is_room_admin(uuid) from public, anon;
revoke all on function public.shares_room(uuid) from public, anon;
revoke all on function public.create_room(text) from public, anon;
revoke all on function public.join_room(text) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_room_admin(uuid) to authenticated;
grant execute on function public.shares_room(uuid) to authenticated;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.profiles enable row level security;
alter table public.statuses enable row level security;

-- Grants decide which operations and columns a role may touch; policies then
-- decide which rows. Both layers have to allow a change.
revoke all on public.rooms, public.room_members, public.profiles, public.statuses
  from anon, authenticated;
grant select on public.rooms, public.room_members, public.profiles, public.statuses
  to authenticated;
grant update (name, home_lat, home_lng, radius_m) on public.rooms to authenticated;
grant insert, update on public.profiles, public.statuses to authenticated;

create policy "Members can read their rooms"
  on public.rooms for select to authenticated
  using (public.is_room_member(id));

create policy "Admins can update their rooms"
  on public.rooms for update to authenticated
  using (public.is_room_admin(id))
  with check (public.is_room_admin(id));

create policy "Members can read their room's members"
  on public.room_members for select to authenticated
  using (public.is_room_member(room_id));

create policy "Users can read themselves and roommates"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_room(id));

create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Members can read statuses in their rooms"
  on public.statuses for select to authenticated
  using (public.is_room_member(room_id));

create policy "Users can create their own status in their room"
  on public.statuses for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_room_member(room_id));

create policy "Users can update their own status in their room"
  on public.statuses for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Realtime applies the SELECT policies above to each subscriber.
alter publication supabase_realtime add table public.statuses, public.profiles;
