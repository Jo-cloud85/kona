# Kona

**Your AI endurance companion.**

Kona learns what you're training for, what you did, how you fuelled and how
you felt — then helps you prepare for the next one. It's built for the
self-coached, moderately serious, multi-sport recreational athlete: run, bike,
swim, triathlon, strength. Fuelling is the wedge; the long-term value is the
*relationship and accumulated understanding of the athlete*, not a calculator
or a nutrition tracker.

The architecture is deliberately boring: **one foundation model as the
conversational orchestrator + a deterministic rules engine as the source of
truth for every number + a relational database for longitudinal memory.** The
LLM interprets, asks, and explains — it never invents a fuelling target and
never diagnoses.

## Status

Private, pre-alpha. The 2026 product-reset milestone series (M14.1 → M23.1) is
complete — real conversational model, a deterministic pattern/insight layer, a
daily-briefing Home screen, production persistence on Supabase with per-user
Row Level Security, and turn-level edit reconciliation. The founder is running
the live-Supabase verification journey now, ahead of alpha testing.

See [`progress.md`](progress.md) for the current milestone, full history, and
known issues, and [`tests/acceptance-scenarios.md`](tests/acceptance-scenarios.md)
for the behaviour each milestone is expected to satisfy.

## Documentation map

| Doc | What's in it |
|---|---|
| [`PRODUCT_VISION.md`](PRODUCT_VISION.md) | Product thesis, target athlete, core loop, scope boundaries |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design, persistence/auth, the client-architecture directive (mobile as the eventual primary client) |
| [`CALCULATION_ENGINE_SPEC.md`](CALCULATION_ENGINE_SPEC.md) | The deterministic fuelling/hydration/sodium/carbohydrate rules the engine implements |
| [`AGENT_SPEC.md`](AGENT_SPEC.md) | How the conversational agent should behave — tool use, memory, response style |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Supabase setup, environment variables, going to production, running the live persistence tests |
| [`progress.md`](progress.md) | Milestone-by-milestone build log, current status, known issues |
| [`CLAUDE.md`](CLAUDE.md) | Working agreement for AI-assisted development on this repo |

## Tech stack

- **Next.js** (App Router) + **TypeScript** (strict)
- **Supabase**: Postgres (with Row Level Security) + Auth (magic link)
- **Anthropic API** for the conversational model, with a deterministic
  rule-based client as an offline/CI/no-key fallback
- **Vitest** for tests

## Project layout

Business logic is kept independent of the UI framework so it stays testable
and portable (see `ARCHITECTURE.md` → "Client architecture"):

```
src/
  domain/     Shared types, validation, provenance/certainty rules
  engine/     The deterministic calculation engine (CALCULATION_ENGINE_SPEC.md)
  agent/      Orchestrator, tools, conversation clients, insights, memory
  data/       Repository interface + InMemoryRepository + SupabaseRepository
  cli/        A minimal terminal chat harness for manual testing
lib/
  kona-server.ts     Use-case layer the API routes call into
  server-context.ts  Resolves { repo, userId, llm } per request (auth boundary)
  supabase/          Supabase client helpers (server, browser, middleware)
app/
  api/       Next.js route handlers — thin: resolve context → call a use-case → return JSON
  *.tsx      UI components — render typed data, no business logic
supabase/
  migrations/  SQL schema + RLS policies
tests/
  agent/, data/, domain/, engine/, server/   Unit + integration tests
```

None of `src/domain`, `src/engine`, `src/agent`, or `src/data` import from
`react` or `next/*` — the same use-case layer could sit behind a different
client (e.g. a future mobile app) without changes.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in at least ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Without `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` set, the
app runs a **dev-only fallback**: in-memory storage, one fixed local user, no
sign-in, state resets on restart. This is intentional — it lets you run the
app with zero external setup. Set those two variables (see
[`DEPLOYMENT.md`](DEPLOYMENT.md)) to use real Supabase persistence and
magic-link sign-in locally; that fallback is refused when `NODE_ENV=production`.

Without `ANTHROPIC_API_KEY`, chat falls back to a deterministic, rule-based
conversation client — enough to exercise the app, but it can't hold an
open-ended conversation the way the real model can.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Run a production build |
| `npm test` | Run the test suite once (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run chat` | Interactive terminal chat REPL. `npm run chat -- "msg one" "msg two"` sends a scripted sequence; `npm run chat -- --demo` runs the four canonical slice messages; add `--llm=anthropic` to use the real model instead of the deterministic fallback |

## Testing

```bash
npm test
```

Runs against the in-memory repository — no external services needed. A
separate live-Supabase suite (`tests/data/supabase-repository.live.test.ts`)
proves real Row Level Security and cross-restart persistence against an actual
project; it's skipped unless `KONA_TEST_SUPABASE_*` env vars point at a
disposable test project (see `DEPLOYMENT.md`).

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full guide: one-time Supabase
project setup, running the SQL migrations, required environment variables, and
deploying to Vercel.

---

This is a private side project, not an open-source or commercially licensed
product.
