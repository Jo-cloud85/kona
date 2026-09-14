import 'server-only';
import type { Profile } from '../src/domain/types';
import type { EditReconciliation } from '../src/data/index';
import type { ProfileFormData } from '../src/domain/profile-input';
import { athleteNow, localDateOf, DEFAULT_TZ } from '../src/domain/time';
import {
  buildCheckinLog,
  buildHome,
  buildKnows,
  buildKonaBriefing,
  buildSessionRecap,
  buildStarter,
  buildWeek,
  checkinReflection,
  computeArcProgress,
  computeMilestones,
  deriveInsights,
  handleMessage,
  recordTurnActivity,
  screenForEscalation,
  type AgentDeps,
  type AgentTurn,
  type ArcProgress,
  type CheckinInput,
  type ChatStarter,
  type HomeView,
  type Insight,
  type KnowsView,
  type Milestone,
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

export async function getKnows(ctx: KonaContext): Promise<KnowsView | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const [memories, actualSessions, recoveryLogs, fuelLogs, events] = await Promise.all([
    ctx.repo.listMemories(ctx.userId),
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
    ctx.repo.listFuelLogs(ctx.userId),
    ctx.repo.listActivityEvents(ctx.userId, 40),
  ]);
  return buildKnows({ profile, memories, actualSessions, recoveryLogs, fuelLogs, events });
}

export async function getHome(ctx: KonaContext, selectedDate?: string, tz: string = DEFAULT_TZ): Promise<HomeView | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;
  const [weeklyPlans, actualSessions, recoveryLogs, fuelLogs, memories] = await Promise.all([
    ctx.repo.listWeeklyPlans(ctx.userId),
    ctx.repo.listActualSessions(ctx.userId),
    ctx.repo.listRecoveryLogs(ctx.userId),
    ctx.repo.listFuelLogs(ctx.userId),
    ctx.repo.listMemories(ctx.userId),
  ]);
  const weeklyPlan = weeklyPlans.at(-1);
  // All of the athlete's planned sessions, not just ones attached to the latest
  // weekly plan — a standalone "tomorrow I'm running 14km" (save_planned_session)
  // never gets a weekly_plan_id, so scoping to the plan silently hid it (found
  // during alpha testing, 2026-09-12). buildHome indexes sessions by date, so
  // anything outside the displayed week is naturally ignored anyway.
  const sessions = await ctx.repo.listPlannedSessions(ctx.userId);
  const now = athleteNow(tz);
  const today = ymdLocal(now);
  const recoveryDates = new Set(recoveryLogs.map((l) => localDateOf(l.logged_at, tz)));
  const checkinDoneToday = recoveryDates.has(today);
  const konaBriefing = buildKonaBriefing({ today, sessions, actualSessions, recoveryLogs });
  return buildHome({
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

export interface YouView {
  greeting_name: string | null;
  /** Goal name and countdown as separate lines, matching the goal card's
   *  own layout — "Current goal" / name / countdown. Null fields render as
   *  the honest "no goal set" empty state. */
  goal_name: string | null;
  goal_countdown: string | null;
  arc: ArcProgress;
  milestones: Milestone[];
  /** Top pattern/fact insight, in Kona's own words — or null (an honest
   *  empty state), never invented. */
  learned: string | null;
}

/** The "You" screen (M26): progression/identity content only — account
 *  settings stay on the Profile overlay. Needs full activity-event history
 *  for the Arc metrics (unlike getKnows()'s capped fetch), so this is its
 *  own fetch rather than folded into getHome(). */
export async function getYou(ctx: KonaContext, tz: string = DEFAULT_TZ): Promise<YouView | null> {
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
  const milestones = computeMilestones(actualSessions);
  const insights = deriveInsights({ actualSessions, recoveryLogs, fuelLogs, memories });
  const learned = insights.find((i) => i.kind === 'pattern' || i.kind === 'fact')?.text ?? null;
  const goal = goalContext(profile.goal, now);
  return {
    greeting_name: profile.username ?? null,
    goal_name: goal.short_text,
    goal_countdown: goal.countdown,
    arc,
    milestones,
    learned,
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
}

export async function submitCheckin(ctx: KonaContext, input: CheckinInput): Promise<CheckinResult | null> {
  const profile = await ctx.repo.getProfile(ctx.userId);
  if (!profile?.onboarded_at) return null;

  const log = buildCheckinLog(input);
  const screen = screenForEscalation(log.free_text);
  await ctx.repo.saveRecoveryLog({
    user_id: ctx.userId,
    free_text: log.free_text,
    overall_severity: log.overall_severity,
    reported_symptoms: log.reported_symptoms,
  });
  await ctx.repo.appendActivityEvent({
    user_id: ctx.userId,
    type: 'checkin_done',
    summary: 'You did an end-of-day check-in',
  });
  await recordTurnActivity(ctx.repo, ctx.userId, []); // insight-detection pass only
  return { ok: true, escalated: screen.escalate, reflection: checkinReflection(input, screen) };
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
