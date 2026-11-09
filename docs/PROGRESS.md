# Progress

Last updated: 2026-11-09

| Phase | Status |
|---|---|
| 0. Setup | Done, except hosted Supabase connection and Vercel |
| 1. MVP status board | Code complete, tested locally. **Not yet on the real project** |
| 2. Room features | Next |
| 3. Push notifications | Not started |
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

**Not tested yet:**
- Clicking through the screens in a real browser
- Two-browser acceptance test
- Real magic-link emails
- Any phone (Android Chrome or iPhone Safari)
- Anything on the hosted project

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

Work is on branch `phase-1-status-board`; `main` doesn't exist yet. To make this branch `main`, run `git branch -m main`.
