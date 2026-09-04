# Kona — Progress

## Current milestone
**M7 complete — weekly plan now asks for missing detail instead of assuming
"easy".** Next: a persistence backend to replace the in-memory store;
food-estimation ranges (§14); historical pattern surfacing (§12).

## Completed work

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
