# Kona — Progress

## Current milestone
**M5 complete — thin Next.js chat UI over `handleMessage`.** Next: weekly
multi-day planning; later, a persistence backend to replace the in-memory store.

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

## Known issues / deliberate deferrals
- **Fluid range**: rules table uses §5.2 (400–800 ml/h); §20's example JSON shows 500. Reconciliation noted in `CALCULATION_ENGINE_SPEC.md` §20.
- All v0.1.0 numbers are spec placeholders — **require expert review before public launch**.
- Deterministic interpreter handles the canonical phrasings and close variants; it is not a general NL parser. The real `AnthropicLlmClient` covers open-ended phrasing; the deterministic one stays the default for tests and no-key runs.
- `AnthropicLlmClient` has no automated test against the live API (non-deterministic, needs a key). `compose()` trusts its system prompt to keep numbers sourced from tool results — no post-hoc numeric guard yet.
- No food-estimation ranges (§14 B14/B15), no historical pattern surfacing (B12), no weekly multi-day planning, no web UI/auth/DB backend — all out of slice scope.
- `higher_option_g_per_hour` (60–90 g/h) configured but not yet surfaced as a note for very-long sessions.
- Node 20.12 vs eslint-visitor-keys wanting 20.19+ — warning only.

## Next recommended task
Weekly multi-day planning: parse a week ("Mon gym, Tue 8km, ... Sun long run"), save it, flag double-session and longer/harder days, and prepare ahead of key sessions (CALCULATION_ENGINE_SPEC.md §9, §11). Separately, when persistence matters: replace `InMemoryRepository` with a real backend behind the existing `Repository` interface.
