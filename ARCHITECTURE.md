# KONA — Technical Architecture

## Architecture principle
**One LLM + deterministic tools + relational database + rules engine.**

Do not train a custom model for V1.

The LLM is the conversational orchestrator.

The code is the source of truth for numerical calculations and business rules.

## Stack recommendation
- Next.js + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase / PostgreSQL
- Supabase Auth
- Stripe
- Vercel
- OpenAI Responses API or equivalent LLM API with tool/function calling

## High-level flow

User message
→ conversation API
→ LLM agent
→ tool calls as required
→ deterministic calculations / database reads and writes
→ LLM converts structured results into natural language
→ response returned to user

## Client architecture — mobile as the eventual primary client

**Not building a native app now.** No Expo/React Native work starts until
founder testing has validated the current product loop on the web app. This
section is a standing constraint on how everything *between now and then* gets
built, so that a future mobile client is an additive UI, not a rearchitecture.

- **All product logic stays client-independent.** Domain types (`src/domain`),
  the agent/orchestrator/tools/insights (`src/agent`), the calculation engine
  (`src/engine`), and the repository layer (`src/data`) import nothing from
  `react` or `next/*`. `lib/kona-server.ts` is the use-case layer — it takes a
  resolved `KonaContext` and returns plain data, no JSX. Verified periodically:
  `grep -rl "from 'react'\|next/" src/` should return nothing.
- **React components render; they do not decide.** A component receives typed
  JSON from an API route and displays it — it must not parse dates, run
  calculations, classify sessions, or make any judgment call the agent/engine
  should own. If a component starts accumulating that kind of logic, it belongs
  in `src/` or `lib/kona-server.ts` behind the same route instead.
- **The API routes (`app/api/*/route.ts`) are the seam a mobile client would
  reuse.** They're already thin: resolve auth context → call a `kona-server`
  use-case → return JSON. Keep them that way — no HTML, no server-rendered
  markup, nothing an Expo app couldn't call identically over the same JSON
  contract.
- **UI changes stay mobile-first and responsive.** The current layout (single
  column, bottom nav, cards) already reads as a mobile app on desktop — keep
  building that way: no desktop-only interaction patterns (hover-only affordances,
  fixed-width layouts, multi-pane desktop chrome) that would need rework for a
  narrow, touch-first screen.

This is a constraint on *how* web-app work gets built, not a task — do not
start scaffolding a mobile client, an API versioning scheme, or a shared design
system ahead of need.

## Core components

### 1. Conversation layer
Receives natural-language user messages and image uploads.

### 2. Agent layer
Responsible for:
- understanding user intent
- deciding whether information is missing
- requesting only useful clarifications
- calling tools
- composing the final response
- proposing durable memory updates

### 3. Calculation layer
Responsible for:
- session classification
- hydration estimates
- sodium / electrolyte estimates
- carbohydrate estimates
- protein / recovery estimates
- sweat-rate calculations

The calculation engine must be isolated and independently testable.

### 4. Recommendation rules
Responsible for:
- before-workout preparation
- during-workout priorities
- post-workout recovery priorities
- multi-session / double-session preparation
- environment considerations
- relevant historical reminders

### 5. Memory layer
Stores durable facts such as:
- usual bottle size
- usual sports products
- exact product nutrition
- preferred meal shortcuts
- recurring user-reported patterns
- successful setups
- relevant recurring symptoms

Do not store every conversation detail as a permanent memory.

#### 5a. Pattern layer — product-truth discipline (M22)
`src/agent/insights.ts` derives observations from history. Every `Insight`
carries a `kind` (fact / pattern / hypothesis / recommendation) **and** a
`basis` that must not be blurred:
- `reported` — the athlete literally said it.
- `repeated` — it happened N times. **Frequency only** — never proof a setup
  works. "You've done this 3 times" is a count, not effectiveness.
- `outcome` — repetition **plus** a consistent good/bad result signal
  (completed as planned AND felt good / no GI / no bonk, or the mirror image).
  Only `outcome` may call a setup "working" or "repeatedly having problems",
  and even then asserts no cause.
- `adaptation` — reserved; produced by the activity log, not here.

When results are mixed or thin, the honest output is "too early / not enough to
change anything on" **with no recommendation**. Condition-dependent outcomes are
only claimed when good vs bad split cleanly on one variable. Full rules:
`CALCULATION_ENGINE_SPEC.md` §6.5.

### 6. Database & persistence (M23)
Production storage is **Supabase Postgres**, one migration:
`supabase/migrations/0001_init.sql`. Tables: `profiles`, `weekly_plans`,
`planned_sessions`, `sessions`, `fuel_logs`, `recovery_logs`, `messages`,
`personal_memories`, `recommendations`, `activity_events`. Plus a view
`conversation_summaries` (a conversation has no row of its own — it is derived
from its messages, so a physical `conversations` table would be duplicated
derived state). `subscriptions` is not built (no paywall in scope). Insights are
never stored — `deriveInsights()` recomputes them from source records on every
read.

**Boundary.** `Repository` (`src/data/repository.ts`) is unchanged in shape
except that message methods are now user-scoped (`listMessages(userId, …)`,
`deleteMessagesFrom(userId, …)`, `ChatMessage.user_id`). Two implementations:
`InMemoryRepository` (tests, dev fallback) and `SupabaseRepository` (production).
The flow stays **UI → API route → `lib/kona-server` use-case → repository → DB**;
UI never touches Supabase for data. `lib/server-context.ts` resolves the
per-request `{ repo, userId, llm }`.

**Isolation.** Every user-owned row has `user_id uuid` referencing
`auth.users`. RLS policies (`auth.uid() = user_id`) on every table are the
enforcement — the app uses a **user-scoped anon client**, never the service-role
key. `activity_events` has select+insert policies only, so it is append-only at
the database level. Cross-user isolation is proven by
`tests/data/supabase-repository.live.test.ts`.

**Auth.** Supabase magic link. `middleware.ts` refreshes the session cookie and
gates routes (page → redirect `/login`; API → 401). `/login`, `/auth/callback`,
`/api/auth/signout`. Onboarding runs after sign-in, unchanged. With no Supabase
env the app runs a dev-only in-memory single-user fallback, refused in
production. See `DEPLOYMENT.md`.

### 6a. Activity log (M19)
`activity_events` is a typed, append-only stream of meaningful events
(`session_logged`, `fuel_logged`, `checkin_done`, `fact_learned`,
`insight_formed`, `recommendation_adapted`, …), each with a pre-computed
human `summary`. It powers the visible **"how Kona's been learning"** timeline
(told → remembered → became relevant → advice changed) and is the clean seam a
future XP/progression layer would consume — see `PRODUCT_VISION.md` "Future
direction". Emitted from the orchestrator after a turn's tools run
(`recordTurnActivity`) and from the check-in path.

**`recommendation_adapted` is evidence-based (M22).** It is *not* a
forward-looking promise. It fires only when (a) a standing `recommendation`
insight with `basis: 'outcome'` was already on file from an **earlier** turn,
and (b) *this* turn actually produced a piece of advice (a fuelling calc or a
week plan). A newly-formed recommendation is recorded as `insight_formed`
("Kona's take — …") so a later turn can tell it was already known; it does not
by itself claim any recommendation changed. Once per insight.

### 6b. Editing a chat turn — turn attribution + reconciliation (M23.1)
Every structured record a chat turn writes carries `origin_message_id` = the
turn's **user message id** (`planned_sessions`, `sessions`, `weekly_plans`,
`fuel_logs`, `recovery_logs`, `personal_memories`, `activity_events` — migration
`0002`). The orchestrator passes the id into the tool context; each writing tool
stamps it; `deriveTurnEvents` stamps the activity events. Records made outside a
chat turn (end-of-day check-ins) have a null origin.

`editMessage` (edit-and-regenerate) now, in order:
1. `listMessageIdsFrom` — the edited message + everything after it,
2. `deleteRecordsForMessages` — delete every session / weekly plan / fuel log /
   recovery log / memory / activity event stamped with those ids; a deleted
   weekly plan takes its own planned sessions with it; then **null any
   foreign-key reference on a *surviving* row** that pointed at a now-deleted
   record (a later, un-edited record is kept — only its dangling link is cut),
3. `deleteMessagesFrom` — drop the messages,
4. re-run with the new text; the regenerated turn's records get the **new**
   message id as their origin.

The FK on `origin_message_id` is `ON DELETE CASCADE`, so a structured record can
never outlive its originating message even if a message is removed by a path
other than `editMessage`. The result of step 2 is returned to the caller (and
surfaced as `reconciled` on the chat API response — metadata, no UI).

**Deliberate limitations** (documented — an alpha is fine with these):
- A memory the edited turn *updated* rather than first created reverts to
  **unset**, not to its earlier value. There is no memory revision history.
- Profile facts set via chat (body weight, bottle, goal) are one row per user
  with no per-fact provenance, so they are **not** reverted by an edit.
- `update_planned_sessions` (a plan *field* change) is not reverted — only
  records a turn *created* are.
- The transcript model is linear, so "preserve a later dependent record" only
  ever fires as the FK-null safety net; there is no branching edit.

## Important design rule
Never pass the entire user history to the LLM on every message.

Build a compact context package containing:
- relevant profile facts
- current week plan
- current session
- similar historical sessions
- recent relevant symptoms
- known products / foods
- important durable memories

## Structured information classes
Each fact should have a provenance / certainty concept where practical:
- known
- user_reported
- estimated
- inferred
- recommended

The UI and prompt should treat these differently.

## Planned vs actual
Planned sessions and actual sessions are separate records.

Actual session may contain:
- completed
- modified
- skipped
- stopped early

Reason is stored separately.

## Suggested tool set

### get_user_profile
Input: user_id

### get_week_plan
Input: user_id, week_start

### save_or_update_plan
Input: user_id, plan object

### calculate_fueling_targets
Input:
- sport
- duration
- distance
- intensity
- body weight
- temperature
- humidity
- sweat rate if known
- session sequence / multi-session context

Returns:
- estimated fluid range
- estimated sodium range
- estimated carbohydrate range
- recovery / protein target where appropriate
- confidence
- methodology version
- notes / factors

### estimate_food
Input:
- user description
- optional image
- optional portion information

Returns:
- identified food
- estimated ranges
- confidence
- clarifying question if valuable

### save_actual_session
Input: user_id + actual session object

### save_recovery
Input: recovery object

### get_relevant_history
Input: user_id + similarity/context filters

Returns only relevant sessions / events.

### propose_memory_update
The AI may propose a memory candidate; application code validates and persists it.

## Context package example

Built by `src/agent/context.ts` and serialized into both the interpret and
compose prompts (`src/agent/anthropic-llm.ts`). Never the whole history — a
compact package the turn plausibly needs.

GOAL
- "First Olympic-distance triathlon in June" (event_date if known)

PROFILE (self-reported)
- weight: 64kg  (may be null — collected contextually)
- sports: running, cycling, swimming, strength
- bottle: 750ml

CURRENT WEEK PLAN + pending_plan_details (sessions still missing effort/length/time)

CURRENT / LAST SESSION
- current_plan (next upcoming) · last_actual_session

HISTORY  (recent, all sports — deeper lookups via get_relevant_history)
- recent_sessions: date, sport, status, distance/duration, intensity, reason
- recent_recovery: date, the athlete's words, coarse severity, symptoms
- recent_fuel: date, items (description, quantity, known label values, certainty)

MEMORIES
- durable facts the athlete has told Kona (next_race, typical_week, preferences)

## Agent loop

1. Receive message.
2. Determine conversation state / user intent.
3. Build relevant context.
4. Decide whether clarification is needed.
5. Call tools as needed.
6. Validate outputs.
7. Compose concise user-facing response.
8. Propose durable memory updates if appropriate.
9. Persist conversation and structured changes.

## No vector database in V1
Structured SQL retrieval is enough initially.

Semantic search can be introduced later if conversation-derived memory becomes large.
