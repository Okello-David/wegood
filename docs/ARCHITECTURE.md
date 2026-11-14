# Architecture

## Data model

| Table | Holds | Key points |
|---|---|---|
| `rooms` | Name, 6-character invite code, home point, geofence radius | `home_lat/lng` are empty until Phase 4 |
| `room_members` | Who is in which room, and their role | `admin` or `member` |
| `profiles` | Display name, emoji, color | One per auth user, created by a signup trigger |
| `statuses` | Location, at-home, hunger, bringing, ETA | One per user, so a user has one room for now |

`home_lat/lng` is the room's location, not a person's. Users' positions are never stored: in Phase 4 the phone will do the geofence calculation itself and send only `at_home` true or false.

`mood_text` isn't used yet. `expires_at` is set by the database 4 hours after bringing, mood or ETA last changed (Phase 3).

## Security

Two layers must both allow a change. **Grants** decide which operations and columns a role can touch. **RLS policies** decide which rows.

| Table | Read | Write |
|---|---|---|
| `rooms` | Members | Admins, only name, home point and radius |
| `room_members` | Members | Nobody directly |
| `profiles` | Yourself and roommates | Your own |
| `statuses` | Members of that room | Your own, and only in a room you belong to |

**Helper functions** (`is_room_member`, `is_room_admin`, `shares_room`) run as `security definer`. A policy on `room_members` that queried `room_members` would recurse forever, so these bypass RLS for one narrow question about the signed-in user. Each sets an empty `search_path` so a look-alike table can't hijack it.

**`create_room` and `join_room`** are the only way into a room. Non-members can't read a room to find its code, and letting clients insert memberships would let anyone make themselves admin.

**Timestamps** (`updated_at`, `at_home_updated_at`) are set by the `statuses_touch` trigger, so clients can't fake freshness.

The app uses only the publishable key. The service role key bypasses RLS and is used in one place only: the `notify` Edge Function, which runs on Supabase's servers.

## Login flow

1. `signInWithOtp` emails a link pointing to `/auth/confirm`.
2. The link carries a `token_hash`, and `app/auth/confirm/route.ts` exchanges it for a session cookie. The default link style must open in the browser that requested it, which often fails from a phone's mail app.
3. `proxy.ts` runs on every route, refreshes the session and sends signed-out users to `/login`. Next 16 renamed middleware to proxy.
4. Users without a room are sent to `/onboarding`.

## Board updates

`app/page.tsx` loads data on the server, then `components/board/Board.tsx` takes over in the browser.

**Live updates:** the board subscribes to `statuses` for its room and to `profiles`. Supabase applies RLS to each subscriber, so outsiders receive nothing. Phones drop connections when asleep, so the board refetches on reconnect and when the app becomes visible.

**One-tap saves:**
1. The screen changes immediately (optimistic UI).
2. Writes go through a queue, one at a time, so quick taps arrive in order.
3. While saves are pending, Realtime echoes of my own row are ignored so they can't rewind the screen.
4. A failed save shows a toast and reloads the true state.
5. For other changes, the newest `updated_at` wins, because events can arrive out of order.

## Behaviour choices

| Case | Behaviour |
|---|---|
| Home | `at_home` true, source manual |
| Campus, town, work, travelling | `at_home` false, source manual |
| Sleeping | `at_home` unchanged |
| Unknown | `at_home` empty |
| "Tonight" | 21:00 phone time, or 23:59 if that has passed |
| Stale card | `updated_at` older than 3 hours |
| ETA display | Relative ("in 25 min"), because the server doesn't know the phone's time zone and a clock time would differ between server and browser |

Cache Components is turned off, since nearly every page shows live, per-user data.

## Push notifications (Phase 3)

### How a push reaches a phone

Three parties: the phone's browser, a **push service** run by the browser maker (Google, Apple, Mozilla), and our `notify` Edge Function.

1. **Subscribe.** After a tap on "Turn on notifications", the browser asks its push service for an address (the endpoint) and two encryption keys. `save_push_subscription()` stores them in `push_subscriptions`, one row per device.
2. **Service worker.** `public/sw.js` stays installed for the site and is woken by the browser when a push arrives, even with the app closed. It shows the notification and, on tap, opens the app at the `url` in the message.
3. **Send.** `notify` encrypts the message with the device's keys and POSTs it to the endpoint, signed with the **VAPID private key**. The signature proves the push comes from the same server the phone subscribed to.
4. **Expiry.** A 404 or 410 from the push service means the device is gone, so `notify` deletes that row. The Me screen also re-saves the current subscription on every visit.

iPhone only allows push for a site on the Home Screen, so the Me screen shows an install guide there instead of the button. Phones also require https; `localhost` is the one exception, which is what makes laptop testing possible.

### Who asks `notify` to send

| Event | Caller | Goes to |
|---|---|---|
| New request (clothes, errand, other) | Database trigger | Routing rule |
| Visitor note | Database trigger | The person it is for |
| Ready food marked out | Database trigger | Routing rule |
| Bringing set | Database trigger | Everyone except the sender |
| Urgent request unclaimed for 10 minutes | pg_cron job, every 5 minutes | Everyone except the creator, once |
| Ping home, test notification | The app, with the user's login token | Routing rule / yourself |

**Why triggers, not the app, for the first four:** the row change is the truth. A trigger fires even if the tab closes mid-tap, and the text is written by the database, so a client can't fake or skip it. This is the same reasoning as the Phase 2 feed. The trigger calls `private.send_notify()`, which uses `pg_net` to POST after the transaction commits, so a slow push never delays the tap. Pings and tests don't change any row, so the app calls the function directly.

`notify` accepts two kinds of caller: a roommate's login token (only `ping` and `test`, and `sender_id` must be the caller), or the database's shared secret in `x-notify-secret`. The function URL and that secret live in Supabase Vault; if they are missing, nothing is sent and everything else still works.

### Routing rule

1. Targets = room members except the sender whose `at_home` is true and whose `at_home_updated_at` is under 3 hours old.
2. If that is empty, targets = all members except the sender.
3. Then each target is dropped if they turned that type off, or if it is their quiet hours (in their own time zone) and the message is not urgent.

`at_home_updated_at` only moves when `at_home` changes, so someone home all day falls back into "everyone" after 3 hours. Phase 4's geofence will keep it fresh.

Every send is written to `notification_log` with the rule used, who was targeted and who was skipped and why. The same table backs the rate limit: 10 per sender per 10 minutes (escalations don't count).

### New tables

| Table | Read | Write |
|---|---|---|
| `push_subscriptions` | Your own | Delete your own; save through `save_push_subscription()` |
| `notification_prefs` | Your own | Your own |
| `notification_log` | Nobody (service role only) | Nobody (service role only) |

### Scheduled jobs (pg_cron)

| Job | Every | Does |
|---|---|---|
| `wegood-escalate-urgent` | 5 min | Marks `requests.escalated_at` and notifies everyone. One UPDATE both picks and marks the rows, which is why it can only fire once per request |
| `wegood-clear-expired-statuses` | 15 min | Clears bringing, mood and ETA past `expires_at`, without touching `updated_at`, so an old card doesn't look fresh |

## Smart features (Phase 4)

### Geofence: only "home: yes/no" leaves the phone

```text
Admin, once:   phone GPS ──► rooms.home_lat / home_lng / radius_m   (the HOUSE, not a person)

Everyone, on app open / back to foreground (if their per-device switch is on):
  phone GPS ──► haversine distance to the room's home point   (in the browser)
            ──► rpc set_geo_home(p_at_home: true | false)      (the only thing sent)
```

- `components/geo/AutoHome.tsx` (mounted in the in-room layout) does the check. `set_geo_home()` takes a single boolean, so coordinates *can't* be sent through it.
- If the browser's accuracy circle is bigger than the home circle, nothing changes (the answer would be a guess). Permission denied switches the feature off on that device; a timeout just waits for the next open.
- Picking a location by hand wins until the next app open: a fresh page load, or coming back after 30+ minutes in the background.
- `set_geo_home()` also refreshes `at_home_updated_at` when the answer is the same ("still home"), so the Phase 3 routing keeps treating that person as home. The phone re-sends an unchanged answer at most every 10 minutes.
- `supabase/tests/rls_smart.sql` fails if any column that looks like coordinates appears anywhere except `rooms.home_lat/home_lng`.

**Why no background tracking:** a web app only runs while it's open. There is no background geolocation API for the web, the service worker can't read location, and iOS and Android freeze hidden tabs and installed PWAs within seconds. Native apps can register real OS geofences; a PWA can't. So the status updates when you *open* the app, and the 3-hour staleness rule covers the gaps.

### Energy battery

`lib/energy.ts` is a pure function, `computeEnergy(wakeTime, activities, checkins, now)`:

1. Start: 100% at the latest wake-up in the last 24 h. No wake-up means "?" (never a made-up number).
2. A later "how do you feel?" check-in resets the level (1→15% … 5→95%) from that moment.
3. Then, piece by piece: -4%/h awake, plus the hardest running activity's extra drain (class 6, study 5, gym/football 15, town 8, work 7, chill 0). A nap gives +40%/h (+20 per 30 min) instead. Clamped 0-100 after each piece.
4. Overlaps count once. An activity nobody stopped counts for at most 4 h.

Activities come from two places: ones started by hand (`activities`) and Plan blocks that have started and weren't skipped (`lib/schedule.ts` → `scheduleAsActivities`). Battery and "Now / Next" are computed only in the browser, because they depend on the phone's time zone.

### Schedule

`schedule_items` holds one-offs and weekly items (`repeat_days`, 0 = Sunday). A weekly item repeats the time of day of its first `starts_at` from that date on; `skipped_dates` removes single days. Dragging a weekly block shifts the whole series.

The timeline uses plain pointer events: hold ~0.3 s then drag (so a quick swipe still scrolls), resize from the bottom bar (`touch-action: none`), 15-minute snapping. While a block is lifted, a non-passive `touchmove` listener stops the page scrolling; React's own touch listeners can't do that.

### New tables

| Table | Read | Write |
|---|---|---|
| `activities` | Room members | Owner: insert, stop (`ended_at` only), delete |
| `energy_checkins` | Room members | Owner: insert, delete (no edits) |
| `schedule_items` | Room members | Owner: insert, update, delete |

All three have `room_id` (Realtime filters by it) and a foreign key to `room_members`, so leaving the room removes them. `user_id` defaults to the signed-in user.

## Fun layer (Phase 5)

### Points can only come from the database

Points are bragging rights, so they get the same protection as the feed: browsers can **read** `point_events` and `weekly_mvps`, but there is no insert, update or delete grant on them at all. A hand-made API request is refused with "permission denied" before RLS is even asked.

Rows are written by `private.award_points()`, which only two triggers call:

| Event | Points | To | Guard |
|---|---|---|---|
| Request done (`done_at` set) | 10, or 15 if urgent | `claimed_by` | Not if the claimer is the creator. One payout per request: unique index on `(reason, source_id)` |
| Visitor note done | 3 | The writer | Only when the person it's for taps "Got it" themselves, so writing notes alone earns nothing |
| Pantry item out → have | 5 | Whoever restocked | Item was out for 10+ minutes, and one item pays at most once per 12 hours |

`source_id` (the request or item id) wasn't in the original spec. It's what turns "one payout per request" into a database rule instead of a hope.

The leaderboard is `week_leaderboard(room_id)`, a `security invoker` function, so RLS on `point_events` still applies. It counts from Monday 00:00 **in the room's time zone** (`rooms.timezone`, default `Africa/Kampala`). The browser listens to `point_events` over Realtime only to know *when* to re-ask for the totals.

### Weekly MVP: hourly and idempotent

`private.weekly_mvp_job()` runs every hour (pg_cron) instead of once on Monday at midnight. Each run does this for every room: "has this room's Monday 00:00 passed, and does last week have no MVP yet? Then crown the top scorer(s)." This has three advantages:

- It works in any time zone without a separate cron line per zone.
- Running it twice does nothing the second time.
- A missed run (the database was down) is caught up an hour later.

A tie gives co-MVPs, and a 0-point week gives no MVP. The feed line appears at midnight, but the **push waits until 08:00 Monday**, because midnight is inside everyone's default quiet hours and would be skipped. `pushed_at` makes sure it's sent once. The 🏆 shows on the winner's avatar for the following week.

### Auto-messages: at most once per day

`private.run_auto_messages()` runs every 30 minutes and has three rules: starving (hunger 3 for 3-12 hours, feed + push), nobody updated for 12 hours (feed only), and everyone home with all ready food finished (feed only).

"Once per day" lives in `auto_message_log` (RLS on, no grants, invisible to the app). The trick is that **choosing who qualifies and logging it is one statement**: `insert into auto_message_log ... select ... where not exists (a log row in the last 24 h) returning ...`. The loop then sends only what that insert returned, so a second run straight after finds nothing. An advisory lock stops two slow runs from overlapping.

`statuses.hunger_updated_at` is set by the `touch_status` trigger whenever hunger changes, on every write path, so a client can't fake "starving since yesterday".

Starving and MVP pushes go through the same `notify` function as everything else. They count as database-only kinds (a browser can't send them), they aren't rate limited (no one tapped anything), and they respect quiet hours and the new **😂 Fun messages** switch (`notification_prefs.fun`).

### Captions, avatars and animations (browser only)

- `lib/vibes.ts` picks a caption from the person's situation (the first rule that matches, e.g. low battery before "at campus"). The line inside a situation is chosen by a hash of `user id + situation + 10-minute window`, so it stays put for 10 minutes instead of changing on every re-render, and two people in the same situation usually get different lines. Captions never contain names, so no pronouns are needed.
- Animations are plain CSS keyframes in `globals.css` (no animation library): avatar ring pulse when a status changed in the last 2 minutes, card bounce on a live change, confetti when you finish someone's request. All are `motion-safe:`; confetti isn't rendered at all when the phone asks for reduced motion.
- `navigator.vibrate(10)` on the main buttons. iPhone Safari doesn't support it, so it silently does nothing there.

### Dark mode

Colours are semantic tokens in `app/globals.css` (`page`, `card`, `chip`, `ink`, `muted`, `line`, `primary`). Components use `bg-card` and `text-muted` instead of `bg-white` and `text-stone-600`, and the tokens switch under `prefers-color-scheme: dark`. There is no toggle; it follows the phone. Amber, red and green accents are the same in both themes.
