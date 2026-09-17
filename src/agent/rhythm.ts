import type { ActualSession } from '../domain/types';
import { CLUSTER_SOFTEN_MIN, CLUSTER_WINDOW_DAYS, describeRecentDay } from './briefing';
import { addDays, isoDate, joinList, mondayOf } from './home';

/**
 * Rhythm's 24-week consistency grid. Five states, not a plain trained/not —
 * the same rough read a coach would give at a glance (M27.5 — split the
 * original single "flag" state into "off_plan" and "hard", each with its
 * own color, per founder direction):
 *  - empty:    nothing logged that day at all — no session, no check-in
 *  - easy:     an easy session, went fine
 *  - moderate: a moderate/hard session, followed as planned, pain-free
 *  - off_plan: didn't go as planned, or pain/injury reported that day —
 *              from a logged session's own status, OR from a check-in
 *              alone, even with no matching session log (M27.8)
 *  - hard:     part of a run of hard days close together — the exact same
 *              load-clustering threshold Today's own judgment cascade uses
 *              (briefing.ts's CLUSTER_WINDOW_DAYS/CLUSTER_SOFTEN_MIN), so
 *              the two screens never disagree about what counts as "too
 *              hard". Checked only once a day isn't already off_plan.
 */
export type RhythmDayState = 'empty' | 'easy' | 'moderate' | 'off_plan' | 'hard';

export interface RhythmDay {
  date: string;
  state: RhythmDayState;
  is_today: boolean;
}

const RHYTHM_WEEKS = 24;

function isHardCompleted(s: ActualSession): boolean {
  return s.status === 'completed' && (s.intensity === 'hard' || s.intensity === 'race');
}

/** 24 weeks of daily dots. `offPlanDates` is a set of YYYY-MM-DD dates the
 *  caller has already resolved (tz-aware — see localDateOf) from that day's
 *  check-in reporting a symptom OR saying the day didn't go as planned —
 *  kept out of this module so it stays a pure function of already-local
 *  dates, same as every other agent-layer builder. Checked even on a day
 *  with no separately-logged ActualSession (M27.8) — a check-in alone is
 *  real signal; it shouldn't take a full session log to register as
 *  off-plan. */
export function buildConsistencyDays(actualSessions: ActualSession[], offPlanDates: ReadonlySet<string>, now: Date): RhythmDay[] {
  const byDate = new Map<string, ActualSession[]>();
  for (const s of actualSessions) {
    const d = s.start_at.slice(0, 10);
    const list = byDate.get(d);
    if (list) list.push(s);
    else byDate.set(d, [s]);
  }
  const hardDates = new Set([...byDate.entries()].filter(([, list]) => list.some(isHardCompleted)).map(([d]) => d));

  // Checks every CLUSTER_WINDOW_DAYS-long window that includes `date` (not
  // just the one trailing it) — so both days of a tight pair flag, not only
  // the later one.
  function clustered(date: string): boolean {
    if (!hardDates.has(date)) return false;
    const base = new Date(`${date}T00:00:00`);
    for (let offset = -(CLUSTER_WINDOW_DAYS - 1); offset <= 0; offset++) {
      let count = 0;
      for (let i = 0; i < CLUSTER_WINDOW_DAYS; i++) {
        if (hardDates.has(isoDate(addDays(base, offset + i)))) count++;
      }
      if (count >= CLUSTER_SOFTEN_MIN) return true;
    }
    return false;
  }

  function stateFor(date: string): RhythmDayState {
    const sessions = byDate.get(date);
    if (!sessions?.length) return offPlanDates.has(date) ? 'off_plan' : 'empty';
    const notFollowed = sessions.some((s) => s.status !== 'completed');
    if (notFollowed) return 'off_plan';
    const completed = sessions.filter((s) => s.status === 'completed');
    // A double-session day is a demanding day regardless of each session's
    // own intensity — the same "key day" reading engine/week.ts's
    // is_key_day already gives it (multi-session, not just a single hard/
    // long session). Checked ahead of a same-day check-in symptom report:
    // a fully-completed, as-planned double session with some expected
    // soreness after is a hard day, not a deviation (founder report,
    // 2026-09-18 — a double-session day with mild soreness was showing as
    // off_plan, indistinguishable from a genuinely skipped/modified day).
    if (clustered(date) || completed.length > 1) return 'hard';
    if (offPlanDates.has(date)) return 'off_plan';
    return completed.every((s) => s.intensity === 'easy') ? 'easy' : 'moderate';
  }

  const todayIso = isoDate(now);
  // Monday-aligned so row 0 of the grid is always Monday, row 6 always
  // Sunday (M27.5). The window starts at the current week and runs forward
  // (founder direction, 2026-09-18: this week is column 1, next week is
  // column 2, and so on) rather than looking back — not-yet-happened days,
  // which is most of the window, render as "empty", which is honest
  // (nothing logged there yet), not a bug.
  const start = mondayOf(now);
  const days: RhythmDay[] = [];
  for (let i = 0; i < RHYTHM_WEEKS * 7; i++) {
    const date = isoDate(addDays(start, i));
    days.push({ date, state: stateFor(date), is_today: date === todayIso });
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
      detail: 'No unusual clustering of hard or off-plan days recently — pace, spacing and recovery all look steady.',
    };
  }
  const dayLabels = recentHard.map((s) => describeRecentDay(today, s.start_at.slice(0, 10)));
  return {
    headline: 'Worth watching',
    detail: `${recentHard.length} hard sessions close together recently (${joinList(dayLabels)}) — worth keeping an eye on recovery.`,
  };
}
