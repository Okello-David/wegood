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
