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
| AO5 | Chat starter | The empty chat shows a short, warm intro — name, sports, and an acknowledgement of the goal (or a question about it) — **no wall of fuelling numbers**, then 3 prompt chips. When the current week has a notable session within ~3 days (long / hard / double wins, else the soonest), the intro **also leads with it** ("Coming up on Friday: your cycling — that's a session worth getting right…"); it stays generic when nothing is close or there's no plan (M21). | ✅ `tests/agent/starter.test.ts` + manual (browser) |
| AO11 | Contextual weight | Weight is not asked at onboarding. After a plan is saved with weight unknown, the reply asks once; "I'm 64 kg" / "my usual bottle is 750 ml" route to `save_profile_fact` and are used from then on; an intake log ("I had a gel and my 750 ml bottle") is **not** treated as a profile fact. | ✅ `tests/agent/profile-fact.test.ts` + manual |
| AO6 | Prompt replies become memory | "My typical training week is …" saves the plan **and** a `typical_week` memory; "My next race is …" saves a `next_race` memory (no session/plan created). | ✅ `tests/agent/week-plan.test.ts` |
| AO7 | Typing indicator | While a reply is generating, a three-dot wave shows in an assistant bubble. | manual (browser) |
| AO8 | Option-button prompts | A saved week gives a prep line for **every** day and renders per-session effort/length option buttons; picking them + Save updates the plan. | ✅ `tests/engine/week.test.ts`, `tests/agent/week-plan.test.ts` + manual |
| AO9 | History sidebar | Multiple conversations listed (title from first message, newest first); "New chat" and switching work; continuing sends more messages. | ✅ `tests/data/repository.test.ts` + manual |
| AO10 | ~~Dashboard~~ | The chart Dashboard was **removed in M17** and replaced by the "Memory" tab (A-know). `buildDashboard` is retained internally for Home's during-session numbers. | ✅ `tests/agent/dashboard.test.ts` (engine only) |

## A-shell. App shell (M11 → trimmed in the 2026 reset)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AS2 | Bottom nav | Tabs **Home · Memory · Chat** (Daily removed in M14, chart Dashboard replaced by Memory in M17); active tab persists across reloads; nav stays pinned while tab content scrolls. Profile opens as an overlay from the Home avatar. | manual (browser) |
| AS3 | Profile overlay | Opens the profile form pre-filled with the saved profile ("Save changes"); saving updates the Home advice. | manual (browser) + `tests/data/repository.test.ts` |

> **Removed in the 2026 reset:** the "Daily" tab, the Mifflin–St Jeor daily
> energy/macro model (`dailyNutrition`, `daily_v0_2_0` rules), and the food
> portion catalog (`src/data/foods.ts`). Kona no longer shows a daily
> energy/macro breakdown — see `PRODUCT_VISION.md` and
> `CALCULATION_ENGINE_SPEC.md` §23. Scenarios AS1 / AS4 / AS5 / AS6 retired.

## A-know. "What Kona knows about you" — the Memory tab (M17)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AK1 | Evidence of learning, not DB fields | Three sections: **what Kona's worked out** (M16 insights, each with an expandable "Why Kona thinks this" listing the supporting observations), **what you've told Kona** (goal + durable memories with readable labels), **recent training on record** (last 6 sessions + a same-day "felt" snippet). | ✅ `tests/agent/knows.test.ts` + manual |
| AK2 | Honest empty state | With nothing on record, `has_anything` is false and the tab says "Kona's still getting to know you… this page fills in as it learns" — no fabricated content. | ✅ `tests/agent/knows.test.ts` |
| AK3 | Non-diagnostic | A recurring body-part FACT shows its quoted evidence and a "(felt significant)" tag; the footer states Kona doesn't diagnose. | ✅ `tests/agent/insights.test.ts` + manual |
| AK4 | Visual restraint | Reuses the existing dark card aesthetic — no charts, no redesign. | manual (browser, light + dark) |
| AK5 | Feedback loop visible (M19) | A **"How Kona's been learning"** timeline: "You logged …" / "You told …" entries, then Kona-side steps — "Kona remembered: …", "Kona spotted — <pattern/fact>", "Kona will factor this into your … advice". Newest first; plan noise hidden. | ✅ `tests/agent/activity.test.ts`, `tests/agent/knows.test.ts` + manual |
| AK6 | Loop events fire once | `insight_formed` / `recommendation_adapted` are recorded the turn an observation crosses its threshold, and not again on later turns. `activity_events` is append-only and typed (future XP seam). | ✅ `tests/agent/activity.test.ts`, `tests/data/repository.test.ts` |

## A-home. Home tab (M12 → **daily briefing** in M18)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AH1 | Landing page | Opening the app lands on **Home**. A time-based greeting + today's date top-left; a Profile avatar (with a check-in dot when due) top-right; the Mon–Sun day strip. | ✅ `tests/agent/home.test.ts` + manual |
| AH2 | Week day-strip | Mon–Sun with date numbers; today ringed, selected day filled, a dot on days with a session. Tapping a day re-renders **YOUR DAY** for that date. | ✅ `tests/agent/home.test.ts` + manual |
| AH3 | YOUR DAY | Plain-language: a headline (session title / "Rest day" / "No plan yet") and a line ("Nothing unusual today. Keep it easy and eat normally."). Numbers (carb/fluid/sodium/protein) appear **only** when the session earns them. Unset details are listed and the line nudges to chat. Never a guessed number. | ✅ `tests/agent/home.test.ts` + manual |
| AH4 | ONE THING TO THINK ABOUT | The next key day (long / double / hard) after today, with the prep note and — when the history supports it — a real "this worked before" pattern line ("Your last 3 cycling sessions all went to plan… I'd keep your usual setup"). Hidden when nothing notable is coming up. Never fabricated. | ✅ `tests/agent/home.test.ts` + manual |
| AH5 | KONA REMEMBERS | 0–2 lines pulled from the deterministic insight layer (recurring symptom / hydration facts, a pattern, a stated preference). Hidden when there's nothing real. The same pattern is not repeated across ONE THING and KONA REMEMBERS. | ✅ `tests/agent/home.test.ts` + manual |
| AH6 | Change / add a workout | The YOUR DAY link switches to **Chat** with the composer pre-filled; plan edits go through the orchestrator. | manual |
| AH7 | Profile overlay | The Home avatar opens a full-screen overlay with the settings form (pre-filled). Saving updates the greeting + briefing. Profile is not a nav tab. | manual + `tests/data/repository.test.ts` |
| AH8 | No weekly plan | Home still renders the week + greeting; YOUR DAY invites the user to tell Kona their week in chat. | ✅ `tests/agent/home.test.ts` |

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

## A-ctx. Context-aware chat (M15)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AC1 | Shipped client | The real Anthropic model is used when `ANTHROPIC_API_KEY` is set (`.env.local`); the deterministic stub is the fallback for no-key / CI / `KONA_LLM=deterministic`. | manual + `lib/kona-server.ts` |
| AC2 | History reaches the model | `context.history` (recent sessions + recovery + fuel logs) and `profile.goal` are serialized into both the interpret and compose prompts. | ✅ `tests/agent/anthropic-llm.test.ts` |
| AC3 | References the past | Planning a session similar to a prior one, the reply names what happened last time and — if it worked — says to keep it rather than change several things. | manual (live model) |
| AC4 | Answers from context | "What do you know about my training?" / "how's my week looking?" get a real spoken answer (no tools), not "no tool calls needed here". | manual (live model) + `INTERPRET_SYSTEM` |
| AC5 | FACT vs PATTERN vs HYPOTHESIS | The reply keeps "you reported this twice" (fact), "you seem to tolerate X better" (pattern) and "the bigger breakfast may be a factor" (hypothesis) distinct; never states a hypothesis as certainty. | manual (live model) + `COMPOSE_SYSTEM` |
| AC6 | Edit a message → regenerate | Editing a sent user message truncates the transcript at that point and re-runs the turn — the edited message + a fresh reply replace everything below; the sidebar title updates. Structured side effects of the replaced turn are NOT rolled back (documented). | ✅ `tests/agent/edit-message.test.ts`, `tests/data/repository.test.ts` + manual |

## A-insight. Pattern layer (M16)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AI1 | Deterministic, not invented | `deriveInsights()` computes observations from history in code; each is labelled **fact / pattern / hypothesis / recommendation** with a certainty and an evidence count. | ✅ `tests/agent/insights.test.ts` |
| AI2 | Conservative | Nothing is emitted below the thresholds (a frequency fact needs ≥3 same-sport completed sessions; an *outcome* read needs ≥3 with result signals — see **A-truth**; a recurring symptom ≥2 mentions; an off-plan run ≥3 of ≤6; a staple fuel item ≥3 logs). Empty history → `[]`. | ✅ `tests/agent/insights.test.ts` |
| AI3 | Non-diagnostic | A recurring body-part mention is a FACT ("noted calf 2 times… Kona doesn't diagnose"); a moderate+ mention adds a gentle "get it assessed" recommendation. No cause is ever asserted. | ✅ `tests/agent/insights.test.ts` + manual (live model) |
| AI4 | Model leans on them | Insights are in the chat context (`kind` + `basis` + `text`); the reply references them keeping the tag's meaning (a "pattern" is not upgraded to certainty). | manual (live model) + `COMPOSE_SYSTEM` |
| AI5 | `GET /api/insights` | Returns the current `Insight[]` for the demo user (feeds the M17 "What Kona knows" view). | manual + `getInsights()` |

## A-truth. Product Truth Audit — reported vs repeated vs learned vs adapted (M22)

Every `Insight` carries a `basis`: `reported` (they said it) · `repeated` (frequency only) · `outcome` (repetition + a result) · `adaptation` (activity-log only). Conservative, no-diagnosis philosophy preserved.

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AT-R1 | Successful repetition | 3 completed same-sport sessions with **no** outcome signal → a `repeated` **fact** only ("completed your last 3 as planned"). **No** pattern, **no** "it's working", **no** "keep it". | ✅ `tests/agent/product-truth.test.ts`, `tests/agent/insights.test.ts` |
| AT-R2 | Successful repetition, earned | 3 completed **and** most felt good **and** none went badly → an `outcome` **pattern** ("going well… felt good afterwards (N of N)") + an `outcome` **recommendation** ("looks like it's working — keep it steady"). | ✅ `tests/agent/product-truth.test.ts` |
| AT-F1 | Repeated failure | A window dominated by sessions the athlete flagged as bad (≥2, ≤1 ok) → an `outcome` **fact** ("repeatedly run into problems you flagged — N of M; Kona doesn't diagnose"). No blame, no cause, **no** "keep it" recommendation. | ✅ `tests/agent/product-truth.test.ts` |
| AT-C1 | Conflicting evidence | Both good and bad in the window, no clean explanatory variable → a low-certainty `outcome` **fact** ("results have been mixed… not enough to change anything on"). **No recommendation.** | ✅ `tests/agent/product-truth.test.ts` |
| AT-U1 | New / unproven setup | A single session with an outcome note → a low-certainty `repeated` **fact** ("once so far — one session isn't enough…"). Never a working-setup pattern or recommendation. | ✅ `tests/agent/product-truth.test.ts` |
| AT-K1 | Different outcomes by conditions | Good vs bad split cleanly on one variable (fed/fasted, time of day, heat) → a low-certainty `outcome` **pattern** naming the condition ("the bad ones were all done fasted… Kona isn't pinning down a cause"). **No** "keep it" recommendation, **no** causal claim. | ✅ `tests/agent/product-truth.test.ts` |
| AT-A1 | Actual recommendation adaptation | A new `outcome` recommendation → `insight_formed` ("Kona's take — …") only. `recommendation_adapted` fires **only** on a later turn where the recommendation was already known **and** the turn produced advice (fuelling calc / week plan); once per insight; never for a pattern/fact; never as a promise. | ✅ `tests/agent/product-truth.test.ts`, `tests/agent/activity.test.ts` |

## A-goal. Goal / race context (M20)

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AG1 | Date parsed from goal text | `parseGoalDate` reads an ISO date, "`<Month> <day>`", "`<day> <Month> <year>`" (next future year when the year is omitted), "in N weeks", or a bare "in `<Month>`" (→ the 1st). Nothing dateable → `undefined`; onboarding stores the derived `event_date` on the goal. | ✅ `tests/domain/goal.test.ts`, `tests/domain/profile-input.test.ts` |
| AG2 | One quiet line, tightening over time | `goalContext().phrase`: "`N` weeks to your `<goal>`." → "`N` days to your `<goal>`." (≤21) → "Race week — `<goal>` in `N` days." (≤7) → "Race day — `<goal>`." → `null` once passed. The trailing date clause is stripped from the shown goal text. | ✅ `tests/domain/goal.test.ts` |
| AG3 | Home surfaces it | `buildHome` returns `goal_line`; Home renders it as one slim accent line under the date — no new card. `null` when the goal has no parseable date or there's no goal. | ✅ `tests/agent/home.test.ts` + manual (browser) |
| AG4 | Model gets timing, not a schedule | `contextForPrompt` passes `event_date` / `weeks_until` / `context_line`; `COMPOSE_SYSTEM` weaves the timing in where it matters and explicitly does **not** behave like a periodised plan. | manual (live model) + `COMPOSE_SYSTEM` |
| AG5 | Goal change stated in chat | "My triathlon is on June 14th this year." routes to `save_profile_fact` (`goal_text` / `goal_event_date`, date validated `YYYY-MM-DD`, may update the date alone); the `fact_learned` activity entry names the goal. | ✅ `tests/agent/profile-fact.test.ts` + manual (live model) |
| AG6 | Not a plan app | No "Week X of Y" (needs a periodised-block model Kona doesn't have); the goal is context, never a training schedule. | by design |

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
| AW10 | Only chase the 1–2 that matter (M21) | A saved week with several under-specified sessions does **not** demand details for all of them. The engine flags the next 1–2 `in_focus` — key days (long / hard / double) first, then soonest — and still emits a prompt for every gap. The reply asks only about the in-focus ones ("pin down the 2 sessions that matter most first … the other 4 we can sort a day or two out"); the chat renders buttons only for those. The real model does the same via `COMPOSE_SYSTEM`. Per-day gaps still surface on Home a day out. | ✅ `tests/engine/week.test.ts`, `tests/agent/week-plan.test.ts` + manual (live model) |

## A-persist. Production persistence + user identity (M23)

Supabase Postgres + magic-link auth + per-user RLS, behind the unchanged `Repository` boundary. `InMemoryRepository` stays for tests + the no-Supabase dev fallback (refused in production).

| # | Scenario | Expected behaviour | Coverage |
|---|----------|--------------------|----------|
| AP1 | Same repository contract, both impls | CRUD round-trips for profile / planned+actual sessions / weekly plan / fuel / recovery / memory / messages / activity; planned and actual stay separate; `proposeMemory` upserts on `(user, key)`; conversation list is derived from messages. | ✅ `tests/data/repository-contract.ts` (in-memory) + `tests/data/supabase-repository.live.test.ts` (real, env-gated) |
| AP2 | Cross-user isolation | User B cannot read user A's profile, plans, sessions, fuel/recovery logs, memories, activity events, or conversations — reads come back empty, not another user's rows. A write claiming another user's `user_id` is rejected. | ✅ `repository-contract.ts` isolation cases; `supabase-repository.live.test.ts` (real RLS: empty reads + insert rejected) |
| AP3 | Auth boundary | No signed-in user → every API route returns 401 (and `middleware.ts` redirects page loads to `/login`). Supabase misconfigured in production → 500, never a silent single-user mode. | ✅ `tests/server/routes-auth.test.ts`, `tests/server/server-context.test.ts` |
| AP4 | Dev fallback | No Supabase env + non-production → in-memory, one fixed local user, loud console warning; app fully usable. | ✅ `tests/server/server-context.test.ts` + manual (browser: onboard → chat turn → persisted & scoped) |
| AP5 | Persistence across "restart" | Data written by one client is still there from a brand-new client with the same identity (fresh process). | ✅ `supabase-repository.live.test.ts` (env-gated); manual journey in `DEPLOYMENT.md` |
| AP6 | Activity events immutable | `activity_events` has select+insert RLS policies only — UPDATE/DELETE affect 0 rows; the stream is append-only at the DB. | ✅ `supabase-repository.live.test.ts`; `repository-contract.ts` (no mutate methods on the interface) |
| AP7 | Provenance preserved | `certainty` (`reported`/`repeated`/`outcome`/`adaptation` distinctions from M22) and memory `certainty` survive the round-trip unchanged; insights are recomputed, never stored. | ✅ `repository-contract.ts` (memory + activity `meta`), schema comments in `0001_init.sql` |
| AP8 | Conversation continuity | Reopening a prior conversation returns its messages, scoped to the user; editing a message truncates only that user's conversation. **Known limitation**: structured records from an edited-away turn are not rolled back (`ARCHITECTURE.md` §6b). | ✅ `repository-contract.ts` (messages + `deleteMessagesFrom` scoping) + manual |
| AP9 | Sign in / stay / sign out | Magic link → `/auth/callback` exchanges the code → session cookie; middleware refreshes it each request; "Sign out" in the profile overlay clears it and returns to `/login`. | manual (needs a Supabase project — founder-review step) |

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
