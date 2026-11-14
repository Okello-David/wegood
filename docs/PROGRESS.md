# Progress

Last updated: 2026-11-14

| Phase | Status |
|---|---|
| 0. Setup | Done, except hosted Supabase connection and Vercel |
| 1. MVP status board | Code complete, tested locally. **Not yet on the real project** |
| 2. Room features | Done. Tested locally, including the laptop + iPhone checklist (2026-11-10). **Not yet on the real project** |
| 3. Push notifications | Committed. Automated tests pass. **Manual browser checklist still open; phone test waits for https** |
| 4. Geofence, energy, schedule | Committed on `phase-4-smart`, automated tests pass. **Manual checklist still open** |
| 5. Fun layer | Committed on `phase-5-fun`, automated tests pass. You report it seems to work (2026-11-14); **formal manual checklist still open** |
| 6. CI, AWS, docs | Not started |

## Pick up here (written 2026-11-14)

**Where we stopped:** Phase 5 (fun layer) is committed on branch `phase-5-fun` and passes every automated check (Phase 5 test record below). You tried it and said things seem to work, but the checklist boxes weren't ticked one by one. Three manual checklists are still open: Phase 3 (push), Phase 4 (smart features) and Phase 5 (fun layer).

**To do next, in order:**
1. Start everything (commands below), then run the "Phase 5 manual test checklist" on **http://localhost:3000** (two Chrome profiles) and the phone items at http://192.168.1.168:3000.
2. When you have time, the Phase 4 and Phase 3 checklists.
3. Tell Claude what failed or felt off; Claude fixes and commits (never `supabase/config.toml`: its only changes are the LAN IP lines).
4. Then Phase 6 (CI, AWS, docs).

**Start commands** (the app server stops when the Claude session closes):

```bash
nvm use
npx supabase start -x studio,imgproxy,logflare,vector,supavisor,postgres-meta,storage-api --ignore-health-check
npm run build && npm run start -- -H 0.0.0.0
```

If Supabase was already running without the edge runtime (`docker ps | grep edge` shows nothing), run `npx supabase stop` first, then the start line. `stop` keeps the data.

**Run every automated check:**

```bash
for f in rls_isolation rls_room_features rls_push rls_smart rls_fun; do
  docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/$f.sql
done
node supabase/tests/notify_routing.mjs
npm run lint && npm run typecheck && npm test && npm run build
```

New migration: `npx supabase migration up` (already applied on this laptop).

## Phase 3 hand-over notes (written 2026-11-10)

**Where we stopped:** Phase 3 is built, passes every automated check locally and was committed on 2026-11-11 with the manual browser checklist **still open** (no real notification seen on a screen yet). Phase 4 continues on branch `phase-4-smart`; run the Phase 3 checklist whenever convenient.

**To do next, in order:**
1. Start everything (commands below) and run the "Phase 3 manual test checklist" further down this file, on **http://localhost:3000** in two browser profiles (`me@test.com`, `pro@hot.com`).
2. Tell Claude what failed or felt off. Claude fixes, ticks the boxes and fills "Problems found".
3. Ask Claude to commit Phase 3. **Nothing from Phase 3 is committed yet**; it is all uncommitted on branch `phase-3-push`. Leave the LAN IP lines in `supabase/config.toml` out of the commit, but include the `[functions.notify]` block at the bottom of that file.
4. Start Phase 4 (geofence, energy, schedule).

**Start commands** (the app server stops when the Claude session closes):

```bash
nvm use
npx supabase start -x studio,imgproxy,logflare,vector,supavisor,postgres-meta,storage-api --ignore-health-check
npm run build && npm run start -- -H 0.0.0.0
```

**Re-run the automated tests:**

```bash
docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_isolation.sql
docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_room_features.sql
docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_push.sql
node supabase/tests/notify_routing.mjs
```

**What was checked** (details in "Phase 3 test record" below):
- Routing: one person home and others away notifies only the home person; nobody home notifies everyone except the sender.
- Escalation: nothing before 10 minutes; after 11 minutes it fires once, a second run does nothing.
- The VAPID private key, hook secret and service role key are nowhere in `.next/` or `public/`.
- The new RLS test passes and catches two deliberately weakened policies. Outsiders, impersonation and missing tokens are rejected.
- Triggers reach the function through the real database path: new request, visitor note (only the person it's for), bringing, ready food out. A grocery going out sends nothing.
- Rate limit (11th in 10 minutes refused), quiet hours with urgent passing, and deleting a device the push service reports as gone.
- Lint, type-check, production build and the Phase 1 and 2 RLS tests still pass.

**Things worth knowing:**
- **Who calls `notify`:** database triggers for anything that changes a row (so the text can't be faked or skipped, same idea as the Phase 2 feed). The app calls it directly only for Ping home and the test button, because those write no row.
- **A bug the tests caught:** saving preferences was refused by the database, because an upsert names every column it is given, including `user_id`. `user_id` is now in the update grant; the policy's WITH CHECK still stops it being changed to someone else.
- **"Food is finished"** goes to people at home first, like requests. Only "bringing" and escalation go to everyone. Open question for you: should food go to everyone instead?
- **Home all day counts as stale:** "at home" expires 3 hours after it last *changed*, so that person falls into the "everyone" group until Phase 4's geofence keeps it fresh.
- **Local secrets are in place** on this laptop: `supabase/functions/.env` (git-ignored) holds the VAPID keys and hook secret, `.env.local` holds the public key, and the local Vault holds the function URL and hook secret. They survive `supabase stop`, but not `stop --no-backup` or `db reset` (SETUP.md step 11 shows how to redo them).
- **`VAPID_SUBJECT` is a placeholder** (`mailto:admin@wegood.invalid`). The hosted project needs a real contact address; Apple can reject made-up ones.
- **Local Supabase now runs the edge runtime** (about 0.7 GB more). The disk had 4.2 GB free at the end of the session.
- **Phones need https** for push, so the Android and installed-iPhone acceptance test waits for the hosted Supabase project + Vercel (still blocked on org access, see "To finish Phase 1").

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
- Start: `npx supabase start -x studio,imgproxy,logflare,vector,supavisor,postgres-meta,storage-api --ignore-health-check` (the edge runtime is included since Phase 3), then `npm run build && npm run start -- -H 0.0.0.0`. Storage is skipped and health checks are ignored because the containers start slowly on this laptop and timed out.
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

## Phase 3 test record (2026-11-10, local Supabase)

| Check | Result |
|---|---|
| Lint, type-check, production build | Pass |
| Migration `20261110180000_push_notifications.sql` applies | Pass |
| `rls_isolation.sql`, `rls_room_features.sql` (still) | Pass |
| `supabase/tests/rls_push.sql` | Pass |
| The Phase 3 RLS test catches weakened policies | Pass, two caught (subscriptions readable by anyone, log readable) |
| `supabase/tests/notify_routing.mjs` (24 checks, see below) | Pass |
| VAPID private key, hook secret, service role key in `.next/` or `public/` | Not found (values and names searched) |
| `/sw.js` loads signed out; `/me` still redirects to login | Pass |
| Both pg_cron jobs run on schedule | Pass (`cron.job_run_details`) |

What `notify_routing.mjs` proves, using throwaway users with made-up devices:
- **Who may call:** no token 401, wrong secret 401, outsider 403, pretending to be a roommate 403, app sending a database-only kind 403.
- **Routing (acceptance):** one person home, others away → only the home person. Nobody home → everyone except the sender. "Home" older than 3 hours counts as not home.
- **Preferences:** a switched-off type and quiet hours are skipped with the reason reported; urgent passes quiet hours.
- **Rate limit:** 10 pass, the 11th in 10 minutes gets 429.
- **Triggers, through the real database → pg_net → function path:** new request, visitor note (only the person it's for), bringing (everyone), ready food out; a grocery going out sends nothing.
- **Escalation (acceptance):** nothing before 10 minutes; after 11 minutes it fires once, a second run does nothing.
- **Dead device:** a real push service answering "gone" deletes the row.

**Not tested yet:**
- A real notification appearing on screen. The automated test can't own a real browser subscription. Checklist below.
- App closed on an Android phone and on an installed iPhone (acceptance). Phones need https, so this waits for the hosted project + Vercel.

### Phase 3 manual test checklist (laptop, two browser profiles)

Use **http://localhost:3000**, not the 192.168 address: browsers only allow notifications on https or localhost. Use two Chrome profiles (or Chrome + Firefox), signed in as `me@test.com` and `pro@hot.com`. Login emails: http://192.168.1.168:54324. Make sure your laptop's own "Do not disturb" is off.

1. Turning on
   - [ ] Me screen shows a **Notifications** card. No permission pop-up appears until you tap.
   - [ ] Tap **Turn on notifications**, allow. The card says "On for this device ✅".
   - [ ] **Send me a test notification**: a notification appears. Clicking it opens/focuses WeGood? on the Me screen.
   - [ ] Do the same in the second profile.
2. Requests (acceptance, laptop version)
   - [ ] Close profile B's WeGood? tab (keep the browser running). In A, create a request. B's browser shows the notification. Clicking it opens Requests.
   - [ ] A **visitor note** for B notifies only B.
3. Routing
   - [ ] B sets location Home, A sets Campus. A taps **📣 Ping home**: toast says "Pinged pro (at home)", B gets it.
   - [ ] B sets Campus too. A pings again: toast says "Nobody's home, pinged …".
4. Other triggers
   - [ ] A sets Bringing → Food: B gets "… is bringing food 🍚".
   - [ ] Home Stuff: add a **Ready food** item, tap it to Out: B gets "Food is finished at home". Sugar going Out sends nothing.
5. Preferences
   - [ ] B turns off "Ping home". A pings: B gets nothing. Turn it back on.
   - [ ] B sets quiet hours to cover the current time. A sends a normal request: nothing. A sends an **Urgent** one: it arrives.
6. Escalation
   - [ ] A creates an Urgent request and nobody claims it. Between 10 and 15 minutes later, B gets "🔥 Still waiting…", once.
7. Clean-up behaviour
   - [ ] Tap the ✏️ sheet 11+ times quickly on Bringing chips: after 10 the pushes stop (rate limit), the app itself keeps working.
   - [ ] **Turn off on this device**, then a test from the other profile no longer reaches it.
   - [ ] Sign out: that browser stops getting notifications.
8. iPhone guide (look only)
   - [ ] On the iPhone at http://192.168.1.168:3000 → Me: the card shows "Add WeGood? to your Home Screen first" with three steps, not the button. (Real iPhone push needs https, later.)

**Problems found:**
- (none yet)

Phase 3 decisions:
- Triggers for row changes, direct app call for ping/test. Reasons in ARCHITECTURE.md.
- "Food is finished" uses the routing rule (home first). Only bringing and escalation go to everyone.
- Preference toggles always apply. Quiet hours are skipped for urgent requests and escalations. A test always goes through.
- Quiet hours use the time zone the browser reports, saved whenever notifications are turned on or a preference changes. Default `Africa/Kampala`.
- Escalation counts against the "Requests" toggle and is not rate limited.
- Saving a subscription moves an existing endpoint to the signed-in user (shared phone). Signing out removes this device's subscription.
- Stored endpoints must be https, because the function POSTs to them.
- `notification_log` has no clean-up yet; add one with the feed clean-up.
- `npm:web-push` runs fine in the Edge runtime; no fallback library was needed.

## Phase 4 test record (2026-11-11, local Supabase)

| Check | Result |
|---|---|
| Migration `20261111120000_smart_features.sql` applies | Pass |
| `supabase/tests/rls_smart.sql` (new) | Pass |
| It catches deliberate weaknesses | Pass, 3 caught: schedules readable by outsiders, a `set_geo_home` that ignores the preset/owner rules, a `statuses.user_lat` column |
| Phase 1-3 RLS tests, `notify_routing.mjs` (touch_status changed) | Pass |
| Unit tests (Vitest): 12 energy, 8 schedule, 5 geo, 1 latestWake | 26/26 pass |
| Lint, type-check, production build | Pass |
| Signed in (magic link via `/auth/confirm`): `/`, `/plan`, `/me`, `/stuff`, `/requests` | All 200 |

What `rls_smart.sql` proves: outsiders can't read or write the three new tables or move another room's home; members read roommates' plans/activities but can't change them; only admins set the home point; `user_id` can't be faked; activities can only be stopped, check-ins never edited; bad feel/weekday values are refused; `set_geo_home` only changes your own row, refreshes "still home", and the refresh flag doesn't leak to the next edit; anonymous visitors get nothing; no coordinate-like column exists except the room's.

**Not tested yet:** everything in the browser (checklist below), and real phones.

### Phase 4 manual test checklist

Laptop: **http://localhost:3000**, two Chrome profiles (`me@test.com` is the room admin, `pro@hot.com` a member). For fake locations: DevTools (F12) → ⋮ → More tools → **Sensors** → Location → "Other…" and type a latitude/longitude.

1. Auto-home: setup (admin)
   - [ ] Me shows a **📍 Auto-home** card. As admin: Sensors set to e.g. `0.3476, 32.5825`, tap **I'm at home now, set this as home**, allow location. Toast "Home saved 🏠".
   - [ ] Radius slider goes 30-150 m and saves (toast) a moment after you let go.
   - [ ] As `pro@hot.com` (member): no admin button or slider, only the switch.
2. Auto-home: the check (acceptance)
   - [ ] Switch **Auto-detect when I'm home** on. "Last check: 🏠 You're home". Board: your chip says Home with an **auto** badge.
   - [ ] DevTools → **Network** tab, filter `set_geo_home`. Click the request → Payload: exactly `{"p_at_home":true}`. Nothing else. (Screenshot this for the acceptance criterion.)
   - [ ] Sensors: change to `0.3576, 32.5825` (about 1 km away). Switch to another tab and back: within a few seconds your chip flips (Unknown, **auto**) on both profiles. Payload `{"p_at_home":false}`.
   - [ ] Pick **Campus** by hand in ✏️: badge says **manual**. Switch tabs and back: it stays Campus (manual wins). Reload the page: auto-home takes over again.
   - [ ] Sensors → Location → "Location unavailable": switching tabs changes nothing.
   - [ ] Block location for the site (padlock icon → Location → Block), switch tabs and back: the switch turns off and the card says location is blocked.
3. Energy battery
   - [ ] Every card shows a battery. Before waking up: **?** with "Tap to wake up" on yours, "not up yet?" on others.
   - [ ] Tap your battery → **☀️ I just woke up**: 100%, green, labelled "estimate". The other profile sees it live.
   - [ ] Start **⚽ Football**: the sheet closes, toast. Reopen: "Stop ⚽ Football (since …)". Stop works.
   - [ ] Feel check-in 😩 (2): battery jumps to 35%, red/amber colour.
4. Plan (My day)
   - [ ] New **📅 Plan** tab (5 tabs fit; easy to hit). Opens at the current time with a red "now" line.
   - [ ] Tap an empty slot → sheet → tap ⚽: a 1-hour Football block appears (2 taps).
   - [ ] Tap a block → edit title/type, **Repeat weekly** with day chips (e.g. Mon + Wed), Save. 🔁 shows on it. ‹ › to next week's Monday: it's there.
   - [ ] Mouse: drag a block to move (snaps to 15 min); drag the bottom bar to resize.
   - [ ] **Skip it this day only** removes one day; the other days stay.
   - [ ] A block that covers "now" makes your battery drain faster (Plan blocks count automatically); after skipping it, it no longer counts.
5. Board and Who's free?
   - [ ] Board cards show "Now: 🎓 … until 12:00 · Next: ⚽ … at 16:00".
   - [ ] **Who's free?**: everyone side by side for 6 hours, busy blocks coloured, FREE badge for whoever is free now.
6. Phones (http://192.168.1.168:3000)
   - [ ] Android Chrome: swipe over blocks scrolls the page; hold ~0.3 s then drag moves the block; bottom bar resizes; no text-selection pop-up.
   - [ ] iPhone Safari: same three checks; no magnifier/callout on long-press.
   - [ ] Auto-home card shows "Location only works on https" (expected on the LAN address).

**Problems found:**
- (none yet)

Phase 4 decisions:
- `activities` and `energy_checkins` got a `room_id` (not in the original spec): Realtime filters by it, and the foreign key to `room_members` cleans up when someone leaves.
- Auto-home is a per-device switch (localStorage); the location prompt only appears when you tap it.
- Manual location wins until the next app open = page reload, or returning after 30+ min in the background (an installed PWA can stay in memory for days).
- When the geofence says "away" and you were "Home", the location becomes Unknown (we don't know where you went). "Sleeping" is kept when you're home.
- Energy overlaps count once (hardest activity wins). Forgotten activities count for at most 4 h. "Woke up today" = a wake-up in the last 24 h, so staying up past midnight works. A feel check-in without a wake-up counts as waking up.
- Times use the phone's clock: started/ended times are sent from the phone, so a quick Stop can't end before it started.
- Drag without a library: pointer events + long-press + a non-passive touchmove listener. The resize bar's hit area is 28 px (smaller than 44 px so it doesn't cover short blocks).
- Battery and "Now / Next" only render in the browser (time zone), so the server HTML shows "…" for a moment.
- `energy_checkins` and `activities` have no clean-up yet; add it with the feed/log clean-up.

## Phase 5 test record (2026-11-14, local Supabase)

| Check | Result |
|---|---|
| Migration `20261114120000_fun_layer.sql` applies | Pass |
| `supabase/tests/rls_fun.sql` (new, 33 checks) | Pass |
| It catches deliberate weaknesses | Pass, 2 caught: an insert grant + policy on `point_events` ("a member inserted points for themselves"), and an open read policy ("outsider read 5 point events") |
| Phase 1-4 RLS tests | Pass |
| `notify_routing.mjs` (adds: browser can't send `starving`/`mvp`; they skip the rate limit; Fun switch and quiet hours apply) | Pass |
| Unit tests (Vitest): adds 8 for captions (48 captions, every situation reachable, steady for 10 min) | 34/34 pass |
| Lint, type-check, production build | Pass |
| Secrets (VAPID private key, hook secret, service role key) in `.next/` or `public/` | Not found |
| Lighthouse 12.8 (mobile, signed-in Board) | Accessibility **100**. Best Practices 79, only because of plain http (fixed by Vercel) and 401s that come from how Lighthouse was given the login, not from the app |
| Manifest: 192, 512 and maskable 512 icons load | Pass |

Found and fixed while testing:
- **Stale cards failed colour contrast** (2.9:1). The whole card was faded with `opacity-60`, text included. Now only the background fades (`bg-card/50`, no shadow), and text keeps full contrast.
- **`/favicon.ico` was missing** (a 404 in every browser's console). Added `app/favicon.ico`, made from the new logo.
- The Phase 2 tile squeeze now also respects reduced motion.

What `rls_fun.sql` proves: members can't insert, update or delete points or MVPs, or call `private.award_points`; outsiders read nothing; your own request pays 0; claim + done by someone else pays 10 (urgent 15) exactly once; a visitor note pays 3 only when the recipient acknowledges it; restock pays 5 once (not for a quick out→have, not twice in 12 h); auto-messages fire once per person per day, again after 24 h, never under 3 h of starving; the MVP job is safe to run twice, ties give co-MVPs, a 0-point week has no MVP; RLS is on for every table; both cron jobs exist.

**Not tested yet:** everything in a real browser (checklist below), and phones.

### Phase 5 manual test checklist

Laptop: **http://localhost:3000**, two Chrome profiles (`me@test.com`, `pro@hot.com`), plus a private window as a third account (`frien@test.com`) for points. SQL snippets run with:
`docker exec -it supabase_db_wegood psql -U postgres`

1. Captions
   - [ ] Every card shows an italic caption under "updated …" that fits the status (e.g. set Hunger to Starving → a hungry line).
   - [ ] It doesn't change when you reload or when someone else updates. It may change after 10 minutes.
   - [ ] Two people in the same situation usually have different lines. Nothing is mean or awkward. Note any line you'd like changed.
2. Points and leaderboard
   - [ ] Fresh week: under the header it says "No points yet this week. Be the hero."
   - [ ] Account 1 creates an errand, account 2 taps **I got it**, then **Done ✅**: confetti, toast "Done! +10 points 🎉", a buzz on Android. The leaderboard shows account 2 with 10 on **all** devices without refreshing.
   - [ ] An **Urgent** request gives 15.
   - [ ] Your own request (you create it and tap Done) gives no points and no confetti.
   - [ ] Visitor note: A writes one for B, B taps **Got it 👍** → A gets 3.
   - [ ] Home Stuff: mark Sugar **Out**, then right away back to have: no points. (To test the +5, run `update pantry_items set updated_at = now() - interval '11 minutes' where name = 'Sugar';` first, then tap it back to have.)
3. Trophy (MVP)
   - [ ] Pretend last week happened: in psql run
     `update point_events set created_at = created_at - interval '7 days';` then `select private.weekly_mvp_job();`
   - [ ] The feed shows "🏆 … is Room MVP of the week with … points!", and that person's avatar has a 🏆 after a reload.
   - [ ] Run `select private.weekly_mvp_job();` again: no second feed line.
4. Auto-messages
   - [ ] Set yourself to Starving, then in psql:
     `update statuses set hunger_updated_at = now() - interval '4 hours' where hunger = 3;` then `select private.run_auto_messages();`
   - [ ] The feed says "… has been starving for 4 hours. Someone check on … 👀". The other profile gets a push (if notifications are on and it's not quiet hours).
   - [ ] Run `select private.run_auto_messages();` again: no second message.
   - [ ] Me → **😂 Fun messages** off in the other profile, repeat (first `delete from auto_message_log;`): feed line yes, push no.
5. Animations and reduced motion
   - [ ] Your avatar ring pulses for 2 minutes after you change your status. A roommate's card bounces once when they change theirs.
   - [ ] DevTools → ⋮ → More tools → **Rendering** → "Emulate CSS prefers-reduced-motion: reduce". Then no pulse, no bounce, no confetti, and no skeleton shimmer.
6. Polish
   - [ ] Switch tabs while the network is slow (DevTools → Network → "Slow 4G"): grey card-shaped skeletons show instead of a blank page.
   - [ ] Empty states: Requests "No requests. Suspiciously peaceful. 🕊️", Shopping list "Nothing to buy…", Feed "Nothing happened yet…".
   - [ ] Laptop dark mode (or DevTools → Rendering → prefers-color-scheme: dark): every tab is readable, with no white boxes and no invisible text. Check sheets, toasts, the Plan timeline and the Me cards too.
7. Phones (http://192.168.1.168:3000)
   - [ ] Android Chrome and iPhone Safari in dark mode: same as 6.
   - [ ] Add to Home Screen: the new speech-bubble icon shows (Android may crop it into a circle; the "?" must stay whole).
   - [ ] Android: buttons give a tiny buzz (status chips, ping, claim, done). iPhone: no buzz (expected).

**Problems found:**
- (none yet)

Phase 5 decisions:
- Points, MVPs and auto-messages are written only by the database (triggers + pg_cron); browsers can only read them. Reasons in ARCHITECTURE.md.
- `point_events.source_id` (not in the spec) makes "one payout per request" a unique index.
- Visitor notes pay only when the recipient acknowledges them; restock pays only after 10 min out and once per item per 12 h. Both stop point farming.
- The MVP job runs hourly and only crowns rooms not crowned yet; the push waits until Monday 08:00 local.
- Starving is ignored after 12 h (a forgotten status shouldn't nag every day). The message repeats the name instead of "him/her".
- Dark mode follows the phone, no toggle. No animation library (CSS keyframes are enough). No iPhone splash images (they need about 10 fixed sizes); iPhone shows the background colour.
- Stale cards fade only their background now (see test record).
- `auto_message_log` and `point_events` have no clean-up yet; add it with the feed/log clean-up (Phase 6).

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
- One room per user, enforced by `statuses.user_id` being the primary key.
- The disk had about 5 GB free. Local Supabase images use about 2 GB; see SETUP.md to remove them.

## Git

Phase 5 work is on branch `phase-5-fun` (from `phase-4-smart`). Phase 4 work is on branch `phase-4-smart` (branched from `phase-3-push` after committing Phase 3). Phase 3 work is on branch `phase-3-push` (branched from `phase-2-room-features`, which came from `phase-1-status-board`); `main` doesn't exist yet. To make this branch `main`, run `git branch -m main`.
