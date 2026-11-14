-- Phase 5: the fun layer. Room points and a weekly MVP, and scheduled
-- "funny auto-messages". (Captions, avatars and animations are browser-only.)
--
-- Same rule as the feed since Phase 2: anything that could be faked for
-- bragging rights (points, MVP, auto-messages) is written only by the database
-- itself, from triggers and scheduled jobs. Browsers can only read it.

-- ---------------------------------------------------------------------------
-- Columns on existing tables
-- ---------------------------------------------------------------------------

-- "Monday 00:00" depends on where the room is. Not in the update grant, so only
-- the database (or the dashboard) can change it.
alter table public.rooms
  add column timezone text not null default 'Africa/Kampala'
  check (char_length(timezone) between 1 and 64);

-- When hunger last changed, for "starving for 3 hours". Set by touch_status.
alter table public.statuses add column hunger_updated_at timestamptz;

-- Switch for the starving and MVP pushes.
alter table public.notification_prefs add column fun boolean not null default true;
grant insert (fun), update (fun) on public.notification_prefs to authenticated;

-- Two new kinds of feed line: auto-messages and the MVP announcement.
alter table public.feed_events drop constraint feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check
  check (kind in ('item_out', 'request_created', 'request_claimed', 'request_done', 'auto', 'mvp'));

-- Same as Phase 4, plus hunger_updated_at. Clients can write any statuses
-- column, but this trigger overwrites hunger_updated_at on every path, so a
-- hand-made request can't fake "starving since yesterday".
create or replace function public.touch_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and current_setting('wegood.system_update', true) = '1' then
    new.updated_at := old.updated_at;
    new.at_home_updated_at := old.at_home_updated_at;
    new.hunger_updated_at := old.hunger_updated_at;
    return new;
  end if;

  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.at_home_updated_at := case when new.at_home is null then null else now() end;
    new.hunger_updated_at := now();
  else
    if new.at_home is distinct from old.at_home
       or new.at_home_source is distinct from old.at_home_source
       or current_setting('wegood.geo_refresh', true) = '1' then
      new.at_home_updated_at := now();
    else
      new.at_home_updated_at := old.at_home_updated_at;
    end if;

    if new.hunger is distinct from old.hunger then
      new.hunger_updated_at := now();
    else
      new.hunger_updated_at := old.hunger_updated_at;
    end if;
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

-- Existing rows: the best guess is "since the last update". The trigger would
-- overwrite this (and bump updated_at), so it is switched off for a moment.
-- Other triggers (notify) stay on but only react to changed bringing/state.
alter table public.statuses disable trigger statuses_touch;
update public.statuses set hunger_updated_at = updated_at where hunger_updated_at is null;
alter table public.statuses enable trigger statuses_touch;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.point_events (
  id bigint generated always as identity primary key,
  room_id uuid not null,
  user_id uuid not null,
  points integer not null check (points between 1 and 100),
  reason text not null check (reason in ('request_done', 'visitor_note', 'restock')),
  -- The request or pantry item that earned it. Not in the original spec: it
  -- lets the unique index below make "one payout per request" a hard rule.
  source_id uuid,
  created_at timestamptz not null default now(),
  -- Leaving the room takes your points with you.
  foreign key (room_id, user_id) references public.room_members (room_id, user_id) on delete cascade
);
create index point_events_room_created_idx on public.point_events (room_id, created_at);
create unique index point_events_once_per_request
  on public.point_events (reason, source_id)
  where reason in ('request_done', 'visitor_note');
create index point_events_restock_idx
  on public.point_events (source_id, created_at)
  where reason = 'restock';

-- One row per MVP per week (two rows = co-MVPs after a tie).
create table public.weekly_mvps (
  room_id uuid not null references public.rooms (id) on delete cascade,
  -- The Monday the week started, on the room's calendar.
  week_start date not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  points integer not null check (points > 0),
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (room_id, week_start, user_id)
);

-- Remembers which auto-message went out when, for "max once per day".
create table public.auto_message_log (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  kind text not null check (kind in ('starving', 'ghost_town', 'no_food')),
  -- The starving person; null for room-wide messages.
  subject_user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index auto_message_log_lookup_idx
  on public.auto_message_log (room_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- Awarding points
-- ---------------------------------------------------------------------------
-- In the private schema: browsers can't even see it, let alone call it. Only
-- the triggers below call it. "on conflict do nothing" means a second payout
-- for the same request is silently ignored instead of failing the user's tap.
create function private.award_points(
  p_room_id uuid,
  p_user_id uuid,
  p_points integer,
  p_reason text,
  p_source_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.point_events (room_id, user_id, points, reason, source_id)
  values (p_room_id, p_user_id, p_points, p_reason, p_source_id)
  on conflict do nothing;
end;
$$;

-- A request was finished.
--   Errands etc.: +10 (+15 urgent) to whoever claimed it, unless that's the
--   person who asked (no points for your own request).
--   Visitor note: +3 to the writer, but only when the person it's for taps
--   "Got it" themselves. That stops note-spamming for points.
create function private.points_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.done_at is null or old.done_at is not null then
    return null;
  end if;

  if new.kind = 'visitor_note' then
    if auth.uid() = new.for_user and new.for_user <> new.created_by then
      perform private.award_points(new.room_id, new.created_by, 3, 'visitor_note', new.id);
    end if;
  elsif new.claimed_by is not null and new.claimed_by <> new.created_by then
    perform private.award_points(
      new.room_id, new.claimed_by,
      case when new.urgency = 'urgent' then 15 else 10 end,
      'request_done', new.id
    );
  end if;
  return null;
end;
$$;

create trigger requests_points
  after update of done_at on public.requests
  for each row execute function private.points_request();

-- Out -> have: +5 to whoever restocked. Two guards against tapping Sugar round
-- in circles: it must have been "out" for 10 minutes (old.updated_at is when
-- it went out), and one item pays at most once every 12 hours.
create function private.points_pantry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'out' and new.state = 'have'
     and auth.uid() is not null
     and old.updated_at < now() - interval '10 minutes'
     and not exists (
       select 1 from public.point_events
       where reason = 'restock' and source_id = new.id
         and created_at > now() - interval '12 hours'
     ) then
    perform private.award_points(new.room_id, auth.uid(), 5, 'restock', new.id);
  end if;
  return null;
end;
$$;

create trigger pantry_items_points
  after update of state on public.pantry_items
  for each row execute function private.points_pantry();

-- ---------------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------------
-- This week (Monday 00:00 in the room's time zone until now).
-- `now() at time zone tz` gives the room's local clock; date_trunc('week')
-- rounds it down to Monday 00:00; `at time zone tz` turns that back into a
-- real moment. Security invoker: RLS on point_events still applies, so asking
-- about another room just returns nothing.
create function public.week_leaderboard(p_room_id uuid)
returns table (user_id uuid, points integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.user_id, sum(p.points)::integer as points
  from public.point_events p
  join public.rooms r on r.id = p.room_id
  where p.room_id = p_room_id
    and p.created_at >= (date_trunc('week', now() at time zone r.timezone) at time zone r.timezone)
  group by p.user_id
  order by points desc, p.user_id;
$$;

-- ---------------------------------------------------------------------------
-- Weekly MVP
-- ---------------------------------------------------------------------------

create function private.mvp_message(p_room_id uuid, p_week_start date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when count(*) = 1 then
      '🏆 ' || min(private.display_name(user_id)) || ' is Room MVP of the week with '
        || max(points) || ' points!'
    else
      '🏆 ' || string_agg(private.display_name(user_id), ' and ' order by user_id)
        || ' are Room MVPs of the week with ' || max(points) || ' points each!'
  end
  from public.weekly_mvps
  where room_id = p_room_id and week_start = p_week_start;
$$;

-- Runs every hour. For each room whose local clock has passed Monday 00:00
-- and whose last week has no MVP yet: crown the top scorer(s) and post to the
-- feed. Hourly + "not yet crowned" works in every time zone, is safe to run
-- twice, and catches up after a missed run. A 0-point week has no MVP.
--
-- The push waits until Monday 08:00 local: midnight is inside everyone's
-- default quiet hours, so it would be skipped anyway.
create function private.weekly_mvp_job()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_this_monday date;
  v_week date;
  v_local timestamp;
  v_crowned integer;
  v_total integer := 0;
  v_message text;
  v_actor uuid;
begin
  -- Step 1: crown.
  for r in select id, timezone from public.rooms loop
    v_this_monday := date_trunc('week', now() at time zone r.timezone)::date;
    v_week := v_this_monday - 7;
    continue when exists (
      select 1 from public.weekly_mvps where room_id = r.id and week_start = v_week
    );

    with totals as (
      select user_id, sum(points)::integer as pts
      from public.point_events
      where room_id = r.id
        and created_at >= (v_week::timestamp at time zone r.timezone)
        and created_at < (v_this_monday::timestamp at time zone r.timezone)
      group by user_id
    )
    insert into public.weekly_mvps (room_id, week_start, user_id, points)
    select r.id, v_week, user_id, pts
    from totals
    where pts > 0 and pts = (select max(pts) from totals);
    get diagnostics v_crowned = row_count;

    if v_crowned > 0 then
      v_message := private.mvp_message(r.id, v_week);
      select case when v_crowned = 1 then min(user_id::text)::uuid end into v_actor
      from public.weekly_mvps where room_id = r.id and week_start = v_week;
      insert into public.feed_events (room_id, kind, message, actor_id)
      values (r.id, 'mvp', v_message, v_actor);
      v_total := v_total + 1;
    end if;
  end loop;

  -- Step 2: push, once per room and week, between Monday 08:00 and Tuesday
  -- 00:00 local. Later than that it's old news: mark it done without sending.
  for r in
    select m.room_id, m.week_start, ro.timezone
    from public.weekly_mvps m
    join public.rooms ro on ro.id = m.room_id
    where m.pushed_at is null
    group by m.room_id, m.week_start, ro.timezone
  loop
    v_local := now() at time zone r.timezone;
    continue when v_local < (r.week_start + 7)::timestamp + interval '8 hours';

    update public.weekly_mvps set pushed_at = now()
    where room_id = r.room_id and week_start = r.week_start and pushed_at is null;

    if v_local < (r.week_start + 8)::timestamp then
      perform private.send_notify(jsonb_build_object(
        'kind', 'mvp',
        'room_id', r.room_id,
        'audience', 'all',
        'urgency', 'normal',
        'title', private.mvp_message(r.room_id, r.week_start),
        'body', 'A new week starts now. Tap to see the leaderboard.',
        'url', '/'
      ));
    end if;
  end loop;

  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Funny auto-messages
-- ---------------------------------------------------------------------------
-- Every 30 minutes. Each message goes out at most once per 24 hours per room,
-- kind and person: the log row is inserted by the same statement that picks
-- who qualifies (insert ... select ... where not exists ... returning), so a
-- second run straight after finds nothing new. The advisory lock stops two
-- runs overlapping if one is ever slow.
create function private.run_auto_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_name text;
  v_hours integer;
  v_message text;
  v_count integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('wegood-auto-messages')) then
    return 0;
  end if;

  -- 1. Starving for 3+ hours. Ignored after 12 hours: that's a forgotten
  --    status, not an emergency, and it shouldn't nag every day.
  for r in
    insert into public.auto_message_log (room_id, kind, subject_user_id)
    select s.room_id, 'starving', s.user_id
    from public.statuses s
    where s.hunger = 3
      and s.hunger_updated_at <= now() - interval '3 hours'
      and s.hunger_updated_at > now() - interval '12 hours'
      and not exists (
        select 1 from public.auto_message_log l
        where l.room_id = s.room_id and l.kind = 'starving'
          and l.subject_user_id = s.user_id
          and l.created_at > now() - interval '24 hours'
      )
    returning room_id, subject_user_id
  loop
    v_name := private.display_name(r.subject_user_id);
    select floor(extract(epoch from now() - hunger_updated_at) / 3600)::integer into v_hours
    from public.statuses where user_id = r.subject_user_id;
    -- The name twice instead of "him/her": the app doesn't know pronouns.
    v_message := v_name || ' has been starving for ' || v_hours
      || ' hours. Someone check on ' || v_name || ' 👀';

    insert into public.feed_events (room_id, kind, message, actor_id)
    values (r.room_id, 'auto', v_message, r.subject_user_id);
    -- Everyone except the hungry person. The notify function applies the
    -- "Fun messages" switch and quiet hours.
    perform private.send_notify(jsonb_build_object(
      'kind', 'starving',
      'room_id', r.room_id,
      'sender_id', r.subject_user_id,
      'audience', 'all',
      'urgency', 'normal',
      'title', '🍽️ ' || v_name || ' is starving',
      'body', v_message,
      'url', '/'
    ));
    v_count := v_count + 1;
  end loop;

  -- 2. Nobody updated their status for 12+ hours (rooms of 2 or more).
  for r in
    insert into public.auto_message_log (room_id, kind)
    select ro.id, 'ghost_town'
    from public.rooms ro
    where (select count(*) from public.room_members m where m.room_id = ro.id) >= 2
      and (select max(s.updated_at) from public.statuses s where s.room_id = ro.id)
          < now() - interval '12 hours'
      and not exists (
        select 1 from public.auto_message_log l
        where l.room_id = ro.id and l.kind = 'ghost_town'
          and l.created_at > now() - interval '24 hours'
      )
    returning room_id
  loop
    insert into public.feed_events (room_id, kind, message)
    values (r.room_id, 'auto', 'Is anyone alive in this room? 🦗');
    v_count := v_count + 1;
  end loop;

  -- 3. Everyone is home and the ready food is all finished. "Home" means the
  --    same as for push routing: at_home, confirmed in the last 3 hours. Rooms
  --    that never use Ready food are left alone.
  for r in
    insert into public.auto_message_log (room_id, kind)
    select ro.id, 'no_food'
    from public.rooms ro
    where (select count(*) from public.room_members m where m.room_id = ro.id) >= 2
      and not exists (
        select 1 from public.room_members m
        left join public.statuses s on s.user_id = m.user_id
        where m.room_id = ro.id
          and not (coalesce(s.at_home, false)
                   and s.at_home_updated_at > now() - interval '3 hours')
      )
      and exists (
        select 1 from public.pantry_items p
        where p.room_id = ro.id and p.kind = 'ready_food'
      )
      and not exists (
        select 1 from public.pantry_items p
        where p.room_id = ro.id and p.kind = 'ready_food' and p.state <> 'out'
      )
      and not exists (
        select 1 from public.auto_message_log l
        where l.room_id = ro.id and l.kind = 'no_food'
          and l.created_at > now() - interval '24 hours'
      )
    returning room_id
  loop
    insert into public.feed_events (room_id, kind, message)
    select r.room_id, 'auto',
      count(*) || ' people, 0 food. Emergency meeting. 🚨'
    from public.room_members where room_id = r.room_id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

select cron.schedule('wegood-auto-messages', '*/30 * * * *',
  $$select private.run_auto_messages()$$);
select cron.schedule('wegood-weekly-mvp', '5 * * * *',
  $$select private.weekly_mvp_job()$$);

-- ---------------------------------------------------------------------------
-- Function permissions
-- ---------------------------------------------------------------------------

revoke all on function private.award_points(uuid, uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function private.points_request() from public, anon, authenticated;
revoke all on function private.points_pantry() from public, anon, authenticated;
revoke all on function private.mvp_message(uuid, date) from public, anon, authenticated;
revoke all on function private.weekly_mvp_job() from public, anon, authenticated;
revoke all on function private.run_auto_messages() from public, anon, authenticated;
revoke all on function public.week_leaderboard(uuid) from public, anon;
grant execute on function public.week_leaderboard(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.point_events enable row level security;
alter table public.weekly_mvps enable row level security;
alter table public.auto_message_log enable row level security;

revoke all on public.point_events, public.weekly_mvps, public.auto_message_log
  from anon, authenticated;

-- Points and MVPs: read-only for members. No insert, update or delete grant
-- at all, so even a hand-crafted API request can't give anyone points.
grant select on public.point_events, public.weekly_mvps to authenticated;

create policy "Members can read their room's points"
  on public.point_events for select to authenticated
  using (public.is_room_member(room_id));

create policy "Members can read their room's MVPs"
  on public.weekly_mvps for select to authenticated
  using (public.is_room_member(room_id));

-- auto_message_log: RLS on, no grants or policies. Invisible to app users.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.point_events, public.weekly_mvps;
