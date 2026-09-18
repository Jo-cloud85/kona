# Kona — Progress

> **History note:** this file keeps the current milestone plus the most
> recent few (M27–M27.2) in full detail. Everything older — M1 through M26,
> including the 2026 reset's milestone plan — is preserved unedited in
> `progress-archive.md`; check there for anything not covered here. Split
> 2026-09-18 to keep this file (and the context cost of reading it every
> session) from growing without bound — nothing was deleted, only moved.

## Current milestone
**Product reset (2026) in progress.** Kona re-scoped to a *sustainable
performance companion* (thesis refined M24) — relationship + judgment, not a
nutrition tracker. **M14.1–M26 + M15.1 + UI pass done. Live on Vercel, founder
alpha testing underway.** M26 (2026-09-14) reversed the earlier "no visual
redesign" / "no gamification" stances — see `progress-archive.md` —
everything before it was built under those constraints. Don't fabricate
insights, stop for a product review after each milestone. See the reset
milestone plan in `progress-archive.md` + `PRODUCT_VISION.md`.

### M27.2 — Second visual pass, after founder ran the M27.1 migration (2026-09-17) ✅
Founder applied `0006_goals_array.sql` themselves and came back with a second
round of concrete visual feedback, all implemented and verified live:

- **App-wide background is now one purple radial wash**, not the old
  dark-with-corner-glow: `--bg-gradient: radial-gradient(circle at 50% -10%,
  rgba(110, 70, 225, 0.5), #6e46e1)` (`globals.css`). Applies everywhere —
  `body` was already the only place this token was consumed.
- **Type**: `--font-sans` now leads with `'Helvetica Neue'`; base/paragraph
  and chat text (`body`, `.composer textarea`) down 15px→13.5px (10%, as
  asked). Left headings, labels, and UI chrome (buttons, badges, inputs)
  at their existing explicit sizes — those aren't "paragraph" or "chat"
  text and shrinking them wasn't asked for.
- **Dropped the glow on `.composer button`, `button.cta`, and
  `.home-avatar`** (the three actual `<button>` elements carrying a
  `drop-shadow`). Left `.onboard-avatar`/`.profile-head-avatar` alone —
  decorative, not buttons.
- **`.week-day` (Today's "Your week" preview AND the Week tab — same class,
  one fix covers both) is now translucent blue-violet**
  (`color-mix(in srgb, var(--accent) 12%, transparent)`, today's row at
  24%) instead of the neutral `--panel` tone. Also caught and fixed a
  leftover hardcoded `rgba(124, 255, 59, ...)` (the old lime) on
  `.week-day.is-today` that M27.1's color pass had missed — it wasn't a
  `var(--accent)` reference so the earlier find/replace never touched it.
- **Rhythm's consistency grid, round 2**: no card chrome around the dots at
  all now (was still wrapped in a `.home-card` after M27.1 — the founder's
  "no background" ask was about the dots' *fill*, this round was about the
  *section* itself); `.rhythm-grid` gap 3px→6px; dot colors are explicit
  hex now, not `color-mix` blends (`easy` = `rgba(124,140,240,0.45)`,
  `normal` = `#3B33C7` solid, `flag` = `#F62B0A` solid) — the blended
  versions read muddy against the new purple background. Added a
  `.rhythm-legend` row (5 labeled swatches: normal/easy/off-plan-or-hard/
  rest/today). The headline ("Aligned with your normal" / "Worth
  watching") moved into its own `.kona-card` below the grid+legend,
  labeled "Reading your rhythm".

Verified live against the founder's real account (not seeded data): full
purple background across Today/Week/Chat/Rhythm; smaller body/chat type;
no glow on any button; translucent day rows on both Today's week preview
and the Week tab; the legend and re-colored, uncarded consistency grid.
`tsc`/`eslint`/`vitest` (332 passing)/`next build` all clean.

### M27.1 — Founder visual/UX review of M27 (2026-09-17) ✅
Founder looked at the live M27 build and gave direct feedback; all items
implemented and verified live in the same pass:

- **Check-in modal was nearly see-through.** `.dialog` was using the shared
  `--panel` token (5% white) — fine for a card sitting flush on the page,
  not for a sheet meant to sit ON TOP of it. Now a near-opaque surface of
  its own (`color-mix(in srgb, var(--bg) 92%, white 6%)`); backdrop darkened
  55%→72% too.
- **Color pass.** The neon-green accent is replaced everywhere with a
  blue-violet pair (dark `#3B33C7`, light `#7C8CF0` — `--accent`,
  `--accent-dark`, `--grad-recovery`, `--user-bubble`, `--panel-kona`,
  `--accent-text` now white for contrast on the new gradient). The
  orange-red accent (`--grad-performance`) is untouched — it already
  matched the founder's given codes (dark `#F62B0A`, light `#FF9A44`)
  exactly.
- **Rhythm: dropped the circular avatar ring and the "Arc II" stage box.**
  Both removed from `RhythmTab.tsx`; their now-dead CSS (`.you-ring*`,
  `.you-badge`, `.you-arc-*`) removed from `globals.css`. `computeArcProgress`
  itself is untouched server-side — not asked to remove the underlying Arc
  concept, just its two UI blocks on this screen.
  `.rhythm-tab .home-top` gap was tuned to the removed section, so this was
  a clean removal.
- **Rhythm: consistency grid — four states, not trained/not.** New
  `src/agent/rhythm.ts` (`buildConsistencyDays`, moved out of
  `lib/kona-server.ts` so it's unit-testable like the rest of the agent
  layer — `tests/agent/rhythm.test.ts`, 9 tests): `empty` (dashed, nothing
  logged), `easy` (translucent blue-violet), `normal` (solid blue-violet —
  moderate/hard, pain-free, as planned), `flag` (solid orange-red — didn't
  go as planned, OR a pain/injury check-in that day, OR the day is part of
  a hard-session cluster). "Cluster" reuses `briefing.ts`'s own
  `CLUSTER_WINDOW_DAYS`/`CLUSTER_SOFTEN_MIN` constants (checked in every
  4-day window containing the day, not just the trailing one, so both days
  of a tight pair flag) — the exact same threshold Today's own
  load-clustering tier uses, so the two screens can't disagree. Dots are
  flat colors, not gradients — a gradient read as noise at that size, and
  "no background for the dots" was the founder's literal ask. Pain signal:
  a check-in's `reported_symptoms.length > 0` (tz-resolved via
  `localDateOf`), not `overall_severity`, since severity also rises for
  merely heavy legs and would have false-positived "flag" on ordinary tired
  days.
- **Rhythm: "What Kona knows" collapsed to a preview.** Was always fully
  expanded (insights + told + recent + timeline, inline). Now a one-line
  teaser + "See everything Kona knows →" in a `.home-card`; tapping it
  swaps in the full feed as a `.profile-overlay.nested` (same pattern as
  `SessionRecapView`'s memory-from-week overlay) with a `‹ Back` button
  returning to Rhythm. Milestones stayed inline, not folded into this —
  read as a Rhythm/progress fact, not part of the "what Kona knows"
  conversational feed.
- **Week tab now starts on Monday.** `buildWeek` was a rolling
  today-minus-6-through-today-plus-7 window (deliberately NOT calendar-week
  per its own prior comment, matching Home's day-strip). Re-anchored to
  `mondayOf(now)` (an existing, already-tested helper in `home.ts` that
  wasn't being used here) — still 14 days, just Monday-first instead of an
  arbitrary rolling start. `tests/agent/week.test.ts` updated.
- **Goals: explicit date-or-not, up to 3.** `Profile.goal?: TrainingGoal` →
  `Profile.goals?: TrainingGoal[]` (cap 3, `MAX_GOALS` in `domain/goal.ts`).
  `ProfileForm.tsx`'s single goal input is now up to 3 rows, each with an
  explicit "Is there a race or target date?" Yes/No toggle — no more
  silently regex-guessing a date out of free text in the settings form
  (`profile-input.ts`'s `parseGoals` only keeps an explicitly-given
  `YYYY-MM-DD`). Rhythm shows every goal as its own card, `countdown` shown
  as literal "No target date" when there isn't one, never omitted. Chat's
  goal-aware copy (starter greeting, taper chip, system-prompt context) now
  reads `nearestUpcomingGoal()` — soonest future-dated goal, or the first
  goal when none are dated — new helper in `domain/goal.ts`, tested. The
  `save_profile_fact` chat tool still only ever edits the *first* goal
  (adding a 2nd/3rd is a settings-form action, not a chat one) — a
  deliberate scope call, not an oversight: teaching the model to
  disambiguate "add a second goal" conversationally is a materially bigger
  problem than this pass. **Needs `supabase/migrations/0006_goals_array.sql`
  applied to Supabase before profile saves work in production** — verified
  live and caught the 500 (`Could not find the 'goals' column`) before
  reporting this milestone done; the migration file is written and correct,
  just not yet run against the founder's actual database (same as every
  prior migration in this repo — applied manually, not by Claude).

Verified live (real account, not seeded data): color/modal changes across
Today/Week/Chat; Week's Monday-first ordering; Rhythm's avatar/Arc removal,
4-state dots (all 4 states visibly distinct), goal-empty state, knows
preview → full detail → back; Profile form's add-goal/remove-goal/date-toggle
flow end-to-end (save currently blocked on the migration above). 332 tests
passing (up from 317), `tsc`/`eslint`/`next build` all clean.

### M27 — "Kona accompanies me": Today/Rhythm redesign (2026-09-17) ✅
Founder-led audit of the actual product experience (not architecture) found
Kona's judgment/learning machinery was already close to a real
context→judgment→action→outcome→learning loop — the problem was that Chat
was the de-facto primary interface (sidebar, "+ New chat", generic starter
prompts, an exposed `intent` debug label), Home showed its best asset
(`buildKonaBriefing`'s cascade) as one card among five, and check-in was a
dismissible banner rather than the payoff moment it should be. Full writeup
in conversation, not a separate doc; plan reviewed and approved before any
code (`/Users/yingfeng/.claude/plans/dreamy-swinging-shore.md`).

Reconciled against a Claude Design mockup (`Kona UX.dc.html`, project
`d80b9252-b5a6-4135-a783-aa6b634b2cb8`) via 8 explicit founder decisions —
collapse Memory into Rhythm; build the plan-change "recommendation pending"
proposal now; a founder-chosen synthesis of the design's minimal check-in
and the existing 6-question one; the 24-week consistency grid is a
deliberate, considered exception to "not a metrics dashboard"; the design's
Strava/Notifications Profile fields and password-login form are generic
placeholder content, ignored; goal/milestones live further down Rhythm, not
shown in the design's flow set; Chat's suggested chips are deterministic,
same discipline as `briefing.ts`/`insights.ts`.

**Nav: Home → Today, You + Memory → Rhythm.** Four tabs now (was five) —
`app/AppShell.tsx`'s `Tab` type, `NAV` icons, and the stale-`localStorage`
remap all updated so an existing alpha tester's saved tab never lands
somewhere dead. Full rename sweep, not aliasing: `HomeTab.tsx` →
`TodayTab.tsx`; `YouTab.tsx` + `KnowsView.tsx` → one new `RhythmTab.tsx`;
`getHome()`/`HomeView` → `getToday()`/`TodayView`; `getYou()` + `getKnows()`
→ one `getRhythm()`/`RhythmView`; `/api/home` → `/api/today`; `/api/you` +
`/api/knows` → `/api/rhythm`. (`src/agent/home.ts`'s *filename* and its
unrelated date/session utilities — `sportLabel`, `titleFor`, `addDays`, etc.
— were deliberately left alone; only the Home-specific exports moved.)

**Today's judgment cascade widened** (`buildKonaBriefing`, `briefing.ts`) —
"given everything going on with you", not just pre-workout reminders, per
the founder's own five examples:
- `recentOutcomeSignal` (tier 1) no longer requires today to have a session
  — a recent bad outcome now surfaces as "keeping an eye on X" even on a
  rest day.
- New tier 2, load clustering: ≥2 hard/race completed sessions in a
  trailing 4-day window softens today's call to "treat today as
  maintenance"; at ≥3 **and** a rest day exists in the saved plan, it
  becomes a real plan-change proposal instead — see below.
- `upcomingSessionSignal` (tier 5) now prefers `src/engine/week.ts`'s
  day-before prep text (double/long/key-day specific — previously only
  reachable through a saved-weekly-plan chat reply, never through Home) when
  a saved plan covers the target day, and always states "Nothing needed
  today" explicitly when the call isn't about today.
- `Dashboard` (`dashboard.ts`) now exposes `recommendation_inputs` (already
  computed by `analyzeWeek()`, previously discarded) so `getToday()` can
  pass it straight to the cascade — no new calc-engine work.

**Recommendation pending — an actual plan-change proposal, not just
advice.** `KonaBriefing` gained `pending_recommendation: PendingRecommendation
| null` (id, reason_line, accept/decline labels, session_id, from/to date).
Accept calls the *already-existing* `updatePlannedSession(id, {start_at})` —
no data-layer change needed, confirmed before building; decline logs a new
`recommendation_declined` activity-event type (plain `text` column, no
migration) naming the exact proposal, checked by the cascade before
re-proposing the identical swap — reuses `activity_events` instead of a new
table, per "push the existing data model before assuming new infra." New
`respondToRecommendation()` (kona-server.ts) + `POST /api/today/recommendation`.
Verified live end-to-end: seeded a real 3-hard-day cluster + a saved rest
day, confirmed the exact swap proposal, accepted it and confirmed the
session's `start_at` actually moved, then re-seeded and declined it and
confirmed the identical swap was never re-proposed (falls back to the
softer "maintenance" call instead).

**"Kona learned" — the specific consequence, not a self-graded track
record.** Founder explicitly rejected an earlier "Kona's calls have been
landing" idea (reads as the app reviewing itself) in favor of showing what
changed: `learnedCategoryInsights()` (`insights.ts`) counts, per advice
category, `followed_outcome === 'better'` check-ins; at 2+ it produces
"Extra fluid seems to help — based on N of your last M check-ins", reusing
the same `SessionFlagCategory` vocabulary `briefing.ts` already has. Needed
`KonaBriefing.category` exposed (was computed internally, never returned)
and two new structured `RecoveryLog` columns — `followed_category` +
`followed_outcome` — recording the loop-closing answer directly instead of
`insights.ts` re-parsing its own English. `submitCheckin()` diffs
"before vs. after saving" to detect the exact check-in that first crosses
the threshold for a category — a one-shot Today toast (no separate dedup
tracking needed, the diff *is* the dedup) — then permanent thereafter in
Rhythm's merged insights feed.

**Check-in — "something in between."** Reworked `checkin.ts`+`CheckinDialog.tsx`:
`Legs: Fresh/Normal/Heavy` replaces the old 6-option humor scale
(`workout_feel`); `As planned?`/`Pains?` kept (planned-vs-actual is core,
not a UI nicety); two new optional rows, `Sleep` (reuses the *already
existing* `RecoveryLog.sleep_quality`, previously chat-only) and `Mood`
(new `mood` column); the M24.5 loop-closing question kept, now also records
`category`. Migration `0005_checkin_expansion.sql` — `mood`,
`followed_category`, `followed_outcome`, all nullable, no new table.

**Rhythm** (`app/RhythmTab.tsx`) — merges the old You + Memory screens.
New 24-week consistency grid (`RhythmView.consistency`, `kona-server.ts`) —
a plain-language headline ("Aligned with your normal" / "Worth watching",
reusing the *exact same* clustering threshold as Today's own tier 2 via a
newly-exported `recentHardSessions`/`CLUSTER_*`, so the two screens never
disagree) above a 7×24 dot grid, deliberately never a bare number. Below it:
Arc stage bar, goal card, the merged "What Kona has learned" feed (now
includes the category-based learned entries as `pattern`/`outcome` entries,
ranked to the top), milestones, "what you've told Kona," recent sessions,
the learning timeline — all kept, not deleted, per founder direction.

**Chat cleanup**: dropped the exposed `intent` debug label under assistant
bubbles and the model-name suffix in the header (`anthropic (claude-sonnet-5)`
→ "usually replies in a few seconds" — a relationship framing, not an AI
subtitle). Starter chips (`buildSuggestedPrompts`, `starter.ts`) are now
deterministic and context-tied instead of a fixed three-item list — a taper
chip only when `goalContext().weeks_until <= 8`, a nutrition chip only when
a real upcoming session exists (naming it), always falling back to a
generic pair so the composer is never empty-handed.

**Verified**: `tsc`, `eslint`, `vitest` (317 passing, up from 295 at the
start of this milestone), `next build` all clean throughout, plus a full
live Browser-pane walkthrough (dev-fallback pattern) — onboarded, seeded a
real 3-hard-day cluster via chat, confirmed the recommendation-pending card
end-to-end (propose → decline → suppressed → re-seed → accept → session
actually moved), the check-in dialog's new fields submitting correctly and
the card returning to the right state afterward, Rhythm's grid rendering
168 real dots (3 trained, 1 today-ringed) with a headline matching Today's
own signal, and Chat's new header/starter copy — via DOM-content reads
rather than screenshots, since the Browser pane's screenshot frames were
running several actions behind live DOM state this session (a known
recurring quirk, not a real bug — confirmed by cross-checking the same
state via direct `textContent` reads, which were always correct and
in sync with the network log).


## Known issues / deliberate deferrals
Nothing new tracked here as of M27.2. The pre-M24 list that used to live in
this section is historical (mostly resolved or superseded by the 2026 reset)
and has moved to `progress-archive.md` along with everything else from that
era. Add real, current issues here as they're found.

## Next recommended task
See "Current milestone" above for the latest verified state (M27.2, 2026-09-17
— founder alpha testing underway). Add the next task here once it's decided;
the recommendation that used to live in this section (from the M23-era
"hold for alpha" note) is stale and has moved to `progress-archive.md`.
