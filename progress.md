# Kona — Progress

## Current milestone
**M3 complete — end-to-end vertical slice runs and is tested.** Next: real LLM
provider behind `LlmClient`, then web UI, then weekly planning.

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

## Known issues / deliberate deferrals
- **Fluid range**: rules table uses §5.2 (400–800 ml/h); §20's example JSON shows 500. Reconciliation noted in `CALCULATION_ENGINE_SPEC.md` §20.
- All v0.1.0 numbers are spec placeholders — **require expert review before public launch**.
- Deterministic interpreter handles the canonical phrasings and close variants; it is not a general NL parser. Replace with a real provider behind `LlmClient`.
- No food-estimation ranges (§14 B14/B15), no historical pattern surfacing (B12), no weekly multi-day planning, no web UI/auth/DB backend — all out of slice scope.
- `higher_option_g_per_hour` (60–90 g/h) configured but not yet surfaced as a note for very-long sessions.
- Node 20.12 vs eslint-visitor-keys wanting 20.19+ — warning only.

## Next recommended task
Add a real `LlmClient` implementation (OpenAI/Anthropic function-calling) behind the existing interface, with the deterministic client kept for tests. Then a thin Next.js chat UI over `handleMessage`, then weekly multi-day planning.
