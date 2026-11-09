# Architecture

## Data model

| Table | Holds | Key points |
|---|---|---|
| `rooms` | Name, 6-character invite code, home point, geofence radius | `home_lat/lng` are empty until Phase 4 |
| `room_members` | Who is in which room, and their role | `admin` or `member` |
| `profiles` | Display name, emoji, color | One per auth user, created by a signup trigger |
| `statuses` | Location, at-home, hunger, bringing, ETA | One per user, so a user has one room for now |

`home_lat/lng` is the room's location, not a person's. Users' positions are never stored: in Phase 4 the phone will do the geofence calculation itself and send only `at_home` true or false.

`mood_text` and `expires_at` exist but aren't used yet.

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

The app uses only the publishable key. The service role key bypasses RLS and is not used by the app.

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
