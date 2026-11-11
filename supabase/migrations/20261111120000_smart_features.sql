-- Phase 4: geofence auto-home, energy battery, schedule.
--
-- Privacy: no table here (or anywhere) stores a user's position. The only
-- coordinates in the database are the ROOM's home point (rooms.home_lat/lng,
-- set by an admin since Phase 1). Phones compare their own position with it
-- locally and send just true/false through set_geo_home() below.

create type public.activity_type as enum
  ('class', 'study', 'gym', 'football', 'town', 'work', 'chill', 'nap');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
-- All three carry room_id (the spec only had user_id for the first two):
-- Realtime can only filter on a column of the row itself, and the foreign key
-- to room_members removes a person's rows when they leave the room.
-- user_id defaults to the signed-in user, so the app never has to send it.

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  room_id uuid not null,
  type public.activity_type not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or ended_at > started_at),
  foreign key (room_id, user_id) references public.room_members (room_id, user_id) on delete cascade
);
create index activities_room_started_idx on public.activities (room_id, started_at);

create table public.energy_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  room_id uuid not null,
  kind text not null check (kind in ('wake', 'feel')),
  feel smallint check (feel between 1 and 5),
  created_at timestamptz not null default now(),
  -- A 'feel' check-in needs a feel value; a 'wake' one must not have one.
  check ((kind = 'feel') = (feel is not null)),
  foreign key (room_id, user_id) references public.room_members (room_id, user_id) on delete cascade
);
create index energy_checkins_room_created_idx on public.energy_checkins (room_id, created_at);

create table public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  room_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 40),
  type public.activity_type not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Weekly repeats: 0 = Sunday ... 6 = Saturday (same as JavaScript getDay()).
  -- Empty means a one-off. Each repeat keeps the time of day of starts_at.
  repeat_days smallint[] not null default '{}'
    check (repeat_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  -- Dates (phone's calendar) on which a weekly item doesn't happen.
  skipped_dates date[] not null default '{}',
  created_at timestamptz not null default now(),
  -- 18 hours is the whole visible day (06:00-24:00); longer is a mistake.
  check (ends_at > starts_at and ends_at - starts_at <= interval '18 hours'),
  foreign key (room_id, user_id) references public.room_members (room_id, user_id) on delete cascade
);
create index schedule_items_room_idx on public.schedule_items (room_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: room members read, only the owner writes
-- ---------------------------------------------------------------------------

alter table public.activities enable row level security;
alter table public.energy_checkins enable row level security;
alter table public.schedule_items enable row level security;

revoke all on public.activities, public.energy_checkins, public.schedule_items
  from anon, authenticated;

-- Column grants: an activity can only be stopped (ended_at), never moved or
-- retyped; check-ins can't be edited at all, only deleted (undo).
grant select, delete on public.activities, public.energy_checkins, public.schedule_items
  to authenticated;
grant insert (room_id, type, started_at, ended_at) on public.activities to authenticated;
grant update (ended_at) on public.activities to authenticated;
grant insert (room_id, kind, feel) on public.energy_checkins to authenticated;
grant insert (room_id, title, type, starts_at, ends_at, repeat_days, skipped_dates)
  on public.schedule_items to authenticated;
grant update (title, type, starts_at, ends_at, repeat_days, skipped_dates)
  on public.schedule_items to authenticated;

create policy "Members can read their room's activities"
  on public.activities for select to authenticated
  using (public.is_room_member(room_id));
create policy "Users can add their own activities"
  on public.activities for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_room_member(room_id));
create policy "Users can update their own activities"
  on public.activities for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their own activities"
  on public.activities for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Members can read their room's check-ins"
  on public.energy_checkins for select to authenticated
  using (public.is_room_member(room_id));
create policy "Users can add their own check-ins"
  on public.energy_checkins for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_room_member(room_id));
create policy "Users can delete their own check-ins"
  on public.energy_checkins for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Members can read their room's schedules"
  on public.schedule_items for select to authenticated
  using (public.is_room_member(room_id));
create policy "Users can add their own schedule items"
  on public.schedule_items for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_room_member(room_id));
create policy "Users can update their own schedule items"
  on public.schedule_items for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their own schedule items"
  on public.schedule_items for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Geofence: the phone reports only "at home: yes/no"
-- ---------------------------------------------------------------------------
-- touch_status (Phase 3) only moves at_home_updated_at when the value or its
-- source changes. A geo check that confirms "still home" must refresh it too,
-- otherwise the Phase 3 notify routing would treat that person as away after
-- 3 hours. set_geo_home() raises the `wegood.geo_refresh` flag for that;
-- browsers can't set flags themselves (same reasoning as wegood.system_update).
create or replace function public.touch_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and current_setting('wegood.system_update', true) = '1' then
    new.updated_at := old.updated_at;
    new.at_home_updated_at := old.at_home_updated_at;
    return new;
  end if;

  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.at_home_updated_at := case when new.at_home is null then null else now() end;
  elsif new.at_home is distinct from old.at_home
     or new.at_home_source is distinct from old.at_home_source
     or current_setting('wegood.geo_refresh', true) = '1' then
    new.at_home_updated_at := now();
  else
    new.at_home_updated_at := old.at_home_updated_at;
  end if;

  if new.bringing is null and new.mood_text is null and new.eta is null then
    new.expires_at := null;
  elsif tg_op = 'INSERT'
     or new.bringing is distinct from old.bringing
     or new.mood_text is distinct from old.mood_text
     or new.eta is distinct from old.eta then
    new.expires_at := now() + interval '4 hours';
  else
    new.expires_at := old.expires_at;
  end if;
  return new;
end;
$$;

-- The only way geofence results reach the database. Its single parameter is a
-- boolean, so there is no way to send coordinates through it even by mistake.
-- Security invoker would also work (RLS lets you update your own status), but
-- definer keeps the location_preset rules below in one trusted place.
create function public.set_geo_home(p_at_home boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_at_home is null then
    raise exception 'at_home_required';
  end if;

  perform set_config('wegood.geo_refresh', '1', true);
  update public.statuses
  set at_home = p_at_home,
      at_home_source = 'geo',
      location_preset = case
        -- Sleeping at home is still sleeping.
        when p_at_home and location_preset = 'sleeping' then location_preset
        when p_at_home then 'home'::public.location_preset
        -- Left the house: "Home" is now wrong, but we don't know where they went.
        when location_preset = 'home' then 'unknown'::public.location_preset
        else location_preset
      end
  where user_id = v_user_id;
  perform set_config('wegood.geo_refresh', '', true);
end;
$$;

revoke all on function public.set_geo_home(boolean) from public, anon;
grant execute on function public.set_geo_home(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime
  add table public.activities, public.energy_checkins, public.schedule_items;
