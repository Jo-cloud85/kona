import type { ActualSession, PlannedSession, RecoveryLog } from '../domain/types';
import { addDays, describeWhen, durationLabel, isoDate, joinList, sportLabel, titleFor, weekdayFull } from './home';
import {
  deriveInsights,
  effectiveIsLong,
  recentSessionRead,
  similarSessionFlag,
  snippet,
  type InsightBasis,
  type SessionFlagCategory,
} from './insights';

/**
 * The Kona Briefing — "given everything going on with you, how should you
 * approach the next session?" No LLM call: deterministic, same discipline as
 * the rest of `insights.ts`. Never fabricates a number or a certainty level
 * it doesn't have; an honest "nothing special" is a valid answer.
 *
 * M25.1 widened this from a purely FORWARD-looking function (M24: "is there
 * a big session coming up, and is one comparable past session worth citing")
 * into a priority cascade that also looks backward — most days aren't
 * building up to something big, and a flat "nothing coming up" line fails
 * the product's own "what does Kona think matters today" test on exactly
 * those days. Checked in order, per the brief's own signal-vs-noise
 * priority (something that changes today's action > something that
 * prevents a likely mistake > an emerging pattern), falling through to
 * M24's original forward-looking logic, then the honest default:
 *
 *   1. recentOutcomeSignal  — a recent session read badly, and today trains
 *   2. unacknowledgedSignal — a recent planned session with no actual record
 *   3. patternSignal        — the single highest-priority emerging pattern
 *   4. upcomingSessionSignal — M24's original logic, unchanged
 *   5. honest default
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
  /** "Today" / "Tomorrow" / "Thursday" / "next Thursday", or null when this
   *  call isn't about a specific day. */
  when: string | null;
  date: string | null;
  /** The plain session name ("Long run", "Double session — ride then run"),
   *  shown small, only when a specific session is involved. */
  session_label: string | null;
  /** The verdict itself — always present. "Keep today easy", "Bring extra
   *  fluid", "Nothing special needed". The dominant, large text on Home. */
  headline: string;
  /** The fuller instruction — always present. */
  action: string;
  /** The evidence behind the call, only when real evidence exists. One
   *  compact line, not a bulleted list — reads as calm/personal rather than
   *  a notification inbox. */
  why: string | null;
  /** The planned-vs-actual comparison behind `why`, when relevant. */
  deviation: { planned: string; actual: string; reason: string | null } | null;
  basis: InsightBasis | null;
}

const ACTION_BY_CATEGORY: Record<SessionFlagCategory, string> = {
  thirst: 'Bring extra fluid — your second bottle if you have one.',
  gi: 'Keep the meal beforehand lighter than usual.',
  cramp: "Don't skip your usual sodium, and don't push the pace early.",
  trouble: "Ease into it rather than forcing the full session if it's not feeling right.",
  stopped_early: "Ease into it rather than forcing the full session if it's not feeling right.",
};

const HEADLINE_BY_CATEGORY: Record<SessionFlagCategory, string> = {
  thirst: 'Bring extra fluid',
  gi: 'Keep the pre-session meal light',
  cramp: 'Watch your sodium and pacing',
  trouble: 'Ease into it',
  stopped_early: 'Ease into it',
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

/** The plain session name — "Long run", "Double session — ride then run". */
function sessionLabelFor(sessions: PlannedSession[]): string {
  if (sessions.length > 1) {
    return `Double session — ${joinList(sessions.map((s) => sportLabel(s.sport)))}`;
  }
  const title = titleFor(sessions[0]!);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** "Yesterday" / a weekday name for a date a few days before `today`. */
function describeRecentDay(today: string, dateIso: string): string {
  const t = new Date(`${today}T00:00:00`);
  const d = new Date(`${dateIso}T00:00:00`);
  const days = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  return days === 1 ? 'Yesterday' : weekdayFull(dateIso);
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

/** The planned-vs-actual comparison for `actual`, when it deviated from its
 *  linked plan enough to be worth showing — null for an unremarkable,
 *  completed-as-planned session. */
function deviationFor(actual: ActualSession, sessions: PlannedSession[]): KonaBriefing['deviation'] {
  if (!actual.planned_session_id) return null;
  const plan = sessions.find((p) => p.id === actual.planned_session_id);
  if (!plan) return null;
  const plannedLabel = durationLabel(plan);
  const actualLabel = durationLabel(actual);
  const changed = plannedLabel !== actualLabel || actual.status !== 'completed' || Boolean(actual.reason);
  if (!changed) return null;
  return { planned: plannedLabel, actual: actualLabel, reason: actual.reason ?? null };
}

interface CascadeInput {
  today: string;
  sessions: PlannedSession[];
  actualSessions: ActualSession[];
  recoveryLogs: RecoveryLog[];
  plannedByDate: Map<string, PlannedSession[]>;
}

/** Tier 1 — a recent session read badly, and today has something planned. */
function recentOutcomeSignal(input: CascadeInput): KonaBriefing | null {
  const todaySessions = input.plannedByDate.get(input.today) ?? [];
  if (todaySessions.length === 0) return null;

  const recent = recentSessionRead(input.today, 2, input);
  if (!recent || recent.outcome !== 'negative') return null;

  const dayLabel = describeRecentDay(input.today, recent.date);
  const said = recent.note ? `you said: "${snippet(recent.note)}"` : "it didn't go entirely to plan";
  const why = `${dayLabel}'s ${sportLabel(recent.session.sport)} — ${said}.`;
  const deviation = deviationFor(recent.session, input.sessions);

  return {
    when: 'Today',
    date: input.today,
    session_label: sessionLabelFor(todaySessions),
    headline: 'Keep today easy',
    action: "Keep today's session conversational — don't chase extra mileage or intensity to compensate.",
    why,
    deviation,
    basis: 'reported',
  };
}

/** Tier 2 — a recent planned session with no matching actual record at all. */
function unacknowledgedSignal(input: CascadeInput): KonaBriefing | null {
  const start = new Date(`${input.today}T00:00:00`);
  const actualDates = new Set(input.actualSessions.map((a) => a.start_at.slice(0, 10)));
  for (let i = 1; i <= 3; i++) {
    const date = isoDate(addDays(start, -i));
    const dayOf = input.plannedByDate.get(date) ?? [];
    if (dayOf.length === 0 || actualDates.has(date)) continue;

    const dayLabel = describeRecentDay(input.today, date);
    const todaySessions = input.plannedByDate.get(input.today) ?? [];
    return {
      when: 'Today',
      date: input.today,
      session_label: todaySessions.length ? sessionLabelFor(todaySessions) : null,
      headline: `Don't chase ${dayLabel.toLowerCase()}'s session`,
      action: "Follow today's plan as normal — no need to add extra volume to make up for it.",
      why: `${dayLabel} had ${sessionLabelFor(dayOf).toLowerCase()} on the plan, but there's no record it happened.`,
      deviation: null,
      basis: null,
    };
  }
  return null;
}

/** Tier 3 — the single highest-priority emerging pattern, verbatim. */
function patternSignal(input: CascadeInput): KonaBriefing | null {
  const insights = deriveInsights({
    actualSessions: input.actualSessions,
    recoveryLogs: input.recoveryLogs,
    fuelLogs: [],
    memories: [],
  });
  const pattern = insights.find((i) => i.kind === 'pattern');
  if (!pattern) return null;
  const action = insights.find((i) => i.kind === 'recommendation' && i.as_of === pattern.as_of);

  return {
    when: null,
    date: null,
    session_label: null,
    headline: 'An emerging pattern',
    action: action?.text ?? 'Worth keeping in mind for your next few sessions.',
    why: pattern.text,
    deviation: null,
    basis: pattern.basis,
  };
}

/** Tier 4 — M24's original forward-looking logic, unchanged in substance. */
function upcomingSessionSignal(input: CascadeInput): KonaBriefing | null {
  const target = findNextMeaningfulSession(input.sessions, input.today);
  if (!target) return null;

  const key = keySessionOf(target.sessions);
  const flag = similarSessionFlag(
    { sport: key.sport, is_long: effectiveIsLong(key), intensity: key.intensity },
    { actualSessions: input.actualSessions, recoveryLogs: input.recoveryLogs },
  );
  const when = describeWhen(input.today, target.date);
  const session_label = sessionLabelFor(target.sessions);

  return {
    when,
    date: target.date,
    session_label,
    headline: flag ? HEADLINE_BY_CATEGORY[flag.category] : 'Nothing special needed',
    action: flag ? ACTION_BY_CATEGORY[flag.category] : NOTHING_SPECIAL,
    why: flag ? flag.text : null,
    deviation: null,
    basis: flag ? flag.basis : null,
  };
}

const HONEST_DEFAULT: KonaBriefing = {
  when: null,
  date: null,
  session_label: null,
  headline: 'All quiet',
  action: NOTHING_COMING_UP,
  why: null,
  deviation: null,
  basis: null,
};

export function buildKonaBriefing(input: {
  today: string;
  sessions: PlannedSession[];
  actualSessions: ActualSession[];
  recoveryLogs: RecoveryLog[];
}): KonaBriefing {
  const cascadeInput: CascadeInput = { ...input, plannedByDate: groupByDate(input.sessions) };
  return (
    recentOutcomeSignal(cascadeInput) ??
    unacknowledgedSignal(cascadeInput) ??
    patternSignal(cascadeInput) ??
    upcomingSessionSignal(cascadeInput) ??
    HONEST_DEFAULT
  );
}
