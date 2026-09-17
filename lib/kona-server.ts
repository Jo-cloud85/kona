import 'server-only';
import type { Profile } from '../src/domain/types';
import type { EditReconciliation } from '../src/data/index';
import type { ProfileFormData } from '../src/domain/profile-input';
import { athleteNow, localDateOf, DEFAULT_TZ } from '../src/domain/time';
import {
  buildCheckinLog,
  buildDashboard,
  buildConsistencyDays,
  buildToday,
  buildKnows,
  buildKonaBriefing,
  buildSessionRecap,
  buildStarter,
  buildWeek,
  checkinReflection,
  CLUSTER_WINDOW_DAYS,
  computeArcProgress,
  computeMilestones,
  deriveInsights,
  describeConsistency,
  handleMessage,
  learnedCategoryInsights,
  recentHardSessions,
  recordTurnActivity,
  screenForEscalation,
  type AgentDeps,
  type AgentTurn,
  type ArcProgress,
  type CheckinInput,
  type ChatStarter,
  type TodayView,
  type Insight,
  type KnowsInsight,
  type KnowsRecentSession,
  type KnowsTimelineEntry,
  type KnowsToldLine,
  type Milestone,
  type RhythmDay,
  type SessionRecap,
  type WeekView,
} from '../src/agent/index';
import { goalContext } from '../src/domain/goal';
import type { KonaContext } from './server-context';

export { llmName } from './server-context';

/**
 * Web-app use-cases. Each takes the resolved {@link KonaContext} (repo + userId +
 * llm) so every read/write is scoped to the authenticated user. No module-level
 * user identity — that lives in the request context now (M23).
 */

function deps(ctx: KonaContext): AgentDeps {
  return { repo: ctx.repo, llm: ctx.llm };
}

export async function getProfile(ctx: KonaContext): Promise<Profile | undefined> {
  return ctx.repo.getProfile(ctx.userId);
}

export async function saveProfile(ctx: KonaContext, data: ProfileFormData): Promise<Profile> {
  const existing = await ctx.repo.getProfile(ctx.userId);
  return ctx.repo.upsertProfile({
    ...existing,
    ...data,
    user_id: ctx.userId,
    onboarded_at: existing?.onboarded_at ?? new Date().toISOString(),
  });
}

/** Erases every record this user owns so they can re-onboard from scratch.
 *  Keeps the login itself (auth account) intact — irreversible otherwise. */
export async function resetAccount(ctx: KonaContext): Promise<void> {
  await ctx.repo.deleteAllUserData(ctx.userId);
}

export interface SentMessage {
  turn: AgentTurn;
  /** Structured per-session prompts from a weekly-plan / clarify turn, if any. */
  session_prompts: unknown[];
  /** For an edit: what reconciling the replaced turn(s) removed/repaired (M23.1). */
  reconciled?: EditReconciliation;
}

export async function sendMessage(
  ctx: KonaContext,
  conversationId: string,
  message: string,
  tz: string = DEFAULT_TZ,
): Promise<SentMessage> {
  const turn = await handleMessage(deps(ctx), { userId: ctx.userId, conversationId, message, now: athleteNow(tz) });
  let session_prompts: unknown[] = [];
  for (const r of turn.tool_results) {
    const analysis = (r.data as { analysis?: { session_prompts?: { in_focus?: boolean }[] } } | undefined)?.analysis;
    if (r.ok && Array.isArray(analysis?.session_prompts)) {
      // Only surface the 1–2 sessions Kona is chasing now — the rest are
      // deferred (M21). Fall back to all if nothing is flagged.
      const focus = analysis.session_prompts.filter((p) => p.in_focus);
      session_prompts = focus.length ? focus : analysis.session_prompts;
    }
  }
  return { turn, session_prompts };
}

export async function listMessages(ctx: KonaContext, conversationId: string) {
  return ctx.repo.listMessages(ctx.userId, conversationId);
}

/**
 * Edit-and-regenerate (M23.1). In order:
 *  1. find the ids of the edited message + everything after it,
 *  2. reconcile the structured records those turns created — delete the
 *     sessions / fuel / recovery / weekly plans / memories / activity events
 *     stamped with those message ids, and null any dangling foreign key on a
 *     surviving record (a later record is kept, only its link to a now-gone
 *     record is cut),
 *  3. delete the messages,
 *  4. re-run the turn with `newText`; the regenerated turn's records get the
 *     NEW message id as their origin.
 *
 * DELIBERATE LIMITATIONS (documented — ARCHITECTURE.md §6b):
 *  - A memory the edited turn *updated* (rather than first created) reverts to
 *    unset, not to its earlier value — there is no memory revision history.
 *  - Profile facts set via chat (body weight, bottle, goal) are one row per
 *    user with no per-fact provenance, so they are not reverted by an edit.
 *  - A plan *field update* (`update_planned_sessions`) is not reverted; only
 *    records the turn *created* are.
 */
export async function editMessage(
  ctx: KonaContext,
  conversationId: string,
  messageId: string,
  newText: string,
  tz: string = DEFAULT_TZ,
): Promise<SentMessage> {
  const removedIds = await ctx.repo.listMessageIdsFrom(ctx.userId, conversationId, messageId);
  const reconciled = await ctx.repo.deleteRecordsForMessages(ctx.userId, removedIds);
  await ctx.repo.deleteMessagesFrom(ctx.userId, conversationId, messageId);
  const sent = await sendMessage(ctx, conversationId, newText, tz);
  return { ...sent, reconciled };
}

export async function listConversations(ctx: KonaContext) {
  return ctx.repo.listConversations(ctx.userId);
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// athleteNow()'s local getters already read back the athlete's wall clock
// (see src/domain/time.ts) — ymdLocal(athleteNow(tz)) is "today" for them.

export async function getInsights(ctx: KonaContext): Promise<Insight[]> {
  const [actualSessions, recoveryLogs, fuelLogs, memories] = await Promise.all([
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
    ctx.repo.listFuelLogs(ctx.userId),
    ctx.repo.listMemories(ctx.userId),
  ]);
  return deriveInsights({ actualSessions, recoveryLogs, fuelLogs, memories });
}

/** `recommendation_declined` activity events name the exact proposal they
 *  turned down in `meta.recommendation_id` — see `PendingRecommendation.id`. */
function declinedRecommendationKeys(events: { type: string; meta?: Record<string, unknown> | null }[]): Set<string> {
  const ids = events
    .filter((e) => e.type === 'recommendation_declined')
    .map((e) => e.meta?.recommendation_id)
    .filter((id): id is string => typeof id === 'string');
  return new Set(ids);
}

export async function getToday(ctx: KonaContext, selectedDate?: string, tz: string = DEFAULT_TZ): Promise<TodayView | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const [weeklyPlans, actualSessions, recoveryLogs, fuelLogs, memories, activityEvents] = await Promise.all([
    ctx.repo.listWeeklyPlans(ctx.userId),
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
    ctx.repo.listFuelLogs(ctx.userId),
    ctx.repo.listMemories(ctx.userId),
    ctx.repo.listActivityEvents(ctx.userId),
  ]);
  const weeklyPlan = weeklyPlans.at(-1);
  // All of the athlete's planned sessions, not just ones attached to the latest
  // weekly plan — a standalone "tomorrow I'm running 14km" (save_planned_session)
  // never gets a weekly_plan_id, so scoping to the plan silently hid it (found
  // during alpha testing, 2026-09-12). buildToday indexes sessions by date, so
  // anything outside the displayed week is naturally ignored anyway.
  const sessions = await ctx.repo.listPlannedSessions(ctx.userId);
  const now = athleteNow(tz);
  const today = ymdLocal(now);
  const recoveryDates = new Set(recoveryLogs.map((l) => localDateOf(l.logged_at, tz)));
  const checkinDoneToday = recoveryDates.has(today);
  // Reused rather than recomputed — buildDashboard already runs analyzeWeek()
  // for the same weekly plan; recommendation_inputs is its day-before prep
  // text, previously only reachable through a saved-plan chat reply.
  const dashboard = buildDashboard({ profile, weeklyPlan, sessions });
  const konaBriefing = buildKonaBriefing({
    today,
    sessions,
    actualSessions,
    recoveryLogs,
    restDays: weeklyPlan?.rest_days,
    recommendationInputs: dashboard.recommendation_inputs,
    declinedRecommendationKeys: declinedRecommendationKeys(activityEvents),
  });
  return buildToday({
    profile,
    weeklyPlan,
    sessions,
    selectedDate,
    checkinDoneToday,
    recoveryDates,
    actualSessions,
    recoveryLogs,
    fuelLogs,
    memories,
    now,
    konaBriefing,
  });
}

export interface RespondToRecommendationInput {
  action: 'accept' | 'decline';
  /** `PendingRecommendation.id` — recorded on decline so the cascade never
   *  re-proposes the identical swap. */
  recommendation_id: string;
  session_id: string;
  /** YYYY-MM-DD. Only meaningful for `action: 'accept'`. */
  to_date: string;
}

/** Accept moves the planned session's calendar date (keeping its time of
 *  day) and logs it like any other plan edit; decline just records that the
 *  swap was turned down, so `loadClusterSignal` (briefing.ts) skips it next
 *  time instead of nagging. */
export async function respondToRecommendation(
  ctx: KonaContext,
  input: RespondToRecommendationInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.action === 'decline') {
    await ctx.repo.appendActivityEvent({
      user_id: ctx.userId,
      type: 'recommendation_declined',
      summary: 'Kept a session as planned instead of accepting a proposed swap.',
      meta: { recommendation_id: input.recommendation_id },
    });
    return { ok: true };
  }

  const session = await ctx.repo.getPlannedSession(input.session_id);
  if (!session || session.user_id !== ctx.userId) return { ok: false, error: 'Session not found.' };
  const time = session.start_at.slice(11); // preserve HH:MM:SS, just move the date
  await ctx.repo.updatePlannedSession(input.session_id, { start_at: `${input.to_date}T${time}` });
  await ctx.repo.appendActivityEvent({
    user_id: ctx.userId,
    type: 'plan_updated',
    summary: `Moved a session to ${input.to_date} to space out a run of hard training days.`,
    meta: { recommendation_id: input.recommendation_id },
  });
  return { ok: true };
}

export interface RhythmView {
  greeting_name: string | null;
  /** Last 24 weeks, oldest first — a plain-language read, not a score
   *  (PRODUCT_VISION.md "not a metrics dashboard"; a deliberate, considered
   *  exception for this one visual, per founder direction, M27). "Worth
   *  watching" reuses the exact same trailing-window threshold as Today's
   *  own load-clustering tier (briefing.ts) — the two screens never
   *  disagree about what counts as clustered. */
  consistency: { days: RhythmDay[]; headline: string; detail: string };
  /** Up to 3 goals (M27.1) — each with a name and either a countdown or
   *  `null` when the athlete deliberately said there's no target date, not
   *  a missing field. Empty array renders the honest "no goal set" state. */
  goals: { name: string; countdown: string | null }[];
  arc: ArcProgress;
  milestones: Milestone[];
  has_anything: boolean;
  /** "What Kona has learned" — deriveInsights()'s usual feed, with the
   *  category-based "Kona learned: X" entries (insights.ts,
   *  learnedCategoryInsights) merged in as high-priority `pattern`/`outcome`
   *  entries so they read as one feed, not two competing lists. */
  insights: KnowsInsight[];
  told: KnowsToldLine[];
  recent: KnowsRecentSession[];
  timeline: KnowsTimelineEntry[];
}

/** "Rhythm" (M27): merges the old "You" (progression/identity) and "Memory"
 *  ("What Kona knows about you") tabs into one screen — the founder's call
 *  after reviewing the Claude Design redesign. Needs full activity-event
 *  history for the Arc metrics, unlike the old getKnows()'s capped fetch;
 *  buildKnows()'s own timeline already caps itself to 14, so fetching the
 *  full list here (shared with Arc) is safe. */
export async function getRhythm(ctx: KonaContext, tz: string = DEFAULT_TZ): Promise<RhythmView | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const [actualSessions, recoveryLogs, fuelLogs, memories, events] = await Promise.all([
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
    ctx.repo.listFuelLogs(ctx.userId),
    ctx.repo.listMemories(ctx.userId),
    ctx.repo.listActivityEvents(ctx.userId),
  ]);
  const now = athleteNow(tz);
  const arc = computeArcProgress({ actualSessions, activityEvents: events, now });
  const milestones = computeMilestones(actualSessions, now);
  const goals = (profile.goals ?? []).map((g) => {
    const gc = goalContext(g, now);
    return { name: gc.short_text ?? g.text, countdown: gc.countdown };
  });

  // A check-in alone (M27.8) — pain/injury reported, or the athlete
  // explicitly said the day didn't go as planned — flags the day even when
  // nothing was separately logged as an ActualSession that date.
  const offPlanDates = new Set(
    recoveryLogs
      .filter((l) => (l.reported_symptoms?.length ?? 0) > 0 || l.went_as_planned === false)
      .map((l) => localDateOf(l.logged_at, tz)),
  );
  const consistencyDays = buildConsistencyDays(actualSessions, offPlanDates, now);
  const recentHard = recentHardSessions(actualSessions, ymdLocal(now), CLUSTER_WINDOW_DAYS);
  const consistency = { days: consistencyDays, ...describeConsistency(recentHard, ymdLocal(now)) };

  const known = buildKnows({ profile, memories, actualSessions, recoveryLogs, fuelLogs, events });
  const learned = learnedCategoryInsights(recoveryLogs).map(
    (l): KnowsInsight => ({
      kind: 'pattern',
      basis: 'outcome',
      text: l.text,
      certainty: 'moderate',
      evidence_count: l.count,
      topic: 'training',
      evidence: [],
      tier: 'acting_on',
    }),
  );

  return {
    greeting_name: profile.username ?? null,
    consistency,
    goals,
    arc,
    milestones,
    has_anything: known.has_anything || learned.length > 0,
    insights: [...learned, ...known.insights],
    told: known.told,
    recent: known.recent,
    timeline: known.timeline,
  };
}

export async function getWeek(ctx: KonaContext, tz: string = DEFAULT_TZ): Promise<WeekView | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const weeklyPlan = (await ctx.repo.listWeeklyPlans(ctx.userId)).at(-1);
  const [sessions, actualSessions] = await Promise.all([
    ctx.repo.listPlannedSessions(ctx.userId),
    ctx.repo.listActualSessions(ctx.userId),
  ]);
  return buildWeek({ profile, weeklyPlan, sessions, actualSessions, now: athleteNow(tz) });
}

/** Post-session recap for one day (opened by tapping a day in "Your week").
 *  Null when the athlete hasn't onboarded, or nothing was actually logged
 *  that day — there's nothing honest to recap for a day that's only planned. */
export async function getSessionRecap(ctx: KonaContext, date: string, tz: string = DEFAULT_TZ): Promise<SessionRecap | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const weeklyPlan = (await ctx.repo.listWeeklyPlans(ctx.userId)).at(-1);
  const [plannedSessions, actualSessions, recoveryLogs, fuelLogs, memories] = await Promise.all([
    ctx.repo.listPlannedSessions(ctx.userId),
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
    ctx.repo.listFuelLogs(ctx.userId),
    ctx.repo.listMemories(ctx.userId),
  ]);
  return buildSessionRecap({ profile, date, tz, weeklyPlan, plannedSessions, actualSessions, recoveryLogs, fuelLogs, memories });
}

export interface CheckinResult {
  ok: true;
  escalated: boolean;
  reflection: string;
  /** "Kona learned: X" — set only the check-in that first crosses the
   *  evidence threshold for a category (see learnedCategoryInsights). Show
   *  it once as a toast; it also becomes permanent in Rhythm's feed. */
  learned: string | null;
}

export async function submitCheckin(ctx: KonaContext, input: CheckinInput): Promise<CheckinResult | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;

  const beforeLearned = new Set(learnedCategoryInsights(await ctx.repo.listRecoveryLogs(ctx.userId)).map((l) => l.category));

  const log = buildCheckinLog(input);
  const screen = screenForEscalation(log.free_text);
  await ctx.repo.saveRecoveryLog({
    user_id: ctx.userId,
    free_text: log.free_text,
    overall_severity: log.overall_severity,
    reported_symptoms: log.reported_symptoms,
    sleep_quality: log.sleep_quality,
    mood: log.mood,
    followed_category: log.followed_category,
    followed_outcome: log.followed_outcome,
    went_as_planned: log.went_as_planned,
  });
  await ctx.repo.appendActivityEvent({
    user_id: ctx.userId,
    type: 'checkin_done',
    summary: 'You did an end-of-day check-in',
  });
  await recordTurnActivity(ctx.repo, ctx.userId, []); // insight-detection pass only

  const afterLearned = learnedCategoryInsights(await ctx.repo.listRecoveryLogs(ctx.userId));
  const newlyLearned = afterLearned.find((l) => !beforeLearned.has(l.category));

  return { ok: true, escalated: screen.escalate, reflection: checkinReflection(input, screen), learned: newlyLearned?.text ?? null };
}

/** The opening message + conversation starters. Null until the user has onboarded. */
export async function getStarter(ctx: KonaContext, tz: string = DEFAULT_TZ): Promise<ChatStarter | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const [sessions, actualSessions, recoveryLogs] = await Promise.all([
    ctx.repo.listPlannedSessions(ctx.userId),
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
  ]);
  const now = athleteNow(tz);
  // Same judgment as Home (M24.4) — literally the same function, so the
  // opener and the Home briefing can never say different things.
  const briefing = buildKonaBriefing({ today: ymdLocal(now), sessions, actualSessions, recoveryLogs });
  return buildStarter(profile, { now, sessions, briefing });
}
