# WeGood?

You are helping me build "WeGood?", a mobile-first PWA for 4 roommates (designed to support up to ~15 users across a few rooms). Save this as CLAUDE.md at the repo root and follow it in every session.

PURPOSE: Roommates instantly see each other's status (where they are, hunger level, bringing something home, energy level, upcoming plans) and shared room state (groceries, ready food, requests like "pick my clothes", visitor notes). Every common action must take 1-2 taps. The app should be fun: emoji avatars, playful status text, room points with a weekly MVP, and funny auto-messages.

STACK: Next.js (App Router) + TypeScript (strict) + Tailwind CSS; Supabase (Postgres, Auth with email magic link, Realtime, Edge Functions, pg_cron); Web Push with VAPID keys; hosted on Vercel free tier. Phase 6 adds GitHub Actions, AWS Lambda + EventBridge Scheduler, Terraform and CloudWatch.

NON-NEGOTIABLE RULES:
- Row Level Security enabled on EVERY table; users may only read/write data for rooms they belong to.
- Never store users' GPS coordinates. The phone computes the geofence locally and sends only at_home true/false.
- Secrets (service role key, VAPID private key, AWS keys) only in server-side env vars; never in client code or git. Keep .env.example updated with variable NAMES only.
- All schema changes go through SQL migration files in supabase/migrations.
- Mobile-first UI (design for 375px width first), large tap targets (min 44px), works on Android Chrome and iPhone Safari.
- Keep it simple: no extra frameworks unless I approve. Prefer server components and Supabase client SDK.
- After each task, tell me exactly what to test manually and what commands to run.
- Explain non-obvious decisions briefly in comments and in your summary, I am a student and want to learn.

PHASES: 0 setup, 1 MVP status board, 2 room features, 3 push notifications, 4 geofence + energy + schedule, 5 fun layer, 6 CI + AWS + docs.
