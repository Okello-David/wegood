-- Phase 3: web push. Device subscriptions, per-user preferences, a send log,
-- the triggers that ask the `notify` Edge Function to send, and two scheduled
-- jobs (escalating urgent requests, clearing old statuses).
--
-- How a notification leaves the database:
--   a row changes -> trigger -> private.send_notify() -> pg_net HTTP POST ->
--   Edge Function `notify` -> push service (Google/Apple/Mozilla) -> phone.
-- pg_net queues the request and sends it after the transaction commits, so a
-- slow or broken push never delays or fails the roommate's tap.

create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

-- Internal functions live here. PostgREST only exposes `public`, so nothing in
-- this schema can be called from a browser.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per device (browser). The three values come from the browser's
-- PushManager; together they are the "address" a push is sent to.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- https only: the Edge Function POSTs to this URL, so it must not be
  -- something a user could point at an internal address over plain http.
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2000),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- No row means "all defaults", so nobody needs a row until they change something.
create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requests boolean not null default true,
  visitor_notes boolean not null default true,
  food boolean not null default true,
  bringing boolean not null default true,
  pings boolean not null default true,
  quiet_enabled boolean not null default true,
  quiet_start time not null default '23:00',
  quiet_end time not null default '06:00',
  -- Quiet hours are in the user's own clock, so we need their time zone. The
  -- browser sends its zone; this default suits the first room.
  timezone text not null default 'Africa/Kampala' check (char_length(timezone) between 1 and 64),
  updated_at timestamptz not null default now()
);

-- Written only by the Edge Function (service role). Used for the rate limit and
-- for answering "why did/didn't my phone buzz?".
create table public.notification_log (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null,
  kind text not null,
  title text not null,
  rule text not null,
  targeted jsonb not null default '[]'::jsonb,
  skipped jsonb not null default '[]'::jsonb,
  sent integer not null default 0,
  created_at timestamptz not null default now()
);
create index notification_log_sender_created_idx
  on public.notification_log (sender_id, created_at desc);

-- Set once by the escalation job. Clients have no UPDATE grant on requests, so
-- they can't set or clear it.
alter table public.requests add column escalated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Saving a subscription
-- ---------------------------------------------------------------------------
-- A function instead of a plain insert because of shared phones: if Alice signs
-- out and Bob signs in on the same browser, the endpoint already exists under
-- Alice, and RLS would (rightly) stop Bob touching her row. Whoever holds the
-- endpoint and its keys controls that browser, so moving the row to them is safe.
create function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

create function public.touch_notification_prefs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger notification_prefs_touch
  before insert or update on public.notification_prefs
  for each row execute function public.touch_notification_prefs();

-- ---------------------------------------------------------------------------
-- Statuses: "bringing", mood and ETA expire 4 hours after they were set
-- ---------------------------------------------------------------------------
-- Same trigger as Phase 1 plus two things:
--   1. expires_at is set here (not by clients) whenever bringing/mood/eta change.
--   2. The clean-up job below must not make an old card look fresh, so when it
--      sets the `wegood.system_update` flag the timestamps are left alone.
--      Browsers can't set that flag: they can only reach tables and functions
--      in `public` through the API, never run SET themselves.
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
     or new.at_home_source is distinct from old.at_home_source then
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

-- Statuses set before this migration get their 4 hours from now.
select set_config('wegood.system_update', '1', true);
update public.statuses
set expires_at = now() + interval '4 hours'
where expires_at is null
  and (bringing is not null or mood_text is not null or eta is not null);
select set_config('wegood.system_update', '', true);

-- ---------------------------------------------------------------------------
-- Calling the Edge Function
-- ---------------------------------------------------------------------------
-- The function's URL and a shared secret are kept in Supabase Vault (encrypted
-- at rest), not in this file, because they differ per environment and the
-- secret must never be in git. See docs/SETUP.md for the two lines that set
-- them. If they are missing, nothing is sent and the app works as before.
create function private.send_notify(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_hook_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := p_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    timeout_milliseconds := 8000
  );
exception when others then
  -- A notification is a nice-to-have. Never let it undo the user's change.
  raise warning 'send_notify failed: %', sqlerrm;
end;
$$;

create function private.display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select display_name from public.profiles where id = p_user_id), 'Someone');
$$;

-- New request. A visitor note goes only to the person it is for; everything
-- else follows the routing rule (people at home first).
create function private.notify_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := private.display_name(new.created_by);
begin
  if new.kind = 'visitor_note' then
    perform private.send_notify(jsonb_build_object(
      'kind', 'visitor_note',
      'room_id', new.room_id,
      'sender_id', new.created_by,
      'for_user', new.for_user,
      'urgency', new.urgency,
      'title', '📬 Note for you from ' || v_name,
      'body', left(new.text, 150),
      'url', '/'
    ));
  else
    perform private.send_notify(jsonb_build_object(
      'kind', 'request',
      'room_id', new.room_id,
      'sender_id', new.created_by,
      'urgency', new.urgency,
      'title', case when new.urgency = 'urgent'
                 then '🔥 Urgent: ' || v_name || ' needs help'
                 else '🙋 ' || v_name || ' asked' end,
      'body', left(new.text, 150),
      'url', '/requests'
    ));
  end if;
  return null;
end;
$$;

create trigger requests_notify
  after insert on public.requests
  for each row execute function private.notify_request();

-- Ready food ran out. Groceries don't notify; they only show in the feed.
create function private.notify_pantry_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'ready_food' and new.state = 'out' and old.state <> 'out' then
    perform private.send_notify(jsonb_build_object(
      'kind', 'food',
      'room_id', new.room_id,
      'sender_id', auth.uid(),
      'urgency', 'normal',
      'title', '🍽️ Food is finished at home',
      'body', new.name || ' is finished, says ' || private.display_name(auth.uid()),
      'url', '/stuff'
    ));
  end if;
  return null;
end;
$$;

create trigger pantry_items_notify
  after update of state on public.pantry_items
  for each row execute function private.notify_pantry_item();

-- Someone is bringing something home: good news for everyone, wherever they are.
create function private.notify_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bringing is not null and new.bringing is distinct from old.bringing then
    perform private.send_notify(jsonb_build_object(
      'kind', 'bringing',
      'room_id', new.room_id,
      'sender_id', new.user_id,
      'audience', 'all',
      'urgency', 'normal',
      'title', private.display_name(new.user_id) || ' is bringing ' || lower(new.bringing)
                 || case when new.bringing ilike '%food%' then ' 🍚' else ' 🛍️' end,
      'body', 'Tap to see who is where.',
      'url', '/'
    ));
  end if;
  return null;
end;
$$;

create trigger statuses_notify
  after update of bringing on public.statuses
  for each row execute function private.notify_status();

-- ---------------------------------------------------------------------------
-- Scheduled jobs
-- ---------------------------------------------------------------------------

-- Urgent and still unclaimed after 10 minutes: tell everyone, once.
-- Why "once" is guaranteed: the UPDATE both picks the rows (escalated_at is
-- null) and marks them, in one statement. A second run finds nothing to pick.
create function private.escalate_urgent_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.requests;
  v_count integer := 0;
begin
  for r in
    update public.requests
    set escalated_at = now()
    where urgency = 'urgent'
      and kind <> 'visitor_note'
      and claimed_by is null
      and done_at is null
      and escalated_at is null
      and created_at < now() - interval '10 minutes'
    returning *
  loop
    perform private.send_notify(jsonb_build_object(
      'kind', 'escalation',
      'room_id', r.room_id,
      'sender_id', r.created_by,
      'audience', 'all',
      'urgency', 'urgent',
      'title', '🔥 Still waiting: ' || private.display_name(r.created_by) || ' needs help',
      'body', left(r.text, 150),
      'url', '/requests'
    ));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function private.clear_expired_statuses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Tells touch_status to keep updated_at: nobody actually updated anything.
  perform set_config('wegood.system_update', '1', true);
  update public.statuses
  set bringing = null, mood_text = null, eta = null, expires_at = null
  where expires_at < now();
  get diagnostics v_count = row_count;
  perform set_config('wegood.system_update', '', true);
  return v_count;
end;
$$;

-- cron.schedule replaces a job with the same name, so re-running is safe.
select cron.schedule('wegood-escalate-urgent', '*/5 * * * *',
  $$select private.escalate_urgent_requests()$$);
select cron.schedule('wegood-clear-expired-statuses', '*/15 * * * *',
  $$select private.clear_expired_statuses()$$);

-- ---------------------------------------------------------------------------
-- Function permissions
-- ---------------------------------------------------------------------------

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
revoke all on function public.touch_notification_prefs() from public, anon, authenticated;
revoke all on function private.send_notify(jsonb) from public, anon, authenticated;
revoke all on function private.display_name(uuid) from public, anon, authenticated;
revoke all on function private.notify_request() from public, anon, authenticated;
revoke all on function private.notify_pantry_item() from public, anon, authenticated;
revoke all on function private.notify_status() from public, anon, authenticated;
revoke all on function private.escalate_urgent_requests() from public, anon, authenticated;
revoke all on function private.clear_expired_statuses() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notification_log enable row level security;

revoke all on public.push_subscriptions, public.notification_prefs, public.notification_log
  from anon, authenticated;

-- Subscriptions: read and delete your own. Saving goes through the function.
grant select, delete on public.push_subscriptions to authenticated;

create policy "Users can read their own subscriptions"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can delete their own subscriptions"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- Preferences: your own row only.
-- user_id is in the update grant because the app saves with an "upsert"
-- (insert, or update if the row exists), and that statement names every column
-- it was given, user_id included. It still can't be changed to someone else:
-- the update policy's WITH CHECK below refuses any row that isn't yours.
grant select on public.notification_prefs to authenticated;
grant insert (user_id, requests, visitor_notes, food, bringing, pings,
              quiet_enabled, quiet_start, quiet_end, timezone)
  on public.notification_prefs to authenticated;
grant update (user_id, requests, visitor_notes, food, bringing, pings,
              quiet_enabled, quiet_start, quiet_end, timezone)
  on public.notification_prefs to authenticated;

create policy "Users can read their own preferences"
  on public.notification_prefs for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can create their own preferences"
  on public.notification_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users can update their own preferences"
  on public.notification_prefs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- notification_log: RLS is on and there are no policies or grants for app
-- users, so it is invisible to them. The service role bypasses RLS.

-- The Edge Function works as the service role. These grants spell out exactly
-- what it needs instead of relying on the platform's defaults.
grant select on public.room_members, public.statuses, public.notification_prefs to service_role;
grant select, delete on public.push_subscriptions to service_role;
grant select, insert on public.notification_log to service_role;
