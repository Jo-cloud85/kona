# Kona — Acceptance Scenarios

Structured acceptance tests for the vertical slice. Each scenario maps to
automated coverage. Do not weaken or delete these to make a suite pass.

Legend: ✅ automated & passing · ⏳ not yet in scope for this slice

## A. Core conversation slice (START_WITH_CLAUDE.md)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| A1 | "Tomorrow I'm doing an 18km run at 6am." | Parse sport/distance/time; save **planned** session; retrieve profile; classify (LONG, duration estimated from distance); call deterministic engine; reply with day-before preparation advice and a labelled starting range. No invented numbers. | ✅ `tests/agent/acceptance.test.ts` |
| A2 | "Actually I only ran 10km because my left hip hurt." | Planned 18km preserved untouched; **actual** 10km saved as a separate record linked to the plan; status `stopped_early`; reason stored separately; post-workout calc uses the 10km actual; reply is safety-forward (no "make up the distance"), asks if the hip is still an issue, does **not** diagnose. | ✅ `tests/agent/acceptance.test.ts`, engine §21.9 |
| A3 | "I had one SIS gel and my 750ml bottle." | Record `1× SIS gel` (quantity only — no label nutrition on file, nothing invented) and `750 ml bottle` (fluid known); attach to the current actual session. | ✅ `tests/agent/acceptance.test.ts`, `tests/data/repository.test.ts` |
| A4 | "My legs feel tired but okay." | Minimal recovery record (severity `low`, symptom `legs`); reply reflects in plain language, gives a safety-aware next action referencing the prior hip stop-early, asks one useful question. No percentage analytics. | ✅ `tests/agent/acceptance.test.ts` |
| A5 | Conversation persistence | User + assistant messages stored per conversation. | ✅ `tests/agent/acceptance.test.ts` |

## B. Calculation engine (CALCULATION_ENGINE_SPEC.md §21)

| # | Scenario | Coverage |
|---|----------|----------|
| B1 | 40-min easy gym → no mandatory carbohydrate target | ✅ |
| B2 | 50-min easy run, normal conditions → basic hydration only (no per-hour number) | ✅ |
| B3 | 75-min hard run → carbohydrate planning becomes relevant | ✅ |
| B4 | 110-min moderate run → carbohydrate + hydration preparation | ✅ |
| B5 | 110-min run hot/humid → hydration priority increases | ✅ |
| B6 | Measured sweat rate overrides the fallback hydration estimate | ✅ |
| B7 | Known sweat sodium → sodium mode switches to `estimated_loss` | ✅ |
| B8 | No sweat data → never given an exact personal sodium-loss number | ✅ |
| B9 | Planned 18km / actual 10km → actual session drives post-workout calc | ✅ |
| B10 | Swim + gym same day → multi-session logic raises priorities | ✅ |
| B11 | Poor sleep → acknowledged as context, not treated as under-fueling | ✅ |
| B16 | Body-mass gain during exercise → flag overdrinking, no "drink more" | ✅ |
| B12 | Severe cramp → symptom captured without causal diagnosis | ⏳ recovery capture exists; pattern-spotting not in slice |
| B13 | Exact labelled protein shake → known value preserved | ✅ `tests/data/repository.test.ts` (catalog) |
| B14 | Vague meal → nutrient ranges, not false precision | ⏳ food estimator not in slice (unrecognised items recorded as reported, never estimated) |
| B15 | Photo meal → estimated range + uncertainty | ⏳ out of slice scope |
| B17 | High-risk medical symptom → safety escalation | ✅ `tests/agent/acceptance.test.ts` (safety layer) |

## C. Safety

| # | Scenario | Expected | Coverage |
|---|----------|----------|----------|
| C1 | "chest pain … felt faint" | Escalate before the LLM; skip fueling flow; direct to medical care | ✅ |
| C2 | "legs feel tired but okay" | No escalation; normal recovery flow | ✅ |

## Deferred (not in this slice)

Weekly multi-day planning, food estimation ranges, photo analysis, historical
pattern surfacing, real LLM provider, web UI, auth, persistence backend.
