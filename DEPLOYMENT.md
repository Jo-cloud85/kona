# Kona — Deployment & Persistence (M23)

Kona now persists everything a real athlete accumulates — profile, goal, plans,
sessions, fuel, recovery, memories, activity events, conversations — in Supabase
Postgres, isolated per user by Row Level Security, behind Supabase magic-link
auth.

**Live (2026-09-12):** deployed via `vercel link` + `vercel deploy --prod`,
project `jo-youngs-projects/kona`, auto-connected to the `Jo-cloud85/kona`
GitHub repo (pushes to `main` now auto-deploy to production; PR branches get
preview deploys). Production URL: `https://kona-livid.vercel.app`. Env vars
(`ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`KONA_LLM_MODEL`) are set in Vercel for both Production and Preview, copied from
`.env.local`. **Outstanding:** the Supabase Auth redirect URL still needs to be
added by hand (see step 5 under "Deploy (Vercel)" below) — the CLI can't do
that part.

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
   for local dev). **You'll come back and add the Vercel production URL here too
   — see "Deploy (Vercel)" below; it can only be added after the first deploy.**
5. **Settings → API**: copy the Project URL and the `anon` public key.

## Environment variables

```
ANTHROPIC_API_KEY=…              # existing — the conversation model
NEXT_PUBLIC_SUPABASE_URL=…       # Supabase Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=…  # Supabase anon public key
KONA_LLM_MODEL=…                 # optional but recommended — see note below
```

Set these in `.env.local` for local dev, and in the Vercel project settings for
Production (and Preview, if you want preview deploys to behave the same way).
That is the whole configuration.

`KONA_LLM_MODEL` defaults to `claude-opus-5` when unset (`src/agent/anthropic-llm.ts`).
If local dev is pinned to a different model (e.g. `claude-sonnet-5` in
`.env.local`), set the same value in Vercel deliberately — otherwise production
silently runs a different, pricier model than what you've been testing against.

Never set `KONA_TEST_SUPABASE_URL` / `_ANON_KEY` / `_SERVICE_ROLE` in Vercel —
they're local/CI-test-only, point at a disposable second project, and the
service-role key in particular must never reach a deployed environment.

## Deploy (Vercel)

Order matters here because the production URL doesn't exist until after the
first deploy, and Supabase needs that exact URL to allow the auth redirect.

1. Import the repo into Vercel. Framework preset: Next.js — auto-detected, no
   build overrides needed.
2. Add the env vars above to the Vercel project (Production; also Preview if
   you want preview deployments to work the same way). Do this before the
   first deploy if possible, so the initial build already has them.
3. Deploy. `middleware.ts` refreshes the auth session on every request and
   redirects unauthenticated page loads to `/login`; unauthenticated API calls
   get 401 — so a deploy with the Supabase vars missing/wrong fails loudly
   (500s), never silently.
4. Once deployed, note the assigned Production domain (Vercel → Project →
   Settings → Domains — looks like `<project>.vercel.app`, or your custom
   domain if you add one).
5. Back in Supabase → Authentication → URL Configuration: set **Site URL** to
   that domain, and add `https://<that-domain>/auth/callback` to **Redirect
   URLs**. Keep the existing `http://localhost:3000/auth/callback` entry too —
   the list is additive, so local dev keeps working unchanged.
6. Sign in at the Vercel URL to confirm the magic-link round trip works in
   production before treating it as ready for founder testing.

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
