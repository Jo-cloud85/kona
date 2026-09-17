import type { ActualSession } from '../domain/types';
import { CLUSTER_SOFTEN_MIN, CLUSTER_WINDOW_DAYS, describeRecentDay } from './briefing';
import { addDays, isoDate, joinList } from './home';

/**
 * Rhythm's 24-week consistency grid (M27.1). Four states, not a plain
 * trained/not-trained — the same rough read a coach would give at a glance:
 *  - empty:  nothing logged that day (a rest day, or nothing planned)
 *  - easy:   an easy session, went fine
 *  - normal: a moderate-to-hard session, followed as planned, pain-free
 *  - flag:   didn't go as planned, pain/injury reported that day, or part of
 *            a run of hard days close together — the exact same
 *            load-clustering threshold Today's own judgment cascade uses
 *            (briefing.ts's CLUSTER_WINDOW_DAYS/CLUSTER_SOFTEN_MIN), so the
 *            two screens never disagree about what counts as "too hard".
 */
export type RhythmDayState = 'empty' | 'easy' | 'normal' | 'flag';

export interface RhythmDay {
  date: string;
  state: RhythmDayState;
  is_today: boolean;
}

const RHYTHM_WEEKS = 24;

function isHardCompleted(s: ActualSession): boolean {
  return s.status === 'completed' && (s.intensity === 'hard' || s.intensity === 'race');
}

/** 24 weeks of daily dots. `painDates` is a set of YYYY-MM-DD dates the
 *  caller has already resolved (tz-aware — see localDateOf) from that day's
 *  check-in reporting a symptom; kept out of this module so it stays a pure
 *  function of already-local dates, same as every other agent-layer builder. */
export function buildConsistencyDays(actualSessions: ActualSession[], painDates: ReadonlySet<string>, now: Date): RhythmDay[] {
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
    if (!sessions?.length) return 'empty';
    const notFollowed = sessions.some((s) => s.status !== 'completed');
    if (notFollowed || painDates.has(date) || clustered(date)) return 'flag';
    const completed = sessions.filter((s) => s.status === 'completed');
    return completed.every((s) => s.intensity === 'easy') ? 'easy' : 'normal';
  }

  const todayIso = isoDate(now);
  const start = addDays(now, -(RHYTHM_WEEKS * 7 - 1));
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
