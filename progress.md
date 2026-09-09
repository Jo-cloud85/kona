# Kona — Progress

## Current milestone
**Product reset (2026) in progress.** Kona re-scoped to an *AI endurance
companion* — relationship + accumulated understanding, not a nutrition tracker.
**M14.1–M18 + M15.1 done.** Next: **M19** — make the feedback loop visible.
Founder direction: no visual redesign, don't fabricate insights, stop for a
product review after M21. See the reset milestone plan below + `PRODUCT_VISION.md`.

### M18 — Home is a daily briefing ✅
_"I've looked at your day, your history and your goal — here's what you should
know." Same dark cards, no redesign._
- `HomeView.selected.fuel` / `methodology` replaced by `HomeView.briefing`:
  - **YOUR DAY** — `{ headline, line, fuelling|null, needs[] }`. Plain-language
    line ("Nothing unusual today. Keep it easy and eat normally."); the
    during-/around-session numbers appear only when the session is big enough to
    earn them; `needs` lists unset details and the line nudges to chat.
  - **ONE THING TO THINK ABOUT** — `{ when, headline, line } | null`. The next
    key day (long / double / hard) after today; the line is the prep note plus a
    *real* "this worked before" pattern from `deriveInsights` ("Your last 3
    cycling sessions all went to plan… I'd keep your usual setup"), never
    fabricated. Null when nothing notable is coming up → section hidden.
  - **KONA REMEMBERS** — 0–2 lines: recurring-symptom / hydration FACTs, then a
    pattern not already shown, then a stated preference. Empty → section hidden.
- New `hydrationFlag` insight detector (early thirst / low on fluid ≥2× → FACT).
- `buildHome` now takes `actualSessions / recoveryLogs / fuelLogs / memories`
  and runs `deriveInsights`; `getHome()` fetches them.
- `HomeTab.tsx` rewritten to render the three sections; day strip, check-in dot
  + banner + dialog, and the profile overlay are unchanged.
- Tests: `home.test.ts` reworked to the briefing shape (12 tests, +hydration
  detector). **130 total**; `tsc` / `eslint` / `next build` clean. Verified in
  the browser against the founder's example (easy day → prose only; long ride
  tomorrow → "ONE THING" with the pattern line; two thirst mentions → "KONA
  REMEMBERS").

### M17 — "What Kona knows about you" (replaces the chart Dashboard) ✅
_Show evidence of learning, not raw DB fields. No visual redesign — reuses the
existing dark cards._
- Removed `app/DashboardView.tsx`, `app/dashboard/`, `app/api/dashboard/route.ts`,
  `getDashboard()`. `buildDashboard` stays (Home still uses it for during-session
  numbers). Nav is now **Home · Memory · Chat** (`kona.tab` migrates
  `dashboard` → `memory`).
- `src/agent/knows.ts` — `buildKnows()` → `KnowsView` with three honest strands:
  **what Kona's worked out** (the M16 `Insight[]`, each with an expandable
  "Why Kona thinks this" listing the supporting observations), **what you've told
  Kona** (`profile.goal` + durable memories, keys turned into readable labels),
  **recent training on record** (last 6 actual sessions + a same-day "felt"
  snippet). `has_anything=false` → an honest empty state, never invented content.
- `Insight` gained `evidence: string[]` — populated by every detector ("9 Sep ·
  50 km easy cycling", `"5 Sep · \"calf sore\" (felt significant)"`).
- `GET /api/knows`; `KnowsView.tsx` renders it.
- Tests: +4 (`tests/agent/knows.test.ts`), updated insights tests for `evidence`.
  **127 total**; `tsc` / `eslint` / `next build` clean. Live-tested: after a few
  ride + calf logs the view shows the cycling PATTERN, the calf FACT with quoted
  evidence, the two SUGGESTIONs, the goal + an auto-remembered "recurring calf
  issue", and the recent rides.

### M16 — deterministic pattern layer ✅
_The half of the loop that makes Kona "know" the athlete: turn accumulated
history into a few honest, labelled observations — computed in code, not
invented by the model._
- `src/agent/insights.ts` — `deriveInsights({ actualSessions, recoveryLogs,
  fuelLogs, memories })` → `Insight[]`. Each carries `kind`
  (**fact / pattern / hypothesis / recommendation**), `text` (ready to show),
  `certainty` (high / moderate / low), `evidence_count`, `topic`, `as_of`.
  Four conservative detectors: a per-sport routine that keeps going to plan
  (PATTERN + "keep it" RECOMMENDATION); a body part / symptom mentioned ≥2×
  (FACT — explicitly non-diagnostic; + a gentle "get it assessed" RECOMMENDATION
  when a mention was moderate+); ≥3 of the last ≤6 sessions off-plan (FACT, no
  cause implied); a fuel item logged ≥3× (FACT — "a staple"). HYPOTHESIS is not
  auto-detected (premature with little data, risks implying causation) — that
  stays the model's job in chat, guided by `COMPOSE_SYSTEM`. Empty history → `[]`.
- Wired into `ContextPackage.insights` via `buildContext` (runs over the FULL
  history every turn); `contextForPrompt()` passes `{kind, text}` to the model,
  and `COMPOSE_SYSTEM` says to lean on them and keep each tag's meaning.
- `GET /api/insights` + `getInsights()` in `kona-server.ts` (for M17).
- `INTERPRET_SYSTEM` memory guidance broadened: propose memories for standing
  preferences, constraints, go-to setups and recurring body flags — not just
  `next_race` / `typical_week`.
- Tests: +6 (`tests/agent/insights.test.ts` — every detector + the not-enough-
  data case). **123 total**; `tsc`, `eslint`, `next build` clean. Live-tested:
  after logging a couple of tight-calf notes, `/api/insights` returns the FACT +
  RECOMMENDATION, and the chat reply weaves in "your right calf has come up
  twice now… if it keeps recurring, worth getting it looked at" — non-diagnostic.

### M15 — real model is the shipped path + full context wiring ✅
_The Anthropic client existed but (a) the launch config forced the deterministic
stub and (b) `context.history` was fetched and never serialized into the
prompt — so the "companion that knows me" half of the loop was dead._
- **`.claude/launch.json`** no longer forces `KONA_LLM=deterministic`. The real
  model is used whenever `ANTHROPIC_API_KEY` is set (via a git-ignored
  `.env.local`); the deterministic stub is the fallback for no-key / CI /
  `KONA_LLM=deterministic`. `getLlm()` logs which client is active.
- **`RelevantHistory` gained `recent_fuel_logs`**; `context.ts` requests recent
  activity across all sports (limit 6, no sport filter — "what have you been
  doing"). `get_relevant_history` stays for deeper sport-specific lookups.
- **`contextForPrompt()` now serializes `history`** (recent_sessions /
  recent_recovery / recent_fuel) and `profile.goal` into *both* the interpret
  and compose prompts. `COMPOSE_SYSTEM` gained the FACT / PATTERN / HYPOTHESIS
  distinction and "if a setup has repeatedly worked, keep it" guidance.
- **`INTERPRET_SYSTEM` reworked**: when no tool is needed and the athlete asked
  a question answerable from context ("what do you know about my long rides?",
  "how's my week looking?"), the model writes the reply itself instead of
  emitting reasoning like "no tool calls needed here". Also nudged to log fuel
  and feelings mentioned *alongside* a session ("rode 60k, had porridge and two
  gels, felt strong").
- Docs: `ARCHITECTURE.md` context-package example updated (goal + history/fuel).
- Live-tested against `claude-sonnet-5`: a session-log message logs
  session+fuel+recovery; "what do you know about me" returns a real summary;
  a repeat-ride planning question references the prior ride and says "that
  worked once — keep it". 114 tests green (+1 asserting goal/history reach both
  prompts); `tsc`, `eslint`, `next build` clean.

### M14.2 — Slim onboarding + contextual weight + endurance-first ✅
_2026 reset, step 2. The ~13-field intake form was the first impression and it
read as "medical intake"; every field cut lifts first-conversation completion._
- **Onboarding is 3 fields**: your name · which endurance sports (Running /
  Cycling / Swimming / Triathlon / Strength) · "What are you working towards?"
  (free text → `Profile.goal.text`). Removed height, activity level, the
  14-option dietary restrictions, the 3× 1–5 self-perception sliders, and made
  gender / age / weight all optional and not asked at onboarding.
- **`body_weight_kg` is now optional.** `profileDailyBaseline` and
  `calculateFuelingTargets` return `protein_daily_g` / `post_workout_protein_per_kg_g`
  as `null` when weight is unknown; hydration / carb / sodium are unaffected
  (weight-independent). `buildDashboard` + `DashboardView` handle the null.
- **New `save_profile_fact` tool** ({ body_weight_kg?, usual_bottle_ml? } →
  `upsertProfile` merge). Kona collects weight **contextually**: after a plan
  when weight is unknown the reply asks once ("what do you weigh? … say 'I'm 68
  kg'"), and "I'm 64 kg" / "my usual bottle is 750 ml" route to
  `save_profile_fact` (deterministic + Anthropic paths). Intent
  `note_profile_fact`.
- **`ProfileForm` has `mode: 'onboard' | 'settings'`** — onboarding shows the 3
  fields; the Home Profile overlay (settings) adds weight / bottle / sessions /
  age / gender / injury note, all optional.
- **`Profile.goal: TrainingGoal`** ({ text; event_date? }) — passed into the
  Anthropic context; the starter greeting acknowledges it ("You're working
  towards: …") instead of the old wall of protein/fluid/sodium numbers.
- **Sports**: `ONBOARDING_SPORTS` = running / cycling / swimming / triathlon /
  gym(strength). The `Sport` union keeps the wider set so free-text mentions of
  other activities still parse.
- Docs: `PRODUCT_VISION.md` target-customer section; header copy re-pointed
  ("AI endurance companion") in `Chat.tsx`, `layout.tsx`, `starter.ts`.
- 113 tests green (rewrote `profile-input` / `starter` suites for the new
  contract; +5 `profile-fact` tests; +1 baseline null-weight test); `tsc`,
  `eslint`, `next build` clean. Full onboard → greeting → plan → weight-nudge →
  `save_profile_fact` flow verified in the browser.

### Reset milestone plan
UX north-star: every screen says _"I've looked at your situation, your history
and your goal — here's what I think you should know"_, not "here is information
about your training." **No major visual redesign** (keep dark theme, layout,
palette, bottom nav, cards, typography). **Never fabricate insights / examples
when real data is missing — honest empty states.** Persistence, gamification and
integrations are out of this cycle. **Stop for a product review after M21.**

- **M14.1** ✅ De-scope: remove the Daily tab + Mifflin–St Jeor energy model + food catalog; nav → Home/Dashboard/Chat; docs re-pointed.
- **M14.2** ✅ Slim onboarding (name · endurance sports · what you're training for); weight optional + collected contextually via `save_profile_fact`; sports trimmed to run/bike/swim/tri + strength; goal captured.
- **M15** ✅ Anthropic is the shipped conversational path; `history` + `goal` wired into the prompts; model answers no-tool questions directly.
- **M15.1** ✅ Edit a sent chat message → regenerate the reply.
- **M16** ✅ Deterministic pattern layer — `deriveInsights()` → `Insight[]` (fact / pattern / hypothesis / recommendation + certainty).
- **M17** ✅ "What Kona knows about you" view replaces the chart Dashboard — insights with expandable "Why Kona thinks this" evidence, "what you’ve told Kona" (goal + memories), recent training on record; honest empty state.
- **M18** ✅ Home is a daily briefing — YOUR DAY (prose; numbers only when the session earns them) / ONE THING TO THINK ABOUT (next key session + a real "this worked" pattern line, never fabricated) / KONA REMEMBERS (recurring facts). Day strip + check-in kept; no visual redesign.
- **M19** Make the feedback loop **visible**: told → remembered → recurred → recommendation changed. Introduce a typed activity/event log (also future-proofs a possible XP layer — see `PRODUCT_VISION.md` "Future direction").
- **M20** Goal context appears naturally through Home + relevant chat ("Week 6 of 12", "11 weeks until your triathlon") — context for the assistant, not a generic plan app.
- **M21** Stop prompting for every session up front — only the next 1–2 key ones. Chat should also *initiate* useful context ("Tomorrow's your first 2-hour ride of this block — want to sort fuelling first?").

## Completed work

### M15.1 — edit a sent chat message → regenerate the reply ✅
_User ask: fix a mis-typed message and have Kona re-answer._
- **Backend**: `AgentTurn` now returns `user_message_id` / `assistant_message_id`
  (the orchestrator was discarding the appended `ChatMessage`s). New
  `repo.deleteMessagesFrom(conversationId, messageId)` removes that message and
  everything after it in the conversation. `editMessage()` in `kona-server.ts` =
  truncate + re-run `sendMessage`. `/api/chat` POST accepts `editMessageId`
  (validated) and returns both message ids; GET returns `id` per message.
- **UI** (`Chat.tsx`): each stored user bubble gets an "Edit" affordance (shows
  on hover). Editing swaps the bubble for a textarea + "Save & resend"; on save
  the transcript is truncated at that message and the turn re-runs — the edited
  message and a fresh reply replace everything below.
- **Known limitation** (documented, not fixed): structured records a replaced
  turn created (a saved `PlannedSession`, a memory) are **not** rolled back —
  the transcript and replies are corrected, the side effects are not. Fine for
  the in-memory iteration phase; a turn-scoped rollback is a later item.
- Tests: +3 (`deleteMessagesFrom` scoping; turn returns message ids; truncate +
  re-run replaces the transcript). 117 total; `tsc`, `eslint`, `next build`
  clean. Verified in the browser against the live model.

### M14.1 — De-scope: remove the Daily tab + daily energy model ✅
_2026 reset, step 1. The daily energy/macro breakdown made Kona feel like a
calorie tracker and forced onboarding to collect height / activity level /
dietary restrictions purely to feed it._
- **Deleted:** `app/DailyTab.tsx`, `app/api/daily/route.ts`, `src/agent/daily.ts`,
  `src/engine/daily-nutrition.ts`, `src/rules/daily_v0_2_0.ts`, `src/data/foods.ts`,
  and their tests. Dropped the `buildDaily` / `dailyNutrition` / `getDailyRules`
  exports and `getDaily()`.
- **Nav:** Home / Dashboard / Chat (was Home / Daily / Dashboard / Chat);
  `kona.tab === 'daily'` migrates to `home`.
- **Home fuelling card** no longer shows a daily energy / protein / carb / fluid
  grid. It shows only what the day warrants: during-session carb / fluid / sodium
  references (v0.1.0 engine) for classifiable sessions, a post-session protein
  line, and the morning/evening pre-fuel note. A rest or easy day just says
  "nothing to prepare — normal meals and fluids". The pre-fuel snack list is now
  a static phrasing (no restriction filtering, since the food catalog is gone).
- **Docs:** `PRODUCT_VISION.md` re-pointed to "AI endurance companion" with the
  2026 thesis + target-customer section; `CALCULATION_ENGINE_SPEC.md` §23 marked
  REMOVED; the §9 pre-fuel note ref updated.
- 108 tests green (was 116 — the two daily-nutrition suites removed);
  `tsc`, `eslint`, `next build` clean. Home verified in the browser (no energy
  grid; earned during-session numbers on a long-run day).

### M13 — time-of-day, focused day updates, end-of-day check-in ✅
_From user feedback: single-day edits shouldn't echo the whole week; sessions
need a time of day (drives pre-fuel advice — a morning session is likely done
before breakfast); add an end-of-day check-in._

- **`time_of_day` on every session** (`morning` / `afternoon` / `evening`).
  New `TimeOfDay` domain type; `MissingDetail` gains `'time_of_day'`. Derived
  from a stated clock time (`extractTime` → hour bucket) or an explicit word
  (`extractTimeOfDay`), and **prompted for when missing** alongside type,
  intensity and distance-or-duration — the weekly-plan option panel gained a
  Morning/Afternoon/Evening row (`SessionPrompt.ask_time` / `time_options`).
  `save_weekly_plan` / `save_planned_session` / `update_planned_sessions` all
  accept and store it; a stored session's `start_at` hour is realigned to the
  bucket (07:00 / 13:00 / 18:30) so Home & the dashboard show a consistent time.
  Sessions now read "6 km easy **morning** running".
- **Morning / evening pre-fuel advice.** `week.ts` prep lines gain a
  time-of-day clause: a morning session → "have something light 20–30 min
  before (a banana, a few dates, toast with jam/honey) rather than a full
  breakfast"; an evening session → "a small carb snack ~1 h before is enough".
  Qualitative only — no new numbers. `src/data/foods.ts` → `PRE_FUEL_SNACKS`
  (restriction-filtered on the Home fuelling card). Documented in
  `CALCULATION_ENGINE_SPEC.md` §9.
- **Single-day updates stay focused.** `composeClarifyPlanDetail` now echoes
  only the day(s) the turn actually touched — the updated session line, that
  day's prep, and any gap still open for that day — instead of re-printing the
  whole week + "Day by day". The full-week echo is kept for a new/replaced
  `plan_week`.
- **End-of-day check-in.** `src/agent/checkin.ts` (`buildCheckinLog` +
  `checkinReflection`) turns a 4-field popup (feel · went-as-planned ·
  injuries/pains · free text) into a normal recovery log; it runs through the
  **same `screenForEscalation` safety screen** as any recovery message.
  `POST /api/checkin` (validated at the boundary). It is a **quiet log** — the
  reflection shows in the popup, nothing is added to the Chat thread; "plan
  didn't go as planned" / pains → record + nudge to chat, never a diagnosis or
  an overwrite of the planned session. `getHome` returns `checkin: { due, done }`
  (due = today is a training day with no check-in yet); HomeTab shows a red dot
  on the profile avatar, a re-entry banner, and auto-opens the popup once after
  ~22:00 (dismiss remembered per browser session).
- Tests: +10 (`tests/agent/checkin.test.ts` ×7, `home.test.ts` +3 for
  time-in-title / pre-fuel note / check-in-due); `week-plan.test.ts` updated for
  the new `time_of_day` gap + focused single-day reply, +1 test for a
  time-of-day answer clearing the last gap with a morning pre-fuel note.
  **116 total**, all green; `tsc`, `eslint`, `next build` clean. Verified in
  the browser (time row in the option panel, focused single-day reply, morning
  pre-fuel note on Home, check-in popup + dot lifecycle).

### M12 — Home tab + nav restructure ✅
_User wanted a proper landing page: time-based greeting, a Mon–Sun day strip
(bento style, Kona palette — teal accent, not the reference's lime), what's
planned for the selected day, and the fuelling to aim for. Profile moved off the
nav into an avatar-triggered overlay._

- `src/agent/home.ts` — `buildHome({ profile, weeklyPlan, sessions, now, selectedDate })`
  → `HomeView`: the current calendar week laid out Mon–Sun (today + selected
  flagged, a dot per day that has a session), the selected day's sessions
  (title + **stated** effort + **estimated** length — `"18 km"` / `"45 min"` /
  `"length not set"`, never a guessed number), and fuelling. Fuelling = the
  profile's daily average (energy / protein / carb / fluid from the v0.2.0
  engine) **plus** the during-session carb / fluid / sodium targets on days the
  engine can classify the session (reuses `buildDashboard`). A rest day or an
  unclassifiable day is a "normal day" — daily average only. No new numbers:
  everything is `buildDaily` + `buildDashboard` reshaped.
- `GET /api/home?date=YYYY-MM-DD` + `getHome()` in `lib/kona-server.ts` (bad
  `date` param ignored → today).
- `app/HomeTab.tsx` — greeting (`Good morning/afternoon/evening, <name>`) + date,
  a scrollable day-strip (tap a day → refetch for that date), the "What's
  planned" card (effort / length chips; a CTA that jumps to **Chat** with the
  composer pre-filled — `"On Wednesday I'm doing "` / `"Change my Sunday session
  to "` — so plan edits still flow through the chat orchestrator, no parallel
  editor), and the "Recommended fuelling" card (daily-average stat grid + a
  "During the session" sub-grid when relevant, else "Normal day — the daily
  average above is all you need"). A "Full breakdown & food ideas →" link opens
  the Daily tab.
- Profile is no longer a nav tab. The Home avatar (top-right) opens a
  full-screen overlay hosting the existing `ProfileForm` (edit mode); saving
  updates the greeting name and refetches Home. `app/ProfileTab.tsx` removed
  (its job is now the overlay). Old `kona.tab === 'profile'` in localStorage
  migrates to `'home'`.
- Nav is now **Home · Daily · Dashboard · Chat**; Home is first and the default
  landing tab. Chat gained an `initialPrefill` prop (consumed once, then the
  parent clears it) threaded through `Workspace`.
- Tests: +6 (`tests/agent/home.test.ts` — week layout + today default, planned
  session surfaced with length/effort + during-session fuel, rest day is a
  normal day, effort/length "not set" flags, no-plan still returns a week +
  daily average, malformed `selectedDate` falls back to today). **105 total**,
  all green; `tsc`, `eslint`, `next build` clean. Verified in the browser
  (day-switching, profile overlay, chat prefill, mobile + light/dark).

### M11 — Daily nutrition + app shell + dashboard rework ✅
_From user feedback on the dashboard and a request for a per-day intake summary.
The user explicitly approved adding a full energy model, food suggestions as
illustrative examples only, and unifying the dashboard panels (AskUserQuestion)._

- **Daily-nutrition engine (methodology v0.2.0, separately versioned).**
  `src/rules/daily_v0_2_0.ts` (`DAILY_RULES`) + `src/engine/daily-nutrition.ts`
  (`dailyNutrition()`): resting energy via **Mifflin–St Jeor** (PMID 2305711),
  × an activity factor (1.2–1.9), ±8% → daily energy range. Protein
  1.4–2.0 g/kg (ISSN 2017), carbohydrate 3–10 g/kg by activity (ACSM/AND/DC
  2016), fat 20–35% of energy, fibre 14 g/1000 kcal, fluid from EFSA 2010
  adequate intakes. Sodium stays **guidance, not a computed target** (spec §6.4).
  `confidence` drops to `low` and `assumptions[]` records every gap when
  height / age / sex / activity aren't all known.
- **Food suggestions as illustrative examples.** `src/data/foods.ts` — ~33
  curated reference foods with rounded nutrition and `excluded_by` dietary tags;
  `foodsFor(role, restrictions)` filters. `src/agent/daily.ts` (`buildDaily`)
  turns the engine ranges into per-macro target + a rotating sample of example
  foods, plus fluid / sodium as prose. Framed throughout as "examples of what
  the target looks like, not a meal plan".
- **Form fields.** Workout types gained `skating` + `combat_sports` (+ `hyrox`
  already added). New required **height** and **activity level** questions (the
  energy model needs them) and an optional 14-option **dietary restrictions**
  multi-select. `Profile`, `profile-input.ts` validation, tools enum, and the
  starter sport labels all updated.
- **Bottom-nav app shell.** `app/AppShell.tsx` — four tabs with icons in order
  **Profile · Daily · Dashboard · Chat**, active tab persisted to
  `localStorage` (`kona.tab`). `height: 100dvh; overflow: hidden` shell so the
  tab content scrolls internally and the nav stays pinned; mobile-safe-area
  padding. `ProfileForm` extracted as a reusable component used by both
  onboarding and the **Profile** tab (edit mode, pre-filled, "Save changes").
  New **Daily** tab (`DailyTab` + `GET /api/daily`) renders the energy KPI,
  per-macro sections with example foods, and fluid / sodium callouts.
- **Dashboard rework (the "consistency" feedback).** Four visually-identical
  `RangeChart` panels (was: 1 stat tile + 2 charts + 1 note). Rest days now
  appear — they carry the **daily protein target** (same every day, weight-based)
  in the protein panel and the table. A `⚑ prep for <day>` flag marks the day
  before a long or double-session day (qualitative — no invented carb-loading
  number). The confusing "not needed for this session" wording is explained in a
  lead paragraph that is honest that the carb / fluid / sodium ranges repeat
  because the engine has no measured personal data yet.
- Docs: `CALCULATION_ENGINE_SPEC.md` §23 documents the v0.2.0 daily methodology
  and its sources; `PRODUCT_VISION.md` "What Kona is NOT" reworded + a post-v0.1
  scope note on the daily estimate.
- Tests: +11 (`daily-nutrition` ×5, `daily` ×3, dashboard rest-day + prep-flag,
  profile-input height/activity/restrictions). **99 total**, all green;
  `tsc --noEmit`, `eslint .`, `next build` all clean. Full 4-tab flow
  (onboard → Profile edit → Daily → Dashboard → Chat) verified in the browser.

### M1 — Deterministic calculation core ✅
- Scaffold: TypeScript strict (`noUncheckedIndexedAccess`), Vitest, ESLint flat config, `tsx`. No web stack yet.
- `src/rules/` — **versioned rules/config table**. `RulesConfig` + `RULES_V0_1_0` (spec placeholders) + `getRules(version)`. Every engine number traces to a field here; a numeric change bumps `methodology_version`.
- `src/engine/classify.ts` — session classification; estimates duration from distance via a configurable pace table and flags it; throws when it has neither duration nor distance.
- `src/engine/calculate.ts` — `calculateFuelingTargets()` → §20 MVP output contract: priorities, hydration/carb/sodium estimates, protein/recovery, structured `recommendation_inputs` (§17), warnings, confidence (§16), methodology stamp (§19).

### M2 — Data layer ✅
- `Repository` interface + `InMemoryRepository` (injectable clock).
- Planned vs actual sessions = separate linked records; reason stored apart.
- `src/data/products.ts` — known-product catalog: **label values only, `null` where not on file** (SIS gel ships with no nutrition — deliberately not invented). Bottle volume + 24 g shake protein are genuine known values.
- Demo profile seed (64 kg, 750 ml bottle, no measured sweat data).

### M3 — Agent orchestration + conversation slice ✅
- `src/agent/llm-client.ts` — `LlmClient` interface (`interpret` → tool calls, `compose` → reply) + `ContextPackage`.
- `src/agent/safety.ts` — hard escalation screen that runs **before** the LLM (§18); conservative red-flag patterns; ordinary soreness does not trip it.
- `src/agent/tools.ts` — tool registry: `get_user_profile`, `save_planned_session`, `save_actual_session`, `calculate_fueling_targets` (the only source of numbers), `log_fuel_intake`, `save_recovery`, `get_relevant_history`, `propose_memory_update`. Hand-rolled arg validation.
- `src/agent/deterministic-llm.ts` + `parse.ts` + `responder.ts` — rule-based stand-in for the LLM so the slice runs with no API key. Never emits fueling numbers itself.
- `src/agent/orchestrator.ts` — agent loop: persist message → safety screen → build compact context → interpret → run tools (`$last` id substitution) → compose → persist reply.
- `src/cli/chat.ts` — `npm run chat` REPL, `-- --demo` runs the four canonical messages.
- Tests: 33 total. `tests/agent/acceptance.test.ts` drives the full four-message conversation + safety layer. `tests/acceptance-scenarios.md` is the structured acceptance file.
- `typecheck`, `test` (33), `lint` all green. `npm run chat -- --demo` verified manually.

### M4 — Real Anthropic LLM client ✅
- `@anthropic-ai/sdk` added (only runtime dep). `src/agent/anthropic-llm.ts` — `AnthropicLlmClient implements LlmClient`.
  - `interpret()`: one Messages API call with the tool schemas + `tool_choice: auto`; returns the model's `tool_use` blocks as `PlannedToolCall[]` (orchestrator still executes them). System prompt forbids the model from stating any fueling numbers.
  - `compose()`: second call given the tool results as the only number source; system prompt enforces Kona's voice + no-diagnosis + planned-vs-actual rules.
  - Transport is injectable (`AnthropicLike`) so tests use a fake with no network/key.
  - `toInterpretResult()` extracted as a pure, unit-tested mapper.
- Tool definitions gained JSON `input_schema`s (`TOOL_INPUT_SCHEMAS` in `tools.ts`); deterministic client ignores them.
- Model default `claude-opus-5`, override `KONA_LLM_MODEL`. Auth via `ANTHROPIC_API_KEY` / `ant` profile (SDK default resolution).
- CLI: `npm run chat -- --llm=anthropic` (or `KONA_LLM=anthropic`, or auto when `ANTHROPIC_API_KEY` is set). `.env.example` added.
- Tests: +5 (`tests/agent/anthropic-llm.test.ts`) — mapper + full plan turn through `handleMessage` with a fake transport + safety-never-reaches-model. 38 total, all green; typecheck + lint clean.

### M5 — Thin Next.js chat UI ✅
- `next`/`react`/`react-dom` added; co-located in this repo (no workspace split). `app/` router: `layout.tsx`, `page.tsx` (client chat component, plain CSS in `globals.css`, light/dark), `api/chat/route.ts` (Node runtime).
- `lib/kona-server.ts` — process-wide singleton: the M2 in-memory repo + `AnthropicLlmClient` when `ANTHROPIC_API_KEY` is set, else `DeterministicLlmClient`. State resets on server restart (documented; a persistence backend is a later decision).
- `POST /api/chat` `{ message, conversationId? }` → `{ reply, intent, safety_escalated, clarifying_question }`, with boundary validation (non-empty, ≤2000 chars, `conversationId` charset). `GET /api/chat?conversationId=` → prior messages so a reload restores the thread within a server session.
- Verified: `next build` passes; dev server smoke-tested via curl (plan → actual with plan preserved → history restore → 400 on bad input) and in the browser (bubbles, intent tags, Enter-to-send, multi-turn).
- **Core import change**: relative imports in `src/`/`tests/`/`lib/` are now extensionless (was `.js`). Turbopack doesn't do `.js`→`.ts` resolution the way tsx/vitest/tsc do; extensionless works across all four. No behaviour change.
- **Orchestrator fix**: after `save_actual_session`, the context's `current_plan` is repointed to the plan the actual was actually linked to, so the composer speaks about "the plan" correctly even with multiple same-day plans (previously it assumed the generic "next upcoming plan").
- `next.config.ts` sets `agentRules: false` so `next dev` does not append its managed block to `CLAUDE.md` (that file is the product spec). Flip to `true` to opt into Next's bundled-docs pointer.
- 38 tests still green; `typecheck`, `lint`, `next build` all clean.

### M6 — Weekly multi-day planning ✅
- `WeeklyPlan` domain type + `weekly_plan_id` on `PlannedSession` (week membership is derived from that link, so actual-vs-planned comparison works unchanged).
- `src/engine/week.ts` — `analyzeWeek()`: groups sessions by day, flags double-session days (`multi_session`) and longer/harder "key" sessions, and emits day-before `preparation` recommendations. Sessions it can't classify (gym/swim with no distance or duration) are treated as routine days — **no guessed durations**. Numbers still come only from `calculateFuelingTargets`; the double-session prep line is deliberately number-free (matches PRODUCT_VISION's example).
- `src/agent/parse.ts` — `parseWeeklyPlan()` (weekday spans → per-day sessions, "rest", "bike + run", "long run"), `resolveWeekStart()` (Monday of the week, `+7` for "next week"), `dateForWeekday()`.
- Repository: `saveWeeklyPlan` (replaces by `(user, week_start)`), `getWeeklyPlan`, `listWeeklyPlans`, `listPlannedSessionsForWeeklyPlan`.
- Tools: `save_weekly_plan` (persists the week as linked planned sessions with per-day `session_group_id`/`sequence_index`, then returns the analysis — no separate `calculate_fueling_targets` call) and `get_weekly_plan`.
- Deterministic interpreter: `plan_week` intent when ≥2 weekday names are present. Anthropic client: `save_weekly_plan → plan_week` + a system-prompt bullet.
- Responder: `composeWeekPlan` — week date range, day-by-day list (incl. rest days), the top 1–2 key-day prep lines, and a "remembered this" close.
- Tests: +18 (`tests/engine/week.test.ts` ×5, `tests/agent/week-plan.test.ts` ×5 incl. the exact PRODUCT_VISION sentence and a later actual-session linking to the week's Tuesday plan, +8 repo). **49 total**, all green; typecheck + lint clean; verified in the browser.

### M10.1 — Advice for every day + option-button prompts ✅
- `analyzeWeek` now emits a `recommendation_inputs` line for **every** session day (key days keep the detailed prep; routine days get a low-priority "nothing special to prepare" line). No more top-3 cap.
- New `session_prompts: SessionPrompt[]` — one per under-specified session, each carrying `intensity_options` (easy/moderate/hard) and `size_options` (~30 min … ~2 hr). `Chat.tsx` renders them as an inline option-button panel; picking options + "Save N sessions" builds a parseable message (`"Wed gym: hard, ~60 min. …"`) that flows through the existing clarification path. Remaining gaps get a fresh panel.
- Responder: `planAdviceLines()` shared by the plan and clarify composers — lists every day, then nudges to the buttons (or, for CLI, the free-text `open_questions`).
- `POST /api/chat` returns `session_prompts` extracted from the turn's tool results.
- Fix: a message framed as a whole new week ("Next week: …", "new plan", "my week is …") is no longer misread as clarifications to an existing plan — `newPlanFraming` bails out of the clarify path so `plan_week` replaces the week.
- Tests: +3, updated 4 for the new behavior. **82 total**, all green; `next build` clean; full flow (plan → day-by-day advice → option panel → save → updated) verified in the browser.

### M10.3 — Weekly fueling dashboard ✅
- `src/agent/dashboard.ts` — `buildDashboard({ profile, weeklyPlan, sessions })`: per-day carb / fluid / sodium targets from the engine's per-session `calc`, plus the daily protein baseline. Unclassifiable days carry `null` (no guess). `GET /api/dashboard`, `getDashboard()` in `lib/kona-server.ts`.
- `app/dashboard/page.tsx` — a **Dashboard** link in the chat header opens it. Follows the `dataviz` skill: form picked by the data's job — daily protein is a **stat tile** (constant, weight-based), carb & fluid are **small-multiple range-bar charts** (one bar per training day, no dual axis), sodium is a **callout** (a per-litre reference, not a per-day quantity). Validated sequential blue (`#2a78d6` / `#3987e5`, passes contrast + band in both modes), thin marks with 4px rounded ends, recessive gridlines, no legend (single series), value labels at the bar tip only, `<title>` hover, a **Table view** `<details>`, and a methodology-version footer. Short/easy days show "not needed for this session".
- Tests: +3 (`tests/agent/dashboard.test.ts`). **86 total**, all green; `next build` clean; rendered + eyeballed in the browser (light and dark).

### M10.2 — Conversation history sidebar ✅
- `ConversationSummary` type + `repo.listConversations()` (derives one row per conversation from stored messages: title = first user message, newest activity first). `GET /api/conversations`.
- New client layout: `Workspace` (sidebar + chat, owns `conversationId` + the list) → `Sidebar` (list, "+ New chat", active highlight, relative times) + `Chat` (now takes `conversationId` as a prop and reloads on change; calls `onActivity` to refresh the list). `page.tsx` renders `Workspace` for the chat view.
- "New chat" makes a fresh id; selecting a row loads that thread; continuing just sends more messages. On mobile the sidebar is a slide-over (`☰` in the header + scrim).
- Tests: +1 repo test (84 total); `next build` clean; switch / new / continue verified in the browser.

### M9 — Chat starter + typing indicator ✅
- `src/engine/profile-baseline.ts` — `profileDailyBaseline({ body_weight_kg })`: daily protein range from body weight + the post-session serving, both from the rules table. Deliberately reports fluid/sodium as **per-session training references, not daily totals** (the spec has no daily fluid/sodium formula — not invented).
- `src/agent/starter.ts` — `buildStarter(profile)`: the one-time opener ("Hi &lt;name&gt;, I'm Kona … here's what I've got from your form … a rough daily protein target is …") + three conversation prompts that pre-fill a parseable stub in the composer ("My typical training week is: ", "Tomorrow I'm doing ", "My next race is ").
- `GET /api/chat` returns `starter` when the conversation is empty; `app/Chat.tsx` renders it as the intro bubble + clickable chips (chip → pre-fills + focuses the input).
- **Replies become memory**: `plan_week` now also proposes a `typical_week` memory; a new `note_race` intent (race/marathon/10k/… keywords) saves a `next_race` memory instead of trying to plan it (race planner stays out of scope). Anthropic system prompt updated to `propose_memory_update` for durable facts.
- Typing indicator: the `…` bubble is now three dots doing a staggered wave (`.bubble.typing`, `@keyframes kona-wave`, with a `prefers-reduced-motion` fade fallback).
- Tests: +11 (`profile-baseline` ×3, `starter` ×4, `note_race` + `typical_week` memory, updated week-plan assertion). **80 total**, all green; `next build` clean; full flow verified in the browser.

### M8 — Onboarding ✅
- `Get Started` landing → profile form → chat. `app/page.tsx` orchestrates three views (`loading | onboarding | chat`); `app/Onboarding.tsx` (landing hero + form), `app/Chat.tsx` (the chat, extracted from `page.tsx`, now greets by name).
- Form fields: username, gender, age, **body weight (kg)** — added because the calc engine needs it for protein targets (CALCULATION_ENGINE_SPEC.md §3.1) — multi-select workout types (running/swimming/cycling/gym/**climbing**, new `Sport` value), sessions/week, an optional recent-injuries note, and three 1–5 self-ratings (sleep, hydration, sweat).
- `Profile` type gained `username / gender / age / recent_injuries_note / self_perception / onboarded_at` (all optional except the pre-existing `body_weight_kg`). `Gender` + `SelfPerception` types added.
- `src/domain/profile-input.ts` — pure `validateProfileInput()` (boundary validation, ranges, sport whitelist, dedup) reused by the API route. 16 tests.
- `app/api/profile/route.ts` — `GET` (returns `{ profile }` or null) + `POST` (validate → `upsertProfile`). `lib/kona-server.ts` no longer seeds a demo profile for the web app — the user onboards first; chat is unreachable until then (the calc tool requires a profile).
- Self-perception and the injury note are passed to the LLM as **context, not calc inputs** — a high self-rated sweat level is not a sweat-rate measurement, so the engine stays in reference-range mode. `contextForPrompt` + `COMPOSE_SYSTEM` updated.
- Tests: +17 (`tests/domain/profile-input.test.ts` ×16, +1 repo round-trip). **72 total**, all green; `next build` clean; full landing → form → submit → chat flow verified in the browser.

### M7 — Weekly plan asks for missing detail ✅
_Prompted by user feedback: Kona was silently defaulting unstated intensity to "easy" and showing it as fact; gym/swim/long-run days got no fueling treatment._
- `MissingDetail` type + `needs_detail` / `is_long` on `SessionInputCore`. `save_weekly_plan` records, per session, what the user didn't state (`intensity` when no effort word; `duration_or_distance` when neither given). A "long" session is exempt from the effort question (conventionally easy/steady).
- `analyzeWeek` now returns `open_questions` (grouped by sport) and always keeps a long-session day in the recommendations. `describeWeekSession` shows a stated effort only — never a defaulted "easy" — and flags "(effort / distance/time not set)".
- Long-session prep line rewritten to the fuller day-before advice the user asked for: normal carb meals + steady hydration *the day before* (not right before), a recovery meal with protein (~20–40 g from the rules table), and a conditional warm-weather sodium note kept non-diagnostic about cramps. Gym key days get an explicit post-session protein note (`resistance_training` is now passed to the engine).
- New tool `update_planned_sessions` + intent `clarify_plan_detail`: fills effort/duration/distance for pending sessions, matched by day and/or sport, then re-runs the analysis. Parser gained `parsePerceivedIntensity` (RPE language → easy/moderate/hard), worded durations ("about an hour" → 60; "15 minutes in" is *not* a duration), and `parseClarificationAnswer`. `buildContext` exposes `pending_plan_details`; the deterministic and Anthropic interpreters route single-answer and multi-day ("Sunday's long run is 22km, and the Saturday swim is 2km") replies to it.
- Tests: `tests/agent/week-plan.test.ts` ×10: questions asked, plain-language answer fills gym, single-day fill, multi-day answer not mis-read as a new plan, compound "only"/"because" answer not logged as a workout, "Wed and Fri sessions feel hard" fills both days.

#### M7 routing fixes (same milestone, from user testing)
1. **A clarification answer was being logged as a modified workout.** Words like "only" ("I only ride 20km") and "because" tripped the modification/actual-log detection. Replaced the blunt `strongModification` gate with a precise `genuineActualLog` check (past-tense "I ran/did/…", "instead of", "cut short", "actually"); when a pending weekly plan exists and the message is an answer, it now routes to `clarify_plan_detail` — and if the specifics can't be pinned to sessions it asks for a per-session breakdown rather than misrouting.
2. **`parseWeeklyPlan` only saw the first mention of each weekday**, so "For Thu … Thu cycling …" merged the second clause into the wrong span. Now finds every occurrence (global match); `plan_week` requires ≥2 *distinct* days.
3. **"Wed and Fri sessions feel hard"** — an empty/connective span before another day now shares that day's parsed sessions; a shared detail across ≥2 named days emits one `update_planned_sessions` per day (sport inferred per day).
4. `extractDistanceKm` reads ranges ("5-7km", "12km to 18km") as the midpoint; `update_planned_sessions` reports only the fields a call actually changed (no re-asserting a defaulted "easy").
#### M7 fixes from a simulated conversation round
5. **Comma-split dropped detail**: "gym is hard, about an hour" was split into two pieces and the duration lost. Session splitting now only breaks on `+ & / then plus` always; a comma / "and" splits only when it yields ≥2 sport-bearing pieces (so "swim, gym" still becomes two).
6. **One intensity smeared across a mixed-effort sentence**: "Wed gym is hard … Thu bike is easy" applied one global intensity. The span path no longer needs *every* clause to match a pending sport — it fills the matching ones and ignores the rest; `parsePerceivedIntensity` returns `undefined` when a sentence contains both easy- and hard-family words.
7. Recovery reflection now distinguishes soreness ("sounds like some soreness, but you're moving okay") from generic tiredness. `calculate.ts`'s day-before prep line uses the same concrete carb examples as `week.ts`.
- **Known limitation**: still a rule-based parser — very tangled phrasing may need a follow-up; the real `AnthropicLlmClient` handles compound answers natively.
- **55 tests** total, all green; typecheck + lint clean; an 8-turn simulated conversation (weekly plan → clarify → single session → modification → fuel → recovery → safety escalation) runs correctly end to end.

## Known issues / deliberate deferrals
- **Fluid range**: rules table uses §5.2 (400–800 ml/h); §20's example JSON shows 500. Reconciliation noted in `CALCULATION_ENGINE_SPEC.md` §20.
- All v0.1.0 numbers are spec placeholders — **require expert review before public launch**.
- Deterministic interpreter handles the canonical phrasings and close variants; it is not a general NL parser. The real `AnthropicLlmClient` covers open-ended phrasing; the deterministic one stays the default for tests and no-key runs.
- `AnthropicLlmClient` has no automated test against the live API (non-deterministic, needs a key). `compose()` trusts its system prompt to keep numbers sourced from tool results — no post-hoc numeric guard yet.
- No food-estimation ranges (§14 B14/B15), no historical pattern surfacing (B12), no weekly multi-day planning, no web UI/auth/DB backend — all out of slice scope.
- `higher_option_g_per_hour` (60–90 g/h) configured but not yet surfaced as a note for very-long sessions.
- Node 20.12 vs eslint-visitor-keys wanting 20.19+ — warning only.

## Next recommended task
Replace `InMemoryRepository` with a real backend (Postgres/Supabase) behind the existing `Repository` interface so state survives restarts. Then food-estimation ranges for vague meals (§14, scenarios B14/B15) and cautious historical pattern surfacing (§12, B12).
