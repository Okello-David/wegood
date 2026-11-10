# Progress

Last updated: 2026-11-10

| Phase | Status |
|---|---|
| 0. Setup | Done, except hosted Supabase connection and Vercel |
| 1. MVP status board | Code complete, tested locally. **Not yet on the real project** |
| 2. Room features | Done. Tested locally, including the laptop + iPhone checklist (2026-11-10). **Not yet on the real project** |
| 3. Push notifications | Next |
| 4. Geofence, energy, schedule | Not started |
| 5. Fun layer | Not started |
| 6. CI, AWS, docs | Not started |

## Phase 1 test record

Tested on a throwaway local Supabase (Docker):

| Check | Result |
|---|---|
| Lint, type-check, production build | Pass |
| Migration applies | Pass |
| `supabase/tests/rls_isolation.sql` | Pass |
| The RLS test catches weakened policies | Pass, two deliberately weakened policies were caught |
| Create and join a room | Pass |
| Realtime between two users (script) | About 130 ms typically; first update 992 ms |
| Outsider subscribing to the room | 0 events, 0 rows |
| Signed-out redirects | Pass |

| Click-through in a real browser + laptop/iPhone (Firefox) two-device test, over local Wi-Fi | Pass (2026-11-10) |

**Not tested yet:**
- Real magic-link emails
- Android Chrome
- Anything on the hosted project

## Running it on the laptop + phone (same Wi-Fi)

Set up on 2026-11-10 with the local Supabase:
- `supabase/config.toml`: `api.external_url`, `auth.site_url` and redirect URLs point at the laptop's LAN IP `192.168.1.168` (machine-specific, not committed). It also adds `supabase/templates/` (token_hash links, same as hosted SETUP.md step 7). Commit the templates part.
- `.env.local` holds the **local** Supabase keys (public demo keys). Replace them when the hosted project is connected. The empty original is in `.env.local.bak-empty`.
- Start: `npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,storage-api --ignore-health-check`, then `npm run build && npm run start -- -H 0.0.0.0`. Storage is skipped and health checks are ignored because the containers start slowly on this laptop and timed out.
- App: http://192.168.1.168:3000. Login emails: Mailpit at http://192.168.1.168:54324.
- Smoke test (curl): magic link → `/auth/confirm` → signed in → `/onboarding`. Pass.

## Phase 2 test record (2026-11-10, local Supabase)

| Check | Result |
|---|---|
| Lint, type-check, production build | Pass |
| Migration `20261110120000_room_features.sql` applies (`npx supabase migration up`) | Pass |
| `supabase/tests/rls_isolation.sql` (Phase 1, still) | Pass |
| `supabase/tests/rls_room_features.sql` | Pass |
| The Phase 2 RLS test catches weakened policies | Pass, two deliberately weakened policies caught (writable feed, visitor note for outsider) |
| New room is seeded with the 10 common items | Pass |
| Sugar -> out reaches a second user live (script) | Pass, ~220 ms; Sugar is on their shopping list |
| Two users claim at the same moment, 20 rounds (script) | Pass, exactly one winner each time; loser gets `already_claimed` + winner's name |
| All tabs render signed in (/, /stuff, /requests, /me; /profile redirects) | Pass (curl) |

Manual checklist below: all items passed on laptop + iPhone (2026-11-10).

### Phase 2 manual test checklist (laptop + iPhone Firefox)

Tick each box (`[x]`) as you go. Note anything odd under "Problems found".

**Before you start:** start Supabase, then build and start the app (see "Running it on the laptop + phone" below). Open http://192.168.1.168:3000 on both devices, signed in as two different accounts in the same room. Login emails are in Mailpit at http://192.168.1.168:54324.

1. Home Stuff setup
   - [x] Your room existed before Phase 2, so Home Stuff is empty. Tap **Add common items** once. The 10 items appear (Sugar, Salt, Rice, Posho, Beans, Cooking oil, Bread, Tea leaves, Water, Charcoal/gas).
2. Sugar test (acceptance)
   - [x] On device A, tap Sugar: it goes amber (Low) with a small squeeze animation. Tap again: red (Out).
   - [x] Device B shows Sugar red instantly, without refreshing.
   - [x] On both devices, **Shopping list** shows a count, and Sugar is listed under Out.
   - [x] The Board feed on both devices says "🚨 Sugar ran out, says …".
3. Shopping list
   - [x] **📋 Copy list**, then paste into WhatsApp: the heading and the Out/Running low labels show in bold.
   - [x] The **💬 WhatsApp** button opens WhatsApp with the list ready to send.
   - [x] **Bought ✅** turns the item green on both devices and removes it from the list.
4. Add and delete items
   - [x] **+** → Ready food → add an item (e.g. "Leftover pilau"). It shows under Ready food on both devices.
   - [x] Adding a name that already exists (e.g. "sugar") says it's already on the list.
   - [x] Holding a tile for about half a second opens "Delete …?". On iPhone, the text magnifier/menu must NOT pop up.
   - [x] **Keep it** cancels. **Delete** removes the item on both devices.
   - [x] Scrolling the list with your finger on a tile does not open the delete sheet.
5. Requests
   - [x] Device A: **Pick my clothes**. The text is prefilled; send it. It appears on device B.
   - [x] Device B: **I got it 🙌**. Both devices show "On it" with B's name, and the feed says "🙌 … is on it".
   - [x] Device B (claimer) taps **Done ✅**. It moves to the collapsed **History** on both devices, and the feed says "✅ Done: …".
   - [x] **Buy something** with **Urgent** on: it gets a red ring and sits at the top of Open, and the feed shows 🔥.
   - [x] The creator can delete their own open, unclaimed request (🗑️ → Delete).
6. Claim race (acceptance)
   - [x] You need 3 accounts in the room, because whoever creates a request sees **Done**, not **I got it**. Use a laptop private window as the third account (e.g. `frien@test.com`; join with the invite code).
   - [x] Account 1 creates an errand. Accounts 2 and 3 (phone + laptop) tap **I got it** at the same moment. Only one wins; the other sees "Too slow! … already got it 😅", then the card shows who won.
7. Visitor note
   - [x] Device A: **Visitor note**. Pick device B's person, type "Someone came for you, back at 6pm", and send.
   - [x] On the Board, B's card has an amber ring with the note, on both devices.
   - [x] Device B: **Got it 👍** (on the Board or in Requests) clears it everywhere.
8. Navigation and layout
   - [x] The bottom tabs (Board, Home Stuff, Requests, Me) are easy to hit one-handed, the active tab is highlighted, and nothing hides behind the iPhone home bar.
   - [x] The ✏️ and + buttons sit above the tab bar and don't cover the last item when scrolled to the bottom.
   - [x] **Me** shows the room name, invite code, name/avatar editing and Sign out.
   - [x] Lock the phone for a minute, change something on the laptop, then unlock: the phone catches up.

**Problems found:**
- None.

Phase 3 (push notifications) continues on branch `phase-3-push`.

Phase 2 decisions:
- Requests can't be updated by clients at all; `claim_request` / `complete_request` are the only way. Claiming is race-safe because UPDATE locks the row (see the migration comments).
- Visitor notes aren't claimed: the person they're for taps "Got it 👍" (on the Board or Requests); the creator can clear them.
- Only "ran out" goes into the feed for pantry items. No "un-claim" yet.
- `feed_events` is written only by triggers, so it can't be faked. It has no clean-up yet; add one (pg_cron) before it gets large.
- Realtime DELETE events can't be filtered by room, so every subscriber gets deleted ids (ids only, no data) and ignores unknown ones.
- Copy-to-clipboard falls back to the old `execCommand` trick on http (the modern API needs https). The WhatsApp button uses a `wa.me` link.
- Long-press to delete isn't reachable by keyboard. Fine for phones; revisit if desktop matters.

## To finish Phase 1

Details are in [SETUP.md](SETUP.md).

1. Make Okello-David's Org available: reconnect the Supabase connector with the account that owns it, or fill in `.env.local` by hand. The connector currently sees only org "scholarship" and "allaninfo-tech's Project", which must not be used. `.env.local` values were empty at last check.
2. Apply the migration, run the RLS test on the hosted project, and generate `types/database.ts`.
3. Set up custom SMTP, redirect URLs and both email templates.
4. Run the two-browser and phone tests.

## Known issues and later work

- `npm audit` reports 8 moderate issues, seen in ESLint tooling. Don't use `npm audit fix --force`.
- `join_room` has no limit on guesses. There are about a billion possible codes, so it's fine for now, but add a limit before wider use.
- On iPhone, an email link opens in Safari, not an installed home-screen app, and the two don't share a login. Consider a typed one-time code when the PWA is installed for real.
- The service worker arrives with Phase 3.
- One room per user, enforced by `statuses.user_id` being the primary key.
- The disk had about 5 GB free. Local Supabase images use about 2 GB; see SETUP.md to remove them.

## Git

Phase 2 work is on branch `phase-2-room-features` (branched from `phase-1-status-board`); `main` doesn't exist yet. To make this branch `main`, run `git branch -m main`.
