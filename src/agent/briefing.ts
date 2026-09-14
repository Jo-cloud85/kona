import type { ActualSession, PlannedSession, RecoveryLog } from '../domain/types';
import { addDays, describeWhen, isoDate, joinList, sportLabel, titleFor } from './home';
import { effectiveIsLong, similarSessionFlag, type InsightBasis, type SessionFlagCategory } from './insights';

/**
 * The Kona Briefing (M24) — "given everything going on with you, how should
 * you approach the next session?" Answers it with ONE recommendation: find
 * the next session actually worth preparing for, and — only when real
 * evidence exists — a specific action grounded in it. No LLM call: this is a
 * deterministic function, same discipline as the rest of `insights.ts`.
 *
 * Deliberately does NOT go through `buildDashboard`'s `is_key_day` (which
 * requires a saved weekly plan and returns nothing for standalone sessions —
 * see `src/agent/dashboard.ts`). A "long/hard/race/double" check straight off
 * the raw planned sessions works for every athlete, not just ones who've
 * saved a full week. "Long" itself is `effectiveIsLong` (insights.ts) — the
 * explicit flag OR the engine's own distance/duration classification, so an
 * 18km run reads as long even when the chat turn that logged it didn't
 * happen to set `is_long`.
 */

export interface KonaBriefing {
  has_target: boolean;
  /** "Today" / "Tomorrow" / "Thursday" / "next Thursday", or null when nothing's coming up. */
  when: string | null;
  date: string | null;
  headline: string | null;
  /** Always present — a specific action, or an honest "nothing special" line. */
  action: string;
  /** The evidence sentence behind `action`, only when real evidence exists. */
  why: string | null;
  basis: InsightBasis | null;
}

const ACTION_BY_CATEGORY: Record<SessionFlagCategory, string> = {
  thirst: 'Bring extra fluid — your second bottle if you have one.',
  gi: 'Keep the meal beforehand lighter than usual.',
  cramp: "Don't skip your usual sodium, and don't push the pace early.",
  trouble: "Ease into it rather than forcing the full session if it's not feeling right.",
  stopped_early: "Ease into it rather than forcing the full session if it's not feeling right.",
};

const NOTHING_SPECIAL = 'Nothing special to prepare — normal meals and fluids are fine.';
const NOTHING_COMING_UP = 'Nothing meaningful coming up in the next week — normal training and fuelling.';

function groupByDate(sessions: PlannedSession[]): Map<string, PlannedSession[]> {
  const byDate = new Map<string, PlannedSession[]>();
  for (const s of sessions) {
    const key = s.start_at.slice(0, 10);
    (byDate.get(key) ?? byDate.set(key, []).get(key)!).push(s);
  }
  return byDate;
}

function isSessionMeaningful(s: PlannedSession): boolean {
  return effectiveIsLong(s) || s.intensity === 'hard' || s.intensity === 'race';
}

function isMeaningful(sessions: PlannedSession[]): boolean {
  if (sessions.length > 1) return true; // a double-session day
  const s = sessions[0];
  return s != null && isSessionMeaningful(s);
}

/** The session within a (possibly double) day worth citing as the evidence candidate. */
function keySessionOf(sessions: PlannedSession[]): PlannedSession {
  return sessions.find(isSessionMeaningful) ?? sessions[0]!;
}

function briefingHeadline(sessions: PlannedSession[]): string {
  if (sessions.length > 1) {
    return `Double session — ${joinList(sessions.map((s) => sportLabel(s.sport)))}`;
  }
  const title = titleFor(sessions[0]!);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * The nearest day from `today` (inclusive) within `horizonDays` whose
 * session(s) are genuinely meaningful — long, hard/race, or a double day.
 * Not every planned session; most days should yield nothing here.
 */
export function findNextMeaningfulSession(
  sessions: PlannedSession[],
  today: string,
  horizonDays = 7,
): { date: string; sessions: PlannedSession[] } | null {
  const plannedByDate = groupByDate(sessions);
  const start = new Date(`${today}T00:00:00`);
  for (let i = 0; i <= horizonDays; i++) {
    const date = isoDate(addDays(start, i));
    const dayOf = plannedByDate.get(date) ?? [];
    if (dayOf.length > 0 && isMeaningful(dayOf)) return { date, sessions: dayOf };
  }
  return null;
}

export function buildKonaBriefing(input: {
  today: string;
  sessions: PlannedSession[];
  actualSessions: ActualSession[];
  recoveryLogs: RecoveryLog[];
}): KonaBriefing {
  const target = findNextMeaningfulSession(input.sessions, input.today);
  if (!target) {
    return { has_target: false, when: null, date: null, headline: null, action: NOTHING_COMING_UP, why: null, basis: null };
  }

  const key = keySessionOf(target.sessions);
  const flag = similarSessionFlag(
    { sport: key.sport, is_long: effectiveIsLong(key), intensity: key.intensity },
    { actualSessions: input.actualSessions, recoveryLogs: input.recoveryLogs },
  );

  const when = describeWhen(input.today, target.date);

  return {
    has_target: true,
    when,
    date: target.date,
    headline: briefingHeadline(target.sessions),
    action: flag ? ACTION_BY_CATEGORY[flag.category] : NOTHING_SPECIAL,
    why: flag ? flag.text : null,
    basis: flag ? flag.basis : null,
  };
}
