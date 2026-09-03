# Kona — Progress

## Current milestone
**M3 — Agent orchestration + conversation slice** (next)

## Completed work

### M1 — Deterministic calculation core ✅
- Project scaffold: TypeScript (strict, `noUncheckedIndexedAccess`), Vitest, ESLint flat config, `tsx`. No Next.js/Supabase yet (lean core first).
- `src/domain/types.ts` — shared structured-fact types with provenance/certainty.
- `src/rules/` — **versioned rules/config table**. `RulesConfig` type + `RULES_V0_1_0` (spec reference placeholders) + `getRules(version)` registry. Every numeric engine output traces to a field here; changing a value bumps `methodology_version`.
- `src/engine/classify.ts` — deterministic session classification (duration/intensity/environment classes, multi-session). Estimates duration from distance via a configurable pace table when time is absent, and flags it. Throws `ClassificationInputError` when it has neither.
- `src/engine/calculate.ts` — `calculateFuelingTargets()` implementing the §20 MVP output contract: priorities (0–3), hydration/carbohydrate/sodium estimates, protein/recovery, structured `recommendation_inputs` (§17), warnings, confidence (§16), methodology stamp (§19).
- Tests: `tests/engine/*` — 19 tests covering spec §21 items 1–11 and 16, plus the 18 km @ 6am planning slice.
- `typecheck`, `test`, `lint` all green.

## Known issues / deliberate deferrals
- **Fluid range deviation**: §20's example JSON shows `fluid_ml_per_hour.min: 500`; the rules table follows §5.2 (0.4–0.8 L/h → 400–800 ml/h). Noted in `CALCULATION_ENGINE_SPEC.md` §20.
- All v0.1.0 numbers are spec placeholders — **require expert review before public launch**.
- `higher_option_g_per_hour` (60–90 g/h) is configured but not yet surfaced as a note for very-long sessions — pending M3 responder work.
- No real LLM provider — M3 will define an `LlmClient` interface with a deterministic stub.
- Node 20.12 vs eslint-visitor-keys wanting 20.19+ — warning only, lint runs fine.

## Next recommended task
M2 — Data layer: repository interface + in-memory implementation, product catalog (known values only), profile seed. Then M3 — agent orchestration, tools, deterministic interpreter, and the four-message conversation slice with acceptance tests.
