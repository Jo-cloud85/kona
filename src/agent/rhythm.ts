import type { ActualSession, Intensity, PlannedSession } from '../domain/types';
import { CLUSTER_SOFTEN_MIN, describeRecentDay } from './briefing';
import { addDays, isoDate, joinList, mondayOf } from './home';

/**
 * Rhythm's 24-week consistency grid. The dot's fill is always "how hard did
 * the day actually feel" — never a judgment about whether the plan was
 * followed (M28.1, replacing the M27.5 model, which had a dedicated
 * "off_plan" color): a double session that felt fine isn't hard just for
 * being two sessions, and doing fewer sessions than planned, or shifting one
 * to another day, isn't a problem worth flagging on its own — it's just
 * training. Pain/injury is a separate, independent signal (`pain`, rendered
 * as a ring around the dot, not a color) — a hard day with pain and an easy
 * day with pain both deserve the same flag, which a single shared "off_plan"
 * bucket couldn't express.
 *  - empty:    nothing happened that day — no logged session, and no
 *              check-in confirming the plan happened either
 *  - easy / moderate / hard: the effort that actually happened, sourced in
 *              priority order — a check-in's own "how did it feel vs
 *              planned" answer (the most current truth available) shifts
 *              whatever intensity the logged session (or, lacking one, a
 *              check-in-confirmed plan) already implied
 */
export type RhythmDayState = 'empty' | 'easy' | 'moderate' | 'hard';

export interface RhythmDay {
  date: string;
  state: RhythmDayState;
  is_today: boolean;
  /** A same-day check-in reported a symptom — independent of `state`; a
   *  day's effort and whether something hurt are different questions. */
  pain: boolean;
}

/** What a check-in can add on top of a day's logged/planned intensity. */
export type FeltVsPlanned = 'easier' | 'as_expected' | 'harder';

const RHYTHM_WEEKS = 24;

const INTENSITY_RANK: Record<Intensity, number> = { easy: 0, moderate: 1, hard: 2, race: 2 };
const RANK_STATE: ('easy' | 'moderate' | 'hard')[] = ['easy', 'moderate', 'hard'];

function shiftByFeel(rank: number, felt: FeltVsPlanned | undefined): number {
  if (felt === 'easier') return Math.max(0, rank - 1);
  if (felt === 'harder') return Math.min(RANK_STATE.length - 1, rank + 1);
  return rank;
}

/** 24 weeks of daily dots, this week first, running forward. All three
 *  per-day inputs are keyed by already-local (tz-resolved) YYYY-MM-DD dates,
 *  same discipline as every other agent-layer builder:
 *  - `feltVsPlanned`: that day's check-in "how did it feel" answer, if any.
 *  - `confirmedAsPlanned`: dates where a check-in said the day went as
 *    planned — the only case a day with NO logged session still gets a
 *    color, falling back to the planned intensity (otherwise a normal,
 *    uneventful check-in with nothing separately logged left the dot empty,
 *    indistinguishable from a day the athlete never opened the app —
 *    founder report, 2026-09-18).
 *  - `pain`: dates a check-in reported a symptom. */
export function buildConsistencyDays(
  actualSessions: ActualSession[],
  plannedSessions: PlannedSession[],
  checkins: {
    feltVsPlanned: ReadonlyMap<string, FeltVsPlanned>;
    confirmedAsPlanned: ReadonlySet<string>;
    pain: ReadonlySet<string>;
  },
  now: Date,
): RhythmDay[] {
  const actualsByDate = new Map<string, ActualSession[]>();
  for (const s of actualSessions) {
    const d = s.start_at.slice(0, 10);
    const list = actualsByDate.get(d);
    if (list) list.push(s);
    else actualsByDate.set(d, [s]);
  }
  const plannedByDate = new Map<string, PlannedSession[]>();
  for (const s of plannedSessions) {
    const d = s.start_at.slice(0, 10);
    const list = plannedByDate.get(d);
    if (list) list.push(s);
    else plannedByDate.set(d, [s]);
  }

  function stateFor(date: string): RhythmDayState {
    // A skipped session didn't happen — it shouldn't set the day's effort,
    // but a day with only skipped sessions still falls through to the
    // planned-intensity fallback below, same as a day with nothing logged.
    const actuals = (actualsByDate.get(date) ?? []).filter((s) => s.status !== 'skipped');
    let rank: number | null = null;
    if (actuals.length > 0) {
      rank = Math.max(...actuals.map((s) => INTENSITY_RANK[s.intensity]));
    } else if (checkins.confirmedAsPlanned.has(date)) {
      const planned = plannedByDate.get(date) ?? [];
      if (planned.length > 0) rank = Math.max(...planned.map((s) => INTENSITY_RANK[s.intensity]));
    }
    if (rank === null) return 'empty';
    return RANK_STATE[shiftByFeel(rank, checkins.feltVsPlanned.get(date))]!;
  }

  const todayIso = isoDate(now);
  // Monday-aligned so row 0 of the grid is always Monday, row 6 always
  // Sunday. The window starts at the current week and runs forward (founder
  // direction, 2026-09-18: this week is column 1, next week is column 2, and
  // so on) — not-yet-happened days, which is most of the window, render as
  // "empty", which is honest (nothing logged there yet), not a bug.
  const start = mondayOf(now);
  const days: RhythmDay[] = [];
  for (let i = 0; i < RHYTHM_WEEKS * 7; i++) {
    const date = isoDate(addDays(start, i));
    days.push({ date, state: stateFor(date), is_today: date === todayIso, pain: checkins.pain.has(date) });
  }
  return days;
}

export interface ConsistencyRead {
  headline: string;
  detail: string;
}

/** The plain-language read shown under the grid — a headline plus one line
 *  of specifics, never a number alone. `recentHard` is the same trailing-
 *  window list `recentHardSessions` (briefing.ts) already computes for
 *  Today's own load-clustering tier, so the two screens can't disagree. */
export function describeConsistency(recentHard: ActualSession[], today: string): ConsistencyRead {
  if (recentHard.length < CLUSTER_SOFTEN_MIN) {
    return {
      headline: 'Aligned with your normal',
      detail: 'No unusual clustering of hard days recently — pace, spacing and recovery all look steady.',
    };
  }
  const dayLabels = recentHard.map((s) => describeRecentDay(today, s.start_at.slice(0, 10)));
  return {
    headline: 'Worth watching',
    detail: `${recentHard.length} hard sessions close together recently (${joinList(dayLabels)}) — worth keeping an eye on recovery.`,
  };
}
