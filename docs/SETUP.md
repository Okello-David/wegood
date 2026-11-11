# Setup

## 1. Node

The project needs Node 22 or later and pins 24 in `.nvmrc`. Run `nvm use` inside the project folder in each new terminal, because your nvm default stays on Node 20 for other projects.

## 2. Supabase project

Use the project in **Okello-David's Org** (Europe). Do not use "allaninfo-tech's Project", which belongs to a different org.

Find the values in the Supabase dashboard:

- **Project ID:** in the address bar, `supabase.com/dashboard/project/<project-id>`
- **URL:** `https://<project-id>.supabase.co`
- **Publishable key:** Project Settings → API Keys, starts with `sb_publishable_`

Put them in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never paste the service role or secret key into chat, client code or git. Restart `npm run dev` after changing `.env.local`.

## 3. Apply the database migration

```bash
npx supabase login
npx supabase link --project-ref <project-id>
npx supabase db push
npx supabase gen types typescript --project-id <project-id> > types/database.ts
npx tsc --noEmit
```

`types/database.ts` is currently hand-written, so that generation step replaces it with the real thing.

## 4. Prove room isolation

Paste `supabase/tests/rls_isolation.sql` into the Supabase SQL Editor and run it. Success is one row reading `ALL RLS CHECKS PASSED`. Then do the same with `supabase/tests/rls_room_features.sql` (Phase 2), which ends with `ALL PHASE 2 RLS CHECKS PASSED`. It runs in a transaction and rolls back, so it leaves no data.

With `psql`, always include `ON_ERROR_STOP`, or the success line can print after a failure:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_room_features.sql
```

## 5. Email

Supabase's built-in sender only delivers to members of your org's team and has a very low hourly limit, so roommates couldn't log in.

1. Create a free [Brevo](https://www.brevo.com) account and verify a sender address.
2. Copy its SMTP host, port, login and key.
3. Enter them in Supabase under Authentication → SMTP Settings.

## 6. Login redirects

Under Authentication → URL Configuration, add:

```text
http://localhost:3000/**
http://192.168.1.168:3000/**
```

## 7. Email templates

In **both** the Magic Link and Confirm Signup templates (first-time users receive Confirm Signup), set the link to:

```text
{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email
```

## 8. Test with two browsers

1. Run `npm run dev` and open http://localhost:3000 in a normal window. Log in and create a room.
2. Log in as a different email in a private window and join with the invite code.
3. Change hunger in one window. The other should update in about a second.

To test the stale state, run this in the SQL Editor. The trigger normally blocks fake timestamps, so it's turned off for a moment:

```sql
alter table public.statuses disable trigger statuses_touch;
update public.statuses set updated_at = now() - interval '4 hours';
alter table public.statuses enable trigger statuses_touch;
```

## 9. Test on a phone

```bash
npm run dev -- -H 0.0.0.0
```

On the same Wi-Fi, open `http://192.168.1.168:3000`, log in, and open the email link on the phone.

- **Can't connect:** run `sudo ufw allow 3000/tcp`.
- **IP changed** (check with `hostname -I`): update `allowedDevOrigins` in `next.config.ts` and the redirect URL in step 6.

## 10. Testing against a local Supabase

Docker can run a throwaway Supabase, which is useful for testing migrations safely. It uses a few GB of disk.

```bash
npx supabase start -x studio,imgproxy,logflare,vector,supavisor,postgres-meta,storage-api --ignore-health-check
docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_isolation.sql
docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_room_features.sql
docker exec -i supabase_db_wegood psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_push.sql
node supabase/tests/notify_routing.mjs    # needs step 11 done
npx supabase stop              # keeps your local data
npx supabase stop --no-backup  # throws the local data away
```

Since Phase 3 the edge runtime is no longer excluded, because it runs the `notify` function.

To reclaim the disk space afterwards, check no other project needs the images, then run:

```bash
docker images --format '{{.Repository}}:{{.Tag}}' | grep 'ecr.aws/supabase' | xargs -r docker rmi
```


## 11. Push notifications (Phase 3)

Push needs three secrets. None of them may be committed.

| Name | What it is | Where it goes |
|---|---|---|
| VAPID public key | Lets a phone check a push came from us | `.env.local` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and the function as `VAPID_PUBLIC_KEY` |
| VAPID private key | Signs every push | The function only, as `VAPID_PRIVATE_KEY` |
| Hook secret | Lets the database prove itself to the function | The function as `NOTIFY_HOOK_SECRET`, and Supabase Vault |

`VAPID_SUBJECT` is a contact for the push services, written as `mailto:you@example.com`. Use a real address on the hosted project; Apple can reject made-up ones.

### Local

Already done on this laptop on 2026-11-10. To redo it:

```bash
npx web-push generate-vapid-keys          # prints a public and a private key
openssl rand -base64 32                   # a hook secret
```

Create `supabase/functions/.env` (git-ignored):

```bash
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:you@example.com
NOTIFY_HOOK_SECRET=<hook secret>
```

Put the public key in `.env.local` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, restart Supabase, and rebuild the app.

Then tell the database where the function is. Inside Docker the database reaches it through the gateway container, not `localhost`:

```bash
docker exec -i supabase_db_wegood psql -U postgres <<'SQL'
delete from vault.secrets where name in ('notify_url', 'notify_hook_secret');
select vault.create_secret('http://supabase_kong_wegood:8000/functions/v1/notify', 'notify_url');
select vault.create_secret('<hook secret>', 'notify_hook_secret');
SQL
```

Vault values live in the local database, so they survive `supabase stop` but not `stop --no-backup` or `db reset`.

### Hosted project

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... NOTIFY_HOOK_SECRET=...
npx supabase functions deploy notify
```

In the SQL Editor:

```sql
select vault.create_secret('https://<project-id>.supabase.co/functions/v1/notify', 'notify_url');
select vault.create_secret('<hook secret>', 'notify_hook_secret');
```

Add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to Vercel's environment variables. Generate a fresh key pair for the hosted project; don't reuse the local one.

### Debugging "my phone didn't buzz"

```sql
-- What notify decided, newest first: rule used, who was targeted, who was skipped and why.
select created_at, kind, title, rule, targeted, skipped, sent
from public.notification_log order by id desc limit 10;

-- Did the database reach the function at all? (pg_net keeps recent answers for a few hours)
select id, status_code, left(content, 200), error_msg, created
from net._http_response order by id desc limit 10;
```

Function logs: `docker logs supabase_edge_runtime_wegood` locally, or Edge Functions → notify → Logs in the dashboard.
