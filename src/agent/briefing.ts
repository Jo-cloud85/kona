import type { ActualSession, PlannedSession, RecoveryLog } from '../domain/types';
import type { WeekRecommendation } from '../engine/week';
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
 *   1. recentOutcomeSignal  — a recent session read badly (fires whether or
 *      not today trains — "given everything going on with you", not just
 *      pre-workout advice, M27)
 *   2. loadClusterSignal    — today would extend a recent run of hard days;
 *      severe enough + a swap target exists -> a real plan-change proposal
 *      (accept/decline), not just softened advice (M27)
 *   3. unacknowledgedSignal — a recent planned session with no actual record
 *   4. patternSignal        — the single highest-priority emerging pattern
 *   5. upcomingSessionSignal — M24's original logic, now also citing
 *      `src/engine/week.ts`'s day-before prep when a saved plan covers it
 *   6. honest default
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
  /** Which advice category this call is — set only by the evidence-based
   *  upcoming-session tier. Threaded back through the check-in loop (M24.5)
   *  so the "Kona learned" detector can count outcomes per category instead
   *  of re-parsing free_text. */
  category: SessionFlagCategory | null;
  /** Present only when this call is an actual plan-change proposal (move a
   *  session), not just advice — the Today card renders Accept/Decline
   *  instead of a single "Got it" in this state. */
  pending_recommendation: PendingRecommendation | null;
}

export interface PendingRecommendation {
  /** Deterministic key identifying this exact proposal (session + from/to
   *  date) — recorded on decline so the same swap isn't re-proposed. */
  id: string;
  reason_line: string;
  accept_label: string;
  decline_label: string;
  session_id: string;
  from_date: string;
  to_date: string;
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

/** "Yesterday" / a weekday name for a date a few days before `today`. Exported
 *  for reuse by Rhythm's consistency-read detail line (rhythm.ts) — same
 *  phrasing convention, not reimplemented. */
export function describeRecentDay(today: string, dateIso: string): string {
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
  /** From the saved weekly plan, if any — used to find a swap target for a
   *  proposed reschedule. */
  restDays: string[];
  /** Day-before prep lines from `src/engine/week.ts`'s `prepAction`, already
   *  computed by `buildDashboard` — reused here rather than recomputed. */
  recommendationInputs: WeekRecommendation[];
  /** `PendingRecommendation.id` values the athlete has already declined —
   *  never re-propose the identical swap. */
  declinedRecommendationKeys: Set<string>;
}

/** Tier 1 — a recent session read badly. Fires whether or not today trains —
 *  an unsettled recent event is current-state information either way. */
function recentOutcomeSignal(input: CascadeInput): KonaBriefing | null {
  const recent = recentSessionRead(input.today, 2, input);
  if (!recent || recent.outcome !== 'negative') return null;

  const todaySessions = input.plannedByDate.get(input.today) ?? [];
  const dayLabel = describeRecentDay(input.today, recent.date);
  const said = recent.note ? `you said: "${snippet(recent.note)}"` : "it didn't go entirely to plan";
  const why = `${dayLabel}'s ${sportLabel(recent.session.sport)} — ${said}.`;
  const deviation = deviationFor(recent.session, input.sessions);

  if (todaySessions.length === 0) {
    return {
      when: null,
      date: null,
      session_label: null,
      headline: `Keeping an eye on ${dayLabel === 'Yesterday' ? "yesterday's session" : `${dayLabel.toLowerCase()}'s session`}`,
      action: 'I want to see how that settles before the next session — no need to change anything today.',
      why,
      deviation,
      basis: 'reported',
      category: null,
      pending_recommendation: null,
    };
  }

  return {
    when: 'Today',
    date: input.today,
    session_label: sessionLabelFor(todaySessions),
    headline: 'Keep today easy',
    action: "Keep today's session conversational — don't chase extra mileage or intensity to compensate.",
    why,
    deviation,
    basis: 'reported',
    category: null,
    pending_recommendation: null,
  };
}

export const CLUSTER_WINDOW_DAYS = 4;
export const CLUSTER_SOFTEN_MIN = 2;
const CLUSTER_SWAP_MIN = 3;

function isHardCompleted(s: ActualSession): boolean {
  return s.status === 'completed' && (s.intensity === 'hard' || s.intensity === 'race');
}

/** Hard/race COMPLETED actual sessions in the trailing window before `today`
 *  (never including today itself), oldest first. Exported — Rhythm's
 *  consistency-grid headline (kona-server.ts) reuses this exact threshold
 *  rather than duplicating it, so the two screens never disagree about what
 *  counts as "clustered". */
export function recentHardSessions(actualSessions: ActualSession[], today: string, days: number): ActualSession[] {
  const cutoff = isoDate(addDays(new Date(`${today}T00:00:00`), -days));
  return actualSessions
    .filter(isHardCompleted)
    .filter((s) => {
      const d = s.start_at.slice(0, 10);
      return d < today && d >= cutoff;
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/** The nearest rest day from the saved plan strictly after `today`. */
function nextRestDay(today: string, restDays: string[]): string | null {
  return restDays.filter((d) => d > today).sort()[0] ?? null;
}

/** Tier 2 — today's session would extend a run of recent hard days. Not a
 *  score, not stored "load" — recomputed fresh from actualSessions every
 *  call, same discipline as everything else in this cascade. Severe enough
 *  (3+) and a swap target exists → propose moving the session; otherwise
 *  just downgrade today's intensity expectation. */
function loadClusterSignal(input: CascadeInput): KonaBriefing | null {
  const todaySessions = input.plannedByDate.get(input.today) ?? [];
  if (todaySessions.length === 0 || !todaySessions.some(isSessionMeaningful)) return null;

  const recentHard = recentHardSessions(input.actualSessions, input.today, CLUSTER_WINDOW_DAYS);
  if (recentHard.length < CLUSTER_SOFTEN_MIN) return null;

  const key = keySessionOf(todaySessions);
  const session_label = sessionLabelFor(todaySessions);
  const dayLabels = recentHard.map((s) => describeRecentDay(input.today, s.start_at.slice(0, 10)));
  const why = `You've had ${recentHard.length} hard sessions in the last few days (${joinList(dayLabels)}).`;

  if (recentHard.length >= CLUSTER_SWAP_MIN) {
    const swapTarget = nextRestDay(input.today, input.restDays);
    if (swapTarget) {
      const id = `${key.id}:${input.today}:${swapTarget}`;
      if (!input.declinedRecommendationKeys.has(id)) {
        return {
          when: 'Today',
          date: input.today,
          session_label,
          headline: `Move today's ${sportLabel(key.sport)}`,
          action: `${why} Shift it to ${weekdayFull(swapTarget)}?`,
          why: null,
          deviation: null,
          basis: 'repeated',
          category: null,
          pending_recommendation: {
            id,
            reason_line: `Based on your last ${CLUSTER_WINDOW_DAYS} days of training`,
            accept_label: 'Accept swap',
            decline_label: 'Keep as planned',
            session_id: key.id,
            from_date: input.today,
            to_date: swapTarget,
          },
        };
      }
    }
  }

  return {
    when: 'Today',
    date: input.today,
    session_label,
    headline: 'Treat today as maintenance',
    action: "Keep today's session light rather than another hard day — go by feel, not the plan's original intensity.",
    why,
    deviation: null,
    basis: 'repeated',
    category: null,
    pending_recommendation: null,
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
      category: null,
      pending_recommendation: null,
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
    category: null,
    pending_recommendation: null,
  };
}

/** Tier 5 — M24's original forward-looking logic. Widened (M27) to prefer
 *  `src/engine/week.ts`'s richer day-before prep (double/long/key-day
 *  specific — previously only reachable through a saved-weekly-plan chat
 *  reply, never through Today) when a saved plan covers the target day and
 *  there's no more specific evidence-based flag; always states plainly when
 *  the call isn't about today, so the athlete isn't left guessing why today
 *  wasn't mentioned. */
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
  const dayPrep = input.recommendationInputs.find((r) => r.date === target.date);
  const leadIn = target.date === input.today ? '' : 'Nothing needed today. ';

  return {
    when,
    date: target.date,
    session_label,
    headline: flag ? HEADLINE_BY_CATEGORY[flag.category] : dayPrep ? 'Get ready' : 'Nothing special needed',
    action: `${leadIn}${flag ? ACTION_BY_CATEGORY[flag.category] : (dayPrep?.action ?? NOTHING_SPECIAL)}`,
    why: flag ? flag.text : null,
    deviation: null,
    basis: flag ? flag.basis : null,
    category: flag ? flag.category : null,
    pending_recommendation: null,
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
  category: null,
  pending_recommendation: null,
};

export function buildKonaBriefing(input: {
  today: string;
  sessions: PlannedSession[];
  actualSessions: ActualSession[];
  recoveryLogs: RecoveryLog[];
  /** From the saved weekly plan, if any. */
  restDays?: string[];
  /** `Dashboard.recommendation_inputs` — already computed by `buildDashboard`
   *  for the same weekly plan; pass it through rather than recomputing. */
  recommendationInputs?: WeekRecommendation[];
  /** `PendingRecommendation.id`s already declined — from activity_events. */
  declinedRecommendationKeys?: Set<string>;
}): KonaBriefing {
  const cascadeInput: CascadeInput = {
    ...input,
    plannedByDate: groupByDate(input.sessions),
    restDays: input.restDays ?? [],
    recommendationInputs: input.recommendationInputs ?? [],
    declinedRecommendationKeys: input.declinedRecommendationKeys ?? new Set(),
  };
  return (
    recentOutcomeSignal(cascadeInput) ??
    loadClusterSignal(cascadeInput) ??
    unacknowledgedSignal(cascadeInput) ??
    patternSignal(cascadeInput) ??
    upcomingSessionSignal(cascadeInput) ??
    HONEST_DEFAULT
  );
}
