# Kona — Acceptance Scenarios

Structured acceptance tests for the vertical slice. Each scenario maps to
automated coverage. Do not weaken or delete these to make a suite pass.

Legend: ✅ automated & passing · ⏳ not yet in scope for this slice

## A-onboard. Onboarding

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AO1 | First visit | "Get Started" landing → profile form (username, gender, age, body weight, workout types incl. climbing, sessions/week, optional injury note, 1–5 sleep/hydration/sweat). | manual (browser) |
| AO2 | Form validation | Bad input (empty username, out-of-range age/weight, no sport, perception ≠ 1–5) is rejected with a specific message; input trimmed, sports deduped, unknown sports dropped. | ✅ `tests/domain/profile-input.test.ts` |
| AO3 | Submit | Valid form persists the profile (`onboarded_at` set); the app shows the chat and greets by name; a reload skips onboarding. | manual (browser) + `tests/data/repository.test.ts` |
| AO4 | Perception is context, not a measurement | A high self-rated sweat level does not put the engine into measured-sweat mode. | ✅ (engine has no `known_sweat_data` from onboarding) |
| AO5 | Chat starter | The empty chat shows a greeting + form echo + daily protein range (from the engine) with fluid/sodium framed as per-session references, then 3 prompt chips that pre-fill a parseable stub. | ✅ `tests/agent/starter.test.ts`, `tests/engine/profile-baseline.test.ts` + manual (browser) |
| AO6 | Prompt replies become memory | "My typical training week is …" saves the plan **and** a `typical_week` memory; "My next race is …" saves a `next_race` memory (no session/plan created). | ✅ `tests/agent/week-plan.test.ts` |
| AO7 | Typing indicator | While a reply is generating, a three-dot wave shows in an assistant bubble. | manual (browser) |
| AO8 | Option-button prompts | A saved week gives a prep line for **every** day and renders per-session effort/length option buttons; picking them + Save updates the plan. | ✅ `tests/engine/week.test.ts`, `tests/agent/week-plan.test.ts` + manual |
| AO9 | History sidebar | Multiple conversations listed (title from first message, newest first); "New chat" and switching work; continuing sends more messages. | ✅ `tests/data/repository.test.ts` + manual |
| AO10 | Dashboard | A "Dashboard" link shows per-day carb/fluid range-bar charts + the daily protein stat tile + a sodium callout + a table view, all from the engine; unclassifiable days show "not needed". | ✅ `tests/agent/dashboard.test.ts` + manual |

## A. Core conversation slice (START_WITH_CLAUDE.md)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| A1 | "Tomorrow I'm doing an 18km run at 6am." | Parse sport/distance/time; save **planned** session; retrieve profile; classify (LONG, duration estimated from distance); call deterministic engine; reply with day-before preparation advice and a labelled starting range. No invented numbers. | ✅ `tests/agent/acceptance.test.ts` |
| A2 | "Actually I only ran 10km because my left hip hurt." | Planned 18km preserved untouched; **actual** 10km saved as a separate record linked to the plan; status `stopped_early`; reason stored separately; post-workout calc uses the 10km actual; reply is safety-forward (no "make up the distance"), asks if the hip is still an issue, does **not** diagnose. | ✅ `tests/agent/acceptance.test.ts`, engine §21.9 |
| A3 | "I had one SIS gel and my 750ml bottle." | Record `1× SIS gel` (quantity only — no label nutrition on file, nothing invented) and `750 ml bottle` (fluid known); attach to the current actual session. | ✅ `tests/agent/acceptance.test.ts`, `tests/data/repository.test.ts` |
| A4 | "My legs feel tired but okay." | Minimal recovery record (severity `low`, symptom `legs`); reply reflects in plain language, gives a safety-aware next action referencing the prior hip stop-early, asks one useful question. No percentage analytics. | ✅ `tests/agent/acceptance.test.ts` |
| A5 | Conversation persistence | User + assistant messages stored per conversation. | ✅ `tests/agent/acceptance.test.ts` |

## A-week. Weekly multi-day planning (PRODUCT_VISION.md "Weekly planning")

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AW1 | "Monday gym, Tuesday 8km run, Wednesday swim, Thursday rest, Friday bike + run, Sunday long run." | Parse 6 sessions across 5 days; save one `WeeklyPlan` with the sessions as linked planned records; Thursday recorded as a rest day; Friday's two sessions share a `session_group_id`. | ✅ `tests/agent/week-plan.test.ts` |
| AW2 | Same week — analysis | Friday flagged as a double-session ("bigger fueling") day and top preparation priority; Sunday's long run flagged as a key day; day-before prep advice, number-free where the session can't be classified. | ✅ `tests/engine/week.test.ts`, `tests/agent/week-plan.test.ts` |
| AW3 | Unclassifiable session | Gym / swim entry with no distance or duration → treated as a routine day; **no guessed duration**; Kona asks instead. | ✅ `tests/engine/week.test.ts`, `tests/agent/week-plan.test.ts` |
| AW4 | Week remembered for comparison | A later "Actually I only ran 5km on Tuesday…" links to that week's Tuesday planned session; the plan stays 8 km. | ✅ `tests/agent/week-plan.test.ts` |
| AW5 | Weekly-plan CRUD | `saveWeeklyPlan` replaces an existing plan for the same `(user, week_start)`. | ✅ `tests/data/repository.test.ts` |
| AW6 | No fake "easy" | Sessions the user didn't rate show "(effort not set)", never an asserted "easy"; the reply asks targeted questions grouped by sport. | ✅ `tests/agent/week-plan.test.ts` |
| AW7 | Plain-language answer fills gaps | "The gym sessions are about an hour and I sweat and pant a lot 15 minutes in" → those sessions become `hard`, `60 min`; `needs_detail` cleared; analysis re-runs. | ✅ `tests/agent/week-plan.test.ts` |
| AW8 | Multi-day answer | "Sunday's long run is 22km, and the Saturday swim is 2km" updates each day and is **not** read as a new plan. | ✅ `tests/agent/week-plan.test.ts` |
| AW9 | Long-run day-before advice | Long-session prep covers carb meals + steady hydration the day before (not right before), post-session protein (~20–40 g), and a conditional warm-weather sodium note that stays non-diagnostic about cramps. | ✅ `tests/engine/week.test.ts` |

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

## Deferred (not yet built)

Food estimation ranges, photo analysis, historical pattern surfacing, auth,
persistence backend (state currently resets on server restart).
