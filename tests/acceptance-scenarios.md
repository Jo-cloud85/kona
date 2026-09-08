# Kona — Acceptance Scenarios

Structured acceptance tests for the vertical slice. Each scenario maps to
automated coverage. Do not weaken or delete these to make a suite pass.

Legend: ✅ automated & passing · ⏳ not yet in scope for this slice

## A-onboard. Onboarding (2026 reset — 3 questions)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AO1 | First visit | Landing hero → a 3-field form: **your name**, **which endurance sports** (Running / Cycling / Swimming / Triathlon / Strength), **"What are you working towards?"** (free text). No weight, height, activity level, dietary or self-perception fields. | manual (browser) |
| AO2 | Form validation | Only name + ≥1 sport are required. Empty name, no sport, or an out-of-range optional value (weight / bottle / age / sessions) is rejected with a specific message; sports deduped, non-endurance/unknown dropped; goal accepted as text or `{text,event_date}`. | ✅ `tests/domain/profile-input.test.ts` |
| AO3 | Submit | The profile persists (`onboarded_at` set, `goal.text` stored); the app opens Home; a reload skips onboarding. | manual (browser) + `tests/data/repository.test.ts` |
| AO5 | Chat starter | The empty chat shows a short, warm intro — name, sports, and an acknowledgement of the goal (or a question about it) — **no wall of fuelling numbers**, then 3 prompt chips. | ✅ `tests/agent/starter.test.ts` + manual (browser) |
| AO11 | Contextual weight | Weight is not asked at onboarding. After a plan is saved with weight unknown, the reply asks once; "I'm 64 kg" / "my usual bottle is 750 ml" route to `save_profile_fact` and are used from then on; an intake log ("I had a gel and my 750 ml bottle") is **not** treated as a profile fact. | ✅ `tests/agent/profile-fact.test.ts` + manual |
| AO6 | Prompt replies become memory | "My typical training week is …" saves the plan **and** a `typical_week` memory; "My next race is …" saves a `next_race` memory (no session/plan created). | ✅ `tests/agent/week-plan.test.ts` |
| AO7 | Typing indicator | While a reply is generating, a three-dot wave shows in an assistant bubble. | manual (browser) |
| AO8 | Option-button prompts | A saved week gives a prep line for **every** day and renders per-session effort/length option buttons; picking them + Save updates the plan. | ✅ `tests/engine/week.test.ts`, `tests/agent/week-plan.test.ts` + manual |
| AO9 | History sidebar | Multiple conversations listed (title from first message, newest first); "New chat" and switching work; continuing sends more messages. | ✅ `tests/data/repository.test.ts` + manual |
| AO10 | Dashboard | Four visually-consistent range-bar panels (protein daily target · carb · fluid · sodium), all from the engine; rest days appear and carry the daily protein target; a `⚑ prep for <day>` flag marks the day before a long / double-session day (qualitative, no invented number); a lead paragraph explains why the during-session ranges repeat; table view lists all 7 days. | ✅ `tests/agent/dashboard.test.ts` + manual |

## A-shell. App shell (M11 → trimmed in the 2026 reset)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AS2 | Bottom nav | Tabs **Home · Dashboard · Chat** (the Daily tab was removed in the reset); active tab persists across reloads; nav stays pinned while tab content scrolls. Profile opens as an overlay from the Home avatar. | manual (browser) |
| AS3 | Profile overlay | Opens the profile form pre-filled with the saved profile ("Save changes"); saving updates the Home advice. | manual (browser) + `tests/data/repository.test.ts` |

> **Removed in the 2026 reset:** the "Daily" tab, the Mifflin–St Jeor daily
> energy/macro model (`dailyNutrition`, `daily_v0_2_0` rules), and the food
> portion catalog (`src/data/foods.ts`). Kona no longer shows a daily
> energy/macro breakdown — see `PRODUCT_VISION.md` and
> `CALCULATION_ENGINE_SPEC.md` §23. Scenarios AS1 / AS4 / AS5 / AS6 retired.

## A-home. Home tab (M12)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AH1 | Landing page | Opening the app lands on **Home** (first nav tab). A time-based greeting (`Good morning/afternoon/evening, <name>`) and today's date sit top-left; a Profile avatar sits top-right. | ✅ `tests/agent/home.test.ts` (greeting name, `today`) + manual |
| AH2 | Week day-strip | The current calendar week is shown Mon–Sun with the date number; today is ringed, the selected day is filled, and a dot marks days that have a session. Tapping a day reloads "What's Planned" + fuelling for that date. | ✅ `tests/agent/home.test.ts` (week dates/labels, `is_today`, `has_session`) + manual |
| AH3 | What's Planned | The selected day shows each planned session's title, **stated** effort (or "effort not set"), and **estimated** length (`"18 km"` / `"45 min"` / `"length not set"` — never a guessed number). Rest days and days outside the plan get a plain-language line. | ✅ `tests/agent/home.test.ts` (session view, needs-detail flags) + manual |
| AH4 | Recommended fuelling | Shows only what the day warrants — no daily energy/macro breakdown. A classifiable session shows during-session carb / fluid / sodium references + a post-session protein line; a rest or easy/unclassifiable day says "nothing to prepare — normal meals and fluids". | ✅ `tests/agent/home.test.ts` (during-session present for a long run; `post_session_protein_g` null on a rest day; `is_normal_day` for rest / gym-needs-detail / no-plan) + manual |
| AH5 | Change / add a workout | The card's CTA switches to the **Chat** tab with the composer pre-filled (`"On Wednesday I'm doing "` / `"Change my Sunday session to "`), so plan edits still go through the chat orchestrator. The prefill is applied once and then cleared. | manual (browser) |
| AH6 | Profile overlay | The Home avatar opens a full-screen overlay with the existing profile form (edit mode, pre-filled). Saving updates the greeting name and the Home fuelling. Profile is not a nav tab. | manual (browser) + `tests/data/repository.test.ts` |
| AH7 | No weekly plan | With no plan saved, Home still renders the week; "What's Planned" invites the user to tell Kona their week in chat. | ✅ `tests/agent/home.test.ts` |

## A-tod. Time of day + focused updates + check-in (M13)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AT1 | Session info contract | Every planned session needs type, intensity, distance-or-duration, **and time of day**. A missing time of day is prompted for — the weekly-plan option panel shows a Morning / Afternoon / Evening row per under-specified session. | ✅ `tests/agent/week-plan.test.ts` (`ask_time`) + manual |
| AT2 | Time is derived when stated | "18 km run at 6am" / "evening gym" set `time_of_day` without a prompt; the session then reads "… morning running" / "evening gym". | ✅ `tests/agent/week-plan.test.ts`, `tests/agent/home.test.ts` |
| AT3 | Morning pre-fuel advice | A morning session adds a qualitative pre-fuel line (light, quick carbs 20–30 min before — banana / dates / toast — not a full breakfast). No new numbers. | ✅ `tests/agent/week-plan.test.ts`, `tests/agent/home.test.ts` |
| AT4 | Single-day update stays focused | Filling / changing one day replies about **that day only** (updated line + that day's prep + any gap still open for it) — it does not re-echo the whole week or "Day by day". A new/replaced weekly plan still gets the full-week summary. | ✅ `tests/agent/week-plan.test.ts` + manual |
| AT5 | End-of-day check-in — quiet log | The popup (feel · went-as-planned · injuries/pains · free text) is saved as a recovery log; the reflection shows in the popup, nothing is added to the Chat thread. | ✅ `tests/agent/checkin.test.ts` + manual |
| AT6 | Check-in safety | A concerning elaboration trips the same safety screen as any recovery message — Kona points to professional care and does not diagnose. "Plan didn't go as planned" is a nudge to describe the actual in chat, not an overwrite. | ✅ `tests/agent/checkin.test.ts` |
| AT7 | Check-in trigger | `checkin.due` when today is a training day with no check-in yet; a red dot on the profile avatar + a re-entry banner; auto-opens once after ~22:00 (dismiss remembered for the session); the dot clears once done. | ✅ `tests/agent/home.test.ts` + manual |

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

Food estimation ranges (for logged meals), photo analysis, historical pattern
surfacing, auth, persistence backend (state currently resets on server restart).

All v0.1.0 (during-session) and v0.2.0 (daily) numbers are literature-sourced
placeholders — they require expert review before any public launch.
