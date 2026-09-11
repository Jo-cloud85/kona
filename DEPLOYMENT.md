# Kona — Deployment & Persistence (M23)

Kona now persists everything a real athlete accumulates — profile, goal, plans,
sessions, fuel, recovery, memories, activity events, conversations — in Supabase
Postgres, isolated per user by Row Level Security, behind Supabase magic-link
auth.

## Environments

| Env | Persistence | Auth | Notes |
|---|---|---|---|
| **development** (no Supabase vars) | in-memory, single local user | none | `npm run dev`; state resets on restart. A loud console warning is printed. |
| **development** (Supabase vars set) | Supabase | magic link | real behaviour locally |
| **test** | in-memory | n/a | `vitest`; the live Supabase suite is skipped unless `KONA_TEST_SUPABASE_*` is set |
| **production** | Supabase (**required**) | magic link | missing Supabase vars → every request 500s by design, never a silent single-user mode |

All configuration is environment variables — see `.env.example`. Nothing is
committed. The Supabase **service-role key is never used by the app**; a
user-scoped anon client + RLS is the boundary.

## One-time Supabase setup

1. Create a project at supabase.com.
2. **SQL Editor → New query →** run each migration in order:
   `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_origin_message_id.sql`.
   (Or, with the Supabase CLI: `supabase db push`.) `0002` is additive and safe
   to run on an existing project.
3. **Authentication → Providers → Email**: enable, "Confirm email" on. For local
   testing you can also enable "Enable email OTP".
4. **Authentication → URL Configuration**: set Site URL to your app origin and add
   `<origin>/auth/callback` to Redirect URLs (add `http://localhost:3000/auth/callback`
   for local dev).
5. **Settings → API**: copy the Project URL and the `anon` public key.

## Environment variables

```
ANTHROPIC_API_KEY=…              # existing — the conversation model
NEXT_PUBLIC_SUPABASE_URL=…       # Supabase Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=…  # Supabase anon public key
```

Set these in `.env.local` for local dev, and in the Vercel project settings for
preview/production. That is the whole configuration.

## Deploy (Vercel)

1. Import the repo. Framework preset: Next.js. No build overrides.
2. Add the three env vars above (Production + Preview).
3. Deploy. `middleware.ts` refreshes the auth session on every request and
   redirects unauthenticated page loads to `/login`; unauthenticated API calls
   get 401.

## Running the live persistence tests

These are the only tests that exercise real RLS and cross-process persistence.

1. Create a **second, disposable** Supabase project; apply `0001_init.sql`.
2. Set in `.env.local` (or the shell):
   ```
   KONA_TEST_SUPABASE_URL=…
   KONA_TEST_SUPABASE_ANON_KEY=…
   KONA_TEST_SUPABASE_SERVICE_ROLE=…   # Settings → API → service_role (test project only)
   ```
3. `npm test` — `tests/data/supabase-repository.live.test.ts` now runs: it mints
   two throwaway users, writes as user A, re-reads from a fresh client (proving
   persistence survives a "restart"), asserts user B sees none of A's data and
   cannot write rows it doesn't own, and asserts `activity_events` are immutable.
   The users are deleted in `afterAll`.

## Editing a chat turn — reconciliation (M23.1)

`editMessage` now reconciles the structured records a removed turn created:
every session / weekly plan / fuel log / recovery log / memory / activity event
stamped with `origin_message_id` in the removed range is deleted, and any
dangling foreign key on a surviving row is nulled. See `ARCHITECTURE.md` §6b for
the full flow and the deliberate limitations (a memory that was *updated* by the
edited turn reverts to unset not to its prior value; chat-set profile facts are
not reverted; plan field-updates are not reverted).
