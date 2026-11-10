# WeGood? 🛋️

A mobile-first PWA that lets roommates see each other's status at a glance: where they are, how hungry they are, what they're bringing home and when they'll be back. Every common action takes 1-2 taps.

Project rules live in [CLAUDE.md](CLAUDE.md).

| Document | Read it for |
|---|---|
| [docs/PROGRESS.md](docs/PROGRESS.md) | What's done, what's been tested, what's next. **Start here when resuming.** |
| [docs/SETUP.md](docs/SETUP.md) | Connecting Supabase, email, running on a phone |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the app works and why it's built this way |

## Stack

Next.js 16 (App Router), strict TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth, Realtime). Planned: Web Push, Vercel hosting, and AWS for Phase 6.

## Quick start

Requires Node 22 or later (the project pins 24 in `.nvmrc`).

```bash
nvm install    # first time only; reads .nvmrc
nvm use
npm install
cp .env.example .env.local    # then fill in values, see docs/SETUP.md
npm run dev
```

Open http://localhost:3000. Until `.env.local` has real Supabase values, pages can't load.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run dev -- -H 0.0.0.0` | Dev server reachable from a phone on the same Wi-Fi |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type-check |
| `npm run build` | Production build |

## Folder map

```text
app/(app)/           In-room tabs: board (/), stuff, requests, me (shared tab bar layout)
app/                 Also: login, onboarding, auth/confirm, profile (redirects to /me)
components/auth/     Login and create/join room forms
components/board/    Board, member cards, status bottom sheet, activity feed
components/stuff/    Home Stuff: pantry tiles, add sheet, shopping list
components/requests/ Requests: quick-create sheet, request cards
components/nav/      Bottom tab bar
components/profile/  Name and avatar form
components/ui/       Shared UI (toast, bottom sheet, confirm sheet, hooks)
lib/supabase/        Browser, server and proxy Supabase clients
lib/room.ts          Server-side loading of the signed-in user's room
lib/status.ts        Location, hunger and chip definitions
lib/time.ts          Relative times, staleness, ETA calculation
proxy.ts             Login protection for every route (Next 16's middleware)
supabase/migrations/ All schema changes, as SQL files
supabase/tests/      RLS isolation tests (Phase 1 and Phase 2)
types/database.ts    TypeScript types for the database
```

## Security rules

- Row Level Security is on for every table.
- Users' GPS coordinates are never stored.
- Secrets stay in server-side environment variables. `.env.example` holds names only.
- Schema changes go through `supabase/migrations`.
